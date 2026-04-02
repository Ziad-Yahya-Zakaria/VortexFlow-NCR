'use strict';

const { sql, ensureSchema, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, getPathId } = require('../_lib/http');
const { requireUser, assertRole } = require('../_lib/auth');
const { serializeInvitation } = require('../_lib/models');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['DELETE'])) {
    return;
  }

  try {
    await ensureSchema();
    const user = await requireUser(req);
    assertRole(user, ['admin', 'engineer']);

    const id = getPathId(req);
    if (!id) {
      const error = new Error('معرف الدعوة مفقود.');
      error.status = 400;
      throw error;
    }

    const [deleted] = await sql`
      DELETE FROM invitations
      WHERE id = ${id}
      RETURNING
        id,
        case_id,
        department_id,
        assignee,
        invitation_status,
        created_at
    `;

    if (!deleted) {
      const error = new Error('الدعوة غير موجودة.');
      error.status = 404;
      throw error;
    }

    await logActivity({
      entityType: 'ncr',
      entityId: deleted.case_id,
      action: 'invitation.deleted',
      message: `تم حذف دعوة ${deleted.assignee}.`,
      actorId: user.id
    });

    sendJson(res, 200, {
      item: serializeInvitation(deleted)
    });
  } catch (error) {
    sendError(res, error);
  }
};
