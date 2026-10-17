PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    theme TEXT,
    difficulty TEXT,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    col_headers TEXT NOT NULL,
    row_headers TEXT NOT NULL,
    palette TEXT NOT NULL,
    master_grid TEXT NOT NULL,
    total_target_cells INTEGER NOT NULL,
    is_preset BOOLEAN DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    image_id TEXT NOT NULL REFERENCES images(id),
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    max_players INTEGER DEFAULT 10,
    elapsed_ms INTEGER DEFAULT 0,
    timer_running INTEGER DEFAULT 0,
    timer_started_at INTEGER,
    current_grid TEXT NOT NULL,
    stats_total_placed INTEGER DEFAULT 0,
    stats_correct_placed INTEGER DEFAULT 0,
    stats_accuracy_pct REAL DEFAULT 0.0,
    stats_completed_pct REAL DEFAULT 0.0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    nickname TEXT NOT NULL,
    avatar_color TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'player',
    pixels_placed INTEGER DEFAULT 0,
    correct_pixels INTEGER DEFAULT 0,
    accuracy_pct REAL DEFAULT 0.0,
    score INTEGER DEFAULT 0,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS action_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL,
    player_nickname TEXT NOT NULL,
    action_type TEXT NOT NULL,
    row_idx INTEGER,
    col_idx INTEGER,
    coord_label TEXT,
    previous_color TEXT,
    placed_color TEXT,
    target_color TEXT,
    is_correct INTEGER,
    server_timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actions_session ON action_logs(session_id, server_timestamp);
CREATE INDEX IF NOT EXISTS idx_actions_player ON action_logs(player_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
