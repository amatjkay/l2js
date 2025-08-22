import fs from 'fs';
import path from 'path';

/**
 * Глобальная конфигурация приложения. Загружается из settings.json в корне проекта,
 * поверх дефолтов. Используется для логирования, захвата экрана и параметров CV.
 */
export interface AppSettings {
  /** Сколько минут хранить логи; более старые файлы удаляются. */
  logRetentionMinutes: number;
  /** Параметры захвата экрана и сохранения кадров. */
  capture: {
    /** Сохранять ли последний кадр на диск. */
    saveLastFrame: boolean;
    /** Директория, куда сохраняются кадры. */
    outputDir: string;
    /** Формат скриншота (png|jpg). */
    format: 'png' | 'jpg';
    /** Расширенная отладка захвата (доп. логи). */
    debug?: boolean;
  };
  /** Глобальный флаг сохранения маркеров клика (click.json, 05_click_marker.png). */
  debugClicks?: boolean;
  /** Параметры эмуляции действий, камеры и фокуса окна. */
  actions?: {
    /** Выполнять ли реальные действия (движение/клик) или только логировать. */
    enableActions?: boolean;
    /** Задержка между шагами движения (устар., для совместимости). */
    moveDelayMs?: number;
    /** Задержка перед кликом (устар., для совместимости). */
    clickDelayMs?: number;
    /** Режим исполнения действий: powershell (скрипты) или arduino (через Serial). */
    mode?: 'powershell' | 'arduino';
    /** Дополнительное смещение курсора по оси Y перед кликом (положительное — вниз). */
    clickOffsetY?: number;
    /** Параметры проверки/автоактивации фокуса окна игры. */
    focusCheck?: {
      retryAttempts?: number;     // кол-во попыток проверки активного окна
      intervalMs?: number;        // интервал между попытками
      autoActivate?: boolean;     // пробовать автоактивацию при несовпадении
      activateTitle?: string;     // точный заголовок для AppActivate (например, "LU4  ")
      criteria?: {
        titleContains?: string;
        classEquals?: string;
        processNameContains?: string;
        hwndEquals?: number;
      };
    };
    /** Критерии привязки к окну игры для FocusGuard. */
    windowMatch?: {
      titleEquals?: string;
      titleRegex?: string;
      processName?: string;
      processFileExact?: string;
      classNameEquals?: string;
      classNameRegex?: string;
    };
    /** Настройки Serial для Arduino Leonardo. */
    serial?: {
      port?: string; // e.g. 'COM5'
      baudRate?: number; // 115200
      writeTimeoutMs?: number; // 300
      readTimeoutMs?: number; // 800
      retries?: number; // 1-2
    };
    /** Параметры детерминированного 360°-sweep камеры. */
    camera?: {
      dxMin?: number; dxMax?: number; pauseMs?: number; scale?: number; repeats?: number;
      /** Размер шага поворота камеры по горизонтали за один тик. */
      dxStep?: number;
      /** Количество шагов для полного круга (360°). */
      circleSteps?: number;
      /** Пауза между шагами поворота (мс). */
      stepPauseMs?: number;
      /** Пауза после круга (мс). */
      sweepPauseMs?: number;
      /** Количество кликов прокрутки вверх между кругами. */
      scrollUpAmount?: number;
      /** Количество кликов прокрутки вниз между кругами. */
      scrollDownAmount?: number;
      /** Включить рандомизацию прокрутки: случайное направление/количество. */
      scrollRandom?: boolean;
      /** Минимум тиков прокрутки при рандоме. */
      scrollMin?: number;
      /** Максимум тиков прокрутки при рандоме. */
      scrollMax?: number;
      /** Максимальный по модулю случайный наклон по оси Y на один круг (dy). */
      tiltDyMax?: number;
    };
    /** Микрозадержки для синхронизации действий. */
    delays?: { beforeMoveMs?: number; afterMoveMs?: number; beforeClickMs?: number; afterClickMs?: number };
  };
  /** Параметры пайплайна компьютерного зрения. */
  cv?: {
    /** Порог бинаризации (0–255). */
    thresholdValue?: number;
    /** Тип порогования. */
    thresholdType?: 'THRESH_BINARY' | 'THRESH_BINARY_INV' | 'THRESH_TRUNC' | 'THRESH_TOZERO' | 'THRESH_TOZERO_INV';
    /** Размер ядра морфологии [w,h]. */
    morphKernelSize?: [number, number];
    /** Форма структурного элемента. */
    morphShape?: 'MORPH_RECT' | 'MORPH_ELLIPSE' | 'MORPH_CROSS';
    /** ROI экрана для анализа. */
    roi?: { x: number; y: number; width: number; height: number };
    /** Включает расширенную отладку (сохранение стадий/overlay). */
    useDebug?: boolean;
    /** Выбор опорной точки (центр экрана/курсор). */
    selection?: { referencePoint?: 'screenCenter' | 'cursor' };
    /** Ограничения по площади и габаритам. */
    minArea?: number; maxArea?: number;
    minWidth?: number; minHeight?: number; maxWidth?: number; maxHeight?: number;
    /** Объединение сегментов строки. */
    maxWordGapPx?: number; maxBaselineDeltaPx?: number;
    /** Зоны-исключения (центры боксов внутри — отбрасываются). */
    exclusionZones?: Array<{ x: number; y: number; width: number; height: number }>;
    /** Эвристики «ровности» и разрезания слипшихся боксов. */
    flatness?: {
      stdThreshold?: number;      // порог СКО «ровности» линий
      minFlatRatio?: number;      // минимальная доля «ровных» точек
      minValleyRatio?: number;    // минимальная доля высоты «долины» для split
      minSplitWidth?: number;     // минимальная ширина сегмента после split
    };
    /** Настройки OCR. */
    ocr?: {
      /** Движок: native (tesseract.exe) или tesseractjs (WASM). */
      engine?: 'native' | 'tesseractjs';
      /** Включить OCR-фильтрацию целей. */
      enabled?: boolean;
      /** Язык OCR. */
      lang?: string;
      /** Page Segmentation Mode (обычно 7 — одна строка). */
      psm?: number;
      /** Минимальная уверенность (0–100). */
      minConfidence?: number;
      /** Белый список символов. */
      whitelist?: string;
      /** Путь к tesseract.exe (для native). */
      tesseractPath?: string;
      /** Источник изображения: gray или binary. */
      source?: 'gray' | 'binary';
      /** Отступ вокруг bbox при вырезке кропа. */
      padding?: number;
      /** Ограничение числа OCR-вызовов за кадр. */
      maxPerFrame?: number;
      /** Таймаут на один OCR-вызов. */
      timeoutMs?: number;
      /** Сохранять кропы для диагностики. */
      debugSaveCrops?: boolean;
      /** Строгий режим: если OCR не подтвердил ни одного бокса — цели пустые. */
      strict?: boolean;
    };
  };
}

