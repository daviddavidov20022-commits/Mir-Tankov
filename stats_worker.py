"""
Stats Worker — фоновый сервис обновления статистики для Мир Танков.

Зачем нужен:
    Когда 1000 юзеров в челлендже и все нажимают "Обновить":
    - БЕЗ воркера: 1000 запросов к Lesta API + 20 сек блокировки бота
    - С воркером: Бот просто читает готовые данные из БД за <1 сек

Что делает:
    1. Каждые 15 сек ищет активные global challenges
    2. Собирает account_ids всех участников
    3. Batch-запрос к Lesta API (параллельно, по 40 одновременно)
    4. Обновляет БД с новыми данными
    5. Инвалидирует кеш

Деплой на Railway:
    Railway → New Service → Deploy from GitHub
    Start Command: python stats_worker.py
    Variables: DATABASE_URL, LESTA_APP_IDS (те же что у бота)
    Resources: 256MB RAM

Можно также запустить в том же процессе:
    from stats_worker import run_worker_background
    asyncio.create_task(run_worker_background())
"""

import os
import sys
import json
import time
import asyncio
import logging
import aiohttp
from datetime import datetime, timezone

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [STATS] %(levelname)s: %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("stats_worker")

# ── Lesta API Keys (ротация) ──
LESTA_APP_IDS = []
_lesta_key_index = 0

def _init_lesta_keys():
    global LESTA_APP_IDS
    raw_keys = []
    
    # Собираем ключи из всех возможных переменных
    for env_name in ["LESTA_APP_IDS", "LESTA_APP_ID", "LESTA_APP_I"]:
        val = os.getenv(env_name, "").replace("\n", ",").replace("\r", ",")
        raw_keys.extend(val.split(","))
    
    for key, val in os.environ.items():
        if key.startswith("LESTA_APP_ID_") and val.strip():
            raw_keys.extend(val.replace("\n", ",").replace("\r", ",").split(","))
    
    LESTA_APP_IDS = list(dict.fromkeys(
        s.strip() for s in raw_keys if len(s.strip()) == 32
    ))
    logger.info(f"Lesta API keys: {len(LESTA_APP_IDS)}")

def get_lesta_app_id():
    global _lesta_key_index
    if not LESTA_APP_IDS:
        return ""
    key = LESTA_APP_IDS[_lesta_key_index]
    _lesta_key_index = (_lesta_key_index + 1) % len(LESTA_APP_IDS)
    return key


# ── Condition → API field mapping ──
GC_CONDITION_TO_STAT = {
    "damage": "damage_dealt",
    "frags": "frags",
    "xp": "xp",
    "spotting": "spotted",
    "blocked": "avg_damage_blocked",
    "wins": "wins",
}
GC_ACCOUNT_LEVEL_CONDITIONS = {"spotting_damage", "combined"}

# ── Конфигурация ──
REFRESH_INTERVAL = int(os.getenv("STATS_REFRESH_INTERVAL", "15"))  # секунд
BATCH_SIZE = 100  # account IDs per Lesta API request


# ═══════════════════════════════════════════════════
# LESTA API FUNCTIONS (копия из bot.py, standalone)
# ═══════════════════════════════════════════════════

async def fetch_account_assisted(session, account_ids):
    """Получить урон по засвету из account/info (батчем до 100 ID)"""
    results = {}
    for i in range(0, len(account_ids), BATCH_SIZE):
        batch = account_ids[i:i + BATCH_SIZE]
        ids_str = ",".join(str(aid) for aid in batch)
        url = (f"https://api.tanki.su/wot/account/info/"
               f"?application_id={get_lesta_app_id()}&account_id={ids_str}"
               f"&fields=statistics.all.avg_damage_assisted,statistics.all.avg_damage_assisted_radio,"
               f"statistics.all.avg_damage_assisted_track,statistics.all.avg_damage_blocked,"
               f"statistics.all.battles,statistics.all.damage_dealt")
        try:
            async with session.get(url) as resp:
                data = await resp.json()
            if data.get("status") != "ok":
                continue
            for aid_str, pdata in (data.get("data") or {}).items():
                if not pdata:
                    continue
                stats_all = pdata.get("statistics", {}).get("all", {})
                battles = stats_all.get("battles", 0) or 0
                avg_assisted = stats_all.get("avg_damage_assisted", 0) or 0
                results[int(aid_str)] = {
                    "assisted": int(avg_assisted * battles),
                    "battles": battles,
                    "damage_dealt": stats_all.get("damage_dealt", 0) or 0,
                }
        except Exception as e:
            logger.warning(f"Account/info fetch error: {e}")
    return results


