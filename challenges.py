"""
Модуль челленджей — Мир Танков

Типы челленджей:
- damage: набрать N урона за бой
- kills: набить N фрагов за бой
- wins: выиграть N боёв
- xp: набрать N опыта
- survive: выжить в N боях подряд
- custom: кастомный (ручная проверка)
"""

import logging
import sqlite3
from datetime import datetime, timedelta
from database import get_db, get_or_create_user, get_user_by_telegram_id, add_coins, add_xp

logger = logging.getLogger(__name__)


# ============================================================
# ТИПЫ ЧЕЛЛЕНДЖЕЙ
# ============================================================

CHALLENGE_TYPES = {
    "damage": {
        "name": "💥 Урон",
        "description": "Набери {target} урона за один бой",
        "icon": "💥",
        "unit": "урона",
    },
    "kills": {
        "name": "💀 Фраги",
        "description": "Набей {target} фрагов за один бой",
        "icon": "💀",
        "unit": "фрагов",
    },
    "wins": {
        "name": "🏆 Победы",
        "description": "Выиграй {target} боёв",
        "icon": "🏆",
        "unit": "побед",
    },
    "xp": {
        "name": "⭐ Опыт",
        "description": "Набери {target} опыта за один бой",
        "icon": "⭐",
        "unit": "XP",
    },
    "survive": {
        "name": "🛡 Выживание",
        "description": "Выживи в {target} боях подряд",
        "icon": "🛡",
        "unit": "боёв",
    },
    "custom": {
        "name": "🎯 Особый",
        "description": "{target}",
        "icon": "🎯",
        "unit": "",
    },
}

# Готовые шаблоны челленджей
CHALLENGE_TEMPLATES = [
    {
        "title": "Разрушитель",
        "description": "Нанеси 5000+ урона за один бой на любом танке 8-10 уровня",
        "icon": "💥",
        "challenge_type": "damage",
        "target_value": 5000,
        "reward_coins": 200,
        "reward_xp": 100,
        "tank_tier": 8,
        "duration_hours": 168,  # 1 неделя
    },
    {
        "title": "Мастер Фрагов",
        "description": "Набей 5+ фрагов за один бой",
        "icon": "💀",
        "challenge_type": "kills",
        "target_value": 5,
        "reward_coins": 300,
        "reward_xp": 150,
        "duration_hours": 168,
    },
    {
        "title": "Серия Побед",
        "description": "Выиграй 10 боёв за неделю",
        "icon": "🏆",
        "challenge_type": "wins",
        "target_value": 10,
        "reward_coins": 150,
        "reward_xp": 75,
        "duration_hours": 168,
    },
    {
        "title": "Живучий",
        "description": "Выживи в 5 боях подряд на технике 10 уровня",
        "icon": "🛡",
        "challenge_type": "survive",
        "target_value": 5,
        "reward_coins": 250,
        "reward_xp": 120,
        "tank_tier": 10,
        "duration_hours": 168,
    },
    {
        "title": "XP Машина",
        "description": "Набери 2000+ базового опыта за один бой",
        "icon": "⭐",
        "challenge_type": "xp",
        "target_value": 2000,
        "reward_coins": 500,
        "reward_xp": 200,
        "duration_hours": 168,
    },
]


# ============================================================
# СОЗДАНИЕ И УПРАВЛЕНИЕ ЧЕЛЛЕНДЖАМИ
# ============================================================

def create_challenge(
    title: str,
    description: str,
    challenge_type: str = "damage",
    target_value: int = 5000,
    reward_coins: int = 100,
    reward_xp: int = 50,
    duration_hours: int = 168,
    tank_tier: int = None,
    tank_name: str = None,
    subscribers_only: bool = True,
    created_by: int = None,
    icon: str = None,
) -> dict:
    """Создать новый челлендж"""
    type_info = CHALLENGE_TYPES.get(challenge_type, CHALLENGE_TYPES["custom"])
    if icon is None:
        icon = type_info["icon"]

    ends_at = datetime.now() + timedelta(hours=duration_hours)

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO challenges "
            "(title, description, icon, challenge_type, target_value, "
            "reward_coins, reward_xp, tank_tier, tank_name, ends_at, "
            "subscribers_only, created_by) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (title, description, icon, challenge_type, target_value,
             reward_coins, reward_xp, tank_tier, tank_name, ends_at,
             1 if subscribers_only else 0, created_by)
        )
        challenge_id = cursor.lastrowid

    return {
        "id": challenge_id,
        "title": title,
        "icon": icon,
        "ends_at": ends_at.strftime("%d.%m.%Y %H:%M"),
        "reward_coins": reward_coins,
    }


