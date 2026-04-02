'use strict';

const { sql, ensureSchema, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson } = require('../_lib/http');
const { requireUser, verifyPassword, hashPassword } = require('../_lib/auth');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['PATCH'])) {
    return;
  }

  try {
    await ensureSchema();
    const user = await requireUser(req);
    const body = await readJson(req);
    const currentPassword = String(body.currentPassword || '');
    const newPassword = String(body.newPassword || '');

    if (!currentPassword || !newPassword) {
      const error = new Error('كلمة المرور الحالية والجديدة مطلوبتان.');
      error.status = 400;
      throw error;
    }

    const [currentUser] = await sql`
      SELECT id, full_name, password_hash
      FROM users
      WHERE id = ${user.id}
      LIMIT 1
    `;

    if (!currentUser) {
      const error = new Error('المستخدم غير موجود.');
      error.status = 404;
      throw error;
    }

    if (!(await verifyPassword(currentPassword, currentUser.password_hash))) {
      const error = new Error('كلمة المرور الحالية غير صحيحة.');
      error.status = 401;
      throw error;
    }

    const passwordHash = await hashPassword(newPassword);

    await sql`
      UPDATE users
      SET
        password_hash = ${passwordHash},
        updated_at = NOW()
      WHERE id = ${user.id}
    `;

    await logActivity({
      entityType: 'user',
      entityId: user.id,
      action: 'user.password_changed',
      message: `تم تغيير كلمة مرور المستخدم ${currentUser.full_name}.`,
      actorId: user.id
    });

    sendJson(res, 200, {
      success: true
    });
  } catch (error) {
    sendError(res, error);
  }
};
