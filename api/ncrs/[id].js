'use strict';

const { sql, ensureSchema, generateId, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson, getPathId } = require('../_lib/http');
const { requireUser, assertRole } = require('../_lib/auth');
const { serializeNcr } = require('../_lib/models');
const { deleteAttachmentObject, resolveNcrAttachment, uploadAttachmentObject } = require('../_lib/storage');

function normalizeTags(value) {
  if (value === undefined) {
    return undefined;
  }

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
  if (value === undefined) {
    return undefined;
  }

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
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

module.exports = async (req, res) => {
  let uploadedAttachment = null;

  if (!allowMethods(req, res, ['GET', 'PATCH', 'DELETE'])) {
    return;
  }

  try {
    await ensureSchema();
    const user = await requireUser(req);
    const id = getPathId(req);

    if (!id) {
      const error = new Error('معرف التقرير مفقود.');
      error.status = 400;
      throw error;
    }

    if (req.method === 'GET') {
      const [row] = await sql`
        SELECT
          n.*,
          d.name AS department_name,
          u.full_name AS owner_name
        FROM ncr_cases n
        LEFT JOIN departments d ON d.id = n.department_id
        LEFT JOIN users u ON u.id = n.owner_id
        WHERE n.id = ${id}
        LIMIT 1
      `;

      if (!row) {
        const error = new Error('التقرير غير موجود.');
        error.status = 404;
        throw error;
      }

      const hydratedRow = await resolveNcrAttachment(row);

      sendJson(res, 200, {
        item: serializeNcr(hydratedRow, [])
      });
      return;
    }

    assertRole(user, ['admin', 'engineer']);

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const [existing] = await sql`
        SELECT *
        FROM ncr_cases
        WHERE id = ${id}
        LIMIT 1
      `;

      if (!existing) {
        const error = new Error('التقرير غير موجود.');
        error.status = 404;
        throw error;
      }

      const nextAttachment = body.attachedDocument !== undefined
        ? await uploadAttachmentObject(id, body.attachedDocument || null)
        : existing.attached_document;

      if (
        body.attachedDocument !== undefined &&
        nextAttachment &&
        nextAttachment.path &&
        nextAttachment.path !== existing.attached_document?.path
      ) {
        uploadedAttachment = nextAttachment;
      }

      const nextValues = {
        caseNumber: body.caseNumber !== undefined ? String(body.caseNumber).trim() : existing.case_number,
        subCase: body.subCase !== undefined ? String(body.subCase).trim() || null : existing.sub_case,
        description: body.description !== undefined ? String(body.description).trim() : existing.description,
        status: body.status !== undefined ? body.status : existing.status,
        step: body.step !== undefined ? Number.parseInt(body.step, 10) || 1 : existing.step,
        category: body.category !== undefined ? body.category : existing.category,
        source: body.source !== undefined ? body.source : existing.source,
        priority: body.priority !== undefined ? body.priority : existing.priority,
        severity: body.severity !== undefined ? body.severity : existing.severity,
        verificationStatus: body.verificationStatus !== undefined ? body.verificationStatus : existing.verification_status,
        dueDate: body.dueDate !== undefined ? normalizeDate(body.dueDate) : existing.due_date,
        containmentAction: body.containmentAction !== undefined ? String(body.containmentAction).trim() || null : existing.containment_action,
        rootCause: body.rootCause !== undefined ? String(body.rootCause).trim() || null : existing.root_cause,
        correctiveAction: body.correctiveAction !== undefined ? String(body.correctiveAction).trim() || null : existing.corrective_action,
        tags: body.tags !== undefined ? normalizeTags(body.tags) : existing.tags,
        checklist: body.checklist !== undefined ? normalizeChecklist(body.checklist) : existing.checklist,
        ownerId: body.ownerId !== undefined ? body.ownerId || null : existing.owner_id,
        departmentId: body.departmentId !== undefined ? body.departmentId || null : existing.department_id,
        colorCode: body.colorCode !== undefined ? body.colorCode : existing.color_code,
        attachedDocument: nextAttachment
      };

      const [updated] = await sql`
        UPDATE ncr_cases
        SET
          case_number = ${nextValues.caseNumber},
          sub_case = ${nextValues.subCase},
          description = ${nextValues.description},
          status = ${nextValues.status},
          step = ${nextValues.step},
          category = ${nextValues.category},
          source = ${nextValues.source},
          priority = ${nextValues.priority},
          severity = ${nextValues.severity},
          verification_status = ${nextValues.verificationStatus},
          due_date = ${nextValues.dueDate},
          containment_action = ${nextValues.containmentAction},
          root_cause = ${nextValues.rootCause},
          corrective_action = ${nextValues.correctiveAction},
          tags = ${nextValues.tags},
          checklist = ${nextValues.checklist},
          owner_id = ${nextValues.ownerId},
          department_id = ${nextValues.departmentId},
          color_code = ${nextValues.colorCode},
          attached_document = ${nextValues.attachedDocument},
          updated_by = ${user.id},
          updated_at = NOW()
        WHERE id = ${id}
        RETURNING
          *,
          NULL::TEXT AS department_name,
          NULL::TEXT AS owner_name
      `;

      await logActivity({
        entityType: 'ncr',
        entityId: id,
        action: 'ncr.updated',
        message: `تم تحديث التقرير ${updated.case_number}.`,
        actorId: user.id,
        metadata: {
          status: updated.status,
          category: updated.category,
          source: updated.source,
          priority: updated.priority,
          severity: updated.severity,
          verificationStatus: updated.verification_status,
          checklistCompleted: Array.isArray(updated.checklist)
            ? updated.checklist.filter(item => item.done).length
            : 0
        }
      });

      const hydratedUpdated = await resolveNcrAttachment(updated);

      if (
        body.attachedDocument !== undefined &&
        existing.attached_document &&
        existing.attached_document.path !== nextValues.attachedDocument?.path
      ) {
        await deleteAttachmentObject(existing.attached_document).catch(() => {});
      }

      uploadedAttachment = null;

      sendJson(res, 200, {
        item: serializeNcr(hydratedUpdated, [])
      });
      return;
    }

    const [deleted] = await sql`
      DELETE FROM ncr_cases
      WHERE id = ${id}
      RETURNING
        *,
        NULL::TEXT AS department_name,
        NULL::TEXT AS owner_name
    `;

    if (!deleted) {
      const error = new Error('التقرير غير موجود.');
      error.status = 404;
      throw error;
    }

    await deleteAttachmentObject(deleted.attached_document).catch(() => {});

    await logActivity({
      entityType: 'ncr',
      entityId: id,
      action: 'ncr.deleted',
      message: `تم حذف التقرير ${deleted.case_number}.`,
      actorId: user.id
    });

    sendJson(res, 200, {
      item: serializeNcr(deleted, [])
    });
  } catch (error) {
    if (uploadedAttachment) {
      await deleteAttachmentObject(uploadedAttachment).catch(() => {});
    }
    sendError(res, error);
  }
};
