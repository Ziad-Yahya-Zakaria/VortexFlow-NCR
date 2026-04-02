/* ============================================================
   VortexFlow NCR — app.js
   Full Application Logic | Offline-First PWA
   ZiadPWA Ecosystem
   ============================================================ */

'use strict';

/* ============================================================
   SECTION 1: CONFIGURATION & CONSTANTS
   ============================================================ */
const APP_CONFIG = {
  version: '1.0.0',
  appName: 'VortexFlow NCR',
  storageName: 'VortexFlowNCR',
  firstVisitKey: 'vf_ncr_first_visit_done',
  enableSampleData: false,
  SLA_WARNING_DAYS: 3,
  SLA_CRITICAL_DAYS: 5,
  MONTHS_AR: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],
  MONTHS_EN: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],
  STATUS_LABELS: { 'Open': 'مفتوح', 'In Progress': 'قيد العمل', 'Closed': 'مغلق' },
};

/* ============================================================
   SECTION 2: LOCALFORAGE INSTANCES (DB Collections)
   ============================================================ */
const ncrStore = localforage.createInstance({
  name: APP_CONFIG.storageName,
  storeName: 'NCR_Cases',
  description: 'Non-Conformance Report Cases'
});

const deptStore = localforage.createInstance({
  name: APP_CONFIG.storageName,
  storeName: 'Departments',
  description: 'Department Records'
});

const invStore = localforage.createInstance({
  name: APP_CONFIG.storageName,
  storeName: 'Invitations',
  description: 'Case Invitations'
});

/* ============================================================
   SECTION 3: APPLICATION STATE
   ============================================================ */
const state = {
  view: 'dashboard',
  ncrs: [],
  departments: [],
  invitations: [],
  filter: {
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
    status: 'all',
    search: ''
  },
  editingNCRId: null,
  detailNCRId: null,
  inviteNCRId: null,
  fileData: null,    // { name, type, base64 }
  isSubmitting: false,
};

/* ============================================================
   SECTION 4: UTILITY FUNCTIONS
   ============================================================ */

/** Generate a UUID v4 */
function generateId() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Generate case number: NCR-YYYY-NNNN */
function generateCaseNumber() {
  const year = new Date().getFullYear();
  const seq = (state.ncrs.length + 1).toString().padStart(4, '0');
  return `NCR-${year}-${seq}`;
}

/** Calculate elapsed days from a timestamp */
function calculateElapsedDays(timestamp) {
  if (!timestamp) return 0;
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  return Math.max(0, Math.floor(diff / (1000 * 60 * 60 * 24)));
}

/** Format a timestamp to locale date string */
function formatDate(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleDateString('ar-EG', {
    year: 'numeric', month: 'short', day: 'numeric'
  });
}

/** Format a timestamp to full datetime */
function formatDateTime(timestamp) {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleString('ar-EG', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

/** Convert a File object to Base64 string */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    if (!file) { resolve(null); return; }
    const maxSize = 10 * 1024 * 1024; // 10 MB limit
    if (file.size > maxSize) {
      reject(new Error('حجم الملف يتجاوز 10 ميجابايت'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve({
      name: file.name,
      type: file.type,
      size: file.size,
      base64: reader.result
    });
    reader.onerror = () => reject(new Error('فشل في قراءة الملف'));
    reader.readAsDataURL(file);
  });
}

function getAttachmentSource(attachedDocument) {
  return attachedDocument?.url || attachedDocument?.base64 || '';
}

/** Get SLA status object from elapsed days */
function getSLAStatus(days) {
  if (days > APP_CONFIG.SLA_CRITICAL_DAYS) {
    return { cls: 'sla-critical', label: `${days} أيام ⚠`, cardCls: 'sla-critical', icon: 'fa-circle-exclamation' };
  } else if (days > APP_CONFIG.SLA_WARNING_DAYS) {
    return { cls: 'sla-warning', label: `${days} أيام`, cardCls: 'sla-warning', icon: 'fa-circle-half-stroke' };
  }
  return { cls: 'sla-good', label: `${days} أيام`, cardCls: '', icon: 'fa-circle-check' };
}

/** Get status badge HTML */
function getStatusBadge(status) {
  const map = {
    'Open':        { cls: 'badge-blue',   icon: 'fa-circle-dot',   label: 'مفتوح' },
    'In Progress': { cls: 'badge-amber',  icon: 'fa-spinner',      label: 'قيد العمل' },
    'Closed':      { cls: 'badge-green',  icon: 'fa-circle-check', label: 'مغلق' },
  };
  const s = map[status] || { cls: 'badge-gray', icon: 'fa-circle', label: status || '?' };
  return `<span class="badge ${s.cls}"><i class="fas ${s.icon}" aria-hidden="true"></i>${s.label}</span>`;
}

/** Get initials from a name for avatar */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

/** Find department name by ID */
function getDeptName(deptId) {
  const dept = state.departments.find(d => d.id === deptId);
  return dept ? dept.name : '—';
}

/* ============================================================
   SECTION 5: DATABASE OPERATIONS (CRUD)
   ============================================================ */

/** Load ALL data from all stores into state */
async function loadAllData() {
  try {
    state.ncrs = [];
    state.departments = [];
    state.invitations = [];

    await ncrStore.iterate(value => { state.ncrs.push(value); });
    await deptStore.iterate(value => { state.departments.push(value); });
    await invStore.iterate(value => { state.invitations.push(value); });

    // Sort NCRs by date descending
    state.ncrs.sort((a, b) => (b.date || 0) - (a.date || 0));
    state.departments.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));

  } catch (err) {
    console.error('[VF] loadAllData error:', err);
    showToast('خطأ في تحميل البيانات', 'error');
  }
}

