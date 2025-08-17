import { getActiveWindowInfo, matchGameWindowVerbose, GameWindowMatch } from '../src/core/WinWindow';
import { loadSettings } from '../src/core/Config';

(async () => {
  try {
    const info = await getActiveWindowInfo();
    console.log(`[Diag] Active window info:`);
    console.log(`  title="${info.title}"`);
    console.log(`  processName=${info.processName || 'null'}`);
    console.log(`  processFile=${info.processFile || 'null'}`);
    console.log(`  className=${info.className || 'null'}`);
    console.log(`  hwnd=${String(info.hwnd ?? 'null')}`);

    const settings = loadSettings();
    const wm = (settings.actions?.windowMatch ?? []) as Partial<GameWindowMatch> | Partial<GameWindowMatch>[];
    const list: GameWindowMatch[] = Array.isArray(wm) ? (wm as GameWindowMatch[]) : ([wm as GameWindowMatch]);
    if (!list.length) {
      console.log('[Diag] actions.windowMatch is empty');
    } else {
      console.log(`[Diag] Checking ${list.length} windowMatch alternatives (OR):`);
      list.forEach((m, idx) => {
        const r = matchGameWindowVerbose(info, m as GameWindowMatch);
        console.log(`  [${idx}] => ${r.ok ? 'TRUE' : 'false'} (${r.reason}) | ${JSON.stringify(m)}`);
      });
    }
  } catch (e) {
    console.error(`[Diag] Failed to get active window info: ${(e as Error).message}`);
    process.exit(1);
  }
})();
