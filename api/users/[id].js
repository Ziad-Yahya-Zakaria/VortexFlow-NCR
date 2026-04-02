'use strict';

const { sql, ensureSchema, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson, getPathId } = require('../_lib/http');
const { requireUser, assertRole } = require('../_lib/auth');
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
    const isActive = typeof body.isActive === 'boolean' ? body.isActive : null;

    if (!fullName && !role && isActive === null) {
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
        is_active = COALESCE(${isActive}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
      RETURNING
        id,
        full_name,
        email,
        role,
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
        isActive
      }
    });

    sendJson(res, 200, {
      item: sanitizeUser(updated)
    });
  } catch (error) {
    sendError(res, error);
  }
};
