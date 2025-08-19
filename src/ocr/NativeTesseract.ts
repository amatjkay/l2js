import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export interface NativeOcrOptions {
  tesseractPath?: string; // full path to tesseract.exe or rely on PATH
  lang?: string; // e.g. 'eng' or 'eng+rus'
  psm?: number;  // page segmentation mode
  whitelist?: string; // tessedit_char_whitelist
  timeoutMs?: number; // kill process if exceeds
  mode?: 'text' | 'tsv'; // output parsing mode
}

export interface NativeOcrResult {
  text: string;
  confidence: number; // 0..100 (approx)
}

/** Resolve path to tesseract.exe. If not specified, try standard Windows install or PATH. */
function resolveTesseractPath(custom?: string): string {
  if (custom && fs.existsSync(custom)) return custom;
  const std = 'C:/Program Files/Tesseract-OCR/tesseract.exe';
  if (fs.existsSync(std)) return std;
  // fallback to PATH
  return 'tesseract';
}

export async function runNativeOcr(imagePath: string, opt: NativeOcrOptions = {}): Promise<NativeOcrResult> {
  const exe = resolveTesseractPath(opt.tesseractPath);
  const args: string[] = [];
  args.push(imagePath);
  args.push('stdout');
  if (opt.mode === 'tsv') args.push('tsv');
  if (typeof opt.psm === 'number') { args.push('--psm', String(opt.psm)); }
  if (opt.lang && opt.lang.trim()) { args.push('-l', opt.lang.trim()); }
  if (typeof opt.whitelist === 'string' && opt.whitelist.length > 0) {
    args.push('-c', `tessedit_char_whitelist=${opt.whitelist}`);
  }
  // default OEM 1 (LSTM only) is usually good
  args.push('--oem', '1');

  const proc = spawn(exe, args, { windowsHide: true });

  let stdout = '';
  let stderr = '';
  let killedByTimeout = false;

  const p = new Promise<NativeOcrResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      killedByTimeout = true;
      try { proc.kill(); } catch {}
    }, Math.max(100, opt.timeoutMs ?? 2000));

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on('close', (_code) => {
      clearTimeout(timer);
      if (killedByTimeout) {
        return resolve({ text: '', confidence: 0 });
      }
      try {
        if (opt.mode === 'tsv') {
          const { text, conf } = parseTsv(stdout);
          return resolve({ text, confidence: conf });
        }
        const text = (stdout || '').replace(/\r|\n/g, ' ').trim();
        // Confidence is not provided in plain text mode; return 0..100 based on a simple heuristic (length based)
        const conf = text ? Math.min(100, Math.max(30, text.length * 5)) : 0;
        return resolve({ text, confidence: conf });
      } catch (e) {
        return resolve({ text: '', confidence: 0 });
      }
    });
  });

  return p;
}

function parseTsv(tsv: string): { text: string; conf: number } {
  // Tesseract TSV columns: level, page_num, block_num, par_num, line_num, word_num, left, top, width, height, conf, text
  // We'll aggregate non-empty words and average their confidence.
  const lines = (tsv || '').split(/\r?\n/);
  let words: string[] = [];
  let confs: number[] = [];
  for (const line of lines) {
    if (!line || line.startsWith('level')) continue;
    const parts = line.split('\t');
    if (parts.length < 12) continue;
    const confStr = parts[10];
    const txt = parts[11] || '';
    if (!txt.trim()) continue;
    const conf = Number(confStr);
    if (!Number.isFinite(conf)) continue;
    words.push(txt.trim());
    confs.push(conf);
  }
  const text = words.join(' ');
  const conf = confs.length > 0 ? Math.round(confs.reduce((a, b) => a + b, 0) / confs.length) : 0;
  return { text, conf };
}
