'use strict';

const crypto = require('node:crypto');
const postgres = require('postgres');

const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required for API routes.');
}

const sql = postgres(connectionString, {
  max: 5,
  idle_timeout: 20,
  connect_timeout: 15
});

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'engineer',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ
    )`,
  'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
  `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    )`,
  'CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)',
  `CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL
    )`,
  `CREATE TABLE IF NOT EXISTS ncr_cases (
      id TEXT PRIMARY KEY,
      case_number TEXT NOT NULL UNIQUE,
      sub_case TEXT,
      description TEXT NOT NULL,
      status TEXT NOT NULL,
      step INTEGER NOT NULL DEFAULT 1,
      priority TEXT NOT NULL DEFAULT 'Medium',
      severity TEXT NOT NULL DEFAULT 'Major',
      due_date TIMESTAMPTZ,
      root_cause TEXT,
      corrective_action TEXT,
      tags JSONB NOT NULL DEFAULT '[]'::jsonb,
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
    )`,
  'CREATE INDEX IF NOT EXISTS idx_ncr_cases_status ON ncr_cases(status)',
  'CREATE INDEX IF NOT EXISTS idx_ncr_cases_department_id ON ncr_cases(department_id)',
  'CREATE INDEX IF NOT EXISTS idx_ncr_cases_owner_id ON ncr_cases(owner_id)',
  'CREATE INDEX IF NOT EXISTS idx_ncr_cases_due_date ON ncr_cases(due_date)',
  'CREATE INDEX IF NOT EXISTS idx_ncr_cases_date ON ncr_cases(date)',
  `CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      case_id TEXT NOT NULL REFERENCES ncr_cases(id) ON DELETE CASCADE,
      department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
      assignee TEXT NOT NULL,
      invitation_status TEXT NOT NULL DEFAULT 'Update',
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  'CREATE INDEX IF NOT EXISTS idx_invitations_case_id ON invitations(case_id)',
  'CREATE INDEX IF NOT EXISTS idx_invitations_department_id ON invitations(department_id)',
  `CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      message TEXT NOT NULL,
      actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  'CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON activity_logs(entity_type, entity_id)',
  'CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC)'
];

let schemaPromise;

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      for (const statement of schemaStatements) {
        await sql.unsafe(statement);
      }
    })().catch(error => {
      schemaPromise = undefined;
      throw error;
    });
  }

  return schemaPromise;
}

function generateId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

async function logActivity({
  entityType,
  entityId,
  action,
  message,
  actorId = null,
  metadata = {}
}) {
  await ensureSchema();

  await sql`
    INSERT INTO activity_logs (
      id,
      entity_type,
      entity_id,
      action,
      message,
      actor_id,
      metadata
    )
    VALUES (
      ${generateId()},
      ${entityType},
      ${entityId},
      ${action},
      ${message},
      ${actorId},
      ${metadata}
    )
  `;
}

module.exports = {
  sql,
  ensureSchema,
  generateId,
  logActivity
};
