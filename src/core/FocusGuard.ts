import { isGameActive, GameWindowMatch } from './WinWindow';
import { createLogger } from './Logger';

const log = createLogger();

// Defaults based on user's data: title 'LU4', process 'lu4.bin'
const defaultMatch: GameWindowMatch = {
  titleRegex: '^LU4',
  // processName in Get-Process is usually without extension; keep loose
  processName: 'lu4',
};

export async function ensureGameActive(match: Partial<GameWindowMatch> = {}): Promise<boolean> {
  const m: GameWindowMatch = { ...defaultMatch, ...match } as GameWindowMatch;
  const ok = await isGameActive(m);
  if (!ok) {
    log.warn('Game window is not active. Skip action. Expected titleRegex=%s processName=%s', m.titleRegex, m.processName);
  }
  return ok;
}

export async function guard<T>(actionName: string, fn: () => Promise<T>, match: Partial<GameWindowMatch> = {}): Promise<T | null> {
  const ok = await ensureGameActive(match);
  if (!ok) return null;
  try {
    const res = await fn();
    return res;
  } catch (e) {
    log.error('Action %s failed: %s', actionName, (e as Error).message);
    throw e;
  }
}
