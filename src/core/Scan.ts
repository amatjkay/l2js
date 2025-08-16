import { getCV } from './CV';
import { captureImageData, ImageDataLike } from './Capture';
import { loadSettings } from './Config';
import type { Target } from '../spoiler/State';
import fs from 'fs';
import path from 'path';
import { createLogger } from './Logger';

const Logger = createLogger();

/**
 * Выполняет сканирование экрана с использованием параметров из settings.json
 * и возвращает список целей (bbox, площадь, центр масс) в координатах ROI.
 */
export async function scanForTargets(): Promise<Target[]> {
  const tStart = Date.now();
  const cv = getCV();
  const settings = loadSettings();
  const cvCfg = settings.cv!;
  const useDebug = !!settings.capture.debug;

  // 1) Захват ПОЛНОГО кадра (без ROI) -> ImageData
  const fullImg: ImageDataLike = await captureImageData('png');

  // 2) Полный кадр: ImageData -> cv.Mat (RGBA) -> GRAY -> Threshold -> Morph -> Contours
  const matFull = new cv.Mat(fullImg.height, fullImg.width, cv.CV_8UC4);
  matFull.data.set(fullImg.data);
  const grayFull = new cv.Mat();
  cv.cvtColor(matFull, grayFull, cv.COLOR_RGBA2GRAY);
  const thrTypeFull = mapThresholdType(cv, cvCfg.thresholdType!);
  const thrFull = new cv.Mat();
  cv.threshold(grayFull, thrFull, cvCfg.thresholdValue!, 255, thrTypeFull);
  const [kw, kh] = cvCfg.morphKernelSize!;
  const kshape = mapMorphShape(cv, cvCfg.morphShape!);
  const kernel = cv.getStructuringElement(kshape, new cv.Size(kw, kh));
  const closedFull = new cv.Mat();
  cv.morphologyEx(thrFull, closedFull, cv.MORPH_CLOSE, kernel);
  const contoursFull = new cv.MatVector();
  const hierarchyFull = new cv.Mat();
  cv.findContours(closedFull, contoursFull, hierarchyFull, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const fullCount = contoursFull.size();

  // 3) ROI-этап: берём ROI на уровне GRAY и повторяем threshold/morph/contours для ROI
  const roi = cvCfg.roi;
  let roiGray: any = null;
  if (roi && roi.width && roi.height) {
    const rect = new cv.Rect(
      Math.max(0, Math.min(roi.x, grayFull.cols - 1)),
      Math.max(0, Math.min(roi.y, grayFull.rows - 1)),
      Math.max(1, Math.min(roi.width, grayFull.cols - roi.x)),
      Math.max(1, Math.min(roi.height, grayFull.rows - roi.y))
    );
    roiGray = grayFull.roi(rect);
  } else {
    roiGray = grayFull; // ROI не задан — работаем по всему кадру
  }

  const thrRoi = new cv.Mat();
  cv.threshold(roiGray, thrRoi, cvCfg.thresholdValue!, 255, thrTypeFull);
  const closedRoi = new cv.Mat();
  cv.morphologyEx(thrRoi, closedRoi, cv.MORPH_CLOSE, kernel);
  const contoursRoi = new cv.MatVector();
  const hierarchyRoi = new cv.Mat();
  cv.findContours(closedRoi, contoursRoi, hierarchyRoi, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  const afterRoiCount = contoursRoi.size();

  // 4) Сбор результатов по ROI-контуров и фильтрация по площади
  const results: Target[] = [];
  const offX = roi && roi.width && roi.height ? Math.max(0, roi.x) : 0;
  const offY = roi && roi.width && roi.height ? Math.max(0, roi.y) : 0;
  for (let i = 0; i < contoursRoi.size(); i++) {
    const cnt = contoursRoi.get(i);
    const rect = cv.boundingRect(cnt);
    const area = cv.contourArea(cnt);
    const m = cv.moments(cnt);
    const cx = m.m00 !== 0 ? m.m10 / m.m00 : rect.x + rect.width / 2;
    const cy = m.m00 !== 0 ? m.m01 / m.m00 : rect.y + rect.height / 2;
    results.push({
      bbox: { x: rect.x + offX, y: rect.y + offY, width: rect.width, height: rect.height },
      area,
      cx: cx + offX,
      cy: cy + offY,
    });
    cnt.delete();
  }
  const minArea = cvCfg.minArea ?? 0;
  const maxArea = cvCfg.maxArea ?? Number.MAX_SAFE_INTEGER;
  const filtered = results.filter((t) => t.area >= minArea && t.area <= maxArea);
  const afterAreaCount = filtered.length;

  // 5) Доп. фильтрация по габаритам bbox (ширина/высота)
  const minW = cvCfg.minWidth ?? 0;
  const minH = cvCfg.minHeight ?? 0;
  const maxW = cvCfg.maxWidth ?? Number.MAX_SAFE_INTEGER;
  const maxH = cvCfg.maxHeight ?? Number.MAX_SAFE_INTEGER;
  const sizeFiltered = filtered.filter(
    (t) =>
      t.bbox.width >= minW &&
      t.bbox.height >= minH &&
      t.bbox.width <= maxW &&
      t.bbox.height <= maxH
  );
  Logger.info(`afterSizeFilter: targets=${sizeFiltered.length}`);

  // 6) Объединение сегментов текста по базовой линии (учёт пробелов как части имени)
  const gap = cvCfg.maxWordGapPx ?? 30;
  const baselineDelta = cvCfg.maxBaselineDeltaPx ?? 6;
  const merged = mergeLineSegments(sizeFiltered, gap, baselineDelta);
  Logger.info(`afterMerge: targets=${merged.length}`);

  // Метрики и лог
  const metrics = computeAreaStats(merged.map((t) => t.area));
  const totalMs = Date.now() - tStart;
  Logger.info(
    `scanForTargets: fullFrame=${fullCount}, afterROI=${afterRoiCount}, afterAreaFilter=${afterAreaCount}, afterSizeFilter=${sizeFiltered.length}, afterMerge=${merged.length}, area[min/avg/max]=${metrics.min}/${metrics.avg.toFixed(1)}/${metrics.max}, time=${totalMs}ms`
  );

  // Сохранение bboxes.json
  if (useDebug) {
    const outDir = path.resolve('logs', 'images', `${Date.now()}`);
    ensureDir(outDir);
    const payload = {
      ts: Date.now(),
      roi: cvCfg.roi || null,
      minArea,
      maxArea,
      counts: { fullFrame: fullCount, afterROI: afterRoiCount, afterAreaFilter: afterAreaCount, afterSizeFilter: sizeFiltered.length, afterMerge: merged.length },
      metrics,
      targets: merged,
    };
    const outPath = path.join(outDir, 'bboxes.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
    Logger.info(`bboxes.json saved to ${outPath}`);
  }

  // Cleanup
  hierarchyRoi.delete();
  contoursRoi.delete();
  closedRoi.delete();
  kernel.delete();
  thrFull.delete();
  if (roiGray && roiGray !== grayFull) roiGray.delete();
  grayFull.delete();
  matFull.delete();

  return merged;

  /**
   * Объединяет горизонтально выровненные сегменты одной строки в единый bbox,
   * если горизонтальный зазор <= maxGap и разница по базовой линии <= baselineDelta.
   */
  function mergeLineSegments(items: Target[], maxGap: number, baselineDelta: number): Target[] {
    if (items.length <= 1) return items.slice();
    // Сортируем по y (базовой линии), затем по x
    const sorted = items.slice().sort((a, b) => {
      const ay = a.bbox.y + a.bbox.height / 2;
      const by = b.bbox.y + b.bbox.height / 2;
      if (Math.abs(ay - by) > baselineDelta) return ay - by; // разные строки
      return a.bbox.x - b.bbox.x;
    });

    // Группируем по строкам (по близости по y)
    const lines: Target[][] = [];
    for (const t of sorted) {
      const cy = t.bbox.y + t.bbox.height / 2;
      let placed = false;
      for (const line of lines) {
        const ly = line.reduce((acc, it) => acc + (it.bbox.y + it.bbox.height / 2), 0) / line.length;
        if (Math.abs(cy - ly) <= baselineDelta) {
          line.push(t);
          placed = true;
          break;
        }
      }
      if (!placed) lines.push([t]);
    }

    // Внутри каждой строки объединяем соседние сегменты по x при малом зазоре
    const out: Target[] = [];
    for (const line of lines) {
      line.sort((a, b) => a.bbox.x - b.bbox.x);
      let acc: Target | null = null;
      for (const seg of line) {
        if (!acc) {
          acc = { ...seg, bbox: { ...seg.bbox }, area: seg.area };
          continue;
        }
        const accRight = acc.bbox.x + acc.bbox.width;
        const gapPx = seg.bbox.x - accRight; // >0 если справа
        const sameLine = Math.abs((seg.bbox.y + seg.bbox.height / 2) - (acc.bbox.y + acc.bbox.height / 2)) <= baselineDelta;
        if (sameLine && gapPx >= 0 && gapPx <= maxGap) {
          // объединяем: расширяем bbox вправо и обновляем метрики
          const newRight = Math.max(accRight, seg.bbox.x + seg.bbox.width);
          const newLeft = Math.min(acc.bbox.x, seg.bbox.x);
          const newTop = Math.min(acc.bbox.y, seg.bbox.y);
          const newBottom = Math.max(acc.bbox.y + acc.bbox.height, seg.bbox.y + seg.bbox.height);
          acc.bbox.x = newLeft;
          acc.bbox.y = newTop;
          acc.bbox.width = newRight - newLeft;
          acc.bbox.height = newBottom - newTop;
          acc.area += seg.area; // суммируем площади как приближение
          acc.cx = acc.bbox.x + acc.bbox.width / 2;
          acc.cy = acc.bbox.y + acc.bbox.height / 2;
        } else {
          out.push(acc);
          acc = { ...seg, bbox: { ...seg.bbox }, area: seg.area };
        }
      }
      if (acc) out.push(acc);
    }
    return out;
  }
}

/** Преобразует строковый тип порога из настроек в соответствующую константу OpenCV. */
function mapThresholdType(cv: any, type: string): number {
  const map: Record<string, number> = {
    THRESH_BINARY: cv.THRESH_BINARY,
    THRESH_BINARY_INV: cv.THRESH_BINARY_INV,
    THRESH_TRUNC: cv.THRESH_TRUNC,
    THRESH_TOZERO: cv.THRESH_TOZERO,
    THRESH_TOZERO_INV: cv.THRESH_TOZERO_INV,
    THRESH_OTSU: cv.THRESH_OTSU,
  };
  return map[type] ?? cv.THRESH_BINARY;
}

/** Преобразует строковый тип формы структурного элемента в константу OpenCV. */
function mapMorphShape(cv: any, shape: string): number {
  const map: Record<string, number> = {
    MORPH_RECT: cv.MORPH_RECT,
    MORPH_ELLIPSE: cv.MORPH_ELLIPSE,
    MORPH_CROSS: cv.MORPH_CROSS,
  };
  return map[shape] ?? cv.MORPH_RECT;
}

function computeAreaStats(values: number[]) {
  if (values.length === 0) return { min: 0, max: 0, avg: 0 };
  let min = Number.POSITIVE_INFINITY;
  let max = 0;
  let sum = 0;
  for (const v of values) {
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  return { min, max, avg: sum / values.length };
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}
