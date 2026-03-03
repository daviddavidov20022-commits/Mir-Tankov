"""Привязка WoT ников к аккаунтам в базе"""
import sys
sys.path.insert(0, '.')
from database import get_db, init_db

init_db()

# Привязка ников
accounts = [
    (6507474079, 'Fors777_2016'),
    (1011431758, 'GloriAmtower'),
]

with get_db() as conn:
    for tg_id, nickname in accounts:
        # Убедимся что пользователь существует
        user = conn.execute("SELECT * FROM users WHERE telegram_id = ?", (tg_id,)).fetchone()
        if not user:
            conn.execute(
                "INSERT INTO users (telegram_id, wot_nickname) VALUES (?, ?)",
                (tg_id, nickname)
            )
            print(f"✅ Создан: {tg_id} → {nickname}")
        else:
            conn.execute(
                "UPDATE users SET wot_nickname = ? WHERE telegram_id = ?",
                (nickname, tg_id)
            )
            print(f"✅ Обновлён: {tg_id} → {nickname}")

    # Проверим
    for tg_id, nickname in accounts:
        user = conn.execute("SELECT telegram_id, wot_nickname FROM users WHERE telegram_id = ?", (tg_id,)).fetchone()
        print(f"   БД: {dict(user)}")

print("\n🎯 Готово! Теперь оба аккаунта в базе.")