def create_from_template(template_index: int, created_by: int = None) -> dict:
    """Создать челлендж из готового шаблона"""
    if template_index < 0 or template_index >= len(CHALLENGE_TEMPLATES):
        return {"success": False, "error": "Шаблон не найден"}

    t = CHALLENGE_TEMPLATES[template_index]
    result = create_challenge(
        title=t["title"],
        description=t["description"],
        challenge_type=t["challenge_type"],
        target_value=t["target_value"],
        reward_coins=t["reward_coins"],
        reward_xp=t["reward_xp"],
        duration_hours=t["duration_hours"],
        tank_tier=t.get("tank_tier"),
        icon=t["icon"],
        created_by=created_by,
    )
    result["success"] = True
    return result


def get_active_challenges() -> list:
    """Получить все активные челленджи"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT c.*, "
            "(SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id) as participants, "
            "(SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id AND cp.is_completed = 1) as completed "
            "FROM challenges c "
            "WHERE c.is_active = 1 AND c.ends_at > ? "
            "ORDER BY c.ends_at ASC",
            (datetime.now(),)
        ).fetchall()
        return [dict(r) for r in rows]


def get_challenge(challenge_id: int) -> dict | None:
    """Получить челлендж по ID"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT c.*, "
            "(SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id) as participants, "
            "(SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id AND cp.is_completed = 1) as completed "
            "FROM challenges c WHERE c.id = ?",
            (challenge_id,)
        ).fetchone()
        return dict(row) if row else None


def join_challenge(telegram_id: int, challenge_id: int) -> dict:
    """Присоединиться к челленджу"""
    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return {"success": False, "error": "Пользователь не найден"}

    challenge = get_challenge(challenge_id)
    if not challenge:
        return {"success": False, "error": "Челлендж не найден"}

    if not challenge["is_active"]:
        return {"success": False, "error": "Челлендж больше не активен"}

    ends_at = datetime.fromisoformat(challenge["ends_at"])
    if ends_at <= datetime.now():
        return {"success": False, "error": "Челлендж уже закончился"}

    with get_db() as conn:
        try:
            conn.execute(
                "INSERT INTO challenge_participants (challenge_id, user_id) VALUES (?, ?)",
                (challenge_id, user["id"])
            )
            return {"success": True, "message": "Вы присоединились к челленджу!"}
        except sqlite3.IntegrityError:
            return {"success": False, "error": "Вы уже участвуете в этом челлендже"}



def submit_result(telegram_id: int, challenge_id: int, value: int, proof: str = None) -> dict:
    """Отправить результат челленджа"""
    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return {"success": False, "error": "Пользователь не найден"}

    challenge = get_challenge(challenge_id)
    if not challenge:
        return {"success": False, "error": "Челлендж не найден"}

    # Работаем с БД
    with get_db() as conn:
        participant = conn.execute(
            "SELECT * FROM challenge_participants "
            "WHERE challenge_id = ? AND user_id = ?",
            (challenge_id, user["id"])
        ).fetchone()

        if not participant:
            return {"success": False, "error": "Вы не участвуете в этом челлендже"}

        if participant["is_completed"]:
            return {"success": False, "error": "Вы уже выполнили этот челлендж"}

        # Обновляем прогресс
        new_value = max(participant["current_value"], value)
        is_completed = 1 if new_value >= challenge["target_value"] else 0

        conn.execute(
            "UPDATE challenge_participants "
            "SET current_value = ?, is_completed = ?, proof_screenshot = ?, submitted_at = ? "
            "WHERE challenge_id = ? AND user_id = ?",
            (new_value, is_completed, proof, datetime.now(), challenge_id, user["id"])
        )

    # Выдаём награду ПОСЛЕ закрытия соединения (чтобы избежать блокировки БД)
    if is_completed:
        add_coins(telegram_id, challenge["reward_coins"],
                  f"Челлендж: {challenge['title']}")
        add_xp(telegram_id, challenge["reward_xp"])
        return {
            "success": True,
            "completed": True,
            "reward_coins": challenge["reward_coins"],
            "reward_xp": challenge["reward_xp"],
        }

    return {
        "success": True,
        "completed": False,
        "current_value": new_value,
        "target_value": challenge["target_value"],
        "progress": round(new_value / challenge["target_value"] * 100, 1),
    }