/** Save a new NCR case */
async function saveNCR(data) {
  const ncr = {
    id: generateId(),
    caseNumber: data.caseNumber || generateCaseNumber(),
    subCase: data.subCase || '',
    date: data.date || Date.now(),
    description: data.description,
    status: data.status,
    step: data.step || 1,
    elapsedDays: 0,
    colorCode: data.colorCode || '#3b82f6',
    departmentId: data.departmentId || null,
    attachedDocument: data.attachedDocument || null,
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  await ncrStore.setItem(ncr.id, ncr);
  state.ncrs.unshift(ncr);
  return ncr;
}

/** Update an existing NCR case */
async function updateNCR(id, updates) {
  const existing = await ncrStore.getItem(id);
  if (!existing) throw new Error('التقرير غير موجود');
  const updated = { ...existing, ...updates, updatedAt: Date.now() };
  await ncrStore.setItem(id, updated);
  const idx = state.ncrs.findIndex(n => n.id === id);
  if (idx !== -1) state.ncrs[idx] = updated;
  return updated;
}

/** Delete an NCR case */
async function deleteNCR(id) {
  await ncrStore.removeItem(id);
  state.ncrs = state.ncrs.filter(n => n.id !== id);
  // Also remove related invitations
  const relInvs = state.invitations.filter(i => i.caseId === id);
  for (const inv of relInvs) {
    await invStore.removeItem(inv.id);
  }
  state.invitations = state.invitations.filter(i => i.caseId !== id);
}

/** Save a new Department */
async function saveDepartment(name) {
  const dept = { id: generateId(), name: name.trim(), createdAt: Date.now() };
  await deptStore.setItem(dept.id, dept);
  state.departments.push(dept);
  state.departments.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
  return dept;
}

/** Update a Department */
async function updateDepartment(id, name) {
  const existing = await deptStore.getItem(id);
  if (!existing) throw new Error('القسم غير موجود');
  const updated = { ...existing, name: name.trim(), updatedAt: Date.now() };
  await deptStore.setItem(id, updated);
  const idx = state.departments.findIndex(d => d.id === id);
  if (idx !== -1) state.departments[idx] = updated;
  return updated;
}

/** Delete a Department */
async function deleteDepartment(id) {
  await deptStore.removeItem(id);
  state.departments = state.departments.filter(d => d.id !== id);
}

/** Save a new Invitation */
async function saveInvitation(data) {
  const inv = {
    id: generateId(),
    caseId: data.caseId,
    departmentId: data.departmentId,
    assignee: data.assignee,
    invitationStatus: data.invitationStatus || 'Update',
    createdAt: Date.now()
  };
  await invStore.setItem(inv.id, inv);
  state.invitations.push(inv);
  return inv;
}

/** Delete an Invitation */
async function deleteInvitation(id) {
  await invStore.removeItem(id);
  state.invitations = state.invitations.filter(i => i.id !== id);
}

/* ============================================================
   SECTION 6: FILTERING & COMPUTED DATA
   ============================================================ */

/** Get filtered + enriched NCRs based on current filter state */
function getFilteredNCRs() {
  const { month, year, status, search } = state.filter;
  return state.ncrs
    .map(ncr => ({
      ...ncr,
      elapsedDays: calculateElapsedDays(ncr.date)
    }))
    .filter(ncr => {
      const date = new Date(ncr.date);
      // Month filter
      if (month !== null && (date.getMonth() !== month || date.getFullYear() !== year)) return false;
      // Status filter
      if (status !== 'all' && ncr.status !== status) return false;
      // Search filter
      if (search) {
        const q = search.toLowerCase();
        const match =
          (ncr.caseNumber || '').toLowerCase().includes(q) ||
          (ncr.description || '').toLowerCase().includes(q) ||
          (ncr.subCase || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });
}

/** Compute stats from ALL NCRs (not filtered) */
function getStats() {
  const enriched = state.ncrs.map(n => ({ ...n, elapsedDays: calculateElapsedDays(n.date) }));
  return {
    total: enriched.length,
    open: enriched.filter(n => n.status === 'Open').length,
    inProgress: enriched.filter(n => n.status === 'In Progress').length,
    closed: enriched.filter(n => n.status === 'Closed').length,
    slaBreached: enriched.filter(n => n.elapsedDays > APP_CONFIG.SLA_CRITICAL_DAYS && n.status !== 'Closed').length,
  };
}

/* ============================================================
   SECTION 7: UI RENDERING
   ============================================================ */

/** Render the entire dashboard (stats + list) */
function renderDashboard() {
  renderStats();
  renderNCRList();
}

/** Update stats counters */
function renderStats() {
  const s = getStats();
  const el = id => document.getElementById(id);
  animateCounter(el('stat-total'), s.total);
  animateCounter(el('stat-open'), s.open);
  animateCounter(el('stat-progress'), s.inProgress);
  animateCounter(el('stat-closed'), s.closed);
}

/** Animate a counter element */
function animateCounter(el, target) {
  if (!el) return;
  const current = parseInt(el.textContent) || 0;
  if (current === target) return;
  const duration = 400;
  const start = Date.now();
  const tick = () => {
    const elapsed = Date.now() - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.round(current + (target - current) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Render the NCR list */
function renderNCRList() {
  const container = document.getElementById('ncr-list');
  if (!container) return;

  const ncrs = getFilteredNCRs();

  if (ncrs.length === 0) {
    container.innerHTML = `
      <div class="empty-state" role="status">
        <i class="fas fa-clipboard-list" aria-hidden="true"></i>
        <h3>لا توجد تقارير</h3>
        <p>لم يتم العثور على تقارير تطابق معايير البحث الحالية</p>
        <button class="btn btn-primary btn-sm" onclick="navigateTo('add-ncr')" style="margin-top:8px">
          <i class="fas fa-plus" aria-hidden="true"></i>
          إضافة أول تقرير
        </button>
      </div>`;
    return;
  }

  container.innerHTML = ncrs.map(ncr => renderNCRCard(ncr)).join('');
}

/** Render a single NCR card HTML */
function renderNCRCard(ncr) {
  const sla = getSLAStatus(ncr.elapsedDays);
  const accentClass = ncr.status === 'Open' ? 'status-open'
    : ncr.status === 'In Progress' ? 'status-progress'
    : 'status-closed';
  const isCritical = ncr.elapsedDays > APP_CONFIG.SLA_CRITICAL_DAYS && ncr.status !== 'Closed';
  const cardClass = isCritical ? 'sla-critical' : (ncr.elapsedDays > APP_CONFIG.SLA_WARNING_DAYS && ncr.status !== 'Closed' ? 'sla-warning' : '');
  const accentFinal = isCritical ? 'sla-critical' : accentClass;
  const deptName = getDeptName(ncr.departmentId);
  const hasAttach = !!(ncr.attachedDocument);

  return `
  <article class="ncr-card ${cardClass}" role="listitem" data-id="${ncr.id}">
    ${hasAttach ? `<div class="has-attachment-indicator" title="يحتوي على مرفق" aria-label="يحتوي على مرفق"></div>` : ''}
    <div class="ncr-card-accent ${accentFinal}" role="presentation"></div>
    <div class="ncr-card-body">
      <div class="ncr-card-header">
        <div>
          <div class="ncr-case-number">${escapeHTML(ncr.caseNumber)}</div>
          ${ncr.subCase ? `<div class="ncr-subcase">الفرعية: ${escapeHTML(ncr.subCase)}</div>` : ''}
          <div class="ncr-subcase" style="margin-top:2px">${formatDate(ncr.date)}</div>
        </div>
        <div class="ncr-badges">
          ${getStatusBadge(ncr.status)}
          <span class="sla-badge ${sla.cls}" title="أيام الانقضاء">
            <i class="fas ${sla.icon}" aria-hidden="true"></i>
            ${sla.label}
          </span>
        </div>
      </div>
      <p class="ncr-description">${escapeHTML(ncr.description)}</p>
      <div class="ncr-meta">
        ${ncr.step ? `<span class="ncr-meta-item"><i class="fas fa-layer-group" aria-hidden="true"></i>خطوة ${ncr.step}</span>` : ''}
        ${ncr.departmentId ? `<span class="ncr-meta-item"><i class="fas fa-building" aria-hidden="true"></i>${escapeHTML(deptName)}</span>` : ''}
        ${hasAttach ? `<span class="ncr-meta-item" style="color:var(--vf-cyan)"><i class="fas fa-paperclip" aria-hidden="true"></i>مرفق</span>` : ''}
        <span class="ncr-meta-item" style="margin-right:auto;display:flex;align-items:center;gap:4px">
          <span style="width:8px;height:8px;border-radius:50%;background:${escapeHTML(ncr.colorCode || '#3b82f6')};display:inline-block"></span>
        </span>
      </div>
    </div>
    <div class="ncr-card-footer">
      <button class="card-action-btn edit" onclick="editNCR('${ncr.id}')" aria-label="تعديل التقرير">
        <i class="fas fa-pen" aria-hidden="true"></i>تعديل
      </button>
      <button class="card-action-btn invite" onclick="openInviteModal('${ncr.id}')" aria-label="إرسال دعوة">
        <i class="fas fa-envelope" aria-hidden="true"></i>دعوة
      </button>
      <button class="card-action-btn share" onclick="shareNCR('${ncr.id}')" aria-label="مشاركة">
        <i class="fas fa-share-alt" aria-hidden="true"></i>مشاركة
      </button>
      <button class="card-action-btn" onclick="openNCRDetail('${ncr.id}')" aria-label="عرض التفاصيل" style="color:var(--vf-text-muted)">
        <i class="fas fa-eye" aria-hidden="true"></i>
      </button>
      <button class="card-action-btn delete" onclick="confirmDeleteNCR('${ncr.id}')" aria-label="حذف التقرير">
        <i class="fas fa-trash" aria-hidden="true"></i>
      </button>
    </div>
  </article>`;
}

/** Render departments list */
function renderDepartments() {
  renderDeptList();
  renderInvitations();
  populateDeptSelects();
}

/** Render department cards */
function renderDeptList() {
  const container = document.getElementById('dept-list');
  if (!container) return;

  if (state.departments.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fas fa-building-circle-xmark" aria-hidden="true"></i>
        <h3>لا توجد أقسام</h3>
        <p>أضف قسماً جديداً باستخدام النموذج أعلاه</p>
      </div>`;
    return;
  }

  container.innerHTML = state.departments.map(dept => {
    const invCount = state.invitations.filter(i => i.departmentId === dept.id).length;
    return `
    <div class="dept-card" role="listitem">
      <div class="dept-icon"><i class="fas fa-building" aria-hidden="true"></i></div>
      <div class="dept-info">
        <div class="dept-name">${escapeHTML(dept.name)}</div>
        <div class="dept-inv-count">${invCount} دعوة مرتبطة</div>
      </div>
      <div class="dept-actions">
        <button class="icon-btn" onclick="editDept('${dept.id}', '${escapeHTML(dept.name)}')" aria-label="تعديل القسم" title="تعديل">
          <i class="fas fa-pen" aria-hidden="true"></i>
        </button>
        <button class="icon-btn" onclick="confirmDeleteDept('${dept.id}')" aria-label="حذف القسم" title="حذف" style="color:var(--vf-red)">
          <i class="fas fa-trash" aria-hidden="true"></i>
        </button>
      </div>
    </div>`;
  }).join('');
}

/** Render invitations list */
function renderInvitations() {
  const container = document.getElementById('inv-list');
  if (!container) return;

  if (state.invitations.length === 0) {
    container.innerHTML = `<p class="text-subtle fs-xs" style="padding:8px 0">لا توجد دعوات مسجلة بعد.</p>`;
    return;
  }

  const sorted = [...state.invitations].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  container.innerHTML = sorted.map(inv => {
    const ncr = state.ncrs.find(n => n.id === inv.caseId);
    const dept = state.departments.find(d => d.id === inv.departmentId);
    const statusCls = inv.invitationStatus === 'Cancel' ? 'inv-status-cancel' : 'inv-status-update';
    return `
    <div class="inv-card" role="listitem">
      <div class="inv-avatar">${getInitials(inv.assignee)}</div>
      <div class="inv-info">
        <div class="inv-assignee">${escapeHTML(inv.assignee)}</div>
        <div class="inv-case">
          ${ncr ? escapeHTML(ncr.caseNumber) : 'حالة محذوفة'} 
          ${dept ? '— ' + escapeHTML(dept.name) : ''}
        </div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
        <span class="${statusCls}">${inv.invitationStatus}</span>
        <button class="icon-btn" onclick="confirmDeleteInvitation('${inv.id}')" style="width:24px;height:24px;font-size:11px;color:var(--vf-text-subtle)" aria-label="حذف الدعوة">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
      </div>
    </div>`;
  }).join('');
}

/** Populate department <select> dropdowns */
function populateDeptSelects() {
  const selects = ['f-department', 'inv-dept-select'];
  selects.forEach(selectId => {
    const select = document.getElementById(selectId);
    if (!select) return;
    const currentVal = select.value;
    const options = state.departments.map(d =>
      `<option value="${d.id}">${escapeHTML(d.name)}</option>`
    ).join('');
    const defaultOpt = selectId === 'f-department'
      ? `<option value="">-- لا يوجد --</option>`
      : `<option value="">-- اختر القسم --</option>`;
    select.innerHTML = defaultOpt + options;
    if (currentVal) select.value = currentVal;
  });
}

/** Render month filter chips */
function renderMonthFilter() {
  const container = document.getElementById('month-selector');
  if (!container) return;

  const currentYear = new Date().getFullYear();
  let html = `<button class="month-chip ${state.filter.month === null ? 'active' : ''}" 
    onclick="setMonthFilter(null, null, this)">الكل</button>`;

  // Show last 12 months
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const m = d.getMonth();
    const y = d.getFullYear();
    const isActive = state.filter.month === m && state.filter.year === y;
    html += `<button class="month-chip ${isActive ? 'active' : ''}"
      onclick="setMonthFilter(${m}, ${y}, this)">${APP_CONFIG.MONTHS_AR[m]}${y !== currentYear ? ' ' + y : ''}</button>`;
  }

  container.innerHTML = html;
}

/* ============================================================
   SECTION 8: NAVIGATION
   ============================================================ */

function navigateTo(view) {
  // Update state
  state.view = view;

  // Hide all views
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  // Show target view
  const targetView = document.getElementById(`view-${view}`);
  if (targetView) targetView.classList.add('active');

  // Update nav items
  document.querySelectorAll('.nav-item').forEach(item => {
    const isActive = item.dataset.view === view;
    item.classList.toggle('active', isActive);
    item.setAttribute('aria-current', isActive ? 'page' : 'false');
  });

  // Show/hide FAB
  const fab = document.getElementById('fab');
  if (fab) {
    fab.classList.toggle('hidden', view !== 'dashboard');
  }

  // Render the view
  if (view === 'dashboard') renderDashboard();
  else if (view === 'departments') renderDepartments();
  else if (view === 'add-ncr') prepareAddNCRForm();

  // Scroll to top
  const mainContent = document.getElementById('main-content');
  if (mainContent) mainContent.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ============================================================
   SECTION 9: FORM HANDLING
   ============================================================ */

function prepareAddNCRForm() {
  if (!state.editingNCRId) {
    // New NCR - reset form
    document.getElementById('ncr-form').reset();
    document.getElementById('f-case-number').value = generateCaseNumber();
    document.getElementById('f-editing-id').value = '';
    document.getElementById('form-view-label').textContent = 'إضافة تقرير جديد';
    document.getElementById('form-view-heading').textContent = 'تقرير عدم مطابقة NCR';
    document.getElementById('submit-btn-text').textContent = 'حفظ التقرير';
    document.getElementById('file-preview-container').innerHTML = '';
    state.fileData = null;
  }
  populateDeptSelects();
}

async function handleNCRFormSubmit(event) {
  event.preventDefault();
  if (state.isSubmitting) return;

  const form = event.target;
  if (!form.checkValidity()) {
    form.querySelectorAll(':invalid')[0]?.focus();
    showToast('يرجى ملء الحقول المطلوبة', 'warning');
    return;
  }

  state.isSubmitting = true;
  const submitBtn = document.getElementById('btn-submit-ncr');
  const originalHTML = submitBtn.innerHTML;
  submitBtn.innerHTML = `<span class="spinner"></span> جارٍ الحفظ...`;
  submitBtn.disabled = true;

  try {
    const data = {
      caseNumber: document.getElementById('f-case-number').value.trim(),
      subCase: document.getElementById('f-sub-case').value.trim(),
      description: document.getElementById('f-description').value.trim(),
      status: document.getElementById('f-status').value,
      step: parseInt(document.getElementById('f-step').value) || 1,
      colorCode: document.getElementById('f-color').value,
      departmentId: document.getElementById('f-department').value || null,
      attachedDocument: state.fileData || null,
    };

    const editingId = document.getElementById('f-editing-id').value;

    if (editingId) {
      await updateNCR(editingId, data);
      showToast('تم تحديث التقرير بنجاح', 'success');
      state.editingNCRId = null;
    } else {
      await saveNCR(data);
      showToast('تم حفظ التقرير بنجاح', 'success');
    }

    // Reset form and navigate
    form.reset();
    state.fileData = null;
    document.getElementById('file-preview-container').innerHTML = '';
    document.getElementById('f-editing-id').value = '';
    state.editingNCRId = null;

    navigateTo('dashboard');

  } catch (err) {
    console.error('[VF] Save NCR error:', err);
    showToast(`خطأ في الحفظ: ${err.message}`, 'error');
  } finally {
    state.isSubmitting = false;
    submitBtn.innerHTML = originalHTML;
    submitBtn.disabled = false;
  }
}

function cancelNCRForm() {
  state.editingNCRId = null;
  document.getElementById('f-editing-id').value = '';
  document.getElementById('ncr-form').reset();
  state.fileData = null;
  document.getElementById('file-preview-container').innerHTML = '';
  navigateTo('dashboard');
}

/** Load NCR data into edit form */
function editNCR(id) {
  const ncr = state.ncrs.find(n => n.id === id);
  if (!ncr) { showToast('التقرير غير موجود', 'error'); return; }

  state.editingNCRId = id;
  closeNCRDetailModal();

  // Populate form
  document.getElementById('f-case-number').value = ncr.caseNumber || '';
  document.getElementById('f-sub-case').value = ncr.subCase || '';
  document.getElementById('f-description').value = ncr.description || '';
  document.getElementById('f-status').value = ncr.status || 'Open';
  document.getElementById('f-step').value = ncr.step || '';
  document.getElementById('f-color').value = ncr.colorCode || '#3b82f6';
  document.getElementById('f-editing-id').value = id;
  document.getElementById('form-view-label').textContent = 'تعديل التقرير';
  document.getElementById('form-view-heading').textContent = ncr.caseNumber || 'تعديل';
  document.getElementById('submit-btn-text').textContent = 'تحديث التقرير';

  // Handle existing attachment
  if (ncr.attachedDocument) {
    state.fileData = ncr.attachedDocument;
    renderFilePreview(ncr.attachedDocument.name, ncr.attachedDocument.size);
  } else {
    state.fileData = null;
    document.getElementById('file-preview-container').innerHTML = '';
  }

  populateDeptSelects();
  if (ncr.departmentId) document.getElementById('f-department').value = ncr.departmentId;

  navigateTo('add-ncr');
}

/** Quick Add from FAB */
function quickAddNCR() {
  state.editingNCRId = null;
  navigateTo('add-ncr');
}

/* ============================================================
   SECTION 10: FILE HANDLING
   ============================================================ */

async function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;

  const dropZone = document.getElementById('file-drop-zone');
  dropZone.style.opacity = '0.6';

  try {
    const fileObj = await fileToBase64(file);
    state.fileData = fileObj;
    renderFilePreview(file.name, file.size);
    showToast(`تم تحميل الملف: ${file.name}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
    state.fileData = null;
  } finally {
    dropZone.style.opacity = '1';
    // Reset file input
    event.target.value = '';
  }
}

function renderFilePreview(name, size) {
  const container = document.getElementById('file-preview-container');
  const sizeStr = size ? `(${(size / 1024).toFixed(1)} KB)` : '';
  container.innerHTML = `
    <div class="file-preview">
      <i class="fas fa-file-check" aria-hidden="true"></i>
      <span class="file-name">${escapeHTML(name)} ${sizeStr}</span>
      <button class="remove-file" onclick="removeFile()" aria-label="إزالة الملف" type="button">
        <i class="fas fa-times" aria-hidden="true"></i>
      </button>
    </div>`;
}

function removeFile() {
  state.fileData = null;
  document.getElementById('file-preview-container').innerHTML = '';
  document.getElementById('f-attachment').value = '';
}

function setColorPreset(color, el) {
  document.getElementById('f-color').value = color;
  document.querySelectorAll('.color-preset').forEach(p => p.classList.remove('selected'));
  el.classList.add('selected');
}

/* ============================================================
   SECTION 11: FILTER HANDLERS
   ============================================================ */

function setStatusFilter(status, el) {
  state.filter.status = status;
  document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
  if (el) el.classList.add('active');
  renderNCRList();
  renderStats();
}

function setMonthFilter(month, year, el) {
  state.filter.month = month;
  state.filter.year = year || new Date().getFullYear();
  document.querySelectorAll('.month-chip').forEach(c => c.classList.remove('active'));
  if (el) el.classList.add('active');
  renderNCRList();
  renderStats();
}

function handleSearch(value) {
  state.filter.search = value;
  renderNCRList();
}

/* ============================================================
   SECTION 12: MODAL MANAGEMENT
   ============================================================ */

function openNCRDetail(id) {
  const ncr = state.ncrs.find(n => n.id === id);
  if (!ncr) return;

  state.detailNCRId = id;
  const enriched = { ...ncr, elapsedDays: calculateElapsedDays(ncr.date) };
  const sla = getSLAStatus(enriched.elapsedDays);
  const deptName = getDeptName(ncr.departmentId);
  const invitations = state.invitations.filter(i => i.caseId === id);

  document.getElementById('detail-modal-title').textContent = 'تفاصيل التقرير';
  document.getElementById('detail-modal-case-num').textContent = ncr.caseNumber;

  let attachHTML = '';
  if (ncr.attachedDocument) {
    const isImg = ncr.attachedDocument.type && ncr.attachedDocument.type.startsWith('image/');
    const attachmentSrc = getAttachmentSource(ncr.attachedDocument);
    attachHTML = isImg
      ? `<img src="${attachmentSrc}" alt="مرفق" class="attachment-preview" loading="lazy">`
      : `<a href="${attachmentSrc}" download="${escapeHTML(ncr.attachedDocument.name)}" 
           class="btn btn-secondary btn-sm" style="display:inline-flex">
           <i class="fas fa-download" aria-hidden="true"></i>${escapeHTML(ncr.attachedDocument.name)}
         </a>`;
  }

  let invHTML = '';
  if (invitations.length > 0) {
    invHTML = `
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-envelope" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">الدعوات</div>
          ${invitations.map(inv => {
            const dept = state.departments.find(d => d.id === inv.departmentId);
            return `<div class="detail-field-value" style="margin-bottom:4px">
              ${escapeHTML(inv.assignee)} — ${dept ? escapeHTML(dept.name) : '؟'}
              <span class="${inv.invitationStatus === 'Cancel' ? 'inv-status-cancel' : 'inv-status-update'}" style="font-size:10px;padding:1px 6px;border-radius:8px;margin-right:6px">${inv.invitationStatus}</span>
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  document.getElementById('detail-modal-body').innerHTML = `
    <div class="detail-field">
      <div class="detail-field-icon"><i class="fas fa-circle-dot" aria-hidden="true"></i></div>
      <div>
        <div class="detail-field-label">الحالة</div>
        <div class="detail-field-value">${getStatusBadge(ncr.status)}</div>
      </div>
    </div>
    <div class="detail-field">
      <div class="detail-field-icon"><i class="fas fa-clock" aria-hidden="true"></i></div>
      <div>
        <div class="detail-field-label">مؤشر SLA</div>
        <div class="detail-field-value">
          <span class="sla-badge ${sla.cls}">
            <i class="fas ${sla.icon}" aria-hidden="true"></i>${sla.label}
          </span>
        </div>
      </div>
    </div>
    <div class="detail-field">
      <div class="detail-field-icon"><i class="fas fa-align-right" aria-hidden="true"></i></div>
      <div>
        <div class="detail-field-label">الوصف</div>
        <div class="detail-field-value">${escapeHTML(ncr.description)}</div>
      </div>
    </div>
    <div class="detail-field">
      <div class="detail-field-icon"><i class="fas fa-calendar" aria-hidden="true"></i></div>
      <div>
        <div class="detail-field-label">تاريخ الإنشاء</div>
        <div class="detail-field-value" dir="ltr" style="text-align:right">${formatDateTime(ncr.date)}</div>
      </div>
    </div>
    ${ncr.subCase ? `
    <div class="detail-field">
      <div class="detail-field-icon"><i class="fas fa-hashtag" aria-hidden="true"></i></div>
      <div>
        <div class="detail-field-label">الحالة الفرعية</div>
        <div class="detail-field-value">${escapeHTML(ncr.subCase)}</div>
      </div>
    </div>` : ''}
    ${ncr.step ? `
    <div class="detail-field">
      <div class="detail-field-icon"><i class="fas fa-layer-group" aria-hidden="true"></i></div>
      <div>
        <div class="detail-field-label">الخطوة</div>
        <div class="detail-field-value">${ncr.step}</div>
      </div>
    </div>` : ''}
    ${ncr.departmentId ? `
    <div class="detail-field">
      <div class="detail-field-icon"><i class="fas fa-building" aria-hidden="true"></i></div>
      <div>
        <div class="detail-field-label">القسم</div>
        <div class="detail-field-value">${escapeHTML(deptName)}</div>
      </div>
    </div>` : ''}
    ${ncr.colorCode ? `
    <div class="detail-field">
      <div class="detail-field-icon"><i class="fas fa-palette" aria-hidden="true"></i></div>
      <div>
        <div class="detail-field-label">رمز اللون</div>
        <div class="detail-field-value" style="display:flex;align-items:center;gap:8px">
          <span style="width:18px;height:18px;border-radius:50%;background:${escapeHTML(ncr.colorCode)};display:inline-block;border:2px solid rgba(255,255,255,0.2)"></span>
          <span dir="ltr">${escapeHTML(ncr.colorCode)}</span>
        </div>
      </div>
    </div>` : ''}
    ${ncr.attachedDocument ? `
    <div class="detail-field">
      <div class="detail-field-icon"><i class="fas fa-paperclip" aria-hidden="true"></i></div>
      <div>
        <div class="detail-field-label">المرفق</div>
        <div class="detail-field-value">${attachHTML}</div>
      </div>
    </div>` : ''}
    ${invHTML}
  `;

  openModal('ncr-detail-modal');
}

function closeNCRDetailModal() {
  closeModal('ncr-detail-modal');
  state.detailNCRId = null;
}

function editNCRFromDetail() {
  const id = state.detailNCRId;
  closeNCRDetailModal();
  if (id) editNCR(id);
}

function openInviteFromDetail() {
  const id = state.detailNCRId;
  closeNCRDetailModal();
  if (id) openInviteModal(id);
}

function openInviteModal(ncrId) {
  state.inviteNCRId = ncrId;
  document.getElementById('inv-ncr-id').value = ncrId;
  document.getElementById('invite-form').reset();
  document.getElementById('inv-ncr-id').value = ncrId;
  populateDeptSelects();
  openModal('invite-modal');
}

function closeInviteModal() {
  closeModal('invite-modal');
  state.inviteNCRId = null;
}

async function handleInviteSubmit(event) {
  event.preventDefault();
  try {
    const data = {
      caseId: document.getElementById('inv-ncr-id').value,
      departmentId: document.getElementById('inv-dept-select').value,
      assignee: document.getElementById('inv-assignee').value.trim(),
      invitationStatus: document.getElementById('inv-status').value,
    };

    if (!data.caseId || !data.departmentId || !data.assignee) {
      showToast('يرجى ملء جميع الحقول', 'warning');
      return;
    }

    await saveInvitation(data);
    closeInviteModal();
    showToast(`تم إرسال الدعوة لـ ${data.assignee}`, 'success');
    renderDashboard();
    if (state.view === 'departments') renderDepartments();

  } catch (err) {
    showToast(`خطأ: ${err.message}`, 'error');
  }
}

/* Department Form */
async function handleDeptFormSubmit(event) {
  event.preventDefault();
  const nameInput = document.getElementById('f-dept-name');
  const editingId = document.getElementById('dept-editing-id').value;
  const name = nameInput.value.trim();

  if (!name) { showToast('أدخل اسم القسم', 'warning'); return; }

  try {
    if (editingId) {
      await updateDepartment(editingId, name);
      showToast('تم تحديث القسم', 'success');
      cancelDeptEdit();
    } else {
      await saveDepartment(name);
      showToast(`تم إضافة قسم: ${name}`, 'success');
    }
    nameInput.value = '';
    renderDepartments();
  } catch (err) {
    showToast(`خطأ: ${err.message}`, 'error');
  }
}

function editDept(id, name) {
  document.getElementById('f-dept-name').value = name;
  document.getElementById('dept-editing-id').value = id;
  document.getElementById('dept-btn-text').textContent = 'تحديث';
  document.getElementById('btn-cancel-dept').classList.remove('hidden');
  document.getElementById('f-dept-name').focus();
}

function cancelDeptEdit() {
  document.getElementById('f-dept-name').value = '';
  document.getElementById('dept-editing-id').value = '';
  document.getElementById('dept-btn-text').textContent = 'إضافة';
  document.getElementById('btn-cancel-dept').classList.add('hidden');
}

/* Generic modal open/close */
function openModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) {
    overlay.classList.add('open');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(id); }, { once: true });
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(id) {
  const overlay = document.getElementById(id);
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

/* Export Sheet */
function openExportSheet() {
  const overlay = document.getElementById('export-sheet-overlay');
  if (overlay) {
    overlay.classList.add('open');
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeExportSheet(); }, { once: true });
    document.body.style.overflow = 'hidden';
  }
}

function closeExportSheet() {
  const overlay = document.getElementById('export-sheet-overlay');
  if (overlay) overlay.classList.remove('open');
  document.body.style.overflow = '';
}

/* ============================================================
   SECTION 13: DELETE CONFIRMATIONS
   ============================================================ */

async function confirmDeleteNCR(id) {
  const ncr = state.ncrs.find(n => n.id === id);
  if (!ncr) return;

  if (!confirm(`هل تريد حذف التقرير "${ncr.caseNumber}"؟\nلا يمكن التراجع عن هذا الإجراء.`)) return;

  try {
    await deleteNCR(id);
    showToast('تم حذف التقرير', 'info');
    renderDashboard();
  } catch (err) {
    showToast(`خطأ في الحذف: ${err.message}`, 'error');
  }
}

async function confirmDeleteDept(id) {
  const dept = state.departments.find(d => d.id === id);
  if (!dept) return;

  if (!confirm(`هل تريد حذف القسم "${dept.name}"؟`)) return;

  try {
    await deleteDepartment(id);
    showToast('تم حذف القسم', 'info');
    renderDepartments();
  } catch (err) {
    showToast(`خطأ: ${err.message}`, 'error');
  }
}

async function confirmDeleteInvitation(id) {
  if (!confirm('هل تريد حذف هذه الدعوة؟')) return;
  try {
    await deleteInvitation(id);
    showToast('تم حذف الدعوة', 'info');
    renderDepartments();
  } catch (err) {
    showToast(`خطأ: ${err.message}`, 'error');
  }
}

/* ============================================================
   SECTION 14: EXPORT FUNCTIONS
   ============================================================ */

/** Get export-ready table data (filtered NCRs) */
function getExportData() {
  const ncrs = getFilteredNCRs();
  const monthLabel = state.filter.month !== null
    ? `${APP_CONFIG.MONTHS_AR[state.filter.month]} ${state.filter.year}`
    : 'الكل';

  const rows = ncrs.map(ncr => ({
    'رقم الحالة': ncr.caseNumber || '',
    'الحالة الفرعية': ncr.subCase || '',
    'الوصف': ncr.description || '',
    'الحالة': APP_CONFIG.STATUS_LABELS[ncr.status] || ncr.status,
    'الخطوة': ncr.step || '',
    'أيام الانقضاء': ncr.elapsedDays,
    'تجاوز SLA': ncr.elapsedDays > APP_CONFIG.SLA_CRITICAL_DAYS ? 'نعم ⚠' : 'لا',
    'القسم': getDeptName(ncr.departmentId),
    'رمز اللون': ncr.colorCode || '',
    'التاريخ': formatDate(ncr.date),
    'آخر تحديث': formatDate(ncr.updatedAt),
  }));

  return { rows, ncrs, monthLabel };
}

/** Export to PDF */
async function exportToPDF() {
  closeExportSheet();
  showToast('جارٍ إنشاء ملف PDF...', 'info');

  try {
    const { rows, monthLabel } = getExportData();
    if (rows.length === 0) { showToast('لا توجد بيانات للتصدير', 'warning'); return; }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

    // Title
    doc.setFontSize(18);
    doc.setTextColor(245, 158, 11);
    doc.text('VortexFlow NCR Report', 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(120, 130, 160);
    doc.text(`Period: ${monthLabel} | Generated: ${new Date().toLocaleDateString()}`, 14, 26);

    // Table
    const headers = Object.keys(rows[0]);
    const body = rows.map(r => Object.values(r).map(v => String(v)));

    doc.autoTable({
      head: [headers],
      body: body,
      startY: 32,
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [21, 29, 46], textColor: [245, 158, 11], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [17, 22, 35] },
      bodyStyles: { fillColor: [21, 29, 46], textColor: [220, 225, 240] },
    });

    doc.save(`VortexFlow_NCR_${monthLabel.replace(/ /g,'_')}_${Date.now()}.pdf`);
    showToast('تم تصدير PDF بنجاح', 'success');

  } catch (err) {
    console.error('[VF] PDF export error:', err);
    showToast(`خطأ في تصدير PDF: ${err.message}`, 'error');
  }
}

/** Export to Excel (XLSX) */
async function exportToXLSX() {
  closeExportSheet();
  showToast('جارٍ إنشاء ملف Excel...', 'info');

  try {
    const { rows, monthLabel } = getExportData();
    if (rows.length === 0) { showToast('لا توجد بيانات للتصدير', 'warning'); return; }

    const wb = XLSX.utils.book_new();

    // Main data sheet
    const ws = XLSX.utils.json_to_sheet(rows);

    // Set column widths
    const colWidths = [16, 12, 40, 12, 8, 12, 10, 18, 12, 16, 16];
    ws['!cols'] = colWidths.map(w => ({ wch: w }));

    XLSX.utils.book_append_sheet(wb, ws, 'NCR Cases');

    // Stats sheet
    const stats = getStats();
    const statsData = [
      { 'المؤشر': 'إجمالي التقارير', 'القيمة': stats.total },
      { 'المؤشر': 'تقارير مفتوحة', 'القيمة': stats.open },
      { 'المؤشر': 'قيد العمل', 'القيمة': stats.inProgress },
      { 'المؤشر': 'تقارير مغلقة', 'القيمة': stats.closed },
      { 'المؤشر': 'تجاوز SLA', 'القيمة': stats.slaBreached },
      { 'المؤشر': 'الفترة', 'القيمة': monthLabel },
      { 'المؤشر': 'تاريخ التصدير', 'القيمة': new Date().toLocaleDateString() },
    ];
    const ws2 = XLSX.utils.json_to_sheet(statsData);
    XLSX.utils.book_append_sheet(wb, ws2, 'Summary');

    XLSX.writeFile(wb, `VortexFlow_NCR_${monthLabel.replace(/ /g,'_')}_${Date.now()}.xlsx`);
    showToast('تم تصدير Excel بنجاح', 'success');

  } catch (err) {
    console.error('[VF] XLSX export error:', err);
    showToast(`خطأ في تصدير Excel: ${err.message}`, 'error');
  }
}

/** Export to PowerPoint (PPTX) */
async function exportToPPTX() {
  closeExportSheet();
  showToast('جارٍ إنشاء ملف PowerPoint...', 'info');

  try {
    const { rows, ncrs, monthLabel } = getExportData();
    if (rows.length === 0) { showToast('لا توجد بيانات للتصدير', 'warning'); return; }

    const pptx = new PptxGenJS();
    pptx.layout = 'LAYOUT_WIDE';
    pptx.title = 'VortexFlow NCR Report';
    pptx.author = 'VortexFlow NCR System';

    // === SLIDE 1: TITLE ===
    const slide1 = pptx.addSlide();
    slide1.background = { color: '0d1117' };
    slide1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: '100%', h: '100%', fill: { color: '0d1117' } });
    slide1.addShape(pptx.ShapeType.rect, { x: 0, y: 3.2, w: '100%', h: 0.04, fill: { color: 'f59e0b' } });

    slide1.addText('VortexFlow NCR', {
      x: 0.5, y: 1.2, w: 12, h: 1,
      fontSize: 44, bold: true, color: 'f59e0b',
      fontFace: 'Rajdhani'
    });
    slide1.addText('تقرير تقارير عدم المطابقة', {
      x: 0.5, y: 2.2, w: 12, h: 0.7,
      fontSize: 20, color: 'c8d4e8', fontFace: 'Cairo'
    });
    slide1.addText(`الفترة: ${monthLabel}  |  التاريخ: ${new Date().toLocaleDateString()}  |  عدد الحالات: ${ncrs.length}`, {
      x: 0.5, y: 3.4, w: 12, h: 0.5,
      fontSize: 12, color: '7a8fb5'
    });

    // === SLIDE 2: STATS ===
    const stats = getStats();
    const slide2 = pptx.addSlide();
    slide2.background = { color: '0d1117' };
    slide2.addText('ملخص إحصائي', {
      x: 0.5, y: 0.3, w: 12, h: 0.6,
      fontSize: 24, bold: true, color: 'f59e0b', fontFace: 'Rajdhani'
    });

    const statItems = [
      { label: 'إجمالي الحالات', value: stats.total, color: '3b82f6' },
      { label: 'مفتوح', value: stats.open, color: 'f59e0b' },
      { label: 'قيد العمل', value: stats.inProgress, color: '8b5cf6' },
      { label: 'مغلق', value: stats.closed, color: '10b981' },
    ];

    statItems.forEach((s, i) => {
      const x = 0.5 + (i * 3.1);
      slide2.addShape(pptx.ShapeType.roundRect, { x, y: 1.1, w: 2.8, h: 1.5, fill: { color: '161b22' }, line: { color: s.color, width: 1.5 } });
      slide2.addText(String(s.value), { x, y: 1.2, w: 2.8, h: 0.8, fontSize: 36, bold: true, color: s.color, align: 'center' });
      slide2.addText(s.label, { x, y: 2.0, w: 2.8, h: 0.5, fontSize: 12, color: '7a8fb5', align: 'center', fontFace: 'Cairo' });
    });

    if (stats.slaBreached > 0) {
      slide2.addText(`⚠  ${stats.slaBreached} حالات تجاوزت حد SLA (${APP_CONFIG.SLA_CRITICAL_DAYS} أيام)`, {
        x: 0.5, y: 3.0, w: 12, h: 0.5,
        fontSize: 14, color: 'ef4444', bold: true, fontFace: 'Cairo'
      });
    }

    // === SLIDES 3+: NCR DATA TABLE (10 rows per slide) ===
    const chunkSize = 10;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const slide = pptx.addSlide();
      slide.background = { color: '0d1117' };

      const slideNum = Math.floor(i / chunkSize) + 1;
      slide.addText(`تفاصيل الحالات — الصفحة ${slideNum}`, {
        x: 0.5, y: 0.2, w: 12, h: 0.5,
        fontSize: 16, bold: true, color: 'f59e0b', fontFace: 'Rajdhani'
      });

      const tableHeaders = [['رقم الحالة', 'الوصف', 'الحالة', 'الأيام', 'تجاوز SLA', 'القسم', 'التاريخ']];
      const tableRows = chunk.map(r => [
        { text: r['رقم الحالة'], options: { color: '60a5fa', bold: true } },
        { text: String(r['الوصف']).substring(0, 40) + (r['الوصف'].length > 40 ? '…' : '') },
        { text: r['الحالة'] },
        { text: String(r['أيام الانقضاء']) },
        { text: r['تجاوز SLA'], options: { color: r['تجاوز SLA'].includes('نعم') ? 'ef4444' : '10b981' } },
        { text: r['القسم'] },
        { text: r['التاريخ'] },
      ]);

      slide.addTable([...tableHeaders, ...tableRows], {
        x: 0.4, y: 0.9, w: 12.2, h: 5,
        fontSize: 9,
        color: 'c8d4e8',
        border: { pt: 0.5, color: '1e2d47' },
        fill: '151d2e',
        align: 'right',
        fontFace: 'Cairo',
        rowH: 0.38,
        colW: [2.0, 3.5, 1.3, 0.9, 1.2, 1.8, 1.5],
        thead: { fill: '0f1623', color: 'f59e0b', bold: true },
        autoPage: false,
      });
    }

    await pptx.writeFile({ fileName: `VortexFlow_NCR_${monthLabel.replace(/ /g,'_')}_${Date.now()}.pptx` });
    showToast('تم تصدير PowerPoint بنجاح', 'success');

  } catch (err) {
    console.error('[VF] PPTX export error:', err);
    showToast(`خطأ في تصدير PPTX: ${err.message}`, 'error');
  }
}

/** Export to ZIP (PDF + XLSX bundled) */
async function exportToZIP() {
  closeExportSheet();
  showToast('جارٍ إنشاء ملف ZIP...', 'info');

  try {
    const { rows, monthLabel } = getExportData();
    if (rows.length === 0) { showToast('لا توجد بيانات للتصدير', 'warning'); return; }

    const zip = new JSZip();

    // 1. Add Excel file
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'NCR Cases');
    const xlsxBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    zip.file('NCR_Data.xlsx', xlsxBuffer);

    // 2. Add PDF file
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(16);
    doc.setTextColor(245, 158, 11);
    doc.text('VortexFlow NCR Report', 14, 16);
    doc.setFontSize(9);
    doc.setTextColor(120, 130, 160);
    doc.text(`Period: ${monthLabel} | ${new Date().toLocaleDateString()}`, 14, 23);
    const headers = Object.keys(rows[0]);
    const body = rows.map(r => Object.values(r).map(v => String(v)));
    doc.autoTable({
      head: [headers], body: body, startY: 28,
      theme: 'grid',
      styles: { fontSize: 7.5, cellPadding: 2.5 },
      headStyles: { fillColor: [21, 29, 46], textColor: [245, 158, 11] },
      bodyStyles: { fillColor: [21, 29, 46], textColor: [220, 225, 240] },
    });
    const pdfBuffer = doc.output('arraybuffer');
    zip.file('NCR_Report.pdf', pdfBuffer);

    // 3. Add JSON summary
    const summary = {
      exportDate: new Date().toISOString(),
      period: monthLabel,
      stats: getStats(),
      totalRecords: rows.length,
      app: APP_CONFIG.appName,
      version: APP_CONFIG.version,
    };
    zip.file('summary.json', JSON.stringify(summary, null, 2));

    // 4. Generate ZIP
    const content = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 }
    });

    saveAs(content, `VortexFlow_Bundle_${monthLabel.replace(/ /g,'_')}_${Date.now()}.zip`);
    showToast('تم تصدير ZIP بنجاح', 'success');

  } catch (err) {
    console.error('[VF] ZIP export error:', err);
    showToast(`خطأ في تصدير ZIP: ${err.message}`, 'error');
  }
}

