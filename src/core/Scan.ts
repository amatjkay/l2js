import { getCV } from './CV';
import { captureImageData, ImageDataLike } from './Capture';
import { loadSettings } from './Config';
import type { Target } from '../spoiler/State';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { createLogger } from './Logger';
import https from 'https';
// Загружаем runtime для генераторов, нужен tesseract.js
try { require('regenerator-runtime/runtime'); } catch {}
// Polyfill web worker-like globals for Node main thread (tesseract.js expects them in some paths)
try {
  const g: any = (globalThis as any);
  if (typeof g.addEventListener !== 'function') g.addEventListener = () => {};
  if (typeof g.removeEventListener !== 'function') g.removeEventListener = () => {};
  if (typeof g.dispatchEvent !== 'function') g.dispatchEvent = () => true;
  if (typeof g.self === 'undefined') g.self = g;
} catch {}
// Опциональная загрузка tesseract.js — чтобы сборка не падала, если пакет недоступен
let createWorker: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ createWorker } = require('tesseract.js'));
} catch {
  try {
    // Попытка загрузить CommonJS-сборку напрямую
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ({ createWorker } = require('tesseract.js/dist/tesseract.cjs.js'));
  } catch {
    // пакет недоступен в рантайме — OCR будет пропущен до дальнейших попыток в getOcrWorker
  }
}

const Logger = createLogger();

let ocrWorkerPromise: Promise<any> | null = null;
async function getOcrWorker(lang: string, psm: number, whitelist: string): Promise<any> {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = (async () => {
      // Если ранее require не сработал (ESM), пробуем динамический import
      if (!createWorker) {
        try {
          const mod = await (Function('return import("tesseract.js")')() as Promise<any>);
          createWorker = mod && (mod.createWorker || (mod.default && mod.default.createWorker));
        } catch {
          // ignore
        }
      }
      if (!createWorker) throw new Error('tesseract.js not available');
      // Явно укажем пути до worker и core, чтобы избежать проблем резолва
      let workerPath: string | undefined;
      let corePath: string | undefined;
      try {
        // Используем локальный shim, эмулирующий web-worker API поверх worker_threads
        const distShim = path.resolve('dist/core/tess-worker-shim.js');
        const srcShim = path.resolve('src/core/tess-worker-shim.js');
        workerPath = fs.existsSync(distShim) ? distShim : srcShim;
      } catch {}
      // В tesseract.js corePath должен указывать на JS-лоадер (.wasm.js), рядом с которым лежит бинарный .wasm
      const candidates = [
        'tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
        'tesseract.js-core/tesseract-core-lstm.wasm.js',
        'tesseract.js-core/tesseract-core.wasm.js',
      ];
      for (const c of candidates) {
        if (corePath) break;
        try { corePath = require.resolve(c); } catch {}
      }
      // Если вдруг получили путь на бинарный .wasm (редкий кейс) — вернёмся к .wasm.js рядом
      if (corePath && /\.wasm$/i.test(corePath) && !/\.wasm\.js$/i.test(corePath)) {
        const alt = corePath + '.js';
        if (fs.existsSync(alt)) corePath = alt;
      }

      // Нормализуем язык: tesseract ожидает строку вида "eng" или "eng+rus"
      const langNorm = (() => {
        // поддержим массив строк на входе (на всякий случай)
        const raw = Array.isArray((lang as unknown))
          ? (lang as unknown as string[]).join('+')
          : (typeof lang === 'string' ? lang : '');
        const s = (raw || '').trim();
        if (!s) {
          Logger.warn('OCR: пустой/некорректный lang, подставляю "eng"');
          return 'eng';
        }
        return s;
      })();
      Logger.info(`OCR: init worker with lang="${langNorm}" (type=${Array.isArray((lang as unknown)) ? 'array' : typeof lang}), psm=${psm}`);
      if (typeof lang !== 'string' && !Array.isArray((lang as unknown))) {
        Logger.warn('OCR: параметр lang имеет некорректный тип, ожидается string или string[]');
      }

      // Локальная папка с языковыми файлами
      const tessdataDir = path.resolve('tessdata');
      try { ensureDir(tessdataDir); } catch {}

      // Убедимся, что для всех языков есть traineddata; при отсутствии — попробуем скачать
      try {
        const langs = String(langNorm).split('+').map(s => s.trim()).filter(Boolean);
        for (const l of langs) {
          await ensureTrainedData(tessdataDir, l);
        }
      } catch (e) {
        Logger.warn(`OCR: ensureTrainedData failed: ${e}`);
      }

      const defaultWhitelist = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const wl = (typeof whitelist === 'string' && whitelist.trim().length > 0) ? whitelist : defaultWhitelist;
      if (wl === defaultWhitelist) {
        Logger.info('OCR: whitelist не задан, использую A–Z a–z по умолчанию');
      } else {
        Logger.info(`OCR: whitelist задан (${whitelist.length} chars)`);
      }

      Logger.info(`OCR: worker options: workerPath=${workerPath ?? 'auto'}, corePath=${corePath ?? 'auto'}, workerBlobURL=false`);
      const worker = await createWorker(
        langNorm,
        undefined,
        {
          ...(workerPath ? { workerPath } : {}),
          ...(corePath ? { corePath } : {}),
          // В Node запрещаем blob-URL, чтобы использовать файл-воркер/worker_threads
          workerBlobURL: false,
          // Направляем Tesseract на локальные traineddata
          cachePath: tessdataDir,
          dataPath: tessdataDir,
          cacheMethod: 'write',
          gzip: true,
        },
      );
      await worker.setParameters({
        tessedit_pageseg_mode: String(psm),
        tessedit_char_whitelist: wl,
      } as any);
      return worker;
    })();
  }
  return ocrWorkerPromise;
}

