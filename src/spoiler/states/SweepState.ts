import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { loadSettings } from '../../core/Config';
import { Actions } from '../../core/Actions';

const Logger = createLogger();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Минимальная реализация SweepState: нажать ключ свипа несколько раз и вернуться к ScanState.
 * Логику анализа чата и бэкоффов добавим позже.
 */
type Deps = {
  pressSweep: () => Promise<void>;
  sweepTries: number;
  sweepDelay: number;
  enableLoot: boolean;
};

export class SweepState implements IState {
  name = 'SweepState';
  private deps?: Deps;

  constructor(deps?: Partial<Deps>) {
    if (deps) this.deps = deps as Deps;
  }

  async enter(ctx: IStateContext): Promise<void> {
    if (!this.deps) {
      const settings = loadSettings();
      const actionsCfg = settings.actions || {};
      const combat = (settings as any).combat || {};
      const sweepKey = String(combat.sweepKey || '3');
      const sweepTries = Math.max(1, Number(combat.sweepMaxTries ?? 2));
      const sweepDelay = Math.max(0, Number(combat.sweepEveryMs ?? 400));
      const enableLoot = combat.enableLoot !== false; // по умолчанию true
      const actions = new Actions(actionsCfg);
      this.deps = {
        pressSweep: () => actions.pressKey(sweepKey),
        sweepTries,
        sweepDelay,
        enableLoot,
      };
    }

    const d = this.deps!;
    Logger.info(`SweepState: SWEEP x${d.sweepTries}`);
    for (let i = 0; i < d.sweepTries; i++) {
      try { await d.pressSweep(); } catch {}
      if (i < d.sweepTries - 1 && d.sweepDelay) await sleep(d.sweepDelay);
    }
  }

  async execute(ctx: IStateContext) {
    const d = this.deps!;
    if (d.enableLoot) {
      const { LootState } = await import('./LootState');
      return new LootState();
    }
    const { ScanState } = await import('./ScanState');
    return new ScanState();
  }

  async exit(): Promise<void> {}
}
