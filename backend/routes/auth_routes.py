"""Авторизація слухачів.

Радіо повністю відкрите: щоб слухати ефір і читати чат — нічого не треба.
Щоб писати в чат або вести ефір — досить гостьового профілю (лише нік, без
пароля). Кожен браузер створює власний гостьовий профіль і зберігає токен
локально; нік можна змінити будь-коли.
"""
from __future__ import annotations

import json
import random
import re
import urllib.error
import urllib.request

from flask import Blueprint, jsonify, request, g

from ..database import get_connection
from ..utils.security import generate_token, token_expiration_iso
from .helpers import api_error, auth_required, rate_limit, _client_ip

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')

_NICK_RE = re.compile(r'^[A-Za-zА-Яа-яЁёІіЇїЄєҐґ0-9_\- ]{2,24}$')

_COLORS = ['#e8836a', '#f3c83e', '#7c8a6e', '#60a5fa', '#f472b6', '#a78bfa', '#22d3ee']

_GUEST_PREFIX = 'Listener'

# IP → city cache (in-memory, per process)
_geo_cache: dict[str, str] = {}

_PRIVATE_PREFIXES = ('10.', '172.', '192.168.', 'fc', 'fd')


def _get_city(ip: str) -> str:
    """Повертає місто за IP через ip-api.com (кешує результат)."""
    if not ip or ip in ('127.0.0.1', '::1', 'unknown'):
        return ''
    if any(ip.startswith(p) for p in _PRIVATE_PREFIXES):
        return ''
    if ip in _geo_cache:
        return _geo_cache[ip]
    try:
        url = f'http://ip-api.com/json/{ip}?fields=status,city'
        req = urllib.request.Request(url, headers={'User-Agent': 'RadioVinnipeg/1.0'})
        with urllib.request.urlopen(req, timeout=2) as resp:
            data = json.loads(resp.read())
        city = data.get('city', '') if data.get('status') == 'success' else ''
    except Exception:
        city = ''
    _geo_cache[ip] = city
    return city


def _serialize_user(row: dict) -> dict:
    return {
        'id': row['id'],
        'nickname': row['nickname'],
        'color': row['color'],
        'city': row.get('city', '') or '',
    }


def _create_guest(conn, nickname: str | None, city: str = '') -> dict:
    nickname = (nickname or '').strip()
    if not nickname:
        nickname = f'{_GUEST_PREFIX}-{random.randint(1000, 9999)}'
    color = random.choice(_COLORS)
    conn.execute(
        'INSERT INTO users (nickname, password_hash, color, is_guest, city) '
        'VALUES (%s, NULL, %s, 1, %s)',
        (nickname, color, city),
    )
    user_id = conn.execute('SELECT last_insert_rowid() AS id').fetchone()['id']
    return {'id': user_id, 'nickname': nickname, 'color': color, 'city': city}


@auth_bp.post('/guest')
@rate_limit(40, 60, key_func=lambda: f'auth:guest:{_client_ip()}')
def guest():
    """Створює гостьовий профіль (без пароля) і видає токен."""
    data = request.get_json(silent=True) or {}
    nickname = (data.get('nickname') or '').strip()
    if nickname and not _NICK_RE.match(nickname):
        return api_error('Нік: 2-24 символи (літери, цифри, пробіл, _ або -).')

    ip = _client_ip()
    city = _get_city(ip)

    with get_connection() as conn:
        user = _create_guest(conn, nickname, city)
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
