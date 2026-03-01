"""
Gemini AI модуль для админки Telegram-бота Мир Танков.

Возможности:
- Генерация изображений по описанию
- Замена иконок/картинок в приложении
- AI-ассистент для настройки приложения

Требуется: google-generativeai
pip install google-generativeai
"""

import os
import logging
import aiohttp
import json
import base64
from datetime import datetime
from dotenv import load_dotenv

# Загружаем переменные из .env
load_dotenv()

logger = logging.getLogger(__name__)

# ============================================================
# НАСТРОЙКИ GEMINI
# ============================================================
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = "gemini-3-flash-preview"  # Модель для текста
GEMINI_IMG_MODEL = "gemini-3-flash-preview"  # Модель для изображений
GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta"

# Путь к папке с изображениями webapp
IMAGES_DIR = os.path.join(os.path.dirname(__file__), "webapp", "img")

# Создаём папку если нет
os.makedirs(IMAGES_DIR, exist_ok=True)


# ============================================================
# ГЕНЕРАЦИЯ ИЗОБРАЖЕНИЙ
# ============================================================
async def generate_image(prompt: str, filename: str = None) -> dict:
    """
    Генерация изображения через Gemini API.
    
    Args:
        prompt: Описание изображения
        filename: Имя файла для сохранения (без расширения)
    
    Returns:
        dict с ключами: success, image_path, error
    """
    if not GEMINI_API_KEY:
        return {
            "success": False,
            "error": "API ключ Gemini не настроен. Вставьте ключ в GEMINI_API_KEY в файле gemini_ai.py"
        }

    # Формируем промпт для игрового дизайна
    full_prompt = (
        f"Generate a game icon/image for World of Tanks themed application. "
        f"Style: dark, military, metallic, premium gaming UI. "
        f"Colors: dark steel grey (#1a2332), gold (#C8AA6E), olive green. "
        f"No text on the image. Clean edges, suitable for mobile app. "
        f"Request: {prompt}"
    )

    try:
        url = f"{GEMINI_API_URL}/models/{GEMINI_IMG_MODEL}:generateContent?key={GEMINI_API_KEY}"

        payload = {
            "contents": [{
                "parts": [{"text": full_prompt}]
            }],
            "generationConfig": {
                "responseModalities": ["TEXT", "IMAGE"],
            }
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=60)) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error(f"Gemini API ошибка: {resp.status} - {error_text}")
                    return {
                        "success": False,
                        "error": f"API ошибка: {resp.status}"
                    }

                data = await resp.json()

                # Ищем изображение в ответе
                candidates = data.get("candidates", [])
                if not candidates:
                    return {"success": False, "error": "Нет результатов от Gemini"}

                for part in candidates[0].get("content", {}).get("parts", []):
                    if "inlineData" in part:
                        image_data = part["inlineData"]["data"]
                        mime_type = part["inlineData"].get("mimeType", "image/png")

                        # Определяем расширение
                        ext = "png"
                        if "jpeg" in mime_type or "jpg" in mime_type:
                            ext = "jpg"
                        elif "webp" in mime_type:
                            ext = "webp"

                        # Имя файла
                        if not filename:
                            filename = f"generated_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

                        filepath = os.path.join(IMAGES_DIR, f"{filename}.{ext}")

                        # Сохраняем
                        image_bytes = base64.b64decode(image_data)
                        with open(filepath, "wb") as f:
                            f.write(image_bytes)

                        logger.info(f"Изображение сохранено: {filepath}")

                        return {
                            "success": True,
                            "image_path": filepath,
                            "filename": f"{filename}.{ext}",
                            "relative_path": f"img/{filename}.{ext}",
                        }

                return {"success": False, "error": "Gemini не вернул изображение"}

    except aiohttp.ClientError as e:
        logger.error(f"Ошибка сети: {e}")
        return {"success": False, "error": f"Ошибка сети: {str(e)}"}
    except Exception as e:
        logger.error(f"Ошибка генерации: {e}")
        return {"success": False, "error": str(e)}


# ============================================================
# AI ТЕКСТОВЫЙ АССИСТЕНТ
# ============================================================
async def ask_gemini(question: str) -> str:
    """
    Задать вопрос Gemini AI (текстовый ответ).
    """
    if not GEMINI_API_KEY:
        return "❌ API ключ Gemini не настроен."

    try:
        url = f"{GEMINI_API_URL}/models/{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"

        payload = {
            "contents": [{
                "parts": [{"text": (
                    "Ты — ассистент для настройки Telegram-бота и мини-приложения Мир Танков. "
                    "Отвечай кратко, по-русски. "
                    f"Вопрос: {question}"
                )}]
            }],
            "generationConfig": {
                "maxOutputTokens": 500,
                "temperature": 0.7,
            }
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=30)) as resp:
                if resp.status != 200:
                    return f"❌ Ошибка API: {resp.status}"

                data = await resp.json()
                candidates = data.get("candidates", [])
                if candidates:
                    text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                    return text or "Нет ответа"

                return "Нет ответа от Gemini"

    except Exception as e:
        return f"❌ Ошибка: {str(e)}"


# ============================================================
# УПРАВЛЕНИЕ ИЗОБРАЖЕНИЯМИ
# ============================================================
def get_saved_images() -> list:
    """
    Получить список сохранённых изображений.
    """
    images = []
    if os.path.exists(IMAGES_DIR):
        for f in os.listdir(IMAGES_DIR):
            if f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.gif')):
                filepath = os.path.join(IMAGES_DIR, f)
                size_kb = os.path.getsize(filepath) / 1024
                images.append({
                    "filename": f,
                    "path": filepath,
                    "relative_path": f"img/{f}",
                    "size_kb": round(size_kb, 1),
                })
    return images


def delete_image(filename: str) -> bool:
    """
    Удалить изображение.
    """
    filepath = os.path.join(IMAGES_DIR, filename)
    if os.path.exists(filepath):
        os.remove(filepath)
        return True
    return False


# ============================================================
# КОНФИГ ИКОНОК ПРИЛОЖЕНИЯ
# ============================================================
ICONS_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "webapp", "icons-config.json")


def load_icons_config() -> dict:
    """Загрузить конфиг иконок."""
    try:
        with open(ICONS_CONFIG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return get_default_icons()


def save_icons_config(config: dict) -> bool:
    """Сохранить конфиг иконок."""
    try:
        with open(ICONS_CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=4)
        return True
    except Exception as e:
        logger.error(f"Ошибка сохранения иконок: {e}")
        return False


def get_default_icons() -> dict:
    """Иконки по умолчанию."""
    return {
        "stats_card": {"type": "emoji", "value": "🏅"},
        "wheel_card": {"type": "emoji", "value": "🎰"},
        "quiz_card": {"type": "emoji", "value": "❓"},
        "battle_card": {"type": "emoji", "value": "⚔️"},
        "slots_card": {"type": "emoji", "value": "🎰"},
        "missions_card": {"type": "emoji", "value": "📋"},
        "cards_card": {"type": "emoji", "value": "🃏"},
        "profile_avatar": {"type": "emoji", "value": "🪖"},
        "logo": {"type": "emoji", "value": "🪖"},
    }
