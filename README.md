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
}

---

## Боевой запуск (Overlay UI + FSM)

Короткие шаги для «боевого» прогона со всеми действиями (Arduino):

1) Сборка и запуск сервера оверлея:
   - `npm run build`
   - `node dist/index.js` (сервер поднимется на http://localhost:3000)
2) Подключите Arduino (COM5 по умолчанию; поменяйте `actions.serial.port` при необходимости).
3) Убедитесь, что окно игры активно или может быть активировано автоматически:
   - `actions.focusCheck.autoActivate=true`
   - точное совпадение заголовка: `"LU4  "` (две пробела после 4)
4) Откройте Overlay UI в браузере и нажмите Start — FSM перейдёт к свип‑сканированию.

Что происходит дальше:
- Выполняется детерминированный свип‑цикл до появления целей: `plain → scroll up → plain → scroll down → …`.
- После каждого шага сканирования сохраняются диагностические артефакты в `logs/images/<timestamp>/`:
  - `bboxes.json` с метриками всех стадий и итоговыми боксами (в абсолютных координатах экрана);
  - `*_overlay.png` с визуализацией bbox;
  - при `cv.ocr.debugSaveCrops=true` — кропы для OCR в `ocr_crops/`.

Важные условия для появления OCR‑результатов в `bboxes.json`:
- `capture.debug=true` и `cv.ocr.enabled=true` — только при обоих флагах в отчёт добавляется секция `ocr`/`afterOCR`.
- Для тонкой настройки используйте блок `cv.ocr` (см. раздел ниже).

Безопасность и клики:
- Действия исполняются только при активном окне игры (см. `docs/FocusGuard.md`).
- Вертикальный сдвиг курсора перед кликом регулируется `actions.clickOffsetY` (по умолчанию 35), чтобы кликать чуть ниже центра bbox.

---

## OCR: настройки и эвристики

Цель: уверенно распознавать короткие одно‑строчные имена целей поверх шумного игрового фона и помечать их зелёными боксами.

Ключевые опции в `settings.json` → `cv.ocr`:

- `enabled`: включение OCR‑фильтра.
- `engine`: движок OCR (`"auto"` | `"native"` | `"tesseract"`). `"auto"` попробует Tesseract.js, затем fallback на нативный Tesseract.
- `lang`: язык модели (по умолчанию `eng`).
- `psm`: рекомендуем 7 (single line). Для отдельных кейсов можно тестировать 8 (single word) и 6 (block), но 7 — базовый.
- `minConfidence`: базовый порог уверенности (0–100). Мы также считаем «мягкий» порог для совпадений из списка при `acceptList`.
- `whitelist`: допустимые символы (`A-Za-z0-9._-`). Если теряются буквы — попробуйте временно отключить whitelist, чтобы проверить влияние.
- `maxPerFrame`: ограничение OCR по количеству кропов кадра (для контроля времени).
- `source`: `binary` или `gray`. В рантайме применяется мульти‑проход (см. ниже), а сюда логируется «предпочитаемый» источник.
- `padding`: доп. поля вокруг bbox при кропе под OCR (пиксели). Обычно 8–12 достаточно.
- `acceptList`: список целевых имён. Совпадения с ним упрощают прохождение фильтра и логируются как `OCR acceptList hit`.
- `acceptFuzzyMaxDist`: зарезервировано для нестрогого (фаззи) совпадения. По умолчанию 2.
- `acceptHard`: если `true` — при совпадении с `acceptList` цель можно принять даже при низком `confidence` (жёсткая эвристика для повышения recall). Все такие факты логируются как `OCR acceptHard: force-accept ...`.
- `acceptHardMinConf`: минимальный `confidence` для `acceptHard` (обычно 0–10).

### Посткликовая валидация цели (TargetState)
После выбора цели курсором выполняется немедленная проверка HP‑плашки:
- Перед кликом читается ожидаемое имя из узкой полосы над bbox цели (предкликовый OCR).
- Сразу после клика считывается текст HP‑плашки (hpText) в заданном ROI.
- Правила принятия/игнора:
  - Если `hpText` в `acceptList` (без учёта регистра) — цель всегда принимается, никогда не игнорируется.
  - Если предкликовый `expectedTitle` пуст, но `hpText` есть — допускается (OCR заголовка мог не сработать).
  - Если `expectedTitle` в `acceptList` — допускается.
  - Иначе требуется, чтобы `hpText` содержал `expectedTitle` (contains). При несоответствии цель немедленно попадает в ignore.
  - Также учитывается игнор по тексту (если `hpText` есть в ignore‑лист по именам).
