import { IState, IStateContext } from './State';

export class StateMachine {
  private current: IState | null = null;
  private readonly ctx: IStateContext;
  private stopped = false;

  constructor(initial: IState, ctx: IStateContext) {
    this.current = initial;
    this.ctx = ctx;
  }

  /** Request graceful stop. The machine will finish current execute() and then exit the loop. */
  stop(): void {
    this.stopped = true;
  }

  async start(maxSteps = 100): Promise<void> {
    let steps = 0;
    while (this.current && steps < maxSteps && !this.stopped) {
      if (steps === 0) {
        await this.current.enter?.(this.ctx);
      }
      const next = await this.current.execute(this.ctx);
      if (this.stopped) { break; }
      if (next && next !== this.current) {
        await this.current.exit?.(this.ctx);
        this.current = next;
        await this.current.enter?.(this.ctx);
      } else if (!next) {
        // No transition requested; stop
        break;
      }
      steps++;
    }
  }
}
