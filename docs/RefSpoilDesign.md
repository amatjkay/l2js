# Референсный проект: обзор спойл‑сценария и маппинг на l2js

Ниже — конспект ключевых модулей и алгоритмов из @[c:\dev\l2_automatic\ref] и план их адаптации в нашу FSM (l2js).

## Ключевые модули и их роль
- spoil_manager.py
  - Управляет процессом спойла в отдельном потоке.
  - Антиспам: лимит попыток на цель, минимальные задержки, «защёлка» после успеха.
  - Подтверждение успеха по зелёному пикселю/фразе чата (через sweeper_utils), ведёт тайминги событий.
  - Проверка смерти цели: отсутствие красного HP‑пикселя в ROI с антидребезгом.
  - Первое действие: ATTACK (+небольшая задержка) → SKILL1_SPOIL; дальше — повторные SKILL1_SPOIL по окну готовности.
- sweeper_utils.py
  - OCR чата, классификация ответов Sweeper: cooldown, unsuitable, failed_not_spoiled, corpse_too_old.
  - Окно подтверждения успеха спойла по чату после последнего нажатия SKILL1_SPOIL (time‑gated).
  - Rate‑limit на SWEEP, учёт фидбэка и блок на текущий труп при «unsuitable/failed/too old».
- target_bar_utils.py
  - is_target_selected_alive(): поиск красного пикселя HP в TARGET_BAR_ROI — быстрая верификация «цель выбрана и жива».
  - read_target_name(): OCR имени цели из ROI полоски.
- hp_guard.py
  - Единая проверка критического HP игрока: сначала CV‑ROI, затем fallback скан бара. Логгирование с антидребезгом.
  - Гейтит рискованные действия (спойл/свип/лут).
- state.py
  - Потокобезопасный BotState: таймстемпы спойла/свипа, признак жизни цели, hp‑ratio, пр.
- invoker.py / comm.py
  - Абстракция отправки команд: ATTACK, SKILL1_SPOIL, SWEEP, LOOT, клавиши и т.п. (у нас — Actions с режимами powershell/arduino).

## Сценарий (эталонный)
1) Выбор цели
   - Клик по цели → проверка is_target_selected_alive() (HP‑бар красный в ROI).
2) Спойл
   - Если критический HP игрока — отложить.
   - Первая попытка: ATTACK, затем SKILL1_SPOIL; помечаем время каста для чат‑гейтинга.
   - Повторы: только SKILL1_SPOIL при готовности, не чаще настроенного интервала; лимит попыток на цель.
   - Успех спойла: зелёный пиксель/фраза чата в окне после каста → фиксируем успех, блокируем дальнейшие попытки спойла для этой цели.
3) Подтверждение спойла
   - По чату («the spoil condition has been activated») или детектор «уже был спойлен».
4) Убийство цели
   - Боевой цикл (скиллы/удары по таймеру) до исчезновения HP‑бара цели; антидребезг при подтверждении смерти.
5) Свипер (только если цель была проспойлена)
   - should_attempt_sweep(): проверка бэкоффов и чата; SWEEP; анализ фидбэка и обновление локального состояния.
6) Лутинг
   - После SWEEP — LOOT, возможно несколько раз с короткими паузами.
7) Следующая цель
   - Сброс локального состояния (спойл/свип), возврат к сканированию.

## Маппинг на l2js (FSM)
Текущие узлы:
- TargetState: выполняет наведение и первичный клик (учитываем actions.clickOffsetY), далее → LockedCombatState.
- LockedCombatState: больше не кликает ЛКМ; рассылает клавиши боя по таймерам и выполняет перескан целей. Переход к ScanState при отсутствии целей.

