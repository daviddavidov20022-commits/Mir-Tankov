"""
Модуль Арены — PvP Дуэли с реальной проверкой через Lesta API

Как работает реальный челлендж:
1. Игрок A вызывает Игрока B (выбирает тип, метрику, кол-во боёв, ставку)
2. Игрок B принимает → бот запрашивает Lesta API → снимок статистики обоих 
3. Оба играют N боёв в Мир Танков
4. Кто-то нажимает "Проверить" → бот снова запрашивает API
5. Считает дельту (разницу) → кто набрал больше → тот победитель
6. Монеты переводятся автоматически

Метрики дельты:
- spotted: разница в урон по засвету за N боёв
- damage: разница в общем уроне
- frags: разница во фрагах
- wins: разница в победах
- xp: разница в опыте
"""

import json
import logging
import os
import sqlite3
from datetime import datetime, timedelta
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), "ecosystem.db")


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# Какие поля из API нужны для каждой метрики
METRIC_FIELDS = {
    "spotted": "spotted",
    "damage": "damage_dealt",
    "frags": "frags",
    "wins": "wins",
    "xp": "xp",
}

METRIC_LABELS = {
    "spotted": "👁 Засвет",
    "damage": "💥 Урон",
    "frags": "🎯 Фраги",
    "wins": "🏆 Победы",
    "xp": "⭐ Опыт",
}

TANK_CLASS_LABELS = {
    "any": "🔄 Любые",
    "light": "🏎️ Лёгкие",
    "medium": "⚡ Средние",
    "heavy": "🛡️ Тяжёлые",
    "td": "🎯 ПТ-САУ",
    "spg": "💥 Артиллерия",
}


# ============================================================
# СОЗДАНИЕ ДУЭЛИ
# ============================================================
def create_duel(
    challenger_telegram_id: int,
    challenger_nickname: str,
    challenger_account_id: int,
    opponent_nickname: str,
    opponent_telegram_id: int = None,
    opponent_account_id: int = None,
    challenge_type: str = "lt_spotting",
    tank_class: str = "light",
    tank_tier: int = 10,
    metric: str = "spotted",
    battles_count: int = 10,
    wager: int = 100,
) -> dict:
    """Создать PvP вызов"""
    expires_at = datetime.now() + timedelta(hours=24)

    with get_db() as conn:
        cursor = conn.execute("""
            INSERT INTO arena_duels 
            (challenger_telegram_id, challenger_nickname, challenger_account_id,
             opponent_nickname, opponent_telegram_id, opponent_account_id,
             challenge_type, tank_class, tank_tier, metric, battles_count, wager,
             status, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        """, (
            challenger_telegram_id, challenger_nickname, challenger_account_id,
            opponent_nickname, opponent_telegram_id, opponent_account_id,
            challenge_type, tank_class, tank_tier, metric, battles_count, wager,
            expires_at,
        ))
        duel_id = cursor.lastrowid

    logger.info(f"Дуэль #{duel_id}: {challenger_nickname} vs {opponent_nickname}")
    return {"success": True, "duel_id": duel_id}


