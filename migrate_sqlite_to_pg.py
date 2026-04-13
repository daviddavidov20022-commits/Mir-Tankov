"""
Скрипт миграции данных: SQLite → PostgreSQL

Использование:
    1. Убедитесь что DATABASE_URL установлен
    2. python migrate_sqlite_to_pg.py

Скрипт:
    1. Создаёт все таблицы в PostgreSQL (через init_db)
    2. Копирует все данные из SQLite в PostgreSQL
    3. Показывает статистику миграции
"""

import os
import sys
import sqlite3
import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    print("❌ DATABASE_URL не установлен!")
    print("   Добавьте: set DATABASE_URL=postgresql://user:pass@host:5432/dbname")
    sys.exit(1)

# Путь к SQLite
_volume_path = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "")
if _volume_path and os.path.isdir(_volume_path):
    SQLITE_PATH = os.path.join(_volume_path, "ecosystem.db")
else:
    SQLITE_PATH = os.path.join(os.path.dirname(__file__), "ecosystem.db")

if not os.path.exists(SQLITE_PATH):
    print(f"❌ SQLite database not found: {SQLITE_PATH}")
    sys.exit(1)

print(f"📂 SQLite: {SQLITE_PATH}")
print(f"🐘 PostgreSQL: {DATABASE_URL[:50]}...")
print()

# Подключаемся к обоим
try:
    import psycopg2
    from psycopg2.extras import RealDictCursor
except ImportError:
    print("❌ psycopg2 не установлен!")
    print("   pip install psycopg2-binary")
    sys.exit(1)

sqlite_conn = sqlite3.connect(SQLITE_PATH)
sqlite_conn.row_factory = sqlite3.Row

pg_conn = psycopg2.connect(DATABASE_URL)
pg_cursor = pg_conn.cursor()


def get_sqlite_tables():
    """Получить список таблиц из SQLite"""
    rows = sqlite_conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()
    return [r[0] for r in rows]


def get_table_columns(table_name):
    """Получить список колонок таблицы"""
    rows = sqlite_conn.execute(f"PRAGMA table_info({table_name})").fetchall()
    return [r[1] for r in rows]  # r[1] = column name


def migrate_table(table_name):
    """Мигрирует данные одной таблицы"""
    columns = get_table_columns(table_name)
    rows = sqlite_conn.execute(f"SELECT * FROM {table_name}").fetchall()
    
    if not rows:
        logger.info(f"  ⏭ {table_name}: пусто (0 записей)")
        return 0
    
    # Формируем INSERT
    placeholders = ", ".join(["%s"] * len(columns))
    columns_str = ", ".join(f'"{c}"' for c in columns)
    
    # Используем ON CONFLICT DO NOTHING чтобы не падать на дубликатах
    insert_sql = f'INSERT INTO "{table_name}" ({columns_str}) VALUES ({placeholders}) ON CONFLICT DO NOTHING'
    
    count = 0
    batch = []
    for row in rows:
        values = tuple(row[col] for col in columns)
        batch.append(values)
        
        if len(batch) >= 100:
            try:
                pg_cursor.executemany(insert_sql, batch)
                count += len(batch)
            except Exception as e:
                pg_conn.rollback()
                # Пробуем по одной
                for v in batch:
                    try:
                        pg_cursor.execute(insert_sql, v)
                        pg_conn.commit()
                        count += 1
                    except Exception:
                        pg_conn.rollback()
            batch = []
    
    # Остаток
    if batch:
        try:
            pg_cursor.executemany(insert_sql, batch)
            count += len(batch)
        except Exception:
            pg_conn.rollback()
            for v in batch:
                try:
                    pg_cursor.execute(insert_sql, v)
                    pg_conn.commit()
                    count += 1
                except Exception:
                    pg_conn.rollback()
    
    pg_conn.commit()
    
    # Обновляем SERIAL sequence для таблиц с id
    if "id" in columns:
        try:
            pg_cursor.execute(f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), COALESCE(MAX(id), 0) + 1, false) FROM \"{table_name}\"")
            pg_conn.commit()
        except Exception:
            pg_conn.rollback()
    
    logger.info(f"  ✅ {table_name}: {count}/{len(rows)} записей")
    return count


def main():
    print("=" * 50)
    print("🚀 МИГРАЦИЯ: SQLite → PostgreSQL")
    print("=" * 50)
    print()
    
    # Шаг 1: Создаём таблицы через стандартный init_db
    print("📋 Шаг 1: Создание таблиц в PostgreSQL...")
    try:
        # Временно ставим DATABASE_URL чтобы init_db использовал PG
        os.environ["DATABASE_URL"] = DATABASE_URL
        
        # Импортируем ПОСЛЕ установки переменной
        # Это заставит db_engine использовать PostgreSQL
        from database import init_db
        init_db()
        print("  ✅ Таблицы созданы")
    except Exception as e:
        print(f"  ⚠️ Частичное создание таблиц: {e}")
        # Продолжаем — некоторые таблицы могут быть уже созданы
    
    print()
    
    # Шаг 2: Мигрируем данные
    tables = get_sqlite_tables()
    print(f"📋 Шаг 2: Миграция данных ({len(tables)} таблиц)...")
    
    total_records = 0
    for table in tables:
        try:
            count = migrate_table(table)
            total_records += count
        except Exception as e:
            logger.error(f"  ❌ {table}: {e}")
    
    print()
    print("=" * 50)
    print(f"✅ МИГРАЦИЯ ЗАВЕРШЕНА: {total_records} записей перенесено")
    print("=" * 50)
    print()
    print("Следующие шаги:")
    print("1. Проверьте данные: python -c \"from database import *; print(get_total_users())\"")
    print("2. Добавьте DATABASE_URL в Railway Variables")
    print("3. git push — Railway переключится на PostgreSQL автоматически")
    
    sqlite_conn.close()
    pg_conn.close()


if __name__ == "__main__":
    main()
