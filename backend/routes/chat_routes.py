"""Чат для слухачів Radio Vinnipeg Nights — спільна кімната 'lounge'."""
from __future__ import annotations

import time

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from ..services.messenger_crypto import (
    decrypt_message,
    deleted_message_text,
    encrypt_message,
)
from .helpers import api_error, auth_optional, auth_required, rate_limit, _client_ip

chat_bp = Blueprint('chat', __name__, url_prefix='/api/chat')

_ROOM_SLUG = 'lounge'

# In-memory typing state: user_id -> {nickname, color, at}
_typing_state: dict[int, dict] = {}


# ── DB helpers ───────────────────────────────────────────────────────────────

def _room_id(conn) -> int:
    row = conn.execute('SELECT id FROM rooms WHERE slug = %s', (_ROOM_SLUG,)).fetchone()
    return row['id']


def _get_reactions(conn, message_ids: list[int], me_id: int | None) -> dict[int, list]:
    if not message_ids:
        return {}
    ph = ', '.join(['%s'] * len(message_ids))
    rows = conn.execute(
        f"""
        SELECT message_id, emoji, COUNT(*) AS cnt,
               SUM(CASE WHEN user_id = %s THEN 1 ELSE 0 END) AS reacted
        FROM message_reactions
        WHERE message_id IN ({ph})
        GROUP BY message_id, emoji
        ORDER BY cnt DESC, MIN(created_at) ASC
        """,
        (me_id or 0, *message_ids),
    ).fetchall()
    result: dict[int, list] = {}
    for r in rows:
        mid = r['message_id']
        if mid not in result:
            result[mid] = []
        result[mid].append({'emoji': r['emoji'], 'count': r['cnt'], 'reacted': bool(r['reacted'])})
    return result


def _get_reply_previews(conn, reply_ids: list[int]) -> dict[int, dict]:
    if not reply_ids:
        return {}
    ph = ', '.join(['%s'] * len(reply_ids))
    rows = conn.execute(
        f"""
        SELECT m.id, m.text, m.is_deleted, u.nickname, u.color, u.city
        FROM messages m JOIN users u ON u.id = m.user_id
        WHERE m.id IN ({ph})
        """,
        tuple(reply_ids),
    ).fetchall()
    result: dict[int, dict] = {}
    for r in rows:
        text = deleted_message_text() if r['is_deleted'] else decrypt_message(r['text'], fallback='')
        result[r['id']] = {
            'id': r['id'],
            'nickname': r['nickname'],
            'color': r['color'],
            'text': text[:160],
        }
    return result


def _serialize_messages(rows: list[dict], me_id: int | None, conn) -> list[dict]:
    msg_ids = [r['id'] for r in rows]
    reactions = _get_reactions(conn, msg_ids, me_id)
    reply_ids = list({r['reply_to_id'] for r in rows if r.get('reply_to_id')})
    reply_previews = _get_reply_previews(conn, reply_ids)
    result = []
    for r in rows:
        text = deleted_message_text() if r['is_deleted'] else decrypt_message(r['text'], fallback='')
        reply_to = reply_previews.get(r.get('reply_to_id')) if r.get('reply_to_id') else None
        result.append({
            'id': r['id'],
            'user_id': r['user_id'],
            'nickname': r['nickname'],
            'color': r['color'],
            'city': r.get('city', '') or '',
            'text': text,
            'is_deleted': bool(r['is_deleted']),
            'created_at': r['created_at'],
            'reply_to_id': r.get('reply_to_id'),
            'reply_to': reply_to,
            'edited_at': r.get('edited_at'),
            'reactions': reactions.get(r['id'], []),
        })
    return result


# ── Endpoints ────────────────────────────────────────────────────────────────

