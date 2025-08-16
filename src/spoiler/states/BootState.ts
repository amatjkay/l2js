import { IState, IStateContext } from '../State';
import { ScanState } from './ScanState';

export class BootState implements IState {
  name = 'BootState';

  async enter(ctx: IStateContext): Promise<void> {
    ctx.log(`[${this.name}] enter`);
  }

  async execute(ctx: IStateContext): Promise<IState | void> {
    ctx.log(`[${this.name}] execute`);
    // TODO: сюда можно добавить первичные проверки окна игры/ресурсов
    // Переходим к сканированию экрана
    return new ScanState();
  }

  async exit(ctx: IStateContext): Promise<void> {
    ctx.log(`[${this.name}] exit`);
  }
}