/* ============================================================
   SECTION 15: SHARE
   ============================================================ */

/** Share a specific NCR via Web Share API */
async function shareNCR(id) {
  const ncr = state.ncrs.find(n => n.id === id);
  if (!ncr) return;

  const enriched = { ...ncr, elapsedDays: calculateElapsedDays(ncr.date) };
  const sla = enriched.elapsedDays > APP_CONFIG.SLA_CRITICAL_DAYS ? '⚠ تجاوز SLA' : 'ضمن SLA';
  const statusLabel = APP_CONFIG.STATUS_LABELS[ncr.status] || ncr.status;
  const deptName = getDeptName(ncr.departmentId);

  const text = [
    `📋 VortexFlow NCR`,
    `━━━━━━━━━━━━━━━━`,
    `🔢 رقم الحالة: ${ncr.caseNumber}`,
    ncr.subCase ? `🔹 الحالة الفرعية: ${ncr.subCase}` : null,
    `📌 الحالة: ${statusLabel}`,
    `📝 الوصف: ${ncr.description}`,
    `⏱ الأيام المنقضية: ${enriched.elapsedDays} يوم — ${sla}`,
    ncr.step ? `🔢 الخطوة: ${ncr.step}` : null,
    ncr.departmentId ? `🏢 القسم: ${deptName}` : null,
    `📅 التاريخ: ${formatDate(ncr.date)}`,
    `━━━━━━━━━━━━━━━━`,
    `تم الإنشاء بواسطة VortexFlow NCR System`,
  ].filter(Boolean).join('\n');

  if (navigator.share) {
    try {
      await navigator.share({
        title: `VortexFlow NCR — ${ncr.caseNumber}`,
        text: text,
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        showToast('فشل المشاركة', 'error');
      }
    }
  } else {
    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(text);
      showToast('تم نسخ ملخص التقرير إلى الحافظة', 'success');
    } catch {
      showToast('المشاركة غير متاحة في هذا المتصفح', 'warning');
    }
  }
}

