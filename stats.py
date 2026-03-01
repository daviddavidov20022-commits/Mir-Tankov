"""
Модуль статистики игроков — Мир Танков (Lesta API)

Как подключить реальный API:
1. Откройте https://developers.lesta.ru/
2. Войдите через аккаунт Lesta Games
3. Мои приложения → Добавить приложение → Серверное
4. Добавьте в .env: LESTA_APP_ID=ваш_ключ
5. Перезапустите бота — готово!
"""

import aiohttp
import logging
import os
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ============================================================
# НАСТРОЙКА API
# ============================================================
# Ключ читается из .env файла автоматически
LESTA_APP_ID = os.getenv("LESTA_APP_ID", "")

# Базовый URL API Мир Танков (Lesta Games)
LESTA_API_URL = "https://api.tanki.su/wot"

# Режим работы: True = реальный API, False = моковые данные
USE_REAL_API = bool(LESTA_APP_ID)

if USE_REAL_API:
    logger.info("✅ API Lesta Games подключён (application_id найден)")
else:
    logger.info("⚠️ API ключ не найден — используем моковые данные. Добавьте LESTA_APP_ID в .env")


# ============================================================
# ДАННЫЕ КЛАНА
# ============================================================
CLAN_INFO = {
    663308: {
        "clan_id": 663308,
        "tag": "DJENT",
        "name": "КЛАН ДЖЕНТЛЬМЕНОВ",
        "color": "#FFD700",
    }
}


# ============================================================
# МОКОВЫЕ ДАННЫЕ (для разработки без API ключа)
# Используются реальные данные аккаунтов для визуала
# ============================================================
MOCK_PLAYERS = {
    "fors777_2016": {
        "account_id": 63712847,
        "nickname": "Fors777_2016",
        "global_rating": 3785,
        "created_at": 1452628672,   # 12.01.2016
        "last_battle_time": 1772051200,  # 25.02.2026
        "clan_id": 663308,
        "clan": {
            "clan_id": 663308,
            "tag": "DJENT",
            "name": "КЛАН ДЖЕНТЛЬМЕНОВ",
            "role": "executive_officer",
            "role_i18n": "Офицер по кадрам",
        },
        "statistics": {
            "all": {
                "battles": 9383,
                "wins": 4362,
                "losses": 4928,
                "draws": 93,
                "survived_battles": 1724,
                "damage_dealt": 6137364,
                "frags": 4947,
                "spotted": 8229,
                "hits_percents": 60,
                "capture_points": 6624,
                "dropped_capture_points": 3570,
                "xp": 3847155,
                "battle_avg_xp": 410,
                "max_xp": 2076,
                "max_damage": 6275,
                "max_frags": 8,
                "shots": 65140,
                "hits": 39164,
                "damage_received": 8635193,
                "piercings": 25002,
                "avg_damage_blocked": 270.29,
                "avg_damage_assisted": 284.58,
                "tanking_factor": 0.31,
                "trees_cut": 13153,
            }
        },
    },
    "tank_master_2026": {
        "account_id": 12345678,
        "nickname": "Tank_Master_2026",
        "global_rating": 8450,
        "created_at": 1420066800,
        "last_battle_time": 1708700000,
        "statistics": {
            "all": {
                "battles": 25430,
                "wins": 13452,
                "losses": 11500,
                "draws": 478,
                "survived_battles": 8200,
                "damage_dealt": 45600800,
                "frags": 28450,
                "spotted": 31200,
                "hits_percents": 74,
                "capture_points": 12500,
                "dropped_capture_points": 8400,
                "xp": 18500600,
                "battle_avg_xp": 727,
                "max_xp": 2450,
                "max_damage": 8200,
            }
        },
    },
    "noob_killer_99": {
        "account_id": 87654321,
        "nickname": "NoOb_KiLLeR_99",
        "global_rating": 5200,
        "created_at": 1546300800,
        "last_battle_time": 1708600000,
        "statistics": {
            "all": {
                "battles": 8320,
                "wins": 3910,
                "losses": 4200,
                "draws": 210,
                "survived_battles": 2100,
                "damage_dealt": 9800500,
                "frags": 7200,
                "spotted": 8900,
                "hits_percents": 62,
                "capture_points": 3200,
                "dropped_capture_points": 2100,
                "xp": 4500200,
                "battle_avg_xp": 541,
                "max_xp": 1850,
                "max_damage": 5400,
            }
        },
    },
    "pro_tanker": {
        "account_id": 11223344,
        "nickname": "PRO_TANKER",
        "global_rating": 11200,
        "created_at": 1388534400,
        "last_battle_time": 1708750000,
        "statistics": {
            "all": {
                "battles": 52000,
                "wins": 30680,
                "losses": 20400,
                "draws": 920,
                "survived_battles": 18500,
                "damage_dealt": 125000000,
                "frags": 65400,
                "spotted": 72000,
                "hits_percents": 82,
                "capture_points": 28000,
                "dropped_capture_points": 19500,
                "xp": 48000000,
                "battle_avg_xp": 923,
                "max_xp": 3200,
                "max_damage": 12400,
            }
        },
    },
}


