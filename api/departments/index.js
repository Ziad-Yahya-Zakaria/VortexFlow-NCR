'use strict';

const { sql, ensureSchema, generateId, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson } = require('../_lib/http');
const { requireUser, assertRole } = require('../_lib/auth');
const { serializeDepartment } = require('../_lib/models');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['GET', 'POST'])) {
    return;
  }

  try {
    await ensureSchema();
    const user = await requireUser(req);

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, name, created_at, updated_at
        FROM departments
        ORDER BY name ASC
      `;

      sendJson(res, 200, {
        items: rows.map(serializeDepartment)
      });
      return;
    }

    assertRole(user, ['admin', 'engineer']);

    const body = await readJson(req);
    const name = String(body.name || '').trim();

    if (!name) {
      const error = new Error('اسم القسم مطلوب.');
      error.status = 400;
      throw error;
    }

    const [created] = await sql`
      INSERT INTO departments (id, name, created_by)
      VALUES (${generateId()}, ${name}, ${user.id})
      RETURNING id, name, created_at, updated_at
    `;

    await logActivity({
      entityType: 'department',
      entityId: created.id,
      action: 'department.created',
      message: `تمت إضافة القسم ${name}.`,
      actorId: user.id
    });

    sendJson(res, 201, {
      item: serializeDepartment(created)
    });
  } catch (error) {
    sendError(res, error);
  }
};
