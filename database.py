"""
Модуль базы данных — SQLite для экосистемы «Мир Танков»

Таблицы:
- users: пользователи бота (telegram_id, nickname, coins, xp, level)
- subscriptions: платные подписки (user_id, plan, expires_at, active)
- challenges: челленджи (название, описание, условия, призы)
- challenge_participants: участники челленджей
- events: ивенты "1 против 15"
- event_registrations: регистрации на ивенты
"""

import sqlite3
import os
import logging
from datetime import datetime, timedelta
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), "ecosystem.db")


@contextmanager
def get_db():
    """Контекстный менеджер для подключения к БД"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db():
    """Инициализация всех таблиц"""
    with get_db() as conn:
        conn.executescript("""
            -- Пользователи
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                username TEXT,
                first_name TEXT,
                wot_nickname TEXT,
                wot_account_id INTEGER,
                coins INTEGER DEFAULT 0,
                xp INTEGER DEFAULT 0,
                level INTEGER DEFAULT 1,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Подписки
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                plan TEXT NOT NULL DEFAULT 'basic',
                price INTEGER NOT NULL DEFAULT 149,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP NOT NULL,
                is_active INTEGER DEFAULT 1,
                payment_method TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            -- Челленджи
            CREATE TABLE IF NOT EXISTS challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                icon TEXT DEFAULT '🎯',
                challenge_type TEXT NOT NULL DEFAULT 'damage',
                target_value INTEGER NOT NULL DEFAULT 5000,
                reward_coins INTEGER DEFAULT 100,
                reward_xp INTEGER DEFAULT 50,
                tank_tier INTEGER,
                tank_name TEXT,
                starts_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ends_at TIMESTAMP NOT NULL,
                is_active INTEGER DEFAULT 1,
                subscribers_only INTEGER DEFAULT 1,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Участники челленджей
            CREATE TABLE IF NOT EXISTS challenge_participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challenge_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                current_value INTEGER DEFAULT 0,
                is_completed INTEGER DEFAULT 0,
                proof_screenshot TEXT,
                submitted_at TIMESTAMP,
                verified INTEGER DEFAULT 0,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (challenge_id) REFERENCES challenges(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(challenge_id, user_id)
            );

            -- Ивенты (1 против 15)
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                event_type TEXT DEFAULT 'boss_fight',
                max_participants INTEGER DEFAULT 15,
                boss_nickname TEXT,
                boss_tank TEXT,
                participant_tier INTEGER DEFAULT 8,
                map_name TEXT,
                reward_description TEXT,
                scheduled_at TIMESTAMP,
                is_active INTEGER DEFAULT 1,
                subscribers_only INTEGER DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            -- Регистрации на ивенты
            CREATE TABLE IF NOT EXISTS event_registrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                wot_nickname TEXT NOT NULL,
                status TEXT DEFAULT 'registered',
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (event_id) REFERENCES events(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(event_id, user_id)
            );

            -- Транзакции (история платежей)
            CREATE TABLE IF NOT EXISTS transactions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                currency TEXT DEFAULT 'RUB',
                type TEXT NOT NULL,
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            -- Индексы
            CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_id);
            CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id);
            CREATE INDEX IF NOT EXISTS idx_subs_active ON subscriptions(is_active);
            CREATE INDEX IF NOT EXISTS idx_challenges_active ON challenges(is_active);
            CREATE INDEX IF NOT EXISTS idx_cp_challenge ON challenge_participants(challenge_id);
            CREATE INDEX IF NOT EXISTS idx_events_active ON events(is_active);
        """)
        logger.info("База данных инициализирована")


# ============================================================
# ПОЛЬЗОВАТЕЛИ
# ============================================================

def get_or_create_user(telegram_id: int, username: str = None, first_name: str = None) -> dict:
    """Получить или создать пользователя"""
    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()

        if user:
            # Обновляем last_active
            conn.execute(
                "UPDATE users SET last_active = ?, username = COALESCE(?, username), "
                "first_name = COALESCE(?, first_name) WHERE telegram_id = ?",
                (datetime.now(), username, first_name, telegram_id)
            )
            return dict(user)
        else:
            conn.execute(
                "INSERT INTO users (telegram_id, username, first_name) VALUES (?, ?, ?)",
                (telegram_id, username, first_name)
            )
            user = conn.execute(
                "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
            ).fetchone()
            return dict(user)


def get_user_by_telegram_id(telegram_id: int) -> dict | None:
    """Получить пользователя по Telegram ID"""
    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        return dict(user) if user else None


def update_user_wot(telegram_id: int, nickname: str, account_id: int):
    """Привязать ник WoT к пользователю"""
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET wot_nickname = ?, wot_account_id = ? WHERE telegram_id = ?",
            (nickname, account_id, telegram_id)
        )


def add_coins(telegram_id: int, amount: int, description: str = ""):
    """Добавить монеты пользователю"""
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET coins = coins + ? WHERE telegram_id = ?",
            (amount, telegram_id)
        )
        user = conn.execute(
            "SELECT id FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if user:
            conn.execute(
                "INSERT INTO transactions (user_id, amount, type, description) "
                "VALUES (?, ?, 'coins', ?)",
                (user["id"], amount, description)
            )


def add_xp(telegram_id: int, amount: int):
    """Добавить XP пользователю"""
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET xp = xp + ? WHERE telegram_id = ?",
            (amount, telegram_id)
        )
        # Проверяем повышение уровня (каждые 500 XP)
        user = conn.execute(
            "SELECT xp, level FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        if user:
            new_level = (user["xp"] // 500) + 1
            if new_level > user["level"]:
                conn.execute(
                    "UPDATE users SET level = ? WHERE telegram_id = ?",
                    (new_level, telegram_id)
                )
                return new_level  # Вернём новый уровень для уведомления
    return None


def get_total_users() -> int:
    """Кол-во пользователей"""
    with get_db() as conn:
        result = conn.execute("SELECT COUNT(*) FROM users").fetchone()
        return result[0]


# ============================================================
# ПОДПИСКИ
# ============================================================

SUBSCRIPTION_PLANS = {
    "1month": {
        "name": "📦 Подписка — 1 месяц",
        "price": 490,
        "stars_price": 250,
        "days": 30,
        "discount": 0,
        "bonus_coins": 200,
    },
    "3months": {
        "name": "📦 Подписка — 3 месяца",
        "price": 1323,
        "stars_price": 675,
        "days": 90,
        "discount": 10,
        "bonus_coins": 700,
    },
    "6months": {
        "name": "📦 Подписка — 6 месяцев",
        "price": 2499,
        "stars_price": 1275,
        "days": 180,
        "discount": 15,
        "bonus_coins": 1500,
    },
    "12months": {
        "name": "📦 Подписка — Год",
        "price": 4410,
        "stars_price": 2250,
        "days": 365,
        "discount": 25,
        "bonus_coins": 3500,
    },
}


def create_subscription(telegram_id: int, plan: str = "1month", payment_method: str = None) -> dict:
    """Создать подписку"""
    plan_info = SUBSCRIPTION_PLANS.get(plan, SUBSCRIPTION_PLANS["1month"])
    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return {"success": False, "error": "Пользователь не найден"}

    expires_at = datetime.now() + timedelta(days=plan_info["days"])

    with get_db() as conn:
        # Деактивируем старые подписки
        conn.execute(
            "UPDATE subscriptions SET is_active = 0 WHERE user_id = ?",
            (user["id"],)
        )
        # Создаём новую
        conn.execute(
            "INSERT INTO subscriptions (user_id, plan, price, expires_at, payment_method) "
            "VALUES (?, ?, ?, ?, ?)",
            (user["id"], plan, plan_info["price"], expires_at, payment_method)
        )
        # Записываем транзакцию
        conn.execute(
            "INSERT INTO transactions (user_id, amount, type, description) "
            "VALUES (?, ?, 'subscription', ?)",
            (user["id"], plan_info["price"], f"Подписка: {plan_info['name']}")
        )

    return {
        "success": True,
        "plan": plan_info["name"],
        "price": plan_info["price"],
        "expires_at": expires_at.strftime("%d.%m.%Y"),
    }


def check_subscription(telegram_id: int) -> dict | None:
    """Проверить активную подписку"""
    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return None

    with get_db() as conn:
        sub = conn.execute(
            "SELECT * FROM subscriptions WHERE user_id = ? AND is_active = 1 "
            "AND expires_at > ? ORDER BY expires_at DESC LIMIT 1",
            (user["id"], datetime.now())
        ).fetchone()

        if sub:
            plan_info = SUBSCRIPTION_PLANS.get(sub["plan"], {})
            expires = datetime.fromisoformat(sub["expires_at"])
            days_left = (expires - datetime.now()).days
            return {
                "active": True,
                "plan": sub["plan"],
                "plan_name": plan_info.get("name", sub["plan"]),
                "expires_at": expires.strftime("%d.%m.%Y"),
                "days_left": max(0, days_left),
            }
    return {"active": False}


def deactivate_expired_subscriptions() -> int:
    """Деактивировать истёкшие подписки (запускать по расписанию)"""
    with get_db() as conn:
        cursor = conn.execute(
            "UPDATE subscriptions SET is_active = 0 "
            "WHERE is_active = 1 AND expires_at <= ?",
            (datetime.now(),)
        )
        count = cursor.rowcount
        if count > 0:
            logger.info(f"Деактивировано {count} истёкших подписок")
        return count


def get_active_subscribers() -> list:
    """Получить список активных подписчиков"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT u.telegram_id, u.username, u.first_name, s.plan, s.expires_at "
            "FROM subscriptions s JOIN users u ON s.user_id = u.id "
            "WHERE s.is_active = 1 AND s.expires_at > ? "
            "ORDER BY s.expires_at",
            (datetime.now(),)
        ).fetchall()
        return [dict(r) for r in rows]


def get_subscription_stats() -> dict:
    """Статистика подписок для админки"""
    with get_db() as conn:
        total = conn.execute(
            "SELECT COUNT(*) FROM subscriptions WHERE is_active = 1 AND expires_at > ?",
            (datetime.now(),)
        ).fetchone()[0]

        revenue = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE type = 'subscription'"
        ).fetchone()[0]

        by_plan = conn.execute(
            "SELECT plan, COUNT(*) as cnt FROM subscriptions "
            "WHERE is_active = 1 AND expires_at > ? GROUP BY plan",
            (datetime.now(),)
        ).fetchall()

        return {
            "total_active": total,
            "total_revenue": revenue,
            "by_plan": {r["plan"]: r["cnt"] for r in by_plan},
        }


# ============================================================
# ИНИЦИАЛИЗАЦИЯ ПРИ ИМПОРТЕ
# ============================================================
init_db()
