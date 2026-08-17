"""Модуль роботи з БД (SQLite)."""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from typing import Iterator

from .config import DATABASE_PATH, SCHEMA_PATH, STATION_NAME


DEFAULT_ROOMS = (
    ('lounge', f'{STATION_NAME} · Lounge'),
    ('music', f'{STATION_NAME} · Music'),
    ('talk', f'{STATION_NAME} · Talk'),
    ('night-line', f'{STATION_NAME} · Night Line'),
    ('requests', f'{STATION_NAME} · Requests'),
    ('after-hours', f'{STATION_NAME} · After Hours'),
)


def dict_factory(cursor: sqlite3.Cursor, row: tuple) -> dict:
    """Повертає рядок SQLite у вигляді словника."""
    return {col[0]: row[idx] for idx, col in enumerate(cursor.description)}


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    """Підключення до SQLite. Параметри запитів передаються через %s
    (стиль psycopg2) для сумісності з кодом, перенесеним з Army Bank,
    тож тут конвертуємо %s -> ? перед виконанням."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = dict_factory
    conn.execute('PRAGMA foreign_keys = ON;')
    wrapped = _ConnWrapper(conn)
    try:
        yield wrapped
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


class _ConnWrapper:
    """Тонка обгортка над sqlite3.Connection: підтримує плейсхолдери %s."""

    def __init__(self, conn: sqlite3.Connection) -> None:
        self._conn = conn

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        return self._conn.execute(sql.replace('%s', '?'), params)


def run_migrations() -> None:
    """Безпечно додає нові колонки/таблиці до існуючої БД."""
    with get_connection() as conn:
        # Re-run schema to pick up new CREATE TABLE IF NOT EXISTS statements
        schema_sql = SCHEMA_PATH.read_text(encoding='utf-8')
        conn._conn.executescript(schema_sql)

        cols = {r['name'] for r in conn.execute('PRAGMA table_info(messages)').fetchall()}
        if 'reply_to_id' not in cols:
            conn.execute('ALTER TABLE messages ADD COLUMN reply_to_id INTEGER REFERENCES messages(id)')
        if 'edited_at' not in cols:
            conn.execute('ALTER TABLE messages ADD COLUMN edited_at TEXT')

        ucols = {r['name'] for r in conn.execute('PRAGMA table_info(users)').fetchall()}
        if 'city' not in ucols:
            conn.execute("ALTER TABLE users ADD COLUMN city TEXT DEFAULT ''")

        conn.execute("UPDATE rooms SET title = REPLACE(title, 'Vinnipeg', 'Winnipeg')")
        _seed_rooms(conn)


def _seed_rooms(conn) -> None:
    for slug, title in DEFAULT_ROOMS:
        conn.execute(
            'INSERT OR IGNORE INTO rooms (slug, title) VALUES (%s, %s)',
            (slug, title),
        )


def init_db() -> None:
    """Створює таблиці (якщо не існують) та базову кімнату чату."""
    with get_connection() as conn:
        schema_sql = SCHEMA_PATH.read_text(encoding='utf-8')
        conn._conn.executescript(schema_sql)
        _seed_rooms(conn)
