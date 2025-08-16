import { IState, IStateContext } from '../State';
import { scanForTargets } from '../../core/Scan';
import { createLogger } from '../../core/Logger';
import { TargetState } from './TargetState';
import { IdleState } from './IdleState';

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

  async execute(ctx: IStateContext) {
    if (ctx.targets && ctx.targets.length > 0) {
      Logger.info(`ScanState: переход в TargetState (targets=${ctx.targets.length})`);
      return new TargetState();
    } else {
      Logger.info('ScanState: целей нет — переход в IdleState');
      return new IdleState();
    }
  }

  async exit(): Promise<void> {}
}