async function ensureTrainedData(dir: string, lang: string): Promise<void> {
  const file = path.join(dir, `${lang}.traineddata`);
  if (fs.existsSync(file) && fs.statSync(file).size > 0) return;
  const url = `https://github.com/tesseract-ocr/tessdata_best/raw/main/${lang}.traineddata`;
  await new Promise<void>((resolve, reject) => {
    Logger.info(`OCR: downloading ${lang}.traineddata ...`);
    const req = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // redirect
        https.get(res.headers.location, (res2) => pipeToFile(res2, file, resolve, reject)).on('error', reject);
      } else {
        pipeToFile(res, file, resolve, reject);
      }
    });
    req.on('error', reject);
  });
  Logger.info(`OCR: ${lang}.traineddata saved to ${file}`);

  function pipeToFile(stream: NodeJS.ReadableStream, outPath: string, resolve: () => void, reject: (err: any) => void) {
    if ((stream as any).statusCode && (stream as any).statusCode !== 200) {
      reject(new Error(`HTTP ${(stream as any).statusCode}`));
      return;
    }
    const tmp = outPath + '.part';
    const ws = fs.createWriteStream(tmp);
    stream.pipe(ws);
    ws.on('finish', () => {
      ws.close();
      try {
        fs.renameSync(tmp, outPath);
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    ws.on('error', reject);
  }
}

function saveGrayCropPng(filePath: string, matGray: any, x: number, y: number, w: number, h: number) {
  const width = Math.max(1, Math.min(w, matGray.cols - x));
  const height = Math.max(1, Math.min(h, matGray.rows - y));
  const rgba = new Uint8ClampedArray(width * height * 4);
  const src = matGray.data as Uint8Array; // 1 channel
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const srcIdx = (row + y) * matGray.cols + (col + x);
      const val = src[srcIdx];
      const j = (row * width + col) * 4;
      rgba[j] = val; // R
      rgba[j + 1] = val; // G
      rgba[j + 2] = val; // B
      rgba[j + 3] = 255; // A
    }
  }
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  const out = fs.createWriteStream(filePath);
  png.pack().pipe(out);
}

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
  // Fallback: если после морфологии контуры не найдены, попробуем взять контуры напрямую с threshold-изображения
  let usedContours = contoursRoi;
  let usedHierarchy = hierarchyRoi;
  let afterFallbackCount = 0;
  if (afterRoiCount === 0) {
    const contoursThr = new cv.MatVector();
    const hierarchyThr = new cv.Mat();
    cv.findContours(thrRoi, contoursThr, hierarchyThr, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    afterFallbackCount = contoursThr.size();
    if (afterFallbackCount > 0) {
      usedContours = contoursThr;
      usedHierarchy = hierarchyThr;
      // Освобождать исходные структуры будем позже, вместе с остальными ресурсами
    } else {
      // Нет контуров и на threshold — освобождаем временные
      hierarchyThr.delete();
      contoursThr.delete();
    }
  }

  // 4) Сбор результатов по ROI-контуров и фильтрация по площади
  const results: Target[] = [];
  const offX = roi && roi.width && roi.height ? Math.max(0, roi.x) : 0;
  const offY = roi && roi.width && roi.height ? Math.max(0, roi.y) : 0;
  for (let i = 0; i < usedContours.size(); i++) {
    const cnt = usedContours.get(i);
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
  // Отладка: что отфильтровалось по площади
  const filteredByArea = results.filter((t) => !(t.area >= minArea && t.area <= maxArea));
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
  // Отладка: что отфильтровалось по габаритам
  const filteredBySize = filtered.filter(
    (t) =>
      !(t.bbox.width >= minW &&
        t.bbox.height >= minH &&
        t.bbox.width <= maxW &&
        t.bbox.height <= maxH)
  );
  Logger.info(`afterSizeFilter: targets=${sizeFiltered.length}`);

  // 5.1) Доп. фильтр по вертикальному диапазону (в координатах ROI)
  const yBand = (cvCfg as any).yBand as { min?: number; max?: number } | undefined;
  let bandFiltered = sizeFiltered;
  let filteredByBand: Target[] = [];
  if (yBand && (typeof yBand.min === 'number' || typeof yBand.max === 'number')) {
    const minY = typeof yBand.min === 'number' ? yBand.min : Number.NEGATIVE_INFINITY;
    const maxY = typeof yBand.max === 'number' ? yBand.max : Number.POSITIVE_INFINITY;
    const pass: Target[] = [];
    const fail: Target[] = [];
    for (const t of sizeFiltered) {
      const centerYInRoi = (t.bbox.y - offY) + t.bbox.height / 2;
      if (centerYInRoi >= minY && centerYInRoi <= maxY) pass.push(t); else fail.push(t);
    }
    bandFiltered = pass;
    filteredByBand = fail;
    Logger.info(`afterYBand: targets=${bandFiltered.length} (band=[${isFinite(minY)?minY:'-inf'}..${isFinite(maxY)?maxY:'+inf'}])`);
  }

  // 6) Объединение сегментов текста по базовой линии (учёт пробелов как части имени)
  const gap = cvCfg.maxWordGapPx ?? 30;
  const baselineDelta = cvCfg.maxBaselineDeltaPx ?? 6;
  // 5.2) Фильтр по зонам исключения (в координатах ROI)
  const exclusionZones = (cvCfg as any).exclusionZones as { x: number; y: number; width: number; height: number }[] | undefined;
  let excFiltered = bandFiltered;
  let filteredByExclusion: Target[] = [];
  if (Array.isArray(exclusionZones) && exclusionZones.length > 0) {
    const pass: Target[] = [];
    const fail: Target[] = [];
    for (const t of bandFiltered) {
      const cx = (t.bbox.x - offX) + t.bbox.width / 2;
      const cy = (t.bbox.y - offY) + t.bbox.height / 2;
      const hit = exclusionZones.some(z => cx >= z.x && cx <= z.x + z.width && cy >= z.y && cy <= z.y + z.height);
      if (hit) fail.push(t); else pass.push(t);
    }
    excFiltered = pass;
    filteredByExclusion = fail;
    Logger.info(`afterExclusionZones: targets=${excFiltered.length} (zones=${exclusionZones.length})`);
  }

  // 5.3) Эвристика «ровности» кромок и разбиение слипшихся широких боксов
  const flatCfg = (cvCfg as any).flatness || {};
  const stdThresh: number = typeof flatCfg.stdThreshold === 'number' ? flatCfg.stdThreshold : 1.5;
  const minFlatRatio: number = typeof flatCfg.minFlatRatio === 'number' ? flatCfg.minFlatRatio : 0.6;
  const minValleyRatio: number = typeof flatCfg.minValleyRatio === 'number' ? flatCfg.minValleyRatio : 0.35;
  const minSplitWidth: number = typeof flatCfg.minSplitWidth === 'number' ? flatCfg.minSplitWidth : 30;
  const candidatesAfterFlat: Target[] = [];
  const flatDebug: any[] = [];
  for (const t of excFiltered) {
    const xr = Math.max(0, Math.min(closedRoi.cols - 1, Math.round(t.bbox.x - offX)));
    const yr = Math.max(0, Math.min(closedRoi.rows - 1, Math.round(t.bbox.y - offY)));
    const wr = Math.max(1, Math.min(closedRoi.cols - xr, Math.round(t.bbox.width)));
    const hr = Math.max(1, Math.min(closedRoi.rows - yr, Math.round(t.bbox.height)));
    const prof = analyzeFlatness(closedRoi, xr, yr, wr, hr, cv);
    flatDebug.push({ bboxRoi: { x: xr, y: yr, width: wr, height: hr }, ...prof });
    const isFlat = (prof.bottom.flatRatio >= minFlatRatio && prof.bottom.std <= stdThresh) ||
                   (prof.top.flatRatio >= minFlatRatio && prof.top.std <= stdThresh);
    if (isFlat) {
      candidatesAfterFlat.push(t);
      continue;
    }
    // Попробуем один разрез по вертикальной «долине» плотности белых пикселей
    const valley = findVerticalValley(prof.colCounts, Math.floor(hr * minValleyRatio));
    if (valley > 0 && valley < wr - 1) {
      const leftW = valley;
      const rightW = wr - valley;
      if (leftW >= minSplitWidth && rightW >= minSplitWidth) {
        const left: Target = { bbox: { x: t.bbox.x, y: t.bbox.y, width: leftW, height: t.bbox.height }, area: t.area * (leftW / wr), cx: t.cx, cy: t.cy };
        const right: Target = { bbox: { x: t.bbox.x + leftW, y: t.bbox.y, width: rightW, height: t.bbox.height }, area: t.area * (rightW / wr), cx: t.cx, cy: t.cy };
        candidatesAfterFlat.push(left, right);
        continue;
      }
    }
    // Если не удалось разделить — оставляем как есть (но помечаем)
    candidatesAfterFlat.push(t);
  }

  const merged = mergeLineSegments(candidatesAfterFlat, gap, baselineDelta);
  Logger.info(`afterMerge: targets=${merged.length}`);

  // 7) OCR-фильтрация распознанного текста (опционально)
  let ocrFiltered: Target[] = merged;
  const ocrCfg = (cvCfg as any).ocr || {};
  const ocrEnabled: boolean = !!ocrCfg.enabled;
  let afterOcrCount = merged.length;
  const ocrDebug: any[] = [];
  if (ocrEnabled && merged.length > 0) {
    try {
      const lang: string = ocrCfg.lang || 'eng';
      const psm: number = typeof ocrCfg.psm === 'number' ? ocrCfg.psm : 7;
      const minConfidence: number = typeof ocrCfg.minConfidence === 'number' ? ocrCfg.minConfidence : 70;
      const whitelist: string = ocrCfg.whitelist || 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
      const maxPerFrame: number = typeof ocrCfg.maxPerFrame === 'number' ? ocrCfg.maxPerFrame : 6;
      const timeoutMs: number = typeof ocrCfg.timeoutMs === 'number' ? ocrCfg.timeoutMs : 1000;
      const debugSave: boolean = !!ocrCfg.debugSaveCrops;
      const source: 'binary' | 'gray' = (ocrCfg.source === 'gray') ? 'gray' : 'binary';
      const pad: number = (typeof ocrCfg.padding === 'number' ? ocrCfg.padding : 2);
      Logger.info(`OCR: source=${source} psm=${psm} minConf=${minConfidence} pad=${pad}`);

      const worker = await getOcrWorker(lang, psm, whitelist);
      const outDir = path.resolve('logs', 'images', `${tStart}`);
      const cropsDir = path.join(outDir, 'ocr_crops');
      if (useDebug || debugSave) {
        ensureDir(outDir);
        ensureDir(cropsDir);
      }
      const tasks: Array<Promise<{ idx: number; ok: boolean; text: string; conf: number }>> = [];
      const toProcess = merged.slice(0, Math.max(1, maxPerFrame));
      for (let i = 0; i < toProcess.length; i++) {
        const t = toProcess[i];
        const srcMat = source === 'binary' ? thrRoi : roiGray;
        const xr = Math.max(0, Math.min(srcMat.cols - 1, Math.round(t.bbox.x - offX)));
        const yr = Math.max(0, Math.min(srcMat.rows - 1, Math.round(t.bbox.y - offY)));
        const wr = Math.max(1, Math.min(srcMat.cols - xr, Math.round(t.bbox.width + pad * 2)));
        const hr = Math.max(1, Math.min(srcMat.rows - yr, Math.round(t.bbox.height + pad * 2)));
        const xrp = Math.max(0, xr - pad);
        const yrp = Math.max(0, yr - pad);
        const cropName = `ocr_${i + 1}_${xrp}x${yrp}_${wr}x${hr}.png`;
        const cropPath = path.join(cropsDir, cropName);
        // Сохраняем PNG для OCR (и диагностики при debug)
        saveGrayCropPng(cropPath, srcMat, xrp, yrp, wr, hr);
        // Запускаем OCR с таймаутом
        const p = (async () => {
          let resText = '';
          let conf = 0;
          try {
            const ret = await worker.recognize(cropPath);
            resText = (ret?.data?.text || '').replace(/\r|\n/g, ' ').trim();
            conf = Math.round(ret?.data?.confidence ?? 0);
          } catch (e) {
            // ignore, treat as fail
          } finally {
            if (!useDebug && !debugSave) {
              try { fs.unlinkSync(cropPath); } catch {}
            }
          }
          // Фильтры: только A-Za-z, min length 2, min confidence
          const onlyLetters = resText.replace(/[^A-Za-z]+/g, '');
          const ok = onlyLetters.length >= 2 && conf >= minConfidence;
          return { idx: i, ok, text: onlyLetters, conf };
        })();
        tasks.push(p);
      }
      const results = await Promise.all(tasks);
      // По умолчанию оставляем все боксы, которые не обрабатывались OCR (индексы >= toProcess.length)
      const allow: boolean[] = merged.map((_, idx) => idx >= toProcess.length);
      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        ocrDebug.push({ index: i + 1, text: r.text, conf: r.conf });
        allow[r.idx] = r.ok;
      }
      ocrFiltered = merged.filter((_, idx) => allow[idx]);
      afterOcrCount = ocrFiltered.length;
      Logger.info(`afterOCR: targets=${afterOcrCount} (processed=${results.length})`);
    } catch (e) {
      Logger.warn(`OCR step failed: ${e}`);
    }
  }

  // Итоговые цели после возможного OCR-фильтра
  const finalTargets = ocrEnabled ? ocrFiltered : merged;

  // Метрики и лог
  const metrics = computeAreaStats(finalTargets.map((t) => t.area));
  const totalMs = Date.now() - tStart;
  Logger.info(
    `scanForTargets: fullFrame=${fullCount}, afterROI=${afterRoiCount}, afterFallback=${afterFallbackCount}, afterAreaFilter=${afterAreaCount}, afterSizeFilter=${sizeFiltered.length}, afterMerge=${merged.length}${ocrEnabled?`, afterOCR=${afterOcrCount}`:''}, final=${finalTargets.length}, area[min/avg/max]=${metrics.min}/${metrics.avg.toFixed(1)}/${metrics.max}, time=${totalMs}ms`
  );

  // Сохранение overlay-скринов с зелёными bbox и bboxes.json
  if (useDebug) {
    const outDir = path.resolve('logs', 'images', `${tStart}`);
    ensureDir(outDir);
    try {
      // 03_threshold_overlay.png
      const thrColor = new cv.Mat();
      cv.cvtColor(thrRoi, thrColor, cv.COLOR_GRAY2BGR);
      drawBoxesOnBgrMat(thrColor, finalTargets, offX, offY, new cv.Scalar(0, 255, 0, 255), 2, cv);
      saveBgrPng(path.join(outDir, '03_threshold_overlay.png'), thrColor);

      // 04_morph_close_overlay.png
      const clColor = new cv.Mat();
      cv.cvtColor(closedRoi, clColor, cv.COLOR_GRAY2BGR);
      drawBoxesOnBgrMat(clColor, finalTargets, offX, offY, new cv.Scalar(0, 255, 0, 255), 2, cv);
      saveBgrPng(path.join(outDir, '04_morph_close_overlay.png'), clColor);

      thrColor.delete();
      clColor.delete();
    } catch (e) {
      Logger.warn(`Failed to save overlay images: ${e}`);
    }
    const payload = {
      ts: Date.now(),
      roi: cvCfg.roi || null,
      minArea,
      maxArea,
      counts: {
        fullFrame: fullCount,
        afterROI: afterRoiCount,
        afterFallback: afterFallbackCount,
        afterAreaFilter: afterAreaCount,
        afterSizeFilter: sizeFiltered.length,
        afterYBand: bandFiltered.length,
        afterExclusion: excFiltered.length,
        afterFlatness: candidatesAfterFlat.length,
        afterMerge: merged.length,
        ...(ocrEnabled ? { afterOCR: afterOcrCount } : {}),
      },
      metrics,
      targets: finalTargets,
      debug: {
        sizeThresholds: { minWidth: minW, minHeight: minH, maxWidth: maxW, maxHeight: maxH },
        areaThresholds: { minArea, maxArea },
        filteredByArea,
        filteredBySize,
        yBand: yBand || null,
        filteredByBand,
        exclusionZones: exclusionZones || [],
        filteredByExclusion,
        flatness: { stdThreshold: stdThresh, minFlatRatio, minValleyRatio, minSplitWidth },
        flatProfiles: flatDebug,
        ocr: ocrEnabled ? { processed: Math.min(merged.length, (cvCfg as any).ocr?.maxPerFrame || 6), after: afterOcrCount, results: ocrDebug } : undefined,
      },
    };
    const outPath = path.join(outDir, 'bboxes.json');
    fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf-8');
    Logger.info(`bboxes.json saved to ${outPath}`);
  }

  // Cleanup
  // Если использовали альтернативные контуры (threshold), необходимо корректно освободить ресурсы
  if (usedContours !== contoursRoi) {
    // Используемые структуры освободим здесь
    usedHierarchy.delete();
    usedContours.delete();
  }
  hierarchyRoi.delete();
  contoursRoi.delete();
  closedRoi.delete();
  kernel.delete();
  thrFull.delete();
  if (roiGray && roiGray !== grayFull) roiGray.delete();
  grayFull.delete();
  matFull.delete();

  return finalTargets;

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

// Рисует зелёные прямоугольники на BGR-матрице, принимая абсолютные bbox и смещая в ROI-координаты
function drawBoxesOnBgrMat(matBgr: any, items: Target[], offX: number, offY: number, color: any, thickness: number, cv: any) {
  // Рисуем и подписываем: #index (x,y,w,h) в координатах ROI
  for (let i = 0; i < items.length; i++) {
    const t = items[i];
    const x = Math.max(0, Math.round(t.bbox.x - offX));
    const y = Math.max(0, Math.round(t.bbox.y - offY));
    const w = Math.round(t.bbox.width);
    const h = Math.round(t.bbox.height);
    const p1 = new cv.Point(x, y);
    const p2 = new cv.Point(Math.min(x + w, matBgr.cols - 1), Math.min(y + h, matBgr.rows - 1));
    cv.rectangle(matBgr, p1, p2, color, thickness);
    // Подпись
    const label = `#${i + 1} (${x},${y},${w},${h})`;
    const org = new cv.Point(x, Math.max(0, y - 3));
    cv.putText(
      matBgr,
      label,
      org,
      cv.FONT_HERSHEY_SIMPLEX,
      0.4,
      color,
      1,
      cv.LINE_AA
    );
    p1.delete && p1.delete();
    p2.delete && p2.delete();
    org.delete && org.delete();
  }
}

// Сохраняет BGR Mat как PNG (RGBA) через pngjs
function saveBgrPng(filePath: string, matBgr: any) {
  const width = matBgr.cols;
  const height = matBgr.rows;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const src = matBgr.data; // B,G,R,B,G,R...
  for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
    const b = src[i];
    const g = src[i + 1];
    const r = src[i + 2];
    rgba[j] = r;
    rgba[j + 1] = g;
    rgba[j + 2] = b;
    rgba[j + 3] = 255;
  }
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  const out = fs.createWriteStream(filePath);
  png.pack().pipe(out);
}

