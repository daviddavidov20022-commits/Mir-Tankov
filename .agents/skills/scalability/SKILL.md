---
name: Scalability & Performance
description: Guidelines for building features that handle 3000+ concurrent users without lag, timeouts, or database contention. ALWAYS apply these rules.
---

# 🚀 Scalability & Performance Guidelines

## Core Principle
**Эта программа создана для большого количества людей (3000+ участников в челенджах).** 
Каждая фича, каждый API-endpoint, каждый SQL-запрос должен быть рассчитан на масштаб.

---

## 1. API Requests (Lesta Games API)

### Batch Requests
- **НИКОГДА** не делай отдельный HTTP-запрос на каждого игрока последовательно
- Используй `asyncio.gather` с лимитом параллелизма (`CONCURRENT = 10`)
- `tanks/stats` API не поддерживает batch по `account_id`, поэтому запрашиваем параллельно по 10
- `account/info` поддерживает до 100 `account_id` через запятую — используй это

### Rate Limiting
- Lesta API: ~10 запросов в секунду на ключ
- Ротация ключей: `LESTA_APP_IDS` может содержать несколько ключей через запятую
- Используй `get_lesta_app_id()` для ротации

### Timeouts
- Всегда устанавливай `aiohttp.ClientTimeout(total=15)` для отдельных запросов
- Для batch-операций: `timeout=20`
- Для всей операции refresh-stats: `asyncio.wait_for(..., timeout=55)`

---

## 2. Database (SQLite)

### WAL Mode
- База работает в режиме WAL (`journal_mode=WAL`) — читатели не блокируют писателей
- `busy_timeout=20000` — ждём разблокировки до 20 секунд

### Read vs Write
- Используй `get_db_read()` для операций чтения (без commit/rollback overhead)
- Используй `get_db()` только когда нужно писать
- **НИКОГДА** не держи соединение с БД открытым во время HTTP-запросов к внешним API

### Indexes
- Все часто используемые поля должны иметь индексы
- `global_challenge_participants(challenge_id)`, `(telegram_id)` — уже есть
- `gc_battle_log(challenge_id, telegram_id)` — уже есть

### Pattern: Release DB Before API Call
```python
# ✅ ПРАВИЛЬНО:
with get_db() as conn:
    participants = conn.execute("SELECT ...").fetchall()
# Соединение ЗАКРЫТО

# Теперь делаем API запросы (длинные операции)
batch_stats = await gc_fetch_batch_stats(...)

# Снова открываем для записи
with get_db() as conn:
    conn.execute("UPDATE ...")
```

```python
# ❌ НЕПРАВИЛЬНО:
with get_db() as conn:
    participants = conn.execute("SELECT ...").fetchall()
    stats = await fetch_api(...)  # Блокирует БД пока ждём API!
    conn.execute("UPDATE ...")
```

---

## 3. Frontend (JavaScript)

### Anti-Flicker
- Используй `_gcLastDataHash` для предотвращения ненужных перерисовок
- Проверяй хеш данных перед обновлением DOM

### Throttle Requests
- `_gcLastRefreshTime` — не чаще 30 секунд между refresh-stats
- `_gcLoadInProgress` — не запускай параллельные загрузки

### Auto-Refresh
- `setInterval` 15 секунд для обновления лидерборда
- Проверяй, что вкладка активна перед обновлением

### DOM Performance
- Не вставляй элементы по одному — собирай весь HTML строкой и вставляй `innerHTML` разом
- `animation-delay` для staggered анимаций — лёгкий способ улучшить UX без нагрузки

---

## 4. Concurrency Protection

### Refresh Lock
```python
_gc_refresh_lock = asyncio.Lock()  # Только один refresh за раз
```

### Cooldown Cache
```python
GC_REFRESH_COOLDOWN = 30  # секунд
_gc_last_refresh_data = None  # Кэш последнего результата
```

### Pattern: Lock + Cooldown
```python
if lock.locked():
    return cached_response  # Не ждём, возвращаем кэш
async with lock:
    result = await do_work()
    cache = result
    return result
```

---

## 5. Checklist для новых фич

- [ ] Сколько SQL-запросов? Можно ли объединить?
- [ ] Есть ли индексы на фильтруемые поля?
- [ ] API вызовы идут параллельно (asyncio.gather)?
- [ ] БД закрыта перед API вызовами?
- [ ] Есть cooldown/throttle на повторные вызовы?
- [ ] Frontend не мерцает при обновлении?
- [ ] Работает ли при 3000 участниках? (проверь O(n) vs O(n²))
