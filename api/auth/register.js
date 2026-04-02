'use strict';

const { sql, ensureSchema, generateId, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson } = require('../_lib/http');
const {
  normalizeEmail,
  hashPassword,
  createSession,
  getUserCount
} = require('../_lib/auth');
const { sanitizeUser } = require('../_lib/models');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['POST'])) {
    return;
  }

  try {
    await ensureSchema();

    if ((await getUserCount()) > 0) {
      const error = new Error('تم إنشاء المستخدم الرئيسي بالفعل. استخدم تسجيل الدخول.');
      error.status = 403;
      throw error;
    }

    const body = await readJson(req);
    const fullName = String(body.fullName || '').trim();
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const jobTitle = String(body.jobTitle || 'الزوز مدير النظام').trim() || 'الزوز مدير النظام';

    if (!fullName || !email || !password) {
      const error = new Error('الاسم والبريد وكلمة المرور حقول مطلوبة.');
      error.status = 400;
      throw error;
    }

    const passwordHash = await hashPassword(password);
    const id = generateId();

    const [user] = await sql`
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
        ${'admin'},
        ${jobTitle},
        ${true}
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

    await createSession(req, res, id);

    await logActivity({
      entityType: 'user',
      entityId: id,
      action: 'user.created',
      message: `تم إنشاء الحساب الإداري الأول للمستخدم ${fullName}.`,
      actorId: id,
      metadata: { email, role: 'admin', jobTitle, isVerified: true }
    });

    sendJson(res, 201, {
      user: sanitizeUser(user)
    });
  } catch (error) {
    sendError(res, error);
  }
};
