"""
Быстрый in-memory TTL кеш для горячих API эндпоинтов.

Вместо 1000 одинаковых запросов к БД за 5 секунд —
1 реальный запрос, остальные 999 из кеша.

Использование:
    from cache import cache

    data = cache.get("gc_active")
    if data is None:
        data = await fetch_from_db()
        cache.set("gc_active", data, ttl=5)
"""

import time
import logging
import asyncio
from functools import wraps

logger = logging.getLogger(__name__)


class TTLCache:
    """Thread-safe in-memory кеш с TTL (Time To Live)"""

    def __init__(self, max_size: int = 500):
        self._cache: dict = {}
        self._max_size = max_size
        self._hits = 0
        self._misses = 0

    def get(self, key: str):
        """Получить значение из кеша. Возвращает None если не найдено или просрочено."""
        if key in self._cache:
            value, expires = self._cache[key]
            if time.time() < expires:
                self._hits += 1
                return value
            # Просрочено — удаляем
            del self._cache[key]
        self._misses += 1
        return None

    def set(self, key: str, value, ttl: int = 5):
        """Записать значение в кеш с TTL в секундах."""
        # Защита от переполнения
        if len(self._cache) >= self._max_size:
            self._evict_expired()
            if len(self._cache) >= self._max_size:
                # Удаляем самые старые 20%
                to_remove = list(self._cache.keys())[:self._max_size // 5]
                for k in to_remove:
                    del self._cache[k]

        self._cache[key] = (value, time.time() + ttl)

    def invalidate(self, key: str):
        """Удалить конкретный ключ из кеша."""
        self._cache.pop(key, None)

    def invalidate_prefix(self, prefix: str):
        """Удалить все ключи с данным префиксом.
        Пример: cache.invalidate_prefix("gc_") — сбросит все данные челленджей.
        """
        keys = [k for k in self._cache if k.startswith(prefix)]
        for k in keys:
            del self._cache[k]

    def clear(self):
        """Очистить весь кеш."""
        self._cache.clear()
        self._hits = 0
        self._misses = 0

    def stats(self) -> dict:
        """Статистика кеша (для /api/admin/cache-stats)."""
        total = self._hits + self._misses
        return {
            "size": len(self._cache),
            "max_size": self._max_size,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": f"{(self._hits / total * 100):.1f}%" if total > 0 else "0%",
        }

    def _evict_expired(self):
        """Удалить все просроченные записи."""
        now = time.time()
        expired = [k for k, (_, exp) in self._cache.items() if now >= exp]
        for k in expired:
            del self._cache[k]


# ── Глобальный инстанс кеша ──
cache = TTLCache(max_size=500)


# ── Декоратор для автоматического кеширования API хэндлеров ──
def cached_response(key: str, ttl: int = 5):
    """Декоратор: кеширует результат API handler на ttl секунд.
    
    Использование:
        @cached_response("gc_active", ttl=5)
        async def api_global_challenge_active(request):
            ...  # Тяжёлый запрос к БД
            return cors_response(data)
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(request):
            cached = cache.get(key)
            if cached is not None:
                return cached
            response = await func(request)
            cache.set(key, response, ttl=ttl)
            return response
        return wrapper
    return decorator


def cached_response_dynamic(key_func, ttl: int = 5):
    """Декоратор: кеширует с динамическим ключом из параметров запроса.
    
    Использование:
        @cached_response_dynamic(lambda r: f"profile_{r.query.get('telegram_id')}", ttl=10)
        async def api_profile_get(request):
            ...
    """
    def decorator(func):
        @wraps(func)
        async def wrapper(request):
            key = key_func(request)
            if key:
                cached = cache.get(key)
                if cached is not None:
                    return cached
            response = await func(request)
            if key:
                cache.set(key, response, ttl=ttl)
            return response
        return wrapper
    return decorator