# ============================================================
# ПРИНЯТЬ ДУЭЛЬ + СНИМОК СТАТИСТИКИ
# ============================================================
async def accept_duel(duel_id: int, opponent_telegram_id: int, get_stats_func=None) -> dict:
    """
    Принять вызов. Если передан get_stats_func — делаем снимок статистики из API.
    get_stats_func = async function(account_id) -> dict (из stats.py)
    """
    with get_db() as conn:
        duel = conn.execute(
            "SELECT * FROM arena_duels WHERE id = ? AND status = 'pending'",
            (duel_id,)
        ).fetchone()

        if not duel:
            return {"success": False, "error": "Дуэль не найдена или уже обработана"}

        # Делаем снимок статистики обоих игроков
        challenger_snapshot = None
        opponent_snapshot = None

        if get_stats_func and duel["challenger_account_id"]:
            try:
                ch_stats = await get_stats_func(duel["challenger_account_id"])
                if ch_stats:
                    all_stats = ch_stats.get("statistics", {}).get("all", {})
                    challenger_snapshot = json.dumps({
                        "battles": all_stats.get("battles", 0),
                        "spotted": all_stats.get("spotted", 0),
                        "damage_dealt": all_stats.get("damage_dealt", 0),
                        "frags": all_stats.get("frags", 0),
                        "wins": all_stats.get("wins", 0),
                        "xp": all_stats.get("xp", 0),
                    })
            except Exception as e:
                logger.error(f"Ошибка снимка challenger: {e}")

        if get_stats_func and duel["opponent_account_id"]:
            try:
                op_stats = await get_stats_func(duel["opponent_account_id"])
                if op_stats:
                    all_stats = op_stats.get("statistics", {}).get("all", {})
                    opponent_snapshot = json.dumps({
                        "battles": all_stats.get("battles", 0),
                        "spotted": all_stats.get("spotted", 0),
                        "damage_dealt": all_stats.get("damage_dealt", 0),
                        "frags": all_stats.get("frags", 0),
                        "wins": all_stats.get("wins", 0),
                        "xp": all_stats.get("xp", 0),
                    })
            except Exception as e:
                logger.error(f"Ошибка снимка opponent: {e}")

        conn.execute("""
            UPDATE arena_duels 
            SET status = 'accepted', opponent_telegram_id = ?, accepted_at = ?,
                challenger_stats_before = ?, opponent_stats_before = ?
            WHERE id = ?
        """, (opponent_telegram_id, datetime.now(), challenger_snapshot, opponent_snapshot, duel_id))

    metric_label = METRIC_LABELS.get(duel["metric"], duel["metric"])
    return {
        "success": True,
        "duel_id": duel_id,
        "message": f"⚔️ Дуэль принята! Играй {duel['battles_count']} боёв!\nМетрика: {metric_label}",
        "has_snapshots": bool(challenger_snapshot and opponent_snapshot),
    }


def decline_duel(duel_id: int) -> dict:
    """Отклонить вызов"""
    with get_db() as conn:
        conn.execute(
            "UPDATE arena_duels SET status = 'declined' WHERE id = ? AND status = 'pending'",
            (duel_id,)
        )
    return {"success": True}


