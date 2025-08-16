import fs from 'fs';
import path from 'path';
import screenshot from 'screenshot-desktop';
import { PNG } from 'pngjs';

/**
 * Параметры сохранения скриншота на диск.
 */
export interface CaptureOptions {
  outputDir: string;
  format: 'png' | 'jpg';
  saveLastFrame: boolean;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Делает скриншот экрана и возвращает сырой буфер в указанном формате.
 * Используется для последующей декодировки и обработки.
 * @param format Формат изображения (png|jpg)
 */
export async function captureBuffer(format: 'png' | 'jpg' = 'png'): Promise<Buffer> {
  // Return raw screenshot buffer for further processing (e.g., PNG decode -> ImageData)
  const buf = await screenshot({ format });
  return buf as Buffer;
}

/**
 * Упрощённый аналог ImageData для Node.js (RGBA 8 бит на канал).
 */
export type ImageDataLike = { data: Uint8ClampedArray; width: number; height: number };

/**
 * Делает скриншот, декодирует PNG в RGBA и применяет кадрирование по ROI до формирования Mat.
 * Это уменьшает объём данных и ускоряет последующую обработку в OpenCV.
 * @param format Формат скриншота (png предпочтительнее: без потерь и альфа)
 * @param roi Регион интереса. При width/height == 0 возвращается полный кадр
 * @returns ImageData-подобный объект с массивом RGBA и размерами
 */
export async function captureImageData(
  format: 'png' | 'jpg' = 'png',
  roi?: { x: number; y: number; width: number; height: number }
): Promise<ImageDataLike> {
  const buf = await screenshot({ format });
  const png = PNG.sync.read(buf as Buffer);
  const src = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);

  // If ROI not specified or zero-sized -> use full frame
  if (!roi || roi.width === 0 || roi.height === 0) {
    return { data: src, width: png.width, height: png.height };
  }

  const { x, y, width, height } = roi;
  const clampedX = Math.max(0, Math.min(x, png.width - 1));
  const clampedY = Math.max(0, Math.min(y, png.height - 1));
  const clampedW = Math.max(1, Math.min(width, png.width - clampedX));
  const clampedH = Math.max(1, Math.min(height, png.height - clampedY));

  const out = new Uint8ClampedArray(clampedW * clampedH * 4);
  const srcStride = png.width * 4;
  const dstStride = clampedW * 4;
  // Построчно копируем полосы RGBA из исходного буфера в ROI-буфер
  for (let row = 0; row < clampedH; row++) {
    const srcStart = (clampedY + row) * srcStride + clampedX * 4;
    const dstStart = row * dstStride;
    out.set(src.subarray(srcStart, srcStart + dstStride), dstStart);
  }
  return { data: out, width: clampedW, height: clampedH };
}

/**
 * Делает скриншот и при необходимости сохраняет последний кадр на диск.
 * @param opts Параметры сохранения (директория, формат, флаг сохранения)
 * @returns Путь к файлу или null, если сохранение отключено
 */
export async function captureOnce(opts: CaptureOptions): Promise<string | null> {
  ensureDir(opts.outputDir);
  const buf = await screenshot({ format: opts.format });
  if (!opts.saveLastFrame) return null;
  const out = path.join(opts.outputDir, `last.${opts.format}`);
  fs.writeFileSync(out, buf);
  return out;
}
