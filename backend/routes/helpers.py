"""Допоміжні функції для маршрутів Flask. Спрощено з Army Bank."""
from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from functools import wraps
from flask import jsonify, request, g, current_app

from ..database import get_connection
from ..config import AUTH_RATE_LIMIT_ENABLED, ENABLE_RATE_LIMIT_IN_TESTS

_RATE_LOCK = threading.Lock()
_RATE_BUCKETS: dict[str, deque[float]] = defaultdict(deque)


def api_error(message: str, status: int = 400):
    return jsonify({'ok': False, 'error': message}), status


def auth_required(func):
    @wraps(func)
    def wrapper(*args, **kwargs):
        header = request.headers.get('Authorization', '')
        if not header.startswith('Bearer '):
            return api_error('Потрібна авторизація.', 401)
        token = header.replace('Bearer ', '', 1).strip()

        with get_connection() as conn:
            row = conn.execute(
                """
                SELECT u.id, u.nickname, u.color, s.expires_at
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token = %s
                """,
                (token,),
            ).fetchone()
            if not row:
                return api_error('Недійсна або прострочена сесія.', 401)
            if row['expires_at'] < _now_iso():
                conn.execute('DELETE FROM sessions WHERE token = %s', (token,))
                return api_error('Недійсна або прострочена сесія.', 401)

            conn.execute(
                "UPDATE users SET last_seen_at = datetime('now') WHERE id = %s",
                (row['id'],),
            )

        g.current_user = row
        g.current_token = token
        return func(*args, **kwargs)
    return wrapper


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _client_ip() -> str:
    xff = (request.headers.get('X-Forwarded-For') or '').strip()
    if xff:
        return xff.split(',')[0].strip()[:80]
    return (request.remote_addr or 'unknown')[:80]


def rate_limit(limit: int, window_seconds: int, key_func=None):
    """In-memory rate limiter (sliding window log), як у Army Bank."""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            if (
                (current_app.testing and not ENABLE_RATE_LIMIT_IN_TESTS)
                or not AUTH_RATE_LIMIT_ENABLED
                or limit <= 0
                or window_seconds <= 0
            ):
                return func(*args, **kwargs)

            key = key_func() if key_func else f'{_client_ip()}:{request.path}'
            now = time.time()
            cutoff = now - window_seconds

            with _RATE_LOCK:
                bucket = _RATE_BUCKETS[key]
                while bucket and bucket[0] <= cutoff:
                    bucket.popleft()

                if len(bucket) >= limit:
                    retry_after = max(1, int(window_seconds - (now - bucket[0])))
                    resp = jsonify({'ok': False, 'error': 'Забагато запитів. Спробуйте трохи пізніше.'})
                    resp.status_code = 429
                    resp.headers['Retry-After'] = str(retry_after)
                    return resp

                bucket.append(now)

            return func(*args, **kwargs)
        return wrapper
    return decorator
