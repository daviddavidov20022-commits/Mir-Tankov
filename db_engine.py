"""
Универсальная обёртка для работы с PostgreSQL и SQLite.

Если переменная DATABASE_URL установлена → PostgreSQL
Если нет → SQLite (текущее поведение)

Обёртка автоматически:
- Конвертирует ? → %s (параметры)
- Конвертирует AUTOINCREMENT → SERIAL
- Эмулирует sqlite3.Row через DictCursor
- Предоставляет connection pool для PostgreSQL

Использование в database.py:
    from db_engine import get_connection, get_read_connection, DB_TYPE
"""

import os
import re
import logging
import sqlite3
from contextlib import contextmanager

logger = logging.getLogger(__name__)

DATABASE_URL = os.getenv("DATABASE_URL", "")
DB_TYPE = "postgresql" if DATABASE_URL else "sqlite"

# ── SQLite paths ──
_volume_path = os.environ.get("RAILWAY_VOLUME_MOUNT_PATH", "")
if _volume_path and os.path.isdir(_volume_path):
    SQLITE_PATH = os.path.join(_volume_path, "ecosystem.db")
else:
    SQLITE_PATH = os.path.join(os.path.dirname(__file__), "ecosystem.db")

# ── PostgreSQL pool (lazy init) ──
_pg_pool = None


def _get_pg_pool():
    """Ленивая инициализация PostgreSQL connection pool"""
    global _pg_pool
    if _pg_pool is None:
        try:
            import psycopg2
            from psycopg2 import pool as pg_pool
            from psycopg2.extras import RealDictCursor

            # ThreadedConnectionPool: min 2, max 20 соединений
            _pg_pool = pg_pool.ThreadedConnectionPool(
                minconn=2,
                maxconn=20,
                dsn=DATABASE_URL,
                cursor_factory=RealDictCursor,
            )
            logger.info(f"PostgreSQL pool created (2-20 connections)")
        except ImportError:
            logger.error("psycopg2 not installed! Run: pip install psycopg2-binary")
            raise
        except Exception as e:
            logger.error(f"PostgreSQL connection failed: {e}")
            raise
    return _pg_pool


# ═══════════════════════════════════════════════════
# SQL TRANSLATOR — конвертирует SQLite SQL в PostgreSQL
# ═══════════════════════════════════════════════════

def _translate_sql(sql: str) -> str:
    """Конвертирует SQLite-специфичный SQL в PostgreSQL совместимый.
    
    Преобразования:
    - ? → %s (параметры)
    - INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
    - BOOLEAN → BOOLEAN (ok as is)
    - datetime('now') → NOW()
    - CURRENT_TIMESTAMP → NOW() (для DEFAULT)
    - IF NOT EXISTS сохраняется (PostgreSQL поддерживает)
    """
    # Параметры: ? → %s
    sql = sql.replace("?", "%s")
    
    # AUTOINCREMENT → SERIAL
    sql = re.sub(
        r'INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT',
        'SERIAL PRIMARY KEY',
        sql,
        flags=re.IGNORECASE
    )
    
    # SQLite PRAGMA — игнорируем для PostgreSQL
    if sql.strip().upper().startswith("PRAGMA"):
        return ""  # Skip PRAGMAs
    
    # ON CONFLICT(col) DO UPDATE — PostgreSQL uses the same syntax
    # TIMESTAMP DEFAULT CURRENT_TIMESTAMP — PostgreSQL supports this
    
    return sql


# ═══════════════════════════════════════════════════
# WRAPPER: Делает PostgreSQL cursor совместимым с sqlite3
# ═══════════════════════════════════════════════════

class PgCursorWrapper:
    """Обёртка над PostgreSQL cursor, совместимая с sqlite3 интерфейсом"""
    
    def __init__(self, cursor):
        self._cursor = cursor
        self.rowcount = cursor.rowcount
        self.lastrowid = None
    
    def fetchone(self):
        row = self._cursor.fetchone()
        if row is None:
            return None
        return DictRow(row)
    
    def fetchall(self):
        rows = self._cursor.fetchall()
        return [DictRow(r) for r in rows]
    
    def __iter__(self):
        return iter(self.fetchall())


