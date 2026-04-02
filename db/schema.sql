CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'engineer',
  job_title TEXT,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS departments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ncr_cases (
  id TEXT PRIMARY KEY,
  case_number TEXT NOT NULL UNIQUE,
  sub_case TEXT,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  step INTEGER NOT NULL DEFAULT 1,
  category TEXT NOT NULL DEFAULT 'Process',
  source TEXT NOT NULL DEFAULT 'Internal',
  priority TEXT NOT NULL DEFAULT 'Medium',
  severity TEXT NOT NULL DEFAULT 'Major',
  verification_status TEXT NOT NULL DEFAULT 'Pending',
  due_date TIMESTAMPTZ,
  containment_action TEXT,
  root_cause TEXT,
  corrective_action TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  color_code TEXT NOT NULL DEFAULT '#3b82f6',
  attached_document JSONB,
  source_mode TEXT NOT NULL DEFAULT 'remote',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ncr_cases ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Process';
ALTER TABLE ncr_cases ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'Internal';
ALTER TABLE ncr_cases ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'Pending';
ALTER TABLE ncr_cases ADD COLUMN IF NOT EXISTS containment_action TEXT;
ALTER TABLE ncr_cases ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES ncr_cases(id) ON DELETE CASCADE,
  department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
  assignee TEXT NOT NULL,
  invitation_status TEXT NOT NULL DEFAULT 'Update',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_logs (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
