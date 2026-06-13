"""Допоміжні функції безпеки: хешування паролів (bcrypt), токени, час сесій.
Перенесено та спрощено з Army Bank."""
from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

try:
    import bcrypt
    _USE_BCRYPT = True
except ImportError:
    import hashlib
    _USE_BCRYPT = False

from ..config import SECRET_KEY, TOKEN_TTL_HOURS


def hash_password(password: str) -> str:
    if _USE_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=12)).decode()
    salted = f"{SECRET_KEY}:{password}".encode('utf-8')
    return hashlib.sha256(salted).hexdigest()


def verify_password(password: str, password_hash: str) -> bool:
    if password_hash.startswith(('$2b$', '$2a$', '$2y$')):
        if not _USE_BCRYPT:
            return False
        try:
            return bcrypt.checkpw(password.encode(), password_hash.encode())
        except Exception:
            return False
    import hashlib, hmac as _hmac_mod
    salted = f"{SECRET_KEY}:{password}".encode('utf-8')
    expected = hashlib.sha256(salted).hexdigest()
    return _hmac_mod.compare_digest(expected, password_hash)


def generate_token() -> str:
    return secrets.token_urlsafe(32)


def token_expiration_iso() -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    return expires_at.isoformat()
