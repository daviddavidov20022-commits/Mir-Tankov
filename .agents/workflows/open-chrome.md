---
description: Открытие сайта в Google Chrome с профилем David для тестирования
---

# Открытие сайта в Chrome (профиль David)

Когда нужно открыть сайт для проверки или тестирования, используй Chrome с профилем David.

## ⚠️ ВАЖНО: ТОЛЬКО PRODUCTION URL!

**НИКОГДА не предлагать localhost или file:// для тестирования!**
Пользователь хочет видеть ТО ЖЕ САМОЕ, что видят его подписчики.
Все тесты — ТОЛЬКО через production URL после git push.

**Хостинг:**
- **GitHub Pages** раздаёт статические файлы (site/, webapp/)
- **Railway** запускает ТОЛЬКО бота (bot.py) — НЕ раздаёт HTML!

**Порядок проверки:**
1. Внести изменения в код
2. `git add -A` → `git commit` → `git push`
3. Подождать 1-2 минуты (GitHub Pages деплой)
4. Открыть в Chrome через production URL

## Команда для открытия URL в Chrome

// turbo
```powershell
Start-Process "C:\Program Files\Google\Chrome\Application\chrome.exe" -ArgumentList '--profile-directory="Profile 112"', 'URL_ЗДЕСЬ'
```

Замени `URL_ЗДЕСЬ` на нужный адрес:

### Production URLs (GitHub Pages):
- Стрим-страница: `https://daviddavidov20022-commits.github.io/Mir-Tankov/site/player.html`
- Конструктор дизайна: `https://daviddavidov20022-commits.github.io/Mir-Tankov/site/design-editor.html`
- Главная сайта: `https://daviddavidov20022-commits.github.io/Mir-Tankov/site/`
- Квиз: `https://daviddavidov20022-commits.github.io/Mir-Tankov/site/quiz.html`
- WebApp стрим: `https://daviddavidov20022-commits.github.io/Mir-Tankov/webapp/player.html`
- Telegram WebApp: открывается через бота @Mir_tankov_privat_bot в Telegram

### ЗАПРЕЩЕНО:
- ❌ `file:///D:/mir-tankov-bot/...` — не отражает реальность
- ❌ `http://localhost:...` — пользователю не нужен, не предлагать
- ❌ `https://mir-tankov-production.up.railway.app/site/...` — Railway НЕ раздаёт статику, только бот!

## Когда использовать

- Для проверки внешнего вида страниц после изменений
- Для тестирования загрузки файлов через конструктор дизайна
- Когда встроенный браузер (browser_subagent) не может открыть страницу
- НЕ ИСПОЛЬЗОВАТЬ browser_subagent для этого проекта

## Chrome профиль

- Имя профиля: **David**
- Email: david.davidov20022@gmail.com
- Profile directory: `Profile 112`
- Путь: `C:\Users\user\AppData\Local\Google\Chrome\User Data\Profile 112`
