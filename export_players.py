"""
Экспорт игроков из БД в JSON для GitHub Pages.
Запускайте после каждого обновления списка игроков.
Или добавьте в ОБНОВИТЬ.bat перед git push.
"""
import sqlite3
import json
import os
import requests

DB_PATH = os.path.join(os.path.dirname(__file__), "ecosystem.db")
OUTPUT_PATH = os.path.join(os.path.dirname(__file__), "webapp", "data", "players.json")
LESTA_APP_ID = "c984faa7dc529f4cb0139505d5e8043c"

def export_players():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    # Получаем всех игроков с WoT аккаунтом
    rows = conn.execute("""
        SELECT telegram_id, first_name, username, wot_nickname, wot_account_id, avatar
        FROM users
        WHERE wot_nickname IS NOT NULL
    """).fetchall()

    players = []
    fix_count = 0

    for r in rows:
        account_id = r["wot_account_id"]

        # Автоматически ищем account_id если его нет
        if not account_id or account_id == 0:
            nick = r["wot_nickname"]
            try:
                resp = requests.get(
                    f"https://api.tanki.su/wot/account/list/?application_id={LESTA_APP_ID}&search={nick}&limit=1&type=exact",
                    timeout=10
                )
                data = resp.json()
                if data.get("status") == "ok" and data.get("data"):
                    account_id = data["data"][0]["account_id"]
                    # Обновляем в БД
                    conn.execute(
                        "UPDATE users SET wot_account_id = ? WHERE telegram_id = ?",
                        (account_id, r["telegram_id"])
                    )
                    conn.commit()
                    fix_count += 1
                    print(f"  ✅ Найден account_id для {nick}: {account_id}")
                else:
                    print(f"  ❌ Не найден на Lesta: {nick}")
                    continue
            except Exception as e:
                print(f"  ⚠️ Ошибка Lesta API для {nick}: {e}")
                continue

        if account_id and account_id > 0:
            avatar = r["avatar"]
            # Не сохраняем base64 фото в JSON (слишком большие)
            if avatar and avatar.startswith("data:"):
                avatar = "📷"

            players.append({
                "telegram_id": r["telegram_id"],
                "first_name": r["first_name"] or "",
                "username": r["username"] or "",
                "wot_nickname": r["wot_nickname"],
                "wot_account_id": account_id,
                "avatar": avatar or "",
            })

    conn.close()

    # Создаём папку data если не существует
    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    # Сохраняем JSON
    output = {
        "players": players,
        "total": len(players),
        "updated_at": __import__("datetime").datetime.now().isoformat(),
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Экспортировано {len(players)} игроков в {OUTPUT_PATH}")
    if fix_count:
        print(f"   Исправлено {fix_count} account_id")
    print(f"   Файл будет доступен на GitHub Pages после push")

if __name__ == "__main__":
    export_players()
