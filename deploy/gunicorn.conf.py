# Gunicorn — конфігурація для Winnipeg Nights
# Запуск: gunicorn -c deploy/gunicorn.conf.py backend.app:app

import os

chdir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
port = int(os.environ.get("PORT", "5060"))
bind = f"0.0.0.0:{port}"
# Радіо інтенсивно опитує сигналінг/чат короткими запитами, тож тримаємо
# більше потоків на воркер, аби polling кількох учасників не блокував решту.
workers = 1
worker_class = "gthread"
threads = 8
timeout = 60
graceful_timeout = 30
keepalive = 5

# Лічильник серцебиття воркера тримаємо в RAM (tmpfs), а не на диску —
# інакше повільний I/O спричиняє хибні kill-и воркера під навантаженням.
worker_tmp_dir = "/dev/shm"

# Періодично переробляємо воркер, щоб обмежити можливі витоки пам'яті
# (важливо на VPS з малим RAM). Jitter — щоб рестарт не був різким.
max_requests = 2000
max_requests_jitter = 200

# Завантажуємо застосунок у майстрі до fork — швидший старт і менше RAM (COW).
preload_app = True

accesslog = "-"
errorlog = "-"
loglevel = "info"
