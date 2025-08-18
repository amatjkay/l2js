import { IState, IStateContext } from '../State';
import { scanForTargets } from '../../core/Scan';
import { createLogger } from '../../core/Logger';
import { TargetState } from './TargetState';
import { IdleState } from './IdleState';
import { loadSettings } from '../../core/Config';
import { Actions } from '../../core/Actions';

const Logger = createLogger();

/**
 * ScanState: выполняет сканирование экрана и сохраняет найденные цели в контекст.
 */
export class ScanState implements IState {
  name = 'ScanState';

  async enter(ctx: IStateContext): Promise<void> {
    const start = Date.now();
    ctx.targets = await scanForTargets();
    const duration = Date.now() - start;
    Logger.info(`ScanState: найдено ${ctx.targets.length} целей за ${duration} ms`);
  }

  async execute(ctx: IStateContext): Promise<IState> {
    if (ctx.targets && ctx.targets.length > 0) {
      Logger.info(`ScanState: переход в TargetState (targets=${ctx.targets.length})`);
      return new TargetState();
    } else {
      Logger.info('ScanState: целей нет');
      const settings = loadSettings();
      const actionsCfg = settings.actions || {};
      if (actionsCfg.enableActions && (actionsCfg.mode || 'powershell') === 'arduino') {
        const actions = new Actions(actionsCfg);
        // 360° круг в одну сторону с небольшими паузами, затем скролл-ап и повтор, затем скролл-даун и повтор
        const cam = actionsCfg.camera || {};
        const scale = (typeof cam.scale === 'number' && isFinite(cam.scale)) ? Math.max(0.1, cam.scale) : 1;
        const stepDxBase = Math.max(1, Math.floor(cam.dxStep ?? 120));
        const stepDx = stepDxBase * scale; // фиксированное направление вправо
        const steps = Math.max(6, Math.floor(cam.circleSteps ?? 36));
        const stepPauseMs = Math.max(50, Math.floor(cam.stepPauseMs ?? 120));
        const sweepPauseMs = Math.max(100, Math.floor(cam.sweepPauseMs ?? 500));
        const scrollUp = (typeof cam.scrollUpAmount === 'number') ? cam.scrollUpAmount : 1;
        const scrollDown = (typeof cam.scrollDownAmount === 'number') ? cam.scrollDownAmount : -1;
        const scrollRandom = !!(cam as any).scrollRandom;
        const scrollMin = Math.max(1, Math.floor(((cam as any).scrollMin ?? 1)));
        const scrollMax = Math.max(scrollMin, Math.floor(((cam as any).scrollMax ?? 15)));

        // helper: один полный круг с проверкой целей на каждом шаге
        const doSweep = async (label: string): Promise<boolean> => {
          // random tilt per STEP
          const tiltMax = (typeof cam.tiltDyMax === 'number' && isFinite(cam.tiltDyMax)) ? Math.max(0, Math.floor(cam.tiltDyMax)) : 0;
          Logger.info(`ScanState: starting sweep: ${label}; stepDx=${Math.round(stepDx)}, steps=${steps}, stepPauseMs=${stepPauseMs}, tiltDyMax=${tiltMax} (per-step)`);
          for (let i = 0; i < steps; i++) {
            const dyTilt = tiltMax > 0 ? (Math.floor(Math.random() * (2 * tiltMax + 1)) - tiltMax) : 0;
            try {
              await actions.cameraRotate(stepDx, dyTilt);
            } catch (e) {
              Logger.error(`ScanState: ошибка cameraRotate: ${(e as Error).message}`);
            }
            await new Promise(r => setTimeout(r, stepPauseMs));
            // проверяем цели после шага
            const t0 = Date.now();
            const targets = await scanForTargets();
            const dt = Date.now() - t0;
            Logger.info(`ScanState: after step ${i+1}/${steps} scan -> targets=${targets.length} time=${dt}ms (dy=${dyTilt})`);
            if (targets.length > 0) { ctx.targets = targets; return true; }
          }
          await new Promise(r => setTimeout(r, sweepPauseMs));
          return false;
        };

        // Бесконечный цикл: plain → scroll up → plain → scroll down → ... до появления целей
        while (true) {
          if (await doSweep('plain')) { Logger.info('ScanState: цели найдены во время plain-сектора'); return new TargetState(); }
          try {
            if (scrollRandom) {
              const amount = Math.floor(Math.random() * (scrollMax - scrollMin + 1)) + scrollMin;
              const dir = Math.random() < 0.5 ? -1 : 1; // -1 = down, +1 = up
              await actions.scroll(dir * amount);
              Logger.info(`ScanState: scroll random dir=${dir>0?'up':'down'} amount=${amount}`);
            } else {
              await actions.scroll(scrollUp);
              Logger.info(`ScanState: scroll up (${scrollUp})`);
            }
          } catch (e) { Logger.warn(`ScanState: scroll up error: ${(e as Error).message}`); }
          if (await doSweep('after scroll up')) { Logger.info('ScanState: цели найдены после scroll up'); return new TargetState(); }
          if (await doSweep('plain-2')) { Logger.info('ScanState: цели найдены во время plain-2'); return new TargetState(); }
          try {
            if (scrollRandom) {
              const amount = Math.floor(Math.random() * (scrollMax - scrollMin + 1)) + scrollMin;
              const dir = Math.random() < 0.5 ? -1 : 1;
              await actions.scroll(dir * amount);
              Logger.info(`ScanState: scroll random dir=${dir>0?'up':'down'} amount=${amount}`);
            } else {
              await actions.scroll(scrollDown);
              Logger.info(`ScanState: scroll down (${scrollDown})`);
            }
          } catch (e) { Logger.warn(`ScanState: scroll down error: ${(e as Error).message}`); }
          if (await doSweep('after scroll down')) { Logger.info('ScanState: цели найдены после scroll down'); return new TargetState(); }
        }
      }
      Logger.info('ScanState: действий нет или не arduino — переход в IdleState');
      return new IdleState();
    }
  }

  async exit(): Promise<void> {}
}
