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

# Используем постоянное хранилище Railway Volume если доступно
# В Railway Dashboard нужно добавить Volume с путём /data
_volume_path = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "")
if _volume_path and os.path.isdir(_volume_path):
    DB_PATH = os.path.join(_volume_path, "ecosystem.db")
else:
    DB_PATH = os.path.join(os.path.dirname(__file__), "ecosystem.db")

logger.info(f"Database path: {DB_PATH}")


@contextmanager
def get_db(write=True):
    """
    Контекстный менеджер для подключения к БД.
    write=True (по умолчанию) — включает автоматический commit/rollback.
    write=False — только чтение, без commit.
    """
    conn = sqlite3.connect(DB_PATH, timeout=20, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    
    # Режим WAL для параллельной работы чтения и записи
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")  # Ускоряет запись, безопасно для WAL
    conn.execute("PRAGMA busy_timeout=20000")  # Ждать разблокировки до 20 секунд
    
    try:
        yield conn
        if write:
            conn.commit()
    except Exception as e:
        if write:
            conn.rollback()
        logger.error(f"Database error: {e}")
        raise
    finally:
        conn.close()

@contextmanager
def get_db_read():
    """Специальный менеджер только для чтения — максимально быстрый и без блокировок"""
    with get_db(write=False) as conn:
        yield conn


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
                wot_verified INTEGER DEFAULT 0,
                verify_battles_snapshot INTEGER,
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

        # Таблица промокодов (создаём отдельно для совместимости)
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS promo_codes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE NOT NULL,
                plan TEXT DEFAULT '1month',
                days INTEGER DEFAULT 30,
                uses_left INTEGER DEFAULT 1,
                uses_total INTEGER DEFAULT 1,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS promo_activations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                promo_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (promo_id) REFERENCES promo_codes(id),
                FOREIGN KEY (user_id) REFERENCES users(id),
                UNIQUE(promo_id, user_id)
            );

            CREATE INDEX IF NOT EXISTS idx_promo_code ON promo_codes(code);
        """)

        # Уникальность ника WoT (один ник — один Telegram)
        try:
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_wot_nick ON users(wot_nickname) WHERE wot_nickname IS NOT NULL")
        except Exception:
            pass

        # Миграция: добавить новые колонки если их нет
        for col, default in [("wot_verified", "0"), ("verify_battles_snapshot", "NULL"), ("avatar", "NULL")]:
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {col} {'TEXT' if col == 'avatar' else 'INTEGER'} DEFAULT {default}")
            except Exception:
                pass  # Колонка уже существует

        # ===== ДРУЗЬЯ =====
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS friends (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_telegram_id INTEGER NOT NULL,
                friend_telegram_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_telegram_id, friend_telegram_id)
            );

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender_telegram_id INTEGER NOT NULL,
                receiver_telegram_id INTEGER NOT NULL,
                text TEXT NOT NULL,
                is_read INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS arena_duels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challenger_telegram_id INTEGER NOT NULL,
                challenger_nickname TEXT NOT NULL,
                challenger_account_id INTEGER,
                opponent_telegram_id INTEGER,
                opponent_nickname TEXT NOT NULL,
                opponent_account_id INTEGER,
                challenge_type TEXT NOT NULL DEFAULT 'spotted',
                tank_class TEXT DEFAULT 'light',
                tank_tier INTEGER DEFAULT 10,
                metric TEXT NOT NULL DEFAULT 'spotted',
                battles_count INTEGER DEFAULT 10,
                wager INTEGER DEFAULT 100,
                status TEXT DEFAULT 'pending',
                challenger_stats_before TEXT,
                challenger_stats_after TEXT,
                opponent_stats_before TEXT,
                opponent_stats_after TEXT,
                winner_telegram_id INTEGER,
                challenger_result INTEGER DEFAULT 0,
                opponent_result INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at TIMESTAMP,
                completed_at TIMESTAMP,
                expires_at TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_friends_user ON friends(user_telegram_id);
            CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend_telegram_id);
            CREATE INDEX IF NOT EXISTS idx_messages_receiver ON messages(receiver_telegram_id);
            CREATE INDEX IF NOT EXISTS idx_duels_challenger ON arena_duels(challenger_telegram_id);
            CREATE INDEX IF NOT EXISTS idx_duels_opponent ON arena_duels(opponent_telegram_id);
            CREATE INDEX IF NOT EXISTS idx_duels_status ON arena_duels(status);
        """)

        # ===== ПОКУПКИ ВАЛЮТЫ СЫР =====
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS cheese_purchases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                amount INTEGER NOT NULL,
                rub_amount INTEGER NOT NULL,
                payment_id TEXT,
                payment_method TEXT DEFAULT 'stars',
                status TEXT DEFAULT 'completed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );

            CREATE INDEX IF NOT EXISTS idx_cheese_user ON cheese_purchases(telegram_id);
            CREATE INDEX IF NOT EXISTS idx_cheese_status ON cheese_purchases(status);
        """)

        # ===== АРЕНА — ЧЕЛЛЕНДЖИ =====
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS arena_challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                from_telegram_id INTEGER NOT NULL,
                to_telegram_id INTEGER NOT NULL,
                tank_id INTEGER,
                tank_tier INTEGER,
                tank_type TEXT,
                tank_name TEXT,
                condition TEXT DEFAULT 'damage',
                battles INTEGER DEFAULT 5,
                wager INTEGER DEFAULT 100,
                status TEXT DEFAULT 'pending',
                from_start_stats TEXT,
                to_start_stats TEXT,
                from_end_stats TEXT,
                to_end_stats TEXT,
                from_last_stats TEXT,
                to_last_stats TEXT,
                battle_history TEXT DEFAULT '[]',
                winner_telegram_id INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accepted_at TIMESTAMP,
                finished_at TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_arena_from ON arena_challenges(from_telegram_id);
            CREATE INDEX IF NOT EXISTS idx_arena_to ON arena_challenges(to_telegram_id);
            CREATE INDEX IF NOT EXISTS idx_arena_status ON arena_challenges(status);
        """)

        # Таблица администраторов
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS admin_users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                granted_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # ===== ОБЩИЕ ЧЕЛЛЕНДЖИ (GLOBAL) =====
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS global_challenges (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                icon TEXT DEFAULT '🔥',
                condition TEXT DEFAULT 'damage',
                duration_minutes INTEGER DEFAULT 60,
                max_battles INTEGER DEFAULT 0,
                reward_coins INTEGER DEFAULT 500,
                reward_description TEXT,
                status TEXT DEFAULT 'active',
                subscribers_only INTEGER DEFAULT 1,
                created_by INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ends_at TIMESTAMP NOT NULL,
                finished_at TIMESTAMP,
                winner_telegram_id INTEGER,
                winner_nickname TEXT,
                winner_value INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS global_challenge_participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challenge_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                nickname TEXT,
                current_value INTEGER DEFAULT 0,
                baseline_value INTEGER DEFAULT 0,
                baseline_battles INTEGER DEFAULT 0,
                battles_played INTEGER DEFAULT 0,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_updated TIMESTAMP,
                FOREIGN KEY (challenge_id) REFERENCES global_challenges(id),
                UNIQUE(challenge_id, telegram_id)
            );

            -- Базовая стата по танкам (снимок при вступлении)
            CREATE TABLE IF NOT EXISTS gc_tank_baselines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challenge_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                tank_id INTEGER NOT NULL,
                tank_name TEXT,
                tank_tier INTEGER,
                tank_type TEXT,
                baseline_battles INTEGER DEFAULT 0,
                baseline_damage INTEGER DEFAULT 0,
                UNIQUE(challenge_id, telegram_id, tank_id)
            );

            -- Лог обнаруженных боёв
            CREATE TABLE IF NOT EXISTS gc_battle_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challenge_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                battle_num INTEGER DEFAULT 1,
                tank_id INTEGER,
                tank_name TEXT,
                tank_tier INTEGER,
                tank_type TEXT,
                damage INTEGER DEFAULT 0,
                detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_gc_status ON global_challenges(status);
            CREATE INDEX IF NOT EXISTS idx_gcp_challenge ON global_challenge_participants(challenge_id);
            CREATE INDEX IF NOT EXISTS idx_gcp_tg ON global_challenge_participants(telegram_id);
            CREATE INDEX IF NOT EXISTS idx_gc_bl_challenge ON gc_battle_log(challenge_id, telegram_id);
        """)

        # Миграции для расширенной статистики в Челленджах
        for col, default in [
            ("baseline_frags", "INTEGER DEFAULT 0"),
            ("baseline_xp", "INTEGER DEFAULT 0"),
            ("baseline_spotting", "INTEGER DEFAULT 0"),
            ("baseline_blocked", "INTEGER DEFAULT 0"),
            ("baseline_wins", "INTEGER DEFAULT 0"),
            ("baseline_spotting_damage", "INTEGER DEFAULT 0"),
        ]:
            try:
                conn.execute(f"ALTER TABLE gc_tank_baselines ADD COLUMN {col} {default}")
            except Exception: pass

        for col, default in [
            ("frags", "INTEGER DEFAULT 0"),
            ("xp", "INTEGER DEFAULT 0"),
            ("spotting", "INTEGER DEFAULT 0"),
            ("blocked", "INTEGER DEFAULT 0"),
            ("wins", "INTEGER DEFAULT 0"),
            ("spotting_damage", "INTEGER DEFAULT 0"),
        ]:
            try:
                conn.execute(f"ALTER TABLE gc_battle_log ADD COLUMN {col} {default}")
            except Exception: pass

        # Миграции для участников
        for col, default in [
            ("baseline_value", "INTEGER DEFAULT 0"),
            ("baseline_battles", "INTEGER DEFAULT 0"),
            ("baseline_values", "TEXT"),  # JSON: per-condition baselines
            ("condition_values", "TEXT"),  # JSON: per-condition current values
        ]:
            try:
                conn.execute(f"ALTER TABLE global_challenge_participants ADD COLUMN {col} {default}")
            except Exception:
                pass
        try:
            conn.execute("ALTER TABLE global_challenges ADD COLUMN max_battles INTEGER DEFAULT 0")
        except Exception:
            pass

        # Миграции для фильтров техники в челленджах
        for col, default in [
            ("tank_class", "TEXT"),           # heavyTank, mediumTank, lightTank, AT-SPG, SPG
            ("tank_tier_filter", "INTEGER"),   # 1-10 (уровень техники)
            ("tank_id_filter", "INTEGER"),     # конкретный tank_id
            ("tank_name_filter", "TEXT"),      # название танка для отображения
            ("winner_condition_values", "TEXT"),  # JSON: per-condition values для победителя
        ]:
            try:
                conn.execute(f"ALTER TABLE global_challenges ADD COLUMN {col} {default}")
            except Exception:
                pass

        # ===== Призовой челлендж: колесо фортуны =====
        for col, default in [
            ("prize_mode", "INTEGER DEFAULT 0"),           # включён ли призовой режим
            ("prize_description", "TEXT"),                  # "iPhone 16 Pro"
            ("prize_image_url", "TEXT"),                    # URL картинки приза
            ("prize_cta", "TEXT"),                          # CTA текст для виджета
            ("prize_top_count", "INTEGER DEFAULT 10"),      # ТОП-N с бонусом
            ("challenge_duration_minutes", "INTEGER DEFAULT 0"),  # доп. таймер активной фазы
            ("enrollment_ends_at", "TIMESTAMP"),            # когда заканчивается набор
            ("wheel_winner_telegram_id", "INTEGER"),        # кто выиграл колесо
            ("wheel_winner_nickname", "TEXT"),              # ник победителя колеса
            ("wheel_spun", "INTEGER DEFAULT 0"),            # колесо уже крутили?
        ]:
            try:
                conn.execute(f"ALTER TABLE global_challenges ADD COLUMN {col} {default}")
            except Exception:
                pass

        # Таблица элиминированных на колесе
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS gc_wheel_eliminations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                challenge_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                nickname TEXT,
                eliminated_order INTEGER NOT NULL,
                eliminated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (challenge_id) REFERENCES global_challenges(id),
                UNIQUE(challenge_id, telegram_id)
            );
            CREATE INDEX IF NOT EXISTS idx_gc_wheel_elim ON gc_wheel_eliminations(challenge_id);
        """)

        # ===== СТРИМ МЕДИА (звуки/видео для донат-алертов) =====
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS stream_media (
                key TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # ===== ЕЖЕДНЕВНЫЕ НАГРАДЫ (СТРИК) =====
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS daily_rewards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id INTEGER UNIQUE NOT NULL,
                current_streak INTEGER DEFAULT 0,
                last_claim_date TEXT,
                total_claimed INTEGER DEFAULT 0,
                max_streak INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_daily_tg ON daily_rewards(telegram_id);
        """)

        # Add is_blocked to users if not exists
        try:
            conn.execute("SELECT is_blocked FROM users LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute("ALTER TABLE users ADD COLUMN is_blocked BOOLEAN DEFAULT 0")

        # Create blocked_users table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS blocked_users (
                telegram_id BIGINT PRIMARY KEY,
                reason TEXT,
                blocked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                blocked_by BIGINT
            );
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


def get_user_by_wot_account_id(account_id: int) -> dict | None:
    """Получить пользователя по WoT account_id (Lesta ID)"""
    with get_db() as conn:
        user = conn.execute(
            "SELECT * FROM users WHERE wot_account_id = ?", (account_id,)
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
# ПРОМОКОДЫ
# ============================================================

def create_promo_code(code: str, days: int = 30, uses: int = 1, created_by: int = None) -> dict:
    """Создать промокод"""
    with get_db() as conn:
        try:
            conn.execute(
                "INSERT INTO promo_codes (code, days, uses_left, uses_total, created_by) VALUES (?, ?, ?, ?, ?)",
                (code.upper(), days, uses, uses, created_by)
            )
            return {"success": True, "code": code.upper(), "days": days, "uses": uses}
        except sqlite3.IntegrityError:
            return {"success": False, "error": "Такой промокод уже существует"}


def activate_promo_code(telegram_id: int, code: str) -> dict:
    """Активировать промокод"""
    with get_db() as conn:
        # Найти промокод
        promo = conn.execute(
            "SELECT * FROM promo_codes WHERE code = ? AND uses_left > 0",
            (code.upper(),)
        ).fetchone()

        if not promo:
            return {"success": False, "error": "Промокод не найден или исчерпан"}

        # Получить пользователя
        user = conn.execute(
            "SELECT id FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()

        if not user:
            return {"success": False, "error": "Пользователь не найден"}

        # Проверить, не активировал ли уже
        already = conn.execute(
            "SELECT id FROM promo_activations WHERE promo_id = ? AND user_id = ?",
            (promo["id"], user["id"])
        ).fetchone()

        if already:
            return {"success": False, "error": "Вы уже использовали этот промокод"}

        # Активировать подписку
        days = promo["days"]
        expires_at = datetime.now() + timedelta(days=days)

        conn.execute(
            "INSERT INTO subscriptions (user_id, plan, price, expires_at, is_active, payment_method) "
            "VALUES (?, 'promo', 0, ?, 1, 'promo_code')",
            (user["id"], expires_at)
        )

        # Записать активацию
        conn.execute(
            "INSERT INTO promo_activations (promo_id, user_id) VALUES (?, ?)",
            (promo["id"], user["id"])
        )

        # Уменьшить кол-во использований
        conn.execute(
            "UPDATE promo_codes SET uses_left = uses_left - 1 WHERE id = ?",
            (promo["id"],)
        )

        return {
            "success": True,
            "days": days,
            "expires_at": expires_at.strftime("%d.%m.%Y"),
        }


def get_promo_codes() -> list:
    """Получить все промокоды"""
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM promo_codes ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


# ============================================================
# ПРИВЯЗКА НИКА WOT
# ============================================================

def bind_wot_nickname(telegram_id: int, nickname: str, account_id: int = None) -> dict:
    """Привязать ник WoT к аккаунту. Один ник — один пользователь."""
    with get_db() as conn:
        # Проверить, не занят ли ник другим пользователем
        existing = conn.execute(
            "SELECT telegram_id FROM users WHERE wot_nickname = ? AND telegram_id != ?",
            (nickname, telegram_id)
        ).fetchone()

        if existing:
            return {"success": False, "error": "Этот ник уже привязан к другому аккаунту!"}

        # Привязать
        conn.execute(
            "UPDATE users SET wot_nickname = ?, wot_account_id = ? WHERE telegram_id = ?",
            (nickname, account_id, telegram_id)
        )

        return {"success": True, "nickname": nickname}


def get_wot_nickname(telegram_id: int) -> str:
    """Получить привязанный ник WoT"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT wot_nickname FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        return row["wot_nickname"] if row and row["wot_nickname"] else None


def start_verification(telegram_id: int, battles_count: int):
    """Начать верификацию: сохранить текущее кол-во боёв"""
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET verify_battles_snapshot = ? WHERE telegram_id = ?",
            (battles_count, telegram_id)
        )


