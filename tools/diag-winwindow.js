const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function getActiveViaPs() {
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve(__dirname, './diag-aw-ps.ps1')], { encoding: 'utf-8' });
  if (ps.error) return null;
  const line = (ps.stdout || '').trim().split(/\r?\n/).filter(Boolean).pop() || '';
  // Format: HWND=<num> PID=<num> TITLE=<text> CLASS=<text> NAME=<procname> FILE=<filename>
  const m = line.match(/HWND=(\d+) PID=(\d+) TITLE=(.*) CLASS=([^ ]+) NAME=([^ ]*) FILE=(.*)$/);
  if (!m) return null;
  const [, hwnd, pid, title, className, processName, file] = m;
  return { hwnd: Number(hwnd), pid: Number(pid), title: title.trim(), className: className.trim(), processName: (processName||'').trim(), processFile: (file||'').trim() };
}

(function main(){
  const settingsPath = path.resolve(__dirname, '../settings.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  const match = settings.actions?.windowMatch || {};
  const aw = getActiveViaPs() || {};
  const checks = {
    titleRegex: match.titleRegex ? new RegExp(match.titleRegex).test(aw.title || '') : true,
    titleEquals: match.titleEquals ? (aw.title || '') === match.titleEquals : true,
    classNameEquals: match.classNameEquals ? (aw.className || '') === match.classNameEquals : true,
    processFileExact: match.processFileExact ? (aw.processFile || '') === match.processFileExact : true,
    processNameEquals: match.processNameEquals ? (aw.processName || '') === match.processNameEquals : true,
  };
  const ok = Object.values(checks).every(Boolean);
  console.log(JSON.stringify({ active: aw, match, checks, ok }, null, 2));
})();
