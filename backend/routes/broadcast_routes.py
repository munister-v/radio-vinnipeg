"""Живий ефір (трансляція) для Radio Vinnipeg Nights.

Модель «радіо»: у кімнаті може бути ОДИН активний ефір. Ведучий (host)
вмикає мікрофон і вещає; слухачі лише приймають аудіо (WebRTC star:
host -> кожен слухач), мікрофон їм не потрібен. Сигналінг (offer/answer/
ice/bye) ретранслюється через БД-полінг, як і у груповому дзвінку.
"""
from __future__ import annotations

import json

from flask import Blueprint, g, jsonify, request

from ..config import MESSENGER_ICE_SERVERS
from ..database import get_connection
from .helpers import api_error, auth_optional, auth_required

broadcast_bp = Blueprint('broadcasts', __name__, url_prefix='/api/broadcasts')

_ROOM_SLUG = 'lounge'
_SIGNAL_TYPES = ('offer', 'answer', 'ice', 'bye')


def _room_id(conn) -> int:
    row = conn.execute('SELECT id FROM rooms WHERE slug = %s', (_ROOM_SLUG,)).fetchone()
    return row['id']


def _live_broadcast(conn, room_id: int):
    return conn.execute(
        """
        SELECT b.id, b.host_user_id, b.title, b.started_at, u.nickname AS host_nickname,
               u.color AS host_color
        FROM broadcasts b
        JOIN users u ON u.id = b.host_user_id
        WHERE b.room_id = %s AND b.status = 'live'
        ORDER BY b.id DESC LIMIT 1
        """,
        (room_id,),
    ).fetchone()


def _listener_count(conn, broadcast_id: int) -> int:
    row = conn.execute(
        "SELECT COUNT(*) AS cnt FROM broadcast_listeners "
        "WHERE broadcast_id = %s AND state = 'listening'",
        (broadcast_id,),
    ).fetchone()
    return int(row['cnt'] or 0)