# ============================================================
# ПОИСК ИГРОКА
# ============================================================
async def search_player(nickname: str) -> list:
    """
    Поиск игрока по нику.
    Возвращает список найденных игроков: [{"account_id": ..., "nickname": ...}, ...]
    """
    if USE_REAL_API:
        return await _search_player_api(nickname)
    else:
        return _search_player_mock(nickname)


async def _search_player_api(nickname: str) -> list:
    """Поиск через реальный API"""
    url = f"{LESTA_API_URL}/account/list/"
    params = {
        "application_id": LESTA_APP_ID,
        "search": nickname,
        "limit": 5,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as resp:
                data = await resp.json()

                if data.get("status") != "ok":
                    logger.error(f"API ошибка: {data.get('error', {})}")
                    return []

                results = data.get("data", [])
                return [{"account_id": p["account_id"], "nickname": p["nickname"]} for p in results]
    except Exception as e:
        logger.error(f"Ошибка поиска: {e}")
        return []


def _search_player_mock(nickname: str) -> list:
    """Поиск в моковых данных"""
    search = nickname.lower().strip()
    results = []

    for key, player in MOCK_PLAYERS.items():
        if search in key or search in player["nickname"].lower():
            results.append({
                "account_id": player["account_id"],
                "nickname": player["nickname"],
            })

    # Если не нашли точное совпадение — вернём "заглушку" с введённым ником
    if not results:
        results.append({
            "account_id": 99999999,
            "nickname": nickname,
            "_mock_generated": True,
        })

    return results


# ============================================================
# ПОЛУЧЕНИЕ СТАТИСТИКИ ИГРОКА
# ============================================================
async def get_player_stats(account_id: int) -> dict | None:
    """
    Получить полную статистику игрока по account_id.
    """
    if USE_REAL_API:
        return await _get_stats_api(account_id)
    else:
        return _get_stats_mock(account_id)


async def _get_stats_api(account_id: int) -> dict | None:
    """Получить статистику через API"""
    url = f"{LESTA_API_URL}/account/info/"
    params = {
        "application_id": LESTA_APP_ID,
        "account_id": account_id,
        "fields": "nickname,global_rating,created_at,last_battle_time,statistics.all",
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(url, params=params) as resp:
                data = await resp.json()

                if data.get("status") != "ok":
                    logger.error(f"API ошибка: {data.get('error', {})}")
                    return None

                player_data = data.get("data", {}).get(str(account_id))
                return player_data
    except Exception as e:
        logger.error(f"Ошибка получения статистики: {e}")
        return None


def _get_stats_mock(account_id: int) -> dict | None:
    """Получить статистику из моковых данных"""
    for player in MOCK_PLAYERS.values():
        if player["account_id"] == account_id:
            return player

    # Генерируем случайные данные для неизвестного игрока
    import random
    battles = random.randint(1000, 30000)
    wins = int(battles * random.uniform(0.45, 0.58))

    return {
        "account_id": account_id,
        "nickname": f"Player_{account_id}",
        "global_rating": random.randint(3000, 12000),
        "created_at": 1500000000,
        "last_battle_time": 1708700000,
        "statistics": {
            "all": {
                "battles": battles,
                "wins": wins,
                "losses": battles - wins - int(battles * 0.02),
                "draws": int(battles * 0.02),
                "survived_battles": int(battles * 0.32),
                "damage_dealt": int(battles * random.uniform(1200, 2200)),
                "frags": int(battles * random.uniform(0.8, 1.3)),
                "spotted": int(battles * random.uniform(1.0, 1.5)),
                "hits_percents": random.randint(55, 85),
                "capture_points": int(battles * random.uniform(0.3, 0.6)),
                "dropped_capture_points": int(battles * random.uniform(0.2, 0.4)),
                "xp": int(battles * random.uniform(500, 900)),
                "battle_avg_xp": random.randint(400, 950),
                "max_xp": random.randint(1500, 3500),
                "max_damage": random.randint(4000, 12000),
            }
        },
    }


# ============================================================
# ФОРМАТИРОВАНИЕ СТАТИСТИКИ
# ============================================================
def format_player_stats(player_data: dict) -> str:
    """Красиво форматирует статистику игрока для Telegram"""

    nickname = player_data.get("nickname", "Unknown")
    rating = player_data.get("global_rating", 0)
    stats = player_data.get("statistics", {}).get("all", {})
    clan = player_data.get("clan")

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

    # Вычисляемые показатели
    winrate = round((wins / battles) * 100, 2) if battles > 0 else 0
    avg_damage = round(damage / battles) if battles > 0 else 0
    avg_frags = round(frags / battles, 2) if battles > 0 else 0
    avg_spotted = round(spotted / battles, 2) if battles > 0 else 0
    survive_rate = round((survived / battles) * 100, 1) if battles > 0 else 0

    # Оценка WN8 (упрощённая)
    wn8_estimate = _estimate_skill_level(winrate, avg_damage, avg_frags)

    # Рейтинг значок
    rating_badge = _get_rating_badge(rating)
    winrate_badge = _get_winrate_badge(winrate)

    # Дата регистрации
    created = player_data.get("created_at", 0)
    created_str = datetime.fromtimestamp(created).strftime("%d.%m.%Y") if created else "—"

    last_battle = player_data.get("last_battle_time", 0)
    last_battle_str = datetime.fromtimestamp(last_battle).strftime("%d.%m.%Y %H:%M") if last_battle else "—"

    # Предупреждение о моковых данных
    mock_warning = ""
    if not USE_REAL_API:
        mock_warning = "\n⚠️ <i>Демо-данные (API ключ не установлен)</i>\n"

    # Клановая информация
    clan_line = ""
    if clan:
        clan_tag = clan.get("tag", "")
        clan_name = clan.get("name", "")
        clan_role = clan.get("role_i18n", "")
        clan_line = (
            f"\n🛡 <b>КЛАН</b>\n"
            f"├ 🏴 [{clan_tag}] {clan_name}\n"
            f"└ 👤 {clan_role}\n"
        )

    text = (
        f"🪖 <b>{nickname}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━━\n"
        f"{mock_warning}"
        f"{clan_line}"
        f"\n"
        f"📊 <b>ОБЩАЯ СТАТИСТИКА</b>\n"
        f"├ ⚔️ Боёв: <b>{battles:,}</b>\n"
        f"├ 🏆 Побед: <b>{wins:,}</b> ({winrate_badge} <b>{winrate}%</b>)\n"
        f"├ 💀 Поражений: {losses:,}\n"
        f"├ 🤝 Ничьих: {draws:,}\n"
        f"└ 💚 Выживаемость: <b>{survive_rate}%</b>\n"
        f"\n"
        f"💥 <b>БОЕВЫЕ ПОКАЗАТЕЛИ</b>\n"
        f"├ 💣 Средний урон: <b>{avg_damage:,}</b>\n"
        f"├ 🎯 Средние фраги: <b>{avg_frags}</b>\n"
        f"├ 👁 Средний засвет: <b>{avg_spotted}</b>\n"
        f"├ 🎯 Точность: <b>{hits}%</b>\n"
        f"├ ⭐ Средний опыт: <b>{avg_xp:,}</b>\n"
        f"└ 🔥 Макс. урон: <b>{max_dmg:,}</b>\n"
        f"\n"
        f"🏅 <b>РЕЙТИНГ</b>\n"
        f"├ 📈 Личный рейтинг: {rating_badge} <b>{rating:,}</b>\n"
        f"├ 🎖 Уровень: <b>{wn8_estimate}</b>\n"
        f"├ 🏰 Захват: {capture:,} очков\n"
        f"└ 🛡 Защита: {defend:,} очков\n"
        f"\n"
        f"📅 Регистрация: {created_str}\n"
        f"🕐 Последний бой: {last_battle_str}\n"
    )

    return text


def _get_rating_badge(rating: int) -> str:
    """Эмодзи-бейдж по рейтингу"""
    if rating >= 10000:
        return "🟣"  # Уникум
    elif rating >= 8000:
        return "🔵"  # Отличный
    elif rating >= 6000:
        return "🟢"  # Хороший
    elif rating >= 4000:
        return "🟡"  # Средний
    else:
        return "🔴"  # Ниже среднего


def _get_winrate_badge(winrate: float) -> str:
    """Цветной индикатор по проценту побед"""
    if winrate >= 60:
        return "🟣"
    elif winrate >= 55:
        return "🔵"
    elif winrate >= 52:
        return "🟢"
    elif winrate >= 49:
        return "🟡"
    else:
        return "🔴"


def _estimate_skill_level(winrate: float, avg_damage: int, avg_frags: float) -> str:
    """Примерная оценка уровня игрока"""
    score = 0
    score += winrate * 2
    score += min(avg_damage / 50, 40)
    score += avg_frags * 10

    if score >= 160:
        return "🟣 Уникум"
    elif score >= 130:
        return "🔵 Отличный игрок"
    elif score >= 110:
        return "🟢 Хороший игрок"
    elif score >= 90:
        return "🟡 Средний игрок"
    else:
        return "🔴 Новичок"