/** Share overall app summary */
async function shareAppSummary() {
  closeExportSheet();
  const stats = getStats();
  const monthLabel = state.filter.month !== null
    ? `${APP_CONFIG.MONTHS_AR[state.filter.month]} ${state.filter.year}`
    : 'كامل السجلات';

  const text = [
    `📊 VortexFlow NCR — تقرير ملخص`,
    `━━━━━━━━━━━━━━━━`,
    `📅 الفترة: ${monthLabel}`,
    `📋 إجمالي التقارير: ${stats.total}`,
    `🔵 مفتوح: ${stats.open}`,
    `🟡 قيد العمل: ${stats.inProgress}`,
    `🟢 مغلق: ${stats.closed}`,
    stats.slaBreached > 0 ? `⚠ تجاوز SLA: ${stats.slaBreached} حالة` : null,
    `━━━━━━━━━━━━━━━━`,
    `VortexFlow NCR System — ZiadPWA`,
    new Date().toLocaleDateString('ar-EG'),
  ].filter(Boolean).join('\n');

  if (navigator.share) {
    try {
      await navigator.share({ title: 'VortexFlow NCR Report', text });
    } catch (err) {
      if (err.name !== 'AbortError') showToast('فشل المشاركة', 'error');
    }
  } else {
    try {
      await navigator.clipboard.writeText(text);
      showToast('تم نسخ الملخص إلى الحافظة', 'success');
    } catch {
      showToast('المشاركة غير متاحة في هذا المتصفح', 'warning');
    }
  }
}

