'use strict';

const { sql, ensureSchema, logActivity } = require('../_lib/db');
const { allowMethods, sendJson, sendError, readJson, getPathId } = require('../_lib/http');
const { requireUser, assertRole } = require('../_lib/auth');
const { serializeNcr } = require('../_lib/models');

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

      sendJson(res, 200, {
        item: serializeNcr(row, [])
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

      const nextValues = {
        caseNumber: body.caseNumber !== undefined ? String(body.caseNumber).trim() : existing.case_number,
        subCase: body.subCase !== undefined ? String(body.subCase).trim() || null : existing.sub_case,
        description: body.description !== undefined ? String(body.description).trim() : existing.description,
        status: body.status !== undefined ? body.status : existing.status,
        step: body.step !== undefined ? Number.parseInt(body.step, 10) || 1 : existing.step,
        priority: body.priority !== undefined ? body.priority : existing.priority,
        severity: body.severity !== undefined ? body.severity : existing.severity,
        dueDate: body.dueDate !== undefined ? normalizeDate(body.dueDate) : existing.due_date,
        rootCause: body.rootCause !== undefined ? String(body.rootCause).trim() || null : existing.root_cause,
        correctiveAction: body.correctiveAction !== undefined ? String(body.correctiveAction).trim() || null : existing.corrective_action,
        tags: body.tags !== undefined ? normalizeTags(body.tags) : existing.tags,
        ownerId: body.ownerId !== undefined ? body.ownerId || null : existing.owner_id,
        departmentId: body.departmentId !== undefined ? body.departmentId || null : existing.department_id,
        colorCode: body.colorCode !== undefined ? body.colorCode : existing.color_code,
        attachedDocument: body.attachedDocument !== undefined ? body.attachedDocument : existing.attached_document
      };

      const [updated] = await sql`
        UPDATE ncr_cases
        SET
          case_number = ${nextValues.caseNumber},
          sub_case = ${nextValues.subCase},
          description = ${nextValues.description},
          status = ${nextValues.status},
          step = ${nextValues.step},
          priority = ${nextValues.priority},
          severity = ${nextValues.severity},
          due_date = ${nextValues.dueDate},
          root_cause = ${nextValues.rootCause},
          corrective_action = ${nextValues.correctiveAction},
          tags = ${nextValues.tags},
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

      if (!updated) {
        const error = new Error('التقرير غير موجود.');
        error.status = 404;
        throw error;
      }

      await logActivity({
        entityType: 'ncr',
        entityId: id,
        action: 'ncr.updated',
        message: `تم تحديث التقرير ${updated.case_number}.`,
        actorId: user.id,
        metadata: {
          status: updated.status,
          priority: updated.priority,
          severity: updated.severity
        }
      });

      sendJson(res, 200, {
        item: serializeNcr(updated, [])
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
    sendError(res, error);
  }
};
