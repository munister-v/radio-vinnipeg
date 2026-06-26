"""Кімнати ефіру + синхронний YouTube («спільний діджей»).

Кімнати: список / створення. Чат, голос і сигналінг прив'язуються до
кімнати через ?room=<slug> (див. chat_routes / call_routes).

YouTube-синк: сервер тримає «що грає зараз» для кімнати; клієнти через
IFrame API підлаштовують позицію, тож усі чують одне й те саме приблизно
синхронно. Сервер аудіо не обробляє — кожен клієнт грає YouTube сам.
"""
from __future__ import annotations

import re
import secrets
import time

from flask import Blueprint, g, jsonify, request

from ..database import get_connection
from .helpers import api_error, auth_optional, auth_required, rate_limit, _client_ip

room_bp = Blueprint('rooms', __name__, url_prefix='/api/rooms')


# ── Утиліти ──────────────────────────────────────────────────────────────────

def _slugify(title: str) -> str:
    s = re.sub(r'[^a-z0-9]+', '-', title.lower().strip()).strip('-')
    return s[:40] or ('room-' + secrets.token_hex(3))


_YT_RE = re.compile(r'(?:v=|youtu\.be/|youtube\.com/embed/|/shorts/)([A-Za-z0-9_-]{11})')


def extract_video_id(raw: str) -> str | None:
    """Приймає або готовий 11-символьний id, або YouTube-URL."""
    raw = (raw or '').strip()
    if not raw:
        return None
    if re.fullmatch(r'[A-Za-z0-9_-]{11}', raw):
        return raw
    m = _YT_RE.search(raw)
    return m.group(1) if m else None


def _room_by_slug(conn, slug: str):
    return conn.execute('SELECT id, slug, title FROM rooms WHERE slug = %s', (slug,)).fetchone()


def _now_playing_payload(conn, room_id: int) -> dict | None:
    row = conn.execute(
        'SELECT video_id, title, position_sec, is_playing, started_at, updated_at '
        'FROM room_now_playing WHERE room_id = %s',
        (room_id,),
    ).fetchone()
    if not row or not row['video_id']:
        return None
    now = time.time()
    pos = float(row['position_sec'] or 0)
    if row['is_playing'] and row['started_at']:
        pos += max(0.0, now - float(row['started_at']))
    return {
        'video_id': row['video_id'],
        'title': row['title'] or '',
        'is_playing': bool(row['is_playing']),
        'position_sec': round(pos, 2),
        'server_time': round(now, 2),
        'updated_at': row['updated_at'],
    }


# ── Кімнати ──────────────────────────────────────────────────────────────────

@room_bp.get('')
@auth_optional
def list_rooms():
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT r.id, r.slug, r.title,
                   (SELECT COUNT(*) FROM call_members cm
                      JOIN calls c ON c.id = cm.call_id
                     WHERE c.room_id = r.id AND c.status = 'active' AND cm.state = 'joined'
                   ) AS in_call
            FROM rooms r
            ORDER BY r.id ASC
            """,
        ).fetchall()
        data = []
        for r in rows:
            np = _now_playing_payload(conn, r['id'])
            data.append({
                'slug': r['slug'],
                'title': r['title'],
                'in_call': int(r['in_call'] or 0),
                'now_playing': ({'video_id': np['video_id'], 'title': np['title'], 'is_playing': np['is_playing']}
                                if np else None),
            })
    return jsonify({'ok': True, 'data': data})


@room_bp.post('')
@auth_required
@rate_limit(10, 3600, key_func=lambda: f'rooms:create:{_client_ip()}')
def create_room():
    data = request.get_json(force=True) or {}
    title = (data.get('title') or '').strip()
    if not title:
        return api_error('Вкажіть назву кімнати.')
    if len(title) > 60:
        return api_error('Назва занадто довга (макс. 60 символів).')

    with get_connection() as conn:
        base = _slugify(title)
        slug = base
        n = 2
        while conn.execute('SELECT 1 FROM rooms WHERE slug = %s', (slug,)).fetchone():
            slug = f'{base}-{n}'
            n += 1
        conn.execute('INSERT INTO rooms (slug, title) VALUES (%s, %s)', (slug, title))
    return jsonify({'ok': True, 'data': {'slug': slug, 'title': title, 'in_call': 0, 'now_playing': None}})


# ── YouTube now-playing ──────────────────────────────────────────────────────

@room_bp.get('/<slug>/now-playing')
@auth_optional
def get_now_playing(slug: str):
    with get_connection() as conn:
        room = _room_by_slug(conn, slug)
        if not room:
            return api_error('Кімнату не знайдено.', 404)
        np = _now_playing_payload(conn, room['id'])
    return jsonify({'ok': True, 'data': np})


@room_bp.put('/<slug>/now-playing')
@auth_required
@rate_limit(60, 60, key_func=lambda: f'rooms:np:{_client_ip()}')
def set_now_playing(slug: str):
    data = request.get_json(force=True) or {}
    me_id = int(g.current_user['id'])

    raw_video = data.get('video_id')
    # Порожнє/None → зупинити трансляцію (очистити).
    clearing = raw_video is None or str(raw_video).strip() == ''
    video_id = None if clearing else extract_video_id(str(raw_video))
    if not clearing and not video_id:
        return api_error('Невірне YouTube-посилання або ID.')

    title = (str(data.get('title') or '')).strip()[:200]
    try:
        position_sec = max(0.0, float(data.get('position_sec') or 0))
    except (TypeError, ValueError):
        position_sec = 0.0
    is_playing = 0 if clearing else (1 if data.get('is_playing', True) else 0)

    with get_connection() as conn:
        room = _room_by_slug(conn, slug)
        if not room:
            return api_error('Кімнату не знайдено.', 404)
        conn.execute(
            """
            INSERT INTO room_now_playing
                (room_id, video_id, title, position_sec, is_playing, started_at, updated_by, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, datetime('now'))
            ON CONFLICT(room_id) DO UPDATE SET
                video_id=excluded.video_id, title=excluded.title,
                position_sec=excluded.position_sec, is_playing=excluded.is_playing,
                started_at=excluded.started_at, updated_by=excluded.updated_by,
                updated_at=datetime('now')
            """,
            (room['id'], video_id, title, position_sec, is_playing, time.time(), me_id),
        )
        np = _now_playing_payload(conn, room['id'])
    return jsonify({'ok': True, 'data': np})
