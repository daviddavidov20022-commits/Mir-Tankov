"""
Диагностика: почему fetch_player_stats возвращает None для игрока
"""
import sqlite3
import requests
import json
import os

DB_PATH = os.path.join(os.path.dirname(__file__), 'ecosystem.db')
LESTA_APP_ID = "c984faa7dc529f4cb0139505d5e8043c"

def check_player(nickname):
    print(f"\n{'='*60}")
    print(f"🔍 Диагностика игрока: {nickname}")
    print(f"{'='*60}")
    
    # 1. Проверяем БД
    print("\n📋 1. Проверка в базе данных...")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    
    user = conn.execute(
        "SELECT telegram_id, wot_nickname, wot_account_id, wot_verified FROM users WHERE wot_nickname = ?",
        (nickname,)
    ).fetchone()
    
    if user:
        print(f"  ✅ Найден в БД:")
        print(f"     telegram_id: {user['telegram_id']}")
        print(f"     wot_nickname: {user['wot_nickname']}")
        print(f"     wot_account_id: {user['wot_account_id']}")
        print(f"     wot_verified: {user['wot_verified']}")
        account_id = user['wot_account_id']
    else:
        print(f"  ❌ НЕ найден в БД по нику '{nickname}'")
        # Попробуем поиск по LIKE
        users = conn.execute(
            "SELECT telegram_id, wot_nickname, wot_account_id FROM users WHERE wot_nickname LIKE ?",
            (f"%{nickname}%",)
        ).fetchall()
        if users:
            print(f"  🔎 Похожие ники в БД:")
            for u in users:
                print(f"     {u['wot_nickname']} (account_id={u['wot_account_id']}, tg={u['telegram_id']})")
        account_id = None
    
    # 2. Ищем через Lesta API по нику
    print("\n📋 2. Поиск через Lesta API...")
    url = f"https://api.tanki.su/wot/account/list/?application_id={LESTA_APP_ID}&search={nickname}&limit=5"
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        print(f"  API status: {data.get('status')}")
        if data.get('status') == 'ok' and data.get('data'):
            for p in data['data']:
                match = "✅ ТОЧНОЕ СОВПАДЕНИЕ" if p['nickname'] == nickname else ""
                print(f"  → {p['nickname']} (account_id={p['account_id']}) {match}")
                if p['nickname'] == nickname:
                    account_id = p['account_id']
        else:
            print(f"  ❌ Игрок не найден через API")
            print(f"  Raw: {json.dumps(data, ensure_ascii=False)[:300]}")
    except Exception as e:
        print(f"  ❌ Ошибка API: {e}")
    
    if not account_id:
        print("\n❌ ИТОГО: account_id не найден ни в БД, ни через API. Это причина ошибки!")
        conn.close()
        return
    
    # 3. Проверяем per-tank статистику
    print(f"\n📋 3. Загрузка статистики (account_id={account_id})...")
    url = (f"https://api.tanki.su/wot/tanks/stats/"
           f"?application_id={LESTA_APP_ID}&account_id={account_id}"
           f"&fields=tank_id,all.battles,all.damage_dealt,all.spotted,all.frags,"
           f"all.xp,all.wins,all.damage_received,all.shots,all.hits,all.survived_battles")
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        print(f"  API status: {data.get('status')}")
        
        if data.get('status') != 'ok':
            print(f"  ❌ API вернул ошибку: {data.get('error')}")
            print(f"  Raw: {json.dumps(data, ensure_ascii=False)[:500]}")
        else:
            tank_list = data['data'].get(str(account_id))
            if tank_list is None:
                print(f"  ❌ data['{account_id}'] = None (профиль СКРЫТ в игре или нет данных)")
                print(f"  Ключи в data['data']: {list(data['data'].keys())[:5]}")
            elif not tank_list:
                print(f"  ❌ Пустой список танков (0 боёв или профиль скрыт)")
            else:
                print(f"  ✅ Получено статистик по {len(tank_list)} танкам")
                total_battles = sum(t['all']['battles'] for t in tank_list)
                print(f"  📊 Всего боёв: {total_battles}")
                # Покажем топ-5 танков
                top5 = sorted(tank_list, key=lambda t: t['all']['battles'], reverse=True)[:5]
                for t in top5:
                    print(f"     tank_id={t['tank_id']}: {t['all']['battles']} боёв, {t['all']['damage_dealt']} урона")
    except Exception as e:
        print(f"  ❌ Ошибка получения статистики: {e}")
    
    # 4. Проверяем активные челленджи
    print(f"\n📋 4. Активные челленджи с этим игроком...")
    challenges = conn.execute("""
        SELECT id, from_telegram_id, to_telegram_id, tank_tier, tank_type, tank_id, 
               condition, battles, status, from_start_stats IS NOT NULL as has_from_stats,
               to_start_stats IS NOT NULL as has_to_stats
        FROM arena_challenges 
        WHERE status IN ('active', 'pending')
          AND (from_telegram_id = ? OR to_telegram_id = ?)
    """, (user['telegram_id'] if user else 0, user['telegram_id'] if user else 0)).fetchall()
    
    if challenges:
        for ch in challenges:
            print(f"  Challenge #{ch['id']}: status={ch['status']}")
            print(f"    from_tg={ch['from_telegram_id']}, to_tg={ch['to_telegram_id']}")
            print(f"    tank_tier={ch['tank_tier']}, tank_type={ch['tank_type']}, tank_id={ch['tank_id']}")
            print(f"    has_from_stats={ch['has_from_stats']}, has_to_stats={ch['has_to_stats']}")
    else:
        print(f"  Нет активных челленджей")
    
    conn.close()
    print(f"\n{'='*60}")

# Проверяем конкретного игрока
check_player("Fors777_2016")
