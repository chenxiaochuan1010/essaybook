export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('author','reviewer','admin')),
  color      TEXT NOT NULL,
  pin_hash   TEXT,
  onboarded_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  parent_id  TEXT REFERENCES folders(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL DEFAULT '',
  content            TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','in_review','final')),
  owner_id           TEXT NOT NULL REFERENCES users(id),
  folder_id          TEXT REFERENCES folders(id),
  current_version_id TEXT,
  active_round_id    TEXT,
  published_at       TEXT,
  publish_number     INTEGER,
  publish_fee_cents  INTEGER,
  deleted_at         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_owner_updated
  ON documents(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_status
  ON documents(status) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS versions (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL REFERENCES documents(id),
  content           TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  kind              TEXT NOT NULL
                    CHECK (kind IN ('snapshot','auto_snapshot','review_base',
                                    'merge','restore','import')),
  created_by        TEXT NOT NULL REFERENCES users(id),
  parent_version_id TEXT REFERENCES versions(id),
  note              TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versions_doc_created
  ON versions(document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS review_rounds (
  id              TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL REFERENCES documents(id),
  base_version_id TEXT NOT NULL REFERENCES versions(id),
  status          TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','merged','cancelled')),
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      TEXT NOT NULL,
  closed_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_rounds_doc
  ON review_rounds(document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS review_submissions (
  id              TEXT PRIMARY KEY,
  round_id        TEXT NOT NULL REFERENCES review_rounds(id),
  reviewer_id     TEXT NOT NULL REFERENCES users(id),
  base_version_id TEXT NOT NULL REFERENCES versions(id),
  edited_content  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted','processed','withdrawn')),
  created_at      TEXT NOT NULL,
  processed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_round
  ON review_submissions(round_id, created_at);

CREATE TABLE IF NOT EXISTS changes (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES review_submissions(id) ON DELETE CASCADE,
  seq           INTEGER NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('insert','delete','replace')),
  base_start    INTEGER NOT NULL,
  base_end      INTEGER NOT NULL,
  old_text      TEXT NOT NULL DEFAULT '',
  new_text      TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','accepted','rejected','conflict')),
  decided_by    TEXT REFERENCES users(id),
  decided_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_changes_submission
  ON changes(submission_id, seq);

CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES review_submissions(id) ON DELETE CASCADE,
  base_start    INTEGER NOT NULL,
  base_end      INTEGER NOT NULL,
  quoted_text   TEXT NOT NULL,
  body          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','resolved')),
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL
);

-- 稿费账本：每篇成品一条记录，彻底删除作文后也保留。
CREATE TABLE IF NOT EXISTS fees (
  id              TEXT PRIMARY KEY,
  document_id     TEXT,
  document_title  TEXT NOT NULL,
  publish_number  INTEGER,
  amount_cents    INTEGER NOT NULL,
  earned_at       TEXT NOT NULL,
  settlement_id   TEXT,
  settled_at      TEXT,
  settled_by      TEXT
);

CREATE INDEX IF NOT EXISTS idx_fees_earned ON fees(earned_at DESC);
CREATE INDEX IF NOT EXISTS idx_fees_document ON fees(document_id);

-- 结算申请：小朋友发起，爸爸妈妈确认。
CREATE TABLE IF NOT EXISTS settlements (
  id            TEXT PRIMARY KEY,
  requested_by  TEXT NOT NULL,
  requested_at  TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','cancelled')),
  amount_cents  INTEGER NOT NULL,
  confirmed_by  TEXT,
  confirmed_at  TEXT,
  cancelled_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_settlements_status
  ON settlements(status, requested_at DESC);

CREATE TABLE IF NOT EXISTS backups (
  id           TEXT PRIMARY KEY,
  path         TEXT NOT NULL,
  size_bytes   INTEGER NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('auto','manual','pre_migration')),
  integrity_ok INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO schema_migrations (version, applied_at)
VALUES (1, '2026-11-01T00:00:00.000Z');
INSERT OR IGNORE INTO settings (key, value) VALUES ('schema_version', '1');
`;