def confirm_verification(telegram_id: int):
    """Подтвердить верификацию"""
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET wot_verified = 1, verify_battles_snapshot = NULL WHERE telegram_id = ?",
            (telegram_id,)
        )


def get_verify_snapshot(telegram_id: int) -> int:
    """Получить сохранённое кол-во боёв для верификации"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT verify_battles_snapshot FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        return row["verify_battles_snapshot"] if row else None


def is_verified(telegram_id: int) -> bool:
    """Проверить верифицирован ли аккаунт"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT wot_verified FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        return bool(row and row["wot_verified"])


# ============================================================
# АВАТАРКИ
# ============================================================

def set_avatar(telegram_id: int, avatar: str) -> bool:
    """Установить аватарку (эмодзи или base64 миниатюра)"""
    with get_db() as conn:
        conn.execute(
            "UPDATE users SET avatar = ? WHERE telegram_id = ?",
            (avatar, telegram_id)
        )
    return True


def get_avatar(telegram_id: int) -> str:
    """Получить аватарку пользователя"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT avatar FROM users WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchone()
        return row["avatar"] if row and row["avatar"] else "🪖"




# ============================================================
# ПОКУПКА / ТРАТА ВАЛЮТЫ СЫР (🧀)
# ============================================================

def buy_cheese(telegram_id: int, amount: int, payment_id: str = None, method: str = "stars") -> dict:
    """Купить сыр за реальные деньги. 1 ₽ = 1 🧀"""
    if amount <= 0:
        return {"success": False, "error": "Неверная сумма"}

    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return {"success": False, "error": "Пользователь не найден"}

    with get_db() as conn:
        # Зачисляем сыр (coins = cheese)
        conn.execute(
            "UPDATE users SET coins = coins + ? WHERE telegram_id = ?",
            (amount, telegram_id)
        )

        # Записываем покупку
        conn.execute(
            "INSERT INTO cheese_purchases (user_id, telegram_id, amount, rub_amount, payment_id, payment_method) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (user["id"], telegram_id, amount, amount, payment_id, method)
        )

        # Записываем транзакцию
        conn.execute(
            "INSERT INTO transactions (user_id, amount, currency, type, description) "
            "VALUES (?, ?, 'CHEESE', 'purchase', ?)",
            (user["id"], amount, f"Покупка {amount} 🧀 ({method})")
        )

    new_balance = get_cheese_balance(telegram_id)
    logger.info(f"Пользователь {telegram_id} купил {amount} 🧀 ({method}). Баланс: {new_balance}")

    return {
        "success": True,
        "amount": amount,
        "balance": new_balance,
    }


def spend_cheese(telegram_id: int, amount: int, description: str = "") -> dict:
    """Потратить сыр (с проверкой баланса)"""
    if amount <= 0:
        return {"success": False, "error": "Неверная сумма"}

    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return {"success": False, "error": "Пользователь не найден"}

    balance = user["coins"]
    if balance < amount:
        return {
            "success": False,
            "error": f"Недостаточно 🧀! Баланс: {balance}, нужно: {amount}",
            "balance": balance,
            "needed": amount,
        }

    with get_db() as conn:
        conn.execute(
            "UPDATE users SET coins = coins - ? WHERE telegram_id = ?",
            (amount, telegram_id)
        )

        conn.execute(
            "INSERT INTO transactions (user_id, amount, currency, type, description) "
            "VALUES (?, ?, 'CHEESE', 'spend', ?)",
            (user["id"], -amount, description)
        )

    new_balance = get_cheese_balance(telegram_id)
    return {
        "success": True,
        "spent": amount,
        "balance": new_balance,
    }


def get_cheese_balance(telegram_id: int) -> int:
    """Получить баланс сыра"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT coins FROM users WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()
        return row["coins"] if row else 0


