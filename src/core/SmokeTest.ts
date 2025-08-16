import { getCV } from './CV';
import { captureImageData, ImageDataLike } from './Capture';
import { PNG } from 'pngjs';
import fs from 'fs';
import path from 'path';
import { loadSettings } from './Config';

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/**
 * Преобразует строковый тип порога из настроек в соответствующую константу OpenCV.
 * @param cv Объект OpenCV
 * @param type Строковое имя типа порога (например, 'THRESH_BINARY')
 * @returns Числовое значение флага порога
 */
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

/**
 * Преобразует строковый тип формы структурного элемента в константу OpenCV.
 * @param cv Объект OpenCV
 * @param shape Строковое имя формы (например, 'MORPH_RECT')
 * @returns Числовое значение типа формы
 */
function mapMorphShape(cv: any, shape: string): number {
  const map: Record<string, number> = {
    MORPH_RECT: cv.MORPH_RECT,
    MORPH_ELLIPSE: cv.MORPH_ELLIPSE,
    MORPH_CROSS: cv.MORPH_CROSS,
  };
  return map[shape] ?? cv.MORPH_RECT;
}

/**
 * Сохраняет массив RGBA (Uint8ClampedArray) как PNG-файл по указанному пути.
 * Создаёт недостающие директории при необходимости.
 */
function saveRgbaPng(filePath: string, rgba: Uint8ClampedArray, width: number, height: number) {
  const png = new PNG({ width, height });
  // png.data is a Buffer, need to copy from Uint8ClampedArray
  Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength).copy(png.data);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, PNG.sync.write(png));
}

/**
 * Конвертирует одноканальный массив (grayscale) в RGBA для сохранения как PNG.
 */
function grayToRgba(gray: Uint8Array, width: number, height: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    const v = gray[i];
    out[j] = v; out[j + 1] = v; out[j + 2] = v; out[j + 3] = 255;
  }
  return out;
}

/**
 * Выполняет smoke-тест пайплайна CV: захват ROI, конвертация, порог, морфология, поиск контуров.
 * Параметры берутся из settings.json (блок cv). При capture.debug=true сохраняет диагностические изображения.
 * Логирует метрики времени по шагам.
 */
export async function smokeTestContours(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('— Starting smoke test for contours —');
  const cv = getCV();
  const settings = loadSettings();
  const cvCfg = settings.cv!;
  const useDebug = !!settings.capture.debug;
  const imagesOutDir = path.resolve('logs', 'images', `${Date.now()}`);

  // 1) Захват экрана и ROI → ImageData
  const t0 = Date.now();
  const imgData: ImageDataLike = await captureImageData('png', cvCfg.roi);
  const t1 = Date.now();
  if (useDebug) {
    saveRgbaPng(path.join(imagesOutDir, '01_raw_roi.png'), imgData.data, imgData.width, imgData.height);
  }

  // 2) ImageData -> cv.Mat (RGBA) вручную
  const mat = new cv.Mat(imgData.height, imgData.width, cv.CV_8UC4);
  mat.data.set(imgData.data);
  const t2 = Date.now();

  // 3) Конвертация в grayscale
  const gray = new cv.Mat();
  cv.cvtColor(mat, gray, cv.COLOR_RGBA2GRAY);
  const t3 = Date.now();
  if (useDebug) {
    const grayRgba = grayToRgba(gray.data as any, gray.cols, gray.rows);
    saveRgbaPng(path.join(imagesOutDir, '02_gray.png'), grayRgba, gray.cols, gray.rows);
  }

  // 4) Пороговая бинаризация
  const thresh = new cv.Mat();
  const thrType = mapThresholdType(cv, cvCfg.thresholdType!);
  cv.threshold(gray, thresh, cvCfg.thresholdValue!, 255, thrType);
  const t4 = Date.now();
  if (useDebug) {
    const thrRgba = grayToRgba(thresh.data as any, thresh.cols, thresh.rows);
    saveRgbaPng(path.join(imagesOutDir, '03_threshold.png'), thrRgba, thresh.cols, thresh.rows);
  }

  // 5) Морфологическое закрытие
  const [kw, kh] = cvCfg.morphKernelSize!;
  const kshape = mapMorphShape(cv, cvCfg.morphShape!);
  const kernel = cv.getStructuringElement(kshape, new cv.Size(kw, kh));
  const closed = new cv.Mat();
  cv.morphologyEx(thresh, closed, cv.MORPH_CLOSE, kernel);
  const t5 = Date.now();
  if (useDebug) {
    const clRgba = grayToRgba(closed.data as any, closed.cols, closed.rows);
    saveRgbaPng(path.join(imagesOutDir, '04_morph_close.png'), clRgba, closed.cols, closed.rows);
  }

  // 6) Поиск контуров
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  // eslint-disable-next-line no-console
  console.log(`Contours found: ${contours.size()}`);
  const t6 = Date.now();
  // eslint-disable-next-line no-console
  console.log(
    `Timings(ms): capture+roi=${t1 - t0}, toMat=${t2 - t1}, gray=${t3 - t2}, threshold=${t4 - t3}, morph=${t5 - t4}, contours=${t6 - t5}`
  );

  // 7) Очистка
  mat.delete();
  gray.delete();
  thresh.delete();
  closed.delete();
  kernel.delete();
  contours.delete();
  hierarchy.delete();

  // eslint-disable-next-line no-console
  console.log('— Smoke test completed —');
}
