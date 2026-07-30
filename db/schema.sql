CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  username   TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS participants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS teams (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id        INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, participant_id)
);

CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  unit           TEXT,
  mode           TEXT NOT NULL CHECK (mode IN ('individual','team')) DEFAULT 'individual',
  sort_direction TEXT NOT NULL CHECK (sort_direction IN ('asc','desc')) DEFAULT 'desc',
  position       INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL CHECK (status IN ('pending','completed')) DEFAULT 'pending',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS event_points (
  event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  rank     INTEGER NOT NULL,
  points   REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, rank)
);

CREATE TABLE IF NOT EXISTS event_team_overrides (
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  team_id        INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, team_id, participant_id)
);

CREATE TABLE IF NOT EXISTS results (
  event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  entrant_type TEXT NOT NULL CHECK (entrant_type IN ('participant','team')),
  entrant_id   INTEGER NOT NULL,
  raw_score    REAL NOT NULL,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (event_id, entrant_type, entrant_id)
);

CREATE INDEX IF NOT EXISTS idx_results_event ON results(event_id);

CREATE TABLE IF NOT EXISTS custom_columns (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  competition_id INTEGER NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_column_values (
  column_id      INTEGER NOT NULL REFERENCES custom_columns(id) ON DELETE CASCADE,
  participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  value          TEXT,
  PRIMARY KEY (column_id, participant_id)
);

CREATE TABLE IF NOT EXISTS manual_adjustments (
  participant_id INTEGER PRIMARY KEY REFERENCES participants(id) ON DELETE CASCADE,
  value          REAL NOT NULL DEFAULT 0
);
