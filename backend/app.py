"""Головний Flask-застосунок Radio Vinnipeg Nights."""
from __future__ import annotations

from pathlib import Path

from flask import Flask, send_from_directory
from flask_cors import CORS

from .config import CORS_ORIGINS, STATION_NAME
from .database import init_db, run_migrations
from .routes.auth_routes import auth_bp
from .routes.call_routes import call_bp
from .routes.chat_routes import chat_bp
from .routes.room_routes import room_bp

FRONTEND_DIST = Path(__file__).resolve().parent.parent / 'frontend' / 'dist'


def create_app() -> Flask:
    app = Flask(__name__, static_folder=None)

    if CORS_ORIGINS:
        CORS(app, resources={r'/api/*': {'origins': CORS_ORIGINS}}, supports_credentials=True)

    init_db()
    run_migrations()

    app.register_blueprint(auth_bp)
    app.register_blueprint(call_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(room_bp)

    @app.get('/api/health')
    def health():
        return {'ok': True, 'station': STATION_NAME}

    @app.get('/')
    @app.get('/<path:path>')
    def serve_frontend(path: str = 'index.html'):
        target = FRONTEND_DIST / path
        if path != 'index.html' and target.is_file():
            return send_from_directory(FRONTEND_DIST, path)
        return send_from_directory(FRONTEND_DIST, 'index.html')

    return app


app = create_app()
