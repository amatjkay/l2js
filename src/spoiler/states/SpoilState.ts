import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { loadSettings } from '../../core/Config';
import { Actions } from '../../core/Actions';
import { isTargetSelectedAlive } from '../../core/TargetBar';
import { ensureGameActive } from '../../core/FocusGuard';

const Logger = createLogger();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * SpoilState: минимальная первая интеграция спойла.
 * Шаг 1: ATTACK -> SPOIL (одна попытка), отметка spoiled=true, переход в LockedCombatState.
 * Дальнейшие повторы, чат/OCR и лимиты добавим на следующем шаге.
 */
export class SpoilState implements IState {
  name = 'SpoilState';

  async enter(ctx: IStateContext): Promise<void> {
    const settings = loadSettings();
    const actionsCfg = settings.actions || {};
    const combat = (settings as any).combat || {};

    // Бинды по умолчанию: 2 = ATTACK, 1 = SPOIL (можно переопределить в settings.combat)
    const attackKey = String(combat.attackKey || '2');
    const spoilCombo: string[] = Array.isArray(combat.spoilCombo) && combat.spoilCombo.length > 0
      ? combat.spoilCombo.map((k: any) => String(k))
      : ['1'];
    const spoilDelayMs = Math.max(0, Number(combat.spoilEveryMs ?? 600));
    const spoilMaxTries = Math.max(1, Number(combat.spoilMaxTries ?? 2));

    const actions = new Actions(actionsCfg);
    const ok = await ensureGameActive();
    if (!ok) { Logger.warn('SpoilState: окно игры не активно, отмена'); return; }

    try {
      // Быстрая проверка HP‑бара цели перед спойлом
      const alive = await isTargetSelectedAlive();
      if (!alive) {
        Logger.warn('SpoilState: HP‑бар цели не найден — пропускаем спойл');
        return;
      }
      Logger.info(`SpoilState: ATTACK(${attackKey}) -> SPOIL(${spoilCombo[0]}) x${spoilMaxTries}`);
      await actions.pressKey(attackKey);
      if (spoilDelayMs) await sleep(spoilDelayMs);
      for (let i = 0; i < spoilMaxTries; i++) {
        await actions.pressKey(spoilCombo[0]);
        ctx.spoiled = true; // оптимистичная отметка; точную верификацию добавим позже
        if (i < spoilMaxTries - 1 && spoilDelayMs) await sleep(spoilDelayMs);
      }
    } catch (e) {
      Logger.error(`SpoilState: ошибка при отправке клавиш: ${(e as Error).message}`);
    }
  }

  async execute(ctx: IStateContext) {
    // Если цель не подтверждена по HP‑бару — вернёмся к сканированию
    try {
      const alive = await isTargetSelectedAlive();
      if (!alive) {
        const { ScanState } = await import('./ScanState');
        return new ScanState();
      }
    } catch {}
    // Иначе — в боевое состояние (без повторных ЛКМ)
    const { CombatState } = await import('./CombatState');
    return new CombatState();
  }

  async exit(): Promise<void> {}
}
