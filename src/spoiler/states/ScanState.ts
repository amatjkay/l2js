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
        const stepPauseMs = Math.max(0, Math.floor(((cam as any).stepPauseMs ?? 200)));
        const stepPauseMultiplier = Math.max(1, Math.floor(((cam as any).stepPauseMultiplier ?? 1)));
        const sweepPauseMs = Math.max(0, Math.floor(((cam as any).sweepPauseMs ?? 300)));
        const dxMin = Math.floor(((cam as any).dxMin ?? 200));
        const dxMax = Math.max(dxMin, Math.floor(((cam as any).dxMax ?? 260)));
        const steps = Math.max(1, Math.floor(((cam as any).circleSteps ?? 20)));
        const scrollUp = Math.floor(((cam as any).scrollUpAmount ?? 1));
        const scrollDown = Math.floor(((cam as any).scrollDownAmount ?? -1));
        const scrollRandom = !!((cam as any).scrollRandom ?? false);
        const scrollPerStep = !!((cam as any).scrollPerStep ?? false);
        const scrollMin = Math.max(1, Math.floor(((cam as any).scrollMin ?? 1)));
        const scrollMax = Math.max(scrollMin, Math.floor(((cam as any).scrollMax ?? 15)));

        // helper: один полный круг с проверкой целей на каждом шаге
        // cumulative vertical drift to make tilt clearly visible
        let dyDrift = 0;
        const doSweep = async (label: string): Promise<boolean> => {
          // random tilt per STEP with cumulative drift
          const tiltMax = (typeof cam.tiltDyMax === 'number' && isFinite(cam.tiltDyMax)) ? Math.max(0, Math.floor(cam.tiltDyMax)) : 0;
          Logger.info(`ScanState: starting sweep: ${label}; stepDx=${Math.round(stepDx)}, steps=${steps}, stepPauseMs=${stepPauseMs}, tiltDyMax=${tiltMax} (drift)`);
          for (let i = 0; i < steps; i++) {
            let dyTilt = 0;
            if (tiltMax > 0) {
              const delta = Math.floor(Math.random() * (2 * tiltMax + 1)) - tiltMax; // [-tiltMax..+tiltMax]
              dyDrift = Math.max(-tiltMax, Math.min(tiltMax, dyDrift + delta));
              // ensure non-zero and not too tiny to be invisible
              const abs = Math.max(5, Math.min(tiltMax, Math.abs(dyDrift)));
              dyTilt = dyDrift === 0 ? (Math.random() < 0.5 ? -abs : abs) : (dyDrift > 0 ? abs : -abs);
            }
            try {
              await actions.cameraRotate(stepDx, dyTilt);
            } catch (e) {
              Logger.error(`ScanState: ошибка cameraRotate: ${(e as Error).message}`);
            }
            // optional per-step scroll
            if (scrollPerStep) {
              try {
                if (scrollRandom) {
                  const amount = Math.floor(Math.random() * (scrollMax - scrollMin + 1)) + scrollMin;
                  const dir = Math.random() < 0.5 ? -1 : 1;
                  await actions.scroll(dir * amount);
                  Logger.info(`ScanState: step ${i+1}/${steps} scroll dir=${dir>0?'up':'down'} amount=${amount}`);
                } else {
                  // alternate up/down each step if not random
                  const dir = (i % 2 === 0) ? 1 : -1;
                  const amount = dir > 0 ? Math.abs(scrollUp) : Math.abs(scrollDown);
                  await actions.scroll(dir > 0 ? scrollUp : scrollDown);
                  Logger.info(`ScanState: step ${i+1}/${steps} scroll ${dir>0?'up':'down'} amount=${amount}`);
                }
              } catch (e) { Logger.warn(`ScanState: per-step scroll error: ${(e as Error).message}`); }
            }
            await new Promise(r => setTimeout(r, stepPauseMs * stepPauseMultiplier));
            // проверяем цели после шага
            const t0 = Date.now();
            const targets = await scanForTargets();
            const dt = Date.now() - t0;
            Logger.info(`ScanState: after step ${i+1}/${steps} scan -> targets=${targets.length} time=${dt}ms (dy=${dyTilt}, drift=${dyDrift})`);
            if (targets.length > 0) { ctx.targets = targets; return true; }
          }
          await new Promise(r => setTimeout(r, sweepPauseMs));
          return false;
        };

        // Бесконечный цикл: plain → scroll up → plain → scroll down → ... до появления целей
        while (true) {
          if (await doSweep('plain')) { Logger.info('ScanState: цели найдены во время plain-сектора'); return new TargetState(); }
          try {
            Logger.info('ScanState: scroll phase (up/random) start');
            if (scrollRandom) {
              const amount = Math.floor(Math.random() * (scrollMax - scrollMin + 1)) + scrollMin;
              const dir = Math.random() < 0.5 ? -1 : 1; // -1 = down, +1 = up
              await actions.scroll(dir * amount);
              Logger.info(`ScanState: scroll random dir=${dir>0?'up':'down'} amount=${amount}`);
            } else {
              await actions.scroll(scrollUp);
              Logger.info(`ScanState: scroll up (${scrollUp})`);
            }
            await new Promise(r => setTimeout(r, 200));
            Logger.info('ScanState: scroll phase complete');
          } catch (e) { Logger.warn(`ScanState: scroll up error: ${(e as Error).message}`); }
          if (await doSweep('after scroll up')) { Logger.info('ScanState: цели найдены после scroll up'); return new TargetState(); }
          if (await doSweep('plain-2')) { Logger.info('ScanState: цели найдены во время plain-2'); return new TargetState(); }
          try {
            Logger.info('ScanState: scroll phase (down/random) start');
            if (scrollRandom) {
              const amount = Math.floor(Math.random() * (scrollMax - scrollMin + 1)) + scrollMin;
              const dir = Math.random() < 0.5 ? -1 : 1;
              await actions.scroll(dir * amount);
              Logger.info(`ScanState: scroll random dir=${dir>0?'up':'down'} amount=${amount}`);
            } else {
              await actions.scroll(scrollDown);
              Logger.info(`ScanState: scroll down (${scrollDown})`);
            }
            await new Promise(r => setTimeout(r, 200));
            Logger.info('ScanState: scroll phase complete');
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
