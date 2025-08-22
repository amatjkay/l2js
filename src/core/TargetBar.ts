import { captureImageData } from './Capture';
import { createLogger } from './Logger';
import { loadSettings } from './Config';

const Logger = createLogger();

export function withinTol(rgb: [number, number, number], tgt: [number, number, number], tol: number): boolean {
  return (
    Math.abs(rgb[0] - tgt[0]) <= tol &&
    Math.abs(rgb[1] - tgt[1]) <= tol &&
    Math.abs(rgb[2] - tgt[2]) <= tol
  );
}

export function scanHasColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  color: [number, number, number],
  tol: number
): boolean {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      if (withinTol([r, g, b], color, tol)) return true;
    }
  }
  return false;
}

/**
 * Быстрая проверка: выбран ли таргет и жив ли он — по наличию красного пикселя HP в ROI.
 * Возвращает true, если найден хотя бы один пиксель, близкий к заданному красному цвету.
 */
export async function isTargetSelectedAlive(): Promise<boolean> {
  try {
    const settings = loadSettings();
    const combat = (settings as any).combat || {};
    const tb = combat.targetBar || {};
    const roi = tb.roi || { x: 0, y: 0, width: 0, height: 0 };
    const hpRed: [number, number, number] = Array.isArray(tb.hpRed) && tb.hpRed.length === 3 ? [tb.hpRed[0], tb.hpRed[1], tb.hpRed[2]] : [200, 40, 40];
    const hpTol = Number.isFinite(tb.hpTol) ? Math.max(0, Math.floor(tb.hpTol)) : 50;

    const img = await captureImageData('png', roi);
    const { data, width, height } = img; // RGBA
    return scanHasColor(data, width, height, hpRed, hpTol);
  } catch (e) {
    Logger.debug(`TargetBar.isTargetSelectedAlive error: ${(e as Error).message}`);
    return false;
  }
}
