"""
Тест реального API Lesta Games — Мир Танков
Этот скрипт ищет игрока по нику и выводит его статистику.

Использование:
    python test_real_api.py <ваш_application_id> <ник_игрока>

Пример:
    python test_real_api.py abc123def456 JEIKSON
"""

import asyncio
import aiohttp
import sys
import json
import os
from datetime import datetime


LESTA_API_URL = "https://api.tanki.su/wot"


async def search_player(app_id: str, nickname: str):
    """Поиск игрока по нику"""
    url = f"{LESTA_API_URL}/account/list/"
    params = {
        "application_id": app_id,
        "search": nickname,
        "limit": 10,
    }

    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            data = await resp.json()
            print(f"\n🔍 Поиск игрока: {nickname}")
            print(f"   Статус ответа: {data.get('status')}")

            if data.get("status") != "ok":
                print(f"   ❌ Ошибка: {data.get('error', {})}")
                return None

            players = data.get("data", [])
            if not players:
                print("   ❌ Игроки не найдены")
                return None

            print(f"   ✅ Найдено игроков: {len(players)}")
            for i, p in enumerate(players):
                print(f"      {i+1}. {p['nickname']} (ID: {p['account_id']})")

            return players


async def get_player_stats(app_id: str, account_id: int):
    """Получить полную статистику игрока"""
    url = f"{LESTA_API_URL}/account/info/"
    params = {
        "application_id": app_id,
        "account_id": account_id,
    }

    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            data = await resp.json()

            if data.get("status") != "ok":
                print(f"   ❌ Ошибка получения статистики: {data.get('error', {})}")
                return None

            player_data = data.get("data", {}).get(str(account_id))
            return player_data


async def get_player_vehicles(app_id: str, account_id: int):
    """Получить статистику по технике"""
    url = f"{LESTA_API_URL}/account/tanks/"
    params = {
        "application_id": app_id,
        "account_id": account_id,
    }

    async with aiohttp.ClientSession() as session:
        async with session.get(url, params=params) as resp:
            data = await resp.json()

            if data.get("status") != "ok":
                return None

            tanks = data.get("data", {}).get(str(account_id), [])
            return tanks


def format_stats(player_data: dict):
    """Красивый вывод статистики"""
    nickname = player_data.get("nickname", "Unknown")
    rating = player_data.get("global_rating", 0)
    stats = player_data.get("statistics", {}).get("all", {})

    battles = stats.get("battles", 0)
    wins = stats.get("wins", 0)
    losses = stats.get("losses", 0)
    draws = stats.get("draws", 0)
    survived = stats.get("survived_battles", 0)
    damage = stats.get("damage_dealt", 0)
    frags = stats.get("frags", 0)
    spotted = stats.get("spotted", 0)
    hits = stats.get("hits_percents", 0)
    avg_xp = stats.get("battle_avg_xp", 0)
    max_xp = stats.get("max_xp", 0)
    max_dmg = stats.get("max_damage", 0)
    capture = stats.get("capture_points", 0)
    defend = stats.get("dropped_capture_points", 0)

    winrate = round((wins / battles) * 100, 2) if battles > 0 else 0
    avg_damage = round(damage / battles) if battles > 0 else 0
    avg_frags = round(frags / battles, 2) if battles > 0 else 0
    avg_spotted = round(spotted / battles, 2) if battles > 0 else 0
    survive_rate = round((survived / battles) * 100, 1) if battles > 0 else 0

    created = player_data.get("created_at", 0)
    created_str = datetime.fromtimestamp(created).strftime("%d.%m.%Y") if created else "—"

    last_battle = player_data.get("last_battle_time", 0)
    last_battle_str = datetime.fromtimestamp(last_battle).strftime("%d.%m.%Y %H:%M") if last_battle else "—"

    print(f"""
╔══════════════════════════════════════════════╗
║  🪖 {nickname}
╠══════════════════════════════════════════════╣
║
║  📊 ОБЩАЯ СТАТИСТИКА
║  ├ ⚔️  Боёв:         {battles:,}
║  ├ 🏆 Побед:         {wins:,} ({winrate}%)
║  ├ 💀 Поражений:     {losses:,}
║  ├ 🤝 Ничьих:        {draws:,}
║  └ 💚 Выживаемость:  {survive_rate}%
║
║  💥 БОЕВЫЕ ПОКАЗАТЕЛИ
║  ├ 💣 Средний урон:   {avg_damage:,}
║  ├ 🎯 Средние фраги:  {avg_frags}
║  ├ 👁  Средний засвет: {avg_spotted}
║  ├ 🎯 Точность:       {hits}%
║  ├ ⭐ Средний опыт:   {avg_xp:,}
║  ├ 🔥 Макс. урон:     {max_dmg:,}
║  └ ⭐ Макс. опыт:     {max_xp:,}
║
║  🏅 РЕЙТИНГ
║  ├ 📈 Личный рейтинг: {rating:,}
║  ├ 🏰 Захват:         {capture:,} очков
║  └ 🛡  Защита:         {defend:,} очков
║
║  📅 Регистрация:    {created_str}
║  🕐 Последний бой:  {last_battle_str}
║
╚══════════════════════════════════════════════╝
""")


async def save_data_for_webapp(player_data: dict, tanks: list):
    """Сохранить данные в JSON для использования в Web App"""
    export = {
        "player": player_data,
        "tanks_count": len(tanks) if tanks else 0,
        "fetched_at": datetime.now().isoformat(),
    }

    filepath = os.path.join(os.path.dirname(__file__), "webapp", "real_player_data.json")
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(export, f, ensure_ascii=False, indent=2)

    print(f"💾 Данные сохранены в: {filepath}")
    print(f"   Теперь Web App может использовать реальные данные!")


async def main():
    if len(sys.argv) < 3:
        print("❌ Использование: python test_real_api.py <application_id> <ник_игрока>")
        print("   Пример: python test_real_api.py abc123 JEIKSON")
        print()
        print("📝 Чтобы получить application_id:")
        print("   1. Откройте https://developers.lesta.ru/")
        print("   2. Войдите через аккаунт Lesta Games")
        print("   3. Мои приложения → Добавить приложение")
        print("   4. Название: MirTankovBot, Тип: Серверное")
        print("   5. Скопируйте application_id")
        return

    app_id = sys.argv[1]
    nickname = sys.argv[2]

    print("=" * 50)
    print("  🎮 ТЕСТ API LESTA GAMES — МИР ТАНКОВ")
    print("=" * 50)

    # 1. Поиск игрока
    players = await search_player(app_id, nickname)
    if not players:
        return

    # 2. Берём первого найденного (точное совпадение)
    target = players[0]
    account_id = target["account_id"]
    print(f"\n📋 Загружаем статистику для: {target['nickname']} (ID: {account_id})")

    # 3. Получаем статистику
    player_data = await get_player_stats(app_id, account_id)
    if not player_data:
        return

    # 4. Красивый вывод
    format_stats(player_data)

    # 5. Получаем технику
    tanks = await get_player_vehicles(app_id, account_id)
    if tanks:
        print(f"🚀 Техника в ангаре: {len(tanks)} танков")

    # 6. Сохраняем для Web App
    await save_data_for_webapp(player_data, tanks)

    # 7. Сохраняем сырые данные для отладки
    raw_path = os.path.join(os.path.dirname(__file__), "raw_player_data.json")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(player_data, f, ensure_ascii=False, indent=2)
    print(f"📄 Сырые данные: {raw_path}")


if __name__ == "__main__":
    asyncio.run(main())
