import fs from 'fs';
import path from 'path';

/**
 * Глобальная конфигурация приложения. Загружается из settings.json в корне проекта,
 * поверх дефолтов. Используется для логирования, захвата экрана и параметров CV.
 */
export interface AppSettings {
  logRetentionMinutes: number;
  capture: {
    saveLastFrame: boolean;
    outputDir: string;
    format: 'png' | 'jpg';
    debug?: boolean;
  };
  actions?: {
    enableActions?: boolean;
    moveDelayMs?: number;
    clickDelayMs?: number;
    mode?: 'powershell' | 'arduino';
    /** Дополнительное смещение курсора по оси Y перед кликом (положительное значение смещает вниз). */
    clickOffsetY?: number;
    /** Параметры проверки/автоактивации фокуса окна игры */
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
    /** Параметры сопоставления окна игры для FocusGuard */
    windowMatch?: {
      titleEquals?: string;
      titleRegex?: string;
      processName?: string;
      processFileExact?: string;
      classNameEquals?: string;
      classNameRegex?: string;
    };
    serial?: {
      port?: string; // e.g. 'COM5'
      baudRate?: number; // 115200
      writeTimeoutMs?: number; // 300
      readTimeoutMs?: number; // 800
      retries?: number; // 1-2
    };
    camera?: {
      dxMin?: number; dxMax?: number; pauseMs?: number; scale?: number; repeats?: number;
      /** Размер шага поворота камеры по горизонтали за один тик (в относительных единицах dx) */
      dxStep?: number;
      /** Количество шагов для полного круга (360°) */
      circleSteps?: number;
      /** Пауза между шагами поворота, чтобы OCR успевал */
      stepPauseMs?: number;
      /** Пауза после завершения круга перед следующим действием */
      sweepPauseMs?: number;
      /** Количество кликов прокрутки вверх между кругами (маусапп колесиком) */
      scrollUpAmount?: number;
      /** Количество кликов прокрутки вниз между кругами (маусдаун колесиком) */
      scrollDownAmount?: number;
      /** Включить рандомизацию прокрутки: случайное направление и количество */
      scrollRandom?: boolean;
      /** Минимальное количество тиков прокрутки при рандоме */
      scrollMin?: number;
      /** Максимальное количество тиков прокрутки при рандоме */
      scrollMax?: number;
      /** Максимальный по модулю случайный наклон по оси Y на один круг (dy), выбирается для каждого круга случайно в диапазоне [-tiltDyMax; +tiltDyMax] */
      tiltDyMax?: number;
    };
    delays?: { beforeMoveMs?: number; afterMoveMs?: number; beforeClickMs?: number; afterClickMs?: number };
  };
  cv?: {
    thresholdValue?: number;
    thresholdType?: string; // e.g. 'THRESH_BINARY'
    morphKernelSize?: [number, number];
    morphShape?: string; // e.g. 'MORPH_RECT'
    roi?: { x: number; y: number; width: number; height: number };
    selection?: { referencePoint?: 'screenCenter' | 'cursorPosition' };
    /** Минимальная/максимальная площадь контура для фильтрации. */
    minArea?: number;
    maxArea?: number;
    /** Доп. фильтрация по габаритам прямоугольника */
    minWidth?: number;
    minHeight?: number;
    maxWidth?: number;
    maxHeight?: number;
    /** Параметры объединения сегментов текста (пробелы внутри одной строки) */
    maxWordGapPx?: number;        // максимальный горизонтальный зазор между сегментами для слияния
    maxBaselineDeltaPx?: number;  // допуск по вертикали (по базовой линии), чтобы считать сегменты одной строкой
    /** OCR-фильтрация распознанного текста внутри bbox */
    ocr?: {
      /** Движок OCR: встроенный tesseract.js или внешний нативный Tesseract */
      engine?: 'js' | 'native';
      enabled?: boolean;           // включить фильтрацию целей по тексту
      lang?: string;               // язык OCR, по умолчанию 'eng'
      psm?: number;                // page segmentation mode, напр. 7 (single line)
      minConfidence?: number;      // минимальная уверенность (0..100)
      whitelist?: string;          // допустимые символы (например, только буквы A-Za-z)
      /** Путь к tesseract.exe для режима 'native' (Windows). Если не задан, пробуем стандартный путь и PATH. */
      tesseractPath?: string;
      /** Источник изображения для OCR: бинаризованный (после threshold) или исходный gray */
      source?: 'gray' | 'binary';
      /** Отступ (padding) вокруг bbox при вырезке кропа для OCR, в пикселях */
      padding?: number;
      maxPerFrame?: number;        // ограничение числа OCR-вызовов за кадр
      timeoutMs?: number;          // таймаут на один вызов OCR
      debugSaveCrops?: boolean;    // сохранять вырезки OCR для диагностики
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
  const settingsPath = path.resolve(process.cwd(), 'settings.json');
  if (!fs.existsSync(settingsPath)) return DEFAULT_SETTINGS;
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    const parsed = JSON.parse(raw);
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