def get_cheese_history(telegram_id: int, limit: int = 20) -> list:
    """История покупок сыра"""
    user = get_user_by_telegram_id(telegram_id)
    if not user:
        return []

    with get_db() as conn:
        rows = conn.execute("""
            SELECT amount, rub_amount, payment_method, status, created_at
            FROM cheese_purchases
            WHERE telegram_id = ?
            ORDER BY created_at DESC
            LIMIT ?
        """, (telegram_id, limit)).fetchall()
        return [dict(r) for r in rows]


def get_cheese_stats() -> dict:
    """Статистика продаж сыра для админки"""
    with get_db() as conn:
        total_purchases = conn.execute(
            "SELECT COUNT(*) FROM cheese_purchases WHERE status = 'completed'"
        ).fetchone()[0]

        total_cheese = conn.execute(
            "SELECT COALESCE(SUM(amount), 0) FROM cheese_purchases WHERE status = 'completed'"
        ).fetchone()[0]

        total_rub = conn.execute(
            "SELECT COALESCE(SUM(rub_amount), 0) FROM cheese_purchases WHERE status = 'completed'"
        ).fetchone()[0]

        return {
            "total_purchases": total_purchases,
            "total_cheese_sold": total_cheese,
            "total_revenue_rub": total_rub,
        }


