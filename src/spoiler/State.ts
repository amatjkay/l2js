/**
 * Контекст машины состояний. Предоставляет сервисы, доступные всем состояниям.
 */
export interface IStateContext {
  /** Логирование сообщений состояния (в обёртку winston). */
  log: (msg: string) => void;
  /** Текущие цели, найденные сканированием (ScanState / scanForTargets). */
  targets: Target[];
}

/**
 * Описание цели, найденной CV-пайплайном.
 * bbox — прямоугольник ограничивающий контур; area — площадь; (cx, cy) — центр масс.
 */
export interface Target {
  bbox: { x: number; y: number; width: number; height: number };
  area: number;
  cx: number;
  cy: number;
}

/**
 * Базовый интерфейс состояния FSM.
 * Состояние может выполнять подготовку в `enter`, основную работу в `execute` и очистку в `exit`.
 */
export interface IState {
  /** Человекочитаемое имя состояния (для логов/отладки). */
  name: string;
  /**
   * Вызывается один раз при входе в состояние.
   * @param ctx Контекст FSM
   */
  enter(ctx: IStateContext): Promise<void> | void;
  /**
   * Основной цикл состояния. Может вернуть следующее состояние для перехода.
   * Если вернуть `void`, FSM останется в текущем состоянии (или выполнит повторный вызов по таймеру).
   * @param ctx Контекст FSM
   * @returns Следующее состояние или `void`
   */
  execute(ctx: IStateContext): Promise<IState | void> | IState | void;
  /**
   * Опциональная очистка перед выходом из состояния.
   * @param ctx Контекст FSM
   */
  exit?(ctx: IStateContext): Promise<void> | void;
}
