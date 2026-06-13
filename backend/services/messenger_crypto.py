"""Шифрування повідомлень чату (at-rest). Перенесено з Army Bank messenger."""
from __future__ import annotations

import base64
import hashlib
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from ..config import MESSENGER_ENCRYPTION_KEYS, SECRET_KEY

_ENC_PREFIX = 'enc:v1:'
_DELETED_TEXT = 'Повідомлення видалено'


def _sanitize_fernet_key(key: str) -> str:
    raw = (key or '').strip()
    if not raw:
        return ''
    raw = raw.replace('+', '-').replace('/', '_')
    raw = raw + ('=' * ((4 - len(raw) % 4) % 4))
    try:
        decoded = base64.urlsafe_b64decode(raw.encode('ascii'))
    except Exception:
        return ''
    if len(decoded) != 32:
        return ''
    return base64.urlsafe_b64encode(decoded).decode('ascii')


def _normalize_keys(raw: str) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for part in (raw or '').split(','):
        key = _sanitize_fernet_key(part)
        if not key or key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return normalized


def _derive_key_from_secret(secret: str) -> str:
    digest = hashlib.sha256((secret or 'radio-vinnipeg').encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest).decode('ascii')


@lru_cache(maxsize=1)
def _cipher() -> MultiFernet:
    keys = _normalize_keys(MESSENGER_ENCRYPTION_KEYS)
    legacy_key = _derive_key_from_secret(SECRET_KEY)
    if not keys:
        keys = [legacy_key]
    elif legacy_key not in keys:
        keys.append(legacy_key)
    fernets = [Fernet(k.encode('ascii')) for k in keys]
    return MultiFernet(fernets)


def encrypt_message(plain_text: str) -> str:
    text = str(plain_text or '')
    token = _cipher().encrypt(text.encode('utf-8')).decode('ascii')
    return _ENC_PREFIX + token


def decrypt_message(payload: str, *, fallback: str = '') -> str:
    raw = str(payload or '')
    if not raw:
        return fallback
    if not raw.startswith(_ENC_PREFIX):
        return raw
    token = raw[len(_ENC_PREFIX):]
    try:
        return _cipher().decrypt(token.encode('ascii')).decode('utf-8')
    except (InvalidToken, ValueError):
        return fallback


def deleted_message_text() -> str:
    return _DELETED_TEXT