/* ============================================================
   SECTION 16: BACKUP & RESTORE
   ============================================================ */

/** Full system backup — tries File System Access API, falls back to FileSaver */
async function backupAllData() {
  closeExportSheet();
  showToast('جارٍ تجميع البيانات للنسخ الاحتياطي...', 'info');

  try {
    const backup = {
      appName: APP_CONFIG.appName,
      version: APP_CONFIG.version,
      backupDate: new Date().toISOString(),
      backupTimestamp: Date.now(),
      data: {
        NCR_Cases: [],
        Departments: [],
        Invitations: [],
      }
    };

    // Collect all records from each store
    await ncrStore.iterate(value => { backup.data.NCR_Cases.push(value); });
    await deptStore.iterate(value => { backup.data.Departments.push(value); });
    await invStore.iterate(value => { backup.data.Invitations.push(value); });

    const jsonString = JSON.stringify(backup, null, 2);
    const fileName = `VortexFlow_Backup_${new Date().toISOString().slice(0,10)}.json`;

    // Try File System Access API (modern desktop browsers)
    if (window.showSaveFilePicker) {
      try {
        const fileHandle = await window.showSaveFilePicker({
          suggestedName: fileName,
          types: [{
            description: 'VortexFlow Backup File',
            accept: { 'application/json': ['.json'] }
          }],
        });
        const writable = await fileHandle.createWritable();
        await writable.write(jsonString);
        await writable.close();
        showToast('تم حفظ النسخة الاحتياطية بنجاح ✓', 'success');
        return;
      } catch (fsErr) {
        if (fsErr.name === 'AbortError') {
          showToast('تم إلغاء عملية الحفظ', 'info');
          return;
        }
        // If File System API fails for other reasons, fall through to FileSaver
        console.warn('[VF] File System API failed, using FileSaver:', fsErr);
      }
    }

    // Fallback: FileSaver.js
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
    saveAs(blob, fileName);
    showToast('تم تنزيل النسخة الاحتياطية', 'success');

  } catch (err) {
    console.error('[VF] Backup error:', err);
    showToast(`خطأ في النسخ الاحتياطي: ${err.message}`, 'error');
  }
}

