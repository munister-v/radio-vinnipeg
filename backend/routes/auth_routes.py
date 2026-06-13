"""Авторизація слухачів.

Радіо повністю відкрите: щоб слухати ефір і читати чат — нічого не треба.
Щоб писати в чат або вести ефір — досить гостьового профілю (лише нік, без
пароля). Кожен браузер створює власний гостьовий профіль і зберігає токен
локально; нік можна змінити будь-коли.
"""
from __future__ import annotations

import random
import re

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from ..utils.security import generate_token, token_expiration_iso
from .helpers import api_error, auth_required, rate_limit, _client_ip

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

_NICK_RE = re.compile(r'^[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9_\- ]{2,24}$')

# Палітра кольорів для бейджів ніків (узгоджена з темою сайту).
_COLORS = ['#e8836a', '#f3c83e', '#7c8a6e', '#60a5fa', '#f472b6', '#a78bfa', '#22d3ee']

# Запасні «імена» для гостей, якщо нік не вказано.
_GUEST_PREFIX = 'Слухач'


def _serialize_user(row: dict) -> dict:
    return {'id': row['id'], 'nickname': row['nickname'], 'color': row['color']}


def _create_guest(conn, nickname: str | None) -> dict:
    nickname = (nickname or '').strip()
    if not nickname:
        nickname = f'{_GUEST_PREFIX}-{random.randint(1000, 9999)}'
    color = random.choice(_COLORS)
    conn.execute(
        'INSERT INTO users (nickname, password_hash, color, is_guest) '
        'VALUES (%s, NULL, %s, 1)',
        (nickname, color),
    )
    user_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
    return {'id': user_id, 'nickname': nickname, 'color': color}


@auth_bp.post('/guest')
@rate_limit(40, 60, key_func=lambda: f'auth:guest:{_client_ip()}')
def guest():
    """Створює гостьовий профіль (без пароля) і видає токен."""
    data = request.get_json(silent=True) or {}
    nickname = (data.get('nickname') or '').strip()
    if nickname and not _NICK_RE.match(nickname):
        return api_error('Нік: 2-24 символи (літери, цифри, пробіл, _ або -).')

    with get_connection() as conn:
        user = _create_guest(conn, nickname)
        token = generate_token()
        conn.execute(
            'INSERT INTO sessions (token, user_id, expires_at) VALUES (%s, %s, %s)',
            (token, user['id'], token_expiration_iso()),
        )
        conn.execute(
            "UPDATE users SET last_seen_at = datetime('now') WHERE id = %s",
            (user['id'],),
        )

    return jsonify({'ok': True, 'data': {'token': token, 'user': _serialize_user(user)}})


@auth_bp.get('/me')
@auth_required
def me():
    return jsonify({'ok': True, 'data': _serialize_user(g.current_user)})


@auth_bp.put('/me')
@auth_required
@rate_limit(20, 60, key_func=lambda: f'auth:rename:{_client_ip()}')
def rename():
    """Змінює нік поточного гостя."""
    data = request.get_json(silent=True) or {}
    nickname = (data.get('nickname') or '').strip()
    if not _NICK_RE.match(nickname):
        return api_error('Нік: 2-24 символи (літери, цифри, пробіл, _ або -).')

    me_id = int(g.current_user['id'])
    with get_connection() as conn:
        conn.execute('UPDATE users SET nickname = %s WHERE id = %s', (nickname, me_id))
        row = conn.execute(
            'SELECT id, nickname, color FROM users WHERE id = %s', (me_id,)
        ).fetchone()
    return jsonify({'ok': True, 'data': _serialize_user(row)})


@auth_bp.post('/logout')
@auth_required
def logout():
    with get_connection() as conn:
        conn.execute('DELETE FROM sessions WHERE token = %s', (g.current_token,))
    return jsonify({'ok': True})
