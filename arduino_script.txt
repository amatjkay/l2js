// Совместимая прошивка для Leonardo: поддерживает
//  - Цифровые клавиши '0'..'9' (соответствуют командам ATTACK/LOOT/etc через Python)
//  - ESC, ENTER
//  - LCLICK, RCLICK, RMOUSE_PRESS, RMOUSE_RELEASE
//  - MOVE dx dy  (dx,dy в диапазоне [-127..127])

#include <Keyboard.h>
#include <Mouse.h>

static const uint8_t PRESS_DELAY_MS = 40;  // короткий, «человечный» нажим
static int8_t MOUSE_GAIN = 1;              // множитель дельт MOVE (1..10)
static uint8_t MOVE_REPEAT = 1;            // повтор MOVE (1..50)

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

// Быстрый парсер двух целых из строки вида "MOVE dx dy"
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
  // Ограничим до диапазона Mouse.move для HID
  if (dx > 127) dx = 127; if (dx < -127) dx = -127;
  if (dy > 127) dy = 127; if (dy < -127) dy = -127;
  return true;
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(20);  // быстрый разбор строк
  delay(800);            // Даем ОС время распознать устройство
  Keyboard.begin();
  Mouse.begin();
}

void loop() {
  if (!Serial.available()) return;

  String cmd = Serial.readStringUntil('\n');
  cmd.trim();
  if (cmd.length() == 0) return;

  // MOVE dx dy
  int dx = 0, dy = 0;
  if (parseMove(cmd, dx, dy)) {
    // Применяем gain и repeat, с клэмпингом в допустимый диапазон
    int gx = dx * MOUSE_GAIN;
    int gy = dy * MOUSE_GAIN;
    if (gx > 127) gx = 127; if (gx < -127) gx = -127;
    if (gy > 127) gy = 127; if (gy < -127) gy = -127;
    uint8_t reps = MOVE_REPEAT < 1 ? 1 : (MOVE_REPEAT > 50 ? 50 : MOVE_REPEAT);
    for (uint8_t i = 0; i < reps; ++i) {
      Mouse.move(gx, gy, 0);
    }
    Serial.println(F("OK MOVE"));
    return;
  }

  // --- Клики мыши ---
  if (cmd == "LCLICK") { Mouse.click(MOUSE_LEFT); Serial.println(F("OK LCLICK")); return; }
  if (cmd == "RCLICK") { Mouse.click(MOUSE_RIGHT); Serial.println(F("OK RCLICK")); return; }
  if (cmd == "RMOUSE_PRESS") { Mouse.press(MOUSE_RIGHT); Serial.println(F("OK RMOUSE_PRESS")); return; }
  if (cmd == "RMOUSE_RELEASE") { Mouse.release(MOUSE_RIGHT); Serial.println(F("OK RMOUSE_RELEASE")); return; }

  // --- Спецклавиши ---
  if (cmd == "ESC")   { pressKey(KEY_ESC); Serial.println(F("OK ESC")); return; }
  if (cmd == "ENTER") { pressKey(KEY_RETURN); Serial.println(F("OK ENTER")); return; }
  if (cmd == "F1")    { pressKey(KEY_F1); Serial.println(F("OK F1")); return; } // сохраняем совместимость

  // --- Диагностика и настройка ---
  if (cmd == "PING") { Serial.println(F("PONG")); return; }
  if (cmd.startsWith("MGAIN")) {
    int sp = cmd.indexOf(' ');
    if (sp > 0) {
      String sval = cmd.substring(sp + 1); sval.trim();
      int g = sval.toInt();
      if (g < 1) g = 1; if (g > 10) g = 10;
      MOUSE_GAIN = (int8_t)g;
      Serial.print(F("OK MGAIN "));
      Serial.println(MOUSE_GAIN);
      return;
    }
    Serial.println(F("ERR MGAIN"));
    return;
  }
  if (cmd.startsWith("MREPEAT")) {
    int sp = cmd.indexOf(' ');
    if (sp > 0) {
      String sval = cmd.substring(sp + 1); sval.trim();
      int r = sval.toInt();
      if (r < 1) r = 1; if (r > 50) r = 50;
      MOVE_REPEAT = (uint8_t)r;
      Serial.print(F("OK MREPEAT "));
      Serial.println(MOVE_REPEAT);
      return;
    }
    Serial.println(F("ERR MREPEAT"));
    return;
  }

  // --- Символы/цифры ---
  if (cmd.length() == 1) {
    char c = cmd.charAt(0);
    // Разрешим цифры и некоторые символы
    if ((c >= '0' && c <= '9') || c == '-' || c == '=') {
      pressChar(c);
      Serial.println(F("OK CHAR"));
      return;
    }
  }

  // Неизвестная команда
  Serial.println(F("ERR UNKNOWN"));
}