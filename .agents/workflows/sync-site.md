---
description: Синхронизация site/ → webapp/ после любых изменений в дизайне или функциях
---

# Sync Site to Webapp

Эта процедура ОБЯЗАТЕЛЬНА после ЛЮБЫХ изменений в `site/`. Папки `site/` и `webapp/` содержат одинаковый контент, но с разными SDK:
- `site/` — автономный сайт (использует `site-page.js` для мока Telegram SDK)
- `webapp/` — Telegram WebApp (использует настоящий `telegram-web-app.js`)

## Файлы для синхронизации

Всегда синхронизировать ЭТИ файлы из `site/` → `webapp/`:

### HTML файлы (нужна замена скрипта!)
- `site/player.html` → `webapp/player.html` **⚠️ ПОСЛЕ копирования заменить:**
  - `<script src="js/site-page.js"></script>` → `<script src="https://telegram.org/js/telegram-web-app.js"></script>`
  - Убрать `<link rel="stylesheet" href="css/site.css">` (она только для standalone сайта)
- `site/design-editor.html` → `webapp/design-editor.html` (аналогичная замена)

### JS файлы (копировать как есть)
- `site/js/stream.js` → `webapp/js/stream.js`

### CSS файлы (копировать как есть)
- `site/css/military-theme.css` → `webapp/css/military-theme.css`
- `site/css/stream.css` → `webapp/css/stream.css`

### Картинки (копировать как есть)
- `site/img/military/*` → `webapp/img/military/*`

## Как выполнять

// turbo-all

1. Запустить скрипт синхронизации:
```
python d:\mir-tankov-bot\scripts\sync_site_to_webapp.py
```

2. Закоммитить и запушить:
```
cd d:\mir-tankov-bot && git add -A && git commit -m "Sync site -> webapp" && git push
```

## Когда выполнять

- **ВСЕГДА** после изменений в `site/player.html`
- **ВСЕГДА** после изменений в `site/js/stream.js`
- **ВСЕГДА** после изменений в `site/css/military-theme.css` или `site/css/stream.css`
- **ВСЕГДА** после добавления/замены картинок в `site/img/`
- **НЕ НУЖНО** для файлов которые есть ТОЛЬКО в `site/` (например `site/css/site.css`, `site/js/site-page.js`)
