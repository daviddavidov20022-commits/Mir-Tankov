"""Привязка WoT ников к аккаунтам в базе + пополнение сыра"""
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
        user = conn.execute("SELECT * FROM users WHERE telegram_id = ?", (tg_id,)).fetchone()
        if not user:
            conn.execute(
                "INSERT INTO users (telegram_id, wot_nickname, coins) VALUES (?, ?, 5000)",
                (tg_id, nickname)
            )
            print(f"✅ Создан: {tg_id} → {nickname} (5000 🧀)")
        else:
            conn.execute(
                "UPDATE users SET wot_nickname = ? WHERE telegram_id = ?",
                (nickname, tg_id)
            )
            # Пополняем сыр если мало
            current_coins = user['coins'] if user['coins'] else 0
            if current_coins < 1000:
                conn.execute(
                    "UPDATE users SET coins = coins + 5000 WHERE telegram_id = ?",
                    (tg_id,)
                )
                print(f"✅ Обновлён: {tg_id} → {nickname} | 🧀 +5000 (было {current_coins})")
            else:
                print(f"✅ Обновлён: {tg_id} → {nickname} | 🧀 баланс: {current_coins}")

    # Проверим
    for tg_id, nickname in accounts:
        user = conn.execute("SELECT telegram_id, wot_nickname, coins FROM users WHERE telegram_id = ?", (tg_id,)).fetchone()
        print(f"   БД: {dict(user)}")

print("\n🎯 Готово!")