@chat_bp.get('/messages')
@auth_optional
def get_messages():
    limit = request.args.get('limit', default=50, type=int) or 50
    limit = max(1, min(limit, 100))
    me = g.current_user
    me_id = int(me['id']) if me else None

    with get_connection() as conn:
        room_id = _room_id(conn)
        rows = conn.execute(
            """
            SELECT m.id, m.user_id, m.text, m.is_deleted, m.created_at,
                   m.reply_to_id, m.edited_at, u.nickname, u.color, u.city
            FROM messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.room_id = %s
            ORDER BY m.id DESC
            LIMIT %s
            """,
            (room_id, limit),
        ).fetchall()
        msgs = _serialize_messages(list(reversed(rows)), me_id, conn)

    return jsonify({'ok': True, 'data': msgs})


@chat_bp.get('/poll')
@auth_optional
def poll():
    after_id = request.args.get('after_id', default=0, type=int) or 0
    me = g.current_user
    me_id = int(me['id']) if me else None

    with get_connection() as conn:
        room_id = _room_id(conn)
        rows = conn.execute(
            """
            SELECT m.id, m.user_id, m.text, m.is_deleted, m.created_at,
                   m.reply_to_id, m.edited_at, u.nickname, u.color, u.city
            FROM messages m
            JOIN users u ON u.id = m.user_id
            WHERE m.room_id = %s AND m.id > %s
            ORDER BY m.id ASC
            LIMIT 50
            """,
            (room_id, after_id),
        ).fetchall()
        msgs = _serialize_messages(list(rows), me_id, conn)

        # Typing state (TTL 5s, exclude self)
        now = time.time()
        typing = [
            {'nickname': v['nickname'], 'color': v['color']}
            for uid, v in list(_typing_state.items())
            if now - v['at'] < 5 and uid != me_id
        ]

        # Reaction updates for messages in the last 2 hours
        reaction_rows = conn.execute(
            """
            SELECT mr.message_id, mr.emoji, COUNT(*) AS cnt,
                   SUM(CASE WHEN mr.user_id = %s THEN 1 ELSE 0 END) AS reacted
            FROM message_reactions mr
            JOIN messages m ON m.id = mr.message_id
            WHERE m.room_id = %s AND m.created_at >= datetime('now', '-2 hours')
            GROUP BY mr.message_id, mr.emoji
            ORDER BY cnt DESC
            """,
            (me_id or 0, room_id),
        ).fetchall()

    reaction_map: dict[int, list] = {}
    for r in reaction_rows:
        mid = r['message_id']
        if mid not in reaction_map:
            reaction_map[mid] = []
        reaction_map[mid].append({'emoji': r['emoji'], 'count': r['cnt'], 'reacted': bool(r['reacted'])})
    reaction_updates = [{'message_id': k, 'reactions': v} for k, v in reaction_map.items()]

    return jsonify({'ok': True, 'data': {
        'messages': msgs,
        'typing': typing,
        'reaction_updates': reaction_updates,
    }})


@chat_bp.post('/typing')
@auth_required
@rate_limit(20, 10, key_func=lambda: f'chat:typing:{_client_ip()}')
def set_typing():
    me = g.current_user
    _typing_state[int(me['id'])] = {
        'nickname': me['nickname'],
        'color': me['color'],
        'at': time.time(),
    }
    return jsonify({'ok': True})


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

    reply_to_id = data.get('reply_to_id')
    if reply_to_id is not None:
        try:
            reply_to_id = int(reply_to_id)
        except (TypeError, ValueError):
            reply_to_id = None

    me = g.current_user
    me_id = int(me['id'])
    encrypted = encrypt_message(text)

    with get_connection() as conn:
        room_id = _room_id(conn)

        # Validate reply_to_id belongs to this room
        if reply_to_id is not None:
            ref = conn.execute(
                'SELECT id FROM messages WHERE id = %s AND room_id = %s', (reply_to_id, room_id)
            ).fetchone()
            if not ref:
                reply_to_id = None

        conn.execute(
            'INSERT INTO messages (room_id, user_id, text, reply_to_id) VALUES (%s, %s, %s, %s)',
            (room_id, me_id, encrypted, reply_to_id),
        )
        msg_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
        row = conn.execute(
            """
            SELECT m.id, m.user_id, m.text, m.is_deleted, m.created_at,
                   m.reply_to_id, m.edited_at, u.nickname, u.color, u.city
            FROM messages m JOIN users u ON u.id = m.user_id
            WHERE m.id = %s
            """,
            (msg_id,),
        ).fetchone()
        serialized = _serialize_messages([row], me_id, conn)

    return jsonify({'ok': True, 'data': serialized[0]})


