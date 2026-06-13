"""Сигналінг для групового голосового чату слухачів (mesh WebRTC)."""
from __future__ import annotations

import json

from flask import Blueprint, g, jsonify, request

from ..config import MESSENGER_ICE_SERVERS
from ..database import get_connection
from .helpers import api_error, auth_required

call_bp = Blueprint('calls', __name__, url_prefix='/api/calls')

_ROOM_SLUG = 'lounge'


def _room_id(conn) -> int:
    row = conn.execute('SELECT id FROM rooms WHERE slug = %s', (_ROOM_SLUG,)).fetchone()
    return row['id']


def _active_call(conn, room_id: int):
    return conn.execute(
        "SELECT id, caller_id, created_at FROM calls "
        "WHERE room_id = %s AND status = 'active' ORDER BY id DESC LIMIT 1",
        (room_id,),
    ).fetchone()


def _members(conn, call_id: int) -> list[dict]:
    rows = conn.execute(
        """
        SELECT cm.user_id, cm.state, cm.joined_at, u.nickname, u.color
        FROM call_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.call_id = %s AND cm.state = 'joined'
        ORDER BY cm.joined_at ASC
        """,
        (call_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def _end_call_if_empty(conn, call_id: int) -> None:
    row = conn.execute(
        "SELECT COUNT(*) AS cnt FROM call_members WHERE call_id = %s AND state = 'joined'",
        (call_id,),
    ).fetchone()
    if int(row['cnt'] or 0) == 0:
        conn.execute(
            "UPDATE calls SET status='ended', ended_at=datetime('now') WHERE id=%s",
            (call_id,),
        )


@call_bp.get('/config')
@auth_required
def call_config():
    return jsonify({'ok': True, 'data': {'ice_servers': MESSENGER_ICE_SERVERS}})


@call_bp.get('/active')
@auth_required
def active_call():
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        room_id = _room_id(conn)
        call = _active_call(conn, room_id)
        if not call:
            return jsonify({'ok': True, 'data': None})
        members = _members(conn, call['id'])
        my_state = conn.execute(
            "SELECT state FROM call_members WHERE call_id=%s AND user_id=%s",
            (call['id'], me_id),
        ).fetchone()
    return jsonify({'ok': True, 'data': {
        'call_id': call['id'],
        'created_at': call['created_at'],
        'members': members,
        'joined': bool(my_state and my_state['state'] == 'joined'),
    }})


@call_bp.post('/join')
@auth_required
def join_call():
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        room_id = _room_id(conn)
        call = _active_call(conn, room_id)
        if not call:
            conn.execute(
                "INSERT INTO calls (room_id, caller_id, status, started_at) "
                "VALUES (%s, %s, 'active', datetime('now'))",
                (room_id, me_id),
            )
            call_id = int(conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id'])
        else:
            call_id = int(call['id'])

        existing = conn.execute(
            "SELECT id FROM call_members WHERE call_id=%s AND user_id=%s",
            (call_id, me_id),
        ).fetchone()
        if existing:
            conn.execute(
                "UPDATE call_members SET state='joined', joined_at=datetime('now'), "
                "left_at=NULL, updated_at=datetime('now') WHERE call_id=%s AND user_id=%s",
                (call_id, me_id),
            )
        else:
            conn.execute(
                "INSERT INTO call_members (call_id, user_id, state, joined_at, updated_at) "
                "VALUES (%s, %s, 'joined', datetime('now'), datetime('now'))",
                (call_id, me_id),
            )

        members = [m for m in _members(conn, call_id) if int(m['user_id']) != me_id]
    return jsonify({'ok': True, 'data': {'call_id': call_id, 'members': members}})


@call_bp.put('/<int:call_id>/leave')
@auth_required
def leave_call(call_id: int):
    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        conn.execute(
            "UPDATE call_members SET state='left', left_at=datetime('now'), updated_at=datetime('now') "
            "WHERE call_id=%s AND user_id=%s",
            (call_id, me_id),
        )
        _end_call_if_empty(conn, call_id)
    return jsonify({'ok': True})


@call_bp.get('/<int:call_id>/members')
@auth_required
def call_members(call_id: int):
    with get_connection() as conn:
        out = _members(conn, call_id)
    return jsonify({'ok': True, 'data': out})


@call_bp.post('/<int:call_id>/signals')
@auth_required
def send_signal(call_id: int):
    me_id = int(g.current_user['id'])
    data = request.get_json(force=True) or {}
    signal_type = str(data.get('signal_type') or '').strip().lower()
    payload = data.get('payload')

    if signal_type not in ('offer', 'answer', 'ice', 'bye'):
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
            "INSERT INTO call_signals (call_id, from_user_id, to_user_id, signal_type, payload) "
            "VALUES (%s, %s, %s, %s, %s)",
            (call_id, me_id, to_user_id, signal_type, payload),
        )
    return jsonify({'ok': True})


@call_bp.get('/<int:call_id>/signals')
@auth_required
def get_signals(call_id: int):
    me_id = int(g.current_user['id'])
    after_id = max(0, int(request.args.get('after_id', 0) or 0))

    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT id, from_user_id, signal_type, payload, created_at
            FROM call_signals
            WHERE call_id = %s AND id > %s AND to_user_id = %s
            ORDER BY id ASC
            LIMIT 100
            """,
            (call_id, after_id, me_id),
        ).fetchall()
    return jsonify({'ok': True, 'data': [dict(r) for r in rows]})
