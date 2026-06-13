"""Чат для слухачів Radio Vinnipeg Nights — спільна кімната 'lounge'."""
from __future__ import annotations

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from ..services.messenger_crypto import (
    decrypt_message,
    deleted_message_text,
    encrypt_message,
)
from .helpers import api_error, auth_required, rate_limit, _client_ip

chat_bp = Blueprint('chat', __name__, url_prefix='/api/chat')

_ROOM_SLUG = 'lounge'


def _room_id(conn) -> int:
    row = conn.execute('SELECT id FROM rooms WHERE slug = %s', (_ROOM_SLUG,)).fetchone()
    return row['id']


def _serialize_message(row: dict) -> dict:
    text = deleted_message_text() if row['is_deleted'] else decrypt_message(row['text'], fallback='')
    return {
        'id': row['id'],
        'user_id': row['user_id'],
        'nickname': row['nickname'],
        'color': row['color'],
        'text': text,
        'is_deleted': bool(row['is_deleted']),
        'created_at': row['created_at'],
    }


@chat_bp.get('/messages')
@auth_required
def get_messages():
    """Останні повідомлення кімнати (для початкового завантаження)."""
    limit = request.args.get('limit', default=50, type=int) or 50
    limit = max(1, min(limit, 100))

    with get_connection() as conn:
        room_id = _room_id(conn)
        rows = conn.execute(
            """
            SELECT m.id, m.user_id, m.text, m.is_deleted, m.created_at, u.nickname, u.color
            FROM messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.room_id = %s
            ORDER BY m.id DESC
            LIMIT %s
            """,
            (room_id, limit),
        ).fetchall()

    msgs = [_serialize_message(r) for r in rows]
    msgs.reverse()
    return jsonify({'ok': True, 'data': msgs})


@chat_bp.get('/poll')
@auth_required
def poll():
    """Нові повідомлення після заданого id (для лонг-полінгу з фронтенду)."""
    after_id = request.args.get('after_id', default=0, type=int) or 0

    with get_connection() as conn:
        room_id = _room_id(conn)
        rows = conn.execute(
            """
            SELECT m.id, m.user_id, m.text, m.is_deleted, m.created_at, u.nickname, u.color
            FROM messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.room_id = %s AND m.id > %s
            ORDER BY m.id ASC
            LIMIT 50
            """,
            (room_id, after_id),
        ).fetchall()

    return jsonify({'ok': True, 'data': [_serialize_message(r) for r in rows]})


@chat_bp.post('/messages')
@auth_required
@rate_limit(30, 60, key_func=lambda: f'chat:send:{_client_ip()}')
def send_message():
    data = request.get_json(force=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return api_error('Повідомлення порожнє.')
    if len(text) > 1000:
        return api_error('Повідомлення занадто довге (макс. 1000 символів).')

    me = g.current_user
    encrypted = encrypt_message(text)

    with get_connection() as conn:
        room_id = _room_id(conn)
        conn.execute(
            'INSERT INTO messages (room_id, user_id, text) VALUES (%s, %s, %s)',
            (room_id, me['id'], encrypted),
        )
        msg_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
        created_at = conn.execute('SELECT created_at FROM messages WHERE id = %s', (msg_id,)).fetchone()['created_at']

    return jsonify({'ok': True, 'data': {
        'id': msg_id,
        'user_id': me['id'],
        'nickname': me['nickname'],
        'color': me['color'],
        'text': text,
        'is_deleted': False,
        'created_at': created_at,
    }})


@chat_bp.delete('/messages/<int:msg_id>')
@auth_required
def delete_message(msg_id: int):
    me = g.current_user
    with get_connection() as conn:
        msg = conn.execute('SELECT id, user_id FROM messages WHERE id = %s', (msg_id,)).fetchone()
        if not msg:
            return api_error('Повідомлення не знайдено.', 404)
        if msg['user_id'] != me['id']:
            return api_error('Можна видаляти лише свої повідомлення.', 403)
        conn.execute(
            'UPDATE messages SET is_deleted = 1, text = %s WHERE id = %s',
            (encrypt_message(deleted_message_text()), msg_id),
        )
    return jsonify({'ok': True})


@chat_bp.get('/online')
@auth_required
def online_users():
    """Список ніків, активних протягом останніх 60с (простий presence)."""
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT nickname, color FROM users
            WHERE last_seen_at IS NOT NULL
              AND last_seen_at >= datetime('now', '-60 seconds')
            ORDER BY nickname ASC
            """,
        ).fetchall()
    return jsonify({'ok': True, 'data': rows})
