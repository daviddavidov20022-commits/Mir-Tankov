"""
Модуль ивентов — «1 против 15» и другие форматы

Типы ивентов:
- boss_fight: стример (босс) против 15 игроков
- tournament: мини-турнир между подписчиками
- training: тренировочные бои с разбором
"""

import logging
from datetime import datetime, timedelta
from database import get_db, get_user_by_telegram_id

logger = logging.getLogger(__name__)


# ============================================================
# СОЗДАНИЕ И УПРАВЛЕНИЕ ИВЕНТАМИ
# ============================================================

def create_event(
    title: str,
    description: str = "",
    event_type: str = "boss_fight",
    max_participants: int = 15,
    boss_nickname: str = None,
    boss_tank: str = None,
    participant_tier: int = 8,
    map_name: str = None,
    reward_description: str = None,
    scheduled_at: datetime = None,
    subscribers_only: bool = True,
) -> dict:
    """Создать новый ивент"""
    if scheduled_at is None:
        scheduled_at = datetime.now() + timedelta(days=1)

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO events "
            "(title, description, event_type, max_participants, boss_nickname, "
            "boss_tank, participant_tier, map_name, reward_description, "
            "scheduled_at, subscribers_only) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (title, description, event_type, max_participants, boss_nickname,
             boss_tank, participant_tier, map_name, reward_description,
             scheduled_at, 1 if subscribers_only else 0)
        )
        event_id = cursor.lastrowid

    return {
        "id": event_id,
        "title": title,
        "scheduled_at": scheduled_at.strftime("%d.%m.%Y %H:%M"),
        "max_participants": max_participants,
    }


def get_active_events() -> list:
    """Получить активные ивенты"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT e.*, "
            "(SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) as registered "
            "FROM events e "
            "WHERE e.is_active = 1 AND e.scheduled_at > ? "
            "ORDER BY e.scheduled_at ASC",
            (datetime.now(),)
        ).fetchall()
        return [dict(r) for r in rows]


def get_event(event_id: int) -> dict | None:
    """Получить ивент по ID"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT e.*, "
            "(SELECT COUNT(*) FROM event_registrations er WHERE er.event_id = e.id) as registered "
            "FROM events e WHERE e.id = ?",
            (event_id,)
        ).fetchone()
        return dict(row) if row else None


def register_for_event(telegram_id: int, event_id: int, wot_nickname: str) -> dict:
    """Зарегистрироваться на ивент"""
    import sqlite3

    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return {"success": False, "error": "Сначала зарегистрируйтесь: /start"}

    event = get_event(event_id)
    if not event:
        return {"success": False, "error": "Ивент не найден"}

    if not event["is_active"]:
        return {"success": False, "error": "Ивент уже закрыт"}

    if event["registered"] >= event["max_participants"]:
        return {"success": False, "error": "Все слоты заняты! 😢"}

    with get_db() as conn:
        try:
            conn.execute(
                "INSERT INTO event_registrations (event_id, user_id, wot_nickname) "
                "VALUES (?, ?, ?)",
                (event_id, user["id"], wot_nickname)
            )
            slots_left = event["max_participants"] - event["registered"] - 1
            return {
                "success": True,
                "message": f"✅ Вы зарегистрированы!",
                "slots_left": slots_left,
                "position": event["registered"] + 1,
            }
        except sqlite3.IntegrityError:
            return {"success": False, "error": "Вы уже зарегистрированы на этот ивент"}


def unregister_from_event(telegram_id: int, event_id: int) -> dict:
    """Отменить регистрацию"""
    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return {"success": False, "error": "Пользователь не найден"}

    with get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM event_registrations WHERE event_id = ? AND user_id = ?",
            (event_id, user["id"])
        )
        if cursor.rowcount > 0:
            return {"success": True, "message": "Регистрация отменена"}
        return {"success": False, "error": "Вы не были зарегистрированы"}


def get_event_participants(event_id: int) -> list:
    """Получить список участников ивента"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT u.telegram_id, u.first_name, u.username, "
            "er.wot_nickname, er.status, er.registered_at "
            "FROM event_registrations er "
            "JOIN users u ON er.user_id = u.id "
            "WHERE er.event_id = ? "
            "ORDER BY er.registered_at ASC",
            (event_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def close_event(event_id: int) -> bool:
    """Закрыть ивент"""
    with get_db() as conn:
        conn.execute(
            "UPDATE events SET is_active = 0 WHERE id = ?", (event_id,)
        )
        return True


# ============================================================
# ФОРМАТИРОВАНИЕ
# ============================================================

EVENT_TYPE_NAMES = {
    "boss_fight": "⚔️ Босс-файт (1 против 15)",
    "tournament": "🏆 Мини-турнир",
    "training": "📚 Тренировка",
}


def format_event(event: dict) -> str:
    """Красивый текст ивента для Telegram"""
    event_type_name = EVENT_TYPE_NAMES.get(event["event_type"], "🎮 Ивент")
    scheduled = datetime.fromisoformat(event["scheduled_at"])
    registered = event.get("registered", 0)
    max_p = event["max_participants"]
    slots_left = max(0, max_p - registered)

    # Прогресс-бар заполненности
    filled = int((registered / max_p) * 10)
    bar = "█" * filled + "░" * (10 - filled)

    text = (
        f"⚔️ <b>{event['title']}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"📋 {event_type_name}\n"
    )

    if event.get("description"):
        text += f"\n{event['description']}\n"

    text += f"\n📅 <b>{scheduled.strftime('%d.%m.%Y в %H:%M')}</b> МСК\n\n"

    if event.get("boss_nickname"):
        text += f"👑 Босс: <b>{event['boss_nickname']}</b>\n"
    if event.get("boss_tank"):
        text += f"🪖 Танк босса: <b>{event['boss_tank']}</b>\n"
    if event.get("participant_tier"):
        text += f"🎯 Уровень техники: <b>{event['participant_tier']}</b>\n"
    if event.get("map_name"):
        text += f"🗺 Карта: <b>{event['map_name']}</b>\n"

    text += (
        f"\n👥 Участники: <b>{registered}/{max_p}</b>\n"
        f"[{bar}]\n"
    )

    if slots_left > 0:
        text += f"🟢 Свободно: <b>{slots_left}</b> слотов\n"
    else:
        text += "🔴 <b>Все слоты заняты!</b>\n"

    if event.get("reward_description"):
        text += f"\n🎁 Приз: <b>{event['reward_description']}</b>\n"

    if event.get("subscribers_only"):
        text += "\n🔒 <i>Только для подписчиков</i>"

    return text


def format_participants_list(participants: list, event_title: str = "") -> str:
    """Форматированный список участников"""
    if not participants:
        return "📋 Пока никто не зарегистрировался."

    text = f"📋 <b>УЧАСТНИКИ</b>\n"
    if event_title:
        text += f"<i>{event_title}</i>\n"
    text += "━━━━━━━━━━━━━━━━━━━\n\n"

    for i, p in enumerate(participants, 1):
        name = p["wot_nickname"] or p.get("first_name", "???")
        text += f"<b>{i}.</b> 🪖 {name}\n"

    return text
