'use strict';

const { sql, ensureSchema, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson, getPathId } = require('../_lib/http');
const { requireUser, assertRole, hashPassword } = require('../_lib/auth');
const { sanitizeUser } = require('../_lib/models');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['PATCH'])) {
    return;
  }

  try {
    await ensureSchema();
    const actor = await requireUser(req);
    assertRole(actor, ['admin']);

    const id = getPathId(req);
    if (!id) {
      const error = new Error('معرف المستخدم مفقود.');
      error.status = 400;
      throw error;
    }

    const body = await readJson(req);
    const fullName = body.fullName ? String(body.fullName).trim() : null;
    const role = body.role && ['admin', 'engineer', 'viewer'].includes(body.role) ? body.role : null;
    const jobTitleProvided = body.jobTitle !== undefined;
    const jobTitle = jobTitleProvided ? String(body.jobTitle || '').trim() || null : null;
    const isVerifiedProvided = typeof body.isVerified === 'boolean';
    const isVerified = isVerifiedProvided ? body.isVerified : null;
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : null;
    const password = body.password ? String(body.password) : null;
    const passwordHash = password ? await hashPassword(password) : null;

    if (!fullName && !role && isActive === null && !passwordHash && !jobTitleProvided && !isVerifiedProvided) {
      const error = new Error('لا توجد بيانات قابلة للتحديث.');
      error.status = 400;
      throw error;
    }

    if (actor.id === id && isActive === false) {
      const error = new Error('لا يمكن تعطيل حسابك الحالي.');
      error.status = 400;
      throw error;
    }

    const [updated] = await sql`
      UPDATE users
      SET
        full_name = COALESCE(${fullName}, full_name),
        role = COALESCE(${role}, role),
        job_title = CASE WHEN ${jobTitleProvided} THEN ${jobTitle} ELSE job_title END,
        is_verified = CASE WHEN ${isVerifiedProvided} THEN ${isVerified} ELSE is_verified END,
        is_active = COALESCE(${isActive}, is_active),
        password_hash = COALESCE(${passwordHash}, password_hash),
        updated_at = NOW()
      WHERE id = ${id}
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

    if (!updated) {
      const error = new Error('المستخدم غير موجود.');
      error.status = 404;
      throw error;
    }

    await logActivity({
      entityType: 'user',
      entityId: id,
      action: 'user.updated',
      message: `تم تحديث المستخدم ${updated.full_name}.`,
      actorId: actor.id,
      metadata: {
        fullName: fullName || undefined,
        role: role || undefined,
        jobTitle,
        isVerified,
        isActive,
        passwordReset: !!passwordHash
      }
    });

    sendJson(res, 200, {
      item: sanitizeUser(updated)
    });
  } catch (error) {
    sendError(res, error);
  }
};
