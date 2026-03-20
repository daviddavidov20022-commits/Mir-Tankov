---
description: Открытие сайта в Google Chrome с профилем David для тестирования
---

# Открытие сайта в Chrome (профиль David)

Когда нужно открыть сайт для проверки или тестирования, используй Chrome с профилем David.

## Команда для открытия URL в Chrome

// turbo
```powershell
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList '--profile-directory="Profile 112"', 'URL_ЗДЕСЬ'
```

Замени `URL_ЗДЕСЬ` на нужный адрес. Примеры:

- Стрим-страница: `https://mir-tankov-production.up.railway.app/site/player.html`
- Конструктор дизайна: `https://mir-tankov-production.up.railway.app/site/design-editor.html`
- Главная сайта: `https://mir-tankov-production.up.railway.app/site/`
- Telegram WebApp: открывается через бота в Telegram

## Когда использовать

- Для проверки внешнего вида страниц после изменений
- Для тестирования загрузки файлов через конструктор дизайна
- Когда встроенный браузер (browser_subagent) не может открыть страницу
- НЕ ИСПОЛЬЗОВАТЬ browser_subagent для этого проекта — он не работает с Railway

## Chrome профиль

- Имя профиля: **David**
- Email: david.davidov20022@gmail.com
- Profile directory: `Profile 112`
- Путь: `C:\Users\user\AppData\Local\Google\Chrome\User Data\Profile 112`
