import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { IdleState } from './IdleState';
import { loadSettings } from '../../core/Config';
import { Actions } from '../../core/Actions';
import { spawn } from 'child_process';

const Logger = createLogger();
const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

export class TargetState implements IState {
  name = 'TargetState';

  async enter(ctx: IStateContext): Promise<void> {
    const count = ctx.targets?.length ?? 0;
    Logger.info(`TargetState: получено целей=${count}`);
    if (count > 0) {
      // Выбор точки отсчёта из настроек: центр экрана или позиция курсора
      const settings = loadSettings();
      const refMode = settings.cv?.selection?.referencePoint || 'screenCenter';
      const ref = refMode === 'cursorPosition' ? await getCursorPos() : await getPrimaryScreenCenter();
      const t = selectClosestToCenter(ctx.targets!, ref.x, ref.y);

      const dx = Math.round(t.cx - ref.x);
      // Смещение курсора вниз перед кликом для повышения точности попадания
      const clickOffsetY = Math.round(settings.actions?.clickOffsetY ?? 35);
      const dy = Math.round((t.cy + clickOffsetY) - ref.y);
      const distPx = Math.round(Math.sqrt(dx * dx + dy * dy));
      const id = ctx.targets!.indexOf(t);
      Logger.info(`chosenTarget: id=${id}, bbox=(${t.bbox.x},${t.bbox.y},${t.bbox.width},${t.bbox.height}), distPx=${distPx}, dx=${dx}, dy=${dy}`);

      // Наведение и клик по центру цели (если actions.enableActions=true)
      const actions = new Actions(settings.actions || {});
      const delays = settings.actions?.delays || {};
      const beforeMoveMs = Math.max(0, Math.floor(delays.beforeMoveMs ?? 0));
      const afterMoveMs = Math.max(0, Math.floor(delays.afterMoveMs ?? 70));
      const beforeClickMs = Math.max(0, Math.floor(delays.beforeClickMs ?? 30));
      const afterClickMs = Math.max(0, Math.floor(delays.afterClickMs ?? 70));
      try {
        if ((settings.actions?.mode || 'powershell') === 'arduino') {
          if (beforeMoveMs) await sleep(beforeMoveMs);
          await actions.bigMove(dx, dy);
          if (afterMoveMs) await sleep(afterMoveMs);
          if (beforeClickMs) await sleep(beforeClickMs);
          await actions.click();
          if (afterClickMs) await sleep(afterClickMs);
        } else {
          if (beforeMoveMs) await sleep(beforeMoveMs);
          // Для PowerShell/robotjs режима — двигаем сразу на абсолютные координаты с учётом смещения
          await actions.moveMouseSmooth(t.cx, t.cy + clickOffsetY);
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
    // Заглушка: здесь будет наведение/действие. Пока возвращаемся к IdleState для повторного сканирования.
    return new IdleState();
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