/** Дефолтные значения на случай отсутствия settings.json или его полей. */
const DEFAULT_SETTINGS: AppSettings = {
  logRetentionMinutes: 10,
  capture: {
    saveLastFrame: true,
    outputDir: 'captures',
    format: 'png',
    debug: false,
  },
  actions: {
    enableActions: false,
    moveDelayMs: 10,
    clickDelayMs: 50,
    mode: 'powershell',
    focusCheck: {
      retryAttempts: 10,
      intervalMs: 500,
      autoActivate: true,
      activateTitle: '',
      criteria: { titleContains: 'LU4', classEquals: 'UnrealWindow', processNameContains: 'lu4', hwndEquals: 0x00040686 },
    },
    windowMatch: {},
    serial: { port: '', baudRate: 115200, writeTimeoutMs: 300, readTimeoutMs: 800, retries: 1 },
    camera: {
      dxMin: 80, dxMax: 160, pauseMs: 150, scale: 1, repeats: 1,
      dxStep: 120, circleSteps: 36, stepPauseMs: 120, sweepPauseMs: 500,
      scrollUpAmount: 1, scrollDownAmount: -1,
      scrollRandom: false, scrollMin: 1, scrollMax: 15,
      tiltDyMax: 0,
    },
    delays: { beforeMoveMs: 0, afterMoveMs: 70, beforeClickMs: 30, afterClickMs: 70 },
  },
  cv: {
    thresholdValue: 200,
    thresholdType: 'THRESH_BINARY',
    morphKernelSize: [50, 5],
    morphShape: 'MORPH_RECT',
    roi: { x: 0, y: 0, width: 0, height: 0 },
    useDebug: false,
    selection: { referencePoint: 'screenCenter' },
    minArea: 100,
    maxArea: 10000,
    minWidth: 50,
    minHeight: 8,
    maxWidth: 350,
    maxHeight: 20,
    maxWordGapPx: 30,
    maxBaselineDeltaPx: 6,
    ocr: {
      engine: 'native',
      enabled: false,
      lang: 'eng',
      psm: 7,
      minConfidence: 70,
      whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      tesseractPath: 'C:/Program Files/Tesseract-OCR/tesseract.exe',
      source: 'binary',
      padding: 2,
      maxPerFrame: 6,
      timeoutMs: 1000,
      debugSaveCrops: false,
      strict: false,
    },
  },
};

/**
 * Загружает настройки из settings.json. Выполняет безопасный глубокий merge
 * для блоков capture и cv, чтобы частичные конфиги не затирали дефолты.
 *
 * @returns Объединённые настройки приложения
 */
export function loadSettings(): AppSettings {
  const jsoncPath = path.resolve(process.cwd(), 'settings.jsonc');

  // Простая функция удаления комментариев из JSONC (// ... и /* ... */)
  const stripJsonComments = (input: string): string => {
    // Удаляем блоки /* ... */
    let out = input.replace(/\/\*[\s\S]*?\*\//g, '');
    // Удаляем построчные // ... до конца строки
    out = out.replace(/(^|[^:])\/\/.*$/gm, (m, g1) => (g1 === undefined ? '' : g1));
    return out;
  };

  const readJsonc = (): any | null => {
    if (!fs.existsSync(jsoncPath)) return null;
    try {
      const raw = fs.readFileSync(jsoncPath, 'utf-8');
      const cleaned = stripJsonComments(raw);
      return JSON.parse(cleaned);
    } catch (e) {
      return null;
    }
  };

  const parsed = readJsonc();
  if (!parsed) return DEFAULT_SETTINGS;
  try {
    // Deep merge for capture and cv blocks
    const mergedCv = { ...DEFAULT_SETTINGS.cv, ...(parsed.cv || {}) } as any;
    // Deep-merge ocr block to preserve defaults like engine/tesseractPath
    mergedCv.ocr = { ...(DEFAULT_SETTINGS.cv as any).ocr, ...((parsed.cv || {}).ocr || {}) };
    const merged: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...parsed,
      actions: { ...DEFAULT_SETTINGS.actions, ...(parsed.actions || {}) },
      capture: { ...DEFAULT_SETTINGS.capture, ...(parsed.capture || {}) },
      cv: mergedCv,
    } as AppSettings;
    return merged;
  } catch (e) {
    // При ошибке чтения/парсинга возвращаем дефолты, чтобы не падать на старте
    return DEFAULT_SETTINGS;
  }
}