# ============================================================
# ПРОВЕРКА РЕЗУЛЬТАТОВ (ГЛАВНАЯ ЛОГИКА!)
# ============================================================
async def check_duel_results(duel_id: int, get_stats_func) -> dict:
    """
    Проверить результаты дуэли через Lesta API.
    Сравнивает снимки ДО и ПОСЛЕ, считает дельту.
    """
    with get_db() as conn:
        duel = conn.execute(
            "SELECT * FROM arena_duels WHERE id = ? AND status = 'accepted'",
            (duel_id,)
        ).fetchone()

        if not duel:
            return {"success": False, "error": "Дуэль не найдена или не активна"}

        if not duel["challenger_stats_before"] or not duel["opponent_stats_before"]:
            return {"success": False, "error": "Нет начальных снимков статистики"}

        before_ch = json.loads(duel["challenger_stats_before"])
        before_op = json.loads(duel["opponent_stats_before"])

        metric_field = METRIC_FIELDS.get(duel["metric"], "damage_dealt")

        # Получаем текущую статистику
        ch_stats_now = await get_stats_func(duel["challenger_account_id"])
        op_stats_now = await get_stats_func(duel["opponent_account_id"])

        if not ch_stats_now or not op_stats_now:
            return {"success": False, "error": "Не удалось получить текущую статистику из API"}

        ch_all = ch_stats_now.get("statistics", {}).get("all", {})
        op_all = op_stats_now.get("statistics", {}).get("all", {})

        # Считаем сколько боёв сыграно
        ch_battles_played = ch_all.get("battles", 0) - before_ch.get("battles", 0)
        op_battles_played = op_all.get("battles", 0) - before_op.get("battles", 0)

        required = duel["battles_count"]

        if ch_battles_played < required or op_battles_played < required:
            return {
                "success": False,
                "error": "Ещё не все бои сыграны!",
                "challenger_played": ch_battles_played,
                "opponent_played": op_battles_played,
                "required": required,
            }

        # Считаем дельту метрики
        ch_delta = ch_all.get(metric_field, 0) - before_ch.get(metric_field, 0)
        op_delta = op_all.get(metric_field, 0) - before_op.get(metric_field, 0)

        # Сохраняем снимки ПОСЛЕ
        after_ch = json.dumps({
            "battles": ch_all.get("battles", 0),
            metric_field: ch_all.get(metric_field, 0),
        })
        after_op = json.dumps({
            "battles": op_all.get("battles", 0),
            metric_field: op_all.get(metric_field, 0),
        })

        # Определяем победителя
        if ch_delta > op_delta:
            winner_id = duel["challenger_telegram_id"]
            winner_nick = duel["challenger_nickname"]
            loser_id = duel["opponent_telegram_id"]
        elif op_delta > ch_delta:
            winner_id = duel["opponent_telegram_id"]
            winner_nick = duel["opponent_nickname"]
            loser_id = duel["challenger_telegram_id"]
        else:
            winner_id = None
            winner_nick = "Ничья"
            loser_id = None

        conn.execute("""
            UPDATE arena_duels 
            SET status = 'completed', winner_telegram_id = ?,
                challenger_result = ?, opponent_result = ?,
                challenger_stats_after = ?, opponent_stats_after = ?,
                completed_at = ?
            WHERE id = ?
        """, (winner_id, ch_delta, op_delta, after_ch, after_op, datetime.now(), duel_id))

    metric_label = METRIC_LABELS.get(duel["metric"], duel["metric"])
    wager = duel["wager"]

    return {
        "success": True,
        "duel_id": duel_id,
        "winner": winner_nick,
        "winner_telegram_id": winner_id,
        "loser_telegram_id": loser_id,
        "challenger_nick": duel["challenger_nickname"],
        "opponent_nick": duel["opponent_nickname"],
        "challenger_delta": ch_delta,
        "opponent_delta": op_delta,
        "metric": metric_label,
        "wager": wager,
        "prize": wager * 2,
    }


# ============================================================
# ПОЛУЧЕНИЕ ДАННЫХ
# ============================================================
def get_pending_for_player(telegram_id: int) -> list:
    """Входящие вызовы"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT d.* FROM arena_duels d
            LEFT JOIN users u ON u.telegram_id = ?
            WHERE d.status = 'pending' 
            AND (d.opponent_telegram_id = ? 
                 OR (d.opponent_nickname = u.wot_nickname AND d.opponent_telegram_id IS NULL))
            ORDER BY d.created_at DESC
        """, (telegram_id, telegram_id)).fetchall()
        return [dict(r) for r in rows]


def get_active_duels(telegram_id: int) -> list:
    """Активные дуэли"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM arena_duels 
            WHERE status IN ('pending', 'accepted')
            AND (challenger_telegram_id = ? OR opponent_telegram_id = ?)
            ORDER BY created_at DESC
        """, (telegram_id, telegram_id)).fetchall()
        return [dict(r) for r in rows]


def get_history(telegram_id: int, limit: int = 20) -> list:
    """История"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT * FROM arena_duels 
            WHERE status IN ('completed', 'declined')
            AND (challenger_telegram_id = ? OR opponent_telegram_id = ?)
            ORDER BY completed_at DESC LIMIT ?
        """, (telegram_id, telegram_id, limit)).fetchall()
        return [dict(r) for r in rows]


def expire_old_duels():
    """Устарить неотвеченные дуэли"""
    with get_db() as conn:
        conn.execute(
            "UPDATE arena_duels SET status = 'expired' "
            "WHERE status = 'pending' AND expires_at < ?",
            (datetime.now(),)
        )