/** Trigger the restore file picker */
function triggerRestore() {
  closeExportSheet();
  document.getElementById('restore-file-input').click();
}

/** Restore from a backup JSON file */
async function restoreFromBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!confirm('سيؤدي الاستعادة إلى استبدال جميع البيانات الحالية. هل أنت متأكد؟')) {
    event.target.value = '';
    return;
  }

  showToast('جارٍ الاستعادة من النسخة الاحتياطية...', 'info');

  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    // Validate backup structure
    if (!backup.data || !backup.data.NCR_Cases || !backup.data.Departments) {
      throw new Error('ملف النسخة الاحتياطية تالف أو غير صالح');
    }

    // Confirm version compatibility
    const msg = backup.version !== APP_CONFIG.version
      ? `تحذير: الملف من إصدار ${backup.version} والتطبيق الحالي ${APP_CONFIG.version}. استمرار؟`
      : null;
    if (msg && !confirm(msg)) { event.target.value = ''; return; }

    // Clear existing data
    await ncrStore.clear();
    await deptStore.clear();
    await invStore.clear();

    // Restore NCR Cases
    for (const ncr of (backup.data.NCR_Cases || [])) {
      await ncrStore.setItem(ncr.id, ncr);
    }
    // Restore Departments
    for (const dept of (backup.data.Departments || [])) {
      await deptStore.setItem(dept.id, dept);
    }
    // Restore Invitations
    for (const inv of (backup.data.Invitations || [])) {
      await invStore.setItem(inv.id, inv);
    }

    // Reload all data into state
    await loadAllData();
    renderDashboard();

    showToast(`تم الاستعادة بنجاح — ${backup.data.NCR_Cases.length} حالة`, 'success');

  } catch (err) {
    console.error('[VF] Restore error:', err);
    showToast(`خطأ في الاستعادة: ${err.message}`, 'error');
  } finally {
    event.target.value = '';
  }
}

