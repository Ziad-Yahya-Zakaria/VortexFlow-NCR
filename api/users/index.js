'use strict';

const { sql, ensureSchema, generateId, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson } = require('../_lib/http');
const {
  requireUser,
  assertRole,
  normalizeEmail,
  hashPassword
} = require('../_lib/auth');
const { sanitizeUser } = require('../_lib/models');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['GET', 'POST'])) {
    return;
  }

  try {
    await ensureSchema();
    const user = await requireUser(req);

    if (req.method === 'GET') {
      const rows = user.role === 'admin'
        ? await sql`
            SELECT
              id,
              full_name,
              email,
              role,
              job_title,
              is_verified,
              is_active,
              created_at,
              updated_at,
              last_login_at
            FROM users
            ORDER BY created_at ASC
          `
        : await sql`
            SELECT
              id,
              full_name,
              NULL::TEXT AS email,
              role,
              job_title,
              is_verified,
              is_active,
              created_at,
              updated_at,
              NULL::TIMESTAMPTZ AS last_login_at
            FROM users
            WHERE is_active = TRUE
            ORDER BY full_name ASC
          `;

      sendJson(res, 200, {
        items: rows.map(sanitizeUser)
      });
      return;
    }

    assertRole(user, ['admin']);

    const body = await readJson(req);
    const fullName = String(body.fullName || '').trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const role = ['admin', 'engineer', 'viewer'].includes(body.role) ? body.role : 'viewer';
    const jobTitle = String(body.jobTitle || '').trim() || null;
    const isVerified = !!body.isVerified;

    if (!fullName || !email || !password) {
      const error = new Error('الاسم والبريد وكلمة المرور حقول مطلوبة.');
      error.status = 400;
      throw error;
    }

    const passwordHash = await hashPassword(password);
    const id = generateId();

    const [created] = await sql`
      INSERT INTO users (
        id,
        full_name,
        email,
        password_hash,
        role,
        job_title,
        is_verified
      )
      VALUES (
        ${id},
        ${fullName},
        ${email},
        ${passwordHash},
        ${role},
        ${jobTitle},
        ${isVerified}
      )
      RETURNING
        id,
        full_name,
        email,
        role,
        job_title,
        is_verified,
        is_active,
        created_at,
        updated_at,
        last_login_at
    `;

    await logActivity({
      entityType: 'user',
      entityId: id,
      action: 'user.created',
      message: `تم إنشاء مستخدم جديد: ${fullName}.`,
      actorId: user.id,
      metadata: { role, email, jobTitle, isVerified }
    });

    sendJson(res, 201, {
      item: sanitizeUser(created)
    });
  } catch (error) {
    sendError(res, error);
  }
};
