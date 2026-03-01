"""Тест API Lesta (Мир Танков)"""
import asyncio
import aiohttp

async def test():
    searches = [
        ("demo", "https://api.tanki.su/wot/account/list/"),
        ("demo", "https://api.worldoftanks.ru/wot/account/list/"),
    ]

    async with aiohttp.ClientSession() as session:
        for app_id, base_url in searches:
            url = f"{base_url}?application_id={app_id}&search=LeBwa&limit=3"
            print(f"\n🔍 Тестирую: {base_url}")
            try:
                async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    data = await resp.json()
                    status = data.get("status")
                    print(f"   Статус: {status}")
                    if status == "ok":
                        for p in data.get("data", []):
                            print(f"   ✅ Найден: {p['nickname']} (ID: {p['account_id']})")
                    else:
                        print(f"   ❌ Ошибка: {data.get('error', {})}")
            except Exception as e:
                print(f"   ❌ Ошибка подключения: {e}")

    # Также пробуем получить стату по конкретному ID
    print("\n" + "="*40)
    print("📊 Тестируем получение статистики...")
    stat_url = "https://api.tanki.su/wot/account/info/"
    # Пробуем с demo
    try:
        async with aiohttp.ClientSession() as session:
            # Сначала найдём ID
            search_url = f"https://api.tanki.su/wot/account/list/?application_id=demo&search=LeBwa&limit=1"
            async with session.get(search_url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                search_data = await resp.json()
                if search_data.get("status") == "ok" and search_data.get("data"):
                    acc_id = search_data["data"][0]["account_id"]
                    nick = search_data["data"][0]["nickname"]
                    print(f"   Найден: {nick} (ID: {acc_id})")
                    
                    # Получаем стату
                    info_url = f"{stat_url}?application_id=demo&account_id={acc_id}"
                    async with session.get(info_url, timeout=aiohttp.ClientTimeout(total=10)) as resp2:
                        info_data = await resp2.json()
                        if info_data.get("status") == "ok":
                            player = info_data["data"][str(acc_id)]
                            stats = player.get("statistics", {}).get("all", {})
                            print(f"   ✅ Боёв: {stats.get('battles', '?')}")
                            print(f"   ✅ Побед: {stats.get('wins', '?')}")
                            print(f"   ✅ Рейтинг: {player.get('global_rating', '?')}")
                            print(f"\n   🎉 API РАБОТАЕТ БЕЗ КЛЮЧА!")
                        else:
                            print(f"   ❌ Ошибка статистики: {info_data.get('error')}")
                else:
                    print(f"   ❌ Не удалось найти игрока: {search_data}")
    except Exception as e:
        print(f"   ❌ Ошибка: {e}")

asyncio.run(test())