- Персистентный ignore‑лист сохраняется в `logs/ignore-list.json` и содержит координаты и имя ложной цели. У записей есть TTL и радиус действия.

Параметры:
- `cv.lock.titleRoiPx` — высота полосы предкликового OCR над bbox (по умолчанию 40 пикс.).
- `cv.lock.minNameLength` — минимальная длина валидного имени для отсечения мусора (например, "Te").
- `cv.lock.ignoreRadiusPx` — радиус, в котором игнорируется повторный таргет этой точки (по умолчанию 48 пикс.).
- `cv.lock.ignoreTtlMs` — TTL записи игнора (по умолчанию 120000 мс).

Важно:
- Полоса OCR фиксирована над bbox, не сдвигается. Смещение применяется только курсору клика через `actions.clickOffsetY` (по умолчанию 35), чтобы кликать чуть ниже имени. Параметр `titleOffsetYPx` не используется.

Что реализовано в пайплайне:
- Агрегация уверенности: если `ret.data.confidence` у tesseract.js равен 0, берём среднее по словам или символам (`words/symbols`).
- Мульти‑проход OCR: для каждого кропа пробуем и `binary`, и `gray` вариант, выбираем лучший по `confidence` (лог сохраняет базовый `source` для наглядности).
- Мягкий порог для `acceptList`: если имя попало в `acceptList`, допускаем `confidence` на ~10 пунктов ниже `minConfidence`.
- Жёсткое принятие (`acceptHard`): если включено и было совпадение с `acceptList`, можно принять цель даже при низком `confidence` (например, 0), что резко увеличивает вероятность пометить все реальные цели.

Где смотреть диагностику:
- `logs/images/<timestamp>/bboxes.json` — итоговый отчёт детекции, секция `ocr.results` и поля `afterOCR`, `final`.
- `logs/images/<timestamp>/ocr_crops/*.png` — входные кропы для OCR (если `debugSaveCrops=true`).
- `03_threshold_overlay.png` — визуальный слой пороговой обработки для контроля областей (помогает обнаруживать ложные боксы).

Как настроить под сцену:
1) Увеличьте `padding` с 8 до 10–12, если обрезаются крайние буквы.
2) Снизьте `minConfidence` с 55 до 45–50, если реальных целей мало; верните выше при росте ложных.
3) Измените `source` на `gray` для сцен с сильной антиалиасинг‑смазкой; мульти‑проход всё равно попробует оба варианта.
4) При частых потерях букв — временно уберите `whitelist` (для диагностики влияния) и верните обратно.
5) Для максимального recall включите `acceptHard=true` (по умолчанию включено) и подберите `acceptHardMinConf`.

Быстрая проверка:
- Запустите `npm run build` и затем тестовый скан: `tools/terminal-logger.ps1 -- node dist/dev/run-scan.js`.
- Ориентируйтесь на сводку: `afterOCR=N, final=N` и `OCR acceptList hit`/`OCR acceptHard: force-accept` в логах.

Борьба с ложными целями:
- Идентифицируйте id ложных боксов на изображениях `*_overlay.png` и в `bboxes.json`.
- При необходимости поднимите `minConfidence` на 5–10 пунктов, уменьшите `padding` на 2 пикс., или временно отключите `acceptHard` для проверки.
- Дополнительно помогает ужесточение морфологии (уменьшить ядро dilate/close) и фильтры ровности baseline (если включены в настройках размера/flatness).

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
- OCR: настройки и эвристики
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

## Overlay UI (веб-интерфейс)
В проект встроен минимальный веб‑оверлей для управления FSM и тестами, просмотра логов и редактирования настроек в рантайме.

- Запуск: после `npm run build && npm start` сервер доступен на http://localhost:3000
  - Внизу страницы отображается футер вида: `Overlay build: <YYYY-MM-DDTHH-MM-SSZ>` — это маркер версии фронта (cache-busting). Если футера нет, у вас старая версия скрипта/кэш в браузере.
  - Тег скрипта отдаётся с параметром версии: `<script src="/app.js?v=<buildTag>">`, что гарантирует подгрузку свежего `app.js`.
- Кнопки:
  - Start — запускает FSM (повторно нажимать не нужно).
  - Stop — останавливает FSM (останавливает цикл сканирования/переходов).
  - Exit — завершает приложение.
