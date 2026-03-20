---
description: Синхронизация site/ → webapp/ после любых изменений в дизайне или функциях
---

# Sync Site to Webapp

> ⚠️ **ТЕСТИРОВАНИЕ — ТОЛЬКО НА PRODUCTION!** После git push проверять на `https://mir-tankov-production.up.railway.app/site/...`. НИКОГДА не предлагать localhost или file:// — пользователь хочет видеть то же, что его подписчики.

Эта процедура ОБЯЗАТЕЛЬНА после ЛЮБЫХ изменений в `site/`. Папки `site/` и `webapp/` содержат одинаковый контент, но с разными SDK:
- `site/` — автономный сайт (использует `site-page.js` для мока Telegram SDK)
- `webapp/` — Telegram WebApp (использует настоящий `telegram-web-app.js`)

## ⚠️ ФАЙЛЫ С ОТЛИЧИЯМИ (НЕ перезаписывать!)

Следующие файлы **ОТЛИЧАЮТСЯ** между site и webapp. Их нельзя просто копировать:
- `player.html` — webapp использует preview-карточку вместо iframe (Twitch embed не работает в Telegram WebView)
- `js/stream.js` — webapp имеет `updateStreamPreview()` и модифицированный `initPlayer()` (без iframe)
- `css/stream.css` — webapp имеет CSS для `.stream-preview__*` элементов

При изменении этих файлов в `site/` — нужно **вручную** перенести логику в webapp, адаптировав под preview-карточку.

## Файлы для синхронизации

Всегда синхронизировать ЭТИ файлы из `site/` → `webapp/`:

### CSS файлы (копировать как есть)
- `site/css/military-theme.css` → `webapp/css/military-theme.css`

### Картинки (копировать как есть)
- `site/img/military/*` → `webapp/img/military/*`

### HTML файлы (нужна замена скрипта!)
- `site/design-editor.html` → `webapp/design-editor.html` **⚠️ ПОСЛЕ копирования заменить:**
  - `<script src="js/site-page.js"></script>` → `<script src="https://telegram.org/js/telegram-web-app.js"></script>`
  - Убрать `<link rel="stylesheet" href="css/site.css">`

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

- **ВСЕГДА** после изменений в `site/css/military-theme.css`
- **ВСЕГДА** после добавления/замены картинок в `site/img/`
- **ВСЕГДА** после изменений в `site/design-editor.html`
- **РУЧНОЙ ПЕРЕНОС** после изменений в `site/player.html`, `site/js/stream.js`, `site/css/stream.css`
- **НЕ НУЖНО** для файлов которые есть ТОЛЬКО в `site/` (например `site/css/site.css`, `site/js/site-page.js`)

## ⚠️ ВАЖНО: Разные лейауты!

- **`site/`** = Десктопный сайт. Полноэкранный layout. Стили в `site.css` (НЕ синхронизируется).
- **`webapp/`** = Telegram WebApp. Мобильный layout. Не имеет `site.css`.
- **`military-theme.css`** = Общий военный дизайн, используется обоими.
- Десктопные стили → ТОЛЬКО в `site/css/site.css`
