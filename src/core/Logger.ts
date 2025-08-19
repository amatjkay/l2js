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
      // Никогда не трогаем текущий агрегированный файл логов
      if (file === 'app.log') continue;
      const stat = fs.statSync(full);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.unlinkSync(full);
      }
    } catch (e) {
      // Игнорируем ошибки прав доступа/удаления
      // Это безопасно, т.к. чистка логов — best-effort
    }
  }
}

export function createLogger() {
  ensureLogDir();
  // Принудительную чистку отключаем здесь, чтобы исключить гонки между несколькими процессами
  // Пользователь может запустить скрипты параллельно. Оставим отдельной утилите/планировщику.

  const timestamp = winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' });
  const printfFmt = winston.format.printf((info: winston.Logform.TransformableInfo) => {
    const level = String(info.level || '').toUpperCase();
    const ts = (info as any).timestamp ?? new Date().toISOString();
    const msg = typeof info.message === 'string' ? info.message : JSON.stringify(info.message);
    return `${ts} [${level}] ${msg}`;
  });

  const transports: winston.transport[] = [ new winston.transports.Console() ];

  const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(timestamp, printfFmt),
    transports,
  });

  return logger;
}

export type AppLogger = ReturnType<typeof createLogger>;
