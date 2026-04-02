'use strict';

const crypto = require('node:crypto');

const { sql, ensureSchema, generateId } = require('./db');
const { sanitizeUser } = require('./models');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'vf_session';
const SESSION_TTL_DAYS = Math.max(
  1,
  Number.parseInt(process.env.SESSION_TTL_DAYS || '7', 10) || 7
);
const MAX_SESSIONS_PER_USER = Math.max(
  1,
  Number.parseInt(process.env.MAX_SESSIONS_PER_USER || '10', 10) || 10
);

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function getCookies(req) {
  const header = req.headers.cookie || '';
  return header.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) {
      return acc;
    }

    acc[key] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

function getCurrentToken(req) {
  const cookies = getCookies(req);
  return cookies[SESSION_COOKIE_NAME] || '';
}

function getRequestUserAgent(req) {
  return String(req.headers['user-agent'] || 'Unknown Browser').slice(0, 255);
}

function createSessionCookie(token) {
  const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Priority=High',
    `Max-Age=${maxAge}`,
    secure ? 'Secure' : null
  ]
    .filter(Boolean)
    .join('; ');
}

function clearSessionCookie() {
  const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  return [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Priority=High',
    'Max-Age=0',
    secure ? 'Secure' : null
  ]
    .filter(Boolean)
    .join('; ');
}

function hashPassword(password) {
  const normalizedPassword = String(password || '');
  if (normalizedPassword.length < 8) {
    const error = new Error('كلمة المرور يجب ألا تقل عن 8 أحرف.');
    error.status = 400;
    throw error;
  }

  const salt = crypto.randomBytes(16).toString('hex');

  return new Promise((resolve, reject) => {
    crypto.scrypt(normalizedPassword, salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
}

function verifyPassword(password, storedHash) {
  const [salt, storedValue] = String(storedHash || '').split(':');
  if (!salt || !storedValue) {
    return Promise.resolve(false);
  }

  return new Promise((resolve, reject) => {
    crypto.scrypt(String(password || ''), salt, 64, (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      const storedBuffer = Buffer.from(storedValue, 'hex');
      const candidateBuffer = Buffer.from(derivedKey.toString('hex'), 'hex');

      if (storedBuffer.length !== candidateBuffer.length) {
        resolve(false);
        return;
      }

      resolve(crypto.timingSafeEqual(storedBuffer, candidateBuffer));
    });
  });
}

async function getUserCount() {
  await ensureSchema();
  const [row] = await sql`SELECT COUNT(*)::int AS count FROM users`;
  return row?.count || 0;
}

async function cleanupExpiredSessions() {
  await ensureSchema();
  await sql`
    DELETE FROM sessions
    WHERE expires_at <= NOW()
  `;
}

async function pruneUserSessions(userId) {
  await ensureSchema();
  await sql`
    DELETE FROM sessions
    WHERE id IN (
      SELECT id
      FROM sessions
      WHERE user_id = ${userId}
      ORDER BY last_seen_at DESC, created_at DESC
      OFFSET ${MAX_SESSIONS_PER_USER}
    )
  `;
}

async function createSession(req, res, userId) {
  await ensureSchema();
  await cleanupExpiredSessions();

  const currentToken = getCurrentToken(req);
  if (currentToken) {
    await sql`
      DELETE FROM sessions
      WHERE token_hash = ${hashToken(currentToken)}
    `;
  }

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  const userAgent = getRequestUserAgent(req);

  await sql`
    INSERT INTO sessions (id, user_id, token_hash, user_agent, last_seen_at, expires_at)
    VALUES (${generateId()}, ${userId}, ${hashToken(token)}, ${userAgent}, NOW(), ${expiresAt})
  `;
  await pruneUserSessions(userId);

  res.setHeader('Set-Cookie', createSessionCookie(token));
  return token;
}

async function destroySession(req, res) {
  await ensureSchema();
  await cleanupExpiredSessions();

  const token = getCurrentToken(req);
  if (token) {
    await sql`
      DELETE FROM sessions
      WHERE token_hash = ${hashToken(token)}
    `;
  }

  res.setHeader('Set-Cookie', clearSessionCookie());
}

async function getSessionUser(req) {
  await ensureSchema();
  await cleanupExpiredSessions();

  const token = getCurrentToken(req);
  if (!token) {
    return null;
  }

  const [row] = await sql`
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.role,
      u.job_title,
      u.is_verified,
      u.is_active,
      u.created_at,
      u.updated_at,
      u.last_login_at,
      s.id AS session_id
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.expires_at > NOW()
      AND u.is_active = TRUE
    LIMIT 1
  `;

  if (row?.session_id) {
    await sql`
      UPDATE sessions
      SET last_seen_at = NOW()
      WHERE id = ${row.session_id}
    `;
  }

  return sanitizeUser(row);
}

async function listUserSessions(req, userId) {
  await ensureSchema();
  await cleanupExpiredSessions();

  const currentToken = getCurrentToken(req);
  const currentTokenHash = currentToken ? hashToken(currentToken) : null;

  const rows = await sql`
    SELECT
      id,
      user_agent,
      created_at,
      last_seen_at,
      expires_at,
      token_hash = ${currentTokenHash} AS is_current
    FROM sessions
    WHERE user_id = ${userId}
      AND expires_at > NOW()
    ORDER BY
      token_hash = ${currentTokenHash} DESC,
      last_seen_at DESC,
      created_at DESC
  `;

  return rows.map(row => ({
    id: row.id,
    userAgent: row.user_agent || 'Unknown Browser',
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    isCurrent: !!row.is_current
  }));
}

async function destroyOtherSessions(req, userId) {
  await ensureSchema();
  await cleanupExpiredSessions();

  const token = getCurrentToken(req);
  if (!token) {
    return 0;
  }

  const rows = await sql`
    DELETE FROM sessions
    WHERE user_id = ${userId}
      AND token_hash != ${hashToken(token)}
    RETURNING id
  `;

  return rows.length;
}

async function requireUser(req) {
  const user = await getSessionUser(req);
  if (!user) {
    const error = new Error('يجب تسجيل الدخول أولاً.');
    error.status = 401;
    throw error;
  }

  return user;
}

function assertRole(user, allowedRoles) {
  if (allowedRoles.includes(user.role)) {
    return;
  }

  const error = new Error('ليس لديك صلاحية كافية لهذا الإجراء.');
  error.status = 403;
  throw error;
}

module.exports = {
  SESSION_COOKIE_NAME,
  normalizeEmail,
  hashPassword,
  verifyPassword,
  getUserCount,
  listUserSessions,
  createSession,
  destroySession,
  destroyOtherSessions,
  getSessionUser,
  requireUser,
  assertRole
};
