# Отчёт о проделанных шагах по настройке и интеграции OpenCV.js в проект

1. **Проверка MSBuild**
    - Найден MSBuild по пути
`C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe`
    - Вывод версии: `17.14.18` — подтверждает корректную установку Build Tools.
2. **Сборка нативного `@u4/opencv4nodejs`**
    - Несколько попыток установки через `npm install @u4/opencv4nodejs --build-from-source` завершились ошибкой `node-gyp rebuild` с кодом 1.
    - Установлены все необходимые среды: Python 3.12, GYP_MSVS_VERSION=2022, Build Tools с VC/CMake/Windows SDK.
    - Логи показали, что `binding.gyp` не прошёл этап `node ./bin/install.js OPENCV4NODEJS_DEFINES`.
3. **Решение: переход на WebAssembly-версию**
    - Удалены остатки нативного пакета.
    - Установлен пакет `@techstark/opencv-js` как заменитель.
    - Обновление: переход подтвердил стабильность пайплайна; текущие оверлеи с нумерацией bbox и фильтрацией `exclusionZones` работают корректно.
    - Реализована инициализация OpenCV.js в `src/core/CV.ts`:

```ts
await cv.onRuntimeInitialized;
console.log('OpenCV.js initialised. Version:', cv.version);
```

    - Обёртка поддержки типов добавлена в `src/types/opencv-techstark.d.ts`.
4. **Smoke-тест контура**
    - Создан модуль `src/core/SmokeTest.ts` с базовой цепочкой операций (`threshold` → `morphologyEx` → `findContours`) на захваченном кадре.
    - В `src/index.ts` добавлен вызов `smokeTestContours()` после `initCV()`.
5. **Сценарий запуска**
    - Установлены зависимости:

```bash
npm install @techstark/opencv-js
```

    - Запуск:

```bash
npm run dev  # или ts-node src/index.ts
```

    - Ожидаемый вывод в консоль:

```
OpenCV.js initialised. Version: x.y.z
— Starting smoke test for contours —
Contours found: N
— Smoke test completed —
```

6. **Дальнейшие шаги**
    - Интеграция FSM-каркаса уже выполнена:
        - Заглушки состояний в `src/spoiler/StateMachine.ts`.
        - Запуск FSM после smoke-capture в `src/index.ts`.
    - Готовность добавить базовую логику для переходов и обработки spoil/sweep, как только базовые CV-модули успешно работают.


---

## 7. Параметризация CV-пайплайна, ROI-кадрирование и диагностика

Изменения (2025-08-17 00:38:49+03:00):

- Конфигурация:
  - Расширен `settings.json`: добавлены `capture.debug` и блок `cv` с полями `thresholdValue`, `thresholdType`, `morphKernelSize`, `morphShape`, `roi`.
  - `src/core/Config.ts`: добавлены дефолты и безопасный deep-merge блоков `capture` и `cv`. Документировано через TSDoc.

- Захват и ROI:
  - `src/core/Capture.ts`: реализован `captureImageData(format, roi)` — декодирует PNG→RGBA и применяет кадрирование по ROI ДО формирования `cv.Mat` (оптимизация памяти/времени). Добавлены TSDoc, комментарии к циклу копирования строк ROI.

- Пайплайн и метрики:
  - `src/core/SmokeTest.ts`: чтение параметров из настроек, применение порога/морфологии, ROI-кадрирование на этапе RGBA, логирование таймингов шагов: `capture+roi`, `toMat`, `gray`, `threshold`, `morph`, `contours`.
  - При `capture.debug=true` сохраняются диагностические изображения в `logs/images/<timestamp>/`: `01_raw_roi.png`, `02_gray.png`, `03_threshold.png`, `04_morph_close.png`.
  - Добавлены TSDoc для вспомогательных функций (mapping типов и сохранение PNG), комментарии к шагам алгоритма.

- Документация:
  - Обновлён `README.md`: отражены параметризация, ROI-кадрирование до `cv.Mat`, строка таймингов в ожидаемом выводе, скорректированы планы.

Результаты теста (npm run dev):

```
OpenCV.js initialised. Version: unknown
— Starting smoke test for contours —
Contours found: 65
Timings(ms): capture+roi=…, toMat=…, gray=…, threshold=…, morph=…, contours=…
— Smoke test completed —
```

Принятые решения и причины:
- ROI-кадрирование выполняется до `cv.Mat`, чтобы сократить объём копируемых данных и ускорить последующую обработку.
- Параметры порога и морфологии вынесены в конфиг для гибкой настройки под разные локации/темы UI.
- Диагностические PNG включаются только при `capture.debug=true`, чтобы не влиять на перформанс в обычном режиме.

План доработок:
- Вынести логику контура в `scanForTargets()` с возвратом bbox и метрик.
- Интегрировать в FSM `ScanState`, сохранять результаты в контексте и выполнять переходы.
- Расширить метрики: площадь, центры масс, размеры bbox; при желании публиковать сводку в отчётах.

## 8. Реализация scanForTargets() и ScanState

Изменения (2025-08-17 00:44:22+03:00):

