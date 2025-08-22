# Исправление Tesseract.js и Fallback на нативный Tesseract

## Проблема

Tesseract.js версии 5.1.0 имеет проблемы совместимости с Node.js 18 на Windows, проявляющиеся в ошибке:
```
LinkError: WebAssembly.instantiate(): Import #46 module="a" function="U" error: function import requires a callable
```

## Решение

Реализован многоуровневый подход к решению проблемы:

### 1. Улучшенная функция getOcrWorker

Функция `getOcrWorker` в `src/core/Scan.ts` теперь пробует несколько конфигураций:

- **basic**: Базовые настройки Tesseract.js
- **explicit-paths**: С явными путями к worker и core файлам
- **no-streaming**: С отключенным WebAssembly streaming

### 2. Автоматический Fallback

Если Tesseract.js не удается инициализировать, система автоматически переключается на нативный Tesseract:

```typescript
if (engine === 'auto' || engine === 'tesseract') {
  try {
    worker = await getOcrWorker(lang, psm, whitelist);
    Logger.info('OCR: Using Tesseract.js successfully');
  } catch (error: any) {
    Logger.warn(`OCR: Tesseract.js failed, falling back to native: ${error?.message || String(error)}`);
    useNativeFallback = true;
  }
}
```

### 3. Настройки OCR

В `settings.json` добавлена опция `engine` в секции `cv.ocr`:

```json
{
  "cv": {
    "ocr": {
      "enabled": true,
      "engine": "auto",  // "auto" | "native" | "tesseract"
      "lang": "eng",
      "psm": 7,
      "minConfidence": 50
    }
  }
}
```

**Варианты engine:**
- `"auto"` - попробовать Tesseract.js, затем fallback на нативный
- `"native"` - использовать только нативный Tesseract
- `"tesseract"` - использовать только Tesseract.js

## Использование

### Автоматический режим (рекомендуется)
```json
{
  "cv": {
    "ocr": {
      "enabled": true,
      "engine": "auto"
    }
  }
}
```

### Принудительное использование нативного Tesseract
```json
{
  "cv": {
    "ocr": {
      "enabled": true,
      "engine": "native"
    }
  }
}
```

### Принудительное использование Tesseract.js
```json
{
  "cv": {
    "ocr": {
      "enabled": true,
      "engine": "tesseract"
    }
  }
}
```

## Диагностика

### Логи
Система логирует все попытки инициализации:
```
OCR: trying config "basic"
OCR: config "basic" failed: LinkError: WebAssembly.instantiate()...
OCR: trying config "explicit-paths"
OCR: config "explicit-paths" failed: ...
OCR: trying config "no-streaming"
OCR: worker created successfully with config "no-streaming"
OCR: Using Tesseract.js successfully
```

### Fallback логи
```
OCR: Tesseract.js failed, falling back to native: All Tesseract.js configurations failed
```

### bboxes.json
В диагностическом файле `bboxes.json` сохраняется информация об использованном движке:
```json
{
  "debug": {
    "ocr": {
      "engine": "native",
      "processed": 5,
      "after": 3,
      "results": [...]
    }
  }
}
```

## Тестирование

### Тест интеграции
```bash
node scripts/test-ocr-integration.js
```

### Тест Tesseract.js
```bash
node scripts/test-tess-fixed.js
```

## Преимущества решения

1. **Надёжность**: Система всегда работает, даже если Tesseract.js не функционирует
2. **Гибкость**: Можно выбрать предпочтительный движок
3. **Автоматизация**: Fallback происходит автоматически
4. **Диагностика**: Подробные логи для отладки
5. **Обратная совместимость**: Существующие настройки продолжают работать

## Рекомендации

1. Используйте `"engine": "auto"` для максимальной надёжности
2. Если Tesseract.js работает стабильно, можно переключиться на `"engine": "tesseract"`
3. Для продакшена с гарантированной работой используйте `"engine": "native"`
4. Мониторьте логи для понимания, какой движок используется

## Будущие улучшения

- Добавление поддержки более новых версий Tesseract.js
- Улучшение shim для лучшей совместимости
- Кэширование результатов OCR для повышения производительности
- Поддержка дополнительных языков и моделей