def _active_listeners(conn, broadcast_id: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT bl.user_id, bl.joined_at, u.nickname, u.color
        FROM broadcast_listeners bl
        JOIN users u ON u.id = bl.user_id
        WHERE bl.broadcast_id = %s AND bl.state = 'listening'
        ORDER BY bl.joined_at ASC
        """,
        (broadcast_id,),
    ).fetchall()
    return [dict(r) for r in rows]


@broadcast_bp.get('/config')
@auth_optional
def config():
    return jsonify({'ok': True, 'data': {'ice_servers': MESSENGER_ICE_SERVERS}})


@broadcast_bp.get('/live')
@auth_optional
def live():
    """Публічно: інформація про поточний ефір (для банера/плитки ON AIR)."""
    me = getattr(g, 'current_user', None)
    me_id = int(me['id']) if me else None
    with get_connection() as conn:
        room_id = _room_id(conn)
        bc = _live_broadcast(conn, room_id)
        if not bc:
            return jsonify({'ok': True, 'data': None})
        count = _listener_count(conn, bc['id'])
        is_listening = False
        if me_id is not None:
            row = conn.execute(
                "SELECT state FROM broadcast_listeners WHERE broadcast_id = %s AND user_id = %s",
                (bc['id'], me_id),
            ).fetchone()
            is_listening = bool(row and row['state'] == 'listening')
    return jsonify({'ok': True, 'data': {
        'broadcast_id': bc['id'],
        'title': bc['title'] or '',
        'host_user_id': bc['host_user_id'],
        'host_nickname': bc['host_nickname'],
        'host_color': bc['host_color'],
        'started_at': bc['started_at'],
        'listener_count': count,
        'is_host': me_id is not None and int(bc['host_user_id']) == me_id,
        'is_listening': is_listening,
    }})


@broadcast_bp.post('/start')
@auth_required
def start():
    """Починає ефір. Лише один активний ефір у кімнаті."""
    me_id = int(g.current_user['id'])
    data = request.get_json(silent=True) or {}
    title = (data.get('title') or '').strip()[:120]

    with get_connection() as conn:
        room_id = _room_id(conn)
        existing = _live_broadcast(conn, room_id)
        if existing:
            if int(existing['host_user_id']) == me_id:
                # Уже веду ефір — повертаю той самий.
                return jsonify({'ok': True, 'data': {'broadcast_id': existing['id']}})
            return api_error('Зараз уже йде ефір. Дочекайтесь його завершення.', 409)

        conn.execute(
            "INSERT INTO broadcasts (room_id, host_user_id, title, status, started_at) "
            "VALUES (%s, %s, %s, 'live', datetime('now'))",
            (room_id, me_id, title),
        )
        bid = int(conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'])
    return jsonify({'ok': True, 'data': {'broadcast_id': bid}})


@broadcast_bp.put('/<int:broadcast_id>/stop')
@auth_required
def stop(broadcast_id: int):
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        bc = conn.execute(
            "SELECT host_user_id, status FROM broadcasts WHERE id = %s", (broadcast_id,)
        ).fetchone()
        if not bc:
            return api_error('Ефір не знайдено.', 404)
        if int(bc['host_user_id']) != me_id:
            return api_error('Зупинити ефір може лише ведучий.', 403)
        conn.execute(
            "UPDATE broadcasts SET status='ended', ended_at=datetime('now') WHERE id=%s",
            (broadcast_id,),
        )
    return jsonify({'ok': True})


@broadcast_bp.post('/<int:broadcast_id>/listen')
@auth_required
def listen(broadcast_id: int):
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        bc = conn.execute(
            "SELECT host_user_id, status FROM broadcasts WHERE id = %s", (broadcast_id,)
        ).fetchone()
        if not bc or bc['status'] != 'live':
            return api_error('Ефір зараз не активний.', 404)

        existing = conn.execute(
            "SELECT id FROM broadcast_listeners WHERE broadcast_id=%s AND user_id=%s",
            (broadcast_id, me_id),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE broadcast_listeners SET state='listening', joined_at=datetime('now'), "
                "updated_at=datetime('now') WHERE broadcast_id=%s AND user_id=%s",
                (broadcast_id, me_id),
            )
        else:
            conn.execute(
                "INSERT INTO broadcast_listeners (broadcast_id, user_id, state, joined_at, updated_at) "
                "VALUES (%s, %s, 'listening', datetime('now'), datetime('now'))",
                (broadcast_id, me_id),
            )
    return jsonify({'ok': True, 'data': {'host_user_id': int(bc['host_user_id'])}})


@broadcast_bp.put('/<int:broadcast_id>/leave')
@auth_required
def leave(broadcast_id: int):
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        conn.execute(
            "UPDATE broadcast_listeners SET state='left', updated_at=datetime('now') "
            "WHERE broadcast_id=%s AND user_id=%s",
            (broadcast_id, me_id),
        )
    return jsonify({'ok': True})


@broadcast_bp.get('/<int:broadcast_id>/listeners')
@auth_required
def listeners(broadcast_id: int):
    """Ведучий опитує цей ендпоінт, щоб дізнатись про нових слухачів."""
    with get_connection() as conn:
        out = _active_listeners(conn, broadcast_id)
    return jsonify({'ok': True, 'data': out})


@broadcast_bp.post('/<int:broadcast_id>/signals')
@auth_required
def send_signal(broadcast_id: int):
    me_id = int(g.current_user['id'])
    data = request.get_json(force=True) or {}
    signal_type = str(data.get('signal_type') or '').strip().lower()
    payload = data.get('payload')

    if signal_type not in _SIGNAL_TYPES:
        return api_error('signal_type має бути offer|answer|ice|bye', 400)
    try:
        to_user_id = int(data.get('to_user_id'))
    except (TypeError, ValueError):
        return api_error('to_user_id має бути числом.', 400)

    if isinstance(payload, (dict, list)):
        payload = json.dumps(payload, ensure_ascii=False)
    payload = str(payload or '').strip()
    if not payload:
        return api_error('payload обов\'язковий.', 400)
    if len(payload) > 160_000:
        return api_error('payload занадто великий.', 400)

    with get_connection() as conn:
        conn.execute(
            "INSERT INTO broadcast_signals (broadcast_id, from_user_id, to_user_id, signal_type, payload) "
            "VALUES (%s, %s, %s, %s, %s)",
            (broadcast_id, me_id, to_user_id, signal_type, payload),
        )
    return jsonify({'ok': True})


@broadcast_bp.get('/<int:broadcast_id>/signals')
@auth_required
def get_signals(broadcast_id: int):
    me_id = int(g.current_user['id'])
    after_id = max(0, int(request.args.get('after_id', 0) or 0))
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, from_user_id, signal_type, payload, created_at
            FROM broadcast_signals
            WHERE broadcast_id = %s AND id > %s AND to_user_id = %s
            ORDER BY id ASC
            LIMIT 100
            """,
            (broadcast_id, after_id, me_id),
        ).fetchall()
    return jsonify({'ok': True, 'data': [dict(r) for r in rows]})