# ============================================================
# ДРУЗЬЯ
# ============================================================

def send_friend_request(from_telegram_id: int, to_telegram_id: int) -> dict:
    """Отправить запрос в друзья"""
    if from_telegram_id == to_telegram_id:
        return {"success": False, "error": "Нельзя добавить себя"}

    with get_db() as conn:
        # Проверяем: не друзья ли уже?
        existing = conn.execute(
            "SELECT status FROM friends WHERE user_telegram_id = ? AND friend_telegram_id = ?",
            (from_telegram_id, to_telegram_id)
        ).fetchone()

        if existing:
            if existing["status"] == "accepted":
                return {"success": False, "error": "Уже в друзьях"}
            else:
                return {"success": False, "error": "Запрос уже отправлен"}

        # Проверяем обратное направление (может они нам уже отправили)
        reverse = conn.execute(
            "SELECT status FROM friends WHERE user_telegram_id = ? AND friend_telegram_id = ?",
            (to_telegram_id, from_telegram_id)
        ).fetchone()

        if reverse and reverse["status"] == "pending":
            # Они уже отправили нам — автоматически принимаем обоих!
            conn.execute(
                "UPDATE friends SET status = 'accepted' WHERE user_telegram_id = ? AND friend_telegram_id = ?",
                (to_telegram_id, from_telegram_id)
            )
            conn.execute(
                "INSERT INTO friends (user_telegram_id, friend_telegram_id, status) VALUES (?, ?, 'accepted')",
                (from_telegram_id, to_telegram_id)
            )
            return {"success": True, "auto_accepted": True}

        # Создаём запрос
        conn.execute(
            "INSERT INTO friends (user_telegram_id, friend_telegram_id, status) VALUES (?, ?, 'pending')",
            (from_telegram_id, to_telegram_id)
        )
        return {"success": True, "auto_accepted": False}