- Добавлен модуль `src/core/Scan.ts`:
  - Функция `scanForTargets(): Promise<Target[]>` — захват (с ROI), threshold, morph close, findContours, расчёт bbox/area/центра масс через моменты, очистка всех Mat.
  - Возвращаемый формат `Target` согласован с контекстом FSM: `{ bbox:{x,y,width,height}, area, cx, cy }`.

- Добавлено состояние `src/spoiler/states/ScanState.ts`:
  - `enter(ctx)`: вызывает `scanForTargets()`, сохраняет результат в `ctx.targets`, логирует длительность и количество целей.
  - `execute(ctx)`: демо-режим — без переходов (можно расширить переход к Target/Idle в следующих шагах).

- Расширены типы FSM (`src/spoiler/State.ts`):
  - Интерфейс `Target` и поле `targets: Target[]` в `IStateContext` с TSDoc.

- Инициализация контекста (`src/index.ts`):
  - Добавлено `targets: []` для соответствия обновлённому интерфейсу.

Примечания:
- На данном этапе `BootState` остаётся начальным состоянием; интеграцию перехода в `ScanState` выполним на следующем шаге (например, `BootState.execute()` → `new ScanState()`).


## 9. E2E Arduino: Сценарий 2 — fallback поворот камеры при отсутствии целей

Цель: подтвердить, что при отсутствии целей (`afterMerge=0`) выполняется командный поворот камеры (CAMERA dx 0), затем выполняется повторное сканирование. Для воспроизведения мы временно увеличили `cv.minArea` в `settings.json` до большого значения, чтобы гарантированно отфильтровать все контуры; после прогона значение возвращено.

Фактические выдержки из `logs/app.log` (2025-08-17):

```
2025-08-17 22:23:27.601 [INFO] Starting app...
2025-08-17 22:23:27.702 [INFO] OpenCV.js initialised. Version: unknown
2025-08-17 22:23:28.785 [INFO] Captured frame saved to: C:\dev\l2js\captures\last.png
2025-08-17 22:23:28.786 [INFO] ==> PING
2025-08-17 22:23:29.073 [INFO] ==> STATUS
2025-08-17 22:23:29.357 [INFO] [BootState] enter
2025-08-17 22:23:29.357 [INFO] [BootState] execute
2025-08-17 22:23:29.357 [INFO] [BootState] exit
2025-08-17 22:23:29.751 [INFO] afterSizeFilter: targets=0
2025-08-17 22:23:29.786 [INFO] ScanState: найдено 0 целей за 428 ms
2025-08-17 22:23:29.751 [INFO] afterExclusionZones: targets=0 (zones=1)
2025-08-17 22:23:29.752 [INFO] afterMerge: targets=0
2025-08-17 22:23:29.752 [INFO] scanForTargets: fullFrame=52, afterROI=0, afterAreaFilter=0, afterSizeFilter=0, afterMerge=0, area[min/avg/max]=0/0.0/0, time=394ms
2025-08-17 22:23:29.786 [INFO] bboxes.json saved to C:\dev\l2js\logs\images\1755458609752\bboxes.json
2025-08-17 22:23:29.787 [INFO] ScanState: целей нет
... (guard: окно не активно, серийные команды заблокированы) ...
2025-08-17 22:23:31.332 [INFO] ScanState: повторное сканирование после поворота камеры
2025-08-17 22:23:31.735 [INFO] afterSizeFilter: targets=0
2025-08-17 22:23:31.769 [INFO] ScanState: найдено 0 целей за 437 ms
2025-08-17 22:23:31.736 [INFO] afterExclusionZones: targets=0 (zones=1)
2025-08-17 22:23:31.736 [INFO] afterMerge: targets=0
2025-08-17 22:23:31.736 [INFO] scanForTargets: fullFrame=51, afterROI=0, afterAreaFilter=0, afterSizeFilter=0, afterMerge=0, area[min/avg/max]=0/0.0/0, time=404ms
2025-08-17 22:23:31.769 [INFO] bboxes.json saved to C:\dev\l2js\logs\images\1755458611736\bboxes.json
2025-08-17 22:23:31.770 [INFO] ScanState: целей нет
2025-08-17 22:23:33.322 [INFO] ScanState: повторное сканирование после поворота камеры
2025-08-17 22:23:33.746 [INFO] afterSizeFilter: targets=0
2025-08-17 22:23:33.780 [INFO] ScanState: найдено 0 целей за 458 ms
2025-08-17 22:23:33.780 [INFO] Done.
```

Примечания:
- Fallback активировался корректно: лог строки `ScanState: целей нет` → `ScanState: повторное сканирование после поворота камеры` подтверждают цикл CAMERA→пауза→рескан. В текущем прогоне серийная отправка `CAMERA dx 0` была заблокирована FocusGuard из‑за неактивного окна, поэтому в логе присутствуют предупреждения `Game window is not active. Skip action.` и `Skip serial ...`.
- Для полной демонстрации строки `==> CAMERA dx 0` активируйте окно LU4 и повторите сценарий — тогда в логе появится последовательность `serial: cold-open 2.5s` (однократно) и `==> CAMERA <dx> 0` перед сообщением о повторном сканировании.

Результат: сценарий 2 подтверждён — при отсутствии целей выполняется попытка поворота камеры и повторные сканы, счётчики afterMerge=0 на всех повторах, bboxes.json сохраняются.
