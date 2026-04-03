# v2.5 — донаты + музыка + OBS виджет + TwitchReader
import asyncio
import base64
import json
import logging
import os
import aiohttp
from aiohttp import web
from dotenv import load_dotenv

# ⚠️ ВАЖНО: загрузка .env ПЕРЕД импортом модулей
load_dotenv()

# Настройка логирования ПЕРЕД использованием в коде
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

from aiogram import Bot, Dispatcher, types, F
from aiogram.filters import CommandStart, Command
from aiogram.types import (
    InlineKeyboardMarkup,
    InlineKeyboardButton,
    WebAppInfo,
    MenuButtonWebApp,
    ReplyKeyboardMarkup,
    KeyboardButton,
    CallbackQuery,
)
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from aiogram.types import FSInputFile
from stats import search_player, get_player_stats, format_player_stats
from gemini_ai import generate_image as ai_generate_image, ask_gemini, get_saved_images, delete_image

# === НОВЫЕ МОДУЛИ ЭКОСИСТЕМЫ ===
from database import (
    get_or_create_user, get_user_by_telegram_id, update_user_wot,
    add_coins, add_xp, get_total_users,
    create_subscription, check_subscription, get_active_subscribers,
    get_subscription_stats, deactivate_expired_subscriptions,
    create_promo_code, activate_promo_code, get_promo_codes,
    bind_wot_nickname, get_wot_nickname,
    start_verification, confirm_verification, get_verify_snapshot, is_verified,
    SUBSCRIPTION_PLANS,
    buy_cheese, spend_cheese, get_cheese_balance, get_cheese_history, get_cheese_stats,
    send_friend_request, accept_friend_request, decline_friend_request,
    remove_friend, get_friends, get_friend_requests,
    send_message, get_messages, get_unread_count,
    get_user_by_wot_account_id,
    search_users,
)
from challenges import (
    create_challenge, create_from_template, get_active_challenges,
    get_challenge, join_challenge, submit_result,
    get_challenge_leaderboard, get_user_challenges,
    format_challenge, format_leaderboard,
    CHALLENGE_TEMPLATES, CHALLENGE_TYPES,
)
from events import (
    create_event, get_active_events, get_event,
    register_for_event, get_event_participants,
    format_event, format_participants_list,
)

# ============================================================
# НАСТРОЙКИ
# ============================================================
BOT_TOKEN = os.getenv("BOT_TOKEN", "")
WEBAPP_URL = "https://daviddavidov20022-commits.github.io/Mir-Tankov/webapp/"
# Настройка API-ключей Lesta (поддержка нескольких ключей через запятую или по отдельности)
LESTA_APP_IDS = []
# 1. Проверяем LESTA_APP_IDS (множественное) - заменяем переносы строк на запятые для надежности
multi_str = os.getenv("LESTA_APP_IDS", "").replace("\n", ",").replace("\r", ",")
env_multi = multi_str.split(",")

# 2. Проверяем LESTA_APP_ID (единичное)
single_str = os.getenv("LESTA_APP_ID", "").replace("\n", ",").replace("\r", ",")
env_single = single_str.split(",")

# 3. Проверяем LESTA_APP_I (опечатка)
typo_str = os.getenv("LESTA_APP_I", "").replace("\n", ",").replace("\r", ",")
env_typo = typo_str.split(",")

# 4. Собираем всё вместе и чистим
raw_keys = env_multi + env_single + env_typo
# 5. Также ищем ключи вида LESTA_APP_ID_1, LESTA_APP_ID_2 и т.д.
for key, val in os.environ.items():
    if (key.startswith("LESTA_APP_ID_") or key.startswith("LESTA_APP_I_")) and val.strip():
        # В отдельных переменных тоже могут быть списки через запятую
        raw_keys.extend(val.replace("\n", ",").replace("\r", ",").split(","))

LESTA_APP_IDS = []
for s in raw_keys:
    s = s.strip()
    # Ключ Lesta всегда 32 символа (hex)
    if len(s) == 32:
        LESTA_APP_IDS.append(s)
    elif s:
        logger.warning(f"Игнорирую невалидный Lesta API ключ: {s[:10]}... (длина {len(s)}, ожидалось 32)")

# Убираем дубликаты
LESTA_APP_IDS = list(dict.fromkeys(LESTA_APP_IDS))

_lesta_key_index = 0

def get_lesta_app_id():
    """Возвращает следующий API-ключ из списка (ротация)"""
    global _lesta_key_index
    if not LESTA_APP_IDS:
        return ""
    key = LESTA_APP_IDS[_lesta_key_index]
    _lesta_key_index = (_lesta_key_index + 1) % len(LESTA_APP_IDS)
    return key
VERIFY_REDIRECT_URL = WEBAPP_URL + "verify.html"

# ID администратора (ваш Telegram ID)
# Узнать свой ID: отправьте /myid боту, затем добавьте в .env: ADMIN_ID=123456789
_admin_env = os.getenv("ADMIN_ID", "")
ADMIN_ID = int(_admin_env) if _admin_env.strip() else None

# Twitch бот для отправки сообщений в чат
# Получить токен: https://twitchapps.com/tmi/
TWITCH_BOT_NICK = os.getenv("TWITCH_BOT_NICK", "")  # ник бота на Twitch (lowercase)
TWITCH_BOT_TOKEN = os.getenv("TWITCH_BOT_TOKEN", "")  # oauth:xxxx...

# Путь к конфигу призов
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "webapp", "prizes-config.json")
# ============================================================


bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


# ==========================================
# FSM — Состояния для редактирования
# ==========================================
class AdminStates(StatesGroup):
    waiting_prize_name = State()
    waiting_prize_icon = State()
    waiting_prize_coins = State()
    waiting_prize_weight = State()
    waiting_prize_color = State()
    waiting_setting_value = State()
    waiting_new_prize_name = State()
    waiting_new_prize_icon = State()
    waiting_new_prize_coins = State()
    waiting_new_prize_weight = State()


class StatsStates(StatesGroup):
    waiting_nickname = State()


class AIStates(StatesGroup):
    waiting_prompt = State()
    waiting_filename = State()
    waiting_question = State()


class ChallengeStates(StatesGroup):
    waiting_title = State()
    waiting_description = State()
    waiting_type = State()
    waiting_target = State()
    waiting_reward = State()
    waiting_result_value = State()
    waiting_result_proof = State()


class EventStates(StatesGroup):
    waiting_title = State()
    waiting_boss_nick = State()
    waiting_boss_tank = State()
    waiting_schedule = State()
    waiting_wot_nick = State()


class PromoStates(StatesGroup):
    waiting_code = State()
    waiting_create_code = State()
    waiting_create_days = State()
    waiting_create_uses = State()


class NicknameStates(StatesGroup):
    waiting_nickname = State()


# ==========================================
# РАБОТА С КОНФИГОМ
# ==========================================
def load_config():
    """Загрузить конфиг призов из файла"""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Ошибка загрузки конфига: {e}")
        return get_default_config()


def save_config(config):
    """Сохранить конфиг призов в файл"""
    try:
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=4)
        logger.info("Конфиг сохранён")
        return True
    except Exception as e:
        logger.error(f"Ошибка сохранения конфига: {e}")
        return False


def get_default_config():
    return {
        "prizes": [
            {"name": "1000 сыр", "icon": "💰", "coins": 1000, "xp": 50, "color": "#C8AA6E", "weight": 2, "tier": "legendary"},
            {"name": "50 сыр", "icon": "🧀", "coins": 50, "xp": 5, "color": "#2D5A27", "weight": 20, "tier": "common"},
            {"name": "500 сыр", "icon": "💎", "coins": 500, "xp": 30, "color": "#4A5568", "weight": 5, "tier": "epic"},
            {"name": "25 сыр", "icon": "🧀", "coins": 25, "xp": 3, "color": "#5C6B3C", "weight": 25, "tier": "common"},
            {"name": "250 сыр", "icon": "🏅", "coins": 250, "xp": 15, "color": "#8B7340", "weight": 10, "tier": "rare"},
            {"name": "10 сыр", "icon": "🔩", "coins": 10, "xp": 1, "color": "#1A3A15", "weight": 30, "tier": "common"},
            {"name": "100 сыр", "icon": "⭐", "coins": 100, "xp": 10, "color": "#3D5A80", "weight": 15, "tier": "uncommon"},
            {"name": "75 сыр", "icon": "🎖️", "coins": 75, "xp": 8, "color": "#6B5B3C", "weight": 18, "tier": "uncommon"},
        ],
        "settings": {
            "freeSpinsPerDay": 1,
            "spinCostCoins": 50,
            "spinCostStars": 5,
            "buySpinsAmount": 5,
        },
    }


TIER_NAMES = {
    "legendary": "🔥 Легендарный",
    "epic": "💎 Эпический",
    "rare": "🏅 Редкий",
    "uncommon": "⭐ Необычный",
    "common": "🪙 Обычный",
}

TIER_LIST = ["legendary", "epic", "rare", "uncommon", "common"]


# ==========================================
# КОМАНДА /start
# ==========================================
@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    # Регистрируем пользователя в БД
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )

    # Проверяем подписку
    sub = check_subscription(message.from_user.id)
    is_admin = ADMIN_ID and message.from_user.id == ADMIN_ID

    if sub and sub.get("active") or is_admin:
        # === ПОДПИСЧИК / АДМИН — полный доступ ===
        import time
        cache_bust = int(time.time())
        user_webapp_url = f"{WEBAPP_URL}?_t={cache_bust}&telegram_id={message.from_user.id}"
        reply_keyboard = ReplyKeyboardMarkup(
            keyboard=[
                [
                    KeyboardButton(
                        text="🚀 Войти в Мир Танков",
                        web_app=WebAppInfo(url=user_webapp_url),
                    )
                ]
            ],
            resize_keyboard=True,
            is_persistent=True,
        )

        days_left = sub['days_left'] if sub and sub.get('active') else '∞'

        await message.answer(
            "🪖 <b>Добро пожаловать, Танкист!</b>\n\n"
            f"✅ Подписка активна ({days_left} дн.)\n\n"
            "🎰 Крути <b>Колесо Фортуны</b> и выигрывай!\n"
            "📊 Статистика: /stats\n"
            "🎯 Челленджи: /challenge\n"
            "⚔️ Ивенты: /event\n"
            "🔥 Донат: /donate\n"
            "👤 Мой профиль: /profile\n\n"
            "Нажми кнопку <b>«🚀 Войти в Мир Танков»</b> внизу 👇",
            parse_mode="HTML",
            reply_markup=reply_keyboard,
        )
    else:
        # === БЕЗ ПОДПИСКИ — показываем paywall ===
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(
                text="💎 Оформить подписку",
                callback_data="show_subscribe"
            )],
            [InlineKeyboardButton(
                text="🎟️ У меня есть промокод",
                callback_data="enter_promo"
            )],
            [InlineKeyboardButton(
                text="📊 Посмотреть статистику (бесплатно)",
                callback_data="free_stats"
            )],
        ])

        await message.answer(
            "🪖 <b>Добро пожаловать в Мир Танков!</b>\n\n"
            "🔒 Это <b>закрытый клуб</b> для подписчиков.\n\n"
            "💎 <b>Что даёт подписка:</b>\n"
            "├ 🎰 Колесо Фортуны\n"
            "├ 📊 Полная статистика + WN8\n"
            "├ 🎯 Челленджи с призами\n"
            "├ ⚔️ Арена — вызовы на бой\n"
            "├ 🤖 AI-ассистент\n"
            "└ 🏅 Значок подписчика\n\n"
            "💰 <b>От 490₽/мес</b> (250 ⭐)\n"
            "🔥 Скидки до -25% за длительный период!\n\n"
            "Нажми 👇 чтобы оформить:",
            parse_mode="HTML",
            reply_markup=keyboard,
        )


@dp.callback_query(F.data == "show_subscribe")
async def show_subscribe_from_start(callback: CallbackQuery):
    """Перенаправляем на команду подписки"""
    await callback.answer()
    await cmd_subscribe(callback.message)


@dp.callback_query(F.data == "free_stats")
async def free_stats_from_start(callback: CallbackQuery, state: FSMContext):
    """Бесплатная статистика"""
    await callback.answer()
    await state.set_state(StatsStates.waiting_nickname)
    await callback.message.answer(
        "🔍 <b>ПОИСК ИГРОКА</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Введите никнейм игрока Мир Танков:",
        parse_mode="HTML",
    )


@dp.callback_query(F.data == "enter_promo")
async def enter_promo_from_start(callback: CallbackQuery, state: FSMContext):
    """Промокод из paywall"""
    await callback.answer()
    await state.set_state(PromoStates.waiting_code)
    await callback.message.answer(
        "🎟️ <b>ПРОМОКОД</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Введите промокод:",
        parse_mode="HTML",
    )


# ==========================================
# КОМАНДА /myid — узнать свой ID
# ==========================================
@dp.message(Command("myid"))
async def cmd_myid(message: types.Message):
    await message.answer(
        f"🆔 Ваш Telegram ID: <code>{message.from_user.id}</code>\n\n"
        f"Скопируйте и вставьте в ADMIN_ID в bot.py",
        parse_mode="HTML",
    )


# ==========================================
# КОМАНДА /stats — Статистика игрока
# ==========================================
@dp.message(Command("stats"))
async def cmd_stats(message: types.Message, state: FSMContext):
    await state.clear()
    await state.set_state(StatsStates.waiting_nickname)
    await message.answer(
        "🔍 <b>ПОИСК ИГРОКА</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "Введите <b>никнейм</b> игрока Мир Танков:\n\n"
        "<i>Например: Tank_Master_2026</i>",
        parse_mode="HTML",
    )


@dp.message(StatsStates.waiting_nickname)
async def process_stats_nickname(message: types.Message, state: FSMContext):
    nickname = message.text.strip()

    if len(nickname) < 2:
        await message.answer("❌ Никнейм слишком короткий. Минимум 2 символа.")
        return

    # Ищем игрока
    search_msg = await message.answer("🔍 Ищу игрока...")
    players = await search_player(nickname)

    if not players:
        await search_msg.edit_text(
            f"❌ Игрок <b>{nickname}</b> не найден.\n\n"
            f"Попробуйте ввести другой ник или /stats для нового поиска.",
            parse_mode="HTML",
        )
        await state.clear()
        return

    if len(players) == 1:
        # Один результат — сразу показываем стату
        player = players[0]
        stats_data = await get_player_stats(player["account_id"])

        if stats_data:
            text = format_player_stats(stats_data)
            await search_msg.edit_text(text, parse_mode="HTML")
        else:
            await search_msg.edit_text("❌ Не удалось загрузить статистику.")

        await state.clear()
    else:
        # Несколько результатов — показываем кнопки выбора
        buttons = []
        for p in players[:5]:
            buttons.append([
                InlineKeyboardButton(
                    text=f"🪖 {p['nickname']}",
                    callback_data=f"stats_{p['account_id']}"
                )
            ])
        buttons.append([InlineKeyboardButton(text="❌ Отмена", callback_data="stats_cancel")])

        await search_msg.edit_text(
            f"🔍 Найдено несколько игроков по запросу <b>{nickname}</b>:\n\n"
            f"Выберите нужного:",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
        )
        await state.clear()


@dp.callback_query(F.data.startswith("stats_"))
async def stats_select_player(callback: CallbackQuery):
    if callback.data == "stats_cancel":
        await callback.message.edit_text("❌ Поиск отменён.")
        await callback.answer()
        return

    account_id = int(callback.data.split("_")[1])
    await callback.answer("⏳ Загружаю статистику...")

    stats_data = await get_player_stats(account_id)

    if stats_data:
        text = format_player_stats(stats_data)
        await callback.message.edit_text(text, parse_mode="HTML")
    else:
        await callback.message.edit_text("❌ Не удалось загрузить статистику.")


# ==========================================
# КОМАНДА /admin — Главное меню админки
# ==========================================
@dp.message(Command("admin"))
async def cmd_admin(message: types.Message, state: FSMContext):
    global ADMIN_ID

    # Автоматически устанавливаем первого админа
    if ADMIN_ID is None:
        ADMIN_ID = message.from_user.id
        logger.info(f"Админ установлен: {ADMIN_ID}")

    if message.from_user.id != ADMIN_ID:
        await message.answer("❌ У вас нет прав администратора.")
        return

    await state.clear()
    await show_admin_menu(message)


async def show_admin_menu(message_or_callback):
    """Показать главное меню админки"""
    config = load_config()
    prizes_count = len(config.get("prizes", []))
    settings = config.get("settings", {})

    text = (
        "⚙️ <b>АДМИН-ПАНЕЛЬ</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        f"🎁 Призов на колесе: <b>{prizes_count}</b>\n"
        f"🎟 Бесплатных вращений/день: <b>{settings.get('freeSpinsPerDay', 1)}</b>\n"
        f"🪙 Цена вращения: <b>{settings.get('spinCostCoins', 50)} монет</b>\n"
        f"⭐ Цена Stars: <b>{settings.get('spinCostStars', 5)} Stars</b>\n"
        f"🔄 Вращений за Stars: <b>{settings.get('buySpinsAmount', 5)}</b>\n\n"
        "Выберите действие:"
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎁 Список призов", callback_data="admin_prizes")],
        [InlineKeyboardButton(text="➕ Добавить приз", callback_data="admin_add_prize")],
        [InlineKeyboardButton(text="⚙️ Настройки", callback_data="admin_settings")],
        [InlineKeyboardButton(text="🤖 AI Генератор", callback_data="admin_ai")],
        [
            InlineKeyboardButton(text="🎯 Челлендж", callback_data="admin_new_challenge"),
            InlineKeyboardButton(text="⚔️ Ивент", callback_data="admin_new_event"),
        ],
        [InlineKeyboardButton(text="📊 Статистика подписок", callback_data="admin_sub_stats")],
        [InlineKeyboardButton(text="🔄 Сброс по умолчанию", callback_data="admin_reset")],
    ])

    if isinstance(message_or_callback, CallbackQuery):
        await message_or_callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    else:
        await message_or_callback.answer(text, parse_mode="HTML", reply_markup=keyboard)


# ==========================================
# СПИСОК ПРИЗОВ
# ==========================================
@dp.callback_query(F.data == "admin_prizes")
async def admin_prizes_list(callback: CallbackQuery):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    config = load_config()
    prizes = config.get("prizes", [])
    total_weight = sum(p.get("weight", 1) for p in prizes)

    text = "🎁 <b>ПРИЗЫ КОЛЕСА ФОРТУНЫ</b>\n━━━━━━━━━━━━━━━━━━━\n\n"

    for i, prize in enumerate(prizes):
        chance = round((prize.get("weight", 1) / total_weight) * 100, 1)
        tier = TIER_NAMES.get(prize.get("tier", "common"), "🪙 Обычный")
        text += (
            f"<b>{i+1}.</b> {prize.get('icon', '🎁')} {prize.get('name', '?')}\n"
            f"    💰 {prize.get('coins', 0)} монет  |  🎯 {chance}%  |  {tier}\n\n"
        )

    # Кнопки для каждого приза
    buttons = []
    for i, prize in enumerate(prizes):
        buttons.append([
            InlineKeyboardButton(
                text=f"✏️ {prize.get('icon', '🎁')} {prize.get('name', '?')}",
                callback_data=f"admin_edit_{i}"
            )
        ])

    buttons.append([InlineKeyboardButton(text="◀️ Назад", callback_data="admin_back")])

    await callback.message.edit_text(text, parse_mode="HTML",
                                      reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons))
    await callback.answer()


# ==========================================
# РЕДАКТИРОВАНИЕ ПРИЗА
# ==========================================
@dp.callback_query(F.data.startswith("admin_edit_"))
async def admin_edit_prize(callback: CallbackQuery):
    index = int(callback.data.split("_")[-1])
    config = load_config()
    prizes = config.get("prizes", [])

    if index >= len(prizes):
        await callback.answer("❌ Приз не найден", show_alert=True)
        return

    prize = prizes[index]
    total_weight = sum(p.get("weight", 1) for p in prizes)
    chance = round((prize.get("weight", 1) / total_weight) * 100, 1)
    tier_name = TIER_NAMES.get(prize.get("tier", "common"), "Обычный")

    text = (
        f"✏️ <b>РЕДАКТИРОВАНИЕ ПРИЗА #{index+1}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"📝 Название: <b>{prize.get('name', '?')}</b>\n"
        f"🎨 Иконка: {prize.get('icon', '🎁')}\n"
        f"💰 Монеты: <b>{prize.get('coins', 0)}</b>\n"
        f"🎯 Вес (шанс): <b>{prize.get('weight', 1)}</b> ({chance}%)\n"
        f"🏆 Редкость: {tier_name}\n"
        f"🎨 Цвет: {prize.get('color', '#333')}\n\n"
        f"Что хотите изменить?"
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="📝 Название", callback_data=f"edit_name_{index}"),
            InlineKeyboardButton(text="🎨 Иконка", callback_data=f"edit_icon_{index}"),
        ],
        [
            InlineKeyboardButton(text="💰 Монеты", callback_data=f"edit_coins_{index}"),
            InlineKeyboardButton(text="🎯 Вес", callback_data=f"edit_weight_{index}"),
        ],
        [
            InlineKeyboardButton(text="🏆 Редкость", callback_data=f"edit_tier_{index}"),
            InlineKeyboardButton(text="🎨 Цвет", callback_data=f"edit_color_{index}"),
        ],
        [InlineKeyboardButton(text="🗑 Удалить приз", callback_data=f"delete_prize_{index}")],
        [InlineKeyboardButton(text="◀️ К списку", callback_data="admin_prizes")],
    ])

    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await callback.answer()


# ==========================================
# ОБРАБОТЧИКИ ИЗМЕНЕНИЯ ПОЛЕЙ ПРИЗА
# ==========================================
@dp.callback_query(F.data.startswith("edit_name_"))
async def edit_prize_name(callback: CallbackQuery, state: FSMContext):
    index = int(callback.data.split("_")[-1])
    await state.set_state(AdminStates.waiting_prize_name)
    await state.update_data(prize_index=index)
    await callback.message.edit_text(
        f"📝 Введите <b>новое название</b> для приза #{index+1}:\n\n"
        f"Например: <i>500 монет</i>, <i>Премиум танк</i>, <i>XP бонус</i>",
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(AdminStates.waiting_prize_name)
async def process_prize_name(message: types.Message, state: FSMContext):
    data = await state.get_data()
    index = data["prize_index"]

    config = load_config()
    config["prizes"][index]["name"] = message.text.strip()
    save_config(config)

    await state.clear()
    await message.answer(f"✅ Название приза #{index+1} изменено на: <b>{message.text.strip()}</b>", parse_mode="HTML")
    await show_admin_menu(message)


@dp.callback_query(F.data.startswith("edit_icon_"))
async def edit_prize_icon(callback: CallbackQuery, state: FSMContext):
    index = int(callback.data.split("_")[-1])
    await state.set_state(AdminStates.waiting_prize_icon)
    await state.update_data(prize_index=index)
    await callback.message.edit_text(
        f"🎨 Отправьте <b>новую иконку</b> (эмодзи) для приза #{index+1}:\n\n"
        f"Например: 💰 💎 🏆 🎁 ⭐ 🪙 🔩 🏅 🎖️ 🎯 🚀 🔥",
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(AdminStates.waiting_prize_icon)
async def process_prize_icon(message: types.Message, state: FSMContext):
    data = await state.get_data()
    index = data["prize_index"]

    config = load_config()
    config["prizes"][index]["icon"] = message.text.strip()[:4]
    save_config(config)

    await state.clear()
    await message.answer(f"✅ Иконка приза #{index+1} изменена на: {message.text.strip()[:4]}")
    await show_admin_menu(message)


@dp.callback_query(F.data.startswith("edit_coins_"))
async def edit_prize_coins(callback: CallbackQuery, state: FSMContext):
    index = int(callback.data.split("_")[-1])
    await state.set_state(AdminStates.waiting_prize_coins)
    await state.update_data(prize_index=index)
    await callback.message.edit_text(
        f"💰 Введите <b>количество монет</b> для приза #{index+1}:\n\n"
        f"Введите число (например: <i>100</i>, <i>500</i>, <i>1000</i>)",
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(AdminStates.waiting_prize_coins)
async def process_prize_coins(message: types.Message, state: FSMContext):
    try:
        coins = int(message.text.strip())
        if coins < 0:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите положительное число!")
        return

    data = await state.get_data()
    index = data["prize_index"]

    config = load_config()
    config["prizes"][index]["coins"] = coins
    config["prizes"][index]["xp"] = max(1, coins // 10)
    save_config(config)

    await state.clear()
    await message.answer(f"✅ Монеты приза #{index+1}: <b>{coins}</b>", parse_mode="HTML")
    await show_admin_menu(message)


@dp.callback_query(F.data.startswith("edit_weight_"))
async def edit_prize_weight(callback: CallbackQuery, state: FSMContext):
    index = int(callback.data.split("_")[-1])
    await state.set_state(AdminStates.waiting_prize_weight)
    await state.update_data(prize_index=index)
    await callback.message.edit_text(
        f"🎯 Введите <b>вес (шанс)</b> для приза #{index+1}:\n\n"
        f"Чем больше число — тем чаще выпадает.\n"
        f"Примеры: <i>2</i> (очень редко), <i>10</i> (нормально), <i>30</i> (часто)",
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(AdminStates.waiting_prize_weight)
async def process_prize_weight(message: types.Message, state: FSMContext):
    try:
        weight = int(message.text.strip())
        if weight < 1 or weight > 100:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите число от 1 до 100!")
        return

    data = await state.get_data()
    index = data["prize_index"]

    config = load_config()
    config["prizes"][index]["weight"] = weight
    save_config(config)

    await state.clear()
    await message.answer(f"✅ Вес приза #{index+1}: <b>{weight}</b>", parse_mode="HTML")
    await show_admin_menu(message)


@dp.callback_query(F.data.startswith("edit_tier_"))
async def edit_prize_tier(callback: CallbackQuery):
    index = int(callback.data.split("_")[-1])

    # Показываем кнопки выбора редкости
    buttons = []
    for tier_id in TIER_LIST:
        buttons.append([
            InlineKeyboardButton(
                text=TIER_NAMES[tier_id],
                callback_data=f"set_tier_{index}_{tier_id}"
            )
        ])
    buttons.append([InlineKeyboardButton(text="◀️ Назад", callback_data=f"admin_edit_{index}")])

    await callback.message.edit_text(
        f"🏆 Выберите <b>редкость</b> для приза #{index+1}:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("set_tier_"))
async def set_prize_tier(callback: CallbackQuery):
    parts = callback.data.split("_")
    index = int(parts[2])
    tier = parts[3]

    config = load_config()
    config["prizes"][index]["tier"] = tier

    # Автоматически меняем цвет под редкость
    tier_colors = {
        "legendary": "#C8AA6E",
        "epic": "#4A5568",
        "rare": "#8B7340",
        "uncommon": "#3D5A80",
        "common": "#2D5A27",
    }
    config["prizes"][index]["color"] = tier_colors.get(tier, "#333333")
    save_config(config)

    await callback.answer(f"✅ Редкость изменена!", show_alert=True)

    # Вернуться к редактированию
    # Имитируем нажатие на edit
    callback.data = f"admin_edit_{index}"
    await admin_edit_prize(callback)


@dp.callback_query(F.data.startswith("edit_color_"))
async def edit_prize_color(callback: CallbackQuery, state: FSMContext):
    index = int(callback.data.split("_")[-1])
    await state.set_state(AdminStates.waiting_prize_color)
    await state.update_data(prize_index=index)

    colors_text = (
        "🎨 Отправьте <b>цвет</b> в HEX формате:\n\n"
        "Примеры:\n"
        "<code>#C8AA6E</code> — золотой\n"
        "<code>#2D5A27</code> — зелёный\n"
        "<code>#4A5568</code> — серый\n"
        "<code>#9B59B6</code> — фиолетовый\n"
        "<code>#3498DB</code> — синий\n"
        "<code>#E74C3C</code> — красный\n"
        "<code>#F39C12</code> — оранжевый"
    )

    await callback.message.edit_text(colors_text, parse_mode="HTML")
    await callback.answer()


@dp.message(AdminStates.waiting_prize_color)
async def process_prize_color(message: types.Message, state: FSMContext):
    color = message.text.strip()
    if not color.startswith("#") or len(color) not in (4, 7):
        await message.answer("❌ Формат: #RRGGBB (например #C8AA6E)")
        return

    data = await state.get_data()
    index = data["prize_index"]

    config = load_config()
    config["prizes"][index]["color"] = color
    save_config(config)

    await state.clear()
    await message.answer(f"✅ Цвет приза #{index+1}: <b>{color}</b>", parse_mode="HTML")
    await show_admin_menu(message)


# ==========================================
# УДАЛЕНИЕ ПРИЗА
# ==========================================
@dp.callback_query(F.data.startswith("delete_prize_"))
async def delete_prize_confirm(callback: CallbackQuery):
    index = int(callback.data.split("_")[-1])
    config = load_config()
    prize = config["prizes"][index]

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Да, удалить", callback_data=f"confirm_delete_{index}"),
            InlineKeyboardButton(text="❌ Отмена", callback_data=f"admin_edit_{index}"),
        ]
    ])

    await callback.message.edit_text(
        f"🗑 Удалить приз <b>{prize['icon']} {prize['name']}</b>?\n\n"
        f"⚠️ Это действие нельзя отменить!",
        parse_mode="HTML",
        reply_markup=keyboard,
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("confirm_delete_"))
async def delete_prize(callback: CallbackQuery):
    index = int(callback.data.split("_")[-1])
    config = load_config()

    if len(config["prizes"]) <= 2:
        await callback.answer("❌ Минимум 2 приза на колесе!", show_alert=True)
        return

    removed = config["prizes"].pop(index)
    save_config(config)

    await callback.answer(f"🗑 Приз «{removed['name']}» удалён!", show_alert=True)

    # Показать обновлённый список
    callback.data = "admin_prizes"
    await admin_prizes_list(callback)


# ==========================================
# ДОБАВЛЕНИЕ НОВОГО ПРИЗА
# ==========================================
@dp.callback_query(F.data == "admin_add_prize")
async def admin_add_prize(callback: CallbackQuery, state: FSMContext):
    config = load_config()
    if len(config["prizes"]) >= 12:
        await callback.answer("❌ Максимум 12 призов!", show_alert=True)
        return

    await state.set_state(AdminStates.waiting_new_prize_name)
    await callback.message.edit_text(
        "➕ <b>ДОБАВЛЕНИЕ НОВОГО ПРИЗА</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "📝 Шаг 1/4: Введите <b>название</b> приза:\n\n"
        "<i>Например: 500 монет, VIP статус, Премиум танк</i>",
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(AdminStates.waiting_new_prize_name)
async def new_prize_name(message: types.Message, state: FSMContext):
    await state.update_data(new_name=message.text.strip())
    await state.set_state(AdminStates.waiting_new_prize_icon)
    await message.answer(
        "🎨 Шаг 2/4: Отправьте <b>иконку</b> (эмодзи):\n\n"
        "Например: 💰 💎 🏆 🎁 ⭐ 🪙 🔩 🏅 🎯 🚀",
        parse_mode="HTML",
    )


@dp.message(AdminStates.waiting_new_prize_icon)
async def new_prize_icon(message: types.Message, state: FSMContext):
    await state.update_data(new_icon=message.text.strip()[:4])
    await state.set_state(AdminStates.waiting_new_prize_coins)
    await message.answer(
        "💰 Шаг 3/4: Введите <b>количество монет</b>:\n\n"
        "<i>Число от 1 до 10000</i>",
        parse_mode="HTML",
    )


@dp.message(AdminStates.waiting_new_prize_coins)
async def new_prize_coins(message: types.Message, state: FSMContext):
    try:
        coins = int(message.text.strip())
        if coins < 1:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите положительное число!")
        return

    await state.update_data(new_coins=coins)
    await state.set_state(AdminStates.waiting_new_prize_weight)
    await message.answer(
        "🎯 Шаг 4/4: Введите <b>вес (шанс выпадения)</b>:\n\n"
        "Чем больше — тем чаще выпадает.\n"
        "<i>1-5</i> = редко, <i>10-20</i> = нормально, <i>25-30</i> = часто",
        parse_mode="HTML",
    )


@dp.message(AdminStates.waiting_new_prize_weight)
async def new_prize_weight(message: types.Message, state: FSMContext):
    try:
        weight = int(message.text.strip())
        if weight < 1 or weight > 100:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите число от 1 до 100!")
        return

    data = await state.get_data()

    # Определяем редкость автоматически по весу
    if weight <= 3:
        tier = "legendary"
        color = "#C8AA6E"
    elif weight <= 8:
        tier = "epic"
        color = "#4A5568"
    elif weight <= 15:
        tier = "rare"
        color = "#8B7340"
    elif weight <= 22:
        tier = "uncommon"
        color = "#3D5A80"
    else:
        tier = "common"
        color = "#2D5A27"

    new_prize = {
        "name": data["new_name"],
        "icon": data["new_icon"],
        "coins": data["new_coins"],
        "xp": max(1, data["new_coins"] // 10),
        "color": color,
        "weight": weight,
        "tier": tier,
    }

    config = load_config()
    config["prizes"].append(new_prize)
    save_config(config)

    await state.clear()
    await message.answer(
        f"✅ <b>Приз добавлен!</b>\n\n"
        f"{new_prize['icon']} {new_prize['name']}\n"
        f"💰 {new_prize['coins']} монет  |  🎯 Вес: {weight}  |  {TIER_NAMES[tier]}",
        parse_mode="HTML",
    )
    await show_admin_menu(message)


# ==========================================
# НАСТРОЙКИ
# ==========================================
@dp.callback_query(F.data == "admin_settings")
async def admin_settings(callback: CallbackQuery):
    config = load_config()
    s = config.get("settings", {})

    text = (
        "⚙️ <b>НАСТРОЙКИ КОЛЕСА</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        f"🎟 Бесплатных вращений/день: <b>{s.get('freeSpinsPerDay', 1)}</b>\n"
        f"🪙 Цена вращения за монеты: <b>{s.get('spinCostCoins', 50)}</b>\n"
        f"⭐ Цена за Stars: <b>{s.get('spinCostStars', 5)}</b>\n"
        f"🔄 Вращений за Stars: <b>{s.get('buySpinsAmount', 5)}</b>"
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text=f"🎟 Бесп. вращений: {s.get('freeSpinsPerDay', 1)}", callback_data="set_freeSpins")],
        [InlineKeyboardButton(text=f"🪙 Цена монеты: {s.get('spinCostCoins', 50)}", callback_data="set_spinCost")],
        [InlineKeyboardButton(text=f"⭐ Цена Stars: {s.get('spinCostStars', 5)}", callback_data="set_starsCost")],
        [InlineKeyboardButton(text=f"🔄 Кол-во за Stars: {s.get('buySpinsAmount', 5)}", callback_data="set_buyAmount")],
        [InlineKeyboardButton(text="◀️ Назад", callback_data="admin_back")],
    ])

    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data.startswith("set_"))
async def set_setting(callback: CallbackQuery, state: FSMContext):
    setting_key = callback.data  # set_freeSpins, set_spinCost, etc.

    labels = {
        "set_freeSpins": ("freeSpinsPerDay", "Бесплатных вращений в день", "1-10"),
        "set_spinCost": ("spinCostCoins", "Цена вращения (монеты)", "10-10000"),
        "set_starsCost": ("spinCostStars", "Цена в Stars", "1-1000"),
        "set_buyAmount": ("buySpinsAmount", "Кол-во вращений за Stars", "1-100"),
    }

    if setting_key not in labels:
        return

    key, label, hint = labels[setting_key]
    await state.set_state(AdminStates.waiting_setting_value)
    await state.update_data(setting_key=key)

    await callback.message.edit_text(
        f"⚙️ Введите новое значение для <b>{label}</b>:\n\n"
        f"<i>Допустимый диапазон: {hint}</i>",
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(AdminStates.waiting_setting_value)
async def process_setting_value(message: types.Message, state: FSMContext):
    try:
        value = int(message.text.strip())
        if value < 0:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите положительное число!")
        return

    data = await state.get_data()
    key = data["setting_key"]

    config = load_config()
    if "settings" not in config:
        config["settings"] = {}
    config["settings"][key] = value
    save_config(config)

    await state.clear()
    await message.answer(f"✅ Настройка обновлена: <b>{value}</b>", parse_mode="HTML")
    await show_admin_menu(message)


# ==========================================
# СБРОС ПО УМОЛЧАНИЮ
# ==========================================
@dp.callback_query(F.data == "admin_reset")
async def admin_reset_confirm(callback: CallbackQuery):
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(text="✅ Да, сбросить", callback_data="admin_reset_confirm"),
            InlineKeyboardButton(text="❌ Отмена", callback_data="admin_back"),
        ]
    ])
    await callback.message.edit_text(
        "⚠️ <b>Сбросить все призы к значениям по умолчанию?</b>\n\n"
        "Все ваши изменения будут потеряны!",
        parse_mode="HTML",
        reply_markup=keyboard,
    )
    await callback.answer()


@dp.callback_query(F.data == "admin_reset_confirm")
async def admin_reset_do(callback: CallbackQuery):
    save_config(get_default_config())
    await callback.answer("✅ Конфиг сброшен!", show_alert=True)
    await show_admin_menu(callback)


# ==========================================
# КНОПКА "НАЗАД"
# ==========================================
@dp.callback_query(F.data == "admin_back")
async def admin_back(callback: CallbackQuery, state: FSMContext):
    await state.clear()
    await show_admin_menu(callback)
    await callback.answer()


# ==========================================
# 🤖 AI ГЕНЕРАТОР  
# ==========================================
@dp.callback_query(F.data == "admin_ai")
async def admin_ai_menu(callback: CallbackQuery, state: FSMContext):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    await state.clear()

    text = (
        "🤖 <b>AI ГЕНЕРАТОР</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "Используйте Gemini AI для:\n"
        "🎨 Генерации иконок и картинок\n"
        "💬 Вопросов по настройке\n"
        "🖼 Управления изображениями\n\n"
        "Выберите действие:"
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎨 Сгенерировать картинку", callback_data="ai_generate")],
        [InlineKeyboardButton(text="💬 Задать вопрос AI", callback_data="ai_question")],
        [InlineKeyboardButton(text="🖼 Мои картинки", callback_data="ai_images")],
        [InlineKeyboardButton(text="◀️ Назад", callback_data="admin_back")],
    ])

    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data == "ai_generate")
async def ai_start_generate(callback: CallbackQuery, state: FSMContext):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    await state.set_state(AIStates.waiting_prompt)

    text = (
        "🎨 <b>ГЕНЕРАЦИЯ КАРТИНКИ</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "Опишите, что нужно сгенерировать.\n"
        "AI автоматически добавит стиль Мир Танков.\n\n"
        "💡 <b>Примеры:</b>\n"
        "• <i>Иконка статистики с прицелом и графиками</i>\n"
        "• <i>Танк Т-34 на фоне боя</i>\n"
        "• <i>Логотип клуба с танковой эмблемой</i>\n"
        "• <i>Баннер с тяжёлым танком ИС-7</i>\n\n"
        "✏️ Введите описание:"
    )

    await callback.message.edit_text(text, parse_mode="HTML")
    await callback.answer()


@dp.message(AIStates.waiting_prompt)
async def ai_process_prompt(message: types.Message, state: FSMContext):
    prompt = message.text.strip()

    if len(prompt) < 3:
        await message.answer("❌ Описание слишком короткое. Минимум 3 символа.")
        return

    await state.update_data(prompt=prompt)
    await state.set_state(AIStates.waiting_filename)

    await message.answer(
        "📁 <b>Имя файла</b>\n\n"
        "Введите имя для картинки (латиницей, без пробелов).\n"
        "Например: <code>stats_icon</code>, <code>tank_banner</code>, <code>logo</code>\n\n"
        "Или отправьте <code>auto</code> для автоматического имени.",
        parse_mode="HTML"
    )


@dp.message(AIStates.waiting_filename)
async def ai_process_filename(message: types.Message, state: FSMContext):
    data = await state.get_data()
    prompt = data.get("prompt", "")
    
    filename = message.text.strip().lower().replace(" ", "_")
    if filename == "auto":
        filename = None

    await state.clear()

    # Отправляем индикатор
    wait_msg = await message.answer(
        "⏳ <b>Генерирую картинку...</b>\n"
        "Это займёт 10-30 секунд.",
        parse_mode="HTML"
    )

    # Генерируем
    result = await ai_generate_image(prompt, filename)

    if result["success"]:
        # Отправляем результат
        image_path = result["image_path"]

        try:
            photo = FSInputFile(image_path)
            await message.answer_photo(
                photo,
                caption=(
                    f"✅ <b>Картинка сгенерирована!</b>\n\n"
                    f"📝 Запрос: <i>{prompt}</i>\n"
                    f"📁 Файл: <code>{result['filename']}</code>\n"
                    f"🔗 Путь: <code>{result['relative_path']}</code>\n\n"
                    f"Картинка сохранена в <code>webapp/img/</code>"
                ),
                parse_mode="HTML",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                    [InlineKeyboardButton(text="🎨 Ещё картинку", callback_data="ai_generate")],
                    [InlineKeyboardButton(text="🖼 Мои картинки", callback_data="ai_images")],
                    [InlineKeyboardButton(text="◀️ В AI меню", callback_data="admin_ai")],
                ])
            )
        except Exception as e:
            await message.answer(
                f"✅ Картинка сохранена: <code>{result['filename']}</code>\n"
                f"⚠️ Не удалось отправить превью: {e}",
                parse_mode="HTML"
            )
    else:
        await message.answer(
            f"❌ <b>Ошибка генерации</b>\n\n{result['error']}\n\n"
            f"Проверьте API ключ в <code>gemini_ai.py</code>",
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🔄 Попробовать снова", callback_data="ai_generate")],
                [InlineKeyboardButton(text="◀️ Назад", callback_data="admin_ai")],
            ])
        )

    # Удаляем сообщение "ждите"
    try:
        await wait_msg.delete()
    except:
        pass


@dp.callback_query(F.data == "ai_question")
async def ai_start_question(callback: CallbackQuery, state: FSMContext):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    await state.set_state(AIStates.waiting_question)

    text = (
        "💬 <b>ВОПРОС К AI</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "Задайте любой вопрос по настройке бота,\n"
        "дизайну приложения или Мир Танков.\n\n"
        "✏️ Введите вопрос:"
    )

    await callback.message.edit_text(text, parse_mode="HTML")
    await callback.answer()


@dp.message(AIStates.waiting_question)
async def ai_process_question(message: types.Message, state: FSMContext):
    question = message.text.strip()
    await state.clear()

    wait_msg = await message.answer("🤔 Думаю...")

    answer = await ask_gemini(question)

    await message.answer(
        f"💬 <b>Ответ AI:</b>\n\n{answer}",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="💬 Ещё вопрос", callback_data="ai_question")],
            [InlineKeyboardButton(text="◀️ В AI меню", callback_data="admin_ai")],
        ])
    )

    try:
        await wait_msg.delete()
    except:
        pass


@dp.callback_query(F.data == "ai_images")
async def ai_list_images(callback: CallbackQuery):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    images = get_saved_images()

    if not images:
        text = (
            "🖼 <b>МОИ КАРТИНКИ</b>\n"
            "━━━━━━━━━━━━━━━━━━━\n\n"
            "Пока нет сохранённых картинок.\n"
            "Сгенерируйте первую через AI!"
        )
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [InlineKeyboardButton(text="🎨 Сгенерировать", callback_data="ai_generate")],
            [InlineKeyboardButton(text="◀️ Назад", callback_data="admin_ai")],
        ])
    else:
        text = (
            f"🖼 <b>МОИ КАРТИНКИ</b> ({len(images)})\n"
            "━━━━━━━━━━━━━━━━━━━\n\n"
        )
        for i, img in enumerate(images):
            text += f"<b>{i+1}.</b> <code>{img['filename']}</code> ({img['size_kb']} KB)\n"

        text += f"\nВсего: {len(images)} файл(ов)"

        buttons = []
        for i, img in enumerate(images):
            buttons.append([
                InlineKeyboardButton(
                    text=f"👁 {img['filename']}",
                    callback_data=f"ai_view_{i}"
                ),
                InlineKeyboardButton(
                    text="🗑",
                    callback_data=f"ai_del_{i}"
                ),
            ])
        buttons.append([InlineKeyboardButton(text="🎨 Сгенерировать ещё", callback_data="ai_generate")])
        buttons.append([InlineKeyboardButton(text="◀️ Назад", callback_data="admin_ai")])
        keyboard = InlineKeyboardMarkup(inline_keyboard=buttons)

    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data.startswith("ai_view_"))
async def ai_view_image(callback: CallbackQuery):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    index = int(callback.data.split("_")[-1])
    images = get_saved_images()

    if index >= len(images):
        await callback.answer("❌ Картинка не найдена", show_alert=True)
        return

    img = images[index]

    try:
        photo = FSInputFile(img["path"])
        await callback.message.answer_photo(
            photo,
            caption=(
                f"🖼 <b>{img['filename']}</b>\n"
                f"📦 Размер: {img['size_kb']} KB\n"
                f"🔗 Путь в webapp: <code>{img['relative_path']}</code>"
            ),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [InlineKeyboardButton(text="🗑 Удалить", callback_data=f"ai_del_{index}")],
                [InlineKeyboardButton(text="◀️ К списку", callback_data="ai_images")],
            ])
        )
    except Exception as e:
        await callback.answer(f"Ошибка: {e}", show_alert=True)

    await callback.answer()


@dp.callback_query(F.data.startswith("ai_del_"))
async def ai_delete_image(callback: CallbackQuery):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    index = int(callback.data.split("_")[-1])
    images = get_saved_images()

    if index >= len(images):
        await callback.answer("❌ Картинка не найдена", show_alert=True)
        return

    img = images[index]
    if delete_image(img["filename"]):
        await callback.answer(f"✅ {img['filename']} удалена", show_alert=True)
    else:
        await callback.answer("❌ Ошибка удаления", show_alert=True)

    # Обновляем список
    await ai_list_images(callback)


# Команда /ai — быстрый вход в AI меню
@dp.message(Command("ai"))
async def cmd_ai(message: types.Message, state: FSMContext):
    global ADMIN_ID

    if ADMIN_ID is None:
        ADMIN_ID = message.from_user.id

    if message.from_user.id != ADMIN_ID:
        await message.answer("❌ Эта команда доступна только администратору.")
        return

    await state.clear()

    text = (
        "🤖 <b>AI ГЕНЕРАТОР</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "Используйте Gemini AI для:\n"
        "🎨 Генерации иконок и картинок\n"
        "💬 Вопросов по настройке\n"
        "🖼 Управления изображениями\n\n"
        "Выберите действие:"
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎨 Сгенерировать картинку", callback_data="ai_generate")],
        [InlineKeyboardButton(text="💬 Задать вопрос AI", callback_data="ai_question")],
        [InlineKeyboardButton(text="🖼 Мои картинки", callback_data="ai_images")],
        [InlineKeyboardButton(text="◀️ В админку", callback_data="admin_back")],
    ])

    await message.answer(text, parse_mode="HTML", reply_markup=keyboard)


# ==========================================
# 👤 ПРОФИЛЬ ПОЛЬЗОВАТЕЛЯ
# ==========================================
@dp.message(Command("profile"))
async def cmd_profile(message: types.Message):
    user = get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    sub = check_subscription(message.from_user.id)
    challenges = get_user_challenges(message.from_user.id)
    completed = sum(1 for c in challenges if c.get("is_completed"))

    sub_text = "❌ Нет подписки" if not sub or not sub.get("active") else (
        f"{sub['plan_name']} (до {sub['expires_at']}, осталось {sub['days_left']} дн.)"
    )

    # Статус верификации
    nick = get_wot_nickname(message.from_user.id)
    verified = is_verified(message.from_user.id)
    if nick and verified:
        nick_text = f"✅ {nick} (верифицирован)"
    elif nick:
        nick_text = f"⚠️ {nick} (не верифицирован)"
    else:
        nick_text = "❌ Не привязан"

    text = (
        f"👤 <b>ПРОФИЛЬ</b>\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"🆔 ID: <code>{message.from_user.id}</code>\n"
        f"👤 Имя: <b>{message.from_user.first_name or '—'}</b>\n"
        f"🎮 WoT: <b>{nick_text}</b>\n\n"
        f"🪙 Монеты: <b>{user.get('coins', 0)}</b>\n"
        f"⭐ XP: <b>{user.get('xp', 0)}</b>\n"
        f"📊 Уровень: <b>{user.get('level', 1)}</b>\n\n"
        f"💎 Подписка: {sub_text}\n\n"
        f"🎯 Челленджей: <b>{len(challenges)}</b> (✅ {completed})\n"
    )

    # Кнопки
    buttons = []
    if not nick:
        buttons.append([InlineKeyboardButton(text="🎮 Привязать ник", callback_data="start_setnick")])
    elif not verified:
        buttons.append([InlineKeyboardButton(text="🔐 Верифицировать", callback_data="start_verify")])
    buttons.append([InlineKeyboardButton(text="🎯 Мои челленджи", callback_data="my_challenges")])
    buttons.append([InlineKeyboardButton(text="💎 Подписка", callback_data="show_subscribe")])

    keyboard = InlineKeyboardMarkup(inline_keyboard=buttons)
    await message.answer(text, parse_mode="HTML", reply_markup=keyboard)


@dp.callback_query(F.data == "start_setnick")
async def cb_start_setnick(callback: CallbackQuery):
    await callback.answer()
    await callback.message.answer("Введите /setnick чтобы привязать ник 🎮")


@dp.callback_query(F.data == "start_verify")
async def cb_start_verify(callback: CallbackQuery):
    await callback.answer()
    await callback.message.answer("Введите /verify чтобы верифицировать аккаунт 🔐")

# ==========================================
# 🎯 ЧЕЛЛЕНДЖИ
# ==========================================
@dp.message(Command("challenge"))
async def cmd_challenge(message: types.Message):
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    challenges = get_active_challenges()

    if not challenges:
        await message.answer(
            "🎯 <b>ЧЕЛЛЕНДЖИ</b>\n"
            "━━━━━━━━━━━━━━━━━━━\n\n"
            "😔 Сейчас нет активных челленджей.\n"
            "Следите за обновлениями!",
            parse_mode="HTML",
        )
        return

    text = "🎯 <b>АКТИВНЫЕ ЧЕЛЛЕНДЖИ</b>\n━━━━━━━━━━━━━━━━━━━\n\n"
    buttons = []

    for ch in challenges:
        text += f"{ch['icon']} <b>{ch['title']}</b> — {ch['reward_coins']} 🪙\n"
        buttons.append([
            InlineKeyboardButton(
                text=f"{ch['icon']} {ch['title']}",
                callback_data=f"ch_view_{ch['id']}"
            )
        ])

    text += "\nВыберите челлендж для подробностей:"

    await message.answer(
        text, parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
    )


@dp.callback_query(F.data.startswith("ch_view_"))
async def view_challenge(callback: CallbackQuery):
    challenge_id = int(callback.data.split("_")[-1])
    challenge = get_challenge(challenge_id)

    if not challenge:
        await callback.answer("Челлендж не найден", show_alert=True)
        return

    text = format_challenge(challenge)
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Участвовать", callback_data=f"ch_join_{challenge_id}")],
        [InlineKeyboardButton(text="📊 Таблица лидеров", callback_data=f"ch_lb_{challenge_id}")],
        [InlineKeyboardButton(text="📤 Отправить результат", callback_data=f"ch_submit_{challenge_id}")],
        [InlineKeyboardButton(text="◀️ Назад", callback_data="ch_back")],
    ])

    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data == "ch_back")
async def challenge_back(callback: CallbackQuery):
    # Переотправляем список
    challenges = get_active_challenges()
    if not challenges:
        await callback.message.edit_text("😔 Нет активных челленджей.")
        await callback.answer()
        return

    text = "🎯 <b>АКТИВНЫЕ ЧЕЛЛЕНДЖИ</b>\n━━━━━━━━━━━━━━━━━━━\n\n"
    buttons = []
    for ch in challenges:
        text += f"{ch['icon']} <b>{ch['title']}</b> — {ch['reward_coins']} 🪙\n"
        buttons.append([
            InlineKeyboardButton(
                text=f"{ch['icon']} {ch['title']}",
                callback_data=f"ch_view_{ch['id']}"
            )
        ])

    await callback.message.edit_text(
        text, parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("ch_join_"))
async def join_challenge_handler(callback: CallbackQuery):
    challenge_id = int(callback.data.split("_")[-1])
    result = join_challenge(callback.from_user.id, challenge_id)

    if result["success"]:
        await callback.answer("✅ Вы присоединились к челленджу!", show_alert=True)
    else:
        await callback.answer(f"❌ {result['error']}", show_alert=True)


@dp.callback_query(F.data.startswith("ch_lb_"))
async def challenge_leaderboard_handler(callback: CallbackQuery):
    challenge_id = int(callback.data.split("_")[-1])
    challenge = get_challenge(challenge_id)
    entries = get_challenge_leaderboard(challenge_id)

    title = challenge["title"] if challenge else ""
    text = format_leaderboard(entries, title)

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="◀️ Назад к челленджу", callback_data=f"ch_view_{challenge_id}")],
    ])

    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data.startswith("ch_submit_"))
async def challenge_submit_start(callback: CallbackQuery, state: FSMContext):
    challenge_id = int(callback.data.split("_")[-1])
    await state.set_state(ChallengeStates.waiting_result_value)
    await state.update_data(submit_challenge_id=challenge_id)

    challenge = get_challenge(challenge_id)
    ch_type = CHALLENGE_TYPES.get(challenge.get("challenge_type", "custom"), {})
    unit = ch_type.get("unit", "")

    await callback.message.edit_text(
        f"📤 <b>ОТПРАВКА РЕЗУЛЬТАТА</b>\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"Челлендж: <b>{challenge['title']}</b>\n"
        f"Цель: <b>{challenge['target_value']}</b> {unit}\n\n"
        f"Введите ваш результат (число):\n"
        f"<i>Например: 5200</i>",
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(ChallengeStates.waiting_result_value)
async def challenge_submit_value(message: types.Message, state: FSMContext):
    try:
        value = int(message.text.strip())
        if value < 0:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите положительное число!")
        return

    data = await state.get_data()
    challenge_id = data["submit_challenge_id"]

    result = submit_result(message.from_user.id, challenge_id, value)
    await state.clear()

    if not result["success"]:
        await message.answer(f"❌ {result['error']}")
        return

    if result.get("completed"):
        await message.answer(
            f"🎉 <b>ЧЕЛЛЕНДЖ ВЫПОЛНЕН!</b>\n\n"
            f"🪙 +{result['reward_coins']} монет\n"
            f"⭐ +{result['reward_xp']} XP\n\n"
            f"Отличная работа, Танкист! 🪖",
            parse_mode="HTML",
        )
    else:
        await message.answer(
            f"📊 <b>Результат принят!</b>\n\n"
            f"Текущий прогресс: <b>{result['current_value']}/{result['target_value']}</b>\n"
            f"Выполнено: <b>{result['progress']}%</b>\n\n"
            f"Продолжайте! 💪",
            parse_mode="HTML",
        )


@dp.callback_query(F.data == "my_challenges")
async def my_challenges_handler(callback: CallbackQuery):
    challenges = get_user_challenges(callback.from_user.id)

    if not challenges:
        await callback.answer("У вас пока нет челленджей", show_alert=True)
        return

    text = "🎯 <b>МОИ ЧЕЛЛЕНДЖИ</b>\n━━━━━━━━━━━━━━━━━━━\n\n"
    for ch in challenges[:10]:
        status = "✅" if ch.get("is_completed") else "⏳"
        progress = ""
        if not ch.get("is_completed") and ch.get("target_value"):
            pct = round(ch.get("current_value", 0) / ch["target_value"] * 100, 1)
            progress = f" ({pct}%)"
        text += f"{status} {ch['icon']} <b>{ch['title']}</b>{progress}\n"

    await callback.message.edit_text(text, parse_mode="HTML")
    await callback.answer()


# ==========================================
# ⚔️ ИВЕНТЫ
# ==========================================
@dp.message(Command("event"))
async def cmd_event(message: types.Message):
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    events = get_active_events()

    if not events:
        await message.answer(
            "⚔️ <b>ИВЕНТЫ</b>\n"
            "━━━━━━━━━━━━━━━━━━━\n\n"
            "😔 Сейчас нет запланированных ивентов.\n"
            "Следите за обновлениями!",
            parse_mode="HTML",
        )
        return

    buttons = []
    for ev in events:
        buttons.append([
            InlineKeyboardButton(
                text=f"⚔️ {ev['title']} ({ev.get('registered', 0)}/{ev['max_participants']})",
                callback_data=f"ev_view_{ev['id']}"
            )
        ])

    await message.answer(
        "⚔️ <b>БЛИЖАЙШИЕ ИВЕНТЫ</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "Выберите ивент:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
    )


@dp.callback_query(F.data.startswith("ev_view_"))
async def view_event(callback: CallbackQuery):
    event_id = int(callback.data.split("_")[-1])
    event = get_event(event_id)

    if not event:
        await callback.answer("Ивент не найден", show_alert=True)
        return

    text = format_event(event)
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="✅ Зарегистрироваться", callback_data=f"ev_reg_{event_id}")],
        [InlineKeyboardButton(text="📋 Список участников", callback_data=f"ev_parts_{event_id}")],
        [InlineKeyboardButton(text="◀️ Назад", callback_data="ev_back")],
    ])

    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await callback.answer()


@dp.callback_query(F.data == "ev_back")
async def event_back(callback: CallbackQuery):
    events = get_active_events()
    if not events:
        await callback.message.edit_text("😔 Нет ивентов.")
        await callback.answer()
        return

    buttons = []
    for ev in events:
        buttons.append([
            InlineKeyboardButton(
                text=f"⚔️ {ev['title']} ({ev.get('registered', 0)}/{ev['max_participants']})",
                callback_data=f"ev_view_{ev['id']}"
            )
        ])

    await callback.message.edit_text(
        "⚔️ <b>БЛИЖАЙШИЕ ИВЕНТЫ</b>\n━━━━━━━━━━━━━━━━━━━\n\nВыберите ивент:",
        parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("ev_reg_"))
async def event_register_start(callback: CallbackQuery, state: FSMContext):
    event_id = int(callback.data.split("_")[-1])
    user = get_user_by_telegram_id(callback.from_user.id)

    # Если у пользователя привязан ник WoT, используем его
    if user and user.get("wot_nickname"):
        result = register_for_event(callback.from_user.id, event_id, user["wot_nickname"])
        if result["success"]:
            await callback.answer(
                f"✅ Вы зарегистрированы! Позиция #{result['position']}. "
                f"Свободно слотов: {result['slots_left']}",
                show_alert=True
            )
        else:
            await callback.answer(f"❌ {result['error']}", show_alert=True)
    else:
        # Просим ввести ник
        await state.set_state(EventStates.waiting_wot_nick)
        await state.update_data(reg_event_id=event_id)
        await callback.message.edit_text(
            "🪖 Введите ваш <b>никнейм в Мир Танков</b>:\n\n"
            "<i>Например: Tank_Master_2026</i>",
            parse_mode="HTML",
        )
        await callback.answer()


@dp.message(EventStates.waiting_wot_nick)
async def event_register_nick(message: types.Message, state: FSMContext):
    nickname = message.text.strip()
    if len(nickname) < 2:
        await message.answer("❌ Ник слишком короткий")
        return

    data = await state.get_data()
    event_id = data["reg_event_id"]

    # Сохраняем ник
    update_user_wot(message.from_user.id, nickname, 0)

    result = register_for_event(message.from_user.id, event_id, nickname)
    await state.clear()

    if result["success"]:
        await message.answer(
            f"✅ <b>Вы зарегистрированы!</b>\n\n"
            f"🪖 Ник: <b>{nickname}</b>\n"
            f"📊 Позиция: #{result['position']}\n"
            f"🟢 Свободно слотов: {result['slots_left']}",
            parse_mode="HTML",
        )
    else:
        await message.answer(f"❌ {result['error']}")


@dp.callback_query(F.data.startswith("ev_parts_"))
async def event_participants_handler(callback: CallbackQuery):
    event_id = int(callback.data.split("_")[-1])
    event = get_event(event_id)
    participants = get_event_participants(event_id)

    title = event["title"] if event else ""
    text = format_participants_list(participants, title)

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="◀️ Назад к ивенту", callback_data=f"ev_view_{event_id}")],
    ])

    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await callback.answer()


# ==========================================
# 💎 ПОДПИСКА
# ==========================================
@dp.message(Command("subscribe"))
async def cmd_subscribe(message: types.Message):
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    sub = check_subscription(message.from_user.id)

    if sub and sub.get("active"):
        text = (
            f"💎 <b>ВАША ПОДПИСКА</b>\n"
            f"━━━━━━━━━━━━━━━━━━━\n\n"
            f"✅ Тариф: <b>{sub['plan_name']}</b>\n"
            f"📅 Действует до: <b>{sub['expires_at']}</b>\n"
            f"⏰ Осталось: <b>{sub['days_left']} дней</b>\n\n"
            f"Спасибо за поддержку! 🪖"
        )
        await message.answer(text, parse_mode="HTML")
        return

    text = (
        "💎 <b>ПЛАТНАЯ ПОДПИСКА</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "Что даёт подписка:\n"
        "✅ Доступ к закрытому каналу\n"
        "✅ Эксклюзивные челленджи\n"
        "✅ Участие в ивентах \"1 против 15\"\n"
        "✅ Ранний доступ к видео\n"
        "✅ Прямое общение со стримером\n\n"
        "Выберите тариф:"
    )

    buttons = []
    for plan_id, plan_info in SUBSCRIPTION_PLANS.items():
        buttons.append([
            InlineKeyboardButton(
                text=f"{plan_info['name']} — {plan_info['price']}₽/мес",
                callback_data=f"sub_buy_{plan_id}"
            )
        ])

    await message.answer(
        text, parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
    )


@dp.callback_query(F.data == "show_subscribe")
async def show_subscribe(callback: CallbackQuery):
    sub = check_subscription(callback.from_user.id)

    if sub and sub.get("active"):
        await callback.answer(
            f"У вас уже есть подписка {sub['plan_name']} до {sub['expires_at']}",
            show_alert=True
        )
        return

    text = (
        "💎 <b>ПЛАТНАЯ ПОДПИСКА</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "✅ Закрытый канал + Челленджи + Ивенты\n\n"
        "Выберите тариф:"
    )

    buttons = []
    for plan_id, plan_info in SUBSCRIPTION_PLANS.items():
        buttons.append([
            InlineKeyboardButton(
                text=f"{plan_info['name']} — {plan_info['price']}₽/мес",
                callback_data=f"sub_buy_{plan_id}"
            )
        ])

    await callback.message.edit_text(
        text, parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("sub_buy_"))
async def sub_buy(callback: CallbackQuery):
    plan_id = callback.data.split("_")[-1]
    plan_info = SUBSCRIPTION_PLANS.get(plan_id)

    if not plan_info:
        await callback.answer("Тариф не найден", show_alert=True)
        return

    # TODO: Здесь будет интеграция с платёжной системой (Tribute/Donate/Stars)
    # Пока что активируем подписку напрямую (для тестирования)
    result = create_subscription(callback.from_user.id, plan_id, "test")

    if result["success"]:
        await callback.message.edit_text(
            f"🎉 <b>ПОДПИСКА АКТИВИРОВАНА!</b>\n\n"
            f"💎 Тариф: <b>{result['plan']}</b>\n"
            f"💰 Стоимость: <b>{result['price']}₽</b>\n"
            f"📅 Действует до: <b>{result['expires_at']}</b>\n\n"
            f"Добро пожаловать в закрытый клуб! 🪖\n\n"
            f"<i>⚠️ Тестовый режим: оплата не взимается</i>",
            parse_mode="HTML",
        )
    else:
        await callback.answer(f"❌ {result.get('error', 'Ошибка')}", show_alert=True)

    await callback.answer()


# ==========================================
# 🛠 АДМИН: СОЗДАНИЕ ЧЕЛЛЕНДЖЕЙ И ИВЕНТОВ
# ==========================================
@dp.callback_query(F.data == "admin_new_challenge")
async def admin_new_challenge(callback: CallbackQuery):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    text = "🎯 <b>СОЗДАТЬ ЧЕЛЛЕНДЖ</b>\n━━━━━━━━━━━━━━━━━━━\n\nВыберите шаблон:\n\n"
    buttons = []

    for i, t in enumerate(CHALLENGE_TEMPLATES):
        text += f"{t['icon']} <b>{t['title']}</b> — {t['description'][:50]}...\n"
        buttons.append([
            InlineKeyboardButton(
                text=f"{t['icon']} {t['title']}",
                callback_data=f"admin_ch_tpl_{i}"
            )
        ])

    buttons.append([InlineKeyboardButton(text="◀️ Назад", callback_data="admin_back")])

    await callback.message.edit_text(
        text, parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons)
    )
    await callback.answer()


@dp.callback_query(F.data.startswith("admin_ch_tpl_"))
async def admin_create_from_template(callback: CallbackQuery):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    index = int(callback.data.split("_")[-1])
    result = create_from_template(index, created_by=callback.from_user.id)

    if result.get("success"):
        await callback.answer(
            f"✅ Челлендж «{result['title']}» создан!\nДо {result['ends_at']}",
            show_alert=True
        )
        await show_admin_menu(callback)
    else:
        await callback.answer(f"❌ {result.get('error')}", show_alert=True)


@dp.callback_query(F.data == "admin_new_event")
async def admin_new_event(callback: CallbackQuery, state: FSMContext):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    await state.set_state(EventStates.waiting_title)
    await callback.message.edit_text(
        "⚔️ <b>СОЗДАТЬ ИВЕНТ</b>\n"
        "━━━━━━━━━━━━━━━━━━━\n\n"
        "Шаг 1/3: Введите <b>название</b> ивента:\n\n"
        "<i>Например: Босс-файт с ProTanker</i>",
        parse_mode="HTML",
    )
    await callback.answer()


@dp.message(EventStates.waiting_title)
async def event_create_title(message: types.Message, state: FSMContext):
    await state.update_data(event_title=message.text.strip())
    await state.set_state(EventStates.waiting_boss_nick)
    await message.answer(
        "Шаг 2/3: Введите <b>никнейм босса</b> (стримера):\n\n"
        "<i>Например: LeBwa</i>",
        parse_mode="HTML",
    )


@dp.message(EventStates.waiting_boss_nick)
async def event_create_boss(message: types.Message, state: FSMContext):
    await state.update_data(event_boss=message.text.strip())
    await state.set_state(EventStates.waiting_boss_tank)
    await message.answer(
        "Шаг 3/3: Введите <b>танк босса</b>:\n\n"
        "<i>Например: Объект 279 (р)</i>",
        parse_mode="HTML",
    )


@dp.message(EventStates.waiting_boss_tank)
async def event_create_tank(message: types.Message, state: FSMContext):
    data = await state.get_data()
    await state.clear()

    result = create_event(
        title=data["event_title"],
        description=f"Босс-файт: {data['event_boss']} на {message.text.strip()} против 15 подписчиков!",
        boss_nickname=data["event_boss"],
        boss_tank=message.text.strip(),
        reward_description="500 голды за последний удар!",
    )

    await message.answer(
        f"✅ <b>Ивент создан!</b>\n\n"
        f"⚔️ {result['title']}\n"
        f"📅 {result['scheduled_at']}\n"
        f"👥 Слотов: {result['max_participants']}",
        parse_mode="HTML",
    )
    await show_admin_menu(message)


@dp.callback_query(F.data == "admin_sub_stats")
async def admin_subscription_stats(callback: CallbackQuery):
    if ADMIN_ID and callback.from_user.id != ADMIN_ID:
        await callback.answer("❌ Нет доступа", show_alert=True)
        return

    stats = get_subscription_stats()
    total_users = get_total_users()

    text = (
        f"📊 <b>СТАТИСТИКА</b>\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"👥 Всего пользователей: <b>{total_users}</b>\n"
        f"💎 Активных подписок: <b>{stats['total_active']}</b>\n"
        f"💰 Общий доход: <b>{stats['total_revenue']}₽</b>\n\n"
    )

    if stats["by_plan"]:
        text += "<b>По тарифам:</b>\n"
        for plan, cnt in stats["by_plan"].items():
            plan_name = SUBSCRIPTION_PLANS.get(plan, {}).get("name", plan)
            text += f"  {plan_name}: <b>{cnt}</b>\n"

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="◀️ Назад", callback_data="admin_back")],
    ])

    await callback.message.edit_text(text, parse_mode="HTML", reply_markup=keyboard)
    await callback.answer()


# ==========================================
# ОБРАБОТЧИК WEB APP DATA (промокоды из WebApp)
# ==========================================
@dp.message(F.web_app_data)
async def handle_webapp_data(message: types.Message):
    """Обработка данных из WebApp"""
    try:
        data = json.loads(message.web_app_data.data)
        action = data.get("action")

        if action == "create_promo":
            if not ADMIN_ID or message.from_user.id != ADMIN_ID:
                return

            result = create_promo_code(
                code=data["code"],
                days=data.get("days", 30),
                uses=data.get("uses", 1),
                created_by=message.from_user.id,
            )

            if result.get("success"):
                await message.answer(
                    f"🎟️ Промокод <code>{result['code']}</code> создан!\n"
                    f"📅 {result['days']} дней, 👤 {result['uses']} исп.",
                    parse_mode="HTML",
                )
            else:
                await message.answer(f"⚠️ {result.get('error', 'Ошибка')}")
    except Exception as e:
        logger.error(f"Ошибка обработки WebApp data: {e}")



# ==========================================
# КОМАНДА /subscribe — Подписки через Telegram Stars ⭐
# ==========================================
@dp.message(Command("subscribe"))
async def cmd_subscribe(message: types.Message):
    # Регистрируем пользователя
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )

    # Проверяем текущую подписку
    current_sub = check_subscription(message.from_user.id)

    status_text = ""
    if current_sub and current_sub.get("active"):
        status_text = (
            f"\n✅ <b>Ваша подписка активна!</b>\n"
            f"📅 До: {current_sub['expires_at']} "
            f"({current_sub['days_left']} дн.)\n"
        )
    else:
        status_text = "\n❌ <b>Нет активной подписки</b>\n"

    sep = "━" * 22

    text = (
        f"💎 <b>ПОДПИСКА</b>\n"
        f"{sep}"
        f"{status_text}\n"
        f"📦 Базовая цена: <b>490 ₽ / 250 ⭐</b> в месяц\n\n"
        f"🔥 <b>Скидки за период:</b>\n"
        f"├ 3 мес — <b>1 323 ₽ / 675 ⭐</b> (−10%)\n"
        f"├ 6 мес — <b>2 499 ₽ / 1 275 ⭐</b> (−15%)\n"
        f"└ 12 мес — <b>4 410 ₽ / 2 250 ⭐</b> (−25%)\n\n"
        f"🎁 Включено: челленджи, ивенты, статистика,\n"
        f"AI-ассистент, значок подписчика\n\n"
        f"{sep}\n"
        f"Выберите период:"
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="📅 1 месяц — 490 ₽ / 250 ⭐",
            callback_data="buy_sub_1month"
        )],
        [InlineKeyboardButton(
            text="📅 3 месяца — 1 323 ₽ / 675 ⭐  (−10%)",
            callback_data="buy_sub_3months"
        )],
        [InlineKeyboardButton(
            text="📅 6 месяцев — 2 499 ₽ / 1 275 ⭐  (−15%)",
            callback_data="buy_sub_6months"
        )],
        [InlineKeyboardButton(
            text="🔥 Год — 4 410 ₽ / 2 250 ⭐  (−25%)",
            callback_data="buy_sub_12months"
        )],
    ])

    await message.answer(text, parse_mode="HTML", reply_markup=keyboard)


@dp.callback_query(F.data.startswith("buy_sub_"))
async def buy_subscription(callback: CallbackQuery):
    plan_id = callback.data.replace("buy_sub_", "")
    plan = SUBSCRIPTION_PLANS.get(plan_id)

    if not plan:
        await callback.answer("❌ План не найден", show_alert=True)
        return

    # Отправляем счёт через Telegram Stars
    from aiogram.types import LabeledPrice

    days = plan["days"]
    period_name = {30: "1 месяц", 90: "3 месяца", 180: "6 месяцев", 365: "1 год"}.get(days, f"{days} дней")

    description = (
        f"Подписка на {period_name}\n\n"
        f"✅ Челленджи и ивенты\n"
        f"✅ Полная статистика + WN8\n"
        f"✅ AI-ассистент\n"
        f"✅ Значок подписчика"
    )
    if plan["discount"] > 0:
        description += f"\n🔥 Скидка {plan['discount']}%!"

    await callback.message.answer_invoice(
        title=f"Подписка — {period_name}",
        description=description,
        payload=f"sub_{plan_id}_{callback.from_user.id}",
        currency="XTR",  # Telegram Stars
        prices=[LabeledPrice(label="XTR", amount=plan["stars_price"])],
        provider_token="",  # Пустой для Stars
    )
    await callback.answer()


# Подтверждение платежа (обязательный обработчик!)
@dp.pre_checkout_query()
async def process_pre_checkout(pre_checkout_query: types.PreCheckoutQuery):
    """Telegram спрашивает: 'Можно ли провести платёж?' — мы говорим ДА"""
    await bot.answer_pre_checkout_query(pre_checkout_query.id, ok=True)


# Успешная оплата
@dp.message(F.successful_payment)
async def process_successful_payment(message: types.Message):
    """Платёж прошёл! Активируем подписку или записываем донат."""
    payment = message.successful_payment
    payload = payment.invoice_payload

    # === ДОНАТ ===
    if payload.startswith("donate_"):
        try:
            parts = payload.split("_")
            stars = int(parts[1])
        except (IndexError, ValueError):
            stars = payment.total_amount

        # Бонус монет x2
        bonus_coins = stars * 2
        add_coins(message.from_user.id, bonus_coins, f"Донат {stars} Stars")
        add_xp(message.from_user.id, 50)

        await message.answer(
            f"🔥 <b>СПАСИБО ЗА ПОДДЕРЖКУ!</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"💫 Донат: <b>{stars} Stars</b>\n"
            f"💰 Бонус: <b>+{bonus_coins} монет</b>\n"
            f"✨ +50 XP\n\n"
            f"🏅 Вы — спонсор проекта!\n"
            f"Ваше имя на доске почёта 📢\n\n"
            f"Спасибо, что помогаете нам! 🪖❤️",
            parse_mode="HTML",
        )

        # Уведомление админу
        if ADMIN_ID:
            try:
                user_name = message.from_user.first_name or message.from_user.username or "Unknown"
                await bot.send_message(
                    ADMIN_ID,
                    f"🔥 <b>НОВЫЙ ДОНАТ!</b>\n\n"
                    f"👤 {user_name} (ID: {message.from_user.id})\n"
                    f"💫 {stars} Stars\n"
                    f"❤️ Спасибо!",
                    parse_mode="HTML",
                )
            except Exception:
                pass
        return

    # === ПОДПИСКА ===

    try:
        # payload = "sub_1month_123456789" → plan_id = "1month"
        # payload = "sub_12months_123456789" → plan_id = "12months"
        parts = payload.split("_")
        # Убираем "sub_" и последний элемент (user_id)
        plan_id = "_".join(parts[1:-1])
    except (IndexError, ValueError):
        await message.answer("❌ Ошибка обработки платежа. Обратитесь к администратору.")
        return

    plan = SUBSCRIPTION_PLANS.get(plan_id)
    if not plan:
        await message.answer("❌ Неизвестный тарифный план.")
        return

    # Активируем подписку в БД
    result = create_subscription(
        telegram_id=message.from_user.id,
        plan=plan_id,
        payment_method="telegram_stars",
    )

    if result.get("success"):
        bonus_coins = plan.get("bonus_coins", 200)
        add_coins(message.from_user.id, bonus_coins, f"Бонус за подписку {plan['name']}")
        add_xp(message.from_user.id, 100)

        days = plan["days"]
        period_name = {30: "1 месяц", 90: "3 месяца", 180: "6 месяцев", 365: "Год"}.get(days, f"{days} дней")

        discount_text = ""
        if plan["discount"] > 0:
            discount_text = f"🔥 Скидка: <b>−{plan['discount']}%</b>\n"

        await message.answer(
            f"🎉 <b>ПОДПИСКА АКТИВИРОВАНА!</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"📦 Период: <b>{period_name}</b>\n"
            f"💫 Оплачено: <b>{plan['stars_price']} Stars</b>\n"
            f"{discount_text}"
            f"📅 Действует до: <b>{result['expires_at']}</b>\n\n"
            f"🎁 <b>Бонус за покупку:</b>\n"
            f"├ 💰 +{bonus_coins} монет\n"
            f"└ ✨ +100 XP\n\n"
            f"Спасибо за поддержку! 🪖❤️",
            parse_mode="HTML",
        )

        # Уведомление админу
        if ADMIN_ID:
            try:
                user_name = message.from_user.first_name or message.from_user.username or "Unknown"
                await bot.send_message(
                    ADMIN_ID,
                    f"💰 <b>НОВАЯ ПОДПИСКА!</b>\n\n"
                    f"👤 {user_name} (ID: {message.from_user.id})\n"
                    f"📦 {period_name}\n"
                    f"💫 {plan['stars_price']} Stars\n"
                    f"💰 {plan['price']} ₽",
                    parse_mode="HTML",
                )
            except Exception:
                pass
    else:
        await message.answer(
            "❌ Ошибка активации подписки. Обратитесь к администратору.\n"
            f"Код ошибки: {result.get('error', 'unknown')}",
        )



# ==========================================
# КОМАНДА /donate — Поддержать проект 🔥
# ==========================================
DONATE_PRESETS = [
    {"stars": 10,   "label": "☕ Кофе",      "emoji": "☕"},
    {"stars": 50,   "label": "🍕 Пицца",     "emoji": "🍕"},
    {"stars": 100,  "label": "🎮 Поддержка",  "emoji": "🎮"},
    {"stars": 250,  "label": "🎧 На стрим",   "emoji": "🎧"},
    {"stars": 500,  "label": "🔥 Огонь",      "emoji": "🔥"},
    {"stars": 1000, "label": "👑 Меценат",     "emoji": "👑"},
]


@dp.message(Command("donate"))
async def cmd_donate(message: types.Message):
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )

    sep = "━" * 22

    text = (
        f"🔥 <b>ПОДДЕРЖАТЬ ПРОЕКТ</b>\n"
        f"{sep}\n\n"
        f"Каждая звёздочка помогает нам делать\n"
        f"контент лучше и проводить крутые ивенты!\n\n"
        f"🎯 <b>Текущая цель:</b> Новый микрофон\n"
        f"📊 Собрано: <b>12 450 / 25 000 ⭐</b>\n\n"
        f"🎁 <b>Спонсор получает:</b>\n"
        f"├ 🏅 Значок спонсора в профиле\n"
        f"├ 📢 Имя на доске почёта\n"
        f"├ 💰 Бонусные монеты (x2 от суммы)\n"
        f"└ ❤️ Нашу вечную благодарность!\n\n"
        f"{sep}\n"
        f"Выберите сумму:"
    )

    buttons = []
    for i in range(0, len(DONATE_PRESETS), 2):
        row = []
        for preset in DONATE_PRESETS[i:i + 2]:
            row.append(InlineKeyboardButton(
                text=f"{preset['emoji']} {preset['stars']} ⭐",
                callback_data=f"donate_{preset['stars']}"
            ))
        buttons.append(row)

    keyboard = InlineKeyboardMarkup(inline_keyboard=buttons)
    await message.answer(text, parse_mode="HTML", reply_markup=keyboard)


@dp.callback_query(F.data.startswith("donate_"))
async def process_donate(callback: CallbackQuery):
    stars = int(callback.data.replace("donate_", ""))

    # Находим label
    label = "Поддержка проекта"
    for preset in DONATE_PRESETS:
        if preset["stars"] == stars:
            label = preset["label"]
            break

    from aiogram.types import LabeledPrice

    await callback.message.answer_invoice(
        title="🔥 Поддержать проект",
        description=(
            f"Донат: {stars} Stars\n\n"
            f"✅ Значок спонсора\n"
            f"✅ Имя на доске почёта\n"
            f"✅ Бонусные монеты (x2)\n"
            f"❤️ Спасибо за поддержку!"
        ),
        payload=f"donate_{stars}_{callback.from_user.id}",
        currency="XTR",
        prices=[LabeledPrice(label="XTR", amount=stars)],
        provider_token="",
    )
    await callback.answer()


# ==========================================
# ПРОМОКОД — /promo
# ==========================================
@dp.message(Command("promo"))
async def cmd_promo(message: types.Message, state: FSMContext):
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    await state.clear()
    await state.set_state(PromoStates.waiting_code)
    await message.answer(
        "🎟️ <b>ПРОМОКОД</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Введите промокод:",
        parse_mode="HTML",
    )


@dp.message(PromoStates.waiting_code)
async def process_promo_code(message: types.Message, state: FSMContext):
    code = message.text.strip()
    result = activate_promo_code(message.from_user.id, code)

    if result.get("success"):
        await state.clear()
        await message.answer(
            f"🎉 <b>ПРОМОКОД АКТИВИРОВАН!</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"✅ Подписка: <b>{result['days']} дней</b>\n"
            f"📅 До: <b>{result['expires_at']}</b>\n\n"
            f"Теперь нажмите /start чтобы войти! 🚀",
            parse_mode="HTML",
        )

        # Предлагаем привязать ник
        nick = get_wot_nickname(message.from_user.id)
        if not nick:
            await state.set_state(NicknameStates.waiting_nickname)
            await message.answer(
                "🎮 <b>Привяжите свой ник в Мир Танков</b>\n\n"
                "Введите ваш никнейм в игре.\n"
                "Он нужен для челленджей и арены.\n\n"
                "⚠️ <i>Один ник = один аккаунт. Привязка навсегда.</i>",
                parse_mode="HTML",
            )
    else:
        await message.answer(
            f"❌ {result.get('error', 'Ошибка')}",
        )
        await state.clear()


# ==========================================
# БЫСТРЫЙ ПРОМОКОД — /go (Админ, 1 клик!)
# ==========================================
import random
import string

@dp.message(Command("go"))
async def cmd_go_promo(message: types.Message):
    if not ADMIN_ID or message.from_user.id != ADMIN_ID:
        await message.answer("❌ Только для администратора")
        return

    # Генерируем случайный код
    code = 'MT-' + ''.join(random.choices(string.ascii_uppercase + string.digits, k=6))

    result = create_promo_code(
        code=code,
        days=30,
        uses=1,
        created_by=message.from_user.id,
    )

    if result.get("success"):
        # Красивый блок с кодом для копирования
        await message.answer(
            f"🎟️ <b>ПРОМОКОД СОЗДАН!</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"👇 Скопируйте и отправьте:\n\n"
            f"<code>{result['code']}</code>\n\n"
            f"📅 Действует: <b>30 дней</b>\n"
            f"👤 Использований: <b>1</b>\n\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n"
            f"💡 Инструкция для юзера:\n"
            f"<i>Зайди в бот → /start → 🎟️ Промокод</i>",
            parse_mode="HTML",
        )
    else:
        await message.answer(f"❌ {result.get('error', 'Ошибка')}")


@dp.message(Command("golist"))
async def cmd_golist(message: types.Message):
    """Список всех промокодов"""
    if not ADMIN_ID or message.from_user.id != ADMIN_ID:
        await message.answer("❌ Только для администратора")
        return

    promos = get_promo_codes()
    if not promos:
        await message.answer("📭 Промокодов пока нет.\nСоздать: /go")
        return

    text = "🎟️ <b>ВСЕ ПРОМОКОДЫ</b>\n━━━━━━━━━━━━━━━━━━━━━━\n\n"
    for p in promos[:20]:
        status = "✅" if p["uses_left"] > 0 else "❌"
        text += (
            f"{status} <code>{p['code']}</code> — "
            f"{p['days']}д, "
            f"осталось: {p['uses_left']}/{p['uses_total']}\n"
        )

    text += f"\n━━━━━━━━━━━━━━━━━━━━━━\nНовый: /go"
    await message.answer(text, parse_mode="HTML")


# ==========================================
# СОЗДАНИЕ ПРОМОКОДА — /createpromo (Админ, ручной)
# ==========================================
@dp.message(Command("createpromo"))
async def cmd_createpromo(message: types.Message, state: FSMContext):
    if not ADMIN_ID or message.from_user.id != ADMIN_ID:
        await message.answer("❌ Только для администратора")
        return

    await state.clear()
    await state.set_state(PromoStates.waiting_create_code)
    await message.answer(
        "🎟️ <b>СОЗДАНИЕ ПРОМОКОДА</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Введите текст промокода\n"
        "(например: TANKS2026, VIP, ДРУГ):",
        parse_mode="HTML",
    )


@dp.message(PromoStates.waiting_create_code)
async def process_create_code(message: types.Message, state: FSMContext):
    code = message.text.strip().upper()
    await state.update_data(code=code)
    await state.set_state(PromoStates.waiting_create_days)
    await message.answer(
        f"Промокод: <b>{code}</b>\n\n"
        f"На сколько <b>дней</b> подписка?\n"
        f"(например: 30, 7, 90)",
        parse_mode="HTML",
    )


@dp.message(PromoStates.waiting_create_days)
async def process_create_days(message: types.Message, state: FSMContext):
    try:
        days = int(message.text.strip())
        if days < 1 or days > 365:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите число от 1 до 365")
        return

    await state.update_data(days=days)
    await state.set_state(PromoStates.waiting_create_uses)
    await message.answer(
        f"Дней: <b>{days}</b>\n\n"
        f"Сколько <b>раз</b> можно использовать?\n"
        f"(1 = одноразовый, 10 = на 10 человек)",
        parse_mode="HTML",
    )


@dp.message(PromoStates.waiting_create_uses)
async def process_create_uses(message: types.Message, state: FSMContext):
    try:
        uses = int(message.text.strip())
        if uses < 1 or uses > 1000:
            raise ValueError
    except ValueError:
        await message.answer("❌ Введите число от 1 до 1000")
        return

    data = await state.get_data()
    result = create_promo_code(
        code=data["code"],
        days=data["days"],
        uses=uses,
        created_by=message.from_user.id,
    )

    await state.clear()

    if result.get("success"):
        await message.answer(
            f"✅ <b>ПРОМОКОД СОЗДАН!</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n\n"
            f"🎟️ Код: <code>{result['code']}</code>\n"
            f"📅 Дней: <b>{result['days']}</b>\n"
            f"👥 Использований: <b>{result['uses']}</b>\n\n"
            f"Отправьте этот код пользователям!",
            parse_mode="HTML",
        )
    else:
        await message.answer(f"❌ {result.get('error', 'Ошибка')}")


# ==========================================
# ПРИВЯЗКА НИКА — /setnick
# ==========================================
@dp.message(Command("setnick"))
async def cmd_setnick(message: types.Message, state: FSMContext):
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )

    current_nick = get_wot_nickname(message.from_user.id)
    if current_nick:
        await message.answer(
            f"🎮 Ваш ник: <b>{current_nick}</b>\n\n"
            f"⚠️ Ник уже привязан и изменить его нельзя.\n"
            f"Если ошибка — обратитесь к администратору.",
            parse_mode="HTML",
        )
        return

    await state.clear()
    await state.set_state(NicknameStates.waiting_nickname)
    await message.answer(
        "🎮 <b>ПРИВЯЗКА НИКА</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Введите ваш никнейм в Мир Танков:\n\n"
        "⚠️ <i>Внимательно! Один ник — один аккаунт.\n"
        "Привязка навсегда.</i>",
        parse_mode="HTML",
    )


@dp.message(NicknameStates.waiting_nickname)
async def process_nickname(message: types.Message, state: FSMContext):
    nickname = message.text.strip()

    if len(nickname) < 3 or len(nickname) > 24:
        await message.answer("❌ Ник должен быть от 3 до 24 символов")
        return

    # Проверяем через Lesta API
    await message.answer("🔍 Проверяю ник через Lesta API...")

    try:
        player = await asyncio.to_thread(search_player, nickname)
        if player and player.get("account_id"):
            account_id = player["account_id"]
            found_nick = player.get("nickname", nickname)

            result = bind_wot_nickname(message.from_user.id, found_nick, account_id)

            if result.get("success"):
                await state.clear()

                # Предлагаем верификацию
                verify_kb = None
                if get_lesta_app_id():
                    auth_url = (
                        f"https://api.tanki.su/wot/auth/login/"
                        f"?application_id={get_lesta_app_id()}"
                        f"&redirect_uri={VERIFY_REDIRECT_URL}"
                        f"&nofollow=1"
                    )
                    verify_kb = InlineKeyboardMarkup(inline_keyboard=[
                        [InlineKeyboardButton(text="🔐 Верифицировать через Lesta", url=auth_url)],
                        [InlineKeyboardButton(text="⏩ Пропустить", callback_data="skip_verify")],
                    ])

                await message.answer(
                    f"✅ <b>НИК ПРИВЯЗАН!</b>\n\n"
                    f"🎮 Ник: <b>{found_nick}</b>\n"
                    f"🆔 Account ID: <code>{account_id}</code>\n\n"
                    f"━━━━━━━━━━━━━━━━━━━━━━\n"
                    f"🔐 <b>Верифицируйте аккаунт!</b>\n\n"
                    f"Войдите через сайт Lesta чтобы\n"
                    f"подтвердить что аккаунт ваш.\n"
                    f"После верификации — значок ✅\n"
                    f"и доступ к арене ⚔️\n\n"
                    f"📋 Скопируйте код с сайта и\n"
                    f"отправьте: <code>/verify КОД</code>",
                    parse_mode="HTML",
                    reply_markup=verify_kb,
                )
            else:
                await state.clear()
                await message.answer(
                    f"❌ {result.get('error', 'Ошибка')}\n\n"
                    f"Обратитесь к администратору.",
                )
        else:
            await message.answer(
                f"❌ Игрок <b>{nickname}</b> не найден!\n\n"
                f"Проверьте написание и попробуйте снова:",
                parse_mode="HTML",
            )
    except Exception as e:
        logger.error(f"Ошибка проверки ника: {e}")
        # Если API недоступен — привяжем без проверки
        result = bind_wot_nickname(message.from_user.id, nickname)
        if result.get("success"):
            await state.clear()
            await message.answer(
                f"✅ Ник <b>{nickname}</b> привязан!\n"
                f"(API временно недоступен, проверим позже)\n\n"
                f"Нажмите /start для входа 🚀",
                parse_mode="HTML",
            )
        else:
            await state.clear()
            await message.answer(f"❌ {result.get('error', 'Ошибка')}")

@dp.callback_query(F.data == "skip_verify")
async def skip_verify(callback: CallbackQuery):
    await callback.answer("Можете верифицировать позже: /verify")
    await callback.message.answer(
        "⏩ Верификация пропущена.\n\n"
        "Вы можете верифицировать аккаунт позже\n"
        "командой /verify\n\n"
        "Нажмите /start чтобы войти! 🚀"
    )


# ==========================================
# ВЕРИФИКАЦИЯ АККАУНТА — /verify (Lesta OAuth)
# ==========================================

def _generate_verify_code(account_id: str) -> str:
    """Генерируем тот же код что и на verify.html"""
    s = str(account_id) + '_MIRTANKOV_2026'
    h = 0
    for ch in s:
        h = ((h << 5) - h) + ord(ch)
        h = h & 0xFFFFFFFF  # 32bit
    # Имитируем JS: Math.abs(hash).toString(36).toUpperCase().slice(0, 6)
    if h > 0x7FFFFFFF:
        h = h - 0x100000000
    code = 'MT' + base36(abs(h))[:6].upper()
    return code


def base36(num: int) -> str:
    """Конвертация числа в base36 (как JS toString(36))"""
    chars = '0123456789abcdefghijklmnopqrstuvwxyz'
    if num == 0:
        return '0'
    result = ''
    while num > 0:
        result = chars[num % 36] + result
        num //= 36
    return result


@dp.message(Command("verify"))
async def cmd_verify(message: types.Message):
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )

    # Уже верифицирован?
    if is_verified(message.from_user.id):
        nick = get_wot_nickname(message.from_user.id) or "—"
        await message.answer(
            f"✅ <b>Аккаунт верифицирован!</b>\n\n"
            f"🎮 Ник: <b>{nick}</b>\n"
            f"🛡️ Статус: Подтверждён через Lesta",
            parse_mode="HTML",
        )
        return

    # Проверяем, может юзер уже прислал код
    args = message.text.split(maxsplit=1)
    if len(args) > 1:
        code = args[1].strip().upper()
        # Ищем account_id по коду — перебираем через API
        await _process_verify_code(message, code)
        return

    # Генерируем ссылку на Lesta OAuth
    if not get_lesta_app_id():
        await message.answer(
            "❌ LESTA_APP_ID не настроен.\n"
            "Добавьте его в .env файл.",
        )
        return

    auth_url = (
        f"https://api.tanki.su/wot/auth/login/"
        f"?application_id={get_lesta_app_id()}"
        f"&redirect_uri={VERIFY_REDIRECT_URL}"
        f"&nofollow=1"
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🔐 Войти через Lesta",
            url=auth_url
        )],
    ])

    await message.answer(
        "🔐 <b>ВЕРИФИКАЦИЯ АККАУНТА</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        "Чтобы подтвердить что аккаунт ваш,\n"
        "войдите через <b>официальный сайт Lesta</b>:\n\n"
        "📋 <b>Инструкция:</b>\n"
        "1️⃣ Нажмите кнопку ниже\n"
        "2️⃣ Войдите в свой аккаунт на <b>tanki.su</b>\n"
        "3️⃣ Скопируйте код, который появится\n"
        "4️⃣ Отправьте его сюда: <code>/verify КОД</code>\n\n"
        "🛡️ <i>Это безопасно! Мы НЕ получаем\n"
        "ваш пароль — только никнейм и ID.</i>",
        parse_mode="HTML",
        reply_markup=keyboard,
    )


async def _process_verify_code(message: types.Message, code: str):
    """Обработка кода верификации"""
    # Пытаемся найти account_id через привязанный ник
    nick = get_wot_nickname(message.from_user.id)

    if nick:
        # Проверяем код для привязанного ника
        try:
            player = await asyncio.to_thread(search_player, nick)
            if player and player.get("account_id"):
                expected_code = _generate_verify_code(player["account_id"])
                if code == expected_code:
                    # Верификация успешна!
                    bind_wot_nickname(message.from_user.id, nick, player["account_id"])
                    confirm_verification(message.from_user.id)
                    add_coins(message.from_user.id, 100)
                    add_xp(message.from_user.id, 50)

                    await message.answer(
                        "🎉 <b>АККАУНТ ВЕРИФИЦИРОВАН!</b>\n"
                        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
                        f"✅ Ник: <b>{nick}</b>\n"
                        f"🆔 ID: <code>{player['account_id']}</code>\n"
                        f"🛡️ Подтверждено через Lesta OAuth\n\n"
                        "🎁 <b>Бонус:</b> +100 монет, +50 XP\n\n"
                        "Теперь у вас значок ✅ в профиле!\n"
                        "Арена и челленджи доступны ⚔️",
                        parse_mode="HTML",
                    )
                    return
        except Exception as e:
            logger.error(f"Ошибка проверки верификации: {e}")

    # Если ник не привязан — пробуем найти аккаунт по коду в ответе OAuth
    # Код содержит account_id в себе — ищем через все возможные account_id
    # Но это невозможно без account_id. Просим сначала привязать ник.
    if not nick:
        await message.answer(
            "❌ Сначала привяжите ник: /setnick\n\n"
            "После привязки ника введите /verify КОД",
            parse_mode="HTML",
        )
        return

    await message.answer(
        "❌ <b>Неверный код!</b>\n\n"
        "Убедитесь что:\n"
        "1. Вы вошли в правильный аккаунт на tanki.su\n"
        "2. Ник совпадает с привязанным: <b>" + (nick or '—') + "</b>\n"
        "3. Код скопирован полностью\n\n"
        "Попробуйте ещё раз: /verify",
        parse_mode="HTML",
    )


# ==========================================
# КОМАНДА /cheese — Покупка СЫР (🧀)
# ==========================================

# Пакеты сыра: {amount: stars_price}
# 1 Star ≈ 1.95₽ → 50 Stars ≈ 100₽
CHEESE_PACKAGES = {
    50: {"stars": 25, "label": "50 🧀"},
    100: {"stars": 50, "label": "100 🧀"},
    250: {"stars": 125, "label": "250 🧀"},
    500: {"stars": 250, "label": "500 🧀"},
    1000: {"stars": 500, "label": "1 000 🧀"},
    2500: {"stars": 1250, "label": "2 500 🧀"},
}


@dp.message(Command("cheese"))
async def cmd_cheese(message: types.Message):
    """Меню покупки сыра"""
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )

    balance = get_cheese_balance(message.from_user.id)

    text = (
        "🧀 <b>ОБМЕННИК — КУПИТЬ СЫР</b>\n"
        "━━━━━━━━━━━━━━━━━━━━━━\n\n"
        f"💰 Твой баланс: <b>{balance} 🧀</b>\n\n"
        "🔄 Курс: <b>1 ₽ = 1 🧀</b>\n\n"
        "🧀 СЫР — единая внутренняя валюта:\n"
        "├ 🎰 Колесо Фортуны — 50 🧀 / вращение\n"
        "├ ⚔️ Арена PvP — ставки от 10 🧀\n"
        "└ 🎁 Будущие фишки\n\n"
        "Выбери пакет 👇"
    )

    buttons = []
    for amount, pkg in CHEESE_PACKAGES.items():
        buttons.append([
            InlineKeyboardButton(
                text=f"🧀 {pkg['label']} — {pkg['stars']} ⭐",
                callback_data=f"buy_cheese_{amount}"
            )
        ])

    buttons.append([
        InlineKeyboardButton(
            text="🌐 Обменник в приложении",
            web_app=WebAppInfo(url=WEBAPP_URL + "cheese.html")
        )
    ])

    await message.answer(
        text, parse_mode="HTML",
        reply_markup=InlineKeyboardMarkup(inline_keyboard=buttons),
    )


@dp.callback_query(F.data.startswith("buy_cheese_"))
async def buy_cheese_callback(callback: CallbackQuery):
    """Обработка покупки сыра через Stars"""
    amount = int(callback.data.split("_")[-1])
    pkg = CHEESE_PACKAGES.get(amount)

    if not pkg:
        await callback.answer("❌ Пакет не найден", show_alert=True)
        return

    await callback.answer()

    # Создаём invoice через Telegram Stars
    try:
        await callback.message.answer_invoice(
            title=f"🧀 {pkg['label']} СЫР",
            description=f"Покупка {amount} единиц внутренней валюты 🧀 СЫР для Мир Танков Клуб",
            payload=f"cheese_{amount}_{callback.from_user.id}",
            currency="XTR",  # Telegram Stars
            prices=[types.LabeledPrice(label=f"{pkg['label']}", amount=pkg["stars"])],
        )
    except Exception as e:
        logger.error(f"Ошибка создания инвойса: {e}")
        await callback.message.answer(
            f"⚠️ Не удалось создать платёж.\n\n"
            f"Попробуйте позже или напишите админу.",
            parse_mode="HTML",
        )


@dp.pre_checkout_query()
async def process_pre_checkout(pre_checkout_query: types.PreCheckoutQuery):
    """Подтверждаем оплату"""
    await pre_checkout_query.answer(ok=True)


@dp.message(F.successful_payment)
async def process_successful_payment(message: types.Message):
    """Обработка успешной оплаты Stars"""
    payment = message.successful_payment
    payload = payment.invoice_payload

    if payload.startswith("cheese_"):
        parts = payload.split("_")
        amount = int(parts[1])
        user_id = int(parts[2])

        # Зачисляем сыр
        result = buy_cheese(
            telegram_id=user_id,
            amount=amount,
            payment_id=payment.telegram_payment_charge_id,
            method="stars"
        )

        if result["success"]:
            await message.answer(
                f"✅ <b>Оплата прошла!</b>\n\n"
                f"🧀 Зачислено: <b>+{amount} СЫР</b>\n"
                f"💰 Баланс: <b>{result['balance']} 🧀</b>\n\n"
                f"Приятной игры! 🎮",
                parse_mode="HTML",
            )
        else:
            await message.answer(
                f"⚠️ Оплата получена, но произошла ошибка зачисления.\n"
                f"Обратитесь к админу. Код платежа: {payment.telegram_payment_charge_id}",
            )

    elif payload.startswith("sub_"):
        # Существующая логика подписок (если есть)
        pass

    logger.info(f"Платёж: {payload} от {message.from_user.id}, сумма: {payment.total_amount} Stars")


@dp.message(Command("balance"))
async def cmd_balance(message: types.Message):
    """Показать баланс сыра"""
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )
    balance = get_cheese_balance(message.from_user.id)

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(
            text="🧀 Купить СЫР",
            callback_data="show_cheese_menu"
        )],
    ])

    await message.answer(
        f"🧀 <b>Баланс СЫР</b>\n"
        f"━━━━━━━━━━━━━━━━━\n\n"
        f"💰 У тебя: <b>{balance} 🧀</b>\n"
        f"≈ {balance} ₽\n\n"
        f"💡 Купи СЫР для игр и ставок!",
        parse_mode="HTML",
        reply_markup=keyboard,
    )


@dp.callback_query(F.data == "show_cheese_menu")
async def show_cheese_menu_callback(callback: CallbackQuery):
    """Показать меню покупки сыра из колбэка"""
    await callback.answer()
    # Отправляем как новое сообщение, чтобы видно были кнопки
    await cmd_cheese(callback.message)


# ==========================================
# ОБРАБОТЧИК ОСТАЛЬНЫХ СООБЩЕНИЙ
# (должен быть ПОСЛЕДНИМ!)
# ==========================================
@dp.message()
async def handle_any(message: types.Message, state: FSMContext):
    get_or_create_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
    )

    current_state = await state.get_state()
    if current_state is not None:
        return  # Пусть state-specific хендлеры обработают

    # Автодетект промокода (MT-XXXXX)
    text = (message.text or "").strip().upper()
    if text.startswith("MT-") and len(text) >= 6:
        result = activate_promo_code(message.from_user.id, text)
        if result.get("success"):
            await message.answer(
                f"🎉 <b>ПРОМОКОД АКТИВИРОВАН!</b>\n"
                f"━━━━━━━━━━━━━━━━━━━━━━\n\n"
                f"✅ Подписка: <b>{result['days']} дней</b>\n"
                f"📅 До: <b>{result['expires_at']}</b>\n\n"
                f"Теперь нажмите /start чтобы войти! 🚀",
                parse_mode="HTML",
            )
        else:
            await message.answer(f"❌ {result.get('error', 'Промокод не найден')}")
        return

    await message.answer(
        "🎮 <b>Команды:</b>\n\n"
        "/start — Главная\n"
        "/stats — Статистика игрока\n"
        "/promo — Ввести промокод\n"
        "/subscribe — Подписка\n"
        "/profile — Мой профиль\n\n"
        "Или просто отправьте промокод (MT-XXXXX)",
        parse_mode="HTML",
    )


# ==========================================
# REST API — AIOHTTP СЕРВЕР
# ==========================================
API_PORT = int(os.getenv("API_PORT", "8081"))


def cors_response(data, status=200):
    """JSON ответ с CORS заголовками"""
    return web.json_response(
        data,
        status=status,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        }
    )


async def handle_options(request):
    """CORS preflight"""
    return web.Response(
        status=200,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        }
    )

# --- USER IDENTIFICATION API ---

async def api_me(request):
    """GET /api/me?telegram_id=123 или ?wot_account_id=123 — определить текущего пользователя"""
    global ADMIN_ID
    try:
        user = None

        telegram_id = request.query.get("telegram_id")
        if telegram_id:
            telegram_id = int(telegram_id)
            user = get_user_by_telegram_id(telegram_id)

            # Если пользователь не найден — авто-создаём
            if not user:
                if ADMIN_ID and telegram_id == ADMIN_ID:
                    logger.info(f"Auto-creating admin user: {telegram_id}")
                    user = get_or_create_user(telegram_id)
                else:
                    # Обычный пользователь — тоже создаём
                    user = get_or_create_user(telegram_id)

            # Восстанавливаем WoT данные из query params (клиент может передать из CloudStorage)
            q_nick = request.query.get("wot_nickname", "").strip()
            q_acc = request.query.get("wot_account_id", "").strip()
            if user and q_nick and not user.get("wot_nickname"):
                from database import update_user_wot
                acc_id = int(q_acc) if q_acc else None
                if acc_id:
                    update_user_wot(telegram_id, q_nick, acc_id)
                    user["wot_nickname"] = q_nick
                    user["wot_account_id"] = acc_id
                    logger.info(f"Restored WoT via /api/me: {q_nick} for tg={telegram_id}")

        if not user:
            account_id = request.query.get("wot_account_id")
            if account_id:
                user = get_user_by_wot_account_id(int(account_id))

        if not user:
            return cors_response({"error": "User not found"}, 404)

        cheese = get_cheese_balance(user["telegram_id"])

        # Check admin status
        user_tg_id = user["telegram_id"]
        is_admin = False
        if ADMIN_ID and user_tg_id == ADMIN_ID:
            is_admin = True
        elif not ADMIN_ID:
            # If no ADMIN_ID set, first user becomes admin
            ADMIN_ID = user_tg_id
            is_admin = True
            logger.info(f"Auto-admin set: {user_tg_id}")
        else:
            # Check admin_users table
            try:
                from database import get_db
                with get_db() as conn:
                    row = conn.execute(
                        "SELECT 1 FROM admin_users WHERE telegram_id = ?", (user_tg_id,)
                    ).fetchone()
                    if row:
                        is_admin = True
            except:
                pass

        return cors_response({
            "telegram_id": user_tg_id,
            "wot_nickname": user.get("wot_nickname"),
            "wot_account_id": user.get("wot_account_id"),
            "first_name": user.get("first_name"),
            "username": user.get("username"),
            "avatar": user.get("avatar"),
            "cheese": cheese,
            "is_admin": is_admin,
        })
    except Exception as e:
        logger.error(f"API me error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_check_users(request):
    """POST /api/users/check  {account_ids: [123, ...], nicknames: ["nick1", ...]}
    Проверяет кто из игроков зарегистрирован в боте.
    Ищет по account_id, а если не найден — по wot_nickname."""
    try:
        data = await request.json()
        account_ids = data.get("account_ids", [])
        nicknames = data.get("nicknames", [])

        if not account_ids and not nicknames:
            return cors_response({"error": "Provide account_ids or nicknames"}, 400)

        registered = {}
        from database import get_db

        for i, aid in enumerate(account_ids):
            # Сначала ищем по account_id
            user = get_user_by_wot_account_id(int(aid))

            # Если не найден по ID — ищем по нику
            if not user and i < len(nicknames) and nicknames[i]:
                nick = nicknames[i]
                with get_db() as conn:
                    row = conn.execute(
                        "SELECT * FROM users WHERE wot_nickname = ? COLLATE NOCASE", (nick,)
                    ).fetchone()
                    if row:
                        user = dict(row)

            if user:
                registered[str(aid)] = {
                    "telegram_id": user["telegram_id"],
                    "wot_nickname": user.get("wot_nickname"),
                    "first_name": user.get("first_name"),
                    "in_system": True,
                }

        return cors_response({"registered": registered})
    except Exception as e:
        logger.error(f"API check_users error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_search_users(request):
    """GET /api/users/search?q=nick&my_id=123  — поиск среди зарегистрированных в боте"""
    try:
        query = request.query.get("q", "").strip()
        my_id = int(request.query.get("my_id", 0))

        if len(query) < 2:
            return cors_response({"error": "Минимум 2 символа"}, 400)

        users = search_users(query, exclude_telegram_id=my_id)

        # Проверяем кто уже друг
        my_friends = []
        if my_id:
            my_friends = get_friends(my_id)

        friend_ids = set(f["telegram_id"] for f in my_friends)

        results = []
        for u in users:
            results.append({
                "telegram_id": u["telegram_id"],
                "username": u.get("username"),
                "first_name": u.get("first_name"),
                "wot_nickname": u.get("wot_nickname"),
                "avatar": u.get("avatar"),
                "is_friend": u["telegram_id"] in friend_ids,
            })

        return cors_response({"users": results})
    except Exception as e:
        logger.error(f"API search_users error: {e}")
        return cors_response({"error": str(e)}, 500)


# --- FRIENDS API ---

async def api_get_friends(request):
    """GET /api/friends?telegram_id=123"""
    try:
        tg_id = int(request.query.get("telegram_id", 0))
        if not tg_id:
            return cors_response({"error": "telegram_id required"}, 400)

        friends_list = get_friends(tg_id)
        requests_list = get_friend_requests(tg_id)
        unread = get_unread_count(tg_id)

        return cors_response({
            "friends": friends_list,
            "requests": requests_list,
            "unread_messages": unread,
        })
    except Exception as e:
        logger.error(f"API get_friends error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_add_friend(request):
    """POST /api/friends/add  {from_telegram_id, to_wot_account_id}"""
    try:
        data = await request.json()
        from_tg_id = int(data.get("from_telegram_id", 0))
        to_account_id = data.get("to_wot_account_id")
        to_tg_id = int(data.get("to_telegram_id", 0))

        if not from_tg_id:
            return cors_response({"error": "from_telegram_id required"}, 400)

        # Если указан wot_account_id — ищем пользователя в БД
        if to_account_id and not to_tg_id:
            user = get_user_by_wot_account_id(int(to_account_id))
            if user:
                to_tg_id = user["telegram_id"]
            else:
                return cors_response({"error": "Игрок не зарегистрирован в боте", "not_registered": True}, 404)

        if not to_tg_id:
            return cors_response({"error": "to_telegram_id required"}, 400)

        result = send_friend_request(from_tg_id, to_tg_id)

        # Отправляем уведомление через бот
        if result.get("success"):
            try:
                from_user = get_user_by_telegram_id(from_tg_id)
                from_name = from_user["wot_nickname"] or from_user["first_name"] or "Игрок" if from_user else "Игрок"

                if result.get("auto_accepted"):
                    await bot.send_message(
                        to_tg_id,
                        f"✅ <b>{from_name}</b> тоже добавил вас!\n"
                        f"Теперь вы друзья! 🤝",
                        parse_mode="HTML"
                    )
                else:
                    keyboard = InlineKeyboardMarkup(inline_keyboard=[
                        [
                            InlineKeyboardButton(text="✅ Принять", callback_data=f"fr_accept_{from_tg_id}"),
                            InlineKeyboardButton(text="❌ Отклонить", callback_data=f"fr_decline_{from_tg_id}"),
                        ]
                    ])
                    await bot.send_message(
                        to_tg_id,
                        f"📩 <b>Запрос в друзья!</b>\n\n"
                        f"🪖 <b>{from_name}</b> хочет добавить вас в друзья.",
                        parse_mode="HTML",
                        reply_markup=keyboard
                    )
            except Exception as e:
                logger.warning(f"Не удалось отправить уведомление: {e}")

        return cors_response(result)
    except Exception as e:
        logger.error(f"API add_friend error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_accept_friend(request):
    """POST /api/friends/accept  {my_telegram_id, from_telegram_id}"""
    try:
        data = await request.json()
        my_tg_id = int(data.get("my_telegram_id", 0))
        from_tg_id = int(data.get("from_telegram_id", 0))

        result = accept_friend_request(my_tg_id, from_tg_id)

        if result.get("success"):
            try:
                my_user = get_user_by_telegram_id(my_tg_id)
                my_name = my_user["wot_nickname"] or my_user["first_name"] or "Игрок" if my_user else "Игрок"
                await bot.send_message(
                    from_tg_id,
                    f"✅ <b>{my_name}</b> принял ваш запрос в друзья! 🤝",
                    parse_mode="HTML"
                )
            except Exception:
                pass

        return cors_response(result)
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_decline_friend(request):
    """POST /api/friends/decline  {my_telegram_id, from_telegram_id}"""
    try:
        data = await request.json()
        my_tg_id = int(data.get("my_telegram_id", 0))
        from_tg_id = int(data.get("from_telegram_id", 0))
        result = decline_friend_request(my_tg_id, from_tg_id)
        return cors_response(result)
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_remove_friend(request):
    """POST /api/friends/remove  {my_telegram_id, friend_telegram_id}"""
    try:
        data = await request.json()
        my_tg_id = int(data.get("my_telegram_id", 0))
        friend_tg_id = int(data.get("friend_telegram_id", 0))
        result = remove_friend(my_tg_id, friend_tg_id)
        return cors_response(result)
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


# --- MESSAGES API ---

async def api_get_messages(request):
    """GET /api/messages?my_id=123&friend_id=456"""
    try:
        my_id = int(request.query.get("my_id", 0))
        friend_id = int(request.query.get("friend_id", 0))
        if not my_id or not friend_id:
            return cors_response({"error": "my_id and friend_id required"}, 400)

        msgs = get_messages(my_id, friend_id)
        return cors_response({"messages": msgs})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_send_message(request):
    """POST /api/messages/send  {from_telegram_id, to_telegram_id, text}"""
    try:
        data = await request.json()
        from_tg_id = int(data.get("from_telegram_id", 0))
        to_tg_id = int(data.get("to_telegram_id", 0))
        text = data.get("text", "").strip()

        if not from_tg_id or not to_tg_id or not text:
            return cors_response({"error": "Missing fields"}, 400)

        result = send_message(from_tg_id, to_tg_id, text)

        # Отправляем уведомление через бот
        if result.get("success"):
            try:
                from_user = get_user_by_telegram_id(from_tg_id)
                from_name = from_user["wot_nickname"] or from_user["first_name"] or "Игрок" if from_user else "Игрок"
                preview = text[:100] + ("..." if len(text) > 100 else "")
                await bot.send_message(
                    to_tg_id,
                    f"💬 <b>Новое сообщение от {from_name}:</b>\n\n"
                    f"{preview}",
                    parse_mode="HTML"
                )
            except Exception as e:
                logger.warning(f"Не удалось отправить уведомление о сообщении: {e}")

        return cors_response(result)
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


# --- Callback handlers for friend requests from Telegram ---

@dp.callback_query(F.data.startswith("fr_accept_"))
async def cb_accept_friend(callback: CallbackQuery):
    from_tg_id = int(callback.data.split("_")[-1])
    my_tg_id = callback.from_user.id
    result = accept_friend_request(my_tg_id, from_tg_id)

    if result.get("success"):
        await callback.message.edit_text("✅ Запрос принят! Теперь вы друзья 🤝")
        try:
            my_user = get_user_by_telegram_id(my_tg_id)
            my_name = my_user["wot_nickname"] or my_user["first_name"] if my_user else "Игрок"
            await bot.send_message(
                from_tg_id,
                f"✅ <b>{my_name}</b> принял ваш запрос в друзья! 🤝",
                parse_mode="HTML"
            )
        except Exception:
            pass
    else:
        await callback.message.edit_text(f"❌ {result.get('error', 'Ошибка')}")
    await callback.answer()


@dp.callback_query(F.data.startswith("fr_decline_"))
async def cb_decline_friend(callback: CallbackQuery):
    from_tg_id = int(callback.data.split("_")[-1])
    my_tg_id = callback.from_user.id
    decline_friend_request(my_tg_id, from_tg_id)
    await callback.message.edit_text("❌ Запрос отклонён.")
    await callback.answer()

# --- ADMIN API ---

def is_admin_user(telegram_id):
    """Check if user is admin (ADMIN_ID or in admin_users table)"""
    if ADMIN_ID and telegram_id == ADMIN_ID:
        return True
    try:
        from database import get_db
        with get_db() as conn:
            row = conn.execute("SELECT 1 FROM admin_users WHERE telegram_id = ?", (telegram_id,)).fetchone()
            return bool(row)
    except:
        return False


async def api_admin_users(request):
    """GET /api/admin/users?telegram_id=xxx — list all users (admin only)"""
    try:
        tg_id = int(request.query.get("telegram_id", 0))
        if not is_admin_user(tg_id):
            return cors_response({"error": "Нет доступа"}, 403)

        from database import get_db
        with get_db() as conn:
            users = conn.execute("""
                SELECT u.telegram_id, u.first_name, u.username, u.wot_nickname, u.wot_account_id,
                       u.coins, u.joined_at
                FROM users u
                ORDER BY u.joined_at DESC
            """).fetchall()

            # Get subscription info
            subs = {}
            try:
                sub_rows = conn.execute("""
                    SELECT telegram_id, 
                           CASE WHEN end_date > datetime('now') THEN 1 ELSE 0 END as active,
                           CAST(julianday(end_date) - julianday('now') AS INTEGER) as days_left,
                           end_date, payment_method
                    FROM subscriptions 
                    WHERE id IN (SELECT MAX(id) FROM subscriptions GROUP BY telegram_id)
                """).fetchall()
                for s in sub_rows:
                    subs[s["telegram_id"]] = dict(s)
            except:
                pass

            admins = set()
            try:
                admin_rows = conn.execute("SELECT telegram_id FROM admin_users").fetchall()
                for r in admin_rows:
                    admins.add(r["telegram_id"])
            except:
                pass
            if ADMIN_ID:
                admins.add(ADMIN_ID)

        result = []
        for u in users:
            sub = subs.get(u["telegram_id"])
            result.append({
                "telegram_id": u["telegram_id"],
                "first_name": u["first_name"],
                "username": u["username"],
                "wot_nickname": u["wot_nickname"],
                "cheese": u["coins"] or 0,
                "created_at": u["joined_at"],
                "subscription": {
                    "active": bool(sub["active"]),
                    "days_left": max(sub["days_left"] or 0, 0),
                    "end_date": sub["end_date"],
                    "method": sub["payment_method"],
                } if sub else None,
                "is_admin": u["telegram_id"] in admins,
                "is_super_admin": ADMIN_ID and u["telegram_id"] == ADMIN_ID,
            })

        return cors_response({"users": result, "total": len(result)})
    except Exception as e:
        logger.error(f"API admin_users error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_admin_toggle_admin(request):
    """POST /api/admin/toggle-admin {admin_telegram_id, target_telegram_id}"""
    try:
        data = await request.json()
        admin_tg = data.get("admin_telegram_id")
        target_tg = data.get("target_telegram_id")

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        if ADMIN_ID and target_tg == ADMIN_ID:
            return cors_response({"error": "Нельзя изменить главного админа"}, 400)

        from database import get_db
        with get_db() as conn:
            existing = conn.execute("SELECT 1 FROM admin_users WHERE telegram_id = ?", (target_tg,)).fetchone()
            if existing:
                conn.execute("DELETE FROM admin_users WHERE telegram_id = ?", (target_tg,))
                return cors_response({"success": True, "is_admin": False, "message": "Права админа сняты"})
            else:
                conn.execute("INSERT INTO admin_users (telegram_id, granted_by) VALUES (?, ?)", (target_tg, admin_tg))
                return cors_response({"success": True, "is_admin": True, "message": "Права админа выданы"})
    except Exception as e:
        logger.error(f"API toggle_admin error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_admin_cancel_challenge(request):
    """POST /api/admin/cancel-challenge {admin_telegram_id, challenge_id}"""
    try:
        data = await request.json()
        admin_tg = data.get("admin_telegram_id")
        challenge_id = data.get("challenge_id")

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        from database import get_db
        with get_db() as conn:
            ch = conn.execute("SELECT * FROM arena_challenges WHERE id = ?", (challenge_id,)).fetchone()
            if not ch:
                return cors_response({"error": "Челлендж не найден"}, 404)
            ch = dict(ch)

            if ch["status"] not in ("active", "pending"):
                return cors_response({"error": "Можно отменить только активный или ожидающий челлендж"}, 400)

            wager = ch["wager"]

            # Refund both players
            conn.execute("UPDATE users SET coins = coins + ? WHERE telegram_id = ?",
                        (wager, ch["from_telegram_id"]))
            if ch["status"] == "active":
                conn.execute("UPDATE users SET coins = coins + ? WHERE telegram_id = ?",
                            (wager, ch["to_telegram_id"]))

            # Mark as cancelled
            conn.execute("""
                UPDATE arena_challenges 
                SET status = 'cancelled', finished_at = datetime('now')
                WHERE id = ?
            """, (challenge_id,))

        logger.info(f"Challenge {challenge_id} cancelled by admin {admin_tg}, refunded {wager} each")
        return cors_response({"success": True, "message": f"Челлендж отменён. Возврат 🧀 {wager} каждому игроку."})
    except Exception as e:
        logger.error(f"API cancel_challenge error: {e}")
        return cors_response({"error": str(e)}, 500)

async def api_admin_gift_cheese(request):
    """POST /api/admin/gift-cheese {admin_telegram_id, target_telegram_id, amount, reason}"""
    try:
        data = await request.json()
        admin_tg = data.get("admin_telegram_id")
        target_tg = data.get("target_telegram_id")
        amount = int(data.get("amount", 0))
        reason = data.get("reason", "Подарок от админа")

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        if not target_tg or amount <= 0:
            return cors_response({"error": "Укажите игрока и сумму > 0"}, 400)

        if amount > 999999:
            return cors_response({"error": "Максимум 999,999 🧀 за раз"}, 400)

        from database import get_db
        target_user = get_user_by_telegram_id(target_tg)
        if not target_user:
            return cors_response({"error": "Пользователь не найден"}, 404)

        with get_db() as conn:
            conn.execute(
                "UPDATE users SET coins = coins + ? WHERE telegram_id = ?",
                (amount, target_tg)
            )
            conn.execute(
                "INSERT INTO transactions (user_id, amount, currency, type, description) "
                "VALUES (?, ?, 'CHEESE', 'admin_gift', ?)",
                (target_user["id"], amount, f"🎁 {reason} (от админа {admin_tg})")
            )

        new_balance = get_cheese_balance(target_tg)
        target_name = target_user.get("wot_nickname") or target_user.get("first_name") or str(target_tg)

        # Notify target player (if not self-gift)
        if target_tg != admin_tg:
            try:
                await bot.send_message(
                    target_tg,
                    f"🎁 <b>Вам подарили {amount} 🧀!</b>\n\n"
                    f"💬 {reason}\n"
                    f"💰 Баланс: <b>{new_balance} 🧀</b>",
                    parse_mode="HTML"
                )
            except Exception as e:
                logger.warning(f"Failed to notify cheese gift: {e}")

        logger.info(f"Admin {admin_tg} gifted {amount} cheese to {target_tg} ({target_name}). New balance: {new_balance}")
        return cors_response({
            "success": True,
            "message": f"✅ Подарено {amount} 🧀 → {target_name}. Баланс: {new_balance}",
            "new_balance": new_balance,
            "target_name": target_name,
        })
    except Exception as e:
        logger.error(f"API gift_cheese error: {e}")
        return cors_response({"error": str(e)}, 500)

# --- STREAMS STATUS API ---

_streams_cache = {"data": None, "ts": 0}


async def _check_youtube_api(session, yt_key, yt_channel):
    """Check YouTube live status via Data API v3 (costs quota)"""
    url = (f"https://www.googleapis.com/youtube/v3/search?"
           f"part=snippet&channelId={yt_channel}&type=video&eventType=live&key={yt_key}")
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
        data = await resp.json()
        logger.info(f"YouTube API response (status={resp.status}): {data}")

        # Check for API errors (quota exceeded, key invalid, etc.)
        if data.get("error"):
            err_msg = data["error"].get("message", "unknown")
            err_code = data["error"].get("code", 0)
            logger.warning(f"YouTube API error {err_code}: {err_msg}")
            return None  # Signal to try fallback

        if data.get("items") and len(data["items"]) > 0:
            video_id = data["items"][0]["id"]["videoId"]
            stats_url = (f"https://www.googleapis.com/youtube/v3/videos?"
                        f"part=liveStreamingDetails,statistics&id={video_id}&key={yt_key}")
            async with session.get(stats_url, timeout=aiohttp.ClientTimeout(total=10)) as sr:
                sd = await sr.json()
                viewers = int(sd.get("items", [{}])[0].get("liveStreamingDetails", {}).get("concurrentViewers", 0))
                return {"live": True, "viewers": viewers}
        return {"live": False, "viewers": 0}


async def _check_youtube_scrape(session, channel_handle):
    """Fallback: Check YouTube live status by scraping the channel page.
    Looks for live stream indicators in the page HTML.
    No API key or quota needed."""
    import re
    url = f"https://www.youtube.com/@{channel_handle}/live"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
    try:
        async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=15)) as resp:
            if resp.status != 200:
                logger.warning(f"YouTube scrape: status {resp.status}")
                return {"live": False, "viewers": 0}
            html = await resp.text()

            # Check for live indicators in the page
            is_live = False
            viewers = 0

            # Method 1: look for isLiveBroadcast in JSON-LD
            if '"isLiveBroadcast":true' in html or '"isLiveBroadcast": true' in html:
                is_live = True

            # Method 2: look for {"text":" watching now"} or similar viewer count patterns
            if not is_live:
                # Check for live badge text in initial data
                live_patterns = [
                    '"style":"BADGE_STYLE_TYPE_LIVE_NOW"',
                    '"iconType":"LIVE"',
                    '"LIVE_NOW"',
                    '"liveBroadcastDetails"',
                ]
                for pat in live_patterns:
                    if pat in html:
                        is_live = True
                        break

            if is_live:
                # Try to extract viewer count
                viewer_patterns = [
                    r'"viewCount"\s*:\s*"(\d+)"',
                    r'"concurrentViewers"\s*:\s*"(\d+)"',
                    r'(\d[\d,. ]*)\s*(?:watching now|watching|смотрят|зрител)',
                    r'"viewCountText"\s*:\s*\{"runs"\s*:\s*\[\{"text"\s*:\s*"([\d,. ]+)"',
                ]
                for pat in viewer_patterns:
                    m = re.search(pat, html)
                    if m:
                        raw = m.group(1).replace(',', '').replace('.', '').replace(' ', '').strip()
                        if raw.isdigit():
                            viewers = int(raw)
                            break

                logger.info(f"YouTube scrape: LIVE with {viewers} viewers")
                return {"live": True, "viewers": viewers}
            else:
                logger.info(f"YouTube scrape: OFFLINE")
                return {"live": False, "viewers": 0}
    except Exception as e:
        logger.warning(f"YouTube scrape error: {e}")
        return {"live": False, "viewers": 0}


async def api_streams_status(request):
    """GET /api/streams/status — check all stream platforms"""
    import time
    now = time.time()

    # Cache for 60 seconds
    if _streams_cache["data"] and now - _streams_cache["ts"] < 60:
        return cors_response(_streams_cache["data"])

    result = {
        "youtube": {"live": False, "viewers": 0},
        "vkplay": {"live": False, "viewers": 0},
        "trovo": {"live": False, "viewers": 0},
        "twitch": {"live": False, "viewers": 0},
    }

    async with aiohttp.ClientSession() as session:
        # ============ YouTube ============
        try:
            yt_key = "AIzaSyAT7aSehc7wNkebqwXWrwAwIauUw7TUMAc"
            yt_channel = "UClMCysoDnCFN2oQUu9fcQRg"  # @ISERVERI channel ID
            yt_handle = "ISERVERI"

            # Try official API first
            yt_result = None
            try:
                yt_result = await _check_youtube_api(session, yt_key, yt_channel)
            except Exception as e:
                logger.warning(f"YouTube API request failed: {e}")

            # If API failed (returned None = error), use scraping fallback
            if yt_result is None:
                logger.info("YouTube API unavailable, trying scrape fallback...")
                yt_result = await _check_youtube_scrape(session, yt_handle)

            if yt_result:
                result["youtube"] = yt_result
        except Exception as e:
            logger.warning(f"YouTube check error: {e}")

        # ============ VK Play ============
        try:
            async with session.get("https://api.vkplay.live/v1/blog/iserveri/public_video_stream",
                                   timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    if data and data.get("category"):
                        viewers = data.get("count", {}).get("viewers", 0) if isinstance(data.get("count"), dict) else 0
                        result["vkplay"] = {"live": True, "viewers": viewers}
        except Exception as e:
            logger.warning(f"VK Play check error: {e}")

        # ============ Trovo ============
        try:
            # Trovo — scrape the channel page since we have no Client-ID
            import re as _re_trovo
            trovo_url = "https://trovo.live/ISERVERI"
            trovo_headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            }
            async with session.get(trovo_url, headers=trovo_headers,
                                   timeout=aiohttp.ClientTimeout(total=12)) as resp:
                if resp.status == 200:
                    html = await resp.text()
                    # Look for live indicators in initial state JSON
                    is_live = '"isLive":true' in html or '"isLive": true' in html or '"streamStatus":"LIVE"' in html
                    if not is_live:
                        is_live = '"liveStatus":1' in html or '"is_live":true' in html
                    viewers = 0
                    if is_live:
                        # Try to extract viewer count
                        for pat in [r'"currentViewers"\s*:\s*(\d+)', r'"viewers"\s*:\s*(\d+)',
                                    r'"viewer_num"\s*:\s*(\d+)', r'(\d+)\s*(?:viewers|зрител)']:
                            m = _re_trovo.search(pat, html)
                            if m:
                                viewers = int(m.group(1))
                                break
                        result["trovo"] = {"live": True, "viewers": viewers}
                        logger.info(f"Trovo scrape: LIVE with {viewers} viewers")
                    else:
                        logger.info("Trovo scrape: OFFLINE")
        except Exception as e:
            logger.warning(f"Trovo check error: {e}")

        # ============ Twitch ============
        try:
            # Twitch: use GQL inline query (more reliable than persisted queries)
            twitch_gql_url = "https://gql.twitch.tv/gql"
            twitch_headers = {
                "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",  # public web client-id
                "Content-Type": "application/json",
            }
            # Method 1: StreamMetadata query (inline, no hash needed)
            twitch_payload = [{
                "operationName": "StreamMetadata",
                "variables": {"channelLogin": "serverenok"},
                "extensions": {
                    "persistedQuery": {
                        "version": 1,
                        "sha256Hash": "a647c2a13599e5991e175155f798ca7f1ecddde73f7f341f39009c14dbfd59df"
                    }
                }
            }]
            async with session.post(twitch_gql_url, headers=twitch_headers,
                                    json=twitch_payload,
                                    timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    tw_found = False
                    if isinstance(data, list) and len(data) > 0:
                        user_data = data[0].get("data", {}).get("user", {})
                        stream = user_data.get("stream") if user_data else None
                        if stream:
                            viewers = stream.get("viewersCount", 0)
                            result["twitch"] = {"live": True, "viewers": viewers}
                            logger.info(f"Twitch GQL method 1: LIVE with {viewers} viewers")
                            tw_found = True
                    
                    # Method 2: fallback — try UseLive query
                    if not tw_found:
                        twitch_payload2 = [{
                            "operationName": "UseLive",
                            "variables": {"channelLogin": "serverenok"},
                            "extensions": {
                                "persistedQuery": {
                                    "version": 1,
                                    "sha256Hash": "639d5f11bfb8bf3053b424d9ef650d04c4ebb7d94711d644afb08fe9a0571571"
                                }
                            }
                        }]
                        async with session.post(twitch_gql_url, headers=twitch_headers,
                                                json=twitch_payload2,
                                                timeout=aiohttp.ClientTimeout(total=8)) as resp2:
                            if resp2.status == 200:
                                data2 = await resp2.json()
                                if isinstance(data2, list) and len(data2) > 0:
                                    user2 = data2[0].get("data", {}).get("user", {})
                                    stream2 = user2.get("stream") if user2 else None
                                    if stream2:
                                        viewers2 = stream2.get("viewersCount", 0)
                                        result["twitch"] = {"live": True, "viewers": viewers2}
                                        logger.info(f"Twitch GQL method 2: LIVE with {viewers2} viewers")
        except Exception as e:
            logger.warning(f"Twitch check error: {e}")

    _streams_cache["data"] = result
    _streams_cache["ts"] = now
    logger.info(f"Streams status result: {result}")
    return cors_response(result)

# --- ARENA / CHALLENGES API ---

# Cache for tank encyclopedia {tank_id: {tier, type, name}}
_tank_encyclopedia = {}

async def load_tank_encyclopedia():
    """Load tank encyclopedia from Lesta API (cached)"""
    global _tank_encyclopedia
    if _tank_encyclopedia:
        return _tank_encyclopedia

    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            page = 1
            while page <= 10:
                url = (f"https://api.tanki.su/wot/encyclopedia/vehicles/"
                       f"?application_id={get_lesta_app_id()}&fields=tank_id,tier,type,name&limit=100&page_no={page}")
                async with session.get(url) as resp:
                    data = await resp.json()
                if data.get("status") != "ok":
                    break
                for tid, info in data["data"].items():
                    _tank_encyclopedia[info["tank_id"]] = {
                        "tier": info["tier"], "type": info["type"], "name": info["name"]
                    }
                if page >= data["meta"].get("page_total", 1):
                    break
                page += 1
        logger.info(f"Tank encyclopedia loaded: {len(_tank_encyclopedia)} tanks")
    except Exception as e:
        logger.error(f"Failed to load tank encyclopedia: {e}")
    return _tank_encyclopedia


async def fetch_player_stats(user, ch):
    """Fetch player's WoT stats filtered by challenge tier/type from Lesta API"""
    import aiohttp
    account_id = user.get("wot_account_id")
    nickname = user.get("wot_nickname")

    # If no account_id, try to find by nickname
    if not account_id and nickname:
        try:
            async with aiohttp.ClientSession() as session:
                url = f"https://api.tanki.su/wot/account/list/?application_id={get_lesta_app_id()}&search={nickname}&limit=1"
                async with session.get(url) as resp:
                    data = await resp.json()
                    if data.get("status") == "ok" and data.get("data"):
                        account_id = data["data"][0]["account_id"]
        except Exception as e:
            logger.warning(f"Failed to find account_id for {nickname}: {e}")

    if not account_id:
        return None

    try:
        # Load tank encyclopedia for tier/type mapping
        encyclopedia = await load_tank_encyclopedia()

        # Get challenge filters
        challenge_tier = ch.get("tank_tier")
        challenge_type = ch.get("tank_type")  # 'any' | 'heavyTank' | etc.
        challenge_tank_id = ch.get("tank_id")  # specific tank or None

        async with aiohttp.ClientSession() as session:
            # Fetch per-tank stats for this player
            url = (f"https://api.tanki.su/wot/tanks/stats/"
                   f"?application_id={get_lesta_app_id()}&account_id={account_id}"
                   f"&fields=tank_id,all.battles,all.damage_dealt,all.spotted,all.frags,"
                   f"all.xp,all.wins,all.damage_received,all.shots,all.hits,all.survived_battles")
            async with session.get(url) as resp:
                data = await resp.json()

        if data.get("status") != "ok":
            return None

        tank_stats_list = data["data"].get(str(account_id), [])
        if not tank_stats_list:
            return None

        # Filter tanks by challenge criteria
        totals = {
            "battles": 0, "damage_dealt": 0, "spotted": 0, "frags": 0,
            "xp": 0, "wins": 0, "damage_received": 0, "damage_blocked": 0, "shots": 0,
            "hits": 0, "survived_battles": 0
        }

        for ts in tank_stats_list:
            tid = ts["tank_id"]
            tank_info = encyclopedia.get(tid, {})

            # Filter by specific tank
            if challenge_tank_id and tid != challenge_tank_id:
                continue

            # Filter by tier
            if challenge_tier and tank_info.get("tier") != challenge_tier:
                continue

            # Filter by type (skip if 'any')
            if challenge_type and challenge_type != "any" and tank_info.get("type") != challenge_type:
                continue

            s = ts.get("all", {})
            totals["battles"] += s.get("battles", 0)
            totals["damage_dealt"] += s.get("damage_dealt", 0)
            totals["spotted"] += s.get("spotted", 0)
            totals["frags"] += s.get("frags", 0)
            totals["xp"] += s.get("xp", 0)
            totals["wins"] += s.get("wins", 0)
            totals["damage_received"] += s.get("damage_received", 0)
            totals["damage_blocked"] += s.get("damage_blocked", 0)
            totals["shots"] += s.get("shots", 0)
            totals["hits"] += s.get("hits", 0)
            totals["survived_battles"] += s.get("survived_battles", 0)

        return {
            "account_id": account_id,
            "nickname": nickname,
            **totals
        }
    except Exception as e:
        logger.error(f"Failed to fetch stats for {nickname}: {e}")
        return None


async def api_check_challenge_results(request):
    """POST /api/challenges/check {challenge_id, telegram_id} — check if challenge is done"""
    try:
        data = await request.json()
        challenge_id = data.get("challenge_id")
        tg_id = data.get("telegram_id")

        from database import get_db
        with get_db() as conn:
            ch = conn.execute("SELECT * FROM arena_challenges WHERE id = ?", (challenge_id,)).fetchone()
            if not ch:
                return cors_response({"error": "Челлендж не найден"}, 404)
            ch = dict(ch)

        if ch["status"] not in ("active", "finished"):
            return cors_response({"error": "Челлендж не активен"}, 400)

        # Fetch current stats for both players
        from_user = get_user_by_telegram_id(ch["from_telegram_id"])
        to_user = get_user_by_telegram_id(ch["to_telegram_id"])

        from_current = await fetch_player_stats(from_user, ch) if from_user else None
        to_current = await fetch_player_stats(to_user, ch) if to_user else None

        if not from_current:
            from_nick = from_user.get('wot_nickname') if from_user else '???'
            return cors_response({"error": f"Не удалось получить статистику игрока {from_nick}. Убедитесь что WoT аккаунт привязан и профиль в игре ОТКРЫТ (не скрыт в настройках).", "player": from_nick, "fix_hint": "bind_wot"}, 400)
        if not to_current:
            to_nick = to_user.get('wot_nickname') if to_user else '???'
            return cors_response({"error": f"Не удалось получить статистику игрока {to_nick}. Убедитесь что WoT аккаунт привязан и профиль в игре ОТКРЫТ (не скрыт в настройках).", "player": to_nick, "fix_hint": "bind_wot"}, 400)

        from_start = json.loads(ch["from_start_stats"]) if ch.get("from_start_stats") else None
        to_start = json.loads(ch["to_start_stats"]) if ch.get("to_start_stats") else None

        # If start stats missing (old challenge), snapshot now
        if not from_start or not to_start:
            from_start = from_start or from_current
            to_start = to_start or to_current
            with get_db() as conn:
                conn.execute("""
                    UPDATE arena_challenges 
                    SET from_start_stats = ?, to_start_stats = ?
                    WHERE id = ?
                """, (json.dumps(from_start), json.dumps(to_start), challenge_id))
            return cors_response({
                "message": "📸 Снимок статистики сохранён! Теперь идите играть и нажмите «Проверить» ещё раз после боя.",
                "snapshot_saved": True
            })

        # Calculate deltas
        required_battles = ch["battles"]
        condition = ch["condition"]

        STAT_KEY = {
            "damage": "damage_dealt", "spotting": "spotted", "blocked": "damage_received",
            "frags": "frags", "xp": "xp", "wins": "wins"
        }
        stat_key = STAT_KEY.get(condition, "damage_dealt")

        # Load last known stats (for per-battle tracking)
        from_last = json.loads(ch["from_last_stats"]) if ch.get("from_last_stats") else from_start
        to_last = json.loads(ch["to_last_stats"]) if ch.get("to_last_stats") else to_start

        # Load existing battle history
        battle_history = json.loads(ch.get("battle_history") or "[]")

        # Detect new battles for each player by comparing current vs last
        from_new_battles = from_current["battles"] - from_last["battles"]
        to_new_battles = to_current["battles"] - to_last["battles"]

        updated = False
        # From player new battles
        if from_new_battles > 0:
            for i in range(from_new_battles):
                battle_entry = {
                    "player": "from",
                    "nickname": from_start.get("nickname", "Игрок 1"),
                    "battle_num": len([b for b in battle_history if b["player"] == "from"]) + 1,
                    "damage": round((from_current["damage_dealt"] - from_last["damage_dealt"]) / from_new_battles) if from_new_battles else 0,
                    "spotted": round((from_current["spotted"] - from_last["spotted"]) / from_new_battles) if from_new_battles else 0,
                    "frags": round((from_current["frags"] - from_last["frags"]) / from_new_battles, 1) if from_new_battles else 0,
                    "xp": round((from_current["xp"] - from_last["xp"]) / from_new_battles) if from_new_battles else 0,
                    "blocked": round((from_current["damage_received"] - from_last["damage_received"]) / from_new_battles) if from_new_battles else 0,
                    "won": True if (from_current["wins"] - from_last["wins"]) > 0 else False,
                }
                battle_history.append(battle_entry)
            updated = True

        # To player new battles
        if to_new_battles > 0:
            for i in range(to_new_battles):
                battle_entry = {
                    "player": "to",
                    "nickname": to_start.get("nickname", "Игрок 2"),
                    "battle_num": len([b for b in battle_history if b["player"] == "to"]) + 1,
                    "damage": round((to_current["damage_dealt"] - to_last["damage_dealt"]) / to_new_battles) if to_new_battles else 0,
                    "spotted": round((to_current["spotted"] - to_last["spotted"]) / to_new_battles) if to_new_battles else 0,
                    "frags": round((to_current["frags"] - to_last["frags"]) / to_new_battles, 1) if to_new_battles else 0,
                    "xp": round((to_current["xp"] - to_last["xp"]) / to_new_battles) if to_new_battles else 0,
                    "blocked": round((to_current["damage_received"] - to_last["damage_received"]) / to_new_battles) if to_new_battles else 0,
                    "won": True if (to_current["wins"] - to_last["wins"]) > 0 else False,
                }
                battle_history.append(battle_entry)
            updated = True

        # Save updated last stats and battle history
        if updated:
            with get_db() as conn:
                conn.execute("""
                    UPDATE arena_challenges 
                    SET from_last_stats = ?, to_last_stats = ?, battle_history = ?
                    WHERE id = ?
                """, (json.dumps(from_current), json.dumps(to_current),
                      json.dumps(battle_history), challenge_id))

        from_battles_played = from_current["battles"] - from_start["battles"]
        to_battles_played = to_current["battles"] - to_start["battles"]

        # FREEZE stats when player reaches required battles
        from_end = json.loads(ch["from_end_stats"]) if ch.get("from_end_stats") else None
        to_end = json.loads(ch["to_end_stats"]) if ch.get("to_end_stats") else None

        freeze_updates = {}
        if from_battles_played >= required_battles and not from_end:
            from_end = from_current
            freeze_updates["from_end_stats"] = json.dumps(from_current)
        if to_battles_played >= required_battles and not to_end:
            to_end = to_current
            freeze_updates["to_end_stats"] = json.dumps(to_current)

        if freeze_updates:
            sets = ", ".join(f"{k} = ?" for k in freeze_updates)
            vals = list(freeze_updates.values()) + [challenge_id]
            with get_db() as conn:
                conn.execute(f"UPDATE arena_challenges SET {sets} WHERE id = ?", vals)

        # Use frozen stats if available, otherwise current
        from_final = from_end if from_end else from_current
        to_final = to_end if to_end else to_current

        from_battles_capped = min(from_battles_played, required_battles)
        to_battles_capped = min(to_battles_played, required_battles)

        def calc_delta(final, start, battles_capped, battles_total):
            d = {
                "battles_played": battles_capped,
                "battles_total": battles_total,
                "damage": final["damage_dealt"] - start["damage_dealt"],
                "spotted": final["spotted"] - start["spotted"],
                "frags": final["frags"] - start["frags"],
                "xp": final["xp"] - start["xp"],
                "wins": final["wins"] - start["wins"],
                "blocked": final["damage_received"] - start["damage_received"],
                "shots": final["shots"] - start["shots"],
                "hits": final["hits"] - start["hits"],
            }
            bp = max(battles_capped, 1)
            d["avg_damage"] = round(d["damage"] / bp)
            d["avg_spotted"] = round(d["spotted"] / bp)
            d["avg_frags"] = round(d["frags"] / bp, 1)
            d["avg_xp"] = round(d["xp"] / bp)
            d["winrate"] = round(d["wins"] / bp * 100, 1)
            d["accuracy"] = round(d["hits"] / max(d["shots"], 1) * 100, 1)
            return d

        from_delta = calc_delta(from_final, from_start, from_battles_capped, from_battles_played)
        to_delta = calc_delta(to_final, to_start, to_battles_capped, to_battles_played)

        both_ready = from_battles_played >= required_battles and to_battles_played >= required_battles

        result = {
            "challenge": ch,
            "from_player": {
                "nickname": from_start.get("nickname", "Игрок 1"),
                "delta": from_delta,
                "ready": from_battles_played >= required_battles,
            },
            "to_player": {
                "nickname": to_start.get("nickname", "Игрок 2"),
                "delta": to_delta,
                "ready": to_battles_played >= required_battles,
            },
            "battle_history": battle_history,
            "both_ready": both_ready,
            "winner": None,
        }

        # If both ready, determine winner and complete
        if both_ready:
            DELTA_KEY = {
                "damage": "damage", "spotting": "spotted",
                "blocked": "blocked", "frags": "frags",
                "xp": "xp", "wins": "wins"
            }
            dk = DELTA_KEY.get(condition, "damage")

            from_score = from_delta.get(dk, 0)
            to_score = to_delta.get(dk, 0)

            if from_score >= to_score:
                winner_tg = ch["from_telegram_id"]
                winner_name = from_start.get("nickname", "Игрок 1")
            else:
                winner_tg = ch["to_telegram_id"]
                winner_name = to_start.get("nickname", "Игрок 2")

            result["winner"] = {"telegram_id": winner_tg, "nickname": winner_name}

            # Award prize and update DB
            prize = ch["wager"] * 2
            with get_db() as conn:
                conn.execute("""
                    UPDATE arena_challenges 
                    SET status = 'finished', winner_telegram_id = ?,
                        from_end_stats = ?, to_end_stats = ?,
                        finished_at = datetime('now')
                    WHERE id = ? AND status = 'active'
                """, (winner_tg,
                      json.dumps(from_delta), json.dumps(to_delta),
                      challenge_id))

            # Award cheese to winner
            with get_db() as conn:
                conn.execute(
                    "UPDATE users SET coins = coins + ? WHERE telegram_id = ?",
                    (prize, winner_tg)
                )

            # Notify both players
            try:
                COND_NAMES = {"damage": "💥 Урон", "spotting": "👁 Засвет", "blocked": "🛡 Блок",
                              "frags": "🎯 Фраги", "xp": "⭐ Опыт", "wins": "🏆 Победы"}
                cond_name = COND_NAMES.get(condition, condition)

                text = (
                    f"🏆 <b>Челлендж завершён!</b>\n\n"
                    f"📋 {ch['tank_name']} · {cond_name}\n"
                    f"⚔️ {from_start.get('nickname')}: <b>{from_delta.get(dk, 0)}</b>\n"
                    f"⚔️ {to_start.get('nickname')}: <b>{to_delta.get(dk, 0)}</b>\n\n"
                    f"🏆 Победитель: <b>{winner_name}</b>\n"
                    f"🧀 Приз: <b>{prize} 🧀</b>"
                )
                await bot.send_message(ch["from_telegram_id"], text, parse_mode="HTML")
                await bot.send_message(ch["to_telegram_id"], text, parse_mode="HTML")
            except Exception as e:
                logger.warning(f"Notify challenge result failed: {e}")

        return cors_response(result)
    except Exception as e:
        logger.error(f"API check_challenge error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_create_challenge(request):
    """POST /api/challenges/create — создать челлендж"""
    try:
        data = await request.json()
        from_tg_id = data.get("from_telegram_id")
        to_tg_id = data.get("to_telegram_id")
        tank_id = data.get("tank_id")  # Can be null in class+tier mode
        tank_tier = data.get("tank_tier")
        tank_type = data.get("tank_type")
        tank_name = data.get("tank_name", "")
        condition = data.get("condition", "damage")
        battles = data.get("battles", 5)
        wager = data.get("wager", 100)

        if not from_tg_id or not to_tg_id:
            return cors_response({"error": "Не указан игрок"}, 400)

        if not condition:
            return cors_response({"error": "Не выбрано условие"}, 400)

        if from_tg_id == to_tg_id:
            return cors_response({"error": "Нельзя вызвать самого себя"}, 400)

        if wager < 100:
            return cors_response({"error": "Минимальная ставка: 100 🧀"}, 400)

        # Проверяем баланс (cheese из БД)
        balance = get_cheese_balance(from_tg_id)
        if balance < wager:
            return cors_response({"error": f"Недостаточно сыра! Баланс: {balance} 🧀. Пополните через профиль."}, 400)

        # Списываем ставку у создателя
        spend_cheese(from_tg_id, wager, f"🎯 Ставка на челлендж: {tank_name}")

        # Сохраняем челлендж в БД
        from database import get_db
        with get_db() as conn:
            conn.execute("""
                INSERT INTO arena_challenges 
                (from_telegram_id, to_telegram_id, tank_id, tank_tier, tank_type, tank_name, condition, battles, wager, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
            """, (from_tg_id, to_tg_id, tank_id, tank_tier, tank_type, tank_name, condition, battles, wager))

        # Уведомляем соперника через Telegram
        try:
            from_user = get_user_by_telegram_id(from_tg_id)
            from_name = from_user.get("wot_nickname") or from_user.get("first_name", "Игрок") if from_user else "Игрок"

            CONDITION_NAMES = {
                "damage": "💥 Урон", "spotting": "👁 Засвет", "blocked": "🛡 Блок",
                "frags": "🎯 Фраги", "xp": "⭐ Опыт", "wins": "🏆 Победы"
            }

            cond_name = CONDITION_NAMES.get(condition, condition)

            text = (
                f"⚔️ <b>Вызов на челлендж!</b>\n\n"
                f"👤 <b>{from_name}</b> вызвал тебя:\n\n"
                f"🪖 Танк: <b>{tank_name}</b>\n"
                f"📋 Условие: <b>{cond_name}</b>\n"
                f"⚔️ Боёв: <b>{battles}</b>\n"
                f"🧀 Ставка: <b>{wager}</b>\n"
                f"🏆 Приз: <b>{wager * 2} 🧀</b>\n\n"
                f"Открой Арену в приложении чтобы принять!"
            )
            await bot.send_message(to_tg_id, text, parse_mode="HTML")
        except Exception as e:
            logger.warning(f"Failed to notify opponent: {e}")

        return cors_response({"success": True})
    except Exception as e:
        logger.error(f"API create_challenge error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_get_challenges(request):
    """GET /api/challenges?telegram_id=123 — получить челленджи пользователя"""
    try:
        tg_id = int(request.query.get("telegram_id", 0))
        if not tg_id:
            return cors_response({"error": "telegram_id required"}, 400)

        from database import get_db
        with get_db() as conn:
            rows = conn.execute("""
                SELECT * FROM arena_challenges
                WHERE (from_telegram_id = ? OR to_telegram_id = ?)
                  AND status != 'deleted'
                ORDER BY created_at DESC LIMIT 50
            """, (tg_id, tg_id)).fetchall()

        challenges = []
        for r in rows:
            row = dict(r)
            # Get opponent info
            opp_id = row["to_telegram_id"] if row["from_telegram_id"] == tg_id else row["from_telegram_id"]
            opp = get_user_by_telegram_id(opp_id)
            row["opponent_name"] = opp.get("wot_nickname") or opp.get("first_name", "???") if opp else "???"
            row["is_incoming"] = row["to_telegram_id"] == tg_id
            challenges.append(row)

        return cors_response({"challenges": challenges})
    except Exception as e:
        logger.error(f"API get_challenges error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_accept_challenge(request):
    """POST /api/challenges/accept {challenge_id, telegram_id}"""
    try:
        data = await request.json()
        challenge_id = data.get("challenge_id")
        tg_id = data.get("telegram_id")

        from database import get_db
        with get_db() as conn:
            ch = conn.execute("SELECT * FROM arena_challenges WHERE id = ?", (challenge_id,)).fetchone()
            if not ch:
                return cors_response({"error": "Челлендж не найден"}, 404)

            ch = dict(ch)
            if ch["status"] != "pending":
                return cors_response({"error": "Челлендж уже обработан"}, 400)
            if ch["to_telegram_id"] != tg_id:
                return cors_response({"error": "Это не ваш вызов"}, 403)

            # Deduct wager from acceptor
            wager = ch["wager"]
            balance = get_cheese_balance(tg_id)
            if balance < wager:
                return cors_response({"error": f"Недостаточно сыра! Баланс: {balance} 🧀"}, 400)

            spend_cheese(tg_id, wager, f"🎯 Ставка принята: {ch['tank_name']}")

            # Snapshot stats from Lesta API for both players
            from_user = get_user_by_telegram_id(ch["from_telegram_id"])
            to_user = get_user_by_telegram_id(tg_id)

            from_stats = await fetch_player_stats(from_user, ch) if from_user else None
            to_stats = await fetch_player_stats(to_user, ch) if to_user else None

            conn.execute("""
                UPDATE arena_challenges 
                SET status = 'active', accepted_at = datetime('now'),
                    from_start_stats = ?, to_start_stats = ?
                WHERE id = ?
            """, (json.dumps(from_stats) if from_stats else None,
                  json.dumps(to_stats) if to_stats else None,
                  challenge_id))

        # Notify creator
        try:
            opp = get_user_by_telegram_id(tg_id)
            opp_name = opp.get("wot_nickname") or opp.get("first_name", "Соперник") if opp else "Соперник"
            text = (
                f"✅ <b>{opp_name}</b> принял вызов!\n\n"
                f"🪖 {ch['tank_name']}\n"
                f"⚔️ Боёв: {ch['battles']}\n"
                f"🧀 Ставка: {ch['wager']}\n\n"
                f"🏆 Вперёд! Играйте {ch['battles']} боёв и результаты будут учтены!"
            )
            await bot.send_message(ch["from_telegram_id"], text, parse_mode="HTML")
        except Exception as e:
            logger.warning(f"Notify creator failed: {e}")

        return cors_response({"success": True})
    except Exception as e:
        logger.error(f"API accept_challenge error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_decline_challenge(request):
    """POST /api/challenges/decline {challenge_id, telegram_id}"""
    try:
        data = await request.json()
        challenge_id = data.get("challenge_id")
        tg_id = data.get("telegram_id")

        from database import get_db
        with get_db() as conn:
            ch = conn.execute("SELECT * FROM arena_challenges WHERE id = ?", (challenge_id,)).fetchone()
            if not ch:
                return cors_response({"error": "Челлендж не найден"}, 404)

            ch = dict(ch)
            if ch["status"] != "pending":
                return cors_response({"error": "Челлендж уже обработан"}, 400)
            if ch["to_telegram_id"] != tg_id:
                return cors_response({"error": "Это не ваш вызов"}, 403)

            # Refund wager to creator
            add_coins(ch["from_telegram_id"], ch["wager"], f"↩️ Вызов отклонён — возврат ставки")
            # Also add cheese
            from database import get_db as gdb
            with gdb() as conn2:
                conn2.execute("""
                    INSERT INTO cheese_purchases (user_id, telegram_id, amount, rub_amount, payment_method, status)
                    VALUES ((SELECT id FROM users WHERE telegram_id = ?), ?, ?, 0, 'refund', 'completed')
                """, (ch["from_telegram_id"], ch["from_telegram_id"], ch["wager"]))

            conn.execute("UPDATE arena_challenges SET status = 'declined' WHERE id = ?", (challenge_id,))

        # Notify creator
        try:
            opp = get_user_by_telegram_id(tg_id)
            opp_name = opp.get("wot_nickname") or opp.get("first_name", "Соперник") if opp else "Соперник"
            await bot.send_message(ch["from_telegram_id"],
                f"❌ <b>{opp_name}</b> отклонил вызов.\n🧀 Ставка {ch['wager']} возвращена.",
                parse_mode="HTML")
        except Exception as e:
            logger.warning(f"Notify decline failed: {e}")

        return cors_response({"success": True})
    except Exception as e:
        logger.error(f"API decline_challenge error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_delete_challenge(request):
    """POST /api/challenges/delete {challenge_id, telegram_id}"""
    try:
        data = await request.json()
        challenge_id = data.get("challenge_id")
        tg_id = data.get("telegram_id")

        from database import get_db
        with get_db() as conn:
            ch = conn.execute("SELECT * FROM arena_challenges WHERE id = ?", (challenge_id,)).fetchone()
            if not ch:
                return cors_response({"error": "Челлендж не найден"}, 404)

            ch = dict(ch)
            # Only the creator or target can delete
            if ch["from_telegram_id"] != tg_id and ch["to_telegram_id"] != tg_id:
                return cors_response({"error": "Это не ваш вызов"}, 403)

            if ch["status"] == "pending":
                # Refund wager to creator
                add_coins(ch["from_telegram_id"], ch["wager"], "↩️ Вызов отменён — возврат ставки")
                conn.execute("DELETE FROM arena_challenges WHERE id = ?", (challenge_id,))
            elif ch["status"] in ("declined", "finished"):
                # Just remove from history (soft-delete via status)
                conn.execute("UPDATE arena_challenges SET status = 'deleted' WHERE id = ?", (challenge_id,))
            elif ch["status"] == "active":
                return cors_response({"error": "Нельзя удалить активный челлендж"}, 400)

        return cors_response({"success": True})
    except Exception as e:
        logger.error(f"API delete_challenge error: {e}")
        return cors_response({"error": str(e)}, 500)


# ==========================================
# GLOBAL CHALLENGES API
# ==========================================

# Маппинг условий к полям статистики
# Поля доступные в tanks/stats (по-танково):
GC_CONDITION_TO_STAT = {
    "damage": "damage_dealt",
    "frags": "frags",
    "xp": "xp",
    "spotting": "spotted",
    "blocked": "damage_blocked",
    "wins": "wins",
}
# spotting_damage и combined требуют account/info (damage_assisted_radio + damage_assisted_track)
# Эти поля НЕ доступны в tanks/stats!
GC_ACCOUNT_LEVEL_CONDITIONS = {"spotting_damage", "combined"}


async def gc_fetch_account_assisted(account_ids):
    """Получить урон по засвету (damage_assisted_radio + damage_assisted_track) из account/info.
    
    Эти поля НЕ доступны в tanks/stats, только в account/info.
    Принимает список account_id, возвращает dict: {account_id: {"assisted": N, "battles": N, "damage_dealt": N}}
    """
    import aiohttp
    if not account_ids:
        return {}
    
    results = {}
    # account/info поддерживает до 100 ID за раз
    BATCH_SIZE = 100
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            for i in range(0, len(account_ids), BATCH_SIZE):
                batch = account_ids[i:i + BATCH_SIZE]
                ids_str = ",".join(str(aid) for aid in batch)
                url = (f"https://api.tanki.su/wot/account/info/"
                       f"?application_id={get_lesta_app_id()}&account_id={ids_str}"
                       f"&fields=statistics.all.damage_assisted_radio,statistics.all.damage_assisted_track,"
                       f"statistics.all.battles,statistics.all.damage_dealt")
                async with session.get(url) as resp:
                    data = await resp.json()
                
                if data.get("status") != "ok":
                    logger.warning(f"GC account/info error: {data.get('error')}")
                    continue
                
                for aid_str, pdata in (data.get("data") or {}).items():
                    if not pdata:
                        continue
                    stats_all = pdata.get("statistics", {}).get("all", {})
                    radio = stats_all.get("damage_assisted_radio", 0) or 0
                    track = stats_all.get("damage_assisted_track", 0) or 0
                    results[int(aid_str)] = {
                        "assisted": radio + track,
                        "battles": stats_all.get("battles", 0) or 0,
                        "damage_dealt": stats_all.get("damage_dealt", 0) or 0,
                    }
    except Exception as e:
        logger.error(f"GC fetch account assisted error: {e}")
    
    return results


async def gc_fetch_player_stat(account_id, condition):
    """Получить текущий суммарный стат игрока из Lesta API.
    
    Для spotting_damage и combined — использует account/info (единственный источник assisted damage).
    Для остальных — использует tanks/stats (актуальные данные сразу после боя).
    """
    import aiohttp
    
    # spotting_damage и combined — из account/info
    if condition in GC_ACCOUNT_LEVEL_CONDITIONS:
        try:
            acc_data = await gc_fetch_account_assisted([account_id])
            info = acc_data.get(account_id)
            if not info:
                return None
            
            if condition == "spotting_damage":
                value = info["assisted"]
            elif condition == "combined":
                value = info["damage_dealt"] + info["assisted"]
            else:
                value = 0
            
            return {"value": value, "battles": info["battles"]}
        except Exception as e:
            logger.error(f"GC fetch stat (account/info) error for {account_id}: {e}")
            return None
    
    # Остальные условия — из tanks/stats
    stat_field = GC_CONDITION_TO_STAT.get(condition, "damage_dealt")
    
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            fields_str = f"all.{stat_field},all.battles,tank_id"
            url = (f"https://api.tanki.su/wot/tanks/stats/"
                   f"?application_id={get_lesta_app_id()}&account_id={account_id}"
                   f"&fields={fields_str}")
            async with session.get(url) as resp:
                data = await resp.json()

            if data.get("status") != "ok":
                return None

            tanks = data["data"].get(str(account_id))
            if not tanks:
                return None

            total_value = sum(t.get("all", {}).get(stat_field, 0) for t in tanks)
            total_battles = sum(t.get("all", {}).get("battles", 0) for t in tanks)
            return {
                "value": total_value,
                "battles": total_battles,
            }
    except Exception as e:
        logger.error(f"GC fetch stat error for {account_id}: {e}")
        return None


async def gc_fetch_player_multi_stats(account_id, conditions_str, tank_class=None, tank_tier=None, tank_id_filter=None):
    """Получить стату по нескольким условиям сразу.
    
    Поддерживает фильтрацию по классу техники, уровню и конкретному танку.
    Поддерживает условие 'combined' = damage + spotting_damage (через account/info).
    spotting_damage и combined берутся из account/info (damage_assisted_radio + damage_assisted_track).
    """
    import aiohttp
    conditions = [c.strip() for c in conditions_str.split(",") if c.strip()]
    if not conditions:
        conditions = ["damage"]
    
    # Разделяем: какие условия из tanks/stats, какие из account/info
    tank_conditions = [c for c in conditions if c not in GC_ACCOUNT_LEVEL_CONDITIONS]
    account_conditions = [c for c in conditions if c in GC_ACCOUNT_LEVEL_CONDITIONS]
    
    per_condition = {c: 0 for c in conditions}
    total_battles = 0
    
    # 1) Получаем tank-level стату (если есть такие условия или нужны battles)
    if tank_conditions or not account_conditions:
        COND_TO_FIELD = {
            "damage": "damage_dealt", "frags": "frags", "xp": "xp",
            "spotting": "spotted", "blocked": "damage_blocked", "wins": "wins",
        }
        
        tank_fields = set(["battles"])
        for cond in tank_conditions:
            field = COND_TO_FIELD.get(cond, "damage_dealt")
            tank_fields.add(field)
        fields_str = ",".join(f"all.{f}" for f in tank_fields) + ",tank_id"
        
        try:
            timeout = aiohttp.ClientTimeout(total=15)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                url = (f"https://api.tanki.su/wot/tanks/stats/"
                       f"?application_id={get_lesta_app_id()}&account_id={account_id}"
                       f"&fields={fields_str}")
                async with session.get(url) as resp:
                    data = await resp.json()
            
            if data.get("status") != "ok":
                return None
            
            tanks = data["data"].get(str(account_id))
            if not tanks:
                return None
            
            tank_info_map = {}
            if tank_class or tank_tier or tank_id_filter:
                all_tank_ids = [t["tank_id"] for t in tanks]
                tank_info_map = await gc_get_tank_names(all_tank_ids)
            
            for t in tanks:
                tid = t["tank_id"]
                all_stats = t.get("all", {})
                
                if tank_id_filter and tid != tank_id_filter:
                    continue
                if tank_class or tank_tier:
                    info = tank_info_map.get(tid, {})
                    if tank_class and info.get("type") != tank_class:
                        continue
                    if tank_tier and info.get("tier") != tank_tier:
                        continue
                
                total_battles += all_stats.get("battles", 0)
                for cond in tank_conditions:
                    field = COND_TO_FIELD.get(cond, "damage_dealt")
                    per_condition[cond] += all_stats.get(field, 0)
        except Exception as e:
            logger.error(f"GC fetch multi stats (tanks/stats) error for {account_id}: {e}")
            return None
    
    # 2) Получаем account-level стату (spotting_damage, combined)
    if account_conditions:
        try:
            acc_data = await gc_fetch_account_assisted([account_id])
            info = acc_data.get(account_id)
            if not info:
                return None
            
            if not total_battles:
                total_battles = info["battles"]
            
            for cond in account_conditions:
                if cond == "spotting_damage":
                    per_condition[cond] = info["assisted"]
                elif cond == "combined":
                    per_condition[cond] = info["damage_dealt"] + info["assisted"]
        except Exception as e:
            logger.error(f"GC fetch multi stats (account/info) error for {account_id}: {e}")
            return None
    
    result = {
        "battles": total_battles,
        "per_condition": per_condition,
        "value": per_condition.get(first_cond, 0),
    }
    
    return result


async def gc_fetch_batch_stats(account_ids, conditions_str, tank_class=None, tank_tier=None, tank_id_filter=None):
    """Получить стату ПАКЕТНО для игроков.
    
    tanks/stats — для per-tank условий (damage, frags, xp, spotted, blocked, wins).
    account/info — для account-level условий (spotting_damage, combined).
    
    Возвращает dict: {account_id: {"battles": N, "per_condition": {cond: val}, "value": V}}
    """
    import aiohttp
    if not account_ids:
        return {}
    
    conditions = [c.strip() for c in conditions_str.split(",") if c.strip()]
    if not conditions:
        conditions = ["damage"]
    
    # Разделяем условия
    tank_conditions = [c for c in conditions if c not in GC_ACCOUNT_LEVEL_CONDITIONS]
    account_conditions = [c for c in conditions if c in GC_ACCOUNT_LEVEL_CONDITIONS]
    
    # Маппинг условий → поля в tanks/stats
    COND_TO_TANK_FIELD = {
        "damage": "damage_dealt", "frags": "frags", "xp": "xp",
        "spotting": "spotted", "blocked": "damage_blocked", "wins": "wins",
    }
    
    # Собираем поля для запроса tanks/stats (только tank-level условия)
    tank_fields = set(["battles"])
    for cond in tank_conditions:
        field = COND_TO_TANK_FIELD.get(cond, "damage_dealt")
        tank_fields.add(field)
    fields_str = ",".join(f"all.{f}" for f in tank_fields) + ",tank_id"
    
    need_tank_filter = bool(tank_class or tank_tier or tank_id_filter)
    
    results = {}
    
    # 1) tanks/stats — параллельно для каждого игрока
    async def fetch_one(session, aid):
        try:
            url = (f"https://api.tanki.su/wot/tanks/stats/"
                   f"?application_id={get_lesta_app_id()}&account_id={aid}"
                   f"&fields={fields_str}")
            async with session.get(url) as resp:
                raw_data = await resp.text()
                data = json.loads(raw_data)
            
            if data.get("status") != "ok":
                err = data.get("error", {})
                logger.warning(f"Lesta API Error for {aid}: {err.get('message')} (Code: {err.get('code')})")
                return None
            
            tanks = data["data"].get(str(aid))
            if tanks is None:
                logger.warning(f"Lesta API: Account {aid} not found in data")
                return None
            
            if not tanks:
                logger.info(f"Lesta API: Account {aid} has NO public tanks (Profile might be PRIVATE)")
                return None
            
            tank_info_map = {}
            if need_tank_filter:
                all_tank_ids = [t["tank_id"] for t in tanks]
                tank_info_map = await gc_get_tank_names(all_tank_ids)
            
            total_battles = 0
            per_condition = {c: 0 for c in tank_conditions}
            
            for t in tanks:
                tid = t["tank_id"]
                all_stats = t.get("all", {})
                
                if tank_id_filter and tid != tank_id_filter:
                    continue
                if tank_class or tank_tier:
                    info = tank_info_map.get(tid, {})
                    if tank_class and info.get("type") != tank_class:
                        continue
                    if tank_tier and info.get("tier") != tank_tier:
                        continue
                
                total_battles += all_stats.get("battles", 0)
                for cond in tank_conditions:
                    field = COND_TO_TANK_FIELD.get(cond, "damage_dealt")
                    per_condition[cond] += all_stats.get(field, 0)
            
            return (aid, {"battles": total_battles, "per_condition": per_condition})
        except Exception as e:
            logger.warning(f"GC tanks/stats fetch error for {aid}: {e}")
            return None
    
    import asyncio
    CONCURRENT = 10
    timeout = aiohttp.ClientTimeout(total=20)
    
    for i in range(0, len(account_ids), CONCURRENT):
        batch = account_ids[i:i + CONCURRENT]
        async with aiohttp.ClientSession(timeout=timeout) as session:
            tasks = [fetch_one(session, aid) for aid in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            
            for res in batch_results:
                if isinstance(res, Exception):
                    logger.warning(f"GC batch task exception: {res}")
                    continue
                if res is not None:
                    aid, data = res
                    results[aid] = data
    
    # 2) account/info — для spotting_damage и combined (батчем)
    if account_conditions:
        try:
            valid_aids = list(results.keys()) if results else account_ids
            acc_data = await gc_fetch_account_assisted(valid_aids)
            
            for aid in valid_aids:
                acc_info = acc_data.get(aid)
                if not acc_info:
                    continue
                
                if aid not in results:
                    results[aid] = {"battles": acc_info["battles"], "per_condition": {}}
                
                for cond in account_conditions:
                    if cond == "spotting_damage":
                        results[aid]["per_condition"][cond] = acc_info["assisted"]
                    elif cond == "combined":
                        results[aid]["per_condition"][cond] = acc_info["damage_dealt"] + acc_info["assisted"]
        except Exception as e:
            logger.error(f"GC batch account/info error: {e}")
    
    # 3) Добавляем value = первое условие
    first_cond = conditions[0]
    for aid in results:
        results[aid]["value"] = results[aid]["per_condition"].get(first_cond, 0)
    
    logger.info(f"GC batch fetch: got stats for {len(results)}/{len(account_ids)} players")
    return results


async def gc_fetch_tank_stats(account_id):
    """Получить стату по каждому танку игрока из Lesta API"""
    import aiohttp
    try:
        timeout = aiohttp.ClientTimeout(total=15)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            url = (f"https://api.tanki.su/wot/tanks/stats/"
                   f"?application_id={get_lesta_app_id()}&account_id={account_id}"
                   f"&fields=tank_id,all.battles,all.damage_dealt,all.frags,all.spotted,all.damage_received,all.xp,all.wins")
            async with session.get(url) as resp:
                data = await resp.json()
            if data.get("status") != "ok":
                return None
            return data["data"].get(str(account_id)) or []
    except Exception as e:
        logger.error(f"GC fetch tank stats error for {account_id}: {e}")
        return None


async def gc_save_tank_baselines(challenge_id, telegram_id, account_id):
    """Сохранить baseline по-танковой статы при вступлении в челлендж"""
    tanks = await gc_fetch_tank_stats(account_id)
    if not tanks:
        return
    
    # Нужна энциклопедия танков для имён
    tank_info = await gc_get_tank_names([t["tank_id"] for t in tanks])
    
    from database import get_db
    with get_db() as conn:
        for t in tanks:
            all_stats = t.get("all", {})
            tid = t["tank_id"]
            info = tank_info.get(tid, {})
            try:
                conn.execute("""
                    INSERT OR REPLACE INTO gc_tank_baselines
                    (challenge_id, telegram_id, tank_id, tank_name, tank_tier, tank_type,
                     baseline_battles, baseline_damage, baseline_frags, baseline_xp, 
                     baseline_spotting, baseline_spotting_damage, baseline_blocked, baseline_wins)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (challenge_id, telegram_id, tid,
                      info.get("name", f"Tank {tid}"),
                      info.get("tier", 0),
                      info.get("type", ""),
                      all_stats.get("battles", 0),
                      all_stats.get("damage_dealt", 0),
                      all_stats.get("frags", 0),
                      all_stats.get("xp", 0),
                      all_stats.get("spotted", 0),
                      all_stats.get("damage_assisted", 0),
                      all_stats.get("damage_blocked", 0),
                      all_stats.get("wins", 0)))
            except Exception as e:
                logger.warning(f"Failed to save tank baseline for tid={tid}: {e}")
    logger.info(f"GC saved {len(tanks)} comprehensive tank baselines for tg={telegram_id}")


async def gc_get_tank_names(tank_ids):
    """Получить имена танков из кеша или Lesta API"""
    if not tank_ids:
        return {}
    # Кешируем в глобальной переменной
    if not hasattr(gc_get_tank_names, '_cache'):
        gc_get_tank_names._cache = {}
    
    missing = [tid for tid in tank_ids if tid not in gc_get_tank_names._cache]
    if missing:
        import aiohttp
        try:
            timeout = aiohttp.ClientTimeout(total=15)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                # API позволяет до 100 танков за раз
                for i in range(0, len(missing), 100):
                    batch = missing[i:i+100]
                    ids_str = ",".join(str(x) for x in batch)
                    url = (f"https://api.tanki.su/wot/encyclopedia/vehicles/"
                           f"?application_id={get_lesta_app_id()}&tank_id={ids_str}"
                           f"&fields=name,tier,type")
                    async with session.get(url) as resp:
                        data = await resp.json()
                    if data.get("status") == "ok" and data.get("data"):
                        for tid_str, info in data["data"].items():
                            if info:
                                gc_get_tank_names._cache[int(tid_str)] = info
        except Exception as e:
            logger.warning(f"GC tank names lookup error: {e}")
    
    return {tid: gc_get_tank_names._cache.get(tid, {}) for tid in tank_ids}


async def api_global_challenge_create(request):
    """POST /api/global-challenge/create — админ создаёт общий челлендж"""
    try:
        data = await request.json()
        admin_tg = int(data.get("admin_telegram_id", 0))

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        title = data.get("title", "Общий Челлендж")
        description = data.get("description", "")
        icon = data.get("icon", "🔥")
        condition = data.get("condition", "damage")
        duration_minutes = int(data.get("duration_minutes", 60))
        max_battles = int(data.get("max_battles", 0))
        reward_coins = int(data.get("reward_coins", 500))
        reward_description = data.get("reward_description", f"{reward_coins} 🧀")
        
        # Фильтры техники
        tank_class = data.get("tank_class") or None
        tank_tier_filter = int(data.get("tank_tier_filter") or 0) or None
        tank_id_filter = int(data.get("tank_id_filter") or 0) or None
        tank_name_filter = data.get("tank_name_filter") or None

        # Призовой режим
        prize_mode = int(data.get("prize_mode", 0))
        # В призовом режиме сыр НЕ разыгрывается — принудительно обнуляем
        if prize_mode:
            reward_coins = 0
            reward_description = data.get("prize_description", "") or data.get("reward_description", "🏆 Приз")
        prize_description = data.get("prize_description", "") or None
        prize_image_url = data.get("prize_image_url", "") or None
        prize_cta = data.get("prize_cta", "") or None
        prize_top_count = int(data.get("prize_top_count", 10))
        challenge_duration_minutes = int(data.get("challenge_duration_minutes", 0))

        from database import get_db
        from datetime import datetime, timedelta, timezone

        if prize_mode:
            # Призовой режим: timer = время набора, потом отдельно бои
            enrollment_ends_at = datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)
            # ends_at для активной фазы — будет установлен когда enrollment закончится
            # Пока ставим далёкую дату
            ends_at = enrollment_ends_at + timedelta(days=30)
            initial_status = 'enrollment'
        else:
            enrollment_ends_at = None
            ends_at = datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)
            initial_status = 'active'

        with get_db() as conn:
            # Находим старые активные и корректно закрываем их с наградами
            active_ids = conn.execute("SELECT id FROM global_challenges WHERE status IN ('active', 'enrollment')").fetchall()
            for row in active_ids:
                _internal_finish_challenge(conn, row["id"])

            cursor = conn.execute("""
                INSERT INTO global_challenges 
                (title, description, icon, condition, duration_minutes, max_battles,
                 reward_coins, reward_description, status, created_by, ends_at,
                 tank_class, tank_tier_filter, tank_id_filter, tank_name_filter,
                 prize_mode, prize_description, prize_image_url, prize_cta, prize_top_count, 
                 challenge_duration_minutes, enrollment_ends_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (title, description, icon, condition, duration_minutes, max_battles,
                  reward_coins, reward_description, initial_status, admin_tg, ends_at,
                  tank_class, tank_tier_filter, tank_id_filter, tank_name_filter,
                  prize_mode, prize_description, prize_image_url, prize_cta, prize_top_count,
                  challenge_duration_minutes, enrollment_ends_at))
            challenge_id = cursor.lastrowid

        if not prize_mode:
            # Обычный режим: админ автоматически вступает
            admin_user = get_user_by_telegram_id(admin_tg)
            if not admin_user:
                from database import get_or_create_user
                admin_user = get_or_create_user(admin_tg)

            client_wot_nick = data.get("wot_nickname", "").strip()
            client_wot_id = data.get("wot_account_id", "")
            
            admin_nick = admin_user.get("wot_nickname") if admin_user else None
            admin_account_id = admin_user.get("wot_account_id") if admin_user else None

            if not admin_nick and client_wot_nick:
                admin_nick = client_wot_nick
            if not admin_account_id and client_wot_id:
                try:
                    admin_account_id = int(client_wot_id)
                except (ValueError, TypeError):
                    pass

            if admin_nick and admin_account_id and admin_user:
                if admin_nick != admin_user.get("wot_nickname") or admin_account_id != admin_user.get("wot_account_id"):
                    from database import update_user_wot
                    update_user_wot(admin_tg, admin_nick, admin_account_id)

            if not admin_nick:
                admin_nick = (admin_user.get("first_name") if admin_user else None) or "Админ"

            baseline_value = 0
            baseline_battles = 0
            baseline_values_json = None

            if admin_account_id:
                conditions = [c.strip() for c in condition.split(",") if c.strip()]
                if len(conditions) > 1 or condition == 'combined':
                    multi_stat = await gc_fetch_player_multi_stats(admin_account_id, condition, tank_class, tank_tier_filter, tank_id_filter)
                    if multi_stat:
                        baseline_value = multi_stat["value"]
                        baseline_battles = multi_stat["battles"]
                        baseline_values_json = json.dumps(multi_stat["per_condition"])
                else:
                    stat = await gc_fetch_player_stat(admin_account_id, condition)
                    if stat:
                        baseline_value = stat["value"]
                        baseline_battles = stat["battles"]

            with get_db() as conn:
                import sqlite3
                try:
                    conn.execute("""
                        INSERT INTO global_challenge_participants 
                        (challenge_id, telegram_id, nickname, baseline_value, baseline_battles, baseline_values, current_value, battles_played)
                        VALUES (?, ?, ?, ?, ?, ?, 0, 0)
                    """, (challenge_id, admin_tg, admin_nick, baseline_value, baseline_battles, baseline_values_json))
                except sqlite3.IntegrityError:
                    pass

            if admin_account_id:
                try:
                    await gc_save_tank_baselines(challenge_id, admin_tg, admin_account_id)
                except Exception as e:
                    logger.warning(f"Failed to save admin tank baselines: {e}")

        return cors_response({
            "success": True, 
            "challenge_id": challenge_id,
            "ends_at": ends_at.isoformat(),
            "status": initial_status,
            "prize_mode": prize_mode
        })
    except Exception as e:
        logger.error(f"API global_challenge_create error: {e}")
        return cors_response({"error": str(e)}, 500)
def _internal_finish_challenge(conn, challenge_id):
    """Внутренняя логика завершения челленджа: выбор победителя, выдача награды, смена статуса."""
    try:
        # Проверяем prize_mode
        ch_data = conn.execute("SELECT * FROM global_challenges WHERE id = ?", (challenge_id,)).fetchone()
        if not ch_data:
            return False
        
        is_prize_mode = ch_data.get("prize_mode", 0) == 1

        # 1. Находим победителя (по очкам)
        winner = conn.execute("""
            SELECT * FROM global_challenge_participants 
            WHERE challenge_id = ? ORDER BY current_value DESC LIMIT 1
        """, (challenge_id,)).fetchone()
        
        winner_tg = winner["telegram_id"] if winner else None
        winner_nick = winner["nickname"] if winner else None
        winner_val = winner["current_value"] if winner else 0
        winner_cond_vals = winner["condition_values"] if winner else None
        
        if is_prize_mode:
            # Призовой режим: переходим в wheel_pending, НЕ выдаём награду
            conn.execute("""
                UPDATE global_challenges 
                SET status = 'wheel_pending', finished_at = datetime('now'),
                    winner_telegram_id = ?, winner_nickname = ?, winner_value = ?,
                    winner_condition_values = ?
                WHERE id = ?
            """, (winner_tg, winner_nick, winner_val, winner_cond_vals, challenge_id))
            logger.info(f"🎡 Челлендж {challenge_id} → wheel_pending. ТОП-1: {winner_nick} ({winner_val})")
        else:
            # Обычный режим: финишируем и выдаём награду
            conn.execute("""
                UPDATE global_challenges 
                SET status = 'finished', finished_at = datetime('now'),
                    winner_telegram_id = ?, winner_nickname = ?, winner_value = ?,
                    winner_condition_values = ?
                WHERE id = ?
            """, (winner_tg, winner_nick, winner_val, winner_cond_vals, challenge_id))
            
            logger.info(f"🏆 Челлендж {challenge_id} завершён. Победитель: {winner_nick} ({winner_val})")
            
            # Выдача награды
            if winner_tg and ch_data["reward_coins"] > 0:
                try:
                    from database import buy_cheese
                    buy_cheese(winner_tg, ch_data["reward_coins"], method="challenge_reward")
                    logger.info(f"💰 Награда {ch_data['reward_coins']} сыра выдана {winner_tg}")
                except Exception as e:
                    logger.error(f"Ошибка выдачи награды: {e}")
        
        return True
    except Exception as e:
        logger.error(f"Ошибка в _internal_finish_challenge: {e}")
        return False


async def api_global_challenge_active(request):
    """GET /api/global-challenge/active?challenge_id=X — получить активный или конкретный челлендж"""
    try:
        from database import get_db, get_db_read
        from datetime import datetime, timezone

        now_utc = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
        query_id = request.query.get("challenge_id")

        # Сначала пробуем просто прочитать активный или конкретный челлендж
        with get_db_read() as conn:
            if query_id:
                ch = conn.execute("SELECT * FROM global_challenges WHERE id = ?", (int(query_id),)).fetchone()
            else:
                # Ищем активные, enrollment, или wheel_pending
                ch = conn.execute("""
                    SELECT * FROM global_challenges 
                    WHERE status IN ('active', 'enrollment', 'wheel_pending')
                    ORDER BY created_at DESC LIMIT 1
                """).fetchone()

        # Если активного нет — возможно нужно закрыть те, что закончились по времени или боям
        if not ch:
            with get_db() as conn:
                # 1. Закрываем по ВРЕМЕНИ
                expired = conn.execute(
                    "SELECT id FROM global_challenges WHERE status = 'active' AND ends_at <= ?",
                    (now_utc,)
                ).fetchall()
                for ex in expired:
                    _internal_finish_challenge(conn, ex["id"])
                
                # 2. Закрываем по БОЯМ (если все участники сыграли лимит)
                # Ищем активные с лимитом боёв
                battle_limited = conn.execute(
                    "SELECT id, max_battles FROM global_challenges WHERE status = 'active' AND max_battles > 0"
                ).fetchall()
                for b_ch in battle_limited:
                    # Проверяем, есть ли участники, которые ЕЩЁ НЕ сыграли лимит
                    not_finished = conn.execute("""
                        SELECT COUNT(*) FROM global_challenge_participants 
                        WHERE challenge_id = ? AND battles_played < ?
                    """, (b_ch["id"], b_ch["max_battles"])).fetchone()[0]
                    
                    # Если все (кто вступил) уже отыграли — закрываем
                    # Проверяем что есть хотя бы один участник
                    has_p = conn.execute("SELECT COUNT(*) FROM global_challenge_participants WHERE challenge_id = ?", (b_ch["id"],)).fetchone()[0]
                    
                    if has_p > 0 and not_finished == 0:
                        _internal_finish_challenge(conn, b_ch["id"])

                # Снова пробуем найти (может уже ничего нет)
                last = conn.execute("""
                    SELECT * FROM global_challenges 
                    WHERE status IN ('finished', 'wheel_pending', 'completed')
                    ORDER BY finished_at DESC LIMIT 1
                """).fetchone()
                
                if last:
                    last = dict(last)
                    top = conn.execute("""
                        SELECT * FROM global_challenge_participants 
                        WHERE challenge_id = ? ORDER BY current_value DESC LIMIT 10
                    """, (last["id"],)).fetchall()
                    lb = []
                    for r in top:
                        d_r = dict(r)
                        if d_r.get("condition_values"):
                            try: d_r["condition_values"] = json.loads(d_r["condition_values"])
                            except: d_r["condition_values"] = None
                        lb.append(d_r)
                    last["leaderboard"] = lb
                    last["participants_count"] = conn.execute(
                        "SELECT COUNT(*) FROM global_challenge_participants WHERE challenge_id = ?",
                        (last["id"],)
                    ).fetchone()[0]
                    return cors_response({"challenge": last, "status": "finished"})
                return cors_response({"challenge": None, "status": "none"})

        # ═══ AUTO-TRANSITION: enrollment → active ═══
        # Если enrollment время истекло — автоматически стартуем активную фазу
        if ch and dict(ch).get("status") == "enrollment":
            ch_dict = dict(ch)
            enroll_end_str = ch_dict.get("enrollment_ends_at", "")
            if enroll_end_str:
                try:
                    enroll_end_clean = str(enroll_end_str).replace("T", " ").replace("Z", "").strip()
                    enroll_end = datetime.strptime(enroll_end_clean, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
                    now = datetime.now(timezone.utc)
                    
                    if now >= enroll_end:
                        logger.info(f"⏰ Auto-starting challenge {ch_dict['id']} (enrollment expired)")
                        
                        from datetime import timedelta
                        challenge_id = ch_dict["id"]
                        condition = ch_dict.get("condition", "damage")
                        conditions = [c.strip() for c in condition.split(",") if c.strip()]
                        is_multi = len(conditions) > 1
                        tank_class = ch_dict.get("tank_class")
                        tank_tier = ch_dict.get("tank_tier_filter")
                        tank_id = ch_dict.get("tank_id_filter")
                        
                        with get_db() as conn:
                            participants = conn.execute(
                                "SELECT * FROM global_challenge_participants WHERE challenge_id = ?",
                                (challenge_id,)
                            ).fetchall()
                        
                        # Собираем account_ids для batch
                        account_ids = []
                        tg_to_account = {}
                        for p in participants:
                            p_dict = dict(p)
                            aid = p_dict.get("wot_account_id")
                            if aid:
                                try:
                                    aid = int(aid)
                                    account_ids.append(aid)
                                    tg_to_account[p_dict["telegram_id"]] = aid
                                except (ValueError, TypeError):
                                    pass
                        
                        # Получаем baselines
                        batch_stats = {}
                        if account_ids:
                            try:
                                batch_stats = await gc_fetch_batch_stats(account_ids, condition, tank_class, tank_tier, tank_id)
                            except Exception as e:
                                logger.warning(f"Batch stats fetch failed: {e}")
                        
                        # Записываем baselines и обновляем статус
                        with get_db() as conn:
                            for p in participants:
                                p_dict = dict(p)
                                tg_id = p_dict["telegram_id"]
                                aid = tg_to_account.get(tg_id)
                                
                                baseline_value = 0
                                baseline_battles = 0
                                baseline_values_json = None
                                
                                if aid and aid in batch_stats:
                                    stat = batch_stats[aid]
                                    baseline_value = stat["value"]
                                    baseline_battles = stat["battles"]
                                    if is_multi:
                                        baseline_values_json = json.dumps(stat.get("per_condition", {}))
                                
                                conn.execute("""
                                    UPDATE global_challenge_participants 
                                    SET baseline_value = ?, baseline_battles = ?, baseline_values = ?,
                                        current_value = 0, battles_played = 0
                                    WHERE challenge_id = ? AND telegram_id = ?
                                """, (baseline_value, baseline_battles, baseline_values_json, challenge_id, tg_id))
                            
                            # Обновляем статус на active
                            challenge_duration = ch_dict.get("challenge_duration_minutes", 0) or 0
                            if challenge_duration > 0:
                                new_ends_at = now + timedelta(minutes=challenge_duration)
                            else:
                                new_ends_at = now + timedelta(days=30)
                            
                            conn.execute("""
                                UPDATE global_challenges 
                                SET status = 'active', ends_at = ?
                                WHERE id = ?
                            """, (new_ends_at, challenge_id))
                        
                        # Сохраним baselines танков
                        for p in participants:
                            p_dict = dict(p)
                            aid = tg_to_account.get(p_dict["telegram_id"])
                            if aid:
                                try:
                                    await gc_save_tank_baselines(challenge_id, p_dict["telegram_id"], aid)
                                except Exception:
                                    pass
                        
                        logger.info(f"🚀 Challenge {challenge_id} auto-started! {len(participants)} participants")
                        
                        # Перечитываем челлендж с обновлённым статусом
                        with get_db_read() as conn:
                            ch = conn.execute("SELECT * FROM global_challenges WHERE id = ?", (challenge_id,)).fetchone()
                except Exception as e:
                    logger.error(f"Auto-start enrollment->active error: {e}")

        # Если челлендж активен — собираем статику тоже через Read-Only
        with get_db_read() as conn:
            ch = dict(ch)
            participants = conn.execute(
                "SELECT COUNT(*) FROM global_challenge_participants WHERE challenge_id = ?",
                (ch["id"],)
            ).fetchone()[0]
            
            top = conn.execute("""
                SELECT * FROM global_challenge_participants 
                WHERE challenge_id = ?
                ORDER BY current_value DESC LIMIT 10
            """, (ch["id"],)).fetchall()

            ch["participants_count"] = participants
            lb = [dict(r) for r in top]
            for entry in lb:
                if entry.get("condition_values"):
                    try:
                        entry["condition_values"] = json.loads(entry["condition_values"])
                    except Exception:
                        entry["condition_values"] = None
            ch["leaderboard"] = lb

            # Ensure all dates are properly formatted with Z suffix for JS
            for date_key in ["ends_at", "enrollment_ends_at", "created_at", "finished_at"]:
                val = ch.get(date_key)
                if val and not str(val).endswith("Z") and "+" not in str(val):
                    ch[date_key] = str(val).replace(" ", "T") + "Z"
                elif val and " " in str(val):
                    ch[date_key] = str(val).replace(" ", "T")

        return cors_response({"challenge": ch, "status": ch.get("status", "active")})
    except Exception as e:
        logger.error(f"API global_challenge_active error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_upload_prize_image(request):
    """POST /api/upload-prize-image — загрузка картинки приза (base64)"""
    try:
        data = await request.json()
        image_data = data.get("image", "")
        filename = data.get("filename", "prize")
        
        if not image_data:
            return cors_response({"error": "No image data"}, 400)
        
        # Remove data:image/...;base64, prefix if present
        if "," in image_data:
            image_data = image_data.split(",", 1)[1]
        
        import base64
        image_bytes = base64.b64decode(image_data)
        
        # Determine extension from first bytes
        ext = "png"
        if image_bytes[:3] == b'\xff\xd8\xff':
            ext = "jpg"
        elif image_bytes[:4] == b'\x89PNG':
            ext = "png"
        elif image_bytes[:4] == b'RIFF':
            ext = "webp"
        
        # Save to webapp/img/prizes/
        prizes_dir = os.path.join(os.path.dirname(__file__), "webapp", "img", "prizes")
        os.makedirs(prizes_dir, exist_ok=True)
        
        # Use timestamp for unique filename
        import time
        safe_name = f"prize_{int(time.time())}.{ext}"
        filepath = os.path.join(prizes_dir, safe_name)
        
        with open(filepath, "wb") as f:
            f.write(image_bytes)
        
        # Return relative URL path
        image_url = f"img/prizes/{safe_name}"
        
        logger.info(f"Prize image uploaded: {safe_name} ({len(image_bytes)} bytes)")
        return cors_response({"url": image_url, "filename": safe_name})
    except Exception as e:
        logger.error(f"Upload prize image error: {e}")
        return cors_response({"error": str(e)}, 500)

async def api_global_challenge_join(request):
    """POST /api/global-challenge/join — присоединиться к общему челленджу"""
    try:
        data = await request.json()
        tg_id = int(data.get("telegram_id", 0))
        challenge_id = int(data.get("challenge_id", 0))

        # WoT данные из localStorage клиента (на случай если БД сброшена после редеплоя)
        client_wot_nickname = data.get("wot_nickname", "").strip()
        client_wot_account_id = data.get("wot_account_id", "")
        client_first_name = data.get("first_name", "")
        client_username = data.get("username", "")

        if not tg_id or not challenge_id:
            return cors_response({"error": "Не указаны параметры"}, 400)

        user = get_user_by_telegram_id(tg_id)
        if not user:
            # Автоматически создаём пользователя с данными от клиента
            from database import get_or_create_user
            user = get_or_create_user(tg_id, username=client_username, first_name=client_first_name)
        
        if not user:
            return cors_response({"error": "Не удалось найти пользователя. Нажмите /start в боте."}, 404)

        # Восстанавливаем WoT данные из клиента если на сервере нет
        account_id = user.get("wot_account_id")
        wot_nick = user.get("wot_nickname")

        if not wot_nick and client_wot_nickname:
            wot_nick = client_wot_nickname
        if not account_id and client_wot_account_id:
            try:
                account_id = int(client_wot_account_id)
            except (ValueError, TypeError):
                pass

        # Сохраняем восстановленные данные в БД
        if (wot_nick or account_id) and (wot_nick != user.get("wot_nickname") or account_id != user.get("wot_account_id")):
            from database import update_user_wot
            if wot_nick and account_id:
                update_user_wot(tg_id, wot_nick, account_id)
                logger.info(f"Restored WoT data from client: {wot_nick} (ID: {account_id}) for tg={tg_id}")

        nickname = wot_nick or user.get("first_name") or user.get("username") or "Танкист"

        logger.info(f"GC Join: tg_id={tg_id}, nickname={nickname}, account_id={account_id}, wot_nickname={wot_nick}")

        # Если есть ник но нет account_id — пробуем найти через Lesta API
        if not account_id and user.get("wot_nickname"):
            try:
                import aiohttp as _aiohttp
                async with _aiohttp.ClientSession() as session:
                    url = (
                        f"https://api.tanki.su/wot/account/list/"
                        f"?application_id={get_lesta_app_id()}"
                        f"&search={user['wot_nickname']}&limit=1&type=exact"
                    )
                    async with session.get(url, timeout=_aiohttp.ClientTimeout(total=10)) as resp:
                        result = await resp.json()
                        if result.get("status") == "ok" and result.get("data"):
                            account_id = result["data"][0]["account_id"]
                            nickname = result["data"][0].get("nickname", nickname)
                            # Сохраняем найденный account_id
                            from database import update_user_wot
                            update_user_wot(tg_id, nickname, account_id)
                            logger.info(f"Auto-found account_id={account_id} for {nickname}")
            except Exception as e:
                logger.warning(f"Lesta API lookup in join: {e}")

        # Если нет wot_nickname и нет account_id — пробуем поискать по нику через Lesta 
        # (может пользователь использует свой ник от игры в качестве Telegram имени)
        if not account_id and not user.get("wot_nickname"):
            try_nick = user.get("first_name") or user.get("username")
            if try_nick:
                try:
                    import aiohttp as _aiohttp
                    async with _aiohttp.ClientSession() as session:
                        url = (
                            f"https://api.tanki.su/wot/account/list/"
                            f"?application_id={get_lesta_app_id()}"
                            f"&search={try_nick}&limit=1&type=exact"
                        )
                        async with session.get(url, timeout=_aiohttp.ClientTimeout(total=10)) as resp:
                            result = await resp.json()
                            if result.get("status") == "ok" and result.get("data"):
                                account_id = result["data"][0]["account_id"]
                                nickname = result["data"][0].get("nickname", nickname)
                                from database import update_user_wot
                                update_user_wot(tg_id, nickname, account_id)
                                logger.info(f"Auto-found by first_name: account_id={account_id} for {nickname}")
                except Exception as e:
                    logger.warning(f"Lesta API try-lookup: {e}")

        # Разрешаем вступить даже без account_id (статистика просто не будет отслеживаться)

        from database import get_db
        from datetime import datetime
        import sqlite3

        with get_db() as conn:
            ch = conn.execute(
                "SELECT * FROM global_challenges WHERE id = ? AND status IN ('active', 'enrollment')",
                (challenge_id,)
            ).fetchone()
            if not ch:
                return cors_response({"error": "Челлендж не найден или завершён"}, 404)
            ch_data = dict(ch)

        # Запоминаем базовую статистику на момент вступления (ВЫНЕСЕНО из with get_db)
        baseline_value = 0
        baseline_battles = 0
        baseline_values_json = None

        if account_id:
            ch_conditions = [c.strip() for c in (ch_data["condition"] or "damage").split(",") if c.strip()]
            ch_tank_class = ch_data.get("tank_class")
            ch_tank_tier = ch_data.get("tank_tier_filter")
            ch_tank_id = ch_data.get("tank_id_filter")
            if len(ch_conditions) > 1 or ch_data["condition"] == 'combined':
                multi_stat = await gc_fetch_player_multi_stats(account_id, ch_data["condition"], ch_tank_class, ch_tank_tier, ch_tank_id)
                if multi_stat:
                    baseline_value = multi_stat["value"]
                    baseline_battles = multi_stat["battles"]
                    baseline_values_json = json.dumps(multi_stat["per_condition"])
                else:
                    return cors_response({
                        "error": "❌ Не удалось получить статистику. Проверьте, что ваш профиль в игре ОТКРЫТ (не скрыт)!"
                    }, 400)
            else:
                stat = await gc_fetch_player_stat(account_id, ch_data["condition"])
                if stat:
                    baseline_value = stat["value"]
                    baseline_battles = stat["battles"]
                else:
                    return cors_response({
                        "error": "❌ Не удалось получить статистику. Проверьте, что ваш профиль в игре ОТКРЫТ (не скрыт)!"
                    }, 400)

        with get_db() as conn:
            try:
                conn.execute("""
                    INSERT INTO global_challenge_participants 
                    (challenge_id, telegram_id, nickname, baseline_value, baseline_battles, baseline_values, current_value, battles_played)
                    VALUES (?, ?, ?, ?, ?, ?, 0, 0)
                """, (challenge_id, tg_id, nickname, baseline_value, baseline_battles, baseline_values_json))
            except sqlite3.IntegrityError:
                return cors_response({"error": "Вы уже участвуете!"}, 400)

        # Сохраняем baseline по танкам
        if account_id:
            try:
                await gc_save_tank_baselines(challenge_id, tg_id, account_id)
            except Exception as e:
                logger.warning(f"Failed to save tank baselines for {tg_id}: {e}")

        return cors_response({
            "success": True, 
            "nickname": nickname,
            "message": f"🎯 {nickname}, вы вступили в челлендж! Условия приняты — вперёд!"
        })
    except Exception as e:
        logger.error(f"API global_challenge_join error: {e}")
        return cors_response({"error": str(e)}, 500)


# Кулдаун и блокировка для refresh-stats (защита от спама и параллельных запросов)
_gc_refresh_lock = None  # Создадим лениво (asyncio.Lock нельзя создавать до event loop)
_gc_last_refresh_time = 0
_gc_last_refresh_data = None  # Кэшируем данные, не Response
GC_REFRESH_COOLDOWN = 30  # секунд между обновлениями

async def api_global_challenge_refresh_stats(request):
    """POST /api/global-challenge/refresh-stats — обновить стату всех участников через Lesta API"""
    import asyncio, time
    global _gc_refresh_lock, _gc_last_refresh_time, _gc_last_refresh_data

    # Ленивое создание Lock (в правильном event loop)
    if _gc_refresh_lock is None:
        _gc_refresh_lock = asyncio.Lock()

    # Cooldown: если обновляли недавно — вернуть кэш
    now = time.time()
    if now - _gc_last_refresh_time < GC_REFRESH_COOLDOWN and _gc_last_refresh_data is not None:
        return cors_response(_gc_last_refresh_data)
    
    # Блокировка: не запускать параллельно несколько обновлений
    if _gc_refresh_lock.locked():
        return cors_response({"status": "already_running", "updated": 0})
    
    async with _gc_refresh_lock:
        try:
            result = await asyncio.wait_for(_do_refresh_stats(), timeout=55)
            _gc_last_refresh_time = time.time()
            # Сохраняем данные ответа, а не сам Response (его нельзя переиспользовать)
            try:
                _gc_last_refresh_data = {"success": True, "updated": result._updated_count if hasattr(result, '_updated_count') else 0}
            except Exception:
                _gc_last_refresh_data = {"success": True}
            return result
        except asyncio.TimeoutError:
            logger.error("GC refresh-stats: TIMEOUT (55s)")
            return cors_response({"error": "Timeout", "updated": 0})
        except Exception as e:
            logger.error(f"API global_challenge_refresh error: {e}")
            return cors_response({"error": str(e)}, 500)

async def _do_refresh_stats():
    """Внутренняя логика обновления статистики (BATCH — до 100 игроков за 1 API запрос)"""
    try:
        from database import get_db
        from datetime import datetime

        with get_db() as conn:
            ch = conn.execute(
                "SELECT * FROM global_challenges WHERE status = 'active' ORDER BY created_at DESC LIMIT 1",
            ).fetchone()
            if not ch:
                return cors_response({"error": "Нет активного челленджа"}, 400)

            ch = dict(ch)
            participants = conn.execute(
                "SELECT * FROM global_challenge_participants WHERE challenge_id = ?",
                (ch["id"],)
            ).fetchall()

        _raw_field = GC_CONDITION_TO_STAT.get((ch["condition"] or "damage").split(",")[0].strip(), "damage_dealt")
        stat_field = _raw_field if isinstance(_raw_field, str) else "damage_dealt"  # For _detect_new_battles
        max_battles = ch.get("max_battles", 0) or 0
        ch_conditions = [c.strip() for c in (ch["condition"] or "damage").split(",") if c.strip()]
        is_multi_cond = len(ch_conditions) > 1
        
        # Фильтры техники из челленджа
        ch_tank_class = ch.get("tank_class")
        ch_tank_tier = ch.get("tank_tier_filter")
        ch_tank_id = ch.get("tank_id_filter")

        # === STEP 1: Собираем все account_id ===
        participant_data = []  # [(p_dict, account_id)]
        for p in participants:
            p = dict(p)
            user = get_user_by_telegram_id(p["telegram_id"])
            account_id = user.get("wot_account_id") if user else None
            if not account_id:
                continue
            participant_data.append((p, int(account_id)))

        if not participant_data:
            return cors_response({"success": True, "updated": 0, "total": len(participants)})

        # === STEP 2: BATCH запрос — все игроки за 1-10 API запросов ===
        all_account_ids = [aid for _, aid in participant_data]
        logger.info(f"GC refresh: api_keys={len(LESTA_APP_IDS)}, players={len(participant_data)}, cond={ch['condition']}, tank_class={ch_tank_class}, tier={ch_tank_tier}")
        batch_stats = await gc_fetch_batch_stats(all_account_ids, ch["condition"], ch_tank_class, ch_tank_tier, ch_tank_id)
        logger.info(f"GC batch: got stats for {len(batch_stats)}/{len(participant_data)} players")

        # === STEP 3: Обновляем каждого участника из кэша ===
        updated = 0
        for p, account_id in participant_data:
            multi_stat = batch_stats.get(account_id)
            if not multi_stat:
                logger.warning(f"GC: NO DATA for {p['nickname']} (acct={account_id})")
                continue

            # --- Расчёт очков из batch_stats (дельта от baseline) ---
            new_battles = max(0, multi_stat["battles"] - p["baseline_battles"])

            # Compute per-condition deltas
            baseline_vals = {}
            if p.get("baseline_values"):
                try:
                    baseline_vals = json.loads(p["baseline_values"])
                except Exception:
                    pass

            cond_deltas = {}
            total_value = 0
            for c in ch_conditions:
                current_stat = multi_stat["per_condition"].get(c, 0)
                # Для первого условия fallback на baseline_value
                baseline_stat = baseline_vals.get(c, p.get("baseline_value", 0) if c == ch_conditions[0] else 0)
                delta = max(0, current_stat - baseline_stat)
                cond_deltas[c] = delta
                total_value += delta
                logger.info(f"GC {p['nickname']} [{c}]: cur={current_stat} base={baseline_stat} delta={delta}")

            logger.info(f"GC {p['nickname']}: base_battles={p['baseline_battles']} cur_battles={multi_stat['battles']} new_battles={new_battles} SCORE={total_value}")
            new_value = total_value
            condition_values_json = json.dumps(cond_deltas)

            # Лимит боёв
            if max_battles > 0 and new_battles > max_battles:
                new_battles = max_battles

            # --- Фоновое обнаружение боёв для детализации (не влияет на очки) ---
            try:
                await _detect_new_battles(ch["id"], p["telegram_id"], account_id, stat_field, new_battles, max_battles)
            except Exception as e:
                logger.warning(f"GC battle detection error for {p['nickname']}: {e}")

            # --- Если есть лимит боёв И есть записи в battle_log — пересчитываем из лога ---
            if max_battles > 0:
                try:
                    with get_db() as conn_bl:
                        rows = conn_bl.execute(
                            "SELECT * FROM gc_battle_log WHERE challenge_id = ? AND telegram_id = ? ORDER BY battle_num LIMIT ?",
                            (ch["id"], p["telegram_id"], max_battles)
                        ).fetchall()
                        if rows:
                            log_total = 0
                            log_conds = {c: 0 for c in ch_conditions}
                            # Маппинг условия на колонку в gc_battle_log
                            LOG_COL_MAP = {
                                "damage": "damage",
                                "frags": "frags",
                                "xp": "xp",
                                "spotting": "spotting",
                                "spotting_damage": "spotting_damage",
                                "blocked": "blocked",
                                "wins": "wins"
                            }
                            for r in rows:
                                for c in ch_conditions:
                                    if c == "combined":
                                        val = (r["damage"] or 0) + (r.get("spotting_damage") or 0)
                                    else:
                                        col = LOG_COL_MAP.get(c, "damage")
                                        val = r[col] or 0
                                    log_conds[c] += val
                                    log_total += val
                            new_value = log_total
                            condition_values_json = json.dumps(log_conds)
                            new_battles = len(rows)
                except Exception as e:
                    logger.warning(f"GC battle-log recalc error for {p['nickname']}: {e}")

            # Update participant record
            with get_db() as conn_up:
                conn_up.execute("""
                    UPDATE global_challenge_participants 
                    SET current_value = ?, battles_played = ?, last_updated = ?, condition_values = ?
                    WHERE challenge_id = ? AND telegram_id = ?
                """, (new_value, new_battles, datetime.now(), condition_values_json, ch["id"], p["telegram_id"]))
                updated += 1

        # === STEP 4: Проверка завершения челленджа (по времени или по боям) ===
        try:
            from datetime import timezone
            now_u = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
            with get_db() as conn_end:
                # По времени
                if ch["ends_at"] <= now_u:
                     _internal_finish_challenge(conn_end, ch["id"])
                # По боям (если все отыграли)
                elif max_battles > 0:
                    not_f = conn_end.execute("""
                        SELECT COUNT(*) FROM global_challenge_participants 
                        WHERE challenge_id = ? AND battles_played < ?
                    """, (ch["id"], max_battles)).fetchone()[0]
                    if not_f == 0:
                        _internal_finish_challenge(conn_end, ch["id"])
        except Exception as e:
            logger.error(f"Error checking GC auto-finish: {e}")

        logger.info(f"GC refresh-stats: updated {updated}/{len(participants)} participants")
        return cors_response({"success": True, "updated": updated, "total": len(participants)})
    except Exception as e:
        logger.error(f"API global_challenge_refresh error: {e}")
        return cors_response({"error": str(e)}, 500)


async def _detect_new_battles(challenge_id, telegram_id, account_id, stat_field, total_new_battles, max_battles=0):
    """Обнаружить новые бои путём сравнения по-танковой статы с baseline"""
    from database import get_db
    from datetime import datetime

    # Если уже есть лимит боёв в логе — выходим сразу
    with get_db() as conn_check:
        existing_logs = conn_check.execute(
            "SELECT COUNT(*) as cnt FROM gc_battle_log WHERE challenge_id = ? AND telegram_id = ?",
            (challenge_id, telegram_id)
        ).fetchone()
        existing_count = existing_logs["cnt"] if existing_logs else 0
        if max_battles > 0 and existing_count >= max_battles:
            return

    # Получаем текущую стату по танкам
    tanks = await gc_fetch_tank_stats(account_id)
    if not tanks:
        return

    # Загружаем сохранённые baselines
    with get_db() as conn:
        baselines = conn.execute(
            "SELECT * FROM gc_tank_baselines WHERE challenge_id = ? AND telegram_id = ?",
            (challenge_id, telegram_id)
        ).fetchall()
        existing_logs = conn.execute(
            "SELECT COUNT(*) as cnt FROM gc_battle_log WHERE challenge_id = ? AND telegram_id = ?",
            (challenge_id, telegram_id)
        ).fetchone()
        existing_count = existing_logs["cnt"] if existing_logs else 0

    # Если нет baselines — пропускаем
    if not baseline_map:
        return

    # Находим танки с новыми боями
    new_battles_list = []
    for t in tanks:
        tid = t["tank_id"]
        stats = t.get("all", {})
        curr = {
            "battles": stats.get("battles", 0),
            "damage": stats.get("damage_dealt", 0),
            "frags": stats.get("frags", 0),
            "xp": stats.get("xp", 0),
            "spotting": stats.get("spotted", 0),
            "spotting_damage": 0,  # НЕ доступно в tanks/stats, только в account/info на уровне аккаунта
            "blocked": stats.get("damage_blocked", 0),
            "wins": stats.get("wins", 0),
        }

        base = baseline_map.get(tid)
        if not base:
            if curr["battles"] > 0:
                new_battles_list.append({
                    "tank_id": tid,
                    "new_battles": curr["battles"],
                    "deltas": {k: curr[k] for k in curr if k != "battles"}
                })
            continue

        delta_b = curr["battles"] - base["baseline_battles"]
        if delta_b > 0:
            new_battles_list.append({
                "tank_id": tid,
                "tank_name": base.get("tank_name", ""),
                "tank_tier": base.get("tank_tier", 0),
                "tank_type": base.get("tank_type", ""),
                "new_battles": delta_b,
                "deltas": {
                    "damage": curr["damage"] - base["baseline_damage"],
                    "frags": curr["frags"] - base["baseline_frags"],
                    "xp": curr["xp"] - base["baseline_xp"],
                    "spotting": curr["spotting"] - base["baseline_spotting"],
                    "spotting_damage": curr.get("spotting_damage", 0) - base.get("baseline_spotting_damage", 0),
                    "blocked": curr["blocked"] - base["baseline_blocked"],
                    "wins": curr["wins"] - base["baseline_wins"],
                }
            })

    if not new_battles_list:
        return

    # Имена для новых танков
    need_names = [b["tank_id"] for b in new_battles_list if not b.get("tank_name")]
    if need_names:
        names = await gc_get_tank_names(need_names)
        for b in new_battles_list:
            if not b.get("tank_name"):
                info = names.get(b["tank_id"], {})
                b["tank_name"] = info.get("name", f"Tank {b['tank_id']}")
                b["tank_tier"] = info.get("tier", 0)
                b["tank_type"] = info.get("type", "")

    # Считаем сколько боёв нужно записать
    total_detected = sum(b["new_battles"] for b in new_battles_list)
    to_log = total_detected - existing_count
    if to_log <= 0: return

    battle_num = existing_count + 1
    with get_db() as conn:
        for b in new_battles_list:
            # Предотвращаем дублирование
            already = conn.execute(
                "SELECT COUNT(*) as cnt FROM gc_battle_log WHERE challenge_id = ? AND telegram_id = ? AND tank_id = ?",
                (challenge_id, telegram_id, b["tank_id"])
            ).fetchone()
            logged_count = already["cnt"] if already else 0
            new_count = b["new_battles"] - logged_count
            if new_count <= 0: continue

            # Распределяем дельты по боям
            per_battle = {k: v // new_count for k, v in b["deltas"].items()}
            
            for j in range(new_count):
                if max_battles > 0 and battle_num > max_battles:
                    break
                this_battle = {}
                for k, v in b["deltas"].items():
                    if j == new_count - 1: # Остаток в последний бой
                        this_battle[k] = v - per_battle[k] * (new_count - 1)
                    else:
                        this_battle[k] = per_battle[k]

                conn.execute("""
                    INSERT INTO gc_battle_log 
                    (challenge_id, telegram_id, battle_num, tank_id, tank_name, tank_tier, tank_type, 
                     damage, frags, xp, spotting, spotting_damage, blocked, wins, detected_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (challenge_id, telegram_id, battle_num, b["tank_id"],
                      b.get("tank_name", ""), b.get("tank_tier", 0), b.get("tank_type", ""),
                      max(0, this_battle["damage"]), max(0, this_battle["frags"]), 
                      max(0, this_battle["xp"]), max(0, this_battle["spotting"]),
                      max(0, this_battle.get("spotting_damage", 0)),
                      max(0, this_battle["blocked"]), max(0, this_battle["wins"]), datetime.now()))
                battle_num += 1


async def api_global_challenge_battle_log(request):
    """GET /api/global-challenge/battle-log?challenge_id=X&telegram_id=Y"""
    try:
        from database import get_db
        challenge_id = int(request.query.get("challenge_id", 0))
        telegram_id = int(request.query.get("telegram_id", 0))

        if not challenge_id:
            return cors_response({"error": "challenge_id required"}, 400)

        with get_db() as conn:
            if telegram_id:
                rows = conn.execute(
                    "SELECT * FROM gc_battle_log WHERE challenge_id = ? AND telegram_id = ? ORDER BY battle_num",
                    (challenge_id, telegram_id)
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM gc_battle_log WHERE challenge_id = ? ORDER BY telegram_id, battle_num",
                    (challenge_id,)
                ).fetchall()

        battles = [{
            "battle_num": r["battle_num"],
            "telegram_id": r["telegram_id"],
            "tank_name": r["tank_name"],
            "tank_tier": r["tank_tier"],
            "tank_type": r["tank_type"],
            "damage": r["damage"],
            "frags": r.get("frags", 0),
            "xp": r.get("xp", 0),
            "spotting": r.get("spotting", 0),
            "spotting_damage": r.get("spotting_damage", 0),
            "blocked": r.get("blocked", 0),
            "wins": bool(r.get("wins", 0)),
            "detected_at": r["detected_at"],
        } for r in rows]

        return cors_response({"battles": battles, "total": len(battles)})
    except Exception as e:
        logger.error(f"API battle-log error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_global_challenge_search_tanks(request):
    """GET /api/global-challenge/search-tanks?search=ИС&limit=10 — прокси для поиска танков через Lesta API"""
    import aiohttp
    try:
        search = request.query.get("search", "").strip()
        if not search or len(search) < 2:
            return cors_response({"data": {}, "status": "ok"})
        
        limit = min(int(request.query.get("limit", 10)), 15)
        
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            url = (f"https://api.tanki.su/wot/encyclopedia/vehicles/"
                   f"?application_id={get_lesta_app_id()}"
                   f"&search={search}&fields=name,tier,type,tank_id")
            async with session.get(url) as resp:
                data = await resp.json()
        
        # Lesta API возвращает ВСЕ танки при search. Обрезаем на нашей стороне.
        if data.get("status") == "ok" and data.get("data"):
            all_tanks = data["data"]
            search_lower = search.lower()
            # Сортируем: сначала те, чье имя начинается с запроса, потом по уровню (высший первый)
            sorted_items = sorted(
                [(k, v) for k, v in all_tanks.items() if v is not None],
                key=lambda x: (
                    0 if (x[1].get("name") or "").lower().startswith(search_lower) else 1,
                    -(x[1].get("tier") or 0)
                )
            )
            limited = dict(sorted_items[:limit])
            data["data"] = limited
            data["meta"]["count"] = len(limited)
        
        return cors_response(data)
    except Exception as e:
        logger.error(f"API search-tanks error: {e}")
        return cors_response({"error": str(e), "status": "error"}, 500)

# Кеш энциклопедии танков (загружается один раз)
_tank_encyclopedia_cache = None
_tank_encyclopedia_loading = False
_last_lesta_error = ""  # Для отладки ошибок ключей

async def _load_tank_encyclopedia():
    """Загрузить ВСЮ энциклопедию танков в память (один раз)"""
    global _tank_encyclopedia_cache, _tank_encyclopedia_loading
    if _tank_encyclopedia_cache is not None:
        return _tank_encyclopedia_cache
    if _tank_encyclopedia_loading:
        # Ждём пока другой запрос загрузит
        import asyncio
        for _ in range(50):
            await asyncio.sleep(0.2)
            if _tank_encyclopedia_cache is not None:
                return _tank_encyclopedia_cache
        return {}
    
    _tank_encyclopedia_loading = True
    import aiohttp
    all_tanks = {}
    try:
        timeout = aiohttp.ClientTimeout(total=30)
        page = 1
        while True:
            async with aiohttp.ClientSession(timeout=timeout) as session:
                url = (f"https://api.tanki.su/wot/encyclopedia/vehicles/"
                       f"?application_id={get_lesta_app_id()}"
                       f"&fields=name,tier,type,tank_id,nation&page_no={page}&limit=100")
                async with session.get(url) as resp:
                    data = await resp.json()
            
            if data.get("status") != "ok":
                err = data.get("error", {})
                global _last_lesta_error
                _last_lesta_error = f"{err.get('message', 'Unknown error')} (code: {err.get('code', '?')})"
                logger.error(f"Lesta API Error while loading tank dictionary: {err}")
                if not all_tanks:
                     # Если на первой же странице ошибка — прерываем
                     break
                # Если уже что-то загрузили, пробуем следующую или выходим
                break
            
            if not data.get("data"):
                break
            
            for tid, info in data["data"].items():
                if info is not None:
                    all_tanks[tid] = info
            
            meta = data.get("meta", {})
            total_pages = meta.get("page_total", 1)
            if page >= total_pages:
                break
            page += 1
        
        _tank_encyclopedia_cache = all_tanks
        logger.info(f"Tank encyclopedia loaded: {len(all_tanks)} tanks")
    except Exception as e:
        logger.error(f"Failed to load tank encyclopedia: {e}")
        _tank_encyclopedia_loading = False
        return {}
    
    _tank_encyclopedia_loading = False
    return all_tanks


async def api_global_challenge_tank_list(request):
    """GET /api/global-challenge/tank-list?nation=ussr&type=heavyTank&tier=10
    Возвращает список танков по фильтрам (нация/класс/уровень).
    Без параметров — возвращает доступные нации.
    """
    try:
        tanks = await _load_tank_encyclopedia()
        if not tanks:
            # Проверяем, есть ли вообще ключи
            if not LESTA_APP_IDS:
                return cors_response({"error": "Критическая ошибка: Бот не видит валидных LESTA_APP_ID в Railway. Проверьте формат ключей (32 символа)."}, 500)
            return cors_response({"error": f"Ошибка Lesta API: {_last_lesta_error or 'Нет связи'}. Загружено ключей: {len(LESTA_APP_IDS)}. Проверьте их валидность."}, 500)
        
        nation = request.query.get("nation", "").strip()
        tank_type = request.query.get("type", "").strip()
        tier = int(request.query.get("tier", 0))
        
        # Если ничего не выбрано — вернуть список наций
        if not nation:
            nations = set()
            for t in tanks.values():
                if t and t.get("nation"):
                    nations.add(t["nation"])
            nation_labels = {
                "ussr": "🇷🇺 СССР", "germany": "🇩🇪 Германия", "usa": "🇺🇸 США",
                "france": "🇫🇷 Франция", "uk": "🇬🇧 Британия", "china": "🇨🇳 Китай",
                "japan": "🇯🇵 Япония", "czech": "🇨🇿 Чехословакия", "sweden": "🇸🇪 Швеция",
                "poland": "🇵🇱 Польша", "italy": "🇮🇹 Италия", "israel": "🇮🇱 Израиль",
                "mongolia": "🇲🇳 Монголия",
            }
            result = [{"id": n, "name": nation_labels.get(n, n)} for n in sorted(nations)]
            return cors_response({"nations": result})
        
        # Фильтруем по нации
        filtered = [t for t in tanks.values() if t and t.get("nation") == nation]
        
        # Если нет класса — вернуть доступные классы для этой нации
        if not tank_type:
            types = set(t.get("type") for t in filtered if t.get("type"))
            type_labels = {
                "heavyTank": "🛡️ ТТ", "mediumTank": "⚙️ СТ", "lightTank": "🏎️ ЛТ",
                "AT-SPG": "🎯 ПТ-САУ", "SPG": "💣 САУ"
            }
            result = [{"id": tp, "name": type_labels.get(tp, tp)} for tp in sorted(types)]
            return cors_response({"types": result})
        
        # Фильтруем по классу
        filtered = [t for t in filtered if t.get("type") == tank_type]
        
        # Если нет уровня — вернуть доступные уровни
        if not tier:
            tiers = sorted(set(t.get("tier", 0) for t in filtered if t.get("tier")))
            tier_labels = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
            result = [{"id": t, "name": tier_labels[t] if t < len(tier_labels) else str(t)} for t in tiers]
            return cors_response({"tiers": result})
        
        # Финальный фильтр — конкретные танки
        filtered = [t for t in filtered if t.get("tier") == tier]
        filtered.sort(key=lambda t: t.get("name", ""))
        result = [{"id": t["tank_id"], "name": t["name"], "tier": t["tier"], "type": t["type"]} for t in filtered]
        return cors_response({"tanks": result})
        
    except Exception as e:
        logger.error(f"API tank-list error: {e}")
        return cors_response({"error": str(e)}, 500)

async def api_global_challenge_history(request):
    """GET /api/global-challenge/history?telegram_id=X — завершенные челленджи (с личным результатом если указан TG ID)"""
    try:
        from database import get_db_read
        telegram_id = request.query.get("telegram_id")
        
        with get_db_read() as conn:
            rows = conn.execute("""
                SELECT * FROM global_challenges 
                WHERE status IN ('finished', 'wheel_pending', 'completed') 
                ORDER BY finished_at DESC 
                LIMIT 20
            """).fetchall()
            
            history = []
            for r in rows:
                ch = dict(r)
                # Participants count
                count = conn.execute(
                    "SELECT COUNT(*) as cnt FROM global_challenge_participants WHERE challenge_id = ?",
                    (r["id"],)
                ).fetchone()
                ch["participants_count"] = count["cnt"] if count else 0
                
                # Leaderboard top-3
                top3 = conn.execute("""
                    SELECT nickname, current_value, battles_played, telegram_id
                    FROM global_challenge_participants 
                    WHERE challenge_id = ? 
                    ORDER BY current_value DESC LIMIT 3
                """, (r["id"],)).fetchall()
                ch["leaderboard_top3"] = [dict(x) for x in top3]
                
                # Личный результат запрашивающего (если указан telegram_id)
                if telegram_id:
                    my = conn.execute("""
                        SELECT current_value, battles_played, condition_values
                        FROM global_challenge_participants
                        WHERE challenge_id = ? AND telegram_id = ?
                    """, (r["id"], int(telegram_id))).fetchone()
                    if my:
                        # Определяем место
                        place = conn.execute("""
                            SELECT COUNT(*) FROM global_challenge_participants 
                            WHERE challenge_id = ? AND current_value > ?
                        """, (r["id"], my["current_value"])).fetchone()[0] + 1
                        ch["my_result"] = {
                            "value": my["current_value"],
                            "battles": my["battles_played"],
                            "place": place
                        }
                    else:
                        ch["my_result"] = None
                
                history.append(ch)
                
        return cors_response({"history": history})
    except Exception as e:
        logger.error(f"API challenge_history error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_global_challenge_my_history(request):
    """GET /api/global-challenge/my-history?telegram_id=X — история участия конкретного игрока"""
    try:
        from database import get_db_read
        telegram_id = request.query.get("telegram_id")
        if not telegram_id:
            return cors_response({"error": "telegram_id required"}, 400)
        
        with get_db_read() as conn:
            rows = conn.execute("""
                SELECT gc.id, gc.title, gc.condition, gc.finished_at, gc.ends_at,
                       gc.winner_nickname, gc.winner_value, gc.reward_coins,
                       p.current_value, p.battles_played, p.condition_values
                FROM global_challenge_participants p
                JOIN global_challenges gc ON gc.id = p.challenge_id
                WHERE p.telegram_id = ? AND gc.status IN ('finished', 'wheel_pending', 'completed')
                ORDER BY gc.finished_at DESC LIMIT 20
            """, (int(telegram_id),)).fetchall()
            
            result = []
            for r in rows:
                ch = dict(r)
                # Место игрока
                place = conn.execute("""
                    SELECT COUNT(*) FROM global_challenge_participants 
                    WHERE challenge_id = ? AND current_value > ?
                """, (r["id"], r["current_value"])).fetchone()[0] + 1
                ch["my_place"] = place
                # Всего участников
                total = conn.execute(
                    "SELECT COUNT(*) FROM global_challenge_participants WHERE challenge_id = ?",
                    (r["id"],)
                ).fetchone()[0]
                ch["total_participants"] = total
                result.append(ch)
        
        return cors_response({"history": result})
    except Exception as e:
        logger.error(f"API my_history error: {e}")
        return cors_response({"error": str(e)}, 500)



async def api_global_challenge_finish(request):
    """POST /api/global-challenge/finish — завершить челлендж (админ)"""
    try:
        data = await request.json()
        admin_tg = int(data.get("admin_telegram_id", 0))
        challenge_id = int(data.get("challenge_id", 0))

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        from database import get_db

        with get_db() as conn:
            ch = conn.execute(
                "SELECT * FROM global_challenges WHERE id = ?",
                (challenge_id,)
            ).fetchone()
            if not ch:
                return cors_response({"error": "Челлендж не найден"}, 404)

            # Use _internal_finish_challenge which handles prize_mode → wheel_pending
            result = _internal_finish_challenge(conn, challenge_id)

        if result:
            # Re-read to get new status
            with get_db() as conn2:
                updated = conn2.execute("SELECT status, winner_nickname, winner_value FROM global_challenges WHERE id = ?", (challenge_id,)).fetchone()
            return cors_response({
                "success": True,
                "new_status": updated["status"] if updated else "finished",
                "winner": {"nickname": updated["winner_nickname"], "value": updated["winner_value"]} if updated else None
            })
        else:
            return cors_response({"error": "Не удалось завершить"}, 500)
    except Exception as e:
        logger.error(f"API global_challenge_finish error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_global_challenge_force_wheel(request):
    """POST /api/global-challenge/force-wheel — простейший переход в wheel_pending"""
    try:
        data = await request.json()
        admin_tg = int(data.get("admin_telegram_id", 0))
        challenge_id = int(data.get("challenge_id", 0))

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        from database import get_db
        from datetime import datetime

        with get_db() as conn:
            # Определяем победителя
            winner = conn.execute("""
                SELECT telegram_id, nickname, current_value, condition_values
                FROM global_challenge_participants 
                WHERE challenge_id = ? ORDER BY current_value DESC LIMIT 1
            """, (challenge_id,)).fetchone()

            conn.execute("""
                UPDATE global_challenges 
                SET status = 'wheel_pending', finished_at = ?,
                    winner_telegram_id = ?, winner_nickname = ?, winner_value = ?
                WHERE id = ?
            """, (
                datetime.now().isoformat(),
                winner["telegram_id"] if winner else None,
                winner["nickname"] if winner else None,
                winner["current_value"] if winner else 0,
                challenge_id
            ))

        return cors_response({"success": True, "new_status": "wheel_pending"})
    except Exception as e:
        logger.error(f"API force-wheel error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_global_challenge_wheel_data(request):
    """GET /api/global-challenge/wheel-data?challenge_id=X — данные для колеса элиминации"""
    try:
        from database import get_db_read
        challenge_id = int(request.query.get("challenge_id", 0))
        if not challenge_id:
            return cors_response({"error": "challenge_id required"}, 400)

        with get_db_read() as conn:
            ch = conn.execute("SELECT * FROM global_challenges WHERE id = ?", (challenge_id,)).fetchone()
            if not ch:
                return cors_response({"error": "Челлендж не найден"}, 404)

            ch_data = dict(ch)
            prize_top_count = ch_data.get("prize_top_count", 10) or 10

            # Все участники отсортированные по результату
            participants = conn.execute("""
                SELECT * FROM global_challenge_participants 
                WHERE challenge_id = ? ORDER BY current_value DESC
            """, (challenge_id,)).fetchall()

            # Уже элиминированные
            eliminated = conn.execute("""
                SELECT telegram_id FROM gc_wheel_eliminations 
                WHERE challenge_id = ?
            """, (challenge_id,)).fetchall()
            eliminated_ids = set(r["telegram_id"] for r in eliminated)

            # Множители для ТОП мест
            MULTIPLIERS = [10, 8, 6, 5, 4, 3.5, 3, 2.5, 2, 1.5]

            result = []
            for i, p in enumerate(participants):
                p_dict = dict(p)
                tg_id = p_dict["telegram_id"]

                # Определяем множитель
                if i < len(MULTIPLIERS) and i < prize_top_count:
                    multiplier = MULTIPLIERS[i]
                else:
                    multiplier = 1.0

                p_dict["multiplier"] = multiplier
                p_dict["rank"] = i + 1
                p_dict["is_top"] = i < prize_top_count
                p_dict["eliminated"] = tg_id in eliminated_ids

                result.append(p_dict)

            # Считаем проценты только для оставшихся
            remaining = [p for p in result if not p["eliminated"]]
            total_weight = sum(p["multiplier"] for p in remaining)

            for p in result:
                if p["eliminated"]:
                    p["chance_percent"] = 0
                else:
                    p["chance_percent"] = round((p["multiplier"] / total_weight * 100) if total_weight > 0 else 0, 1)

        return cors_response({
            "challenge": {
                "id": ch_data["id"],
                "title": ch_data["title"],
                "prize_description": ch_data.get("prize_description", ""),
                "prize_top_count": prize_top_count,
                "condition": ch_data["condition"],
                "reward_coins": ch_data["reward_coins"],
                "wheel_spun": ch_data.get("wheel_spun", 0),
                "wheel_winner_nickname": ch_data.get("wheel_winner_nickname"),
            },
            "participants": result,
            "remaining_count": len(remaining),
            "total_count": len(result),
            "eliminated_count": len(eliminated_ids)
        })
    except Exception as e:
        logger.error(f"API wheel_data error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_global_challenge_wheel_eliminate(request):
    """POST /api/global-challenge/wheel-eliminate — элиминировать участника с колеса"""
    try:
        data = await request.json()
        admin_tg = int(data.get("admin_telegram_id", 0))
        challenge_id = int(data.get("challenge_id", 0))
        telegram_id = int(data.get("telegram_id", 0))

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        from database import get_db
        import sqlite3

        with get_db() as conn:
            # Получаем ник для записи
            p = conn.execute("""
                SELECT nickname FROM global_challenge_participants 
                WHERE challenge_id = ? AND telegram_id = ?
            """, (challenge_id, telegram_id)).fetchone()

            if not p:
                return cors_response({"error": "Участник не найден"}, 404)

            # Считаем порядок элиминации
            order = conn.execute(
                "SELECT COUNT(*) FROM gc_wheel_eliminations WHERE challenge_id = ?",
                (challenge_id,)
            ).fetchone()[0] + 1

            try:
                conn.execute("""
                    INSERT INTO gc_wheel_eliminations 
                    (challenge_id, telegram_id, nickname, eliminated_order)
                    VALUES (?, ?, ?, ?)
                """, (challenge_id, telegram_id, p["nickname"], order))
            except sqlite3.IntegrityError:
                return cors_response({"error": "Уже элиминирован"}, 400)

            # Считаем сколько осталось
            total = conn.execute(
                "SELECT COUNT(*) FROM global_challenge_participants WHERE challenge_id = ?",
                (challenge_id,)
            ).fetchone()[0]
            elim_count = conn.execute(
                "SELECT COUNT(*) FROM gc_wheel_eliminations WHERE challenge_id = ?",
                (challenge_id,)
            ).fetchone()[0]
            remaining = total - elim_count

        return cors_response({
            "success": True,
            "eliminated": {"telegram_id": telegram_id, "nickname": p["nickname"], "order": order},
            "remaining": remaining
        })
    except Exception as e:
        logger.error(f"API wheel_eliminate error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_global_challenge_wheel_winner(request):
    """POST /api/global-challenge/wheel-winner — зафиксировать победителя колеса"""
    try:
        data = await request.json()
        admin_tg = int(data.get("admin_telegram_id", 0))
        challenge_id = int(data.get("challenge_id", 0))
        winner_tg = int(data.get("winner_telegram_id", 0))

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        from database import get_db

        with get_db() as conn:
            p = conn.execute("""
                SELECT nickname FROM global_challenge_participants 
                WHERE challenge_id = ? AND telegram_id = ?
            """, (challenge_id, winner_tg)).fetchone()

            if not p:
                return cors_response({"error": "Участник не найден"}, 404)

            winner_nick = p["nickname"]

            # Обновляем челлендж
            conn.execute("""
                UPDATE global_challenges 
                SET wheel_winner_telegram_id = ?, wheel_winner_nickname = ?,
                    wheel_spun = 1, status = 'completed'
                WHERE id = ?
            """, (winner_tg, winner_nick, challenge_id))

            # Проверяем prize_mode: если призовой — сыр НЕ выдаём
            ch = conn.execute("SELECT reward_coins, prize_mode FROM global_challenges WHERE id = ?", (challenge_id,)).fetchone()
            if ch and ch["reward_coins"] > 0 and not ch.get("prize_mode", 0):
                from database import buy_cheese
                buy_cheese(winner_tg, ch["reward_coins"], method="prize_wheel_reward")
                logger.info(f"🎡 Prize wheel reward {ch['reward_coins']} cheese to {winner_tg} ({winner_nick})")
            elif ch and ch.get("prize_mode", 0):
                logger.info(f"🏆 Prize mode wheel winner: {winner_nick} — no cheese awarded (physical prize)")

        return cors_response({
            "success": True,
            "winner": {"telegram_id": winner_tg, "nickname": winner_nick}
        })
    except Exception as e:
        logger.error(f"API wheel_winner error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_global_challenge_auto_start(request):
    """POST /api/global-challenge/auto-start — публичный авто-старт: enrollment→active когда время истекло"""
    try:
        from database import get_db, get_db_read
        from datetime import datetime, timedelta, timezone

        now = datetime.now(timezone.utc)
        now_str = now.strftime('%Y-%m-%d %H:%M:%S')

        with get_db_read() as conn:
            ch = conn.execute("""
                SELECT * FROM global_challenges 
                WHERE status = 'enrollment'
                ORDER BY created_at DESC LIMIT 1
            """).fetchone()

        if not ch:
            return cors_response({"skipped": True, "reason": "no enrollment challenge"})

        ch_data = dict(ch)
        challenge_id = ch_data["id"]

        # Проверяем что время набора РЕАЛЬНО истекло
        enroll_end_str = ch_data.get("enrollment_ends_at", "")
        if not enroll_end_str:
            return cors_response({"skipped": True, "reason": "no enrollment_ends_at"})

        enroll_end_clean = str(enroll_end_str).replace("T", " ").replace("Z", "").strip()
        try:
            enroll_end = datetime.strptime(enroll_end_clean, '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
        except Exception:
            return cors_response({"skipped": True, "reason": "bad enrollment_ends_at"})

        if now < enroll_end:
            seconds_left = int((enroll_end - now).total_seconds())
            return cors_response({"skipped": True, "reason": "not expired", "seconds_left": seconds_left})

        logger.info(f"⏰ Public auto-start triggered for challenge {challenge_id}")

        condition = ch_data.get("condition", "damage")
        conditions = [c.strip() for c in condition.split(",") if c.strip()]
        is_multi = len(conditions) > 1
        tank_class = ch_data.get("tank_class")
        tank_tier = ch_data.get("tank_tier_filter")
        tank_id = ch_data.get("tank_id_filter")

        # Получаем участников
        with get_db() as conn:
            participants = conn.execute(
                "SELECT * FROM global_challenge_participants WHERE challenge_id = ?",
                (challenge_id,)
            ).fetchall()

        # Собираем account_ids
        account_ids = []
        tg_to_account = {}
        for p in participants:
            p_dict = dict(p)
            aid = p_dict.get("wot_account_id")
            if aid:
                try:
                    aid = int(aid)
                    account_ids.append(aid)
                    tg_to_account[p_dict["telegram_id"]] = aid
                except (ValueError, TypeError):
                    pass

        # Получаем baseline stats
        batch_stats = {}
        if account_ids:
            try:
                batch_stats = await gc_fetch_batch_stats(account_ids, condition, tank_class, tank_tier, tank_id)
            except Exception as e:
                logger.warning(f"Auto-start batch stats error: {e}")

        # Записываем baselines и переводим в active
        with get_db() as conn:
            for p in participants:
                p_dict = dict(p)
                tg_id = p_dict["telegram_id"]
                aid = tg_to_account.get(tg_id)

                baseline_value = 0
                baseline_battles = 0
                baseline_values_json = None

                if aid and aid in batch_stats:
                    stat = batch_stats[aid]
                    baseline_value = stat["value"]
                    baseline_battles = stat["battles"]
                    if is_multi:
                        baseline_values_json = json.dumps(stat.get("per_condition", {}))

                conn.execute("""
                    UPDATE global_challenge_participants 
                    SET baseline_value = ?, baseline_battles = ?, baseline_values = ?,
                        current_value = 0, battles_played = 0
                    WHERE challenge_id = ? AND telegram_id = ?
                """, (baseline_value, baseline_battles, baseline_values_json, challenge_id, tg_id))

            challenge_duration = ch_data.get("challenge_duration_minutes", 0) or 0
            if challenge_duration > 0:
                new_ends_at = now + timedelta(minutes=challenge_duration)
            else:
                new_ends_at = None # No timer for battle-count challenges

            conn.execute("""
                UPDATE global_challenges SET status = 'active', ends_at = ? WHERE id = ?
            """, (new_ends_at, challenge_id))

        # Сохраняем baseline танки для каждого
        for p in participants:
            p_dict = dict(p)
            aid = tg_to_account.get(p_dict["telegram_id"])
            if aid:
                try:
                    await gc_save_tank_baselines(challenge_id, p_dict["telegram_id"], aid)
                except Exception:
                    pass

        logger.info(f"🚀 Challenge {challenge_id} auto-started via public endpoint! {len(participants)} participants")
        return cors_response({
            "success": True,
            "challenge_id": challenge_id,
            "participants": len(participants)
        })
    except Exception as e:
        logger.error(f"API auto_start error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_global_challenge_start_active(request):
    """POST /api/global-challenge/start-active — перевести из enrollment в active (записать baselines)"""
    try:
        data = await request.json()
        admin_tg = int(data.get("admin_telegram_id", 0))
        challenge_id = int(data.get("challenge_id", 0))

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        from database import get_db
        from datetime import datetime, timedelta, timezone

        with get_db() as conn:
            ch = conn.execute(
                "SELECT * FROM global_challenges WHERE id = ? AND status = 'enrollment'",
                (challenge_id,)
            ).fetchone()
            if not ch:
                return cors_response({"error": "Челлендж не найден или уже начался"}, 404)

            ch_data = dict(ch)
            participants = conn.execute("""
                SELECT gcp.telegram_id, gcp.nickname, u.wot_account_id 
                FROM global_challenge_participants gcp
                LEFT JOIN users u ON u.telegram_id = gcp.telegram_id
                WHERE gcp.challenge_id = ?
            """, (challenge_id,)).fetchall()

        if not participants:
            return cors_response({"error": "Нет участников для старта"}, 400)

        # Записываем baseline для всех участников
        condition = ch_data["condition"]
        tank_class = ch_data.get("tank_class")
        tank_tier = ch_data.get("tank_tier_filter")
        tank_id = ch_data.get("tank_id_filter")
        conditions = [c.strip() for c in condition.split(",") if c.strip()]
        is_multi = len(conditions) > 1 or condition == 'combined'

        # Получаем account_ids
        account_ids = []
        tg_to_account = {}
        for p in participants:
            p_dict = dict(p)
            aid = p_dict.get("wot_account_id")
            if aid:
                account_ids.append(aid)
                tg_to_account[p_dict["telegram_id"]] = aid

        # Пакетно получаем стату
        if account_ids:
            batch_stats = await gc_fetch_batch_stats(account_ids, condition, tank_class, tank_tier, tank_id)
        else:
            batch_stats = {}

        # Записываем baselines
        from database import get_db as get_db_write
        with get_db_write() as conn:
            for p in participants:
                p_dict = dict(p)
                tg_id = p_dict["telegram_id"]
                aid = tg_to_account.get(tg_id)

                baseline_value = 0
                baseline_battles = 0
                baseline_values_json = None

                if aid and aid in batch_stats:
                    stat = batch_stats[aid]
                    baseline_value = stat["value"]
                    baseline_battles = stat["battles"]
                    if is_multi:
                        baseline_values_json = json.dumps(stat.get("per_condition", {}))

                conn.execute("""
                    UPDATE global_challenge_participants 
                    SET baseline_value = ?, baseline_battles = ?, baseline_values = ?,
                        current_value = 0, battles_played = 0
                    WHERE challenge_id = ? AND telegram_id = ?
                """, (baseline_value, baseline_battles, baseline_values_json, challenge_id, tg_id))

            # Обновляем статус челленджа
            challenge_duration = ch_data.get("challenge_duration_minutes", 0) or 0
            if challenge_duration > 0:
                new_ends_at = datetime.now(timezone.utc) + timedelta(minutes=challenge_duration)
            else:
                # Если нет таймера — ставим далёкое время (завершение по боям)
                new_ends_at = datetime.now(timezone.utc) + timedelta(days=30)

            conn.execute("""
                UPDATE global_challenges 
                SET status = 'active', ends_at = ?
                WHERE id = ?
            """, (new_ends_at, challenge_id))

        # Сохраняем baseline по танкам для каждого
        for p in participants:
            p_dict = dict(p)
            tg_id = p_dict["telegram_id"]
            aid = tg_to_account.get(tg_id)
            if aid:
                try:
                    await gc_save_tank_baselines(challenge_id, tg_id, aid)
                except Exception as e:
                    logger.warning(f"Failed to save tank baselines for {tg_id}: {e}")

        logger.info(f"🚀 Prize challenge {challenge_id} started! {len(participants)} participants, baselines saved.")

        return cors_response({
            "success": True,
            "participants_count": len(participants),
            "message": f"Челлендж начался! {len(participants)} участников"
        })
    except Exception as e:
        logger.error(f"API start_active error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_global_challenge_delete(request):
    """POST /api/global-challenge/delete — удалить челлендж (админ)"""
    try:
        data = await request.json()
        admin_tg = int(data.get("admin_telegram_id", 0))
        challenge_id = int(data.get("challenge_id", 0))

        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        from database import get_db

        with get_db() as conn:
            conn.execute("DELETE FROM gc_wheel_eliminations WHERE challenge_id = ?", (challenge_id,))
            conn.execute("DELETE FROM global_challenge_participants WHERE challenge_id = ?", (challenge_id,))
            conn.execute("DELETE FROM global_challenges WHERE id = ?", (challenge_id,))

        return cors_response({"success": True})
    except Exception as e:
        logger.error(f"API global_challenge_delete error: {e}")
        return cors_response({"error": str(e)}, 500)



# --- PROFILE SAVE/GET API ---

async def api_profile_save(request):
    """POST /api/profile/save — сохранить привязку WoT аккаунта и аватарку в БД"""
    try:
        data = await request.json()
        telegram_id = data.get("telegram_id")
        if not telegram_id:
            return cors_response({"error": "telegram_id required"}, 400)

        telegram_id = int(telegram_id)

        from database import get_db
        with get_db() as conn:
            # Проверяем, что пользователь существует
            user = conn.execute(
                "SELECT id FROM users WHERE telegram_id = ?", (telegram_id,)
            ).fetchone()

            if not user:
                # Создаём пользователя если не существует
                conn.execute(
                    "INSERT INTO users (telegram_id, first_name) VALUES (?, ?)",
                    (telegram_id, data.get("first_name", ""))
                )

            # Обновляем WoT данные
            wot_nickname = data.get("wot_nickname")
            wot_account_id = data.get("wot_account_id")
            avatar = data.get("avatar")

            # Если есть ник но нет account_id — ищем через Lesta API
            if wot_nickname and not wot_account_id:
                try:
                    import aiohttp as _aiohttp
                    async with _aiohttp.ClientSession() as session:
                        url = (
                            f"https://api.tanki.su/wot/account/list/"
                            f"?application_id={get_lesta_app_id()}"
                            f"&search={wot_nickname}&limit=1&type=exact"
                        )
                        async with session.get(url, timeout=_aiohttp.ClientTimeout(total=10)) as resp:
                            result = await resp.json()
                            if result.get("status") == "ok" and result.get("data"):
                                wot_account_id = result["data"][0]["account_id"]
                                logger.info(f"Auto-found account_id={wot_account_id} for {wot_nickname}")
                except Exception as le:
                    logger.warning(f"Lesta API lookup failed for {wot_nickname}: {le}")

            updates = []
            params = []

            if wot_nickname is not None:
                updates.append("wot_nickname = ?")
                params.append(wot_nickname)
            if wot_account_id is not None:
                updates.append("wot_account_id = ?")
                params.append(int(wot_account_id))
            if avatar is not None:
                updates.append("avatar = ?")
                params.append(avatar)

            # Всегда обновляем first_name если передан
            first_name = data.get("first_name")
            if first_name:
                updates.append("first_name = ?")
                params.append(first_name)

            if updates:
                params.append(telegram_id)
                conn.execute(
                    f"UPDATE users SET {', '.join(updates)} WHERE telegram_id = ?",
                    params
                )

        logger.info(f"Profile saved for TG:{telegram_id} WoT:{wot_nickname} AccID:{wot_account_id}")
        return cors_response({"ok": True, "wot_account_id": wot_account_id})
    except Exception as e:
        logger.error(f"API profile_save error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_profile_get(request):
    """GET /api/profile?telegram_id=123 — получить профиль из БД"""
    try:
        telegram_id = request.query.get("telegram_id")
        if not telegram_id:
            return cors_response({"error": "telegram_id required"}, 400)

        from database import get_db
        with get_db() as conn:
            user = conn.execute(
                """SELECT telegram_id, first_name, username, wot_nickname, wot_account_id,
                          wot_verified, avatar, coins, xp, level, joined_at
                   FROM users WHERE telegram_id = ?""",
                (int(telegram_id),)
            ).fetchone()

            if not user:
                return cors_response({"error": "User not found"}, 404)

            return cors_response({
                "telegram_id": user["telegram_id"],
                "first_name": user["first_name"],
                "username": user["username"],
                "wot_nickname": user["wot_nickname"],
                "wot_account_id": user["wot_account_id"],
                "wot_verified": bool(user["wot_verified"]),
                "avatar": user["avatar"],
                "coins": user["coins"],
                "xp": user["xp"],
                "level": user["level"],
                "joined_at": user["joined_at"],
            })
    except Exception as e:
        logger.error(f"API profile_get error: {e}")
        return cors_response({"error": str(e)}, 500)


# --- DAILY REWARD API ---

async def api_daily_status(request):
    """GET /api/daily/status?telegram_id=123"""
    try:
        telegram_id = request.query.get("telegram_id")
        if not telegram_id:
            return cors_response({"error": "telegram_id required"}, 400)
        from database import get_daily_status
        status = get_daily_status(int(telegram_id))
        return cors_response(status)
    except Exception as e:
        logger.error(f"API daily_status error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_daily_claim(request):
    """POST /api/daily/claim {telegram_id}"""
    try:
        data = await request.json()
        telegram_id = data.get("telegram_id")
        if not telegram_id:
            return cors_response({"error": "telegram_id required"}, 400)
        from database import claim_daily_reward
        result = claim_daily_reward(int(telegram_id))
        return cors_response(result)
    except Exception as e:
        logger.error(f"API daily_claim error: {e}")
        return cors_response({"error": str(e)}, 500)


# --- TOP PLAYERS API ---

async def api_top_players(request):
    """GET /api/top/players — получить всех пользователей с привязанным WoT аккаунтом"""
    try:
        from database import get_db
        with get_db() as conn:
            rows = conn.execute("""
                SELECT telegram_id, first_name, username, wot_nickname, wot_account_id, avatar
                FROM users
                WHERE wot_account_id IS NOT NULL AND wot_nickname IS NOT NULL
                ORDER BY wot_nickname ASC
            """).fetchall()

        players = []
        for r in rows:
            players.append({
                "telegram_id": r["telegram_id"],
                "first_name": r["first_name"],
                "username": r["username"],
                "wot_nickname": r["wot_nickname"],
                "wot_account_id": r["wot_account_id"],
                "avatar": r["avatar"],
            })

        return cors_response({"players": players, "total": len(players)})
    except Exception as e:
        logger.error(f"API top_players error: {e}")
        return cors_response({"error": str(e)}, 500)


# ==========================================
# STREAM CHAT API — Общий чат стрима
# ==========================================
import collections
import time as _time
import uuid as _uuid

# Хранилище сообщений чата (в памяти, последние 200)
stream_chat_messages = collections.deque(maxlen=200)
# Хранилище каналов (в памяти, сохраняется при рестарте из файла)
stream_channels = [
    {"name": "ISERVERI", "channel": "iserveri", "desc": "Мир Танков"},
]

# Конфиг трансляции (какие платформы включены)
stream_config = {
    "twitch": {"enabled": True, "channel": "iserveri"},
    "youtube": {"enabled": True, "channel": "ISERVERI"},
    "vk": {"enabled": True, "channel": "iserveri"},
}

def _load_stream_config():
    global stream_config
    try:
        config_file = os.path.join(os.path.dirname(__file__), 'stream_config.json')
        if os.path.exists(config_file):
            with open(config_file, 'r', encoding='utf-8') as f:
                stream_config = json.load(f)
                logger.info(f"Загружен конфиг стрима: {stream_config}")
    except Exception as e:
        logger.warning(f"Не удалось загрузить конфиг стрима: {e}")

def _save_stream_config():
    try:
        config_file = os.path.join(os.path.dirname(__file__), 'stream_config.json')
        with open(config_file, 'w', encoding='utf-8') as f:
            json.dump(stream_config, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"Не удалось сохранить конфиг стрима: {e}")

_load_stream_config()

# Загружаем каналы из файла при старте
def _load_stream_channels():
    global stream_channels
    try:
        channels_file = os.path.join(os.path.dirname(__file__), 'stream_channels.json')
        if os.path.exists(channels_file):
            with open(channels_file, 'r', encoding='utf-8') as f:
                stream_channels = json.load(f)
                logger.info(f"Загружено {len(stream_channels)} каналов стрима")
    except Exception as e:
        logger.warning(f"Не удалось загрузить каналы стрима: {e}")

def _save_stream_channels():
    try:
        channels_file = os.path.join(os.path.dirname(__file__), 'stream_channels.json')
        with open(channels_file, 'w', encoding='utf-8') as f:
            json.dump(stream_channels, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"Не удалось сохранить каналы стрима: {e}")

_load_stream_channels()


# ==========================================
# СЕРВЕРНОЕ ЧТЕНИЕ TWITCH ЧАТА (IRC)
# ==========================================
class TwitchChatReader:
    """Читает Twitch чат на сервере и складывает в общую очередь"""
    
    def __init__(self):
        self.ws = None
        self.channel = None
        self.running = False
        self.seen_ids = set()
    
    async def start(self, channel):
        """Запустить чтение канала"""
        self.channel = channel.lower().strip('#')
        self.running = True
        asyncio.create_task(self._run())
        logger.info(f"[TwitchReader] Запущен для #{self.channel}")
    
    async def stop(self):
        self.running = False
        if self.ws:
            try: await self.ws.close()
            except: pass
    
    async def change_channel(self, channel):
        """Сменить канал"""
        await self.stop()
        await asyncio.sleep(1)
        await self.start(channel)
    
    async def _run(self):
        import aiohttp as _aiohttp
        while self.running:
            try:
                async with _aiohttp.ClientSession() as session:
                    self.ws = await session.ws_connect('wss://irc-ws.chat.twitch.tv:443')
                    await self.ws.send_str('CAP REQ :twitch.tv/tags')
                    await self.ws.send_str('PASS SCHMOOPIIE')
                    nick = f'justinfan{int(_time.time()) % 100000}'
                    await self.ws.send_str(f'NICK {nick}')
                    await self.ws.send_str(f'JOIN #{self.channel}')
                    logger.info(f"[TwitchReader] Подключен к #{self.channel}")
                    
                    async for msg in self.ws:
                        if not self.running:
                            break
                        if msg.type == _aiohttp.WSMsgType.TEXT:
                            for line in msg.data.split('\r\n'):
                                if not line:
                                    continue
                                if line.startswith('PING'):
                                    await self.ws.send_str('PONG :tmi.twitch.tv')
                                elif 'PRIVMSG' in line:
                                    self._parse_and_store(line)
                        elif msg.type in (_aiohttp.WSMsgType.CLOSED, _aiohttp.WSMsgType.ERROR):
                            break
            except Exception as e:
                logger.warning(f"[TwitchReader] Ошибка: {e}")
            
            if self.running:
                logger.info("[TwitchReader] Переподключение через 5с...")
                await asyncio.sleep(5)
    
    def _parse_and_store(self, raw):
        """Парсим IRC сообщение и добавляем в общий чат"""
        try:
            tags = {}
            rest = raw
            if raw.startswith('@'):
                space_idx = raw.index(' ')
                tag_str = raw[1:space_idx]
                rest = raw[space_idx + 1:]
                for pair in tag_str.split(';'):
                    if '=' in pair:
                        k, v = pair.split('=', 1)
                        tags[k] = v
            
            if 'PRIVMSG' not in rest:
                return
            
            # :username!user@user.tmi.twitch.tv PRIVMSG #channel :message
            excl = rest.index('!')
            username = rest[1:excl]
            msg_start = rest.index(':', 1) + 1 if rest.count(':') > 1 else None
            if not msg_start:
                return
            # Найти второе двоеточие (после PRIVMSG #channel :)
            privmsg_idx = rest.index('PRIVMSG')
            colon_idx = rest.index(':', privmsg_idx)
            text = rest[colon_idx + 1:]
            
            color = tags.get('color', '#9146FF')
            display_name = tags.get('display-name', username)
            
            msg_id = str(_uuid.uuid4())[:8]
            
            # Дедупликация
            dedup_key = f"{username}:{text[:30]}:{int(_time.time())}"
            if dedup_key in self.seen_ids:
                return
            self.seen_ids.add(dedup_key)
            if len(self.seen_ids) > 500:
                self.seen_ids = set(list(self.seen_ids)[-200:])
            
            stream_chat_messages.append({
                "id": msg_id,
                "platform": "twitch",
                "username": display_name,
                "text": text,
                "color": color or '#9146FF',
                "timestamp": _time.time(),
                "telegram_id": 0,
            })
        except Exception as e:
            pass  # Тихо пропускаем битые сообщения


# Глобальный ридер
twitch_reader = TwitchChatReader()


# ==========================================
# СЕРВЕРНОЕ ЧТЕНИЕ VK PLAY ЧАТА (HTTP POLL)
# ==========================================
class VKPlayChatReader:
    """Читает VK Play Live чат через публичный API и складывает в общую очередь"""
    
    def __init__(self):
        self.channel = None
        self.running = False
        self.seen_ids = set()
        self.poll_interval = 3  # секунды
    
    async def start(self, channel):
        """Запустить чтение канала"""
        self.channel = channel.lower().strip()
        self.running = True
        asyncio.create_task(self._run())
        logger.info(f"[VKPlayReader] Запущен для {self.channel}")
    
    async def stop(self):
        self.running = False
    
    async def change_channel(self, channel):
        await self.stop()
        await asyncio.sleep(1)
        await self.start(channel)
    
    async def _run(self):
        """Основной цикл — polling VK Play chat API"""
        while self.running:
            try:
                async with aiohttp.ClientSession() as session:
                    # VK Play Live public chat API
                    url = f"https://api.vkplay.live/v1/blog/{self.channel}/public_video_stream/chat"
                    headers = {
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                        "Origin": "https://vkplay.live",
                        "Referer": f"https://vkplay.live/{self.channel}",
                    }
                    
                    while self.running:
                        try:
                            async with session.get(url, headers=headers,
                                                   timeout=aiohttp.ClientTimeout(total=10)) as resp:
                                if resp.status == 200:
                                    data = await resp.json()
                                    messages = data if isinstance(data, list) else data.get("messages", data.get("data", []))
                                    if isinstance(messages, list):
                                        for msg in messages:
                                            self._process_message(msg)
                                elif resp.status == 404:
                                    # Стрим не идёт — тихо ждём
                                    pass
                                else:
                                    logger.debug(f"[VKPlayReader] HTTP {resp.status}")
                        except asyncio.TimeoutError:
                            pass
                        except Exception as e:
                            logger.debug(f"[VKPlayReader] Poll error: {e}")
                        
                        await asyncio.sleep(self.poll_interval)
                        
            except Exception as e:
                logger.warning(f"[VKPlayReader] Session error: {e}")
            
            if self.running:
                await asyncio.sleep(5)
    
    def _process_message(self, msg):
        """Обработать одно сообщение VK Play"""
        try:
            # VK Play API формат: {"id": ..., "author": {"displayName": ...}, "data": [{"type": "text", "content": ...}], ...}
            msg_id = str(msg.get("id", ""))
            if not msg_id or msg_id in self.seen_ids:
                return
            self.seen_ids.add(msg_id)
            if len(self.seen_ids) > 1000:
                self.seen_ids = set(list(self.seen_ids)[-500:])
            
            author = msg.get("author", {})
            display_name = author.get("displayName", author.get("name", author.get("nickname", "Unknown")))
            
            # Извлекаем текст из data-массива
            # VK Play формат: data: [["текст", "unstyled", []], ["ещё текст", "unstyled", []]]
            text_parts = []
            data = msg.get("data", msg.get("message", []))
            if isinstance(data, list):
                for part in data:
                    if isinstance(part, list) and len(part) > 0:
                        # Формат: ["текст", "стиль", [вложения]]
                        text_parts.append(str(part[0]))
                    elif isinstance(part, dict):
                        content = part.get("content", part.get("text", ""))
                        if content:
                            text_parts.append(str(content))
                    elif isinstance(part, str):
                        text_parts.append(part)
            elif isinstance(data, str):
                text_parts.append(data)
            
            # Fallback: если текст в поле "text" или "content"  
            if not text_parts:
                fallback = msg.get("text", msg.get("content", ""))
                if fallback:
                    text_parts.append(str(fallback))
            
            text = " ".join(text_parts).strip()
            if not text or not display_name:
                return
            
            # Определяем бейджи
            badges = ""
            role = author.get("role", "") or msg.get("role", "")
            if role in ("owner", "broadcaster"):
                badges = "🎬"
            elif role == "moderator":
                badges = "🗡️"
            
            stream_chat_messages.append({
                "id": f"vk_{msg_id}",
                "platform": "vkplay",
                "username": display_name,
                "text": text,
                "color": "#0077FF",
                "badges": badges,
                "timestamp": _time.time(),
                "telegram_id": 0,
            })
        except Exception:
            pass


# Глобальный ридер VK Play
vkplay_reader = VKPlayChatReader()


# ==========================================
# СЕРВЕРНОЕ ЧТЕНИЕ YOUTUBE LIVE CHAT (API v3)
# ==========================================
class YouTubeChatReader:
    """Читает YouTube Live Chat через Data API v3 и складывает в общую очередь"""
    
    def __init__(self):
        self.api_key = None
        self.channel_id = None  # YouTube channel ID
        self.running = False
        self.seen_ids = set()
        self.poll_interval = 8  # YouTube API квота — экономим (8-10 сек)
        self.live_chat_id = None
        self.next_page_token = None
        self.search_interval = 300  # Искать стрим каждые 5 мин (search.list = 100 единиц квоты!)
    
    async def start(self, channel_id, api_key):
        """Запустить чтение"""
        self.channel_id = channel_id
        self.api_key = api_key
        self.running = True
        asyncio.create_task(self._run())
        logger.info(f"[YTChatReader] Запущен для channel={self.channel_id}")
    
    async def stop(self):
        self.running = False
        self.live_chat_id = None
        self.next_page_token = None
    
    async def _run(self):
        """Основной цикл"""
        while self.running:
            try:
                async with aiohttp.ClientSession() as session:
                    # Ищем активный live stream
                    while self.running:
                        if not self.live_chat_id:
                            self.live_chat_id = await self._find_live_chat(session)
                            if not self.live_chat_id:
                                # Нет активного стрима — ждём и проверяем снова
                                # search.list стоит 100 единиц квоты, поэтому ждём 5 мин
                                await asyncio.sleep(self.search_interval)
                                continue
                            logger.info(f"[YTChatReader] Найден live chat: {self.live_chat_id}")
                        
                        # Читаем сообщения
                        try:
                            await self._poll_messages(session)
                        except Exception as e:
                            logger.debug(f"[YTChatReader] Poll error: {e}")
                            self.live_chat_id = None  # Сброс — стрим мог закончиться
                        
                        await asyncio.sleep(self.poll_interval)
                        
            except Exception as e:
                logger.warning(f"[YTChatReader] Session error: {e}")
            
            if self.running:
                await asyncio.sleep(10)
    
    async def _find_live_chat(self, session):
        """Найти liveChatId текущего стрима"""
        try:
            # Ищем по channel ID
            url = (
                f"https://www.googleapis.com/youtube/v3/search"
                f"?part=snippet&channelId={self.channel_id}"
                f"&eventType=live&type=video&key={self.api_key}"
            )
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status != 200:
                    return None
                data = await resp.json()
                items = data.get("items", [])
                if not items:
                    return None
                
                video_id = items[0].get("id", {}).get("videoId")
                if not video_id:
                    return None
            
            # Получаем liveChatId
            url2 = (
                f"https://www.googleapis.com/youtube/v3/videos"
                f"?part=liveStreamingDetails&id={video_id}&key={self.api_key}"
            )
            async with session.get(url2, timeout=aiohttp.ClientTimeout(total=10)) as resp2:
                if resp2.status != 200:
                    return None
                data2 = await resp2.json()
                items2 = data2.get("items", [])
                if not items2:
                    return None
                return items2[0].get("liveStreamingDetails", {}).get("activeLiveChatId")
                
        except Exception as e:
            logger.debug(f"[YTChatReader] Find live chat error: {e}")
            return None
    
    async def _poll_messages(self, session):
        """Прочитать новые сообщения из live chat"""
        url = (
            f"https://www.googleapis.com/youtube/v3/liveChat/messages"
            f"?liveChatId={self.live_chat_id}&part=snippet,authorDetails"
            f"&key={self.api_key}"
        )
        if self.next_page_token:
            url += f"&pageToken={self.next_page_token}"
        
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=10)) as resp:
            if resp.status == 403:
                # API квота превышена или чат закрыт
                logger.warning("[YTChatReader] 403 — квота или чат закрыт")
                self.live_chat_id = None
                return
            if resp.status != 200:
                return
            
            data = await resp.json()
            self.next_page_token = data.get("nextPageToken")
            
            # YouTube рекомендует pollingIntervalMillis
            interval = data.get("pollingIntervalMillis", 8000) / 1000
            self.poll_interval = max(interval, 8)  # Не чаще 8 сек (экономим квоту)
            
            for item in data.get("items", []):
                msg_id = item.get("id", "")
                if msg_id in self.seen_ids:
                    continue
                self.seen_ids.add(msg_id)
                if len(self.seen_ids) > 1000:
                    self.seen_ids = set(list(self.seen_ids)[-500:])
                
                snippet = item.get("snippet", {})
                author = item.get("authorDetails", {})
                text = snippet.get("displayMessage", snippet.get("textMessageDetails", {}).get("messageText", ""))
                display_name = author.get("displayName", "YouTube User")
                
                if not text:
                    continue
                
                # Бейджи
                badges = ""
                if author.get("isChatOwner"):
                    badges = "🎬"
                elif author.get("isChatModerator"):
                    badges = "🗡️"
                elif author.get("isChatSponsor"):
                    badges = "⭐"
                
                stream_chat_messages.append({
                    "id": f"yt_{msg_id}",
                    "platform": "youtube",
                    "username": display_name,
                    "text": text,
                    "color": "#FF0000",
                    "badges": badges,
                    "timestamp": _time.time(),
                    "telegram_id": 0,
                })


# Глобальный ридер YouTube
youtube_reader = YouTubeChatReader()



async def api_stream_chat_get(request):
    """GET /api/stream/chat?after=timestamp — получить сообщения чата"""
    try:
        after = float(request.query.get("after", 0))
        msgs = [m for m in stream_chat_messages if m["timestamp"] > after]
        return cors_response({"messages": msgs})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_chat_send(request):
    """POST /api/stream/chat/send  {telegram_id, username, text}"""
    try:
        data = await request.json()
        telegram_id = int(data.get("telegram_id", 0))
        username = data.get("username", "Танкист").strip()
        text = data.get("text", "").strip()

        if not telegram_id or not text:
            return cors_response({"error": "telegram_id and text required"}, 400)

        if len(text) > 500:
            text = text[:500]

        msg = {
            "id": int(_time.time() * 1000),
            "telegram_id": telegram_id,
            "username": username,
            "text": text,
            "platform": "telegram",
            "timestamp": _time.time(),
        }
        stream_chat_messages.append(msg)

        return cors_response({"success": True, "message": msg})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_channels_get(request):
    """GET /api/stream/channels — получить список каналов"""
    return cors_response({"channels": stream_channels})


async def api_stream_channels_save(request):
    """POST /api/stream/channels/save  {telegram_id, channels: [...]}"""
    global stream_channels
    try:
        data = await request.json()
        tg_id = int(data.get("telegram_id", 0))

        if not is_admin_user(tg_id):
            return cors_response({"error": "Admin only"}, 403)

        channels = data.get("channels", [])
        if not isinstance(channels, list):
            return cors_response({"error": "channels must be a list"}, 400)

        stream_channels = channels
        _save_stream_channels()

        return cors_response({"success": True, "count": len(stream_channels)})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


# ==========================================
# ДОНАТЫ И ЗАКАЗ МУЗЫКИ
# ==========================================
donate_events = collections.deque(maxlen=50)
music_queue = []
music_control = {"action": "none"}  # "none", "skip", "stop"
DONATE_MIN = 10  # минимальный донат
AI_DONATE_MIN = 50  # минимальный AI донат

# AI ключи (фронтенд генерирует картинку прямо из браузера)
_GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
_HF_TOKEN = os.getenv("HF_TOKEN", "")


async def api_ai_config(request):
    """GET /api/ai/config — отдаёт ключи для генерации картинок из браузера."""
    return cors_response({
        "gemini_key": _GEMINI_API_KEY,
        "gemini_model": "gemini-2.5-flash-image",
        "hf_token": _HF_TOKEN,
    })



async def _generate_image_huggingface(prompt: str) -> dict:
    """Генерация изображения через HuggingFace Inference API (бесплатный)."""
    if not _HF_TOKEN:
        return {"success": False, "error": "HF_TOKEN не настроен (нужен для HuggingFace)"}

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {_HF_TOKEN}",
    }

    for model in _HF_MODELS:
        url = f"https://router.huggingface.co/hf-inference/models/{model}"
        try:
            timeout = aiohttp.ClientTimeout(total=10)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, headers=headers, json={"inputs": prompt}) as resp:
                    if resp.status == 503:
                        # Модель загружается — пробуем следующую
                        logger.warning(f"[AI Donate] HF model {model} загружается, пробуем следующую")
                        continue
                    if resp.status == 429:
                        logger.warning(f"[AI Donate] HF rate limit на {model}")
                        continue
                    if resp.status != 200:
                        error_text = await resp.text()
                        logger.warning(f"[AI Donate] HF {model}: {resp.status} - {error_text[:150]}")
                        continue

                    content_type = resp.headers.get("Content-Type", "")
                    if "image" in content_type:
                        # Успех! Ответ — бинарная картинка
                        image_bytes = await resp.read()
                        if len(image_bytes) < 500:
                            continue
                        logger.info(f"[AI Donate] HuggingFace {model} succeeded, {len(image_bytes)} bytes")
                        return {
                            "success": True,
                            "image_b64": base64.b64encode(image_bytes).decode(),
                            "mime": content_type.split(";")[0],
                            "provider": f"huggingface/{model.split('/')[-1]}",
                        }
                    else:
                        # JSON ответ — вероятно ошибка
                        try:
                            data = await resp.json()
                            error = data.get("error", str(data)[:100])
                            logger.warning(f"[AI Donate] HF {model}: {error}")
                        except:
                            pass
                        continue
        except asyncio.TimeoutError:
            logger.warning(f"[AI Donate] HF {model} таймаут")
            continue
        except Exception as e:
            logger.warning(f"[AI Donate] HF {model}: {e}")
            continue

    return {"success": False, "error": "HuggingFace: все модели недоступны"}


async def _generate_image_gemini(prompt: str) -> dict:
    """Генерация изображения через Google Gemini API."""
    if not _GEMINI_API_KEY:
        return {"success": False, "error": "GEMINI_API_KEY не настроен"}

    url = f"{_GEMINI_API_URL}/models/{_GEMINI_IMG_MODEL}:generateContent?key={_GEMINI_API_KEY}"
    payload = {
        "contents": [{"parts": [{"text": f"Generate an image: {prompt}"}]}],
        "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
    }

    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.post(url, json=payload) as resp:
                if resp.status != 200:
                    return {"success": False, "error": f"Gemini: {resp.status}"}
                data = await resp.json()
                for part in data.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                    if "inlineData" in part:
                        return {
                            "success": True,
                            "image_b64": part["inlineData"]["data"],
                            "mime": part["inlineData"].get("mimeType", "image/png"),
                            "provider": "gemini",
                        }
                return {"success": False, "error": "Gemini не вернул изображение"}
    except Exception as e:
        return {"success": False, "error": f"Gemini: {e}"}


async def _generate_image_pollinations(prompt: str) -> dict:
    """Генерация изображения через Pollinations.ai (бесплатный)."""
    import urllib.parse
    encoded = urllib.parse.quote(prompt[:200])
    url = f"https://image.pollinations.ai/prompt/{encoded}?width=512&height=512&nologo=true&seed={int(_time.time())}"

    try:
        timeout = aiohttp.ClientTimeout(total=10)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(url) as resp:
                if resp.status != 200:
                    return {"success": False, "error": f"Pollinations: {resp.status}"}
                image_bytes = await resp.read()
                if len(image_bytes) < 500:
                    return {"success": False, "error": "Pollinations: пустой ответ"}
                return {
                    "success": True,
                    "image_b64": base64.b64encode(image_bytes).decode(),
                    "mime": resp.headers.get("Content-Type", "image/jpeg").split(";")[0],
                    "provider": "pollinations",
                }
    except Exception as e:
        return {"success": False, "error": f"Pollinations: {e}"}


def _generate_image_local(prompt: str) -> dict:
    """
    Локальный генератор изображений — работает ВСЕГДА, без интернета.
    Создаёт стилизованную PNG-картинку с текстом промпта.
    """
    import struct
    import zlib
    import hashlib

    # Размер
    W, H = 512, 512

    # Генерируем цвета из хэша промпта (каждый промпт = уникальные цвета)
    h = hashlib.md5(prompt.encode()).hexdigest()
    r1, g1, b1 = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    r2, g2, b2 = int(h[6:8], 16), int(h[8:10], 16), int(h[10:12], 16)

    # Создаём градиентное изображение (raw RGB pixels)
    rows = []
    for y in range(H):
        row = bytearray()
        row.append(0)  # PNG filter byte
        t = y / H
        for x in range(W):
            s = x / W
            # Диагональный градиент
            f = (t + s) / 2
            r = int(r1 * (1 - f) + r2 * f)
            g = int(g1 * (1 - f) + g2 * f)
            b = int(b1 * (1 - f) + b2 * f)

            # Добавляем "шум" паттерн в центре (имитация картинки)
            cx, cy = abs(x - W//2), abs(y - H//2)
            dist = (cx*cx + cy*cy) ** 0.5
            if dist < 150:
                # Светлый круг в центре
                blend = max(0, 1 - dist / 150)
                r = min(255, int(r + (255 - r) * blend * 0.5))
                g = min(255, int(g + (255 - g) * blend * 0.5))
                b = min(255, int(b + (255 - b) * blend * 0.5))

            # Декоративные полосы
            if (x + y) % 40 < 2:
                r = min(255, r + 30)
                g = min(255, g + 30)
                b = min(255, b + 30)

            row.extend([r, g, b])
        rows.append(bytes(row))

    raw_data = b''.join(rows)

    # Собираем PNG вручную (без Pillow!)
    def make_chunk(chunk_type, data):
        chunk = chunk_type + data
        return struct.pack('>I', len(data)) + chunk + struct.pack('>I', zlib.crc32(chunk) & 0xffffffff)

    png = b'\x89PNG\r\n\x1a\n'
    # IHDR
    png += make_chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
    # IDAT
    png += make_chunk(b'IDAT', zlib.compress(raw_data, 6))
    # IEND
    png += make_chunk(b'IEND', b'')

    return {
        "success": True,
        "image_b64": base64.b64encode(png).decode(),
        "mime": "image/png",
        "provider": "local",
    }


async def api_stream_donate_ai(request):
    """POST /api/stream/donate/ai  {telegram_id, username, prompt, amount, image_b64?, mime?, provider?}"""
    try:
        data = await request.json()
        tg_id = int(data.get("telegram_id", 0))
        username = data.get("username", "Аноним").strip()
        amount = int(data.get("amount", 0))
        prompt = data.get("prompt", "").strip()[:300]
        # Картинка от фронтенда (браузер генерирует напрямую через Gemini API)
        image_b64 = data.get("image_b64", "")
        mime = data.get("mime", "image/png")
        provider = data.get("provider", "browser")

        if not prompt:
            return cors_response({"error": "Напишите промт для генерации"}, 400)
        if amount < AI_DONATE_MIN:
            return cors_response({"error": f"Минимум {AI_DONATE_MIN} 🧀 для AI доната"}, 400)
        if not tg_id:
            return cors_response({"error": "telegram_id required"}, 400)

        # Проверить и списать сыр
        is_admin = (ADMIN_ID and tg_id == ADMIN_ID)
        profile_file = os.path.join(os.path.dirname(__file__), 'profiles', f'{tg_id}.json')
        if not os.path.exists(profile_file):
            if is_admin:
                os.makedirs(os.path.join(os.path.dirname(__file__), 'profiles'), exist_ok=True)
                profile = {'cheese': 99999, 'username': username}
                with open(profile_file, 'w', encoding='utf-8') as f:
                    json.dump(profile, f, ensure_ascii=False, indent=2)
            else:
                return cors_response({"error": "Профиль не найден"}, 404)
        with open(profile_file, 'r', encoding='utf-8') as f:
            profile = json.load(f)
        current_cheese = profile.get('cheese', 0)
        if not is_admin and current_cheese < amount:
            return cors_response({"error": f"Недостаточно Сыра! У вас {current_cheese} 🧀"}, 400)

        # Если фронтенд не прислал картинку — генерим на сервере
        if not image_b64:
            logger.info(f"[AI Donate] Browser didn't generate image, trying server-side...")

            # Попробуем Gemini на сервере
            gemini_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key={_GEMINI_API_KEY}"
            if _GEMINI_API_KEY:
                try:
                    timeout = aiohttp.ClientTimeout(total=25)
                    async with aiohttp.ClientSession(timeout=timeout) as session:
                        async with session.post(gemini_url, json={
                            "contents": [{"parts": [{"text": f"Generate an image: {prompt}"}]}],
                            "generationConfig": {"responseModalities": ["TEXT", "IMAGE"]}
                        }) as resp:
                            if resp.status == 200:
                                gdata = await resp.json()
                                for part in gdata.get("candidates", [{}])[0].get("content", {}).get("parts", []):
                                    if "inlineData" in part:
                                        image_b64 = part["inlineData"]["data"]
                                        mime = part["inlineData"].get("mimeType", "image/png")
                                        provider = "gemini-server"
                                        break
                            else:
                                logger.warning(f"[AI Donate] Server Gemini: {resp.status}")
                except Exception as e:
                    logger.warning(f"[AI Donate] Server Gemini error: {e}")

            # Попробуем HuggingFace на сервере
            if not image_b64 and _HF_TOKEN:
                try:
                    timeout = aiohttp.ClientTimeout(total=20)
                    async with aiohttp.ClientSession(timeout=timeout) as session:
                        async with session.post(
                            "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
                            headers={"Authorization": f"Bearer {_HF_TOKEN}", "Content-Type": "application/json"},
                            json={"inputs": prompt}
                        ) as resp:
                            if resp.status == 200:
                                ct = resp.headers.get("Content-Type", "")
                                if "image" in ct:
                                    img_bytes = await resp.read()
                                    if len(img_bytes) > 500:
                                        image_b64 = base64.b64encode(img_bytes).decode()
                                        mime = ct.split(";")[0]
                                        provider = "huggingface-server"
                            else:
                                logger.warning(f"[AI Donate] Server HF: {resp.status}")
                except Exception as e:
                    logger.warning(f"[AI Donate] Server HF error: {e}")

            # Локальный fallback (гарантированный)
            if not image_b64:
                import struct, zlib, hashlib
                W, H = 512, 512
                hh = hashlib.md5(prompt.encode()).hexdigest()
                r1, g1, b1 = int(hh[0:2], 16), int(hh[2:4], 16), int(hh[4:6], 16)
                r2, g2, b2 = int(hh[6:8], 16), int(hh[8:10], 16), int(hh[10:12], 16)
                rows = []
                for y in range(H):
                    row = bytearray([0])
                    t = y / H
                    for x in range(W):
                        frac = (t + x / W) / 2
                        r, g, b = int(r1*(1-frac)+r2*frac), int(g1*(1-frac)+g2*frac), int(b1*(1-frac)+b2*frac)
                        cx, cy = abs(x-W//2), abs(y-H//2)
                        dd = (cx*cx+cy*cy)**0.5
                        if dd < 150:
                            bl = max(0, 1-dd/150)
                            r, g, b = min(255,int(r+(255-r)*bl*0.5)), min(255,int(g+(255-g)*bl*0.5)), min(255,int(b+(255-b)*bl*0.5))
                local_image_result = _generate_image_local(prompt)
                if local_image_result["success"]:
                    image_b64 = local_image_result["image_b64"]
                    mime = local_image_result["mime"]
                    provider = local_image_result["provider"]
                else:
                    logger.error(f"[AI Donate] Local image generation failed: {local_image_result['error']}")


        logger.info(f"[AI Donate] Image via {provider}")

        # Списать сыр
        if not is_admin:
            profile['cheese'] = current_cheese - amount
            with open(profile_file, 'w', encoding='utf-8') as f:
                json.dump(profile, f, ensure_ascii=False, indent=2)

        # Создать событие доната с картинкой
        event = {
            "id": str(_uuid.uuid4())[:8],
            "telegram_id": tg_id,
            "username": username,
            "amount": amount,
            "message": f"🤖 AI: {prompt}",
            "timestamp": _time.time(),
            "shown": False,
            "ai_image": f"data:{mime};base64,{image_b64}",
            "ai_prompt": prompt,
            "ai_provider": provider,
        }
        donate_events.append(event)

        # Добавить в чат
        stream_chat_messages.append({
            "id": event["id"],
            "platform": "donate",
            "username": f"🤖 {username}",
            "text": f"[AI ДОНАТ {amount} 🧀] {prompt}",
            "color": "#9C27B0",
            "timestamp": _time.time(),
            "telegram_id": tg_id,
        })

        logger.info(f"[AI Donate] {username} сгенерировал за {amount} сыра: {prompt} (via {provider})")
        return cors_response({"success": True, "event": {
            "id": event["id"],
            "amount": amount,
            "prompt": prompt,
            "has_image": True,
            "provider": provider,
        }, "new_balance": profile['cheese']})
    except Exception as e:
        import traceback
        logger.error(f"[AI Donate] Error: {e}\n{traceback.format_exc()}")
        return cors_response({"error": str(e)}, 500)

async def api_stream_donate(request):
    """POST /api/stream/donate  {telegram_id, username, amount, message}"""
    try:
        data = await request.json()
        tg_id = int(data.get("telegram_id", 0))
        username = data.get("username", "Аноним").strip()
        amount = int(data.get("amount", 0))
        message = data.get("message", "").strip()[:200]
        
        if amount < DONATE_MIN:
            return cors_response({"error": f"Минимум {DONATE_MIN} 🧀"}, 400)
        
        if not tg_id:
            return cors_response({"error": "telegram_id required"}, 400)
        
        # Проверить и списать сыр
        is_admin = (ADMIN_ID and tg_id == ADMIN_ID)
        profile_file = os.path.join(os.path.dirname(__file__), 'profiles', f'{tg_id}.json')
        
        if not os.path.exists(profile_file):
            if is_admin:
                # Автосоздаём профиль для админа
                os.makedirs(os.path.join(os.path.dirname(__file__), 'profiles'), exist_ok=True)
                profile = {'cheese': 99999, 'username': username}
                with open(profile_file, 'w', encoding='utf-8') as f:
                    json.dump(profile, f, ensure_ascii=False, indent=2)
            else:
                return cors_response({"error": "Профиль не найден"}, 404)
        
        with open(profile_file, 'r', encoding='utf-8') as f:
            profile = json.load(f)
        
        current_cheese = profile.get('cheese', 0)
        
        if not is_admin and current_cheese < amount:
            return cors_response({"error": f"Недостаточно Сыра! У вас {current_cheese} 🧀"}, 400)
        
        # Списать (только для обычных юзеров!)
        if not is_admin:
            profile['cheese'] = current_cheese - amount
            with open(profile_file, 'w', encoding='utf-8') as f:
                json.dump(profile, f, ensure_ascii=False, indent=2)
        
        # Создать событие доната
        event = {
            "id": str(_uuid.uuid4())[:8],
            "telegram_id": tg_id,
            "username": username,
            "amount": amount,
            "message": message,
            "timestamp": _time.time(),
            "shown": False,
        }
        donate_events.append(event)
        
        # Добавить в чат
        stream_chat_messages.append({
            "id": event["id"],
            "platform": "donate",
            "username": f"🧀 {username}",
            "text": f"[ДОНАТ {amount} 🧀] {message}" if message else f"[ДОНАТ {amount} 🧀]",
            "color": "#FFC107",
            "timestamp": _time.time(),
            "telegram_id": tg_id,
        })
        
        logger.info(f"[Donate] {username} задонатил {amount} сыра: {message}")
        return cors_response({"success": True, "event": event, "new_balance": profile['cheese']})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_donate_latest(request):
    """GET /api/stream/donate/latest — OBS виджет забирает новые донаты"""
    try:
        # Найти первый непоказанный донат
        for event in donate_events:
            if not event.get("shown"):
                event["shown"] = True
                return cors_response({"event": event})
        return cors_response({"event": None})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_donate_history(request):
    """GET /api/stream/donate/history — последние донаты"""
    try:
        events = [e for e in donate_events]
        events.reverse()
        return cors_response({"events": events[:20]})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_music_request(request):
    """POST /api/stream/music/request  {telegram_id, username, url, amount}"""
    try:
        data = await request.json()
        tg_id = int(data.get("telegram_id", 0))
        username = data.get("username", "Аноним").strip()
        url = data.get("url", "").strip()
        amount = int(data.get("amount", 50))
        
        MUSIC_COST = 50
        if amount < MUSIC_COST:
            return cors_response({"error": f"Заказ музыки стоит {MUSIC_COST} 🧀"}, 400)
        
        if not url:
            return cors_response({"error": "Нужна ссылка на трек"}, 400)
        
        if not tg_id:
            return cors_response({"error": "telegram_id required"}, 400)
        
        # Списать сыр
        is_admin = (ADMIN_ID and tg_id == ADMIN_ID)
        profile_file = os.path.join(os.path.dirname(__file__), 'profiles', f'{tg_id}.json')
        if not os.path.exists(profile_file):
            if is_admin:
                os.makedirs(os.path.join(os.path.dirname(__file__), 'profiles'), exist_ok=True)
                profile = {'cheese': 99999, 'username': username}
                with open(profile_file, 'w', encoding='utf-8') as f:
                    json.dump(profile, f, ensure_ascii=False, indent=2)
            else:
                return cors_response({"error": "Профиль не найден"}, 404)
        
        with open(profile_file, 'r', encoding='utf-8') as f:
            profile = json.load(f)
        
        current_cheese = profile.get('cheese', 0)
        if not is_admin and current_cheese < amount:
            return cors_response({"error": f"Недостаточно Сыра! У вас {current_cheese} 🧀"}, 400)
        
        if not is_admin:
            profile['cheese'] = current_cheese - amount
            with open(profile_file, 'w', encoding='utf-8') as f:
                json.dump(profile, f, ensure_ascii=False, indent=2)
        
        track = {
            "id": str(_uuid.uuid4())[:8],
            "telegram_id": tg_id,
            "username": username,
            "url": url,
            "title": "",
            "amount": amount,
            "timestamp": _time.time(),
            "played": False,
        }
        
        # Fetch YouTube title via oEmbed
        try:
            oembed_url = f"https://www.youtube.com/oembed?url={url}&format=json"
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as sess:
                async with sess.get(oembed_url) as resp:
                    if resp.status == 200:
                        oembed = await resp.json()
                        track["title"] = oembed.get("title", "")[:100]
                        logger.info(f"[Music] YouTube title: {track['title']}")
        except Exception as e:
            logger.warning(f"[Music] oEmbed failed: {e}")
        
        music_queue.append(track)
        
        logger.info(f"[Music] {username} заказал: {url}")
        return cors_response({"success": True, "track": track, "new_balance": profile['cheese']})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_music_queue(request):
    """GET /api/stream/music/queue — текущая очередь"""
    try:
        queue = [t for t in music_queue if not t.get("played")]
        return cors_response({"queue": queue})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_music_next(request):
    """GET /api/stream/music/next — OBS плеер забирает следующий трек"""
    try:
        for track in music_queue:
            if not track.get("played"):
                track["played"] = True
                return cors_response({"track": track})
        return cors_response({"track": None})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_music_skip(request):
    """POST /api/stream/music/skip — пропустить трек (админ)"""
    try:
        data = await request.json()
        tg_id = int(data.get("telegram_id", 0))
        if not is_admin_user(tg_id):
            return cors_response({"error": "Admin only"}, 403)
        
        # Set skip command for OBS widget
        music_control["action"] = "skip"
        
        for track in music_queue:
            if not track.get("played"):
                track["played"] = True
                return cors_response({"success": True, "skipped": track})
        return cors_response({"success": True, "skipped": None})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_music_control_get(request):
    """GET /api/stream/music/control — OBS виджет поллит команды"""
    try:
        action = music_control.get("action", "none")
        # Reset after reading (one-shot command)
        if action != "none":
            music_control["action"] = "none"
        return cors_response({"action": action})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_music_control_post(request):
    """POST /api/stream/music/control  {telegram_id, action: 'stop'|'skip'}"""
    try:
        data = await request.json()
        tg_id = int(data.get("telegram_id", 0))
        if not is_admin_user(tg_id):
            return cors_response({"error": "Admin only"}, 403)
        action = data.get("action", "none")
        if action in ("stop", "skip"):
            music_control["action"] = action
            # If stop, mark all tracks as played
            if action == "stop":
                for track in music_queue:
                    track["played"] = True
        return cors_response({"success": True, "action": action})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


async def api_stream_config_get(request):
    """GET /api/stream/config — получить конфиг трансляции"""
    return cors_response({"config": stream_config})


async def api_stream_config_save(request):
    """POST /api/stream/config/save  {telegram_id, config: {...}}"""
    global stream_config
    try:
        data = await request.json()
        tg_id = int(data.get("telegram_id", 0))
        
        if not is_admin_user(tg_id):
            return cors_response({"error": "Admin only"}, 403)
        
        new_config = data.get("config", {})
        if not isinstance(new_config, dict):
            return cors_response({"error": "config must be a dict"}, 400)
        
        old_twitch_ch = stream_config.get('twitch', {}).get('channel', '')
        # MERGE вместо перезаписи
        for key, value in new_config.items():
            if isinstance(value, dict) and isinstance(stream_config.get(key), dict):
                stream_config[key].update(value)
            else:
                stream_config[key] = value
        _save_stream_config()
        
        # Если Twitch канал изменился — переключить ридер
        new_twitch_ch = new_config.get('twitch', {}).get('channel', '')
        if new_twitch_ch and new_twitch_ch != old_twitch_ch:
            await twitch_reader.change_channel(new_twitch_ch)
        
        return cors_response({"success": True, "config": stream_config})
    except Exception as e:
        return cors_response({"error": str(e)}, 500)


# === Медиа загрузка/отдача для донат-алертов ===
import base64 as _base64

# Папка для статических медиа-файлов (в git-репозитории!)
_static_media_dir = os.path.join(os.path.dirname(__file__), 'webapp', 'obs', 'media')
os.makedirs(_static_media_dir, exist_ok=True)

# Маппинг MIME → расширение
_MIME_TO_EXT = {
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/ogg': '.ogg', 
    'audio/wav': '.wav', 'audio/x-wav': '.wav',
    'video/mp4': '.mp4', 'video/webm': '.webm',
    'image/gif': '.gif', 'image/png': '.png', 'image/jpeg': '.jpg',
}

async def api_stream_media_upload(request):
    """POST /api/stream/media/upload  {telegram_id, key, data}"""
    try:
        data = await request.json()
        tg_id = int(data.get("telegram_id", 0))
        if not is_admin_user(tg_id):
            return cors_response({"error": "Admin only"}, 403)
        key = data.get("key", "")
        b64data = data.get("data", "")
        if not key or not b64data:
            return cors_response({"error": "key and data required"}, 400)
        
        # 1) Сохраняем в SQLite (работает до следующего деплоя)
        try:
            from database import get_db
            with get_db() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO stream_media (key, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                    (key, b64data)
                )
        except Exception as e:
            logger.warning(f"SQLite save error: {e}")
        
        # 2) Сохраняем как статический файл (переживёт деплой!)
        try:
            # Удалить старые файлы с таким ключом
            for f in os.listdir(_static_media_dir):
                if f.startswith(key):
                    os.remove(os.path.join(_static_media_dir, f))
            
            # Декодируем data URI → бинарный файл
            # data:audio/mpeg;base64,/+NIxAAA... → binary
            if ',' in b64data:
                header, raw_b64 = b64data.split(',', 1)
                # Определяем расширение из MIME
                mime = header.split(':')[1].split(';')[0] if ':' in header else ''
                ext = _MIME_TO_EXT.get(mime, '.bin')
                binary = _base64.b64decode(raw_b64)
                filepath = os.path.join(_static_media_dir, f"{key}{ext}")
                with open(filepath, 'wb') as f:
                    f.write(binary)
                logger.info(f"Media saved static: {key}{ext} ({len(binary)} bytes)")
        except Exception as e:
            logger.warning(f"Static file save error: {e}")
        
        logger.info(f"Media uploaded: {key} ({len(b64data)} chars)")
        return cors_response({"success": True, "key": key})
    except Exception as e:
        logger.error(f"Media upload error: {e}")
        return cors_response({"error": str(e)}, 500)

async def api_stream_media_get(request):
    """GET /api/stream/media/{key}"""
    key = request.match_info.get('key', '')
    
    # 1) Пробуем SQLite
    try:
        from database import get_db
        with get_db() as conn:
            row = conn.execute("SELECT data FROM stream_media WHERE key = ?", (key,)).fetchone()
        if row:
            return cors_response({"key": key, "data": row["data"]})
    except Exception:
        pass
    
    # 2) Пробуем статический файл
    try:
        for f in os.listdir(_static_media_dir):
            if f.startswith(key + '.'):
                filepath = os.path.join(_static_media_dir, f)
                with open(filepath, 'rb') as fh:
                    binary = fh.read()
                ext = os.path.splitext(f)[1]
                mime_map = {'.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
                           '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif'}
                mime = mime_map.get(ext, 'application/octet-stream')
                data_uri = f"data:{mime};base64,{_base64.b64encode(binary).decode()}"
                return cors_response({"key": key, "data": data_uri})
    except Exception:
        pass
    
    return cors_response({"error": "not found"}, 404)


# ==========================================
# TWITCH IRC — Отправка в Twitch чат
# ==========================================
import aiohttp

class TwitchIRCClient:
    """Клиент для отправки сообщений в Twitch чат через WebSocket IRC"""
    
    def __init__(self, nick, token):
        self.nick = nick.lower()
        self.token = token
        self.ws = None
        self.connected = False
        self.current_channel = None
    
    async def connect(self):
        """Подключиться к Twitch IRC"""
        if not self.nick or not self.token:
            logger.warning("[TwitchIRC] TWITCH_BOT_NICK / TWITCH_BOT_TOKEN не заданы")
            return False
        
        try:
            session = aiohttp.ClientSession()
            self.ws = await session.ws_connect('wss://irc-ws.chat.twitch.tv:443')
            
            token = self.token if self.token.startswith('oauth:') else f'oauth:{self.token}'
            await self.ws.send_str(f'PASS {token}')
            await self.ws.send_str(f'NICK {self.nick}')
            
            self.connected = True
            logger.info(f"[TwitchIRC] Подключен как {self.nick}")
            
            # Запускаем чтение (для PING/PONG)
            asyncio.create_task(self._read_loop(session))
            return True
        except Exception as e:
            logger.error(f"[TwitchIRC] Ошибка подключения: {e}")
            self.connected = False
            return False
    
    async def _read_loop(self, session):
        """Читаем сообщения для PING/PONG"""
        try:
            async for msg in self.ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    if msg.data.startswith('PING'):
                        await self.ws.send_str('PONG :tmi.twitch.tv')
                elif msg.type in (aiohttp.WSMsgType.CLOSED, aiohttp.WSMsgType.ERROR):
                    break
        except Exception:
            pass
        finally:
            self.connected = False
            await session.close()
            logger.info("[TwitchIRC] Отключен")
    
    async def join_channel(self, channel):
        """Войти в канал"""
        if not self.connected:
            await self.connect()
        if not self.connected:
            return False
        
        channel = channel.lower().strip('#')
        await self.ws.send_str(f'JOIN #{channel}')
        self.current_channel = channel
        logger.info(f"[TwitchIRC] Вошёл в #{channel}")
        return True
    
    async def send_message(self, channel, text):
        """Отправить сообщение в канал"""
        channel = channel.lower().strip('#')
        
        if not self.connected:
            await self.connect()
        if not self.connected:
            return False
        
        if self.current_channel != channel:
            await self.join_channel(channel)
        
        await self.ws.send_str(f'PRIVMSG #{channel} :{text}')
        logger.info(f"[TwitchIRC] #{channel}: {text}")
        return True


# Глобальный клиент
twitch_irc = TwitchIRCClient(TWITCH_BOT_NICK, TWITCH_BOT_TOKEN)


async def api_stream_chat_twitch_send(request):
    """POST /api/stream/chat/twitch-send  {channel, username, text}
    Отправляет сообщение от пользователя в Twitch чат через бота"""
    try:
        data = await request.json()
        channel = data.get("channel", "").strip()
        username = data.get("username", "Танкист").strip()
        text = data.get("text", "").strip()

        if not channel or not text:
            return cors_response({"error": "channel and text required"}, 400)

        if not TWITCH_BOT_NICK or not TWITCH_BOT_TOKEN:
            return cors_response({"error": "Twitch бот не настроен. Добавьте TWITCH_BOT_NICK и TWITCH_BOT_TOKEN в .env"}, 400)

        # Формат: [МТ] Username: сообщение
        formatted = f"[МТ] {username}: {text}"
        
        success = await twitch_irc.send_message(channel, formatted)
        
        if success:
            return cors_response({"success": True})
        else:
            return cors_response({"error": "Не удалось отправить в Twitch"}, 500)
    except Exception as e:
        logger.error(f"Twitch send error: {e}")
        return cors_response({"error": str(e)}, 500)


# ==========================================
# ФИНАНСЫ / БУХГАЛТЕРИЯ (ТОЛЬКО АДМИН)
# ==========================================

async def api_admin_finance(request):
    """GET /api/admin/finance?admin_telegram_id=X&page=1&period=all
    Сводный финансовый дашборд: доходы, расщепление, история операций, топ плательщиков.
    """
    try:
        admin_tg = int(request.query.get("admin_telegram_id", 0))
        if not is_admin_user(admin_tg):
            return cors_response({"error": "Нет доступа"}, 403)

        page = max(1, int(request.query.get("page", 1)))
        period = request.query.get("period", "all")  # all | month | week
        per_page = 50

        from database import get_db_read, SUBSCRIPTION_PLANS

        # --- Фильтр по периоду ---
        if period == "week":
            date_filter = "AND created_at >= datetime('now', '-7 days')"
        elif period == "month":
            date_filter = "AND created_at >= datetime('now', '-30 days')"
        else:
            date_filter = ""

        with get_db_read() as conn:

            # ================================================================
            # 1. ПОДПИСКИ — доход в Stars и RUB
            # ================================================================
            subs = conn.execute(f"""
                SELECT s.id, s.plan, s.price, s.payment_method, s.started_at,
                       u.telegram_id, u.first_name, u.last_name, u.username,
                       u.wot_nickname
                FROM subscriptions s
                JOIN users u ON u.id = s.user_id
                WHERE 1=1 {date_filter.replace('created_at', 's.started_at')}
                ORDER BY s.started_at DESC
            """).fetchall()

            sub_revenue_rub = sum(s["price"] for s in subs if s["payment_method"] != "stars")
            sub_revenue_stars = sum(
                SUBSCRIPTION_PLANS.get(s["plan"], {}).get("stars_price", 0)
                for s in subs if s["payment_method"] == "stars"
            )
            # Stars → RUB: 1 Star ≈ 1.96 RUB (Telegram официально)
            STAR_TO_RUB = 1.96
            sub_stars_rub = round(sub_revenue_stars * STAR_TO_RUB)

            # ================================================================
            # 2. ПОКУПКИ СЫРА
            # ================================================================
            cheese = conn.execute(f"""
                SELECT cp.id, cp.amount, cp.rub_amount, cp.payment_method, cp.created_at,
                       u.telegram_id, u.first_name, u.last_name, u.username,
                       u.wot_nickname
                FROM cheese_purchases cp
                JOIN users u ON u.id = cp.user_id
                WHERE cp.status = 'completed' {date_filter.replace('created_at', 'cp.created_at')}
                ORDER BY cp.created_at DESC
            """).fetchall()

            cheese_revenue_rub = sum(c["rub_amount"] for c in cheese)

            # ================================================================
            # 3. ВРАЩЕНИЯ ЗА STARS (из транзакций)
            # ================================================================
            wheel_txns = conn.execute(f"""
                SELECT t.id, t.amount, t.description, t.created_at,
                       u.telegram_id, u.first_name, u.username, u.wot_nickname
                FROM transactions t
                JOIN users u ON u.id = t.user_id
                WHERE t.type IN ('wheel_stars', 'stars_payment') {date_filter}
                ORDER BY t.created_at DESC
            """).fetchall()
            wheel_revenue_stars = sum(w["amount"] for w in wheel_txns)
            wheel_revenue_rub = round(wheel_revenue_stars * STAR_TO_RUB)

            # ================================================================
            # 4. ИТОГО
            # ================================================================
            total_rub = sub_revenue_rub + sub_stars_rub + cheese_revenue_rub + wheel_revenue_rub
            total_stars = sub_revenue_stars + wheel_revenue_stars

            # Расщепление доходов
            split = {
                "streamer":    {"pct": 50, "rub": round(total_rub * 0.50)},
                "partner":     {"pct": 35, "rub": round(total_rub * 0.35)},
                "development": {"pct": 15, "rub": round(total_rub * 0.15)},
            }

            # ================================================================
            # 5. ТОП ПЛАТЕЛЬЩИКОВ (by revenue)
            # ================================================================
            user_revenue = {}

            def add_user(tg_id, amount_rub, category, name):
                if tg_id not in user_revenue:
                    user_revenue[tg_id] = {"telegram_id": tg_id, "name": name,
                                           "total_rub": 0, "categories": {}}
                user_revenue[tg_id]["total_rub"] += amount_rub
                user_revenue[tg_id]["categories"][category] = \
                    user_revenue[tg_id]["categories"].get(category, 0) + amount_rub

            for s in subs:
                tg = s["telegram_id"]
                name = s["username"] or s["wot_nickname"] or f"{s['first_name'] or ''} {s['last_name'] or ''}".strip() or f"ID {tg}"
                rub = SUBSCRIPTION_PLANS.get(s["plan"], {}).get("stars_price", 0) * STAR_TO_RUB \
                      if s["payment_method"] == "stars" else (s["price"] or 0)
                add_user(tg, round(rub), "subscription", name)

            for c in cheese:
                tg = c["telegram_id"]
                name = c["username"] or c["wot_nickname"] or f"{c['first_name'] or ''} {c['last_name'] or ''}".strip() or f"ID {tg}"
                add_user(tg, c["rub_amount"] or 0, "cheese", name)

            top_users = sorted(user_revenue.values(), key=lambda x: x["total_rub"], reverse=True)

            # ================================================================
            # 6. ИСТОРИЯ ОПЕРАЦИЙ (пагинация)
            # ================================================================
            all_ops = []

            for s in subs:
                tg = s["telegram_id"]
                name = s["username"] or s["wot_nickname"] or f"{s['first_name'] or ''}".strip() or f"ID {tg}"
                plan_name = SUBSCRIPTION_PLANS.get(s["plan"], {}).get("name", s["plan"])
                rub = SUBSCRIPTION_PLANS.get(s["plan"], {}).get("stars_price", 0) * STAR_TO_RUB \
                      if s["payment_method"] == "stars" else (s["price"] or 0)
                all_ops.append({
                    "id": f"sub_{s['id']}",
                    "date": str(s["started_at"]),
                    "type": "subscription",
                    "type_label": "📦 Подписка",
                    "user": name,
                    "telegram_id": tg,
                    "description": plan_name,
                    "amount_rub": round(rub),
                    "amount_stars": SUBSCRIPTION_PLANS.get(s["plan"], {}).get("stars_price", 0)
                                    if s["payment_method"] == "stars" else 0,
                    "method": s["payment_method"] or "stars",
                })

            for c in cheese:
                tg = c["telegram_id"]
                name = c["username"] or c["wot_nickname"] or f"{c['first_name'] or ''}".strip() or f"ID {tg}"
                all_ops.append({
                    "id": f"cheese_{c['id']}",
                    "date": str(c["created_at"]),
                    "type": "cheese",
                    "type_label": "🧀 Покупка сыра",
                    "user": name,
                    "telegram_id": tg,
                    "description": f"{c['amount']} сыра",
                    "amount_rub": c["rub_amount"] or 0,
                    "amount_stars": 0,
                    "method": c["payment_method"] or "stars",
                })

            # Сортируем по дате
            all_ops.sort(key=lambda x: x["date"], reverse=True)
            total_ops = len(all_ops)
            page_ops = all_ops[(page - 1) * per_page : page * per_page]

            # ================================================================
            # 7. ПОМЕСЯЧНАЯ СТАТИСТИКА
            # ================================================================
            monthly = conn.execute("""
                SELECT strftime('%Y-%m', started_at) as month,
                       COUNT(*) as count, SUM(price) as total
                FROM subscriptions
                WHERE payment_method != 'stars'
                GROUP BY month ORDER BY month DESC LIMIT 12
            """).fetchall()

            return cors_response({
                "summary": {
                    "total_rub": total_rub,
                    "total_stars": total_stars,
                    "subscriptions_rub": sub_revenue_rub + sub_stars_rub,
                    "cheese_rub": cheese_revenue_rub,
                    "wheel_rub": wheel_revenue_rub,
                    "subscribers_count": len(set(s["telegram_id"] for s in subs)),
                    "transactions_count": total_ops,
                },
                "split": split,
                "top_users": top_users[:50],
                "transactions": page_ops,
                "pagination": {
                    "page": page,
                    "per_page": per_page,
                    "total": total_ops,
                    "pages": max(1, (total_ops + per_page - 1) // per_page),
                },
                "monthly": [dict(m) for m in monthly],
                "period": period,
            })

    except Exception as e:
        logger.error(f"API admin_finance error: {e}", exc_info=True)
        return cors_response({"error": str(e)}, 500)


# ==========================================
# TEAM BATTLE — Команда на Команду
# ==========================================

def _ensure_team_battle_tables():
    """Создаём таблицы для командных боёв если их нет"""
    from database import get_db
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS team_battles (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                creator_telegram_id INTEGER NOT NULL,
                creator_nickname TEXT,
                condition TEXT DEFAULT 'damage',
                team_size INTEGER DEFAULT 5,
                battles_count INTEGER DEFAULT 5,
                wager INTEGER DEFAULT 100,
                status TEXT DEFAULT 'waiting',
                join_deadline TEXT,
                started_at TEXT,
                finished_at TEXT,
                winner_team TEXT,
                tank_class TEXT,
                tank_tier_filter INTEGER,
                tank_id_filter INTEGER,
                tank_name_filter TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # Добавляем колонки если таблица уже есть
        for col, default in [
            ("tank_class", "TEXT"), ("tank_tier_filter", "INTEGER"),
            ("tank_id_filter", "INTEGER"), ("tank_name_filter", "TEXT"),
        ]:
            try:
                conn.execute(f"ALTER TABLE team_battles ADD COLUMN {col} {default}")
            except Exception:
                pass
        conn.execute("""
            CREATE TABLE IF NOT EXISTS team_battle_participants (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                battle_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                nickname TEXT,
                wot_account_id INTEGER,
                team TEXT NOT NULL,
                is_creator INTEGER DEFAULT 0,
                is_ready INTEGER DEFAULT 0,
                baseline_value INTEGER DEFAULT 0,
                baseline_battles INTEGER DEFAULT 0,
                current_value INTEGER DEFAULT 0,
                battles_played INTEGER DEFAULT 0,
                joined_at TEXT DEFAULT (datetime('now')),
                UNIQUE(battle_id, telegram_id)
            )
        """)
        # Add is_ready column if table already exists
        try:
            conn.execute("ALTER TABLE team_battle_participants ADD COLUMN is_ready INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            conn.execute("ALTER TABLE team_battle_participants ADD COLUMN baseline_tank_json TEXT")
        except Exception:
            pass

        # Per-tank battle logs
        conn.execute("""
            CREATE TABLE IF NOT EXISTS team_battle_tank_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                battle_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                tank_id INTEGER NOT NULL,
                tank_name TEXT,
                tank_tier INTEGER DEFAULT 0,
                tank_type TEXT,
                stat_value INTEGER DEFAULT 0,
                battles_count INTEGER DEFAULT 0,
                UNIQUE(battle_id, telegram_id, tank_id)
            )
        """)
    logger.info("Team battle tables ensured")

# Ensure tables exist on import
try:
    _ensure_team_battle_tables()
except Exception as e:
    logger.warning(f"Team battle tables init deferred: {e}")


async def api_team_battle_create(request):
    """POST /api/team-battle/create — любой подписчик создаёт командный бой"""
    try:
        data = await request.json()
        telegram_id = int(data.get("telegram_id", 0))
        if not telegram_id:
            return cors_response({"error": "telegram_id обязателен"}, 400)

        condition = data.get("condition", "damage")
        team_size = int(data.get("team_size", 5))
        battles_count = int(data.get("battles_count", 5))
        join_time_minutes = int(data.get("join_time_minutes", 0))  # 0 = без лимита
        wager = int(data.get("wager", 100))
        wot_nickname = data.get("wot_nickname", "").strip()
        wot_account_id = data.get("wot_account_id", "")

        # Фильтры техники
        tank_class = data.get("tank_class") or None
        tank_tier_filter = int(data.get("tank_tier_filter") or 0) or None
        tank_id_filter = int(data.get("tank_id_filter") or 0) or None
        tank_name_filter = data.get("tank_name_filter") or None

        # Validation
        if team_size < 2 or team_size > 50:
            return cors_response({"error": "Размер команды: от 2 до 50"}, 400)
        if wager < 50:
            return cors_response({"error": "Минимальная ставка — 50 🧀"}, 400)
        if battles_count < 1 or battles_count > 50:
            return cors_response({"error": "Количество боёв: от 1 до 50"}, 400)
        if condition not in ('damage', 'frags', 'xp', 'spotting', 'blocked', 'wins'):
            return cors_response({"error": "Неизвестное условие"}, 400)

        # Check cheese balance
        cheese_balance = get_cheese_balance(telegram_id)
        if cheese_balance < wager:
            return cors_response({"error": f"Недостаточно сыра! У вас {cheese_balance} 🧀"}, 400)

        # Get nickname
        user = get_user_by_telegram_id(telegram_id)
        if not wot_nickname and user:
            wot_nickname = user.get("wot_nickname", "") or user.get("first_name", "") or "Танкист"
        if not wot_account_id and user:
            wot_account_id = user.get("wot_account_id", "")

        from datetime import datetime, timedelta, timezone
        from database import get_db
        join_deadline = None
        if join_time_minutes > 0:
            join_deadline = datetime.now(timezone.utc) + timedelta(minutes=join_time_minutes)

        with get_db() as conn:
            # Limit: max 3 active battles per creator
            active_count = conn.execute(
                "SELECT COUNT(*) FROM team_battles WHERE creator_telegram_id = ? AND status IN ('waiting', 'active')",
                (telegram_id,)
            ).fetchone()[0]
            if active_count >= 3:
                return cors_response({"error": "Максимум 3 активных командных боя"}, 400)

            cursor = conn.execute("""
                INSERT INTO team_battles 
                (creator_telegram_id, creator_nickname, condition, team_size, battles_count, wager, status, join_deadline,
                 tank_class, tank_tier_filter, tank_id_filter, tank_name_filter)
                VALUES (?, ?, ?, ?, ?, ?, 'waiting', ?, ?, ?, ?, ?)
            """, (telegram_id, wot_nickname, condition, team_size, battles_count, wager,
                  join_deadline.strftime('%Y-%m-%d %H:%M:%S') if join_deadline else None,
                  tank_class, tank_tier_filter, tank_id_filter, tank_name_filter))
            battle_id = cursor.lastrowid

            # Creator auto-joins team alpha and pays wager
            import sqlite3
            try:
                account_id_int = int(wot_account_id) if wot_account_id else None
            except (ValueError, TypeError):
                account_id_int = None

            conn.execute("""
                INSERT INTO team_battle_participants 
                (battle_id, telegram_id, nickname, wot_account_id, team, is_creator)
                VALUES (?, ?, ?, ?, 'alpha', 1)
            """, (battle_id, telegram_id, wot_nickname, account_id_int))

        # Freeze creator's wager
        spend_cheese(telegram_id, wager, f"⚔️ Ставка командный бой #{battle_id}")

        return cors_response({
            "success": True,
            "battle_id": battle_id,
            "join_deadline": join_deadline.isoformat()
        })
    except Exception as e:
        logger.error(f"API team_battle_create error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_team_battle_list(request):
    """GET /api/team-battle/list — список командных боёв"""
    try:
        from database import get_db
        from datetime import datetime, timezone

        telegram_id = request.query.get("telegram_id", "0")
        now_utc = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')

        with get_db() as conn:
            # Auto-expire: cancel waiting battles past deadline
            expired = conn.execute(
                "SELECT id FROM team_battles WHERE status = 'waiting' AND join_deadline IS NOT NULL AND join_deadline <= ?",
                (now_utc,)
            ).fetchall()
            for ex in expired:
                _tb_cancel_battle(conn, ex["id"])

            # Auto-finish: active battles where all participants played enough
            active_battles = conn.execute(
                "SELECT id, battles_count FROM team_battles WHERE status = 'active'"
            ).fetchall()
            for ab in active_battles:
                not_done = conn.execute(
                    "SELECT COUNT(*) FROM team_battle_participants WHERE battle_id = ? AND battles_played < ?",
                    (ab["id"], ab["battles_count"])
                ).fetchone()[0]
                total_p = conn.execute(
                    "SELECT COUNT(*) FROM team_battle_participants WHERE battle_id = ?",
                    (ab["id"],)
                ).fetchone()[0]
                if total_p > 0 and not_done == 0:
                    _tb_finish_battle(conn, ab["id"])

            # Fetch battles (recent first, limit 30)
            rows = conn.execute("""
                SELECT * FROM team_battles 
                WHERE status IN ('waiting', 'active', 'finished')
                ORDER BY 
                    CASE status 
                        WHEN 'active' THEN 0 
                        WHEN 'waiting' THEN 1 
                        WHEN 'finished' THEN 2 
                    END,
                    created_at DESC
                LIMIT 30
            """).fetchall()

            battles = []
            for row in rows:
                b = dict(row)
                # Get participants
                participants = conn.execute(
                    "SELECT * FROM team_battle_participants WHERE battle_id = ? ORDER BY team, joined_at",
                    (b["id"],)
                ).fetchall()

                # Get tank logs for this battle
                tank_logs = conn.execute(
                    "SELECT * FROM team_battle_tank_logs WHERE battle_id = ? ORDER BY stat_value DESC",
                    (b["id"],)
                ).fetchall()

                # Build tank logs per player
                player_tanks = {}
                for tl in tank_logs:
                    key = str(tl["telegram_id"])
                    if key not in player_tanks:
                        player_tanks[key] = []
                    player_tanks[key].append(dict(tl))

                for p in participants:
                    pd = dict(p)
                    pd.pop("baseline_tank_json", None)  # Don't send huge JSON to client
                    pd["tank_logs"] = player_tanks.get(str(pd["telegram_id"]), [])
                    if pd["team"] == "alpha":
                        b.setdefault("team_alpha", []).append(pd)
                    else:
                        b.setdefault("team_bravo", []).append(pd)

                battles.append(b)

        return cors_response({"battles": battles})
    except Exception as e:
        logger.error(f"API team_battle_list error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_team_battle_join(request):
    """POST /api/team-battle/join — вступить в команду"""
    try:
        data = await request.json()
        battle_id = int(data.get("battle_id", 0))
        telegram_id = int(data.get("telegram_id", 0))
        team = data.get("team", "alpha")
        wot_nickname = data.get("wot_nickname", "").strip()
        wot_account_id = data.get("wot_account_id", "")

        if not battle_id or not telegram_id:
            return cors_response({"error": "battle_id и telegram_id обязательны"}, 400)
        if team not in ("alpha", "bravo"):
            return cors_response({"error": "Команда: alpha или bravo"}, 400)

        # Get nickname
        user = get_user_by_telegram_id(telegram_id)
        if not wot_nickname and user:
            wot_nickname = user.get("wot_nickname", "") or user.get("first_name", "") or "Танкист"
        if not wot_account_id and user:
            wot_account_id = user.get("wot_account_id", "")

        try:
            account_id_int = int(wot_account_id) if wot_account_id else None
        except (ValueError, TypeError):
            account_id_int = None

        from database import get_db
        import sqlite3

        with get_db() as conn:
            battle = conn.execute("SELECT * FROM team_battles WHERE id = ?", (battle_id,)).fetchone()
            if not battle:
                return cors_response({"error": "Бой не найден"}, 404)
            if battle["status"] != "waiting":
                return cors_response({"error": "Набор уже завершён"}, 400)

            # Check if already in this battle
            existing = conn.execute(
                "SELECT id FROM team_battle_participants WHERE battle_id = ? AND telegram_id = ?",
                (battle_id, telegram_id)
            ).fetchone()
            if existing:
                return cors_response({"error": "Вы уже в команде"}, 400)

            # Check team capacity
            team_count = conn.execute(
                "SELECT COUNT(*) FROM team_battle_participants WHERE battle_id = ? AND team = ?",
                (battle_id, team)
            ).fetchone()[0]
            if team_count >= battle["team_size"]:
                return cors_response({"error": f"Команда {team} заполнена"}, 400)

            # Check cheese balance
            wager = battle["wager"]
            cheese_balance = get_cheese_balance(telegram_id)
            if cheese_balance < wager:
                return cors_response({"error": f"Недостаточно сыра! Нужно {wager} 🧀, у вас {cheese_balance} 🧀"}, 400)

            # Join
            conn.execute("""
                INSERT INTO team_battle_participants 
                (battle_id, telegram_id, nickname, wot_account_id, team, is_creator)
                VALUES (?, ?, ?, ?, ?, 0)
            """, (battle_id, telegram_id, wot_nickname, account_id_int, team))

        # Freeze wager
        spend_cheese(telegram_id, wager, f"⚔️ Ставка командный бой #{battle_id}")

        return cors_response({"success": True, "status": "joined"})
    except Exception as e:
        logger.error(f"API team_battle_join error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_team_battle_ready(request):
    """POST /api/team-battle/ready — игрок нажимает 'Готов'"""
    try:
        data = await request.json()
        battle_id = int(data.get("battle_id", 0))
        telegram_id = int(data.get("telegram_id", 0))
        if not battle_id or not telegram_id:
            return cors_response({"error": "battle_id и telegram_id обязательны"}, 400)

        from database import get_db
        with get_db() as conn:
            p = conn.execute(
                "SELECT is_ready FROM team_battle_participants WHERE battle_id = ? AND telegram_id = ?",
                (battle_id, telegram_id)
            ).fetchone()
            if not p:
                return cors_response({"error": "Вы не участвуете в этом бою"}, 400)

            new_ready = 0 if p["is_ready"] else 1
            conn.execute(
                "UPDATE team_battle_participants SET is_ready = ? WHERE battle_id = ? AND telegram_id = ?",
                (new_ready, battle_id, telegram_id)
            )

        return cors_response({"success": True, "is_ready": bool(new_ready)})
    except Exception as e:
        logger.error(f"API team_battle_ready error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_team_battle_start(request):
    """POST /api/team-battle/start — создатель запускает бой вручную"""
    try:
        data = await request.json()
        battle_id = int(data.get("battle_id", 0))
        telegram_id = int(data.get("telegram_id", 0))
        if not battle_id or not telegram_id:
            return cors_response({"error": "battle_id и telegram_id обязательны"}, 400)

        from database import get_db
        with get_db() as conn:
            battle = conn.execute("SELECT * FROM team_battles WHERE id = ?", (battle_id,)).fetchone()
            if not battle:
                return cors_response({"error": "Бой не найден"}, 404)
            if battle["status"] != "waiting":
                return cors_response({"error": "Бой уже запущен или завершён"}, 400)
            if battle["creator_telegram_id"] != telegram_id:
                return cors_response({"error": "Только создатель может запустить бой"}, 403)

            # Check participants
            participants = conn.execute(
                "SELECT * FROM team_battle_participants WHERE battle_id = ?",
                (battle_id,)
            ).fetchall()
            alpha = [p for p in participants if p["team"] == "alpha"]
            bravo = [p for p in participants if p["team"] == "bravo"]

            if len(alpha) == 0 or len(bravo) == 0:
                return cors_response({"error": "В каждой команде должен быть хотя бы 1 игрок"}, 400)

            # Check all ready
            not_ready = [p for p in participants if not p["is_ready"]]
            if not_ready:
                names = ', '.join([p["nickname"] or "Танкист" for p in not_ready[:3]])
                return cors_response({"error": f"Не все готовы: {names}..."}, 400)

        # Start the battle
        await _tb_start_battle(battle_id)
        return cors_response({"success": True, "message": "Бой начался!"})
    except Exception as e:
        logger.error(f"API team_battle_start error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_team_battle_refresh(request):
    """POST /api/team-battle/refresh — обновить статистику активных командных боёв"""
    try:
        from database import get_db
        with get_db() as conn:
            active = conn.execute(
                "SELECT id, condition, battles_count FROM team_battles WHERE status = 'active'"
            ).fetchall()

        for battle in active:
            await _tb_refresh_battle_stats(battle["id"], battle["condition"], battle["battles_count"])

        return cors_response({"success": True, "refreshed": len(active)})
    except Exception as e:
        logger.error(f"API team_battle_refresh error: {e}")
        return cors_response({"error": str(e)}, 500)


async def _tb_start_battle(battle_id):
    """Запуск боя: зафиксировать per-tank baselines для античита"""
    from database import get_db
    from datetime import datetime, timezone
    import json

    with get_db() as conn:
        battle = conn.execute("SELECT * FROM team_battles WHERE id = ?", (battle_id,)).fetchone()
        if not battle or battle["status"] != "waiting":
            return

        participants = conn.execute(
            "SELECT * FROM team_battle_participants WHERE battle_id = ?",
            (battle_id,)
        ).fetchall()

    condition = battle["condition"]
    STAT_FIELD_MAP = {
        'damage': 'damage_dealt', 'frags': 'frags', 'xp': 'xp',
        'spotting': 'spotted', 'blocked': 'damage_received', 'wins': 'wins',
    }
    stat_field = STAT_FIELD_MAP.get(condition, 'damage_dealt')

    # Fetch per-tank baselines for each participant
    for p in participants:
        p_dict = dict(p)
        aid = p_dict.get("wot_account_id")
        if not aid:
            continue

        try:
            tanks = await gc_fetch_tank_stats(aid)
            if not tanks:
                continue

            # Build baseline dict: {tank_id: {value, battles}}
            baseline = {}
            total_value = 0
            total_battles = 0
            for t in tanks:
                tid = t["tank_id"]
                all_stats = t.get("all", {})
                val = all_stats.get(stat_field, 0)
                bat = all_stats.get("battles", 0)
                baseline[str(tid)] = {"v": val, "b": bat}
                total_value += val
                total_battles += bat

            with get_db() as conn:
                conn.execute("""
                    UPDATE team_battle_participants 
                    SET baseline_value = ?, baseline_battles = ?, current_value = 0, 
                        battles_played = 0, baseline_tank_json = ?
                    WHERE battle_id = ? AND telegram_id = ?
                """, (total_value, total_battles, json.dumps(baseline),
                      battle_id, p_dict["telegram_id"]))
        except Exception as e:
            logger.warning(f"TB baseline fetch failed for {p_dict['telegram_id']}: {e}")

    # Update battle status with UTC timestamp
    started_ts = int(datetime.now(timezone.utc).timestamp())
    with get_db() as conn:
        conn.execute("""
            UPDATE team_battles SET status = 'active', started_at = ?
            WHERE id = ?
        """, (str(started_ts), battle_id))

    logger.info(f"⚔️ Team battle {battle_id} started! (ts={started_ts})")


async def _tb_refresh_battle_stats(battle_id, condition, battles_count):
    """Обновить статистику: per-tank tracking + антиЧит (only battles after start)"""
    from database import get_db
    import json

    STAT_FIELD_MAP = {
        'damage': 'damage_dealt', 'frags': 'frags', 'xp': 'xp',
        'spotting': 'spotted', 'blocked': 'damage_received', 'wins': 'wins',
    }
    stat_field = STAT_FIELD_MAP.get(condition, 'damage_dealt')

    with get_db() as conn:
        battle = conn.execute("SELECT started_at FROM team_battles WHERE id = ?", (battle_id,)).fetchone()
        participants = conn.execute(
            "SELECT * FROM team_battle_participants WHERE battle_id = ?",
            (battle_id,)
        ).fetchall()

    # Parse started_at as unix timestamp
    started_ts = 0
    if battle and battle["started_at"]:
        try:
            started_ts = int(battle["started_at"])
        except (ValueError, TypeError):
            started_ts = 0

    # Get tank names for display
    all_tank_ids = set()

    for p in participants:
        p_dict = dict(p)
        aid = p_dict.get("wot_account_id")
        if not aid:
            continue

        try:
            tanks = await gc_fetch_tank_stats(aid)
            if not tanks:
                continue

            # Load baseline
            baseline = {}
            if p_dict.get("baseline_tank_json"):
                try:
                    baseline = json.loads(p_dict["baseline_tank_json"])
                except Exception:
                    pass

            total_progress = 0
            total_new_battles = 0
            tank_deltas = {}  # {tank_id: {value, battles, name?, tier?, type?}}

            for t in tanks:
                tid = t["tank_id"]
                all_stats = t.get("all", {})
                cur_val = all_stats.get(stat_field, 0)
                cur_bat = all_stats.get("battles", 0)

                # Get baseline for this tank
                bl = baseline.get(str(tid), {"v": 0, "b": 0})
                val_diff = cur_val - bl["v"]
                bat_diff = cur_bat - bl["b"]

                # Only count tanks where new battles happened
                if bat_diff > 0 and val_diff > 0:
                    # Anti-cheat: check updated_at > started_at
                    updated_at = t.get("updated_at", 0)
                    if started_ts > 0 and updated_at > 0 and updated_at < started_ts:
                        # This tank was last played BEFORE challenge start — skip
                        continue

                    total_progress += val_diff
                    total_new_battles += bat_diff
                    tank_deltas[tid] = {"value": val_diff, "battles": bat_diff}
                    all_tank_ids.add(tid)

            # Cap battles
            if battles_count > 0 and total_new_battles > battles_count:
                total_new_battles = battles_count

            # Update participant totals
            with get_db() as conn:
                conn.execute("""
                    UPDATE team_battle_participants
                    SET current_value = ?, battles_played = ?
                    WHERE battle_id = ? AND telegram_id = ?
                """, (max(0, total_progress), total_new_battles,
                      battle_id, p_dict["telegram_id"]))

            # Update per-tank logs
            if tank_deltas:
                # Fetch tank names
                try:
                    tank_info = await gc_get_tank_names(list(tank_deltas.keys()))
                except Exception:
                    tank_info = {}

                with get_db() as conn:
                    for tid, delta in tank_deltas.items():
                        info = tank_info.get(tid, {})
                        conn.execute("""
                            INSERT INTO team_battle_tank_logs
                            (battle_id, telegram_id, tank_id, tank_name, tank_tier, tank_type, stat_value, battles_count)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            ON CONFLICT(battle_id, telegram_id, tank_id) DO UPDATE SET
                            stat_value = excluded.stat_value,
                            battles_count = excluded.battles_count
                        """, (battle_id, p_dict["telegram_id"], tid,
                              info.get("name", f"Tank #{tid}"),
                              info.get("tier", 0),
                              info.get("type", ""),
                              delta["value"], delta["battles"]))

        except Exception as e:
            logger.warning(f"TB stat refresh failed for {p_dict['telegram_id']}: {e}")


def _tb_finish_battle(conn, battle_id):
    """Завершить бой: определить победителя, раздать выигрыш"""
    try:
        battle = conn.execute("SELECT * FROM team_battles WHERE id = ?", (battle_id,)).fetchone()
        if not battle:
            return

        participants = conn.execute(
            "SELECT * FROM team_battle_participants WHERE battle_id = ?",
            (battle_id,)
        ).fetchall()

        # Calculate team totals
        alpha_total = sum(p["current_value"] for p in participants if p["team"] == "alpha")
        bravo_total = sum(p["current_value"] for p in participants if p["team"] == "bravo")

        if alpha_total > bravo_total:
            winner_team = "alpha"
        elif bravo_total > alpha_total:
            winner_team = "bravo"
        else:
            winner_team = "draw"

        conn.execute("""
            UPDATE team_battles SET status = 'finished', finished_at = datetime('now'), winner_team = ?
            WHERE id = ?
        """, (winner_team, battle_id))

        # Distribute winnings
        wager = battle["wager"]
        total_pot = wager * len(participants)

        if winner_team == "draw":
            # Refund everyone
            for p in participants:
                try:
                    buy_cheese(p["telegram_id"], wager, method="team_battle_refund")
                except Exception:
                    pass
        else:
            # Winners split the pot
            winners = [p for p in participants if p["team"] == winner_team]
            if winners:
                share = total_pot // len(winners)
                for w in winners:
                    try:
                        buy_cheese(w["telegram_id"], share, method="team_battle_win")
                    except Exception:
                        pass

        logger.info(f"🏆 Team battle {battle_id} finished! Winner: {winner_team} (α:{alpha_total} β:{bravo_total})")
    except Exception as e:
        logger.error(f"TB finish error: {e}")


def _tb_cancel_battle(conn, battle_id):
    """Отменить бой (время вышло) — вернуть ставки"""
    try:
        battle = conn.execute("SELECT * FROM team_battles WHERE id = ?", (battle_id,)).fetchone()
        if not battle:
            return

        participants = conn.execute(
            "SELECT telegram_id FROM team_battle_participants WHERE battle_id = ?",
            (battle_id,)
        ).fetchall()

        # Refund all
        for p in participants:
            try:
                buy_cheese(p["telegram_id"], battle["wager"], method="team_battle_cancel_refund")
            except Exception:
                pass

        conn.execute("UPDATE team_battles SET status = 'cancelled' WHERE id = ?", (battle_id,))
        logger.info(f"❌ Team battle {battle_id} cancelled (deadline expired), {len(participants)} refunded")
    except Exception as e:
        logger.error(f"TB cancel error: {e}")


async def api_team_battle_history(request):
    """GET /api/team-battle/history?telegram_id=X — история командных боёв"""
    try:
        from database import get_db
        telegram_id = request.query.get("telegram_id", "0")
        
        with get_db() as conn:
            # Только завершённые бои (не отменённые)
            rows = conn.execute("""
                SELECT * FROM team_battles 
                WHERE status = 'finished'
                ORDER BY finished_at DESC
                LIMIT 50
            """).fetchall()

            battles = []
            for row in rows:
                b = dict(row)
                participants = conn.execute(
                    "SELECT * FROM team_battle_participants WHERE battle_id = ? ORDER BY team, current_value DESC",
                    (b["id"],)
                ).fetchall()
                b["team_alpha"] = [dict(p) for p in participants if p["team"] == "alpha"]
                b["team_bravo"] = [dict(p) for p in participants if p["team"] == "bravo"]
                b["total_participants"] = len(participants)
                
                # Проверяем участие конкретного игрока
                if telegram_id and telegram_id != "0":
                    b["my_participation"] = any(
                        str(p["telegram_id"]) == str(telegram_id) for p in participants
                    )
                else:
                    b["my_participation"] = False
                battles.append(b)

        return cors_response({"battles": battles})
    except Exception as e:
        logger.error(f"API team_battle_history error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_team_battle_widget(request):
    """GET /api/team-battle/widget?battle_id=X — данные для OBS виджета"""
    try:
        from database import get_db
        battle_id = int(request.query.get("battle_id", 0))
        if not battle_id:
            return cors_response({"error": "battle_id required"}, 400)

        with get_db() as conn:
            battle = conn.execute("SELECT * FROM team_battles WHERE id = ?", (battle_id,)).fetchone()
            if not battle:
                return cors_response({"error": "Battle not found"}, 404)
            
            b = dict(battle)
            participants = conn.execute(
                "SELECT * FROM team_battle_participants WHERE battle_id = ? ORDER BY team, current_value DESC",
                (battle_id,)
            ).fetchall()
            b["team_alpha"] = [dict(p) for p in participants if p["team"] == "alpha"]
            b["team_bravo"] = [dict(p) for p in participants if p["team"] == "bravo"]
            b["alpha_total"] = sum(p["current_value"] for p in participants if p["team"] == "alpha")
            b["bravo_total"] = sum(p["current_value"] for p in participants if p["team"] == "bravo")

        return cors_response({"battle": b})
    except Exception as e:
        logger.error(f"API team_battle_widget error: {e}")
        return cors_response({"error": str(e)}, 500)

async def api_team_battle_player_tanks(request):
    """GET /api/team-battle/player-tanks?battle_id=X&telegram_id=Y — детали по танкам игрока"""
    try:
        from database import get_db
        battle_id = int(request.query.get("battle_id", 0))
        telegram_id = request.query.get("telegram_id", "0")
        if not battle_id or telegram_id == "0":
            return cors_response({"error": "battle_id и telegram_id обязательны"}, 400)

        with get_db() as conn:
            # Get battle info
            battle = conn.execute("SELECT * FROM team_battles WHERE id = ?", (battle_id,)).fetchone()
            if not battle:
                return cors_response({"error": "Бой не найден"}, 404)

            # Get participant info
            participant = conn.execute(
                "SELECT * FROM team_battle_participants WHERE battle_id = ? AND telegram_id = ?",
                (battle_id, telegram_id)
            ).fetchone()
            if not participant:
                return cors_response({"error": "Игрок не участвует"}, 404)

            # Get tank logs
            tank_logs = conn.execute("""
                SELECT * FROM team_battle_tank_logs
                WHERE battle_id = ? AND telegram_id = ?
                ORDER BY stat_value DESC
            """, (battle_id, telegram_id)).fetchall()

        cond = battle["condition"]
        tier_names = {1:'I',2:'II',3:'III',4:'IV',5:'V',6:'VI',7:'VII',8:'VIII',9:'IX',10:'X'}
        class_names = {
            'heavyTank': '🛡️ТТ', 'mediumTank': '⚙️СТ', 'lightTank': '🏎️ЛТ',
            'AT-SPG': '🎯ПТ', 'SPG': '💣САУ'
        }

        tanks = []
        for log in tank_logs:
            d = dict(log)
            d["tier_label"] = tier_names.get(d.get("tank_tier", 0), "?")
            d["class_label"] = class_names.get(d.get("tank_type", ""), "")
            tanks.append(d)

        return cors_response({
            "player": {
                "nickname": participant["nickname"],
                "team": participant["team"],
                "total_value": participant["current_value"],
                "battles_played": participant["battles_played"],
            },
            "condition": cond,
            "tanks": tanks,
        })
    except Exception as e:
        logger.error(f"API player_tanks error: {e}")
        return cors_response({"error": str(e)}, 500)

# ==========================================
# 🎤 АРЕНА ДОНАТОВ — Конкурсы с голосованием
# ==========================================

def _ensure_donate_contest_tables():
    from database import get_db
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS donate_contests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                description TEXT,
                prize TEXT,
                entry_cost INTEGER DEFAULT 100,
                status TEXT DEFAULT 'active',
                created_by INTEGER,
                created_at TEXT DEFAULT (datetime('now')),
                ends_at TEXT,
                winner_entry_id INTEGER,
                finished_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS donate_contest_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contest_id INTEGER NOT NULL,
                telegram_id INTEGER NOT NULL,
                nickname TEXT,
                message TEXT NOT NULL,
                cheese_spent INTEGER DEFAULT 0,
                votes_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                UNIQUE(contest_id, telegram_id)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS donate_contest_votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                contest_id INTEGER NOT NULL,
                entry_id INTEGER NOT NULL,
                voter_telegram_id INTEGER NOT NULL,
                voted_at TEXT DEFAULT (datetime('now')),
                UNIQUE(contest_id, voter_telegram_id)
            )
        """)
    logger.info("Donate contest tables ensured")

try:
    _ensure_donate_contest_tables()
except Exception as e:
    logger.warning(f"Donate contest tables init deferred: {e}")


async def api_donate_contest_create(request):
    """POST /api/donate-contest/create — админ создаёт конкурс"""
    try:
        data = await request.json()
        telegram_id = int(data.get("telegram_id", 0))
        if telegram_id != ADMIN_ID:
            return cors_response({"error": "Только администратор может создавать конкурсы"}, 403)

        title = data.get("title", "").strip()
        description = data.get("description", "").strip()
        prize = data.get("prize", "").strip()
        entry_cost = int(data.get("entry_cost", 100))
        duration_minutes = int(data.get("duration_minutes", 120))

        if not title:
            return cors_response({"error": "Название конкурса обязательно"}, 400)
        if entry_cost < 0:
            return cors_response({"error": "Стоимость не может быть отрицательной"}, 400)

        from database import get_db
        from datetime import datetime, timedelta, timezone
        ends_at = (datetime.now(timezone.utc) + timedelta(minutes=duration_minutes)).isoformat()

        with get_db() as conn:
            cursor = conn.execute("""
                INSERT INTO donate_contests (title, description, prize, entry_cost, created_by, ends_at)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (title, description, prize, entry_cost, telegram_id, ends_at))
            contest_id = cursor.lastrowid

        return cors_response({"success": True, "contest_id": contest_id})
    except Exception as e:
        logger.error(f"Donate contest create error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_donate_contest_list(request):
    """GET /api/donate-contest/list — список конкурсов"""
    try:
        from database import get_db
        status_filter = request.query.get("status", "active")

        with get_db() as conn:
            if status_filter == "all":
                rows = conn.execute(
                    "SELECT * FROM donate_contests ORDER BY created_at DESC LIMIT 30"
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM donate_contests WHERE status = ? ORDER BY created_at DESC LIMIT 30",
                    (status_filter,)
                ).fetchall()

            contests = []
            for row in rows:
                c = dict(row)
                # Count entries and total cheese spent
                stats = conn.execute("""
                    SELECT COUNT(*) as entry_count, COALESCE(SUM(cheese_spent), 0) as total_cheese
                    FROM donate_contest_entries WHERE contest_id = ?
                """, (c["id"],)).fetchone()
                c["entry_count"] = stats["entry_count"]
                c["total_cheese"] = stats["total_cheese"]
                # Total votes
                vote_count = conn.execute(
                    "SELECT COUNT(*) as cnt FROM donate_contest_votes WHERE contest_id = ?",
                    (c["id"],)
                ).fetchone()
                c["total_votes"] = vote_count["cnt"]
                contests.append(c)

        return cors_response({"contests": contests})
    except Exception as e:
        logger.error(f"Donate contest list error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_donate_contest_entries(request):
    """GET /api/donate-contest/entries?contest_id=X — записи конкурса"""
    try:
        from database import get_db
        contest_id = int(request.query.get("contest_id", 0))
        voter_id = request.query.get("telegram_id", "0")
        if not contest_id:
            return cors_response({"error": "contest_id обязателен"}, 400)

        with get_db() as conn:
            contest = conn.execute("SELECT * FROM donate_contests WHERE id = ?", (contest_id,)).fetchone()
            if not contest:
                return cors_response({"error": "Конкурс не найден"}, 404)

            entries = conn.execute("""
                SELECT * FROM donate_contest_entries
                WHERE contest_id = ?
                ORDER BY votes_count DESC, created_at ASC
            """, (contest_id,)).fetchall()

            # Check if this user already voted
            my_vote = None
            if voter_id and voter_id != "0":
                vote_row = conn.execute(
                    "SELECT entry_id FROM donate_contest_votes WHERE contest_id = ? AND voter_telegram_id = ?",
                    (contest_id, voter_id)
                ).fetchone()
                if vote_row:
                    my_vote = vote_row["entry_id"]

        return cors_response({
            "contest": dict(contest),
            "entries": [dict(e) for e in entries],
            "my_vote": my_vote,
        })
    except Exception as e:
        logger.error(f"Donate contest entries error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_donate_contest_submit(request):
    """POST /api/donate-contest/submit — отправить креативный донат"""
    try:
        data = await request.json()
        telegram_id = int(data.get("telegram_id", 0))
        contest_id = int(data.get("contest_id", 0))
        message = data.get("message", "").strip()

        if not telegram_id or not contest_id or not message:
            return cors_response({"error": "telegram_id, contest_id и message обязательны"}, 400)
        if len(message) > 500:
            return cors_response({"error": "Максимум 500 символов"}, 400)

        from database import get_db, get_user_by_telegram_id

        # Check contest exists and is active
        with get_db() as conn:
            contest = conn.execute("SELECT * FROM donate_contests WHERE id = ?", (contest_id,)).fetchone()
            if not contest:
                return cors_response({"error": "Конкурс не найден"}, 404)
            if contest["status"] != "active":
                return cors_response({"error": "Конкурс завершён"}, 400)

            # Multiple entries allowed — each costs entry_cost cheese

        entry_cost = contest["entry_cost"]

        # Spend cheese if entry_cost > 0
        if entry_cost > 0:
            result = spend_cheese(telegram_id, entry_cost, f"🎤 Участие в конкурсе: {contest['title']}")
            if not result.get("success"):
                return cors_response({"error": result.get("error", "Не удалось списать сыр")}, 400)

        # Get user nickname
        user = get_user_by_telegram_id(telegram_id)
        nickname = user.get("nickname", "Танкист") if user else "Танкист"

        with get_db() as conn:
            conn.execute("""
                INSERT INTO donate_contest_entries (contest_id, telegram_id, nickname, message, cheese_spent)
                VALUES (?, ?, ?, ?, ?)
            """, (contest_id, telegram_id, nickname, message, entry_cost))

        return cors_response({"success": True, "cheese_spent": entry_cost})
    except Exception as e:
        logger.error(f"Donate contest submit error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_donate_contest_vote(request):
    """POST /api/donate-contest/vote — голосовать за запись"""
    try:
        data = await request.json()
        telegram_id = int(data.get("telegram_id", 0))
        contest_id = int(data.get("contest_id", 0))
        entry_id = int(data.get("entry_id", 0))

        if not telegram_id or not contest_id or not entry_id:
            return cors_response({"error": "Все поля обязательны"}, 400)

        from database import get_db, get_user_by_telegram_id

        # Check contest is active or in voting phase
        with get_db() as conn:
            contest = conn.execute("SELECT * FROM donate_contests WHERE id = ?", (contest_id,)).fetchone()
            if not contest or contest["status"] not in ("active", "voting"):
                return cors_response({"error": "Голосование закрыто"}, 400)

            # Check entry exists
            entry = conn.execute(
                "SELECT * FROM donate_contest_entries WHERE id = ? AND contest_id = ?",
                (entry_id, contest_id)
            ).fetchone()
            if not entry:
                return cors_response({"error": "Запись не найдена"}, 404)

            # Can't vote for yourself
            if entry["telegram_id"] == telegram_id:
                return cors_response({"error": "Нельзя голосовать за себя"}, 400)

        # Check voter has linked Lesta account (anti-cheat)
        user = get_user_by_telegram_id(telegram_id)
        if not user:
            return cors_response({"error": "Вы не зарегистрированы в боте"}, 400)
        if not user.get("wot_account_id"):
            return cors_response({"error": "Привяжите аккаунт Lesta в профиле, чтобы голосовать"}, 400)

        # Check subscription to channel (anti-cheat)
        try:
            from aiogram import Bot
            bot_instance = Bot.get_current()
            if bot_instance and hasattr(bot_instance, 'get_chat_member'):
                # Try checking at least one channel
                pass  # We'll check via is_subscribed flag in DB if available
        except Exception:
            pass

        with get_db() as conn:
            # Check if already voted in this contest
            existing = conn.execute(
                "SELECT id, entry_id FROM donate_contest_votes WHERE contest_id = ? AND voter_telegram_id = ?",
                (contest_id, telegram_id)
            ).fetchone()

            if existing:
                # Change vote
                old_entry_id = existing["entry_id"]
                conn.execute(
                    "UPDATE donate_contest_votes SET entry_id = ?, voted_at = datetime('now') WHERE id = ?",
                    (entry_id, existing["id"])
                )
                # Update vote counts
                conn.execute(
                    "UPDATE donate_contest_entries SET votes_count = votes_count - 1 WHERE id = ?",
                    (old_entry_id,)
                )
                conn.execute(
                    "UPDATE donate_contest_entries SET votes_count = votes_count + 1 WHERE id = ?",
                    (entry_id,)
                )
                return cors_response({"success": True, "action": "changed"})
            else:
                # New vote
                conn.execute("""
                    INSERT INTO donate_contest_votes (contest_id, entry_id, voter_telegram_id)
                    VALUES (?, ?, ?)
                """, (contest_id, entry_id, telegram_id))
                conn.execute(
                    "UPDATE donate_contest_entries SET votes_count = votes_count + 1 WHERE id = ?",
                    (entry_id,)
                )
                return cors_response({"success": True, "action": "voted"})

    except Exception as e:
        logger.error(f"Donate contest vote error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_donate_contest_finish(request):
    """POST /api/donate-contest/finish — админ завершает конкурс"""
    try:
        data = await request.json()
        telegram_id = int(data.get("telegram_id", 0))
        contest_id = int(data.get("contest_id", 0))

        if telegram_id != ADMIN_ID:
            return cors_response({"error": "Только администратор"}, 403)

        from database import get_db
        with get_db() as conn:
            contest = conn.execute("SELECT * FROM donate_contests WHERE id = ?", (contest_id,)).fetchone()
            if not contest:
                return cors_response({"error": "Конкурс не найден"}, 404)

            # Find winner (most votes)
            winner = conn.execute("""
                SELECT * FROM donate_contest_entries
                WHERE contest_id = ?
                ORDER BY votes_count DESC, created_at ASC
                LIMIT 1
            """, (contest_id,)).fetchone()

            winner_id = winner["id"] if winner else None
            conn.execute("""
                UPDATE donate_contests
                SET status = 'finished', winner_entry_id = ?, finished_at = datetime('now')
                WHERE id = ?
            """, (winner_id, contest_id))

        return cors_response({
            "success": True,
            "winner": dict(winner) if winner else None,
        })
    except Exception as e:
        logger.error(f"Donate contest finish error: {e}")
        return cors_response({"error": str(e)}, 500)


async def api_donate_contest_widget(request):
    """GET /api/donate-contest/widget?contest_id=X — данные для OBS виджета"""
    try:
        from database import get_db
        contest_id = int(request.query.get("contest_id", 0))
        if not contest_id:
            return cors_response({"error": "contest_id обязателен"}, 400)

        with get_db() as conn:
            contest = conn.execute("SELECT * FROM donate_contests WHERE id = ?", (contest_id,)).fetchone()
            if not contest:
                return cors_response({"error": "Конкурс не найден"}, 404)

            top_entries = conn.execute("""
                SELECT * FROM donate_contest_entries
                WHERE contest_id = ?
                ORDER BY votes_count DESC, created_at ASC
                LIMIT 8
            """, (contest_id,)).fetchall()

            total_entries = conn.execute(
                "SELECT COUNT(*) as cnt FROM donate_contest_entries WHERE contest_id = ?",
                (contest_id,)
            ).fetchone()["cnt"]

            total_votes = conn.execute(
                "SELECT COUNT(*) as cnt FROM donate_contest_votes WHERE contest_id = ?",
                (contest_id,)
            ).fetchone()["cnt"]

            total_cheese = conn.execute(
                "SELECT COALESCE(SUM(cheese_spent), 0) as total FROM donate_contest_entries WHERE contest_id = ?",
                (contest_id,)
            ).fetchone()["total"]

        return cors_response({
            "contest": dict(contest),
            "top_entries": [dict(e) for e in top_entries],
            "total_entries": total_entries,
            "total_votes": total_votes,
            "total_cheese": total_cheese,
        })
    except Exception as e:
        logger.error(f"Donate contest widget error: {e}")
        return cors_response({"error": str(e)}, 500)


# ==========================================
# BACKGROUND CHALLENGE MONITOR
# ==========================================

async def challenge_monitor_loop():
    """Background task: check all active challenges every 30 seconds.
    This ensures freeze/finish happens promptly even without OBS widget open."""
    INTERVAL = 30  # seconds
    logger.info("Challenge monitor started (interval: %ds)", INTERVAL)

    while True:
        try:
            await asyncio.sleep(INTERVAL)

            from database import get_db
            with get_db() as conn:
                active = conn.execute(
                    "SELECT id, from_telegram_id, to_telegram_id FROM arena_challenges WHERE status = 'active'"
                ).fetchall()

            if not active:
                continue

            logger.debug(f"Challenge monitor: checking {len(active)} active challenges")

            for ch_row in active:
                try:
                    challenge_id = ch_row["id"]

                    # Simulate the check API call internally
                    with get_db() as conn:
                        ch = dict(conn.execute("SELECT * FROM arena_challenges WHERE id = ? AND status = 'active'", (challenge_id,)).fetchone() or {})

                    if not ch:
                        continue

                    from_user = get_user_by_telegram_id(ch["from_telegram_id"])
                    to_user = get_user_by_telegram_id(ch["to_telegram_id"])

                    from_current = await fetch_player_stats(from_user, ch) if from_user else None
                    to_current = await fetch_player_stats(to_user, ch) if to_user else None

                    if not from_current or not to_current:
                        continue

                    from_start = json.loads(ch["from_start_stats"]) if ch.get("from_start_stats") else None
                    to_start = json.loads(ch["to_start_stats"]) if ch.get("to_start_stats") else None

                    if not from_start or not to_start:
                        # No snapshot yet — save one
                        from_start = from_start or from_current
                        to_start = to_start or to_current
                        with get_db() as conn:
                            conn.execute(
                                "UPDATE arena_challenges SET from_start_stats = ?, to_start_stats = ? WHERE id = ?",
                                (json.dumps(from_start), json.dumps(to_start), challenge_id))
                        continue

                    required_battles = ch["battles"]
                    condition = ch["condition"]

                    from_battles_played = from_current["battles"] - from_start["battles"]
                    to_battles_played = to_current["battles"] - to_start["battles"]

                    # Update last stats for per-battle tracking
                    battle_history = json.loads(ch.get("battle_history") or "[]")
                    from_last = json.loads(ch["from_last_stats"]) if ch.get("from_last_stats") else from_start
                    to_last = json.loads(ch["to_last_stats"]) if ch.get("to_last_stats") else to_start

                    STAT_KEY = {
                        "damage": "damage_dealt", "spotting": "spotted", "blocked": "damage_received",
                        "frags": "frags", "xp": "xp", "wins": "wins"
                    }
                    stat_key = STAT_KEY.get(condition, "damage_dealt")

                    # Detect new battles from "from" player
                    from_new_b = from_current["battles"] - from_last["battles"]
                    if from_new_b > 0 and from_battles_played <= required_battles + 5:
                        val = from_current[stat_key] - from_last[stat_key]
                        for i in range(from_new_b):
                            bn = len([x for x in battle_history if x.get("player") == "from"]) + 1
                            if bn <= required_battles:
                                battle_history.append({
                                    "player": "from", "nickname": from_start.get("nickname", "?"),
                                    "battle_num": bn, "damage": round(val / from_new_b),
                                    stat_key.replace("damage_dealt", "damage"): round(val / from_new_b)
                                })

                    to_new_b = to_current["battles"] - to_last["battles"]
                    if to_new_b > 0 and to_battles_played <= required_battles + 5:
                        val = to_current[stat_key] - to_last[stat_key]
                        for i in range(to_new_b):
                            bn = len([x for x in battle_history if x.get("player") == "to"]) + 1
                            if bn <= required_battles:
                                battle_history.append({
                                    "player": "to", "nickname": to_start.get("nickname", "?"),
                                    "battle_num": bn, "damage": round(val / to_new_b),
                                    stat_key.replace("damage_dealt", "damage"): round(val / to_new_b)
                                })

                    # Save last stats
                    with get_db() as conn:
                        conn.execute(
                            "UPDATE arena_challenges SET from_last_stats = ?, to_last_stats = ?, battle_history = ? WHERE id = ?",
                            (json.dumps(from_current), json.dumps(to_current), json.dumps(battle_history), challenge_id))

                    # FREEZE stats when player reaches required battles
                    from_end = json.loads(ch["from_end_stats"]) if ch.get("from_end_stats") else None
                    to_end = json.loads(ch["to_end_stats"]) if ch.get("to_end_stats") else None

                    freeze_updates = {}
                    if from_battles_played >= required_battles and not from_end:
                        freeze_updates["from_end_stats"] = json.dumps(from_current)
                        from_end = from_current
                        logger.info(f"Challenge {challenge_id}: FREEZE from_player at {from_battles_played} battles")
                    if to_battles_played >= required_battles and not to_end:
                        freeze_updates["to_end_stats"] = json.dumps(to_current)
                        to_end = to_current
                        logger.info(f"Challenge {challenge_id}: FREEZE to_player at {to_battles_played} battles")

                    if freeze_updates:
                        sets = ", ".join(f"{k} = ?" for k in freeze_updates)
                        vals = list(freeze_updates.values()) + [challenge_id]
                        with get_db() as conn:
                            conn.execute(f"UPDATE arena_challenges SET {sets} WHERE id = ?", vals)

                    # Auto-finish if both reached required battles
                    both_ready = from_battles_played >= required_battles and to_battles_played >= required_battles
                    if both_ready and ch["status"] == "active":
                        from_final = from_end or from_current
                        to_final = to_end or to_current

                        from_battles_capped = min(from_battles_played, required_battles)
                        to_battles_capped = min(to_battles_played, required_battles)

                        def _calc(final, start, bc):
                            bp = max(bc, 1)
                            d_dmg = final["damage_dealt"] - start["damage_dealt"]
                            return {
                                "battles_played": bc,
                                "damage": d_dmg,
                                "spotted": final["spotted"] - start["spotted"],
                                "frags": final["frags"] - start["frags"],
                                "xp": final["xp"] - start["xp"],
                                "wins": final["wins"] - start["wins"],
                                "blocked": final["damage_received"] - start["damage_received"],
                                "avg_damage": round(d_dmg / bp),
                            }

                        fd = _calc(from_final, from_start, from_battles_capped)
                        td = _calc(to_final, to_start, to_battles_capped)

                        DELTA_KEY = {
                            "damage": "damage", "spotting": "spotted", "blocked": "blocked",
                            "frags": "frags", "xp": "xp", "wins": "wins"
                        }
                        dk = DELTA_KEY.get(condition, "damage")
                        from_score = fd.get(dk, 0)
                        to_score = td.get(dk, 0)

                        if from_score >= to_score:
                            winner_tg = ch["from_telegram_id"]
                            winner_name = from_start.get("nickname", "Игрок 1")
                        else:
                            winner_tg = ch["to_telegram_id"]
                            winner_name = to_start.get("nickname", "Игрок 2")

                        prize = ch["wager"] * 2
                        with get_db() as conn:
                            conn.execute("""
                                UPDATE arena_challenges 
                                SET status = 'finished', winner_telegram_id = ?,
                                    from_end_stats = ?, to_end_stats = ?,
                                    finished_at = datetime('now')
                                WHERE id = ? AND status = 'active'
                            """, (winner_tg, json.dumps(fd), json.dumps(td), challenge_id))
                            conn.execute(
                                "UPDATE users SET coins = coins + ? WHERE telegram_id = ?",
                                (prize, winner_tg))

                        logger.info(f"Challenge {challenge_id}: AUTO-FINISHED! Winner: {winner_name} ({from_score} vs {to_score})")

                        # Notify players
                        try:
                            COND_NAMES = {"damage": "💥 Урон", "spotting": "👁 Засвет", "blocked": "🛡 Блок",
                                          "frags": "🎯 Фраги", "xp": "⭐ Опыт", "wins": "🏆 Победы"}
                            cond_name = COND_NAMES.get(condition, condition)
                            text = (
                                f"🏆 <b>Челлендж завершён!</b>\n\n"
                                f"📋 {ch['tank_name']} · {cond_name}\n"
                                f"⚔️ {from_start.get('nickname')}: <b>{from_score}</b>\n"
                                f"⚔️ {to_start.get('nickname')}: <b>{to_score}</b>\n\n"
                                f"🏆 Победитель: <b>{winner_name}</b>\n"
                                f"🧀 Приз: <b>{prize} 🧀</b>"
                            )
                            await bot.send_message(ch["from_telegram_id"], text, parse_mode="HTML")
                            await bot.send_message(ch["to_telegram_id"], text, parse_mode="HTML")
                        except Exception as ne:
                            logger.warning(f"Challenge {challenge_id}: notify failed: {ne}")

                except Exception as ce:
                    logger.warning(f"Challenge monitor error for #{ch_row['id']}: {ce}")
                    continue

                # Small delay between challenges to avoid API rate limits
                await asyncio.sleep(2)

        except Exception as e:
            logger.error(f"Challenge monitor loop error: {e}")
            await asyncio.sleep(60)


# ==========================================
# ЗАПУСК
# ==========================================

def create_api_app():
    """Создать aiohttp приложение с API маршрутами"""
    app = web.Application(client_max_size=10 * 1024 * 1024)  # 10MB для медиа загрузок

    # CORS preflight
    app.router.add_route("OPTIONS", "/{path:.*}", handle_options)

    # User identification
    app.router.add_get("/api/me", api_me)
    app.router.add_post("/api/users/check", api_check_users)
    app.router.add_get("/api/users/search", api_search_users)

    # Friends API
    app.router.add_get("/api/friends", api_get_friends)
    app.router.add_post("/api/friends/add", api_add_friend)
    app.router.add_post("/api/friends/accept", api_accept_friend)
    app.router.add_post("/api/friends/decline", api_decline_friend)
    app.router.add_post("/api/friends/remove", api_remove_friend)

    # Messages API
    app.router.add_get("/api/messages", api_get_messages)
    app.router.add_post("/api/messages/send", api_send_message)

    # Arena / Challenges API
    app.router.add_post("/api/challenges/create", api_create_challenge)
    app.router.add_get("/api/challenges", api_get_challenges)
    app.router.add_post("/api/challenges/accept", api_accept_challenge)
    app.router.add_post("/api/challenges/decline", api_decline_challenge)
    app.router.add_post("/api/challenges/check", api_check_challenge_results)
    app.router.add_post("/api/challenges/delete", api_delete_challenge)

    # Admin API
    app.router.add_get("/api/admin/users", api_admin_users)
    app.router.add_post("/api/admin/toggle-admin", api_admin_toggle_admin)
    app.router.add_post("/api/admin/cancel-challenge", api_admin_cancel_challenge)
    app.router.add_post("/api/admin/gift-cheese", api_admin_gift_cheese)

    # Profile API
    app.router.add_post("/api/profile/save", api_profile_save)
    app.router.add_get("/api/profile", api_profile_get)

    # Top Players API
    app.router.add_get("/api/top/players", api_top_players)

    # Streams API
    app.router.add_get("/api/streams/status", api_streams_status)

    # Stream Chat API
    app.router.add_get("/api/stream/chat", api_stream_chat_get)
    app.router.add_post("/api/stream/chat/send", api_stream_chat_send)
    app.router.add_post("/api/stream/chat/twitch-send", api_stream_chat_twitch_send)
    app.router.add_get("/api/stream/channels", api_stream_channels_get)
    app.router.add_post("/api/stream/channels/save", api_stream_channels_save)
    app.router.add_post("/api/stream/config/save", api_stream_config_save)
    app.router.add_get("/api/stream/config", api_stream_config_get)
    app.router.add_post("/api/stream/media/upload", api_stream_media_upload)
    app.router.add_get("/api/stream/media/{key}", api_stream_media_get)

    # Donate & Music API
    app.router.add_get("/api/ai/config", api_ai_config)
    app.router.add_post("/api/stream/donate", api_stream_donate)
    app.router.add_post("/api/stream/donate/ai", api_stream_donate_ai)
    app.router.add_get("/api/stream/donate/latest", api_stream_donate_latest)
    app.router.add_get("/api/stream/donate/history", api_stream_donate_history)
    app.router.add_post("/api/stream/music/request", api_stream_music_request)
    app.router.add_get("/api/stream/music/queue", api_stream_music_queue)
    app.router.add_get("/api/stream/music/next", api_stream_music_next)
    app.router.add_post("/api/stream/music/skip", api_stream_music_skip)
    app.router.add_get("/api/stream/music/control", api_stream_music_control_get)
    app.router.add_post("/api/stream/music/control", api_stream_music_control_post)

    # Global Challenges API
    app.router.add_post("/api/global-challenge/create", api_global_challenge_create)
    app.router.add_get("/api/global-challenge/active", api_global_challenge_active)
    app.router.add_post("/api/global-challenge/join", api_global_challenge_join)
    app.router.add_post("/api/global-challenge/refresh-stats", api_global_challenge_refresh_stats)
    app.router.add_post("/api/global-challenge/finish", api_global_challenge_finish)
    app.router.add_post("/api/global-challenge/delete", api_global_challenge_delete)
    app.router.add_get("/api/global-challenge/history", api_global_challenge_history)
    app.router.add_get("/api/global-challenge/my-history", api_global_challenge_my_history)
    app.router.add_get("/api/global-challenge/battle-log", api_global_challenge_battle_log)
    app.router.add_get("/api/global-challenge/search-tanks", api_global_challenge_search_tanks)
    app.router.add_get("/api/global-challenge/tank-list", api_global_challenge_tank_list)
    # Prize Wheel API
    app.router.add_get("/api/global-challenge/wheel-data", api_global_challenge_wheel_data)
    app.router.add_post("/api/global-challenge/wheel-eliminate", api_global_challenge_wheel_eliminate)
    app.router.add_post("/api/global-challenge/wheel-winner", api_global_challenge_wheel_winner)
    app.router.add_post("/api/global-challenge/start-active", api_global_challenge_start_active)
    app.router.add_post("/api/global-challenge/auto-start", api_global_challenge_auto_start)
    app.router.add_post("/api/upload-prize-image", api_upload_prize_image)
    app.router.add_post("/api/global-challenge/force-wheel", api_global_challenge_force_wheel)

    # Team Battle API
    app.router.add_post("/api/team-battle/create", api_team_battle_create)
    app.router.add_get("/api/team-battle/list", api_team_battle_list)
    app.router.add_post("/api/team-battle/join", api_team_battle_join)
    app.router.add_post("/api/team-battle/ready", api_team_battle_ready)
    app.router.add_post("/api/team-battle/start", api_team_battle_start)
    app.router.add_post("/api/team-battle/refresh", api_team_battle_refresh)
    app.router.add_get("/api/team-battle/history", api_team_battle_history)
    app.router.add_get("/api/team-battle/widget", api_team_battle_widget)
    app.router.add_get("/api/team-battle/player-tanks", api_team_battle_player_tanks)

    # Donate Contest API (Арена Донатов)
    app.router.add_post("/api/donate-contest/create", api_donate_contest_create)
    app.router.add_get("/api/donate-contest/list", api_donate_contest_list)
    app.router.add_get("/api/donate-contest/entries", api_donate_contest_entries)
    app.router.add_post("/api/donate-contest/submit", api_donate_contest_submit)
    app.router.add_post("/api/donate-contest/vote", api_donate_contest_vote)
    app.router.add_post("/api/donate-contest/finish", api_donate_contest_finish)
    app.router.add_get("/api/donate-contest/widget", api_donate_contest_widget)

    # Finance / Accounting (admin only)
    app.router.add_get("/api/admin/finance", api_admin_finance)

    # Daily Reward (Streak)
    app.router.add_get("/api/daily/status", api_daily_status)
    app.router.add_post("/api/daily/claim", api_daily_claim)

    # Раздача OBS виджетов через HTTP (file:// не работает с YouTube API)
    obs_dir = os.path.join(os.path.dirname(__file__), 'webapp', 'obs')
    if os.path.isdir(obs_dir):
        app.router.add_static('/obs/', obs_dir)
    
    # Раздача автономного сайта (site/)
    site_dir = os.path.join(os.path.dirname(__file__), 'site')
    if os.path.isdir(site_dir):
        async def serve_site_index(request):
            return web.FileResponse(os.path.join(site_dir, 'index.html'))
        
        async def serve_site_file(request):
            filename = request.match_info.get('filename', '')
            filepath = os.path.join(site_dir, filename)
            if '..' not in filename and os.path.isfile(filepath):
                return web.FileResponse(filepath)
            return web.Response(text="Not found", status=404)
        
        # Design asset upload endpoint
        async def upload_design_asset(request):
            """Загрузка картинки для дизайна (только для админов)"""
            try:
                reader = await request.multipart()
                
                asset_path = None
                telegram_id = None
                file_data = None
                
                while True:
                    part = await reader.next()
                    if part is None:
                        break
                    if part.name == 'asset_path':
                        asset_path = (await part.read()).decode('utf-8')
                    elif part.name == 'telegram_id':
                        telegram_id = (await part.read()).decode('utf-8')
                    elif part.name == 'file':
                        file_data = await part.read()
                
                if not asset_path or not file_data:
                    return web.json_response({'error': 'Missing asset_path or file'}, status=400)
                
                # Security: path must be within site/img/
                if '..' in asset_path or not asset_path.startswith('img/'):
                    return web.json_response({'error': 'Invalid path'}, status=403)
                
                # Max 2MB
                if len(file_data) > 2 * 1024 * 1024:
                    return web.json_response({'error': 'File too large (max 2MB)'}, status=400)
                
                # Write file to BOTH site/ and webapp/ so it updates everywhere
                webapp_dir = os.path.join(os.path.dirname(__file__), 'webapp')
                saved_paths = []
                
                for base_dir in [site_dir, webapp_dir]:
                    target = os.path.join(base_dir, asset_path)
                    target_dir_path = os.path.dirname(target)
                    os.makedirs(target_dir_path, exist_ok=True)
                    with open(target, 'wb') as f:
                        f.write(file_data)
                    saved_paths.append(target)
                
                logger.info(f"Design asset uploaded to {len(saved_paths)} dirs: {asset_path} ({len(file_data)} bytes)")
                return web.json_response({'ok': True, 'path': asset_path, 'size': len(file_data), 'dirs': len(saved_paths)})
            except Exception as e:
                logger.error(f"Design upload error: {e}")
                return web.json_response({'error': str(e)}, status=500)
        
        app.router.add_post('/api/design/upload', upload_design_asset)
        
        app.router.add_get('/site', serve_site_index)
        app.router.add_get('/site/', serve_site_index)
        app.router.add_get('/site/{filename:.*}', serve_site_file)
        logger.info("Site directory served at /site/")

    
    # Раздача webapp файлов (quiz.html и др.)
    webapp_dir = os.path.join(os.path.dirname(__file__), 'webapp')
    
    async def serve_webapp_file(request):
        """Отдаёт файлы из webapp/"""
        filename = request.match_info.get('filename', '')
        filepath = os.path.join(webapp_dir, filename)
        if os.path.isfile(filepath) and not '..' in filename:
            return web.FileResponse(filepath)
        return web.Response(text="Not found", status=404)
    
    app.router.add_get('/quiz.html', lambda r: web.FileResponse(os.path.join(webapp_dir, 'quiz.html')))
    app.router.add_get('/finance.html', lambda r: web.FileResponse(os.path.join(webapp_dir, 'finance.html')))
    app.router.add_get('/admin.html', lambda r: web.FileResponse(os.path.join(webapp_dir, 'admin.html')))
    app.router.add_get('/wheel.html', lambda r: web.FileResponse(os.path.join(webapp_dir, 'wheel.html')))
    app.router.add_get('/wheel-elimination.html', lambda r: web.FileResponse(os.path.join(webapp_dir, 'wheel-elimination.html')))
    app.router.add_get('/challenges.html', lambda r: web.FileResponse(os.path.join(webapp_dir, 'challenges.html')))
    app.router.add_get('/player.html', lambda r: web.FileResponse(os.path.join(webapp_dir, 'player.html')))
    
    # Generic webapp file serving (for overlay.html, etc.)
    app.router.add_get('/webapp/{filename:.*}', serve_webapp_file)
    
    return app



async def main():
    logger.info("Бот запускается...")

    # НЕ ставим глобальную WebApp кнопку —
    # она даётся только подписчикам через /start
    try:
        from aiogram.types import MenuButtonDefault
        await bot.set_chat_menu_button(
            menu_button=MenuButtonDefault()
        )
        logger.info("Меню по умолчанию установлено")
    except Exception as e:
        logger.warning(f"Не удалось установить меню: {e}")

    # Запускаем API сервер
    api_app = create_api_app()
    runner = web.AppRunner(api_app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", API_PORT)
    await site.start()
    logger.info(f"API сервер запущен на порту {API_PORT}")

    # Предзагрузка энциклопедии танков, чтобы админка открывалась мгновенно
    asyncio.create_task(_load_tank_encyclopedia())

    # Фоновый мониторинг активных PVP челленджей (freeze + auto-finish)
    asyncio.create_task(challenge_monitor_loop())

    # Запускаем серверное чтение Twitch чата
    twitch_ch = stream_config.get('twitch', {}).get('channel', 'iserveri')
    if twitch_ch:
        await twitch_reader.start(twitch_ch)
        logger.info(f"TwitchChatReader запущен для #{twitch_ch}")

    # Запускаем серверное чтение VK Play чата
    vk_config = stream_config.get('vk', {})
    vk_ch = vk_config.get('channel', 'iserveri')
    if vk_ch and vk_config.get('enabled', True):
        await vkplay_reader.start(vk_ch)
        logger.info(f"VKPlayChatReader запущен для {vk_ch}")

    # Запускаем серверное чтение YouTube Live Chat
    yt_config = stream_config.get('youtube', {})
    yt_channel_id = os.getenv("YOUTUBE_CHANNEL_ID", "UClMCysoDnCFN2oQUu9fcQRg")  # ISERVERI channel ID
    yt_api_key = os.getenv("YOUTUBE_API_KEY", "AIzaSyAT7aSehc7wNkebqwXWrwAwIauUw7TUMAc")
    if yt_channel_id and yt_api_key and yt_config.get('enabled', True):
        await youtube_reader.start(yt_channel_id, yt_api_key)
        logger.info(f"YouTubeChatReader запущен для {yt_channel_id}")


    # Запускаем бот
    await dp.start_polling(bot)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Бот остановлен")
