"""Конфігурація застосунку Winnipeg Nights (з .env)."""
from pathlib import Path
import os

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
_default_db_path = BASE_DIR / 'database' / 'radio_vinnipeg.db'
DATABASE_PATH = Path(os.getenv('RADIO_DATABASE_PATH', _default_db_path))
SCHEMA_PATH = BASE_DIR / 'database' / 'schema.sql'

SECRET_KEY = os.getenv('SECRET_KEY') or 'radio-vinnipeg-demo-secret-key'
TOKEN_TTL_HOURS = int(os.getenv('TOKEN_TTL_HOURS') or '720')  # 30 днів за замовчуванням
DEBUG = (os.getenv('DEBUG') or '0') == '1'

# Базовий шлях при розміщенні на сайті (не використовується для окремого субдомену)
BASE_PATH = (os.getenv('BASE_PATH') or '').rstrip('/')

# Messenger at-rest encryption keys (Fernet, base64 urlsafe, 32-byte).
# Декілька ключів дозволені для ротації: "new_key,old_key".
MESSENGER_ENCRYPTION_KEYS = os.getenv('MESSENGER_ENCRYPTION_KEYS', '').strip()

# Назва ефіру/чату
STATION_NAME = os.getenv('STATION_NAME', 'Winnipeg Nights').replace('Vinnipeg', 'Winnipeg')

# Rate limiting
AUTH_RATE_LIMIT_ENABLED = (os.getenv('AUTH_RATE_LIMIT_ENABLED', '1') == '1')
ENABLE_RATE_LIMIT_IN_TESTS = (os.getenv('ENABLE_RATE_LIMIT_IN_TESTS', '0') == '1')

CORS_ORIGINS = [o.strip() for o in os.getenv('CORS_ORIGINS', '').split(',') if o.strip()]

# ICE-сервери для WebRTC-дзвінків (голосовий чат слухачів).
import json as _json

_default_ice_servers = [
    {'urls': 'stun:stun.l.google.com:19302'},
    {'urls': 'stun:stun1.l.google.com:19302'},
]
_ice_json = os.getenv('MESSENGER_ICE_SERVERS', '').strip()
_turn_urls_raw = os.getenv('MESSENGER_TURN_URLS', '').strip()
_turn_username = os.getenv('MESSENGER_TURN_USERNAME', '').strip()
_turn_credential = os.getenv('MESSENGER_TURN_CREDENTIAL', '').strip()
if _ice_json:
    try:
        _parsed_ice = _json.loads(_ice_json)
        MESSENGER_ICE_SERVERS = _parsed_ice if isinstance(_parsed_ice, list) else _default_ice_servers
    except Exception:
        MESSENGER_ICE_SERVERS = _default_ice_servers
else:
    _turn_urls = [u.strip() for u in _turn_urls_raw.split(',') if u.strip()]
    if _turn_urls and _turn_username and _turn_credential:
        MESSENGER_ICE_SERVERS = [
            *_default_ice_servers,
            {'urls': _turn_urls, 'username': _turn_username, 'credential': _turn_credential},
        ]
    else:
        MESSENGER_ICE_SERVERS = _default_ice_servers