/* ============================================================
   SECTION 17: TOAST NOTIFICATIONS
   ============================================================ */

const TOAST_ICONS = {
  success: 'fa-circle-check',
  error: 'fa-circle-xmark',
  warning: 'fa-triangle-exclamation',
  info: 'fa-circle-info',
};

const TOAST_DURATION = { success: 3500, error: 5000, warning: 4000, info: 3000 };

function showToast(message, type = 'info', duration) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const dur = duration || TOAST_DURATION[type] || 3000;
  const icon = TOAST_ICONS[type] || 'fa-circle-info';

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.setAttribute('role', 'alert');
  toast.setAttribute('aria-live', 'polite');
  toast.innerHTML = `
    <i class="fas ${icon}" aria-hidden="true"></i>
    <span>${escapeHTML(message)}</span>
    <div class="toast-progress">
      <div class="toast-progress-bar" style="animation-duration:${dur}ms"></div>
    </div>
  `;

  container.appendChild(toast);

  // Auto-remove
  const removeToast = () => {
    toast.classList.add('toast-out');
    setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 300);
  };

  const timer = setTimeout(removeToast, dur);
  toast.addEventListener('click', () => { clearTimeout(timer); removeToast(); });

  // Limit simultaneous toasts
  const toasts = container.querySelectorAll('.toast:not(.toast-out)');
  if (toasts.length > 4) {
    const oldest = toasts[0];
    oldest.classList.add('toast-out');
    setTimeout(() => { if (oldest.parentNode) oldest.parentNode.removeChild(oldest); }, 300);
  }
}

/* ============================================================
   SECTION 18: ONBOARDING
   ============================================================ */

async function checkFirstVisit() {
  const done = localStorage.getItem(APP_CONFIG.firstVisitKey);
  if (!done) {
    const modal = document.getElementById('welcome-modal');
    if (modal) modal.classList.add('open');
  }
}

async function completeOnboarding() {
  try {
    // Request persistent storage to prevent OS from clearing our DB
    if (navigator.storage && navigator.storage.persist) {
      const granted = await navigator.storage.persist();
      console.log('[VF] Persistent storage:', granted ? 'granted ✓' : 'denied');
      if (granted) {
        showToast('تم تأمين التخزين الدائم ✓', 'success');
      } else {
        showToast('لم يتم منح التخزين الدائم — قد تتأثر البيانات', 'warning');
      }
    }

    localStorage.setItem(APP_CONFIG.firstVisitKey, 'true');

    const modal = document.getElementById('welcome-modal');
    if (modal) modal.classList.remove('open');

  } catch (err) {
    console.warn('[VF] onboarding error:', err);
    localStorage.setItem(APP_CONFIG.firstVisitKey, 'true');
    const modal = document.getElementById('welcome-modal');
    if (modal) modal.classList.remove('open');
  }
}

/* ============================================================
   SECTION 19: SERVICE WORKER REGISTRATION
   ============================================================ */

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    console.log('[VF] Service Worker registered:', registration.scope);
    registration.update().catch(() => {});

    // Watch for updates
    registration.addEventListener('updatefound', () => {
      const newWorker = registration.installing;
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          showToast('تحديث جديد متاح — اضغط للتحديث', 'info', 8000);
          const updateBtn = document.getElementById('btn-sw-update');
          if (updateBtn) updateBtn.style.display = 'flex';
        }
      });
    });

    // Send version request to SW
    navigator.serviceWorker.ready.then(reg => {
      if (reg.active) {
        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => {
          if (e.data.version) console.log('[VF] SW Cache Version:', e.data.version);
        };
        reg.active.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
      }
    });

  } catch (err) {
    console.warn('[VF] Service Worker registration failed:', err);
  }
}

function refreshApp() {
  if (navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
  }
  window.location.reload();
}

/* ============================================================
   SECTION 20: HELPER — XSS PREVENTION
   ============================================================ */

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/* ============================================================
   SECTION 21: KEYBOARD SHORTCUTS
   ============================================================ */

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Escape: close modals
    if (e.key === 'Escape') {
      closeModal('ncr-detail-modal');
      closeModal('invite-modal');
      closeExportSheet();
    }
    // Ctrl+N: new NCR
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
      e.preventDefault();
      quickAddNCR();
    }
    // Ctrl+E: export sheet
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
      e.preventDefault();
      openExportSheet();
    }
    // Ctrl+B: backup
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      backupAllData();
    }
  });
}

/* ============================================================
   SECTION 22: TOUCH GESTURES (Swipe on cards)
   ============================================================ */

