# Gunicorn — конфігурація для Radio Vinnipeg Nights
# Запуск: gunicorn -c deploy/gunicorn.conf.py backend.app:app

import os

chdir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
port = int(os.environ.get("PORT", "5060"))
bind = f"0.0.0.0:{port}"
workers = 2
worker_class = "gthread"
threads = 2
timeout = 60
keepalive = 5

accesslog = "-"
errorlog = "-"
loglevel = "info"