- Tests:
  - Ping — проверка API/ивент‑стрима.
  - Capture — делает одиночный кадр и сохраняет его согласно `capture.*`.
  - Smoke — быстрый тест CV‑пайплайна (см. ниже).
- Config:
  - Поля отображают текущие значения настроек (авто‑подгрузка при изменении статуса FSM или при открытии страницы).
  - Кнопка Load — принудительно перечитать `settings.json` в форму.
  - Кнопка Save — отправить изменения на сервер (только те поля, что представлены в UI). Остальные опции берутся из файла как есть.
- Логи:
  - В реальном времени отображаются сообщения, помеченные уровнем `[INFO] | [WARN] | [ERROR]`.
  - Логи FSM префиксуются текущим состоянием в квадратных скобках, например: `[Scan] ...`, `[Target] ...`.
  - Когда FSM запущена, в UI показываются только логи её активного состояния (для удобства диагностики).
- Уведомления:
  - В верхней части отображаются короткие уведомления при `Start`, `Stop`, смене состояния FSM.
  - Уведомления исчезают автоматически через ~5 секунд.

Требования к браузеру: лучше открывать в приватном окне без расширений. Если в консоли видите сообщения от расширений (например, про `ethereum`), они не влияют на работу оверлея.
  - При «залипшем» старом фронте сделайте жёсткое обновление (Ctrl+F5) или откройте в приватном окне; можно также явно зайти на `http://localhost:3000/app.js?v=123` и проверить, что первые строки — `(function(){\n  "use strict";`.

### Быстрые подсказки при «старом оверлее»
- Проверьте, что сервер перезапущен и порт 3000 свободен. Если видите `EADDRINUSE`, освободите порт:
  - `Stop-Process -Name node -Force` (убьёт все процессы node), либо
  - `netstat -ano | findstr :3000` → `taskkill /PID <PID> /F`.
- Пересоберите проект: `npm run build` → затем `node dist/index.js`.
- Откройте страницу в приватном окне и убедитесь, что внизу есть футер `Overlay build: ...`, а `<script src="/app.js?v=...">` содержит параметр `v`.

### Smoke test — что это и как пользоваться
Smoke test — быстрый самотест CV‑пайплайна, чтобы убедиться, что OpenCV.js и базовые шаги обработки работают корректно.

Что делает:
- инициализирует OpenCV.js (WASM),
- получает кадр (по настройкам `capture.*`),
- применяет: threshold → morphologyEx → findContours,
- логирует время шагов и количество контуров,
- при `capture.debug=true` сохраняет диагностические изображения по стадиям и `bboxes.json` в `logs/images/<timestamp>/`.

Когда запускать:
- при первом запуске, чтобы проверить стек CV и параметры порогов/морфологии,
- после изменения `settings.json` (threshold/morph/ROI) — для быстрой проверки, не включая полный FSM.

Как запускать:
- через Overlay UI — кнопка `Smoke`,
- или скриптом, если предусмотрено: `npm run smoke` (опционально).

Результаты:
- В логах видны счётчики: `fullFrame`, `afterROI`, `afterAreaFilter`, `afterSizeFilter`, `afterExclusion`, `afterFlatness`, `afterMerge`.
- При `debug=true` папка `logs/images/<timestamp>/` содержит диагностические PNG и `bboxes.json` с абсолютными координатами целей.

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
    "camera": { "dxMin": 30, "dxMax": 30, "pauseMs": 200,
      "dxStep": 120, "circleSteps": 36, "stepPauseMs": 200, "sweepPauseMs": 500,
      "scrollUpAmount": 1, "scrollDownAmount": -1,
      "tiltDyMax": 3,
      "scrollRandom": true, "scrollMin": 1, "scrollMax": 15
    },
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
 - `actions.camera.tiltDyMax`: максимальный по модулю случайный наклон камеры по оси Y. В `ScanState` при свипе dy выбирается СЛУЧАЙНО НА КАЖДОМ ШАГЕ из диапазона `[-tiltDyMax; +tiltDyMax]` и передаётся в `cameraRotate(stepDx, dy)`.
 - `actions.camera.scrollRandom`: если true — между кругами выполняется случайная прокрутка колёсиком: случайное направление (вверх/вниз) и случайное количество тиков.
 - `actions.camera.scrollMin/scrollMax`: нижняя/верхняя границы количества тиков прокрутки при `scrollRandom=true`.
 - `actions.camera.dxStep/circleSteps/stepPauseMs/sweepPauseMs`: параметры свипа (шаг, число шагов на круг, пауза между шагами и пауза между кругами).
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
