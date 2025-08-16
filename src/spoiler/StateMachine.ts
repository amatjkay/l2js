import { IState, IStateContext } from './State';

export class StateMachine {
  private current: IState | null = null;
  private readonly ctx: IStateContext;

  constructor(initial: IState, ctx: IStateContext) {
    this.current = initial;
    this.ctx = ctx;
  }

  async start(maxSteps = 100): Promise<void> {
    let steps = 0;
    while (this.current && steps < maxSteps) {
      if (steps === 0) {
        await this.current.enter?.(this.ctx);
      }
      const next = await this.current.execute(this.ctx);
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
