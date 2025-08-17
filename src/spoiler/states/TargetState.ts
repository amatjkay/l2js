import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { IdleState } from './IdleState';
import { loadSettings } from '../../core/Config';
import { Actions } from '../../core/Actions';

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

      // Наведение и клик по центру цели (если actions.enableActions=true)
      const settings = loadSettings();
      const actions = new Actions(settings.actions || {});
      try {
        await actions.moveMouseSmooth(t.cx, t.cy);
        await actions.mouseClick();
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
