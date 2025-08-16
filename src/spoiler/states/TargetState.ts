import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { IdleState } from './IdleState';

const Logger = createLogger();

export class TargetState implements IState {
  name = 'TargetState';

  async enter(ctx: IStateContext): Promise<void> {
    const count = ctx.targets?.length ?? 0;
    Logger.info(`TargetState: получено целей=${count}`);
    if (count > 0) {
      const t = ctx.targets[0];
      Logger.info(
        `TargetState: top target bbox=(${t.bbox.x},${t.bbox.y},${t.bbox.width},${t.bbox.height}), area=${t.area.toFixed(
          0
        )}, center=(${t.cx.toFixed(1)}, ${t.cy.toFixed(1)})`
      );
    }
  }

  async execute(ctx: IStateContext) {
    // Заглушка: здесь будет наведение/действие. Пока возвращаемся к IdleState для повторного сканирования.
    return new IdleState();
  }

  async exit(): Promise<void> {}
}
