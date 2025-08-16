import winston from 'winston';
import path from 'path';
import fs from 'fs';

const LOG_DIR = path.resolve(process.cwd(), 'logs');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

export function pruneOldLogs(minutes = 10) {
  ensureLogDir();
  const cutoff = Date.now() - minutes * 60_000;
  for (const file of fs.readdirSync(LOG_DIR)) {
    const full = path.join(LOG_DIR, file);
    try {
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    } catch {}
  }
}

export function createLogger() {
  ensureLogDir();
  pruneOldLogs(10);

  const timestamp = winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' });
  const printfFmt = winston.format.printf((info: winston.Logform.TransformableInfo) => {
    const level = String(info.level || '').toUpperCase();
    const ts = (info as any).timestamp ?? new Date().toISOString();
    const msg = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
    return `${ts} [${level}] ${msg}`;
  });

  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(timestamp, printfFmt),
    transports: [
      new winston.transports.Console(),
      new winston.transports.File({ filename: path.join(LOG_DIR, 'app.log'), maxsize: 5 * 1024 * 1024, maxFiles: 3 }),
    ],
  });

  return logger;
}

export type AppLogger = ReturnType<typeof createLogger>;
