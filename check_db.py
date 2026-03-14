"""Проверка базы данных — кто из пользователей привязал WoT аккаунт"""
import sqlite3
import os

db_path = os.path.join(os.path.dirname(__file__), "ecosystem.db")
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row

# Общая статистика
total = conn.execute("SELECT count(*) as c FROM users").fetchone()["c"]
with_wot = conn.execute("SELECT count(*) as c FROM users WHERE wot_account_id IS NOT NULL AND wot_nickname IS NOT NULL").fetchone()["c"]
without_wot = total - with_wot

print("=" * 50)
print(f"  📊 ПОЛЬЗОВАТЕЛИ В БАЗЕ")
print("=" * 50)
print(f"  Всего пользователей:     {total}")
print(f"  С привязанным WoT:       {with_wot}  ✅")
print(f"  Без WoT аккаунта:        {without_wot}  ❌")
print()

# Показать всех пользователей
print("  Все пользователи:")
print("-" * 50)
rows = conn.execute("SELECT telegram_id, first_name, username, wot_nickname, wot_account_id FROM users ORDER BY telegram_id").fetchall()
for r in rows:
    wot = f"✅ {r['wot_nickname']} (ID:{r['wot_account_id']})" if r['wot_account_id'] else "❌ Не привязан"
    name = r['first_name'] or r['username'] or '—'
    print(f"  TG:{r['telegram_id']} | {name} | {wot}")

print()
print("=" * 50)
if with_wot == 0:
    print("  ⚠️  НИКТО не привязал WoT аккаунт!")
    print("  Игроки должны привязать ник через /start → Профиль")
    print("  или через команду привязки ника в боте.")
print()
input("Нажмите Enter...")
