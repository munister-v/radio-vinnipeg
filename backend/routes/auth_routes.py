"""Авторизація слухачів: реєстрація/логін за ніком + паролем."""
from __future__ import annotations

import random
import re

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from ..utils.security import (
    generate_token,
    hash_password,
    token_expiration_iso,
    verify_password,
)
from .helpers import api_error, auth_required, rate_limit, _client_ip

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

_NICK_RE = re.compile(r'^[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9_\- ]{2,24}$')

# Палітра кольорів для бейджів ніків (узгоджена з темою сайту).
_COLORS = ['#34d399', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c']


def _serialize_user(row: dict) -> dict:
    return {'id': row['id'], 'nickname': row['nickname'], 'color': row['color']}


@auth_bp.post('/join')
@rate_limit(20, 60, key_func=lambda: f'auth:join:{_client_ip()}')
def join():
    """Реєстрація нового ніка АБО логін існуючого (якщо пароль збігається)."""
    data = request.get_json(force=True) or {}
    nickname = (data.get('nickname') or '').strip()
    password = (data.get('password') or '').strip()

    if not _NICK_RE.match(nickname):
        return api_error('Нік: 2-24 символи (літери, цифри, пробіл, _ або -).')
    if len(password) < 4:
        return api_error('Пароль має містити щонайменше 4 символи.')

    with get_connection() as conn:
        existing = conn.execute(
            'SELECT id, nickname, color, password_hash FROM users WHERE LOWER(nickname) = LOWER(%s)',
            (nickname,),
        ).fetchone()

        if existing:
            if not verify_password(password, existing['password_hash']):
                return api_error('Цей нік уже зайнятий і пароль не співпадає.', 401)
            user = existing
        else:
            color = random.choice(_COLORS)
            conn.execute(
                'INSERT INTO users (nickname, password_hash, color) VALUES (%s, %s, %s)',
                (nickname, hash_password(password), color),
            )
            user_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
            user = {'id': user_id, 'nickname': nickname, 'color': color}

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


@auth_bp.post('/logout')
@auth_required
def logout():
    with get_connection() as conn:
        conn.execute('DELETE FROM sessions WHERE token = %s', (g.current_token,))
    return jsonify({'ok': True})