def accept_friend_request(my_telegram_id: int, from_telegram_id: int) -> dict:
    """Принять запрос в друзья"""
    with get_db() as conn:
        # Проверяем что запрос существует
        req = conn.execute(
            "SELECT id FROM friends WHERE user_telegram_id = ? AND friend_telegram_id = ? AND status = 'pending'",
            (from_telegram_id, my_telegram_id)
        ).fetchone()

        if not req:
            return {"success": False, "error": "Запрос не найден"}

        # Принимаем: меняем статус + создаём обратную связь
        conn.execute(
            "UPDATE friends SET status = 'accepted' WHERE user_telegram_id = ? AND friend_telegram_id = ?",
            (from_telegram_id, my_telegram_id)
        )

        # Создаём обратную запись (если нет)
        try:
            conn.execute(
                "INSERT INTO friends (user_telegram_id, friend_telegram_id, status) VALUES (?, ?, 'accepted')",
                (my_telegram_id, from_telegram_id)
            )
        except Exception:
            conn.execute(
                "UPDATE friends SET status = 'accepted' WHERE user_telegram_id = ? AND friend_telegram_id = ?",
                (my_telegram_id, from_telegram_id)
            )

        return {"success": True}


def decline_friend_request(my_telegram_id: int, from_telegram_id: int) -> dict:
    """Отклонить запрос в друзья"""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM friends WHERE user_telegram_id = ? AND friend_telegram_id = ? AND status = 'pending'",
            (from_telegram_id, my_telegram_id)
        )
        return {"success": True}


