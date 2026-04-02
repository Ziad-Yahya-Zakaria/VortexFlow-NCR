'use strict';

const { sql, ensureSchema, generateId, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson } = require('../_lib/http');
const { requireUser, assertRole } = require('../_lib/auth');
const { serializeActivity, serializeNcr } = require('../_lib/models');
const {
  deleteAttachmentObject,
  resolveNcrAttachment,
  resolveNcrAttachments,
  uploadAttachmentObject
} = require('../_lib/storage');

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeChecklist(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(item => ({
      id: String(item?.id || generateId()),
      label: String(item?.label || '').trim(),
      done: !!item?.done,
      note: String(item?.note || '').trim()
    }))
    .filter(item => item.label);
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = async (req, res) => {
  let uploadedAttachment = null;

  if (!allowMethods(req, res, ['GET', 'POST'])) {
    return;
  }

  try {
    await ensureSchema();
    const user = await requireUser(req);

    if (req.method === 'GET') {
      const [rows, activityRows] = await Promise.all([
        sql`
          SELECT
            n.*,
            d.name AS department_name,
            u.full_name AS owner_name
          FROM ncr_cases n
          LEFT JOIN departments d ON d.id = n.department_id
          LEFT JOIN users u ON u.id = n.owner_id
          ORDER BY n.date DESC, n.created_at DESC
        `,
        sql`
          SELECT
            a.id,
            a.entity_id,
            a.action,
            a.message,
            a.actor_id,
            a.metadata,
            a.created_at,
            u.full_name AS actor_name
          FROM activity_logs a
          LEFT JOIN users u ON u.id = a.actor_id
          WHERE a.entity_type = 'ncr'
          ORDER BY a.created_at DESC
          LIMIT 500
        `
      ]);

      const historyByEntity = new Map();
      for (const row of activityRows) {
        const existing = historyByEntity.get(row.entity_id) || [];
        existing.push(serializeActivity(row));
        historyByEntity.set(row.entity_id, existing);
      }

      const hydratedRows = await resolveNcrAttachments(rows);

      sendJson(res, 200, {
        items: hydratedRows.map(row => serializeNcr(row, historyByEntity.get(row.id) || []))
      });
      return;
    }

    assertRole(user, ['admin', 'engineer']);

    const body = await readJson(req);
    const description = String(body.description || '').trim();
    const caseNumber = String(body.caseNumber || '').trim();
    const status = ['Open', 'In Progress', 'Closed'].includes(body.status)
      ? body.status
      : 'Open';
    const category = ['Process', 'Product', 'Supplier', 'Customer', 'Safety', 'Documentation'].includes(body.category)
      ? body.category
      : 'Process';
    const source = ['Internal', 'Customer', 'Audit', 'Supplier', 'Production', 'Field'].includes(body.source)
      ? body.source
      : 'Internal';
    const priority = ['Low', 'Medium', 'High', 'Critical'].includes(body.priority)
      ? body.priority
      : 'Medium';
    const severity = ['Minor', 'Major', 'Critical'].includes(body.severity)
      ? body.severity
      : 'Major';
    const verificationStatus = ['Pending', 'Ready', 'Verified'].includes(body.verificationStatus)
      ? body.verificationStatus
      : 'Pending';

    if (!caseNumber || !description) {
      const error = new Error('رقم الحالة والوصف حقول مطلوبة.');
      error.status = 400;
      throw error;
    }

    const ncrId = generateId();
    const attachedDocument = await uploadAttachmentObject(ncrId, body.attachedDocument || null);
    uploadedAttachment = attachedDocument;

    const [created] = await sql`
      INSERT INTO ncr_cases (
        id,
        case_number,
        sub_case,
        description,
        status,
        step,
        category,
        source,
        priority,
        severity,
        verification_status,
        due_date,
        containment_action,
        root_cause,
        corrective_action,
        tags,
        checklist,
        owner_id,
        department_id,
        color_code,
        attached_document,
        source_mode,
        created_by,
        updated_by,
        date
      )
      VALUES (
        ${ncrId},
        ${caseNumber},
        ${String(body.subCase || '').trim() || null},
        ${description},
        ${status},
        ${Number.parseInt(body.step, 10) || 1},
        ${category},
        ${source},
        ${priority},
        ${severity},
        ${verificationStatus},
        ${normalizeDate(body.dueDate)},
        ${String(body.containmentAction || '').trim() || null},
        ${String(body.rootCause || '').trim() || null},
        ${String(body.correctiveAction || '').trim() || null},
        ${normalizeTags(body.tags)},
        ${normalizeChecklist(body.checklist)},
        ${body.ownerId || null},
        ${body.departmentId || null},
        ${String(body.colorCode || '#3b82f6')},
        ${attachedDocument},
        ${'remote'},
        ${user.id},
        ${user.id},
        ${normalizeDate(body.date) || new Date()}
      )
      RETURNING
        *,
        NULL::TEXT AS department_name,
        NULL::TEXT AS owner_name
    `;

    await logActivity({
      entityType: 'ncr',
      entityId: created.id,
      action: 'ncr.created',
      message: `تم إنشاء التقرير ${caseNumber}.`,
      actorId: user.id,
      metadata: {
        status,
        category,
        source,
        priority,
        severity,
        verificationStatus
      }
    });

    const hydratedCreated = await resolveNcrAttachment(created);

    sendJson(res, 201, {
      item: serializeNcr(hydratedCreated, [])
    });
  } catch (error) {
    if (uploadedAttachment) {
      await deleteAttachmentObject(uploadedAttachment).catch(() => {});
    }
    sendError(res, error);
  }
};
