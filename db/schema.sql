-- Database Schema for World Cup 2026 Prediction App

-- 1. Teams Table
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name_en TEXT NOT NULL,
  flag TEXT,
  fifa_code TEXT,
  group_name TEXT
);

-- 2. Matches Table
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  home_team_id INTEGER,
  away_team_id INTEGER,
  home_team_name TEXT,
  away_team_name TEXT,
  home_team_label TEXT, -- For placeholder knockout stages (e.g. "Winner Match 80")
  away_team_label TEXT,
  home_score INTEGER DEFAULT 0,
  away_score INTEGER DEFAULT 0,
  group_name TEXT,
  round_name TEXT,
  matchday INTEGER,
  local_date TEXT, -- ISO Date String
  finished BOOLEAN DEFAULT 0,
  status TEXT DEFAULT 'scheduled', -- 'scheduled', 'live', 'finished'
  type TEXT, -- 'group', 'r32', 'r16', 'qf', 'sf', 'third', 'final'
  home_win_pct REAL DEFAULT 33.3,
  away_win_pct REAL DEFAULT 33.3,
  draw_pct REAL DEFAULT 33.3,
  over_under_line REAL DEFAULT 2.5,
  over_odds REAL DEFAULT 1.9,
  under_odds REAL DEFAULT 1.9,
  odds_locked INTEGER DEFAULT 0,
  qstash_scheduled INTEGER DEFAULT 0
);

-- 3. Participants Table
CREATE TABLE IF NOT EXISTS participants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL
);

-- 4. Predictions Table
CREATE TABLE IF NOT EXISTS predictions (
  participant_id INTEGER NOT NULL,
  match_id INTEGER NOT NULL,
  predicted_winner TEXT, -- 'home', 'away', or 'draw'
  predicted_over_under TEXT, -- 'over' or 'under'
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  points_winner INTEGER DEFAULT 0, -- 2 if correct
  points_ou INTEGER DEFAULT 0,     -- 1 if correct
  points_score INTEGER DEFAULT 0,  -- 1 if correct
  total_points INTEGER DEFAULT 0,  -- sum of above (0-3)
  PRIMARY KEY (participant_id, match_id),
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

-- 5. Settings Table (For tracking sync status and timestamps)
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Initialize settings
INSERT OR IGNORE INTO settings (key, value) VALUES ('last_sync', '2026-06-10T00:00:00Z');
INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_password', 'admin123');

-- 6. Logs Table
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
  category TEXT NOT NULL, -- 'odds', 'match_time', 'prediction'
  match_id INTEGER,
  participant_id INTEGER,
  description TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE SET NULL,
  FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE SET NULL
);
