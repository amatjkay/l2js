# Lineage 2 Spoiler Bot (Node.js + TypeScript)

Проект: бот-спойлер для Lineage 2 на Windows. Реализация на Node.js + TypeScript. Захват экрана через `screenshot-desktop`, компьютерное зрение на базе WebAssembly OpenCV (`@techstark/opencv-js`), каркас FSM для игровых состояний.

---

## Содержание
- Введение и архитектура
- Требования
- Установка и запуск
- Конфигурация (`settings.json`)
- Как это работает (CV пайплайн)
- FSM и дальнейшая интеграция
- Логи и диагностика
- Типичные проблемы и решения
- Планы развития

---

## Введение и архитектура
- Ядро: Node.js + TypeScript, строгая типизация, логирование через `winston`.
- Захват экрана: `screenshot-desktop` (без нативных зависимостей).
- Компьютерное зрение: `@techstark/opencv-js` (OpenCV.js в WebAssembly) — работает без `node-gyp/MSBuild`.
- Машина состояний (FSM): каркас для этапов фарма/спойла, расширяемый состояниями `Boot`, `Scan`, `Target`, `Idle` и т. п.
- Структура каталогов (основное):
  - `src/core` — инфраструктура (Logger, Config, CV init, Capture, SmokeTest)
  - `src/spoiler` — FSM, состояния и логика бота
  - `captures` — сохранённые кадры (по настройкам)
  - `logs` — логи приложений и диагностические изображения (см. debug)

---

## Требования
- Windows 10/11
- Node.js LTS (v20.x проверено)
- npm 10+
- VSCode/IDE по вкусу

Нативные инструменты (MSBuild, Python) не требуются для OpenCV.js (WebAssembly).

---

## Установка и запуск
1) Установка зависимостей:
```
npm install
```

2) Режим разработки (ts-node):
```
npm run dev
```

3) Продакшн-сборка и запуск:
```
npm run build
npm start
```

Ожидаемый вывод при старте dev:
- `OpenCV.js initialised. Version: …`
- `— Starting smoke test for contours —`
- `Contours found: N`
- `Timings(ms): capture+roi=…, toMat=…, gray=…, threshold=…, morph=…, contours=…`
- `— Smoke test completed —`

А при работе FSM (`ScanState`) в логах появляются сводные метрики пайплайна:
```
scanForTargets: fullFrame=F, afterROI=R, afterAreaFilter=A, afterSizeFilter=S, afterMerge=M, area[min/avg/max]=…/…/…, time=…ms
```
и сообщение о сохранении отчёта целей:
```
bboxes.json saved to C:\dev\l2js\logs\images\<timestamp>\bboxes.json
```

---

## Конфигурация (settings.json)
Файл: `settings.json`

Минимальная конфигурация:
```
{
  "logRetentionMinutes": 10,
  "capture": {
    "saveLastFrame": true,
    "outputDir": "captures",
    "format": "png",
    "debug": true
  },
  "cv": {
    "thresholdValue": 200,
    "thresholdType": "THRESH_BINARY",
    "morphKernelSize": [50, 5],
    "morphShape": "MORPH_RECT",
    "roi": { "x": 0, "y": 120, "width": 1920, "height": 740 },
    "minArea": 100,
    "maxArea": 10000,
    "minWidth": 50,
    "minHeight": 8,
    "maxWidth": 350,
    "maxHeight": 20,
    "maxWordGapPx": 30,
    "maxBaselineDeltaPx": 6
  }
}
```
- `capture.debug`: если true — сохраняет диагностические изображения (raw ROI, grayscale, threshold, morphology) и bboxes.json в `logs/images/<timestamp>/`.
- `cv.minArea/maxArea`: фильтрация контуров по площади.
- `cv.minWidth/minHeight/maxWidth/maxHeight`: доп. фильтрация по габаритам bbox (оставляем горизонтальные текстовые метки).
- `cv.maxWordGapPx/maxBaselineDeltaPx`: объединение соседних сегментов строки в один bbox (учёт пробелов в имени моба).
- `cv.thresholdType`: одно из `THRESH_BINARY`, `THRESH_BINARY_INV`, `THRESH_OTSU` и т. д.
- `cv.morphShape`: `MORPH_RECT`, `MORPH_ELLIPSE`, `MORPH_CROSS`.
- `cv.roi`: регион интереса. Если `width/height == 0`, используется весь кадр. Планируется поддержка изменения ROI «на лету».

