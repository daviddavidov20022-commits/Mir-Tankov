"""
Быстрый тест подключения к Gemini API.
Запуск: python test_gemini.py
"""
import os
import asyncio
import aiohttp
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY", "")
API_URL = "https://generativelanguage.googleapis.com/v1beta"


async def list_models():
    """Показать доступные Gemini модели"""
    url = f"{API_URL}/models?key={API_KEY}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            if resp.status == 200:
                data = await resp.json()
                print("\n📋 Доступные Gemini модели:")
                for m in data.get("models", []):
                    name = m["name"].replace("models/", "")
                    if "gemini" in name:
                        methods = ", ".join(m.get("supportedGenerationMethods", []))
                        print(f"   • {name}  [{methods}]")
                return True
            else:
                print(f"❌ Не удалось получить список моделей: {resp.status}")
                return False


async def test_model(model_name):
    """Тест конкретной модели"""
    print(f"\n📡 Тестирую модель: {model_name}...")
    url = f"{API_URL}/models/{model_name}:generateContent?key={API_KEY}"

    payload = {
        "contents": [{"parts": [{"text": "Скажи 'Привет, танкист!' одним предложением."}]}],
        "generationConfig": {"maxOutputTokens": 50}
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    text = data["candidates"][0]["content"]["parts"][0]["text"]
                    print(f"✅ Ответ: {text.strip()}")
                    return True
                else:
                    error = await resp.text()
                    print(f"❌ Ошибка {resp.status}: {error[:200]}")
                    return False
    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return False


async def main():
    print("=" * 40)
    print("🔍 ТЕСТ GEMINI API")
    print("=" * 40)

    if not API_KEY:
        print("❌ GEMINI_API_KEY не найден в .env!")
        return

    print(f"✅ API ключ: {API_KEY[:10]}...{API_KEY[-4:]}")

    # Показать доступные модели
    await list_models()

    # Тестируем актуальные модели
    models_to_try = ["gemini-3-flash-preview", "gemini-2.0-flash", "gemini-1.5-flash"]

    for model in models_to_try:
        success = await test_model(model)
        if success:
            print(f"\n🎉 Рабочая модель: {model}")
            print(f"   Используйте её в gemini_ai.py!")
            return

    print("\n❌ Ни одна модель не заработала.")


if __name__ == "__main__":
    asyncio.run(main())
