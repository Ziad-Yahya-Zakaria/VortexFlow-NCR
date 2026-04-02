'use strict';

const { sql, ensureSchema, generateId, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson } = require('../_lib/http');
const { requireUser, assertRole } = require('../_lib/auth');
const { serializeInvitation } = require('../_lib/models');

module.exports = async (req, res) => {
  if (!allowMethods(req, res, ['GET', 'POST'])) {
    return;
  }

  try {
    await ensureSchema();
    const user = await requireUser(req);

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT
          i.id,
          i.case_id,
          i.department_id,
          i.assignee,
          i.invitation_status,
          i.created_at,
          n.case_number,
          d.name AS department_name
        FROM invitations i
        LEFT JOIN ncr_cases n ON n.id = i.case_id
        LEFT JOIN departments d ON d.id = i.department_id
        ORDER BY i.created_at DESC
      `;

      sendJson(res, 200, {
        items: rows.map(serializeInvitation)
      });
      return;
    }

    assertRole(user, ['admin', 'engineer']);

    const body = await readJson(req);
    const caseId = String(body.caseId || '').trim();
    const departmentId = String(body.departmentId || '').trim();
    const assignee = String(body.assignee || '').trim();
    const invitationStatus = ['Update', 'Cancel'].includes(body.invitationStatus)
      ? body.invitationStatus
      : 'Update';

    if (!caseId || !departmentId || !assignee) {
      const error = new Error('بيانات الدعوة غير مكتملة.');
      error.status = 400;
      throw error;
    }

    const [created] = await sql`
      INSERT INTO invitations (
        id,
        case_id,
        department_id,
        assignee,
        invitation_status,
        created_by
      )
      VALUES (
        ${generateId()},
        ${caseId},
        ${departmentId},
        ${assignee},
        ${invitationStatus},
        ${user.id}
      )
      RETURNING
        id,
        case_id,
        department_id,
        assignee,
        invitation_status,
        created_at
    `;

    await logActivity({
      entityType: 'ncr',
      entityId: caseId,
      action: 'invitation.created',
      message: `تمت إضافة دعوة إلى ${assignee} بحالة ${invitationStatus}.`,
      actorId: user.id,
      metadata: { departmentId, assignee, invitationStatus }
    });

    sendJson(res, 201, {
      item: serializeInvitation(created)
    });
  } catch (error) {
    sendError(res, error);
  }
};
