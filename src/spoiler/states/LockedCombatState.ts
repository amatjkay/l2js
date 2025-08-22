import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { loadSettings } from '../../core/Config';
import { Actions } from '../../core/Actions';
import { ScanState } from './ScanState';
import { scanForTargets } from '../../core/Scan';

const Logger = createLogger();
const sleep = (ms: number) => new Promise<void>(res => setTimeout(res, ms));

/**
 * LockedCombatState
 * - Не выполняет повторных ЛКМ.
 * - Отрабатывает сценарий спойлера/скиллов с клавиатуры.
 * - Периодически проверяет наличие целей; при их отсутствии считает цель убитой и возвращается к скану.
 */
export class LockedCombatState implements IState {
  name = 'LockedCombatState';

  private lastSkillTime = 0;
  private lastSpoilTime = 0;

  async enter(ctx: IStateContext): Promise<void> {
    Logger.info('LockedCombatState: вход, цель захвачена — ЛКМ отключён, работаем клавишами.');
  }

  async execute(ctx: IStateContext): Promise<IState> {
    const settings = loadSettings();
    const actions = new Actions(settings.actions || {});

    // Пресеты клавиш: читаем из настроек, иначе дефолты
    const combat = (settings as any).combat || {};
    const spoilCombo: string[] = Array.isArray(combat.spoilCombo) ? combat.spoilCombo : ['F1'];
    const skillBar: string[] = Array.isArray(combat.skillBar) ? combat.skillBar : ['F2','F3'];
    const spoilEveryMs = Math.max(0, Math.floor(combat.spoilEveryMs ?? 2000));
    const skillEveryMs = Math.max(0, Math.floor(combat.skillEveryMs ?? 800));

    const now = Date.now();
    try {
      // Спойл по таймеру
      if (spoilEveryMs && (now - this.lastSpoilTime >= spoilEveryMs)) {
        for (const key of spoilCombo) { await actions.pressKey(key); await sleep(40); }
        this.lastSpoilTime = now;
        Logger.info(`LockedCombatState: spoil combo -> ${spoilCombo.join('+')}`);
      }
      // Скиллбар по таймеру
      if (skillEveryMs && (now - this.lastSkillTime >= skillEveryMs)) {
        for (const key of skillBar) { await actions.pressKey(key); await sleep(40); }
        this.lastSkillTime = now;
        Logger.info(`LockedCombatState: skill bar -> ${skillBar.join(' ')}`);
      }
    } catch (e) {
      Logger.warn(`LockedCombatState: ошибка отправки клавиш: ${(e as Error).message}`);
    }

    // Перескан: актуализируем цели. Если целей 0 — считаем, что цель умерла → к следующему скану
    try {
      const t0 = Date.now();
      const found = await scanForTargets();
      const dt = Date.now() - t0;
      ctx.targets = found;
      Logger.info(`LockedCombatState: rescan -> targets=${found.length} time=${dt}ms`);
      if (found.length === 0) {
        Logger.info('LockedCombatState: целей нет — переход к ScanState (цель вероятно умерла).');
        return new ScanState();
      }
    } catch (e) {
      Logger.warn(`LockedCombatState: rescan error: ${(e as Error).message}`);
    }

    // Остаёмся в бою
    await sleep(100);
    return this;
  }

  async exit(): Promise<void> {
    Logger.info('LockedCombatState: выход.');
  }
}