def get_challenge_leaderboard(challenge_id: int, limit: int = 10) -> list:
    """Таблица лидеров для челленджа"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT u.first_name, u.username, u.wot_nickname, "
            "cp.current_value, cp.is_completed, cp.submitted_at "
            "FROM challenge_participants cp "
            "JOIN users u ON cp.user_id = u.id "
            "WHERE cp.challenge_id = ? "
            "ORDER BY cp.current_value DESC, cp.submitted_at ASC "
            "LIMIT ?",
            (challenge_id, limit)
        ).fetchall()
        return [dict(r) for r in rows]


def get_user_challenges(telegram_id: int) -> list:
    """Получить челленджи пользователя"""
    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return []

    with get_db() as conn:
        rows = conn.execute(
            "SELECT c.*, cp.current_value, cp.is_completed, cp.joined_at "
            "FROM challenge_participants cp "
            "JOIN challenges c ON cp.challenge_id = c.id "
            "WHERE cp.user_id = ? "
            "ORDER BY cp.joined_at DESC",
            (user["id"],)
        ).fetchall()
        return [dict(r) for r in rows]


def close_expired_challenges() -> int:
    """Закрыть истёкшие челленджи"""
    with get_db() as conn:
        cursor = conn.execute(
            "UPDATE challenges SET is_active = 0 "
            "WHERE is_active = 1 AND ends_at <= ?",
            (datetime.now(),)
        )
        count = cursor.rowcount
        if count > 0:
            logger.info(f"Закрыто {count} истёкших челленджей")
        return count


# ============================================================
# ФОРМАТИРОВАНИЕ
# ============================================================

def format_challenge(challenge: dict) -> str:
    """Красивый текст челленджа для Telegram"""
    type_info = CHALLENGE_TYPES.get(challenge["challenge_type"], CHALLENGE_TYPES["custom"])
    ends_at = datetime.fromisoformat(challenge["ends_at"])
    days_left = max(0, (ends_at - datetime.now()).days)
    hours_left = max(0, int((ends_at - datetime.now()).total_seconds() // 3600))

    if days_left > 0:
        time_str = f"{days_left} дн."
    else:
        time_str = f"{hours_left} ч."

    participants = challenge.get("participants", 0)
    completed = challenge.get("completed", 0)

    text = (
        f"{challenge['icon']} <b>{challenge['title']}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"📋 {challenge['description']}\n\n"
        f"🎯 Цель: <b>{challenge['target_value']}</b> {type_info['unit']}\n"
        f"🪙 Награда: <b>{challenge['reward_coins']}</b> монет + "
        f"<b>{challenge['reward_xp']}</b> XP\n"
    )

    if challenge.get("tank_tier"):
        text += f"🪖 Уровень танка: <b>{challenge['tank_tier']}+</b>\n"
    if challenge.get("tank_name"):
        text += f"🚀 Танк: <b>{challenge['tank_name']}</b>\n"

    text += (
        f"\n👥 Участников: <b>{participants}</b>\n"
        f"✅ Выполнили: <b>{completed}</b>\n"
        f"⏰ Осталось: <b>{time_str}</b>\n"
    )

    if challenge.get("subscribers_only"):
        text += "\n🔒 <i>Только для подписчиков</i>"

    return text


def format_leaderboard(entries: list, challenge_title: str = "") -> str:
    """Формат таблицы лидеров"""
    if not entries:
        return "📊 Пока никто не участвует."

    medals = ["🥇", "🥈", "🥉"]
    text = f"🏆 <b>ТАБЛИЦА ЛИДЕРОВ</b>\n"
    if challenge_title:
        text += f"<i>{challenge_title}</i>\n"
    text += "━━━━━━━━━━━━━━━━━━━\n\n"

    for i, entry in enumerate(entries):
        medal = medals[i] if i < 3 else f"<b>{i+1}.</b>"
        name = entry.get("wot_nickname") or entry.get("first_name") or entry.get("username") or "???"
        value = entry["current_value"]
        status = "✅" if entry["is_completed"] else "⏳"

        text += f"{medal} {name} — <b>{value}</b> {status}\n"

    return text