@chat_bp.put('/messages/<int:msg_id>')
@auth_required
@rate_limit(10, 60, key_func=lambda: f'chat:edit:{_client_ip()}')
def edit_message(msg_id: int):
    me = g.current_user
    data = request.get_json(force=True) or {}
    text = (data.get('text') or '').strip()
    if not text:
        return api_error('Повідомлення порожнє.')
    if len(text) > 1000:
        return api_error('Повідомлення занадто довге.')

    me_id = int(me['id'])
    with get_connection() as conn:
        msg = conn.execute('SELECT id, user_id, is_deleted FROM messages WHERE id = %s', (msg_id,)).fetchone()
        if not msg:
            return api_error('Повідомлення не знайдено.', 404)
        if msg['user_id'] != me_id:
            return api_error('Можна редагувати лише свої повідомлення.', 403)
        if msg['is_deleted']:
            return api_error('Не можна редагувати видалене повідомлення.', 400)

        encrypted = encrypt_message(text)
        conn.execute(
            "UPDATE messages SET text = %s, edited_at = datetime('now') WHERE id = %s",
            (encrypted, msg_id),
        )
        edited_at = conn.execute('SELECT edited_at FROM messages WHERE id = %s', (msg_id,)).fetchone()['edited_at']

    return jsonify({'ok': True, 'data': {'id': msg_id, 'text': text, 'edited_at': edited_at}})


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


@chat_bp.post('/messages/<int:msg_id>/react')
@auth_required
@rate_limit(30, 60, key_func=lambda: f'chat:react:{_client_ip()}')
def react_message(msg_id: int):
    me = g.current_user
    data = request.get_json(force=True) or {}
    emoji = str(data.get('emoji') or '').strip()
    if not emoji or len(emoji) > 12:
        return api_error('Невірний emoji.')

    me_id = int(me['id'])
    with get_connection() as conn:
        existing = conn.execute(
            'SELECT id FROM message_reactions WHERE message_id = %s AND user_id = %s AND emoji = %s',
            (msg_id, me_id, emoji),
        ).fetchone()

        if existing:
            conn.execute(
                'DELETE FROM message_reactions WHERE message_id = %s AND user_id = %s AND emoji = %s',
                (msg_id, me_id, emoji),
            )
        else:
            # Max 20 distinct emoji per message
            count = conn.execute(
                'SELECT COUNT(DISTINCT emoji) AS c FROM message_reactions WHERE message_id = %s',
                (msg_id,),
            ).fetchone()['c']
            if count >= 20:
                return api_error('Забагато різних реакцій на це повідомлення.', 400)
            conn.execute(
                'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (%s, %s, %s)',
                (msg_id, me_id, emoji),
            )

        rows = conn.execute(
            """
            SELECT emoji, COUNT(*) AS cnt,
                   SUM(CASE WHEN user_id = %s THEN 1 ELSE 0 END) AS reacted
            FROM message_reactions WHERE message_id = %s
            GROUP BY emoji ORDER BY cnt DESC
            """,
            (me_id, msg_id),
        ).fetchall()

    reactions = [{'emoji': r['emoji'], 'count': r['cnt'], 'reacted': bool(r['reacted'])} for r in rows]
    return jsonify({'ok': True, 'data': {'message_id': msg_id, 'reactions': reactions}})


@chat_bp.get('/online')
@auth_optional
def online_users():
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT nickname, color, city FROM users
            WHERE last_seen_at IS NOT NULL
              AND last_seen_at >= datetime('now', '-60 seconds')
            ORDER BY nickname ASC
            """,
        ).fetchall()
    return jsonify({'ok': True, 'data': rows})
