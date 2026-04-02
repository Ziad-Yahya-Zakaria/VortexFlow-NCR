'use strict';

function toMillis(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function sanitizeUser(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role,
    jobTitle: row.job_title || null,
    isVerified: !!row.is_verified,
    isActive: row.is_active,
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
    lastLoginAt: toMillis(row.last_login_at)
  };
}

function serializeDepartment(row) {
  return {
    id: row.id,
    name: row.name,
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at)
  };
}

function serializeInvitation(row) {
  return {
    id: row.id,
    caseId: row.case_id,
    departmentId: row.department_id,
    assignee: row.assignee,
    invitationStatus: row.invitation_status,
    caseNumber: row.case_number || null,
    departmentName: row.department_name || null,
    createdAt: toMillis(row.created_at)
  };
}

function serializeActivity(row) {
  return {
    id: row.id,
    action: row.action,
    message: row.message,
    actorId: row.actor_id,
    actorName: row.actor_name || null,
    metadata: row.metadata || {},
    createdAt: toMillis(row.created_at)
  };
}

function serializeNcr(row, history = []) {
  return {
    id: row.id,
    caseNumber: row.case_number,
    subCase: row.sub_case || '',
    description: row.description,
    status: row.status,
    step: row.step,
    category: row.category || 'Process',
    source: row.source || 'Internal',
    priority: row.priority,
    severity: row.severity,
    verificationStatus: row.verification_status || 'Pending',
    dueDate: toMillis(row.due_date),
    containmentAction: row.containment_action || '',
    rootCause: row.root_cause || '',
    correctiveAction: row.corrective_action || '',
    tags: Array.isArray(row.tags) ? row.tags : [],
    checklist: Array.isArray(row.checklist) ? row.checklist : [],
    ownerId: row.owner_id,
    ownerName: row.owner_name || null,
    departmentId: row.department_id,
    departmentName: row.department_name || null,
    colorCode: row.color_code,
    attachedDocument: row.attached_document || null,
    sourceMode: row.source_mode,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    date: toMillis(row.date),
    createdAt: toMillis(row.created_at),
    updatedAt: toMillis(row.updated_at),
    history
  };
}

module.exports = {
  sanitizeUser,
  serializeDepartment,
  serializeInvitation,
  serializeActivity,
  serializeNcr
};
