import koffi from '@koffi/koffi';

// Basic types
const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// Constants
const SW_RESTORE = 9;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_QUERY_INFORMATION = 0x0400;
const PROCESS_VM_READ = 0x0010;

// Types
const HWND = koffi.pointer('void');
const HMODULE = koffi.pointer('void');
const HANDLE = koffi.pointer('void');
const LPWSTR = koffi.pointer('uint16_t');
const DWORD = 'uint32_t';
const INT = 'int';
const BOOL = 'int';
const LPVOID = koffi.pointer('void');

// Function declarations
const GetForegroundWindow = user32.func('HWND __stdcall GetForegroundWindow(void)');
const GetWindowTextW = user32.func('int __stdcall GetWindowTextW(HWND hWnd, wchar_t* lpString, int nMaxCount)');
const GetClassNameW = user32.func('int __stdcall GetClassNameW(HWND hWnd, wchar_t* lpClassName, int nMaxCount)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(HWND hWnd, uint32_t* lpdwProcessId)');
const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(HWND hWnd)');
const EnumWindows = user32.func('int __stdcall EnumWindows(void* lpEnumFunc, intptr_t lParam)');
const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(HWND hWnd)');
const ShowWindow = user32.func('int __stdcall ShowWindow(HWND hWnd, int nCmdShow)');

const OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32_t dwDesiredAccess, int bInheritHandle, uint32_t dwProcessId)');
const CloseHandle = kernel32.func('int __stdcall CloseHandle(void* hObject)');
const QueryFullProcessImageNameW = kernel32.func('int __stdcall QueryFullProcessImageNameW(void* hProcess, uint32_t dwFlags, wchar_t* lpExeName, uint32_t* lpdwSize)');

// Helper: read UTF-16LE string from buffer (terminated)
function readWString(buf: Buffer): string {
  // Find null terminator (2 bytes zero)
  for (let i = 0; i < buf.length; i += 2) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      return buf.slice(0, i).toString('utf16le');
    }
  }
  return buf.toString('utf16le');
}

export interface WindowInfo {
  hwnd: number;
  title: string;
  className: string;
  pid: number;
  processFile: string; // file name only
  processPath: string; // full path if available
}

function toNumberHwnd(ptr: Buffer): number {
  // HWND is a pointer; convert to uintptr number
  // Use Buffer.readBigUInt64LE if 64-bit, else readUInt32LE
  if (ptr.byteLength >= 8) {
    try { return Number((ptr as any).readBigUInt64LE(0)); } catch { /* fallback */ }
  }
  return ptr.readUInt32LE(0);
}

function getTitle(hwndPtr: Buffer): string {
  const buf = Buffer.alloc(512 * 2);
  GetWindowTextW(hwndPtr, buf, 512);
  return readWString(buf);
}

function getClass(hwndPtr: Buffer): string {
  const buf = Buffer.alloc(256 * 2);
  GetClassNameW(hwndPtr, buf, 256);
  return readWString(buf);
}

function getPid(hwndPtr: Buffer): number {
  const pidBuf = Buffer.alloc(4);
  GetWindowThreadProcessId(hwndPtr, pidBuf);
  return pidBuf.readUInt32LE(0);
}

function getProcessPath(pid: number): { path: string; file: string } {
  let h: Buffer | null = null;
  try {
    h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) as unknown as Buffer;
    if (!h) return { path: '', file: '' };
    const capBuf = Buffer.alloc(4);
    capBuf.writeUInt32LE(260, 0); // MAX_PATH initial
    let cap = capBuf.readUInt32LE(0);
    let out = Buffer.alloc(cap * 2);
    const ok = QueryFullProcessImageNameW(h, 0, out, capBuf);
    if (ok) {
      cap = capBuf.readUInt32LE(0);
      const s = readWString(out.slice(0, cap * 2));
      const file = s.split(/\\/).pop() || '';
      return { path: s, file };
    }
    // Fallback with larger buffer
    cap = 1024;
  }
}

export function getActiveWindowInfoNative(): WindowInfoNative | null {
  const out = runPs(['-Mode', 'active']);
  if (!out) return null;
  try {
    const j = JSON.parse(out) as any;
    if (!j.found) return null;
    return { hwnd: parseInt(String(j.hwnd).replace(/^0x/i, ''), 16) >>> 0, title: j.title, className: j.className, processFile: j.processName ?? null };
  } catch (e) {
    log.error(`WinNative.active parse error: ${String(e)} | out=${out}`);
    return null;
    if (IsWindowVisible(hWnd)) {
      const title = getTitle(hWnd);
      const className = getClass(hWnd);
      const pid = getPid(hWnd);
      const { path, file } = getProcessPath(pid);
      list.push({ hwnd: toNumberHwnd(hWnd), title, className, pid, processFile: file, processPath: path });
    }
  } catch {
    // ignore
  }
  return 1; // continue
});
let enumAccumulator: WindowInfo[] = [];

export function enumWindowsNative(): WindowInfo[] {
  enumAccumulator = [];
  EnumWindows(EnumWindowsProc, 0);
  return enumAccumulator.slice();
}

export function setForegroundWindow(hwnd: number): boolean {
  try {
    ShowWindow((koffi as any).as(hwnd, HWND), SW_RESTORE);
  } catch {}
  const ok = SetForegroundWindow((koffi as any).as(hwnd, HWND));
  return !!ok;
}

export interface FindCriteria {
  titleContains?: string; // e.g., 'LU4'
  classEquals?: string; // 'UnrealWindow'
  processNameContains?: string; // 'lu4'
  hwndEquals?: number; // 0x00040686
}

export function findGameWindow(criteria: FindCriteria): { found: boolean; info?: WindowInfo } {
  const list = enumWindowsNative();
  const titleNeedle = (criteria.titleContains || '').toLowerCase();
  const classEq = criteria.classEquals || '';
  const procNeedle = (criteria.processNameContains || '').toLowerCase();
  const wantHwnd = typeof criteria.hwndEquals === 'number' ? criteria.hwndEquals : -1;

  for (const w of list) {
    const byTitle = titleNeedle && w.title.toLowerCase().includes(titleNeedle);
    const byClass = classEq && w.className === classEq;
    const byProc = procNeedle && (w.processFile.toLowerCase().includes(procNeedle) || (w.processPath.toLowerCase().includes(procNeedle)));
    const byHwnd = wantHwnd > 0 && w.hwnd === wantHwnd;
    if (byTitle || byClass || byProc || byHwnd) {
      return { found: true, info: w };
    }
  }
  return { found: false };
}
