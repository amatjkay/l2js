import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { ScanState } from './ScanState';

const Logger = createLogger();

export class IdleState implements IState {
  name = 'IdleState';

  async enter(ctx: IStateContext): Promise<void> {
    ctx.log(`[${this.name}] enter`);
  }

  async execute(ctx: IStateContext) {
    Logger.info('IdleState: повтор сканирования');
    return new ScanState();
  }

  async exit(ctx: IStateContext): Promise<void> {
    ctx.log(`[${this.name}] exit`);
  }
}
