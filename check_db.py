"""Проверка базы данных — какие игроки привязаны и видны в Топе"""
import sqlite3, os, requests

db_path = os.path.join(os.path.dirname(__file__), "ecosystem.db")
print(f"БД: {db_path}")
print(f"Существует: {os.path.exists(db_path)}\n")

conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

# 1. Проверяем колонки
cols = [c[1] for c in conn.execute("PRAGMA table_info(users)").fetchall()]
print(f"Колонки users: {cols}")
has_avatar = 'avatar' in cols
print(f"Колонка avatar: {'✅ есть' if has_avatar else '❌ НЕТ — нужно перезапустить бота!'}\n")

# 2. Все с wot_nickname
print("=== Игроки с WoT ником ===")
rows = conn.execute('SELECT telegram_id, first_name, username, wot_nickname, wot_account_id FROM users WHERE wot_nickname IS NOT NULL').fetchall()
if not rows:
    print("  ❌ НИ ОДНОГО игрока с wot_nickname!")
for r in rows:
    aid = r['wot_account_id']
    status = "✅" if aid else "❌ wot_account_id = NULL!"
    print(f"  {status} {r['wot_nickname']} (tg: {r['first_name']}, account_id: {aid})")

# 3. Что видит API
print(f"\n=== Запрос API (account_id NOT NULL + nickname NOT NULL) ===")
api_rows = conn.execute('SELECT telegram_id, wot_nickname, wot_account_id FROM users WHERE wot_account_id IS NOT NULL AND wot_nickname IS NOT NULL').fetchall()
print(f"  Найдено: {len(api_rows)} игроков")

# 4. Если ников нет в API — значит нужно добавить account_id
missing = [r for r in rows if not r['wot_account_id']]
if missing:
    print(f"\n⚠️ У {len(missing)} игроков есть ник но НЕТ account_id!")
    print("Пробуем найти account_id через Lesta API...\n")
    
    LESTA_APP_ID = "c984faa7dc529f4cb0139505d5e8043c"
    
    for r in missing:
        nick = r['wot_nickname']
        try:
            resp = requests.get(
                f"https://api.tanki.su/wot/account/list/?application_id={LESTA_APP_ID}&search={nick}&limit=1&type=exact",
                timeout=10
            )
            data = resp.json()
            if data.get('status') == 'ok' and data.get('data'):
                account = data['data'][0]
                aid = account['account_id']
                print(f"  ✅ {nick} → account_id = {aid}")
                conn.execute(
                    "UPDATE users SET wot_account_id = ? WHERE telegram_id = ?",
                    (aid, r['telegram_id'])
                )
                conn.commit()
                print(f"     Обновлено в БД!")
            else:
                print(f"  ❌ {nick} — не найден на Lesta API")
        except Exception as e:
            print(f"  ⚠️ {nick} — ошибка: {e}")

# 5. Итого
print(f"\n=== ИТОГ ===")
final = conn.execute('SELECT COUNT(*) FROM users WHERE wot_account_id IS NOT NULL AND wot_nickname IS NOT NULL').fetchone()[0]
print(f"Игроков в Топе: {final}")

conn.close()
