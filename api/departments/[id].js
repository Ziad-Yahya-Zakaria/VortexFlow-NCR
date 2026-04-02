'use strict';

const { sql, ensureSchema, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson, getPathId } = require('../_lib/http');
const { requireUser, assertRole } = require('../_lib/auth');
const { serializeDepartment } = require('../_lib/models');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['PATCH', 'DELETE'])) {
    return;
  }

  try {
    await ensureSchema();
    const user = await requireUser(req);
    assertRole(user, ['admin', 'engineer']);

    const id = getPathId(req);
    if (!id) {
      const error = new Error('معرف القسم مفقود.');
      error.status = 400;
      throw error;
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      if (!name) {
        const error = new Error('اسم القسم مطلوب.');
        error.status = 400;
        throw error;
      }

      const [updated] = await sql`
        UPDATE departments
        SET
          name = ${name},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING id, name, created_at, updated_at
      `;

      if (!updated) {
        const error = new Error('القسم غير موجود.');
        error.status = 404;
        throw error;
      }

      await logActivity({
        entityType: 'department',
        entityId: id,
        action: 'department.updated',
        message: `تم تحديث القسم إلى ${name}.`,
        actorId: user.id
      });

      sendJson(res, 200, {
        item: serializeDepartment(updated)
      });
      return;
    }

    const [deleted] = await sql`
      DELETE FROM departments
      WHERE id = ${id}
      RETURNING id, name, created_at, updated_at
    `;

    if (!deleted) {
      const error = new Error('القسم غير موجود.');
      error.status = 404;
      throw error;
    }

    await logActivity({
      entityType: 'department',
      entityId: id,
      action: 'department.deleted',
      message: `تم حذف القسم ${deleted.name}.`,
      actorId: user.id
    });

    sendJson(res, 200, {
      item: serializeDepartment(deleted)
    });
  } catch (error) {
    sendError(res, error);
  }
};