async def fetch_batch_stats(account_ids, conditions_str, tank_class=None, tank_tier=None, tank_id_filter=None):
    """Batch-запрос к Lesta API для всех участников.
    Возвращает: {account_id: {"battles": N, "per_condition": {cond: val}, "value": V}}
    """
    if not account_ids:
        return {}
    
    conditions = [c.strip() for c in conditions_str.split(",") if c.strip()]
    if not conditions:
        conditions = ["damage"]
    
    tank_conditions = [c for c in conditions if c not in GC_ACCOUNT_LEVEL_CONDITIONS]
    account_conditions = [c for c in conditions if c in GC_ACCOUNT_LEVEL_CONDITIONS]
    
    COND_TO_FIELD = {
        "damage": "damage_dealt", "frags": "frags", "xp": "xp",
        "spotting": "spotted", "blocked": "avg_damage_blocked", "wins": "wins",
    }
    
    tank_fields = set(["battles"])
    for cond in tank_conditions:
        tank_fields.add(COND_TO_FIELD.get(cond, "damage_dealt"))
    fields_str = ",".join(f"all.{f}" for f in tank_fields) + ",tank_id"
    
    results = {}
    
    # Параллельный batch-запрос к tanks/stats
    CONCURRENT = max(10, len(LESTA_APP_IDS) * 10)
    semaphore = asyncio.Semaphore(CONCURRENT)
    timeout = aiohttp.ClientTimeout(total=20)
    
    async def fetch_one(session, aid):
        async with semaphore:
            try:
                url = (f"https://api.tanki.su/wot/tanks/stats/"
                       f"?application_id={get_lesta_app_id()}&account_id={aid}"
                       f"&fields={fields_str}")
                async with session.get(url) as resp:
                    data = await resp.json()
                
                if data.get("status") != "ok":
                    return None
                
                tanks = data["data"].get(str(aid))
                if not tanks:
                    return None
                
                total_battles = 0
                per_condition = {c: 0 for c in tank_conditions}
                
                for t in tanks:
                    all_stats = t.get("all", {})
                    # TODO: tank_class/tank_tier filtering (needs encyclopedia lookup)
                    tank_battles = all_stats.get("battles", 0)
                    total_battles += tank_battles
                    for cond in tank_conditions:
                        field = COND_TO_FIELD.get(cond, "damage_dealt")
                        if cond == "blocked":
                            avg_blocked = all_stats.get("avg_damage_blocked", 0) or 0
                            per_condition[cond] += int(avg_blocked * tank_battles)
                        else:
                            per_condition[cond] += all_stats.get(field, 0)
                
                return (aid, {"battles": total_battles, "per_condition": per_condition})
            except Exception as e:
                logger.warning(f"Fetch error for {aid}: {e}")
                return None
    
    connector = aiohttp.TCPConnector(limit=CONCURRENT, limit_per_host=CONCURRENT)
    async with aiohttp.ClientSession(timeout=timeout, connector=connector) as session:
        tasks = [fetch_one(session, aid) for aid in account_ids]
        all_results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for res in all_results:
            if isinstance(res, Exception) or res is None:
                continue
            aid, data = res
            results[aid] = data
        
        # Account-level conditions (spotting_damage, combined)
        if account_conditions:
            try:
                valid_aids = list(results.keys()) if results else account_ids
                acc_data = await fetch_account_assisted(session, valid_aids)
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
                logger.error(f"Account/info batch error: {e}")
    
    # Добавляем value = первое условие
    first_cond = conditions[0]
    for aid in results:
        results[aid]["value"] = results[aid]["per_condition"].get(first_cond, 0)
    
    return results


# ═══════════════════════════════════════════════════
# MAIN WORKER LOOP
# ═══════════════════════════════════════════════════

