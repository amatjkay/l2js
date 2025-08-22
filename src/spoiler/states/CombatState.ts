import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { loadSettings } from '../../core/Config';
import { Actions } from '../../core/Actions';
import { isTargetSelectedAlive } from '../../core/TargetBar';
import { ensureGameActive } from '../../core/FocusGuard';

const Logger = createLogger();

type Deps = {
  checkAlive: () => Promise<boolean>;
  pressAttack: () => Promise<void>;
  attackIntervalMs: number;
};

export class CombatState implements IState {
  name = 'CombatState';
  private deps?: Deps;
  private lastAttackAt = 0;

  constructor(deps?: Partial<Deps>) {
    if (deps) {
      this.deps = deps as Deps;
    }
  }

  async enter(ctx: IStateContext): Promise<void> {
    if (!this.deps) {
      const settings = loadSettings();
      const combat = (settings as any).combat || {};
      const actionsCfg = settings.actions || {};
      const attackKey = String(combat.attackKey || '2');
      const attackIntervalMs = Math.max(0, Number(combat.attackEveryMs ?? 500));
      const actions = new Actions(actionsCfg);
      this.deps = {
        checkAlive: () => isTargetSelectedAlive(),
        pressAttack: () => actions.pressKey(attackKey),
        attackIntervalMs,
      };
    }
    const ok = await ensureGameActive();
    if (!ok) {
      Logger.warn('CombatState: окно игры не активно');
    }
    this.lastAttackAt = 0;
  }

  async execute(ctx: IStateContext): Promise<IState | undefined> {
    const deps = this.deps!;
    let alive = false;
    try {
      alive = await deps.checkAlive();
    } catch (e) {
      Logger.debug(`CombatState: checkAlive error: ${(e as Error).message}`);
      alive = false;
    }

    if (!alive) {
      // Цель мертва/не выбрана
      if (ctx.spoiled) {
        try {
          const { SweepState } = await import('./SweepState');
          return new SweepState();
        } catch {
          Logger.info('CombatState: SweepState отсутствует, возврат в ScanState');
          const { ScanState } = await import('./ScanState');
          return new ScanState();
        }
      } else {
        const { ScanState } = await import('./ScanState');
        return new ScanState();
      }
    }

    const now = Date.now();
    if (now - this.lastAttackAt >= deps.attackIntervalMs) {
      try {
        await deps.pressAttack();
      } catch (e) {
        Logger.debug(`CombatState: pressAttack error: ${(e as Error).message}`);
      }
      this.lastAttackAt = now;
    }

    // Остаёмся в этом состоянии
    return this;
  }

  async exit(): Promise<void> {}
}
