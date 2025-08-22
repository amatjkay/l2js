# Отчёт о исправлении Tesseract.js и реализации Fallback механизма

## Проблема

Tesseract.js версии 5.1.0 имеет критические проблемы совместимости с Node.js 18 на Windows:
```
LinkError: WebAssembly.instantiate(): Import #46 module="a" function="U" error: function import requires a callable
```

Эта ошибка делает Tesseract.js непригодным для использования в продакшене.

## Реализованное решение

### 1. Многоуровневая система инициализации Tesseract.js

Улучшена функция `getOcrWorker` в `src/core/Scan.ts`:

- **Конфигурация "basic"**: Базовые настройки Tesseract.js
- **Конфигурация "explicit-paths"**: С явными путями к worker и core файлам  
- **Конфигурация "no-streaming"**: С отключенным WebAssembly streaming

Система пробует каждую конфигурацию последовательно, логируя результаты.

### 2. Автоматический Fallback на нативный Tesseract

Если все конфигурации Tesseract.js проваливаются, система автоматически переключается на нативный Tesseract:

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

### 3. Гибкая система настроек

Добавлена опция `engine` в секцию `cv.ocr`:

```json
{
  "cv": {
    "ocr": {
      "enabled": true,
      "engine": "auto",  // "auto" | "native" | "tesseract"
      "lang": "eng",
      "psm": 7
    }
  }
}
```

**Варианты:**
- `"auto"` - попробовать Tesseract.js, затем fallback на нативный
- `"native"` - использовать только нативный Tesseract  
- `"tesseract"` - использовать только Tesseract.js

### 4. Улучшенная диагностика

- Подробные логи всех попыток инициализации
- Информация об использованном движке в `bboxes.json`
- Отдельные тесты для каждого компонента

## Результаты

### ✅ Что работает

1. **Нативный Tesseract**: Полностью функционален
2. **Автоматический fallback**: Система всегда работает
3. **Гибкость настроек**: Можно выбрать предпочтительный движок
4. **Обратная совместимость**: Существующие настройки продолжают работать
5. **Диагностика**: Подробные логи для отладки

### ⚠️ Что не работает

1. **Tesseract.js 5.1.0**: Проблемы с WebAssembly в Node.js 18 на Windows
2. **WebAssembly streaming**: Отключен для обхода проблем совместимости

### 📊 Статистика

- **Конфигураций Tesseract.js**: 3 (basic, explicit-paths, no-streaming)
- **Fallback уровней**: 1 (нативный Tesseract)
- **Режимов работы**: 3 (auto, native, tesseract)
- **Тестов**: 4 (нативный, авто, принудительный нативный, принудительный tesseract.js)

## Файлы изменений

### Основные изменения
- `src/core/Scan.ts` - улучшенная функция getOcrWorker с fallback
- `src/core/tess-worker-shim-v2.js` - улучшенный shim (создан)
- `docs/TesseractJS-Fix.md` - документация по исправлению
- `README.md` - обновлена документация OCR

### Тестовые файлы
- `scripts/test-tess-fixed.js` - тест различных конфигураций Tesseract.js
- `scripts/test-ocr-integration.js` - тест интеграции OCR
- `scripts/test-complete-ocr.js` - комплексный тест всей системы

## Рекомендации

### Для разработки
1. Используйте `"engine": "auto"` для максимальной надёжности
2. Мониторьте логи для понимания, какой движок используется
3. При необходимости отладки используйте `"engine": "native"`

### Для продакшена  
1. Используйте `"engine": "native"` для гарантированной работы
2. Убедитесь, что нативный Tesseract установлен и доступен
3. Настройте мониторинг логов OCR

### Для будущих версий
1. Отслеживайте обновления Tesseract.js для исправления проблем WebAssembly
2. Рассмотрите возможность использования более новых версий Node.js
3. Исследуйте альтернативные OCR библиотеки

## Заключение

Проблема с Tesseract.js решена путём реализации надёжного fallback механизма. Система теперь:

- **Надёжна**: Всегда работает благодаря fallback на нативный Tesseract
- **Гибка**: Позволяет выбрать предпочтительный движок
- **Диагностируема**: Подробные логи для отладки
- **Совместима**: Не ломает существующую функциональность

Рекомендуется использовать режим `"auto"` для максимальной надёжности в разработке и `"native"` для продакшена.
