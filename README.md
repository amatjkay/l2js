# Lineage 2 Spoiler Bot (Node.js + TypeScript)

Проект: бот-спойлер для Lineage 2 на Windows. Реализация на Node.js + TypeScript. Захват экрана через `screenshot-desktop`, компьютерное зрение на базе WebAssembly OpenCV (`@techstark/opencv-js`), каркас FSM для игровых состояний.

---

## Arduino E2E Testing

Финальная конфигурация (фрагмент settings.json):
```
"actions": {
  "enableActions": true,
  "mode": "arduino",
  "serial": { "port": "COM5", "readTimeoutMs": 1500, "retries": 3 },
  "camera": { "dxMin": -90, "dxMax": 90, "pauseMs": 1200 },
  "delays": { "beforeMoveMs": 50, "afterMoveMs": 100, "beforeClickMs": 30, "afterClickMs": 80 },
  "clickOffsetY": 35
},
"capture": { "debug": true }
```

Чек‑лист запуска:
- Проверить, что Arduino на COM5 (или скорректировать settings.json → actions.serial.port).
- Активировать окно игры (title начинается с "LU4", processFileExact="lu4.bin").
- Запуск: `npm run dev`.
- Наблюдать логи:
  - `serial: cold-open 2.5s` (первый доступ к Serial);
  - `scanForTargets: fullFrame=..., afterROI=..., ..., afterMerge=...`;
  - при наличии целей: `chosenTarget: id=..., bbox=(x,y,w,h), distPx=..., dx=..., dy=...`, затем `==> BIGMOVE dx dy`, `==> LCLICK`;
  - при отсутствии целей: `==> CAMERA dx 0` и повтор сканирования;
  - при неактивном окне: `Skip serial "COMMAND" because game window is not active`.

Параметры и их влияние:
- `actions.camera.dxMin/dxMax`: амплитуда случайного поворота камеры в отсутствии целей; `pauseMs` — пауза на стабилизацию сцены перед повторным сканом.
- `actions.delays.*`: микропаузы до/после перемещения и клика для устойчивости исполнения через Arduino.
- `actions.clickOffsetY`: вертикальное смещение курсора перед кликом (в пикселях; по умолчанию 35). Положительное значение смещает вниз, помогает кликать чуть ниже центра bbox.


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

Актуальный пример конфигурации:
```
{
  "logRetentionMinutes": 10,
  "capture": {
    "saveLastFrame": true,
    "outputDir": "captures",
    "format": "png",
    "debug": true
  },
  "actions": {
    "enableActions": true,
    "moveDelayMs": 10,
    "clickDelayMs": 50,
    "mode": "arduino",
    "serial": {
      "port": "COM5",
      "baudRate": 115200,
      "writeTimeoutMs": 300,
      "readTimeoutMs": 1500,
      "retries": 3
    },
    "camera": { "dxMin": 30, "dxMax": 30, "pauseMs": 200 },
    "delays": { "beforeMoveMs": 20, "afterMoveMs": 100, "beforeClickMs": 20, "afterClickMs": 50 },
    "clickOffsetY": 35
  },
  "cv": {
    "thresholdValue": 190,
    "thresholdType": "THRESH_BINARY",
    "morphKernelSize": [48, 4],
    "morphShape": "MORPH_RECT",
    "roi": { "x": 0, "y": 120, "width": 1920, "height": 740 },
    "selection": { "referencePoint": "screenCenter" },
    "minArea": 70,
    "maxArea": 10000,
    "minWidth": 20,
    "minHeight": 12,
    "maxWidth": 350,
    "maxHeight": 50,
    "maxWordGapPx": 50,
    "maxBaselineDeltaPx": 6,
    "exclusionZones": [ { "x": 0, "y": 560, "width": 1920, "height": 180 } ],
    "flatness": {
      "stdThreshold": 1.2,
      "minFlatRatio": 0.6,
      "minValleyRatio": 0.45,
      "minSplitWidth": 20
    }
  }
}
```
- `capture.debug`: если true — сохраняет диагностические изображения (raw ROI, grayscale, threshold, morphology и overlay-версии с bbox и подписями) и bboxes.json в `logs/images/<timestamp>/`.
- `cv.minArea/maxArea`: фильтрация контуров по площади.
- `cv.minWidth/minHeight/maxWidth/maxHeight`: доп. фильтрация по габаритам bbox (оставляем текстовые метки; увеличенный `maxHeight` позволяет учитывать случаи, когда два имени расположены друг над другом и должны засчитываться как отдельные цели).
- `cv.maxWordGapPx/maxBaselineDeltaPx`: объединение соседних сегментов строки в один bbox (учёт пробелов в имени моба). Для длинных имён можно повышать `maxWordGapPx`.
- `cv.exclusionZones`: список прямоугольников в абсолютных координатах экрана, где цели исключаются (например, нижняя UI-полоса).
- `cv.flatness`: параметры эвристики «ровности» базовой линии и разделения слипшихся боксов по вертикальной «долине» (минимуму плотности столбцов) в морфологически закрытом изображении.
 - `actions.enableActions`: если false — режим dry‑run (только логи, без движений/кликов). Если true — включаются действия (перемещение курсора и клик через PowerShell/user32.dll или Arduino).
 - `actions.moveDelayMs/clickDelayMs`: базовые задержки после перемещения/клика.
 - `actions.serial.readTimeoutMs/retries`: диагностика Serial (таймаут чтения и число ретраев для `ping/status` и команд).
 - `actions.camera`: параметры случайного поворота камеры в `ScanState` при отсутствии целей.
 - `actions.delays`: безопасные паузы вокруг наведения и клика в `TargetState`.
 - `cv.selection.referencePoint`: выбор точки отсчёта для таргетинга (`screenCenter` | `cursorPosition`).
