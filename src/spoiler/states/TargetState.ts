import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { IdleState } from './IdleState';
import { loadSettings } from '../../core/Config';
import { Actions } from '../../core/Actions';
import { ensureGameActive } from '../../core/FocusGuard';
import { spawn } from 'child_process';

const Logger = createLogger();
const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

export class TargetState implements IState {
  name = 'TargetState';

  async enter(ctx: IStateContext): Promise<void> {
    const count = ctx.targets?.length ?? 0;
    Logger.info(`TargetState: получено целей=${count}`);
    if (count > 0) {
      // Настройки и выбор опорной точки
      const settings = loadSettings();
      // Требование: выбирать ближайшую цель к центру ЭКРАНА
      const screenCenter = await getPrimaryScreenCenter();
      const t = selectClosestToCenter(ctx.targets!, screenCenter.x, screenCenter.y);

      // Смещение курсора вниз перед кликом — берём только из settings.json; если нет, используем 0 и предупреждаем
      let clickOffsetY = 0;
      if (typeof settings.actions?.clickOffsetY === 'number' && isFinite(settings.actions.clickOffsetY)) {
        clickOffsetY = Math.round(settings.actions.clickOffsetY);
      } else {
        Logger.warn('actions.clickOffsetY is not set in settings.json; using 0');
      }

      // Перед любым действием убеждаемся, что активное окно — игровое
      const activeOk = await ensureGameActive();
      if (!activeOk) {
        Logger.warn('TargetState: окно игры не активно — наведение пропущено');
        return;
      }

      // Наведение и клик по центру цели (если actions.enableActions=true)
      const actions = new Actions(settings.actions || {});
      const delays = settings.actions?.delays || {};
      const beforeMoveMs = Math.max(0, Math.floor(delays.beforeMoveMs ?? 0));
      const afterMoveMs = Math.max(0, Math.floor(delays.afterMoveMs ?? 70));
      const beforeClickMs = Math.max(0, Math.floor(delays.beforeClickMs ?? 30));
      const afterClickMs = Math.max(0, Math.floor(delays.afterClickMs ?? 70));
      try {
        // Рассчитываем целевые абсолютные координаты центра bbox с вертикальным сдвигом
        const targetAx = Math.round(t.cx);
        const targetAy = Math.round(t.cy + clickOffsetY);
        // Зажимаем координаты в границы первичного экрана
        const b = await getPrimaryScreenBounds();
        const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
        const axClamped = clamp(targetAx, b.x, b.x + Math.max(0, b.width - 1));
        const ayClamped = clamp(targetAy, b.y, b.y + Math.max(0, b.height - 1));
        const wasClamped = (axClamped !== targetAx) || (ayClamped !== targetAy);
        if (wasClamped) {
          Logger.info(`clamp: (${targetAx},${targetAy}) -> (${axClamped},${ayClamped}) within [${b.x},${b.y},${b.width}x${b.height}]`);
        }
        if ((settings.actions?.mode || 'powershell') === 'arduino') {
          // Arduino BIGMOVE — относительное перемещение от ТЕКУЩЕЙ позиции курсора.
          // Поэтому вычисляем дельты от текущего курсора, а не от центра экрана.
          const cur = await getCursorPos();
          const dx = Math.round(axClamped - cur.x);
          const dy = Math.round(ayClamped - cur.y);
          const distPx = Math.round(Math.sqrt(dx * dx + dy * dy));
          const id = ctx.targets!.indexOf(t);
          Logger.info(`chosenTarget(arduino): id=${id}, bbox=(${t.bbox.x},${t.bbox.y},${t.bbox.width},${t.bbox.height}), fromCursor dx=${dx}, dy=${dy}, distPx=${distPx}`);
          if (beforeMoveMs) await sleep(beforeMoveMs);
          await actions.bigMove(dx, dy);
          if (afterMoveMs) await sleep(afterMoveMs);
          if (beforeClickMs) await sleep(beforeClickMs);
          await actions.click();
          if (afterClickMs) await sleep(afterClickMs);
        } else {
          if (beforeMoveMs) await sleep(beforeMoveMs);
          // Для PowerShell/robotjs — абсолютные координаты экрана
          Logger.info(`chosenTarget(powershell): abs=(${axClamped},${ayClamped}) bbox=(${t.bbox.x},${t.bbox.y},${t.bbox.width},${t.bbox.height})`);
          await actions.moveMouseSmooth(axClamped, ayClamped);
          if (afterMoveMs) await sleep(afterMoveMs);
          if (beforeClickMs) await sleep(beforeClickMs);
          await actions.mouseClick();
          if (afterClickMs) await sleep(afterClickMs);
        }
      } catch (e) {
        Logger.error(`TargetState: ошибка эмуляции действий: ${(e as Error).message}`);
      }
    }
  }

  async execute(ctx: IStateContext) {
    // После первичного клика переходим в боевое состояние (без повторных ЛКМ)
    const { LockedCombatState } = await import('./LockedCombatState');
    return new LockedCombatState();
  }

  async exit(): Promise<void> {}
}

function selectClosestToCenter(targets: IStateContext['targets'], cx: number, cy: number) {
  if (!targets || targets.length === 0) throw new Error('No targets');
  let best = targets[0];
  let bestD = Number.MAX_SAFE_INTEGER;
  for (const t of targets) {
    const dx = t.cx - cx; const dy = t.cy - cy; const d2 = dx*dx + dy*dy;
    if (d2 < bestD) { bestD = d2; best = t; }
  }
  return best;
}

async function getCursorPos(): Promise<{ x: number; y: number }> {
  const ps = `Add-Type @"
using System;using System.Runtime.InteropServices;public class U{[DllImport("user32.dll")]public static extern bool GetCursorPos(out POINT p);public struct POINT{public int X;public int Y;}}
"@;$p=New-Object U+POINT;[U]::GetCursorPos([ref]$p)|Out-Null;Write-Output "$($p.X),$($p.Y)"`;
  const line = await runPwshCapture(ps);
  const [x,y] = (line||'').trim().split(',').map(n=>parseInt(n,10));
  return { x: x||0, y: y||0 };
}

async function getPrimaryScreenCenter(): Promise<{ x: number; y: number }> {
  const ps = `Add-Type -AssemblyName System.Windows.Forms;[void][System.Windows.Forms.Application]::EnableVisualStyles();$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;Write-Output "$($b.X + [int]($b.Width/2)),$($b.Y + [int]($b.Height/2))"`;
  const line = await runPwshCapture(ps);
  const [x,y] = (line||'').trim().split(',').map(n=>parseInt(n,10));
  return { x: x||0, y: y||0 };
}

async function getPrimaryScreenBounds(): Promise<{ x: number; y: number; width: number; height: number }> {
  const ps = `Add-Type -AssemblyName System.Windows.Forms;[void][System.Windows.Forms.Application]::EnableVisualStyles();$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;Write-Output "$($b.X),$($b.Y),$($b.Width),$($b.Height)"`;
  const line = await runPwshCapture(ps);
  const [x,y,w,h] = (line||'').trim().split(',').map(n=>parseInt(n,10));
  return { x: x||0, y: y||0, width: w||0, height: h||0 };
}

function runPwshCapture(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', cmd], { windowsHide: true });
    let out = ''; let err = '';
    ps.stdout.on('data', d => out += d.toString());
    ps.stderr.on('data', d => err += d.toString());
    ps.on('error', reject);
    ps.on('close', code => code===0 ? resolve(out.trim()) : reject(new Error(err||`pwsh exited ${code}`)));
  });
}