Расширение для спойл‑пайплайна:
- SpoilState
  - На входе: цель выбрана и подтверждена HP‑плашкой.
  - Действия: ATTACK → SKILL1_SPOIL; повторные SKILL1_SPOIL по cool‑down до лимита или до success.
  - Подтверждение: (а) чат‑фраза в окне после каста (если включён OCR‑чат); (б) «уже спойлен»;
    (в) опционально: зелёный пиксель (если реализуем быстрый детектор как в рефе).
  - По успеху: переход в CombatState/LockedCombatState с флагом `spoiled=true`.
- CombatState (усовершенствовать LockedCombatState)
  - Боевые клавиши skillBar по таймерам, hp‑guard гейтит опасные действия.
  - Переход к SweepState при смерти цели (targets.length=0) и `spoiled=true`, иначе — сразу к ScanState.
- SweepState
  - shouldAttemptSweep(): локальные бэкоффы + глобальный таймстемп; SWEEP; регистрация фидбэка (по OCR чата при доступности).
  - При блокирующем фидбэке — сразу LootState=false → Next.
  - Иначе — к LootState.
- LootState
  - Отправка LOOT несколько раз с малыми паузами, затем Next (ScanState).

Примечание по OCR чата: в l2js OCR (tesseract.js) пока в обработке. Предусмотреть флаги:
- settings.combat.chatOcrEnabled (bool)
- settings.combat.spoilChatWindowMs (int)
- settings.combat.sweepMinIntervalMs (int)
- При отсутствии OCR использовать только детектор HP/зелёного пикселя/эвристики.

## Предлагаемые настройки (settings.json)
```
{
  "combat": {
    "spoilCombo": ["F1"],
    "attackKey": "SPACE",           // или иной биндинг ATTACK
    "sweepKey": "F8",
    "lootKey": "F9",
    "spoilEveryMs": 1800,
    "skillEveryMs": 800,
    "spoilMaxAttemptsPerTarget": 3,
    "spoilChatWindowMs": 2000,
    "sweepMinIntervalMs": 120,
    "chatOcrEnabled": false,
    "hpCriticalRatio": 0.2
  }
}
```

## План внедрения в l2js
1) Модуль быстрых проверок цели (аналог target_bar_utils):
   - isTargetSelectedAlive(): скан HP‑ROI по frame grab (у нас уже есть захват и ROI — переиспользовать/добавить red‑run).
   - readTargetName(): опционально через tesseract.js (по готовности OCR).
2) SpoilState:
   - Реализация ATTACK → SKILL1_SPOIL; повторы по таймеру, лимит; фиксация времени каста для окна подтверждения.
   - Подтверждение успеха: чат (при chatOcrEnabled) и/или green‑pixel (если добавим), «already spoiled».
3) LockedCombatState → CombatState+:
   - Добавить hp‑guard (isCriticalHp) и передачу `spoiled` в контексте.
4) SweepState и LootState:
   - Частные бэкоффы, min interval; разбор фидбэка чата при доступности OCR; несколько попыток LOOT.
5) Интеграция в FSM:
   - TargetState → SpoilState → CombatState → (если spoiled) SweepState → LootState → ScanState; иначе CombatState → ScanState.
6) Логирование и отладка:
   - Сохранение бокс/ROI и PNG при debug=true; метрики таймингов; отдельные сообщения по гейтам (hp‑guard, chat‑ocr, green‑pixel).

## Краткий чек‑лист переходов
- [ ] Выбор цели подтверждён HP‑баром → SpoilState
- [ ] Spoil успех → флаг spoiled=true, блок повторов до смерти цели
- [ ] Смерть цели → если spoiled=true → SweepState; иначе → ScanState
- [ ] SweepState (с учётом backoff/классификации) → LootState
- [ ] LootState → ScanState (сброс локального состояния)

## Примечания по Arduino/Actions
- Все действия через Actions (mode: 'arduino' | 'powershell').
- Соответствие: ATTACK/СКИЛЛЫ/LOOT/SWEEP → pressKey()/serial команды; clickOffsetY уже учтён в TargetState.
- Фокус‑гард: ensureGameActive() для всех действий.
