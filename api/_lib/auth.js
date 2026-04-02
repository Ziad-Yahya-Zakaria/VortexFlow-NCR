'use strict';

const crypto = require('node:crypto');

const { sql, ensureSchema, generateId } = require('./db');
const { sanitizeUser } = require('./models');

const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'vf_session';
const SESSION_TTL_DAYS = Math.max(
  1,
  Number.parseInt(process.env.SESSION_TTL_DAYS || '7', 10) || 7
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

function createSessionCookie(token) {
  const secure = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const maxAge = SESSION_TTL_DAYS * 24 * 60 * 60;
  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
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

async function createSession(res, userId) {
  await ensureSchema();

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  await sql`
    INSERT INTO sessions (id, user_id, token_hash, expires_at)
    VALUES (${generateId()}, ${userId}, ${hashToken(token)}, ${expiresAt})
  `;

  res.setHeader('Set-Cookie', createSessionCookie(token));
  return token;
}

async function destroySession(req, res) {
  await ensureSchema();

  const cookies = getCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
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

  const cookies = getCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
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
      u.last_login_at
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ${hashToken(token)}
      AND s.expires_at > NOW()
      AND u.is_active = TRUE
    LIMIT 1
  `;

  return sanitizeUser(row);
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
  createSession,
  destroySession,
  getSessionUser,
  requireUser,
  assertRole
};