- `cv.thresholdType`: одно из `THRESH_BINARY`, `THRESH_BINARY_INV`, `THRESH_OTSU` и т. д.
- `cv.morphShape`: `MORPH_RECT`, `MORPH_ELLIPSE`, `MORPH_CROSS`.
- `cv.roi`: регион интереса. Если `width/height == 0`, используется весь кадр. Планируется поддержка изменения ROI «на лету».

Примечание: ROI используется как отдельный этап анализа. Пайплайн считает и логирует:
- `fullFrame` — число контуров на всём кадре;
- `afterROI` — число контуров внутри ROI;
- `afterAreaFilter` — число контуров после фильтрации по площади (`minArea/maxArea`);
- `afterSizeFilter` — число целей после фильтрации по размерам bbox (min/max width/height);
- `afterExclusion` — число целей после исключения зон (`exclusionZones`);
- `afterFlatness` — число целей после эвристики «ровности»/разделения;
- `afterMerge` — число целей после объединения сегментов одной строки (несколько слов/пробелов → 1 bbox).
Координаты целей в `bboxes.json` приводятся к абсолютным экранным координатам (смещение ROI уже учтено). Targets сохраняются уже ПОСЛЕ объединения.

---

## Arduino mode и безопасность
- Режим: `actions.mode="arduino"` активирует команды Arduino Leonardo/Micro (CAMERA, BIGMOVE, SCROLL, pressKey, LCLICK).
- FocusGuard: действия выполняются только если активно окно игры (titleRegex, processFileExact). При блокировке в лог пишутся активные `title/processFile/className/hwnd`.
- Диагностика Serial: при первом обращении ожидается лог `serial: cold-open 2.5s`. Для нестабильной связи увеличьте `actions.serial.readTimeoutMs` и `actions.serial.retries`.
- Безопасность: включайте `actions.enableActions=true` только при активном окне игры. Для сухих прогонов установите `false`.

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
Файл: `src/core/Scan.ts` — основная логика сканирования для FSM (подсчёт fullFrame/afterROI/afterAreaFilter/afterSizeFilter/afterExclusion/afterFlatness/afterMerge, сохранение bboxes.json с абсолютными координатами целей). Постобработка включает:
- объединение сегментов одной строки (`maxWordGapPx`, `maxBaselineDeltaPx`),
- эвристику «ровности» верхней/нижней кромок и разрезание слипшихся боксов по «долине» плотности в `closedRoi` (управляется блоком `flatness`),
- отрисовку overlay-изображений с зелёными bbox и подписями `#index (x,y,w,h)` для быстрой валидации.

---

## FSM и дальнейшая интеграция
- FSM уже подключена (см. `src/spoiler/StateMachine.ts`, `src/spoiler/states/BootState.ts`).
- Планируемые состояния:
  - `ScanState`: запуск CV пайплайна `scanForTargets()`, сохранение результатов в `ctx.targets`.
    - Формат результата: `Target[]` с полями `{ bbox:{x,y,width,height}, area, cx, cy }`.
    - Контекст FSM: `IStateContext` содержит `targets: Target[]`.
  - `TargetState`: наведение/действия. При наличии целей перемещает курсор в центр top‑цели и выполняет клик. Если `actions.enableActions=false`, выполняется безопасный dry‑run (только логи).
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
