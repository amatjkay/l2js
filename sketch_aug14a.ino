// Полная прошивка для Arduino Leonardo/Micro
// Поддерживает:
//  - Плавные повороты камеры с зажатым ПКМ
//  - Колесико мыши для зума
//  - Все функциональные клавиши F1-F12
//  - Человекоподобные движения мыши
//  - Цифровые клавиши и базовые команды

#include <Keyboard.h>
#include <Mouse.h>

// === КОНСТАНТЫ ===
static const uint8_t PRESS_DELAY_MS = 40;        // задержка нажатия клавиш
static const uint8_t SMOOTH_DELAY_MS = 8;        // задержка между шагами плавного движения
static const uint8_t CAMERA_DELAY_MS = 12;       // задержка для поворотов камеры
static const int16_t MAX_SINGLE_MOVE = 127;      // максимальное одиночное движение HID

// === НАСТРОЙКИ ===
static int8_t MOUSE_GAIN = 1;                    // множитель для обычных движений (1..10)
static uint8_t MOVE_REPEAT = 1;                  // повтор обычных движений (1..50)
static uint8_t SMOOTH_STEPS = 20;                // количество шагов для плавного движения (5..100)

// === ФУНКЦИИ КЛАВИАТУРЫ ===
void pressChar(char c) {
  Keyboard.press(c);
  delay(PRESS_DELAY_MS);
  Keyboard.release(c);
}

void pressKey(uint8_t k) {
  Keyboard.press(k);
  delay(PRESS_DELAY_MS);
  Keyboard.release(k);
}

// === ПАРСЕРЫ КОМАНД ===
bool parseMove(const String &cmd, int &dx, int &dy) {
  if (!cmd.startsWith("MOVE")) return false;
  int firstSpace = cmd.indexOf(' ');
  if (firstSpace < 0) return false;
  int secondSpace = cmd.indexOf(' ', firstSpace + 1);
  if (secondSpace < 0) return false;
  String sdx = cmd.substring(firstSpace + 1, secondSpace);
  String sdy = cmd.substring(secondSpace + 1);
  sdx.trim(); sdy.trim();
  if (sdx.length() == 0 || sdy.length() == 0) return false;
  dx = sdx.toInt();
  dy = sdy.toInt();
  return true;
}

bool parseBigMove(const String &cmd, int &dx, int &dy) {
  if (!cmd.startsWith("BIGMOVE")) return false;
  int firstSpace = cmd.indexOf(' ');
  if (firstSpace < 0) return false;
  int secondSpace = cmd.indexOf(' ', firstSpace + 1);
  if (secondSpace < 0) return false;
  String sdx = cmd.substring(firstSpace + 1, secondSpace);
  String sdy = cmd.substring(secondSpace + 1);
  sdx.trim(); sdy.trim();
  if (sdx.length() == 0 || sdy.length() == 0) return false;
  dx = sdx.toInt();
  dy = sdy.toInt();
  return true;
}

bool parseScroll(const String &cmd, int &scroll) {
  if (!cmd.startsWith("SCROLL")) return false;
  int sp = cmd.indexOf(' ');
  if (sp < 0) return false;
  String sval = cmd.substring(sp + 1);
  sval.trim();
  if (sval.length() == 0) return false;
  scroll = sval.toInt();
  return true;
}

// === ПЛАВНЫЕ ДВИЖЕНИЯ ===
void smoothMove(int targetX, int targetY, bool isCamera = false) {
  if (targetX == 0 && targetY == 0) return;
  
  uint8_t steps = SMOOTH_STEPS;
  uint8_t delayMs = isCamera ? CAMERA_DELAY_MS : SMOOTH_DELAY_MS;
  
  // Для больших движений камеры увеличиваем количество шагов
  if (isCamera && (abs(targetX) > 500 || abs(targetY) > 500)) {
    steps = min(100, steps + (max(abs(targetX), abs(targetY)) / 50));
  }
  
  float stepX = (float)targetX / steps;
  float stepY = (float)targetY / steps;
  float accX = 0.0, accY = 0.0;
  
  for (uint8_t i = 0; i < steps; i++) {
    accX += stepX;
    accY += stepY;
    
    int moveX = (int)round(accX);
    int moveY = (int)round(accY);
    
    // Ограничиваем до допустимого диапазона HID
    moveX = constrain(moveX, -MAX_SINGLE_MOVE, MAX_SINGLE_MOVE);
    moveY = constrain(moveY, -MAX_SINGLE_MOVE, MAX_SINGLE_MOVE);
    
    if (moveX != 0 || moveY != 0) {
      Mouse.move(moveX, moveY, 0);
      accX -= moveX;
      accY -= moveY;
      
      // Человекоподобная вариация задержки (±20%)
      uint8_t variation = random(delayMs * 8 / 10, delayMs * 12 / 10);
      delay(variation);
    }
  }
}