async def refresh_active_challenges():
    """Один цикл обновления: найти активные челленджи → обновить стату."""
    from database import get_db, get_db_read
    
    # 1. Найти активные челленджи
    with get_db_read() as conn:
        challenges = conn.execute(
            "SELECT * FROM global_challenges WHERE status = 'active' ORDER BY created_at DESC"
        ).fetchall()
    
    if not challenges:
        return 0  # Нет активных
    
    total_updated = 0
    
    for ch in challenges:
        ch = dict(ch)
        ch_id = ch["id"]
        condition = ch.get("condition", "damage")
        conditions = [c.strip() for c in condition.split(",") if c.strip()]
        max_battles = ch.get("max_battles", 0) or 0
        
        # 2. Получить участников
        with get_db_read() as conn:
            participants = conn.execute(
                "SELECT * FROM global_challenge_participants WHERE challenge_id = ?",
                (ch_id,)
            ).fetchall()
        
        if not participants:
            continue
        
        # 3. Собрать account_ids
        participant_map = {}  # {account_id: participant_dict}
        for p in participants:
            p = dict(p)
            # Получаем account_id из участника или из таблицы users
            aid = p.get("wot_account_id")
            if not aid:
                with get_db_read() as conn:
                    user = conn.execute(
                        "SELECT wot_account_id FROM users WHERE telegram_id = ?",
                        (p["telegram_id"],)
                    ).fetchone()
                    if user:
                        aid = user["wot_account_id"]
            if aid:
                try:
                    participant_map[int(aid)] = p
                except (ValueError, TypeError):
                    pass
        
        if not participant_map:
            continue
        
        account_ids = list(participant_map.keys())
        logger.info(f"Challenge #{ch_id}: refreshing {len(account_ids)} players ({condition})")
        
        # 4. Batch-запрос к Lesta API
        t_start = time.time()
        batch_stats = await fetch_batch_stats(
            account_ids, condition,
            ch.get("tank_class"), ch.get("tank_tier_filter"), ch.get("tank_id_filter")
        )
        api_time = time.time() - t_start
        logger.info(f"  API: {len(batch_stats)}/{len(account_ids)} players in {api_time:.1f}s")
        
        # 5. Обновить БД
        update_batch = []
        for aid, stats in batch_stats.items():
            p = participant_map.get(aid)
            if not p:
                continue
            
            # Считаем дельту от baseline
            baseline_vals = {}
            if p.get("baseline_values"):
                try:
                    baseline_vals = json.loads(p["baseline_values"])
                except Exception:
                    pass
            
            cond_deltas = {}
            total_value = 0
            for c in conditions:
                current_stat = stats["per_condition"].get(c, 0)
                baseline_stat = baseline_vals.get(c, p.get("baseline_value", 0) if c == conditions[0] else 0)
                delta = max(0, current_stat - baseline_stat)
                cond_deltas[c] = delta
                total_value += delta
            
            new_battles = max(0, stats["battles"] - p.get("baseline_battles", 0))
            if max_battles > 0 and new_battles > max_battles:
                new_battles = max_battles
            
            condition_values_json = json.dumps(cond_deltas)
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            
            update_batch.append((
                total_value, new_battles, now_str, condition_values_json,
                ch_id, p["telegram_id"]
            ))
        
        # Batch-запись
        if update_batch:
            with get_db() as conn:
                for params in update_batch:
                    conn.execute("""
                        UPDATE global_challenge_participants 
                        SET current_value = ?, battles_played = ?, last_updated = ?, condition_values = ?
                        WHERE challenge_id = ? AND telegram_id = ?
                    """, params)
            total_updated += len(update_batch)
            logger.info(f"  DB: updated {len(update_batch)} players")
        
        # 6. Проверка завершения челленджа
        try:
            now_utc = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
            with get_db() as conn:
                # По времени
                if ch.get("ends_at", "") <= now_utc:
                    conn.execute(
                        "UPDATE global_challenges SET status = 'finished', finished_at = ? WHERE id = ? AND status = 'active'",
                        (now_utc, ch_id)
                    )
                    logger.info(f"  ⏰ Challenge #{ch_id} auto-finished (time expired)")
                # По боям
                elif max_battles > 0:
                    not_finished = conn.execute(
                        "SELECT COUNT(*) FROM global_challenge_participants WHERE challenge_id = ? AND battles_played < ?",
                        (ch_id, max_battles)
                    ).fetchone()[0]
                    if not_finished == 0:
                        conn.execute(
                            "UPDATE global_challenges SET status = 'finished', finished_at = ? WHERE id = ? AND status = 'active'",
                            (now_utc, ch_id)
                        )
                        logger.info(f"  🏁 Challenge #{ch_id} auto-finished (all battles played)")
        except Exception as e:
            logger.error(f"  Auto-finish check error: {e}")
    
    # 7. Сбросить кеш (если bot в том же процессе)
    try:
        from cache import cache
        cache.invalidate_prefix("gc_")
    except ImportError:
        pass
    
    return total_updated


async def worker_loop():
    """Бесконечный цикл обновления статистики."""
    logger.info(f"Stats Worker started (interval: {REFRESH_INTERVAL}s)")
    
    while True:
        try:
            updated = await refresh_active_challenges()
            if updated > 0:
                logger.info(f"✅ Cycle done: {updated} players updated")
        except Exception as e:
            logger.error(f"❌ Worker cycle error: {e}", exc_info=True)
        
        await asyncio.sleep(REFRESH_INTERVAL)


async def run_worker_background():
    """Запуск воркера как background task в основном процессе бота.
    
    Использование в bot.py:
        from stats_worker import run_worker_background
        asyncio.create_task(run_worker_background())
    """
    # Ждём 10 сек чтобы бот полностью стартовал
    await asyncio.sleep(10)
    await worker_loop()


# ═══════════════════════════════════════════════════
# STANDALONE MODE — запуск как отдельный сервис
# ═══════════════════════════════════════════════════

async def main():
    _init_lesta_keys()
    
    if not LESTA_APP_IDS:
        logger.error("No Lesta API keys found! Set LESTA_APP_IDS env variable.")
        sys.exit(1)
    
    logger.info(f"Standalone Stats Worker")
    logger.info(f"  Keys: {len(LESTA_APP_IDS)}")
    logger.info(f"  Interval: {REFRESH_INTERVAL}s")
    
    await worker_loop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Stats Worker stopped")
