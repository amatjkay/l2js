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
        // Параметризованный случайный поворот камеры по горизонтали
        const cam = actionsCfg.camera || {};
        const dxMin = Math.max(1, Math.floor(cam.dxMin ?? 80));
        const dxMax = Math.max(dxMin, Math.floor(cam.dxMax ?? 160));
        const amp = dxMin + Math.floor(Math.random() * (dxMax - dxMin + 1));
        const dx = (Math.random() < 0.5 ? -1 : 1) * amp;
        try {
          await actions.cameraRotate(dx, 0);
          // Дадим сцене стабилизироваться перед повторным сканированием
          const pauseMs = Math.max(0, Math.floor(cam.pauseMs ?? 150));
          await new Promise(r => setTimeout(r, pauseMs));
        } catch (e) {
          Logger.error(`ScanState: ошибка cameraRotate: ${(e as Error).message}`);
        }
        Logger.info('ScanState: повторное сканирование после поворота камеры');
        return new ScanState();
      }
      Logger.info('ScanState: действий нет или не arduino — переход в IdleState');
      return new IdleState();
    }
  }

  async exit(): Promise<void> {}
}