// === ПОВОРОТ КАМЕРЫ ===
void cameraRotate(int deltaX, int deltaY) {
  // Зажимаем правую кнопку мыши
  Mouse.press(MOUSE_RIGHT);
  delay(30); // небольшая задержка после зажатия
  
  // Выполняем плавный поворот
  smoothMove(deltaX, deltaY, true);
  
  delay(20); // задержка перед отпусканием
  // Отпускаем правую кнопку мыши
  Mouse.release(MOUSE_RIGHT);
}

// === ОСНОВНЫЕ ФУНКЦИИ ===
void setup() {
  Serial.begin(115200);
  Serial.setTimeout(20);
  delay(800); // Даем ОС время распознать устройство
  Keyboard.begin();
  Mouse.begin();
  randomSeed(analogRead(0)); // инициализируем генератор случайных чисел
}

void loop() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  if (cmd.length() == 0) return;

  // === ДВИЖЕНИЯ МЫШИ ===
  
  // MOVE dx dy - обычное движение
  int dx = 0, dy = 0;
  if (parseMove(cmd, dx, dy)) {
    int gx = constrain(dx * MOUSE_GAIN, -MAX_SINGLE_MOVE, MAX_SINGLE_MOVE);
    int gy = constrain(dy * MOUSE_GAIN, -MAX_SINGLE_MOVE, MAX_SINGLE_MOVE);
    uint8_t reps = constrain(MOVE_REPEAT, 1, 50);
    for (uint8_t i = 0; i < reps; ++i) {
      Mouse.move(gx, gy, 0);
    }
    Serial.println(F("OK MOVE"));
    return;
  }

  // BIGMOVE dx dy - плавное большое движение
  if (parseBigMove(cmd, dx, dy)) {
    smoothMove(dx, dy, false);
    Serial.println(F("OK BIGMOVE"));
    return;
  }

  // CAMERA dx dy - поворот камеры с зажатым ПКМ
  if (cmd.startsWith("CAMERA")) {
    if (parseBigMove("BIGMOVE" + cmd.substring(6), dx, dy)) {
      cameraRotate(dx, dy);
      Serial.println(F("OK CAMERA"));
      return;
    }
    Serial.println(F("ERR CAMERA"));
    return;
  }

  // SCROLL n - колесико мыши
  int scroll = 0;
  if (parseScroll(cmd, scroll)) {
    scroll = constrain(scroll, -10, 10);
    Mouse.move(0, 0, scroll);
    Serial.print(F("OK SCROLL "));
    Serial.println(scroll);
    return;
  }

  // === КЛИКИ МЫШИ ===
  if (cmd == "LCLICK") { Mouse.click(MOUSE_LEFT); Serial.println(F("OK LCLICK")); return; }
  if (cmd == "RCLICK") { Mouse.click(MOUSE_RIGHT); Serial.println(F("OK RCLICK")); return; }
  if (cmd == "RMOUSE_PRESS") { Mouse.press(MOUSE_RIGHT); Serial.println(F("OK RMOUSE_PRESS")); return; }
  if (cmd == "RMOUSE_RELEASE") { Mouse.release(MOUSE_RIGHT); Serial.println(F("OK RMOUSE_RELEASE")); return; }

  // === ФУНКЦИОНАЛЬНЫЕ КЛАВИШИ F1-F12 ===
  if (cmd == "F1")  { pressKey(KEY_F1);  Serial.println(F("OK F1"));  return; }
  if (cmd == "F2")  { pressKey(KEY_F2);  Serial.println(F("OK F2"));  return; }
  if (cmd == "F3")  { pressKey(KEY_F3);  Serial.println(F("OK F3"));  return; }
  if (cmd == "F4")  { pressKey(KEY_F4);  Serial.println(F("OK F4"));  return; }
  if (cmd == "F5")  { pressKey(KEY_F5);  Serial.println(F("OK F5"));  return; }
  if (cmd == "F6")  { pressKey(KEY_F6);  Serial.println(F("OK F6"));  return; }
  if (cmd == "F7")  { pressKey(KEY_F7);  Serial.println(F("OK F7"));  return; }
  if (cmd == "F8")  { pressKey(KEY_F8);  Serial.println(F("OK F8"));  return; }
  if (cmd == "F9")  { pressKey(KEY_F9);  Serial.println(F("OK F9"));  return; }
  if (cmd == "F10") { pressKey(KEY_F10); Serial.println(F("OK F10")); return; }
  if (cmd == "F11") { pressKey(KEY_F11); Serial.println(F("OK F11")); return; }
  if (cmd == "F12") { pressKey(KEY_F12); Serial.println(F("OK F12")); return; }

  // === СПЕЦИАЛЬНЫЕ КЛАВИШИ ===
  if (cmd == "ESC")   { pressKey(KEY_ESC); Serial.println(F("OK ESC")); return; }
  if (cmd == "ENTER") { pressKey(KEY_RETURN); Serial.println(F("OK ENTER")); return; }
  if (cmd == "SPACE") { pressKey(' '); Serial.println(F("OK SPACE")); return; }
  if (cmd == "TAB")   { pressKey(KEY_TAB); Serial.println(F("OK TAB")); return; }

  // === ДИАГНОСТИКА И НАСТРОЙКА ===
  if (cmd == "PING") { Serial.println(F("PONG")); return; }
  
  // MGAIN n - множитель для обычных движений
  if (cmd.startsWith("MGAIN")) {
    int sp = cmd.indexOf(' ');
    if (sp > 0) {
      String sval = cmd.substring(sp + 1); sval.trim();
      int g = sval.toInt();
      MOUSE_GAIN = constrain(g, 1, 10);
      Serial.print(F("OK MGAIN "));
      Serial.println(MOUSE_GAIN);
      return;
    }
    Serial.println(F("ERR MGAIN"));
    return;
  }
  
  // MREPEAT n - повтор обычных движений
  if (cmd.startsWith("MREPEAT")) {
    int sp = cmd.indexOf(' ');
    if (sp > 0) {
      String sval = cmd.substring(sp + 1); sval.trim();
      int r = sval.toInt();
      MOVE_REPEAT = constrain(r, 1, 50);
      Serial.print(F("OK MREPEAT "));
      Serial.println(MOVE_REPEAT);
      return;
    }
    Serial.println(F("ERR MREPEAT"));
    return;
  }
  
  // SMOOTHNESS n - плавность движений (количество шагов)
  if (cmd.startsWith("SMOOTHNESS")) {
    int sp = cmd.indexOf(' ');
    if (sp > 0) {
      String sval = cmd.substring(sp + 1); sval.trim();
      int s = sval.toInt();
      SMOOTH_STEPS = constrain(s, 5, 100);
      Serial.print(F("OK SMOOTHNESS "));
      Serial.println(SMOOTH_STEPS);
      return;
    }
    Serial.println(F("ERR SMOOTHNESS"));
    return;
  }

  // === СИМВОЛЫ И ЦИФРЫ ===
  if (cmd.length() == 1) {
    char c = cmd.charAt(0);
    // Разрешаем цифры и некоторые символы
    if ((c >= '0' && c <= '9') || c == '-' || c == '=' || c == '+') {
      pressChar(c);
      Serial.println(F("OK CHAR"));
      return;
    }
  }

  // === СТАТУС ===
  if (cmd == "STATUS") {
    Serial.print(F("STATUS MGAIN="));
    Serial.print(MOUSE_GAIN);
    Serial.print(F(" MREPEAT="));
    Serial.print(MOVE_REPEAT);
    Serial.print(F(" SMOOTHNESS="));
    Serial.println(SMOOTH_STEPS);
    return;
  }

  // Неизвестная команда
  Serial.println(F("ERR UNKNOWN"));
}