function initSwipeGestures() {
  let touchStartX = 0;
  let touchStartY = 0;
  let currentCard = null;
  let isDragging = false;

  document.addEventListener('touchstart', (e) => {
    const card = e.target.closest('.ncr-card');
    if (!card) return;
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    currentCard = card;
    isDragging = false;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!currentCard) return;
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;

    if (!isDragging && Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10) {
      isDragging = true;
    }

    if (isDragging) {
      const clampedDx = Math.max(-100, Math.min(0, dx));
      currentCard.style.transform = `translateX(${clampedDx}px)`;
      currentCard.style.opacity = String(1 + clampedDx / 200);
    }
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    if (!currentCard) return;
    const dx = e.changedTouches[0].clientX - touchStartX;

    if (isDragging && dx < -60) {
      // Swiped left — show delete confirmation
      const ncrId = currentCard.dataset.id;
      currentCard.style.transform = '';
      currentCard.style.opacity = '';
      currentCard = null;
      setTimeout(() => confirmDeleteNCR(ncrId), 100);
    } else {
      if (currentCard) {
        currentCard.style.transform = '';
        currentCard.style.opacity = '';
        // If minimal swipe, open detail
        if (!isDragging && Math.abs(dx) < 5) {
          const ncrId = currentCard.dataset.id;
          if (ncrId) openNCRDetail(ncrId);
        }
      }
      currentCard = null;
    }
    isDragging = false;
  }, { passive: true });
}

/* ============================================================
   SECTION 23: DRAG & DROP FILE UPLOAD
   ============================================================ */

function initFileDragDrop() {
  const dropZone = document.getElementById('file-drop-zone');
  if (!dropZone) return;

  ['dragenter', 'dragover'].forEach(event => {
    dropZone.addEventListener(event, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(event => {
    dropZone.addEventListener(event, () => {
      dropZone.classList.remove('dragover');
    });
  });

  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    try {
      const fileObj = await fileToBase64(file);
      state.fileData = fileObj;
      renderFilePreview(file.name, file.size);
      showToast(`تم تحميل الملف: ${file.name}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

/* ============================================================
   SECTION 24: SLA PERIODIC UPDATE
   ============================================================ */

function startSLATimer() {
  // Update elapsed days every minute
  setInterval(() => {
    if (state.view === 'dashboard') {
      renderNCRList();
      renderStats();
    }
  }, 60 * 1000);
}

/* ============================================================
   SECTION 25: SEED SAMPLE DATA (First-time users)
   ============================================================ */

async function seedSampleData() {
  if (!APP_CONFIG.enableSampleData) return;
  if (state.ncrs.length > 0 || state.departments.length > 0) return;

  try {
    // Seed departments
    const depts = ['الإنتاج', 'الجودة', 'الهندسة', 'المشتريات', 'الصيانة'];
    const savedDepts = [];
    for (const name of depts) {
      const d = await saveDepartment(name);
      savedDepts.push(d);
    }

    // Seed sample NCR cases
    const sampleNCRs = [
      {
        caseNumber: 'NCR-2024-0001',
        subCase: 'A',
        description: 'عيب في اللحام على الهيكل الأمامي — الفقاعات الهوائية تؤثر على سلامة الوصلة',
        status: 'Open',
        step: 1,
        colorCode: '#ef4444',
        departmentId: savedDepts[0]?.id,
        date: Date.now() - (7 * 24 * 60 * 60 * 1000), // 7 days ago
      },
      {
        caseNumber: 'NCR-2024-0002',
        subCase: 'B',
        description: 'انحراف مقاسات في الشريط المطاطي — خروج عن المواصفات المعتمدة بمقدار 0.5mm',
        status: 'In Progress',
        step: 2,
        colorCode: '#f59e0b',
        departmentId: savedDepts[1]?.id,
        date: Date.now() - (3 * 24 * 60 * 60 * 1000), // 3 days ago
      },
      {
        caseNumber: 'NCR-2024-0003',
        subCase: '',
        description: 'تلوث في دفعة المواد الخام X-440 — عدم مطابقة لمعايير ISO 9001',
        status: 'Closed',
        step: 3,
        colorCode: '#10b981',
        departmentId: savedDepts[2]?.id,
        date: Date.now() - (2 * 24 * 60 * 60 * 1000), // 2 days ago
      },
      {
        caseNumber: 'NCR-2024-0004',
        subCase: 'A',
        description: 'خطأ في التوثيق — عدم تطابق شهادة المواد مع المواصفة المطلوبة للمشروع',
        status: 'Open',
        step: 1,
        colorCode: '#8b5cf6',
        departmentId: savedDepts[3]?.id,
        date: Date.now() - (6 * 24 * 60 * 60 * 1000), // 6 days ago — SLA breach
      },
    ];

    for (const ncrData of sampleNCRs) {
      await saveNCR(ncrData);
    }

    // Seed invitation
    if (state.ncrs.length > 0 && savedDepts.length > 0) {
      await saveInvitation({
        caseId: state.ncrs[0].id,
        departmentId: savedDepts[0].id,
        assignee: 'عبد الله علي',
        invitationStatus: 'Update',
      });
      await saveInvitation({
        caseId: state.ncrs[1]?.id || state.ncrs[0].id,
        departmentId: savedDepts[1].id,
        assignee: 'محمد الزهراني',
        invitationStatus: 'Update',
      });
    }

    console.log('[VF] Sample data seeded successfully');

  } catch (err) {
    console.warn('[VF] Could not seed sample data:', err);
  }
}

/* ============================================================
   SECTION 26: APP INITIALIZATION
   ============================================================ */

async function init() {
  console.log(`[VF] Initializing ${APP_CONFIG.appName} v${APP_CONFIG.version}`);

  try {
    // 1. Register Service Worker
    await registerServiceWorker();

    // 2. Load all data from IndexedDB
    await loadAllData();

    // 3. Reload state after initial load
    await loadAllData();

    // 5. Render initial view
    renderMonthFilter();
    navigateTo('dashboard');

    // 6. Initialize interactions
    initKeyboardShortcuts();
    initSwipeGestures();
    initFileDragDrop();
    startSLATimer();

    // 7. Check for first visit (show onboarding)
    // Slight delay so user sees the app first
    setTimeout(() => checkFirstVisit(), 600);

    // 8. Check storage estimate
    if (navigator.storage && navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      const usedMB = ((estimate.usage || 0) / (1024 * 1024)).toFixed(2);
      const quotaMB = ((estimate.quota || 0) / (1024 * 1024)).toFixed(0);
      console.log(`[VF] Storage: ${usedMB} MB used of ~${quotaMB} MB`);
    }

    console.log('[VF] App initialized ✓');

  } catch (err) {
    console.error('[VF] Initialization failed:', err);
    showToast('خطأ في تهيئة التطبيق — حاول إعادة تحميل الصفحة', 'error', 8000);
  }
}

// Bootstrap the application
document.addEventListener('DOMContentLoaded', () => {
  const bootstrap = window.VortexFlowBootstrap || init;
  bootstrap();
});

// Handle visibility change (refresh SLA when tab becomes visible)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.view === 'dashboard') {
    renderNCRList();
    renderStats();
  }
});

Object.assign(window, {
  APP_CONFIG,
  state,
  ncrStore,
  deptStore,
  invStore,
  generateId,
  generateCaseNumber,
  calculateElapsedDays,
  formatDate,
  formatDateTime,
  fileToBase64,
  getSLAStatus,
  getStatusBadge,
  getInitials,
  getDeptName,
  loadAllData,
  saveNCR,
  updateNCR,
  deleteNCR,
  saveDepartment,
  updateDepartment,
  deleteDepartment,
  saveInvitation,
  deleteInvitation,
  getFilteredNCRs,
  getStats,
  renderDashboard,
  renderStats,
  renderNCRList,
  renderNCRCard,
  renderDepartments,
  renderDeptList,
  renderInvitations,
  populateDeptSelects,
  renderMonthFilter,
  navigateTo,
  prepareAddNCRForm,
  handleNCRFormSubmit,
  cancelNCRForm,
  editNCR,
  quickAddNCR,
  handleFileSelect,
  renderFilePreview,
  removeFile,
  setColorPreset,
  setStatusFilter,
  setMonthFilter,
  handleSearch,
  openNCRDetail,
  closeNCRDetailModal,
  editNCRFromDetail,
  openInviteFromDetail,
  openInviteModal,
  closeInviteModal,
  handleInviteSubmit,
  handleDeptFormSubmit,
  editDept,
  cancelDeptEdit,
  openModal,
  closeModal,
  openExportSheet,
  closeExportSheet,
  confirmDeleteNCR,
  confirmDeleteDept,
  confirmDeleteInvitation,
  getExportData,
  exportToPDF,
  exportToXLSX,
  exportToPPTX,
  exportToZIP,
  shareNCR,
  shareAppSummary,
  backupAllData,
  triggerRestore,
  restoreFromBackup,
  showToast,
  checkFirstVisit,
  completeOnboarding,
  registerServiceWorker,
  refreshApp,
  initKeyboardShortcuts,
  initSwipeGestures,
  initFileDragDrop,
  startSLATimer,
  seedSampleData,
  init,
  escapeHTML
});
