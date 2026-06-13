-- Radio Vinnipeg Nights — схема SQLite
PRAGMA foreign_keys = ON;

-- Слухачі: радіо повністю відкрите, авторизація НЕ потрібна.
-- Кожен браузер отримує гостьовий профіль (лише нік, без пароля).
-- password_hash опційний (NULL у гостей, лишений для legacy-акаунтів).
-- Нік НЕ унікальний: збіги допустимі, бо немає пароля для захисту імені.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    password_hash TEXT,
    color TEXT NOT NULL DEFAULT '#34d399',
    is_guest INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_seen_at TEXT
);

-- Сесії (Bearer-токени), як у Army Bank.
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Спільна кімната чату слухачів. Поки одна кімната ("Lounge"),
-- але таблиця залишена для майбутнього розширення (кілька кімнат/ефірів).
CREATE TABLE IF NOT EXISTS rooms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL
);

-- Повідомлення чату. text зберігається зашифрованим (messenger_crypto, Fernet).
CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_room_id ON messages(room_id, id);

-- Груповий голосовий дзвінок у кімнаті (один активний на кімнату).
CREATE TABLE IF NOT EXISTS calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    caller_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_room ON calls(room_id, status);

-- Учасники дзвінка (mesh WebRTC).
CREATE TABLE IF NOT EXISTS call_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'joined',
    joined_at TEXT,
    left_at TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(call_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_call_members_call ON call_members(call_id, state);

-- WebRTC сигнали (offer/answer/ice/bye) для встановлення з'єднань між учасниками.
CREATE TABLE IF NOT EXISTS call_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_call_signals_call ON call_signals(call_id, id);

-- ── Живий ефір (трансляція) ────────────────────────────────────────────────
-- Один ведучий (host) вряд у кімнаті веде ефір; слухачі лише приймають
-- аудіо (WebRTC star: host -> кожен слухач), мікрофон їм НЕ потрібен.
CREATE TABLE IF NOT EXISTS broadcasts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room_id INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    host_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'live',   -- live | ended
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_broadcasts_room ON broadcasts(room_id, status);

-- Слухачі активного ефіру (для presence та для host, щоб знати кому слати offer).
CREATE TABLE IF NOT EXISTS broadcast_listeners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    state TEXT NOT NULL DEFAULT 'listening',  -- listening | left
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(broadcast_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_broadcast_listeners ON broadcast_listeners(broadcast_id, state);

-- WebRTC сигнали ефіру (offer/answer/ice/bye) між host та слухачами.
CREATE TABLE IF NOT EXISTS broadcast_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    broadcast_id INTEGER NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
    from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    to_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_broadcast_signals ON broadcast_signals(broadcast_id, id);
