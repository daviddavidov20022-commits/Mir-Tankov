import asyncio
import json
import logging
import os
from dotenv import load_dotenv

# ⚠️ ВАЖНО: загрузка .env ПЕРЕД импортом модулей,
# чтобы LESTA_APP_ID и другие ключи были доступны при инициализации
load_dotenv()

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
LESTA_APP_ID = os.getenv("LESTA_APP_ID", "")
VERIFY_REDIRECT_URL = WEBAPP_URL + "verify.html"

# ID администратора (ваш Telegram ID)
# Узнать свой ID: отправьте /myid боту, затем добавьте в .env: ADMIN_ID=123456789
_admin_env = os.getenv("ADMIN_ID", "")
ADMIN_ID = int(_admin_env) if _admin_env.strip() else None

# Путь к конфигу призов
CONFIG_PATH = os.path.join(os.path.dirname(__file__), "webapp", "prizes-config.json")
# ============================================================

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

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
            {"name": "1000 монет", "icon": "💰", "coins": 1000, "xp": 50, "color": "#C8AA6E", "weight": 2, "tier": "legendary"},
            {"name": "50 монет", "icon": "🪙", "coins": 50, "xp": 5, "color": "#2D5A27", "weight": 20, "tier": "common"},
            {"name": "500 монет", "icon": "💎", "coins": 500, "xp": 30, "color": "#4A5568", "weight": 5, "tier": "epic"},
            {"name": "25 монет", "icon": "🪙", "coins": 25, "xp": 3, "color": "#5C6B3C", "weight": 25, "tier": "common"},
            {"name": "250 монет", "icon": "🏅", "coins": 250, "xp": 15, "color": "#8B7340", "weight": 10, "tier": "rare"},
            {"name": "10 монет", "icon": "🔩", "coins": 10, "xp": 1, "color": "#1A3A15", "weight": 30, "tier": "common"},
            {"name": "100 монет", "icon": "⭐", "coins": 100, "xp": 10, "color": "#3D5A80", "weight": 15, "tier": "uncommon"},
            {"name": "75 монет", "icon": "🎖️", "coins": 75, "xp": 8, "color": "#6B5B3C", "weight": 18, "tier": "uncommon"},
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
        reply_keyboard = ReplyKeyboardMarkup(
            keyboard=[
                [
                    KeyboardButton(
                        text="🚀 Войти в Мир Танков",
                        web_app=WebAppInfo(url=WEBAPP_URL),
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

    text = (
        f"👤 <b>ПРОФИЛЬ</b>\n"
        f"━━━━━━━━━━━━━━━━━━━\n\n"
        f"🆔 ID: <code>{message.from_user.id}</code>\n"
        f"👤 Имя: <b>{message.from_user.first_name or '—'}</b>\n"
        f"🪖 WoT Ник: <b>{user.get('wot_nickname') or 'Не привязан'}</b>\n\n"
        f"🪙 Монеты: <b>{user.get('coins', 0)}</b>\n"
        f"⭐ XP: <b>{user.get('xp', 0)}</b>\n"
        f"📊 Уровень: <b>{user.get('level', 1)}</b>\n\n"
        f"💎 Подписка: {sub_text}\n\n"
        f"🎯 Челленджей: <b>{len(challenges)}</b> (✅ {completed})\n"
    )

    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎯 Мои челленджи", callback_data="my_challenges")],
        [InlineKeyboardButton(text="💎 Подписка", callback_data="show_subscribe")],
    ])

    await message.answer(text, parse_mode="HTML", reply_markup=keyboard)


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
                await message.answer(
                    f"✅ <b>НИК ПРИВЯЗАН!</b>\n\n"
                    f"🎮 Ник: <b>{found_nick}</b>\n"
                    f"🆔 Account ID: <code>{account_id}</code>\n\n"
                    f"Теперь вы можете участвовать в\n"
                    f"челленджах и арене! ⚔️\n\n"
                    f"Нажмите /start для входа 🚀",
                    parse_mode="HTML",
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
    if not LESTA_APP_ID:
        await message.answer(
            "❌ LESTA_APP_ID не настроен.\n"
            "Добавьте его в .env файл.",
        )
        return

    auth_url = (
        f"https://api.tanki.su/wot/auth/login/"
        f"?application_id={LESTA_APP_ID}"
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
# ЗАПУСК
# ==========================================
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

    await dp.start_polling(bot)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Бот остановлен")
