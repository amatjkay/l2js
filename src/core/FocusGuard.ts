import { isGameActive, GameWindowMatch, getActiveWindowInfo } from './WinWindow';
import { createLogger } from './Logger';

const log = createLogger();

// Defaults based on user's data: title 'LU4', process file 'lu4.bin'
const defaultMatch: GameWindowMatch = {
  titleRegex: '^LU4',
  processFileExact: 'lu4.bin',
};

export async function ensureGameActive(match: Partial<GameWindowMatch> = {}): Promise<boolean> {
  const m: GameWindowMatch = { ...defaultMatch, ...match } as GameWindowMatch;
  const ok = await isGameActive(m);
  if (!ok) {
    const info = await getActiveWindowInfo();
    log.warn(
      'Game window is not active. Skip action. Expected titleRegex=%s processFileExact=%s; active: title="%s" processFile=%s className=%s hwnd=%s',
      m.titleRegex,
      m.processFileExact,
      info.title,
      info.processFile || 'null',
      info.className || 'null',
      String(info.hwnd ?? 'null'),
    );
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
