'use strict';

const { sql, ensureSchema } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson } = require('../_lib/http');
const {
  normalizeEmail,
  verifyPassword,
  createSession
} = require('../_lib/auth');
const { sanitizeUser } = require('../_lib/models');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    await ensureSchema();

    const body = await readJson(req);
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');

    if (!email || !password) {
      const error = new Error('البريد الإلكتروني وكلمة المرور مطلوبان.');
      error.status = 400;
      throw error;
    }

    const [userRow] = await sql`
      SELECT
        id,
        full_name,
        email,
        password_hash,
        role,
        is_active,
        created_at,
        updated_at,
        last_login_at
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `;

    if (!userRow || !(await verifyPassword(password, userRow.password_hash))) {
      const error = new Error('بيانات تسجيل الدخول غير صحيحة.');
      error.status = 401;
      throw error;
    }

    if (!userRow.is_active) {
      const error = new Error('هذا الحساب غير مفعل حالياً.');
      error.status = 403;
      throw error;
    }

    await sql`
      UPDATE users
      SET
        last_login_at = NOW(),
        updated_at = NOW()
      WHERE id = ${userRow.id}
    `;

    await createSession(res, userRow.id);

    sendJson(res, 200, {
      user: sanitizeUser({
        ...userRow,
        last_login_at: new Date()
      })
    });
  } catch (error) {
    sendError(res, error);
  }
};