def remove_friend(my_telegram_id: int, friend_telegram_id: int) -> dict:
    """Удалить из друзей"""
    with get_db() as conn:
        conn.execute(
            "DELETE FROM friends WHERE user_telegram_id = ? AND friend_telegram_id = ?",
            (my_telegram_id, friend_telegram_id)
        )
        conn.execute(
            "DELETE FROM friends WHERE user_telegram_id = ? AND friend_telegram_id = ?",
            (friend_telegram_id, my_telegram_id)
        )
        return {"success": True}


def get_friends(telegram_id: int) -> list:
    """Получить список друзей (accepted + pending отправленных)"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT f.friend_telegram_id as telegram_id, f.status, f.created_at,
                   u.username, u.first_name, u.wot_nickname, u.wot_account_id, u.avatar
            FROM friends f
            LEFT JOIN users u ON u.telegram_id = f.friend_telegram_id
            WHERE f.user_telegram_id = ?
            ORDER BY f.status ASC, f.created_at DESC
        """, (telegram_id,)).fetchall()
        return [dict(r) for r in rows]


def get_friend_requests(telegram_id: int) -> list:
    """Получить входящие запросы в друзья"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT f.user_telegram_id as telegram_id, f.created_at,
                   u.username, u.first_name, u.wot_nickname, u.wot_account_id, u.avatar
            FROM friends f
            LEFT JOIN users u ON u.telegram_id = f.user_telegram_id
            WHERE f.friend_telegram_id = ? AND f.status = 'pending'
            ORDER BY f.created_at DESC
        """, (telegram_id,)).fetchall()
        return [dict(r) for r in rows]


