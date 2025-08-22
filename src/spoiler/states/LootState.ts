import { IState, IStateContext } from '../State';
import { createLogger } from '../../core/Logger';
import { loadSettings } from '../../core/Config';
import { Actions } from '../../core/Actions';

const Logger = createLogger();
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type Deps = {
  pressLoot: () => Promise<void>;
  lootTries: number;
  lootDelay: number;
};

export class LootState implements IState {
  name = 'LootState';
  private deps?: Deps;

  constructor(deps?: Partial<Deps>) {
    if (deps) this.deps = deps as Deps;
  }

  async enter(ctx: IStateContext): Promise<void> {
    if (!this.deps) {
      const settings = loadSettings();
      const actionsCfg = settings.actions || {};
      const combat = (settings as any).combat || {};
      const lootKey = String(combat.lootKey || '4');
      const lootTries = Math.max(1, Number(combat.lootMaxTries ?? 3));
      const lootDelay = Math.max(0, Number(combat.lootEveryMs ?? 300));
      const actions = new Actions(actionsCfg);
      this.deps = {
        pressLoot: () => actions.pressKey(lootKey),
        lootTries,
        lootDelay,
      };
    }

    const d = this.deps!;
    Logger.info(`LootState: LOOT x${d.lootTries}`);
    for (let i = 0; i < d.lootTries; i++) {
      try { await d.pressLoot(); } catch {}
      if (i < d.lootTries - 1 && d.lootDelay) await sleep(d.lootDelay);
    }
    // Сброс флага спойла перед возвращением к поиску
    ctx.spoiled = false;
  }

  async execute(ctx: IStateContext) {
    const { ScanState } = await import('./ScanState');
    return new ScanState();
  }

  async exit(): Promise<void> {}
}
