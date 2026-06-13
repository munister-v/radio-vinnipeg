"""Конфігурація застосунку Radio Vinnipeg Nights (з .env)."""
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
STATION_NAME = os.getenv('STATION_NAME', 'Vinnipeg Nights')

# Rate limiting
AUTH_RATE_LIMIT_ENABLED = (os.getenv('AUTH_RATE_LIMIT_ENABLED', '1') == '1')
ENABLE_RATE_LIMIT_IN_TESTS = (os.getenv('ENABLE_RATE_LIMIT_IN_TESTS', '0') == '1')

CORS_ORIGINS = [o.strip() for o in os.getenv('CORS_ORIGINS', '').split(',') if o.strip()]