Примечание: ROI используется как отдельный этап анализа. Пайплайн считает:
- `fullFrame` — число контуров на всём кадре;
- `afterROI` — число контуров внутри ROI;
- `afterAreaFilter` — число контуров после фильтрации по площади (`minArea/maxArea`);
- `afterSizeFilter` — число целей после фильтрации по размерам bbox (min/max width/height);
- `afterMerge` — число целей после объединения сегментов строки (несколько слов/пробелов → 1 bbox).
Координаты целей в `bboxes.json` приводятся к абсолютным экранным координатам (смещение ROI уже учтено). Targets сохраняются уже ПОСЛЕ объединения.

---

## Как это работает (CV пайплайн)
- Захват экрана → PNG буфер (`screenshot-desktop`).
- Декодирование PNG → RGBA (`pngjs`).
- Кадрирование по ROI (если задан) ещё на этапе RGBA (до `cv.Mat`) — экономит память/время.
- Формирование `cv.Mat(CV_8UC4)` из RGBA, затем конвертация в grayscale.
- Пороговая бинаризация (`cv.threshold`).
- Морфологическое закрытие (`cv.morphologyEx` с ядром из настроек).
- Поиск контуров (`cv.findContours`) и лог числа контуров.
- Освобождение всех Mat/временных объектов.

Файл: `src/core/SmokeTest.ts` — демонстрация основной цепочки.
Файл: `src/core/Scan.ts` — основная логика сканирования для FSM (подсчёт fullFrame/afterROI/afterAreaFilter/afterSizeFilter/afterMerge, сохранение bboxes.json с абсолютными координатами целей). Включает постобработку объединения сегментов одной строки по параметрам `maxWordGapPx` и `maxBaselineDeltaPx`.

---

## FSM и дальнейшая интеграция
- FSM уже подключена (см. `src/spoiler/StateMachine.ts`, `src/spoiler/states/BootState.ts`).
- Планируемые состояния:
  - `ScanState`: запуск CV пайплайна `scanForTargets()`, сохранение результатов в `ctx.targets`.
    - Формат результата: `Target[]` с полями `{ bbox:{x,y,width,height}, area, cx, cy }`.
    - Контекст FSM: `IStateContext` содержит `targets: Target[]`.
  - `TargetState`: наведение/действия (в т. ч. нажатия клавиш/Windows API).
  - `IdleState`: ожидание/повтор сканирования.
- Метрики: время шагов пайплайна, число контуров, площади/центры — будут логироваться и, при debug=true, сопровождаться снимками.

---

## Логи и диагностика
- Логи пишутся `winston` в папку `logs`, автоочистка старше `logRetentionMinutes`.
- Отдельные скрипты команд запускаются через PowerShell-обёртку (сохранение последних ~10 минут логов).
- При `capture.debug=true` сохраняются диагностические PNG в `logs/images/<timestamp>/`.

---

## Типичные проблемы и решения
- `OpenCV.js version: undefined/unknown` — допустимо для некоторых сборок WASM; функции CV при этом работают.
- Проблемы с импортом OpenCV.js в Node:
  - Убедитесь, что импорт идёт из `@techstark/opencv-js`.
  - Инициализация выполняется через `initCV()` до вызова любых CV-функций.
- Если число контуров неожиданно мало/много — настроить `thresholdValue`, `thresholdType`, `morphKernelSize`, `morphShape`, `roi`.

---

## Планы развития
- Интеграция `ScanState` + `scanForTargets()` в FSM; хранение bbox в контексте и переходы.
- Расширенное логирование метрик (площадь, центры, размер bbox) и публикация в отчётах.
- (Опционально) OCR (`tesseract.js`) и шаблонный матчинг (`cv.matchTemplate`) для меток/иконок.