# ============================================================
# СООБЩЕНИЯ
# ============================================================

def send_message(from_telegram_id: int, to_telegram_id: int, text: str) -> dict:
    """Отправить сообщение"""
    if not text or len(text) > 4000:
        return {"success": False, "error": "Некорректное сообщение"}

    with get_db() as conn:
        cursor = conn.execute(
            "INSERT INTO messages (sender_telegram_id, receiver_telegram_id, text) VALUES (?, ?, ?)",
            (from_telegram_id, to_telegram_id, text)
        )
        return {"success": True, "message_id": cursor.lastrowid}


def get_messages(user1_telegram_id: int, user2_telegram_id: int, limit: int = 50) -> list:
    """Получить сообщения между двумя пользователями"""
    with get_db() as conn:
        rows = conn.execute("""
            SELECT id, sender_telegram_id, receiver_telegram_id, text, is_read, created_at
            FROM messages
            WHERE (sender_telegram_id = ? AND receiver_telegram_id = ?)
               OR (sender_telegram_id = ? AND receiver_telegram_id = ?)
            ORDER BY created_at DESC
            LIMIT ?
        """, (user1_telegram_id, user2_telegram_id,
              user2_telegram_id, user1_telegram_id, limit)).fetchall()

        # Помечаем как прочитанные
        conn.execute("""
            UPDATE messages SET is_read = 1
            WHERE sender_telegram_id = ? AND receiver_telegram_id = ? AND is_read = 0
        """, (user2_telegram_id, user1_telegram_id))

        return [dict(r) for r in reversed(rows)]