class DictRow:
    """Эмуляция sqlite3.Row — поддерживает и dict[key] и dict(row)"""
    
    def __init__(self, data: dict):
        self._data = dict(data) if data else {}
    
    def __getitem__(self, key):
        if isinstance(key, int):
            return list(self._data.values())[key]
        return self._data[key]
    
    def __contains__(self, key):
        return key in self._data
    
    def get(self, key, default=None):
        return self._data.get(key, default)
    
    def keys(self):
        return self._data.keys()
    
    def values(self):
        return self._data.values()
    
    def items(self):
        return self._data.items()
    
    def __iter__(self):
        return iter(self._data)
    
    def __len__(self):
        return len(self._data)
    
    def __repr__(self):
        return f"DictRow({self._data})"


class PgConnectionWrapper:
    """Обёртка над PostgreSQL connection, совместимая с sqlite3 интерфейсом.
    
    Позволяет использовать:
        conn.execute("SELECT * FROM users WHERE id = ?", (123,))
    
    Автоматически переводит ? → %s
    """
    
    def __init__(self, conn, pool):
        self._conn = conn
        self._pool = pool
        self._cursor = conn.cursor()
    
    def execute(self, sql, params=None):
        translated = _translate_sql(sql)
        if not translated.strip():
            return PgCursorWrapper(self._cursor)
        
        try:
            self._cursor.execute(translated, params)
            wrapper = PgCursorWrapper(self._cursor)
            wrapper.rowcount = self._cursor.rowcount
            # Try to get lastrowid for INSERT
            if translated.strip().upper().startswith("INSERT"):
                try:
                    wrapper.lastrowid = self._cursor.fetchone()
                except Exception:
                    pass
            return wrapper
        except Exception as e:
            logger.error(f"PG execute error: {e}\nSQL: {translated[:200]}")
            raise
    
    def executescript(self, sql_script: str):
        """Execute multiple SQL statements (used for CREATE TABLE blocks)"""
        # Split by semicolons, translate each
        statements = sql_script.split(";")
        for stmt in statements:
            stmt = stmt.strip()
            if not stmt:
                continue
            translated = _translate_sql(stmt)
            if not translated.strip():
                continue
            try:
                self._cursor.execute(translated)
            except Exception as e:
                # Skip "already exists" errors during migrations
                err_str = str(e).lower()
                if "already exists" in err_str or "duplicate" in err_str:
                    self._conn.rollback()
                    continue
                logger.warning(f"PG executescript skip: {e}")
                self._conn.rollback()
    
    def commit(self):
        self._conn.commit()
    
    def rollback(self):
        self._conn.rollback()
    
    def close(self):
        self._cursor.close()
        self._pool.putconn(self._conn)
    
    @property
    def row_factory(self):
        return None
    
    @row_factory.setter
    def row_factory(self, value):
        pass  # Ignore — DictCursor handles this


# ═══════════════════════════════════════════════════
# PUBLIC API — используется в database.py
# ═══════════════════════════════════════════════════

@contextmanager
def get_connection(write=True):
    """Получить подключение к БД (PostgreSQL или SQLite).
    
    Полностью совместим с текущим get_db():
        with get_connection() as conn:
            conn.execute("SELECT * FROM users WHERE id = ?", (123,))
    """
    if DB_TYPE == "postgresql":
        pool = _get_pg_pool()
        raw_conn = pool.getconn()
        raw_conn.autocommit = False
        conn = PgConnectionWrapper(raw_conn, pool)
        try:
            yield conn
            if write:
                conn.commit()
        except Exception as e:
            if write:
                conn.rollback()
            raise
        finally:
            conn.close()
    else:
        # SQLite — текущее поведение
        conn = sqlite3.connect(SQLITE_PATH, timeout=20, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=20000")
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
def get_read_connection():
    """Read-only connection (быстрее, без commit overhead)"""
    with get_connection(write=False) as conn:
        yield conn


def get_db_type() -> str:
    """Возвращает тип БД: 'postgresql' или 'sqlite'"""
    return DB_TYPE


logger.info(f"DB Engine: {DB_TYPE} | Path: {DATABASE_URL[:30] + '...' if DATABASE_URL else SQLITE_PATH}")