/**
 * Анализ "ровности" верхней/нижней кромок в бинаризированном закрытом ROI (closedRoi).
 * Возвращает:
 * - colCounts: массив длиной w с числом белых пикселей в каждом столбце.
 * - bottom/top: { std, flatRatio }
 *   std — стандартное отклонение координаты кромки (чем меньше, тем ровнее)
 *   flatRatio — доля столбцов, где край лежит в пределах 1 пикселя от моды (чем больше, тем ровнее)
 */
function analyzeFlatness(matClosed: any, x: number, y: number, w: number, h: number, cv: any) {
  const colCounts = new Array<number>(w).fill(0);
  const bottomEdge: number[] = new Array(w).fill(0);
  const topEdge: number[] = new Array(w).fill(0);

  // Подсчёт белых в столбцах и нахождение верхней/нижней кромки
  for (let c = 0; c < w; c++) {
    let count = 0;
    let topFound = -1;
    let bottomFound = -1;
    for (let r = 0; r < h; r++) {
      const vTop = matClosed.ucharPtr(y + r, x + c)[0];
      if (vTop > 0) {
        count++;
        if (topFound === -1) topFound = r; // первая белая сверху
      }
      const vBot = matClosed.ucharPtr(y + (h - 1 - r), x + c)[0];
      if (bottomFound === -1 && vBot > 0) {
        bottomFound = r; // отступ снизу
      }
    }
    colCounts[c] = count;
    topEdge[c] = topFound === -1 ? h - 1 : topFound; // чем меньше, тем ближе к верхней границе
    bottomEdge[c] = bottomFound === -1 ? h - 1 : bottomFound; // 0 — самая нижняя строка
  }

  function stats(arr: number[]) {
    // мода с окном +-1 пиксель
    const hist = new Map<number, number>();
    for (const v of arr) hist.set(v, (hist.get(v) || 0) + 1);
    let modeVal = 0;
    let modeCnt = -1;
    for (const [k, cnt] of hist) {
      if (cnt > modeCnt) { modeCnt = cnt; modeVal = k; }
    }
    let flatCnt = 0;
    for (const v of arr) if (Math.abs(v - modeVal) <= 1) flatCnt++;
    const mean = arr.reduce((a,b)=>a+b,0) / (arr.length || 1);
    const variance = arr.reduce((a,b)=>a + (b-mean)*(b-mean), 0) / (arr.length || 1);
    const std = Math.sqrt(variance);
    return { std, flatRatio: flatCnt / (arr.length || 1) };
  }

  return {
    colCounts,
    bottom: stats(bottomEdge),
    top: stats(topEdge),
  };
}

/**
 * По массиву colCounts ищет вертикальную "долину" (минимум), где белых заметно меньше,
 * чем в среднем по соседям. Требуемая минимальная высота долины задаётся как порог count < minCount.
 * Возвращает индекс столбца разреза или -1, если долина не найдена.
 */
function findVerticalValley(colCounts: number[], minCount: number): number {
  if (!colCounts.length) return -1;
  // Грубо: берём минимальный столбец, который ниже порога и локально ниже соседей
  let idx = -1;
  let val = Number.POSITIVE_INFINITY;
  for (let i = 1; i < colCounts.length - 1; i++) {
    const c = colCounts[i];
    if (c < val && c <= minCount && c <= colCounts[i-1] && c <= colCounts[i+1]) {
      val = c; idx = i;
    }
  }
  return idx;
}