def get_unread_count(telegram_id: int) -> int:
    """Количество непрочитанных сообщений"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM messages WHERE receiver_telegram_id = ? AND is_read = 0",
            (telegram_id,)
        ).fetchone()
        return row[0] if row else 0


def get_user_by_wot_account_id(account_id: int):
    """Найти пользователя по WoT account_id"""
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM users WHERE wot_account_id = ?", (account_id,)
        ).fetchone()
        return dict(row) if row else None


# ============================================================
# ПОИСК ПОЛЬЗОВАТЕЛЕЙ В НАШЕЙ БАЗЕ
# ============================================================

def search_users(query: str, exclude_telegram_id: int = None, limit: int = 20) -> list:
    """Поиск зарегистрированных пользователей по нику, имени или username"""
    with get_db() as conn:
        search_pattern = f"%{query}%"
        rows = conn.execute("""
            SELECT telegram_id, username, first_name, wot_nickname, wot_account_id, avatar
            FROM users
            WHERE (wot_nickname LIKE ? OR first_name LIKE ? OR username LIKE ?)
              AND telegram_id != ?
            ORDER BY 
                CASE WHEN wot_nickname LIKE ? THEN 0 ELSE 1 END,
                last_active DESC
            LIMIT ?
        """, (search_pattern, search_pattern, search_pattern,
              exclude_telegram_id or 0, search_pattern, limit)).fetchall()
        return [dict(r) for r in rows]


# ============================================================
# ЕЖЕДНЕВНЫЕ НАГРАДЫ (СТРИК СИСТЕМЫ)
# ============================================================

DAILY_REWARD_TIERS = [
    (7, 15),    # Дни 1-7:   15 🧀
    (14, 25),   # Дни 8-14:  25 🧀
    (21, 35),   # Дни 15-21: 35 🧀
    (30, 50),   # Дни 22-30: 50 🧀
]

def _get_daily_amount(streak: int) -> int:
    """Сколько сыра за текущий день стрика"""
    for max_day, amount in DAILY_REWARD_TIERS:
        if streak <= max_day:
            return amount
    return 50  # 30+ дней — всё равно 50


def get_daily_status(telegram_id: int) -> dict:
    """Получить статус ежедневной награды"""
    today = datetime.now().strftime("%Y-%m-%d")
    with get_db_read() as conn:
        row = conn.execute(
            "SELECT * FROM daily_rewards WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()

    if not row:
        return {
            "can_claim": True,
            "current_streak": 0,
            "next_reward": 15,
            "last_claim": None,
            "total_claimed": 0,
            "max_streak": 0,
        }

    last_claim = row["last_claim_date"]
    streak = row["current_streak"]
    can_claim = last_claim != today

    # Проверяем: если пропустил день — стрик сбросится при клейме
    if last_claim:
        last_date = datetime.strptime(last_claim, "%Y-%m-%d").date()
        today_date = datetime.now().date()
        diff = (today_date - last_date).days
        if diff > 1:
            streak = 0  # Пропустил — показываем что стрик сброшен

    next_reward = _get_daily_amount(streak + 1)

    return {
        "can_claim": can_claim,
        "current_streak": streak,
        "next_reward": next_reward,
        "last_claim": last_claim,
        "total_claimed": row["total_claimed"],
        "max_streak": row["max_streak"],
    }


def claim_daily_reward(telegram_id: int) -> dict:
    """Забрать ежедневную награду. Возвращает результат."""
    today = datetime.now().strftime("%Y-%m-%d")

    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM daily_rewards WHERE telegram_id = ?", (telegram_id,)
        ).fetchone()

        if row and row["last_claim_date"] == today:
            return {"success": False, "error": "already_claimed", "message": "Награда уже получена сегодня!"}

        # Считаем стрик
        if row:
            last_claim = row["last_claim_date"]
            streak = row["current_streak"]
            total = row["total_claimed"]
            max_streak = row["max_streak"]

            if last_claim:
                last_date = datetime.strptime(last_claim, "%Y-%m-%d").date()
                today_date = datetime.now().date()
                diff = (today_date - last_date).days
                if diff == 1:
                    streak += 1  # Продолжаем стрик
                elif diff > 1:
                    streak = 1   # Пропустил — сброс
                else:
                    streak += 1  # Первый заход (diff == 0 не должен быть, но на всякий)
            else:
                streak = 1
        else:
            streak = 1
            total = 0
            max_streak = 0

        amount = _get_daily_amount(streak)
        total += amount
        if streak > max_streak:
            max_streak = streak

        # Сохраняем
        conn.execute("""
            INSERT INTO daily_rewards (telegram_id, current_streak, last_claim_date, total_claimed, max_streak)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET
                current_streak = ?,
                last_claim_date = ?,
                total_claimed = ?,
                max_streak = ?
        """, (telegram_id, streak, today, total, max_streak,
              streak, today, total, max_streak))

        # Начисляем сыр
        conn.execute(
            "UPDATE users SET coins = coins + ? WHERE telegram_id = ?",
            (amount, telegram_id)
        )
        user = conn.execute("SELECT id, coins FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
        if user:
            conn.execute(
                "INSERT INTO transactions (user_id, amount, type, description) VALUES (?, ?, 'daily_reward', ?)",
                (user["id"], amount, f"Ежедневная награда (день {streak})")
            )
            new_balance = user["coins"]
        else:
            new_balance = 0

    next_reward = _get_daily_amount(streak + 1)

    return {
        "success": True,
        "amount": amount,
        "streak": streak,
        "total_claimed": total,
        "max_streak": max_streak,
        "new_balance": new_balance,
        "next_reward": next_reward,
    }


# ============================================================
# ИНИЦИАЛИЗАЦИЯ ПРИ ИМПОРТЕ
# ============================================================
init_db()
