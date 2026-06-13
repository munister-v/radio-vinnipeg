-- Radio Vinnipeg Nights — схема SQLite
PRAGMA foreign_keys = ON;

-- Слухачі чату: ідентифікуються унікальним нікнеймом + паролем.
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#34d399',
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
