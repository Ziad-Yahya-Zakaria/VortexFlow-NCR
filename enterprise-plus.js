'use strict';

(function enterprisePlusLayer() {
  if (typeof APP_CONFIG === 'undefined' || typeof state === 'undefined') {
    return;
  }

  const DEMO_CLEANUP_KEY = 'vf_demo_cleanup_v3';
  const DEMO_CASES = new Set(['NCR-2024-0001', 'NCR-2024-0002', 'NCR-2024-0003', 'NCR-2024-0004']);
  const DEMO_DEPARTMENTS = new Set(['الإنتاج', 'الجودة', 'الهندسة', 'المشتريات', 'الصيانة']);
  const DEMO_ASSIGNEES = new Set(['عبد الله علي', 'محمد الزهراني']);
  const REPORT_ROWS_PER_PAGE = 8;
  const SECRET_TAP_TARGET = 7;
  const SECRET_MODAL_HTML = `
    <div id="secret-easter-egg-modal" class="secret-modal-overlay" aria-hidden="true">
      <div class="secret-modal-box">
        <button class="modal-close" onclick="closeSecretEasterEgg()" aria-label="إغلاق">
          <i class="fas fa-times" aria-hidden="true"></i>
        </button>
        <div class="secret-modal-title">رسالة سرية</div>
        <div class="secret-modal-copy">
          <p>اهداء ياعم الحج انتا مفكر انك كده جامد انا دماغي وجعاني مش نقصاك انتا شكلك فاضي.</p>
          <p>اهم حاجة تعرف حاجة واحدة بس الزوز هوا الزعيم وده رقم الزوز عشان لو عايز تتواصل معاه <a href="tel:01124148723">01124148723</a>.</p>
          <p>الزوز هوا اللي مبرمج البرنامج ده هوا وفريق معاه تاني. ماشي في امان الله يابا سلام.</p>
        </div>
      </div>
    </div>
  `;

  const previousBootstrap = window.VortexFlowBootstrap;
  const previousLoadAllData = window.loadAllData;
  const previousRenderDashboard = window.renderDashboard;
  const previousNavigateTo = window.navigateTo;
  const previousGetFilteredNCRs = window.getFilteredNCRs;
  const previousOpenNCRDetail = window.openNCRDetail;
  const previousHandleLogoSelect = window.handleLogoSelect;
  const previousRemoveCompanyLogo = window.removeCompanyLogo;

  let secretTapCount = 0;
  let secretTapTimer = null;

  state.filter.startDate = state.filter.startDate || '';
  state.filter.endDate = state.filter.endDate || '';
  state.inquiryQuery = state.inquiryQuery || '';

  function requestJson(path, options = {}) {
    const headers = {
      Accept: 'application/json',
      ...(options.headers || {})
    };

    const requestOptions = {
      method: options.method || 'GET',
      credentials: 'include',
      headers
    };

    if (options.body !== undefined) {
      requestOptions.body = JSON.stringify(options.body);
      requestOptions.headers['Content-Type'] = 'application/json';
    }

    return fetch(path, requestOptions).then(async response => {
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return data;
    });
  }

  function toTime(value) {
    if (!value) {
      return 0;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function parseTagsSafe(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean);
    }
    return String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function normalizeChecklistSafe(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map(item => ({
        id: String(item?.id || ''),
        label: String(item?.label || '').trim(),
        done: !!item?.done,
        note: String(item?.note || '').trim()
      }))
      .filter(item => item.label);
  }

  function getAttachmentSourceSafe(attachedDocument) {
    return attachedDocument?.url || attachedDocument?.base64 || '';
  }

  function getDepartmentNameSafe(departmentId) {
    const department = state.departments.find(item => item.id === departmentId);
    return department?.name || '—';
  }

  function getUserById(userId) {
    return state.users.find(item => item.id === userId) || null;
  }

  function getUserTitle(user) {
    if (!user) {
      return 'غير محدد';
    }
    return String(user.jobTitle || (user.role === 'admin' ? 'الزوز مدير النظام' : 'عضو فريق NCR')).trim();
  }

  function isUserVerified(user) {
    return !!user?.isVerified || user?.role === 'admin';
  }

  function getRoleLabel(role) {
    const map = {
      admin: 'مدير النظام',
      engineer: 'مهندس',
      viewer: 'مشاهد'
    };
    return map[role] || role || '—';
  }

  function getStatusLabel(status) {
    return APP_CONFIG.STATUS_LABELS?.[status] || status || '—';
  }

  function getVerificationLabel(status) {
    return APP_CONFIG.VERIFICATION_LABELS?.[status] || status || '—';
  }

  function getCategoryLabel(category) {
    return APP_CONFIG.CATEGORY_LABELS?.[category] || category || '—';
  }

  function getSourceLabel(source) {
    return APP_CONFIG.SOURCE_LABELS?.[source] || source || '—';
  }

  function getChecklistProgressSafe(checklist) {
    const items = normalizeChecklistSafe(checklist);
    const total = items.length;
    const completed = items.filter(item => item.done).length;
    return {
      total,
      completed,
      percent: total ? Math.round((completed / total) * 100) : 0
    };
  }

  function normalizeNcrForPlus(ncr) {
    if (!ncr) {
      return null;
    }

    const owner = getUserById(ncr.ownerId);
    const checklist = normalizeChecklistSafe(ncr.checklist);
    return {
      ...ncr,
      elapsedDays: typeof ncr.elapsedDays === 'number' ? ncr.elapsedDays : calculateElapsedDays(ncr.date || ncr.createdAt),
      priority: ncr.priority || 'Medium',
      severity: ncr.severity || 'Major',
      category: ncr.category || 'Process',
      source: ncr.source || 'Internal',
      verificationStatus: ncr.verificationStatus || 'Pending',
      checklist,
      tags: parseTagsSafe(ncr.tags),
      ownerName: ncr.ownerName || owner?.fullName || '—',
      ownerUser: owner,
      departmentName: ncr.departmentName || getDepartmentNameSafe(ncr.departmentId)
    };
  }

  function getDateRangeLabel() {
    if (state.filter.startDate || state.filter.endDate) {
      const start = state.filter.startDate ? formatDate(state.filter.startDate) : 'البداية';
      const end = state.filter.endDate ? formatDate(state.filter.endDate) : 'الآن';
      return `${start} → ${end}`;
    }

    if (state.filter.month !== null && state.filter.month !== undefined) {
      return `${APP_CONFIG.MONTHS_AR[state.filter.month]} ${state.filter.year}`;
    }

    return 'كل الفترات';
  }

  function getInputDateValue(date) {
    return new Date(date).toISOString().slice(0, 10);
  }

  function buildDateTimeRange() {
    const startDate = state.filter.startDate ? new Date(`${state.filter.startDate}T00:00:00`) : null;
    const endDate = state.filter.endDate ? new Date(`${state.filter.endDate}T23:59:59`) : null;
    return {
      startTime: startDate ? startDate.getTime() : null,
      endTime: endDate ? endDate.getTime() : null
    };
  }

  function chunkItems(items, size) {
    const result = [];
    for (let index = 0; index < items.length; index += size) {
      result.push(items.slice(index, index + size));
    }
    return result;
  }

  function getBrandLogoSource() {
    return state.settings?.logoData || 'assets/icons/vortexflow-ncr-icon.svg';
  }

  function wait(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
  }

  async function waitForVisualAssets(root) {
    if (document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch (_) {
        // Ignore font readiness failures.
      }
    }

    const images = Array.from(root.querySelectorAll('img'));
    await Promise.all(images.map(image => {
      if (image.complete) {
        return Promise.resolve();
      }
      return new Promise(resolve => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
      });
    }));

    await wait(80);
  }

  function getCurrentRole() {
    if (!state.backend?.available) {
      return 'local';
    }

    return state.currentUser?.role || 'guest';
  }

  function formatLastSyncSafe(timestamp) {
    if (!timestamp) {
      return 'لم تتم مزامنة بعد';
    }

    try {
      return new Date(timestamp).toLocaleString('ar-EG', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return 'غير متاح';
    }
  }

  if (typeof window.formatLastSync !== 'function') {
    window.formatLastSync = formatLastSyncSafe;
  }

  function canAccessView(view) {
    const role = getCurrentRole();
    const matrix = {
      dashboard: ['local', 'guest', 'admin', 'engineer', 'viewer'],
      'add-ncr': ['local', 'admin', 'engineer'],
      departments: ['local', 'admin', 'engineer'],
      settings: ['local', 'admin', 'engineer', 'viewer'],
      users: ['local', 'admin']
    };

    return (matrix[view] || matrix.dashboard).includes(role);
  }

  function canManageBrandSettings() {
    return ['local', 'admin'].includes(getCurrentRole());
  }

  function canManageTemplates() {
    return ['local', 'admin', 'engineer'].includes(getCurrentRole());
  }

  function getAccessDeniedMessage(view) {
    const messages = {
      'add-ncr': 'صلاحياتك الحالية لا تسمح بإضافة أو تعديل تقارير NCR.',
      departments: 'إدارة الأقسام والدعوات متاحة فقط للحسابات التشغيلية.',
      users: 'لوحة المستخدمين والحسابات متاحة فقط لمدير النظام.',
      settings: 'يلزم تسجيل الدخول للوصول إلى الإعدادات.'
    };

    return messages[view] || 'لا تملك صلاحية الوصول إلى هذه الصفحة.';
  }

  function getHeaderStatusDetails() {
    if (!state.backend?.available) {
      return {
        tone: 'warning',
        icon: 'fa-triangle-exclamation',
        label: 'وضع محلي',
        detail: 'التطبيق يعمل محلياً على IndexedDB. لتفعيل الحسابات والمزامنة المشتركة استخدم Vercel + Supabase/PostgreSQL.'
      };
    }

    if (!state.currentUser) {
      return {
        tone: 'info',
        icon: state.backend.hasUsers ? 'fa-right-to-bracket' : 'fa-user-plus',
        label: state.backend.hasUsers ? 'الخادم ينتظر الدخول' : 'إعداد الحساب الأول',
        detail: state.backend.hasUsers
          ? 'الخادم متاح لكن يجب تسجيل الدخول لعرض البيانات المشتركة وإدارتها.'
          : 'الخادم متصل ولا يوجد مستخدم إداري بعد. أنشئ أول حساب Admin لبدء التشغيل.'
      };
    }

    return {
      tone: 'success',
      icon: 'fa-cloud',
      label: 'متصل',
      detail: `آخر مزامنة: ${formatLastSyncSafe(state.backend.lastSyncAt)}`
    };
  }

  function ensureHeaderStatusBadge() {
    const brandBlock = document.querySelector('#app-header .header-logo > div:last-child');
    if (!brandBlock || document.getElementById('header-status-badge')) {
      return;
    }

    brandBlock.insertAdjacentHTML(
      'beforeend',
      '<button type="button" id="header-status-badge" class="header-status-badge" onclick="handleHeaderStatusClick()" aria-live="polite"></button>'
    );
  }

  function renderHeaderStatusBadge() {
    ensureHeaderStatusBadge();
    const badge = document.getElementById('header-status-badge');
    const banner = document.getElementById('sync-banner');
    if (!badge) {
      return;
    }

    if (banner) {
      banner.classList.add('hidden');
      banner.setAttribute('aria-hidden', 'true');
    }

    const status = getHeaderStatusDetails();
    badge.className = `header-status-badge ${status.tone}`;
    badge.title = status.detail;
    badge.innerHTML = `
      <i class="fas ${status.icon}" aria-hidden="true"></i>
      <span>${escapeHTML(status.label)}</span>
    `;
  }

  function ensureCustomLogoUpload() {
    const panel = document.querySelector('#view-settings .logo-upload-panel');
    const input = document.getElementById('s-logo-file');
    if (!panel || !input) {
      return;
    }

    input.classList.add('file-input-stealth');
    if (!document.getElementById('settings-logo-upload-trigger')) {
      input.insertAdjacentHTML(
        'afterend',
        `
          <div class="custom-upload-row" id="settings-logo-upload-row">
            <button type="button" class="btn btn-secondary custom-upload-btn" id="settings-logo-upload-trigger" onclick="triggerLogoUploadPicker()">
              <i class="fas fa-cloud-arrow-up" aria-hidden="true"></i>
              اختيار شعار
            </button>
            <div class="custom-upload-meta" id="settings-logo-upload-meta">
              <strong id="settings-logo-upload-name">PNG / JPG / SVG</strong>
              <span id="settings-logo-upload-copy">ارفع نسخة واضحة للشعار لتظهر في الهيدر، شاشة الدخول، وتقارير PDF/PPT.</span>
            </div>
          </div>
        `
      );
    }

    updateCustomLogoUploadState();
  }

  function updateCustomLogoUploadState() {
    const input = document.getElementById('s-logo-file');
    const nameNode = document.getElementById('settings-logo-upload-name');
    const copyNode = document.getElementById('settings-logo-upload-copy');
    if (!input || !nameNode || !copyNode) {
      return;
    }

    const fileName = input.files?.[0]?.name;
    if (fileName) {
      nameNode.textContent = fileName;
      copyNode.textContent = 'تم اختيار الملف. راجع المعاينة ثم احفظ الإعدادات لتثبيت الشعار.';
      return;
    }

    if (state.settings?.logoData) {
      nameNode.textContent = 'شعار المؤسسة الحالي';
      copyNode.textContent = 'يوجد شعار نشط حالياً ويمكنك استبداله أو إزالته.';
      return;
    }

    nameNode.textContent = 'PNG / JPG / SVG';
    copyNode.textContent = 'ارفع نسخة واضحة للشعار لتظهر في الهيدر، شاشة الدخول، وتقارير PDF/PPT.';
  }

  function markSettingsCards() {
    const cards = document.querySelectorAll('#view-settings .settings-layout > .section-card');
    if (cards[0]) cards[0].dataset.settingsCard = 'organization';
    if (cards[1]) cards[1].dataset.settingsCard = 'templates';
    if (cards[2]) cards[2].dataset.settingsCard = 'reports';
  }

  function setSettingsCardAccess(card, restricted, message) {
    if (!card) {
      return;
    }

    card.classList.toggle('section-card-restricted', restricted);
    let note = card.querySelector('.settings-access-note');

    if (restricted) {
      if (!note) {
        card.insertAdjacentHTML(
          'afterbegin',
          `
            <div class="settings-access-note">
              <i class="fas fa-lock" aria-hidden="true"></i>
              <span class="settings-access-note-copy"></span>
            </div>
          `
        );
        note = card.querySelector('.settings-access-note');
      }

      const copy = note.querySelector('.settings-access-note-copy');
      if (copy) {
        copy.textContent = message;
      }
    } else {
      note?.remove();
    }

    card.querySelectorAll('input, select, textarea, button').forEach(control => {
      if (control.closest('.settings-access-note')) {
        return;
      }
      control.disabled = restricted;
    });
  }

  function applySettingsPermissions() {
    markSettingsCards();
    const cards = document.querySelectorAll('#view-settings .settings-layout > .section-card');
    cards.forEach(card => {
      const kind = card.dataset.settingsCard;
      if (kind === 'organization') {
        setSettingsCardAccess(card, !canManageBrandSettings(), 'تخصيص الهوية واللوجو متاح فقط لمدير النظام.');
      } else if (kind === 'templates') {
        setSettingsCardAccess(card, !canManageTemplates(), 'إدارة القوالب متاحة للحسابات التشغيلية فقط.');
      } else {
        setSettingsCardAccess(card, false, '');
      }
    });
  }

  function setControlVisibility(element, visible) {
    if (!element) {
      return;
    }

    element.classList.toggle('is-permission-hidden', !visible);
    element.disabled = !visible;
    element.setAttribute('aria-hidden', visible ? 'false' : 'true');
    if (!visible) {
      element.removeAttribute('aria-current');
      element.tabIndex = -1;
    } else {
      element.removeAttribute('tabindex');
    }
  }

  function applyPermissionUI() {
    setControlVisibility(document.getElementById('nav-add-ncr'), canAccessView('add-ncr'));
    setControlVisibility(document.getElementById('nav-departments'), canAccessView('departments'));
    setControlVisibility(document.getElementById('nav-settings'), canAccessView('settings'));
    setControlVisibility(document.getElementById('nav-users'), canAccessView('users'));

    const settingsShortcut = document.querySelector('.header-actions button[onclick*="navigateTo(\'settings\')"]');
    setControlVisibility(settingsShortcut, canAccessView('settings'));

    const fab = document.getElementById('fab');
    if (fab) {
      fab.setAttribute('hidden', 'hidden');
      fab.setAttribute('aria-hidden', 'true');
    }

    ensureCustomLogoUpload();
    renderHeaderStatusBadge();
    applySettingsPermissions();
  }

  function buildEmptyStateCard({ title, message, actionLabel, actionHandler, tone = 'default' }) {
    return `
      <div class="empty-state enhanced-empty-state ${tone}">
        <div class="empty-state-illustration" aria-hidden="true">
          <svg viewBox="0 0 240 160" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="26" y="28" width="188" height="104" rx="24" fill="rgba(17,27,44,0.92)" stroke="rgba(245,158,11,0.18)"/>
            <circle cx="76" cy="80" r="22" fill="rgba(59,130,246,0.12)"/>
            <path d="M65 80l8 8 16-16" stroke="#60A5FA" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M118 64h56" stroke="rgba(232,240,254,0.88)" stroke-width="10" stroke-linecap="round"/>
            <path d="M118 88h42" stroke="rgba(122,143,181,0.92)" stroke-width="10" stroke-linecap="round"/>
            <path d="M42 118h156" stroke="rgba(245,158,11,0.16)" stroke-width="8" stroke-linecap="round"/>
          </svg>
        </div>
        <h3>${escapeHTML(title)}</h3>
        <p>${escapeHTML(message)}</p>
        ${actionLabel && actionHandler ? `<button type="button" class="btn btn-secondary btn-sm" onclick="${actionHandler}">${escapeHTML(actionLabel)}</button>` : ''}
      </div>
    `;
  }

  async function cleanupLegacyDemoData() {
    if (state.backend?.available || localStorage.getItem(DEMO_CLEANUP_KEY) === '1') {
      return;
    }

    const caseNumbers = state.ncrs.map(item => String(item.caseNumber || '').trim()).filter(Boolean);
    const departmentNames = state.departments.map(item => String(item.name || '').trim()).filter(Boolean);
    const assignees = state.invitations.map(item => String(item.assignee || '').trim()).filter(Boolean);

    const seededCasesOnly = caseNumbers.length > 0 && caseNumbers.every(item => DEMO_CASES.has(item));
    const seededDepartmentsOnly = departmentNames.length > 0 && departmentNames.every(item => DEMO_DEPARTMENTS.has(item));
    const seededInvitationsOnly = assignees.length > 0 && assignees.every(item => DEMO_ASSIGNEES.has(item));
    const shouldCleanup = (seededCasesOnly || caseNumbers.length === 0) && (seededDepartmentsOnly || seededInvitationsOnly);

    if (!shouldCleanup) {
      localStorage.setItem(DEMO_CLEANUP_KEY, '1');
      return;
    }

    await Promise.all([ncrStore.clear(), deptStore.clear(), invStore.clear()]);
    state.ncrs = [];
    state.departments = [];
    state.invitations = [];
    localStorage.setItem(DEMO_CLEANUP_KEY, '1');
    showToast('تم تنظيف البيانات الافتراضية القديمة من الأقسام وسجل الدعوات.', 'info');
  }

  function summarizeFilteredItems() {
    const items = (window.getFilteredNCRs ? window.getFilteredNCRs() : [])
      .map(normalizeNcrForPlus)
      .filter(Boolean);

    const summary = {
      total: items.length,
      open: items.filter(item => item.status === 'Open').length,
      inProgress: items.filter(item => item.status === 'In Progress').length,
      closed: items.filter(item => item.status === 'Closed').length,
      verified: items.filter(item => item.verificationStatus === 'Verified').length,
      overdue: items.filter(item => item.dueDate && toTime(item.dueDate) < Date.now() && item.status !== 'Closed').length,
      critical: items.filter(item => item.priority === 'Critical' || item.severity === 'Critical').length
    };

    return { items, summary };
  }

  function getPriorityBreakdown(items) {
    const buckets = ['Low', 'Medium', 'High', 'Critical'];
    return buckets.map(key => ({
      key,
      label: APP_CONFIG.PRIORITY_LABELS?.[key] || key,
      value: items.filter(item => (item.priority || 'Medium') === key).length
    }));
  }

  function getDepartmentBreakdown(items) {
    const map = new Map();
    items.forEach(item => {
      const key = item.departmentName || 'غير محدد';
      map.set(key, (map.get(key) || 0) + 1);
    });
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value)
      .slice(0, 6);
  }

  function getMonthlyTrend(items) {
    const map = new Map();
    items.forEach(item => {
      const date = new Date(item.date || item.createdAt || Date.now());
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const label = `${APP_CONFIG.MONTHS_AR[date.getMonth()]} ${date.getFullYear()}`;
      map.set(key, { label, value: (map.get(key)?.value || 0) + 1 });
    });
    return [...map.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([, value]) => value)
      .slice(-6);
  }

  function ensureDateRangeControls() {
    const filterSection = document.querySelector('#view-dashboard .filter-section');
    if (!filterSection || document.getElementById('date-range-filter')) {
      return;
    }

    filterSection.insertAdjacentHTML('beforeend', `
      <div class="filter-row" id="date-range-filter">
        <span class="filter-label">الفترة:</span>
        <div class="date-range-grid">
          <input id="filter-start-date" class="form-control" type="date" aria-label="من تاريخ">
          <input id="filter-end-date" class="form-control" type="date" aria-label="إلى تاريخ">
          <button type="button" class="btn btn-secondary btn-sm" onclick="applyDateRangeFilter()">تطبيق</button>
          <button type="button" class="btn btn-outline btn-sm" onclick="clearDateRangeFilter()">مسح</button>
        </div>
      </div>
      <div class="filter-row">
        <span class="filter-label">سريع:</span>
        <div class="filter-pills quick-range-pills" role="group" aria-label="فترات سريعة">
          <button class="filter-pill" type="button" onclick="applyQuickDateRange(7)">7 أيام</button>
          <button class="filter-pill" type="button" onclick="applyQuickDateRange(30)">30 يوم</button>
          <button class="filter-pill" type="button" onclick="applyQuickDateRange(90)">90 يوم</button>
          <button class="filter-pill" type="button" onclick="applyQuickDateRange('year')">هذه السنة</button>
        </div>
      </div>
    `);
  }

  function syncDateRangeInputs() {
    const startInput = document.getElementById('filter-start-date');
    const endInput = document.getElementById('filter-end-date');
    if (startInput) {
      startInput.value = state.filter.startDate || '';
    }
    if (endInput) {
      endInput.value = state.filter.endDate || '';
    }
  }

  function ensureAnalyticsShell() {
    const dashboardOps = document.getElementById('dashboard-ops');
    if (dashboardOps && !document.getElementById('dashboard-analytics')) {
      dashboardOps.insertAdjacentHTML('afterend', '<section id="dashboard-analytics" class="analytics-shell"></section>');
    }
  }

  function ensureInquiryShell() {
    const analytics = document.getElementById('dashboard-analytics');
    if (analytics && !document.getElementById('dashboard-inquiry')) {
      analytics.insertAdjacentHTML('afterend', '<section id="dashboard-inquiry" class="section-card inquiry-shell"></section>');
    }
  }

  function ensureExportEnhancements() {
    const exportSheet = document.querySelector('#export-sheet-overlay .bottom-sheet');
    if (!exportSheet || document.getElementById('enhanced-export-grid')) {
      return;
    }

    exportSheet.insertAdjacentHTML('beforeend', `
      <div class="sheet-divider"></div>
      <div class="sheet-section-label">تقارير متقدمة ومشاركة مباشرة</div>
      <div class="sheet-grid" id="enhanced-export-grid">
        <button class="export-btn pdf" onclick="exportMonthlyPDF()" aria-label="تقرير شهري PDF">
          <i class="fas fa-calendar-days" aria-hidden="true"></i>
          <span>PDF شهري</span>
        </button>
        <button class="export-btn pptx" onclick="exportCurrentRecordPPTX()" aria-label="تقرير فردي PowerPoint">
          <i class="fas fa-display" aria-hidden="true"></i>
          <span>PPT فردي</span>
        </button>
        <button class="export-btn share" onclick="shareFilteredSummaryViaWhatsApp()" aria-label="مشاركة واتساب">
          <i class="fab fa-whatsapp" aria-hidden="true"></i>
          <span>واتساب</span>
        </button>
        <button class="export-btn share" onclick="shareFilteredSummaryViaEmail()" aria-label="مشاركة بريد">
          <i class="fas fa-envelope" aria-hidden="true"></i>
          <span>بريد</span>
        </button>
      </div>
    `);
  }

  function ensureDetailEnhancements() {
    const footer = document.querySelector('#ncr-detail-modal .modal-footer');
    if (!footer || document.getElementById('detail-pdf-btn')) {
      return;
    }

    footer.insertAdjacentHTML('beforeend', `
      <button class="btn btn-secondary btn-sm" id="detail-pdf-btn" onclick="exportCurrentRecordPDF()">
        <i class="fas fa-file-pdf" aria-hidden="true"></i>
        PDF
      </button>
      <button class="btn btn-secondary btn-sm" id="detail-ppt-btn" onclick="exportCurrentRecordPPTX()">
        <i class="fas fa-file-powerpoint" aria-hidden="true"></i>
        PPT
      </button>
      <button class="btn btn-outline btn-sm" id="detail-whatsapp-btn" onclick="shareCurrentRecordViaWhatsApp()">
        <i class="fab fa-whatsapp" aria-hidden="true"></i>
        واتساب
      </button>
      <button class="btn btn-outline btn-sm" id="detail-email-btn" onclick="shareCurrentRecordViaEmail()">
        <i class="fas fa-envelope" aria-hidden="true"></i>
        بريد
      </button>
    `);
  }

  function ensureUserEnhancements() {
    const userForm = document.getElementById('user-form');
    if (userForm && !document.getElementById('u-job-title')) {
      const rows = userForm.querySelectorAll('.form-row');
      rows[rows.length - 1]?.insertAdjacentHTML('afterend', `
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="u-job-title">المسمى الوظيفي</label>
            <input id="u-job-title" class="form-control" type="text" placeholder="مثال: مشرف الجودة">
          </div>
          <div class="form-group">
            <label class="form-label" for="u-is-verified">التحقق</label>
            <label class="setting-toggle user-verify-toggle">
              <input id="u-is-verified" type="checkbox">
              <span>علامة تحقق للحساب</span>
            </label>
          </div>
        </div>
      `);
    }

    const userAdminForm = document.getElementById('user-admin-form');
    if (userAdminForm && !document.getElementById('ua-job-title')) {
      const roleGroup = document.getElementById('ua-role')?.closest('.form-group');
      roleGroup?.parentElement?.insertAdjacentHTML('afterend', `
        <div class="form-group">
          <label class="form-label" for="ua-job-title">المسمى الوظيفي</label>
          <input id="ua-job-title" class="form-control" type="text" placeholder="مثال: قائد العمليات">
        </div>
        <div class="toggle-grid">
          <label class="setting-toggle">
            <input id="ua-is-verified" type="checkbox">
            <span>مستخدم موثق</span>
          </label>
        </div>
      `);
    }
  }

  function ensureAccountEnhancements() {
    const settingsLayout = document.querySelector('#view-settings .settings-layout');
    if (!settingsLayout || document.getElementById('account-security-card')) {
      return;
    }

    settingsLayout.insertAdjacentHTML('beforeend', `
      <div class="section-card" id="account-security-card">
        <div class="section-card-head">
          <div>
            <div class="section-card-title">حسابي والأمان</div>
            <div class="section-card-subtitle">تغيير كلمة المرور وبيانات الهوية الحالية</div>
          </div>
        </div>
        <div id="account-security-summary" class="settings-summary" style="margin-bottom:14px"></div>
        <form id="account-password-form" onsubmit="handleAccountPasswordSubmit(event)">
          <div class="form-row">
            <div class="form-group">
              <label class="form-label required" for="account-current-password">كلمة المرور الحالية</label>
              <input id="account-current-password" class="form-control" type="password" minlength="8" required>
            </div>
            <div class="form-group">
              <label class="form-label required" for="account-new-password">كلمة المرور الجديدة</label>
              <input id="account-new-password" class="form-control" type="password" minlength="8" required>
            </div>
          </div>
          <div class="btn-group">
            <button type="submit" class="btn btn-primary">
              <i class="fas fa-key" aria-hidden="true"></i>
              تغيير كلمة المرور
            </button>
          </div>
        </form>
      </div>
    `);
  }

  function renderAccountSecuritySummary() {
    const container = document.getElementById('account-security-summary');
    if (!container) {
      return;
    }

    if (!state.currentUser) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-user-lock"></i><h3>الدخول مطلوب</h3><p>سجل الدخول أولاً لتحديث كلمة المرور وبيانات حسابك.</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="settings-summary-item">
        <span>الاسم</span>
        <strong>${escapeHTML(state.currentUser.fullName || '—')}</strong>
      </div>
      <div class="settings-summary-item">
        <span>الدور</span>
        <strong>${escapeHTML(getRoleLabel(state.currentUser.role))}</strong>
      </div>
      <div class="settings-summary-item">
        <span>المسمى</span>
        <strong>${escapeHTML(getUserTitle(state.currentUser))}</strong>
      </div>
      <div class="settings-summary-item">
        <span>التحقق</span>
        <strong>${isUserVerified(state.currentUser) ? 'موثق' : 'غير موثق'}</strong>
      </div>
    `;
  }

  function ensureSecretModal() {
    if (!document.getElementById('secret-easter-egg-modal')) {
      document.body.insertAdjacentHTML('beforeend', SECRET_MODAL_HTML);
    }
  }

  function ensureExportStage() {
    if (!document.getElementById('export-stage')) {
      document.body.insertAdjacentHTML('beforeend', '<section id="export-stage" class="report-stage" aria-hidden="true"></section>');
    }
  }

  function buildVerificationBadge(user) {
    if (!isUserVerified(user)) {
      return '';
    }
    return `<button type="button" class="verify-badge" onclick="showUserVerificationInfo('${user.id}')" title="عرض المسمى الوظيفي"><i class="fas fa-circle-check" aria-hidden="true"></i></button>`;
  }

  function enhanceHeaderSession() {
    const container = document.getElementById('header-session');
    if (!container || !state.currentUser) {
      return;
    }

    container.innerHTML = `
      <div class="session-chip enhanced">
        <span class="sync-dot"></span>
        <span>${escapeHTML(state.currentUser.fullName)}</span>
        ${buildVerificationBadge(state.currentUser)}
        <span class="session-chip-role">${escapeHTML(getRoleLabel(state.currentUser.role))}</span>
        <span class="session-chip-title">${escapeHTML(getUserTitle(state.currentUser))}</span>
      </div>
      <button type="button" class="btn btn-secondary btn-sm" onclick="navigateTo('settings')">حسابي</button>
      <button type="button" class="btn btn-secondary btn-sm" onclick="logoutCurrentUser()">خروج</button>
    `;
  }

  function renderAnalyticsDashboard() {
    const container = document.getElementById('dashboard-analytics');
    if (!container) {
      return;
    }

    const { items, summary } = summarizeFilteredItems();
    if (!items.length) {
      container.innerHTML = '';
      return;
    }

    const statusGradient = `conic-gradient(#3b82f6 0 ${summary.total ? (summary.open / summary.total) * 360 : 0}deg, #f59e0b 0 ${summary.total ? ((summary.open + summary.inProgress) / summary.total) * 360 : 0}deg, #10b981 0 360deg)`;
    const priorities = getPriorityBreakdown(items);
    const departments = getDepartmentBreakdown(items);
    const monthlyTrend = getMonthlyTrend(items);
    const maxPriority = Math.max(...priorities.map(item => item.value), 1);
    const maxDepartment = Math.max(...departments.map(item => item.value), 1);
    const maxTrend = Math.max(...monthlyTrend.map(item => item.value), 1);

    container.innerHTML = `
      <div class="analytics-card analytics-card--donut">
        <div class="analytics-title">تحليل الحالة الحالية</div>
        <div class="analytics-donut" style="--donut:${statusGradient}">
          <div class="analytics-donut-hole">
            <strong>${summary.total}</strong>
            <span>حالة</span>
          </div>
        </div>
        <div class="analytics-legend">
          <span><i style="background:#3b82f6"></i>مفتوح</span>
          <span><i style="background:#f59e0b"></i>جاري العمل</span>
          <span><i style="background:#10b981"></i>مغلق</span>
        </div>
      </div>
      <div class="analytics-card">
        <div class="analytics-title">الأولوية</div>
        <div class="analytics-bars">
          ${priorities.map(item => `
            <div class="analytics-bar-row">
              <span>${escapeHTML(item.label)}</span>
              <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${(item.value / maxPriority) * 100}%"></div></div>
              <strong>${item.value}</strong>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="analytics-card">
        <div class="analytics-title">أكثر الأقسام نشاطاً</div>
        <div class="analytics-bars">
          ${departments.length ? departments.map(item => `
            <div class="analytics-bar-row">
              <span>${escapeHTML(item.label)}</span>
              <div class="analytics-bar-track"><div class="analytics-bar-fill alt" style="width:${(item.value / maxDepartment) * 100}%"></div></div>
              <strong>${item.value}</strong>
            </div>
          `).join('') : '<div class="text-subtle fs-xs">لا توجد أقسام مرتبطة بالفلاتر الحالية.</div>'}
        </div>
      </div>
      <div class="analytics-card">
        <div class="analytics-title">اتجاه التقارير</div>
        <div class="trend-chart">
          ${monthlyTrend.length ? monthlyTrend.map(item => `
            <div class="trend-bar-col">
              <div class="trend-bar-wrap"><div class="trend-bar" style="height:${Math.max(14, (item.value / maxTrend) * 100)}%"></div></div>
              <strong>${item.value}</strong>
              <span>${escapeHTML(item.label)}</span>
            </div>
          `).join('') : '<div class="text-subtle fs-xs">لا توجد بيانات كافية لبناء المنحنى.</div>'}
        </div>
      </div>
    `;
  }

  window.handleHeaderStatusClick = async function handleHeaderStatusClick() {
    const status = getHeaderStatusDetails();

    if (!state.backend?.available) {
      showToast(status.detail, 'info');
      return;
    }

    if (!state.currentUser) {
      showToast(status.detail, 'warning');
      window.openAuthModal?.();
      return;
    }

    if (typeof window.syncNow === 'function') {
      await window.syncNow();
      return;
    }

    showToast(status.detail, 'info');
  };

  window.triggerLogoUploadPicker = function triggerLogoUploadPicker() {
    document.getElementById('s-logo-file')?.click();
  };

  window.retryUsersConnection = async function retryUsersConnection() {
    try {
      await window.loadAllData();
      window.renderDashboard();
      if (state.view === 'users') {
        window.renderUsersView();
      }
      showToast('تم تحديث حالة الاتصال والبيانات.', 'success');
    } catch (error) {
      showToast(error.message || 'تعذر إعادة محاولة الاتصال الآن.', 'error');
    }
  };

  function buildInquiryTimeline(record) {
    const statusSteps = ['Open', 'In Progress', 'Closed'];
    const currentIndex = statusSteps.indexOf(record.status);

    return `
      <div class="inquiry-timeline">
        ${statusSteps.map((step, index) => `
          <div class="inquiry-step ${index <= currentIndex ? 'active' : ''}">
            <span>${escapeHTML(getStatusLabel(step))}</span>
          </div>
        `).join('')}
      </div>
    `;
  }

  function findInquiryRecord(query) {
    const normalizedQuery = String(query || '').trim().toLowerCase();
    if (!normalizedQuery) {
      return null;
    }

    return state.ncrs
      .map(normalizeNcrForPlus)
      .find(item => [
        item.caseNumber,
        item.description,
        item.subCase,
        item.ownerName,
        item.departmentName
      ]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(normalizedQuery))) || null;
  }

  function renderInquiryPanel() {
    const container = document.getElementById('dashboard-inquiry');
    if (!container) {
      return;
    }

    const record = findInquiryRecord(state.inquiryQuery);
    const attachmentSource = record ? getAttachmentSourceSafe(record.attachedDocument) : '';
    const attachmentMarkup = record?.attachedDocument
      ? (record.attachedDocument.type || '').startsWith('image/')
        ? `<img src="${attachmentSource}" alt="مرفق الحالة" class="inquiry-attachment" loading="lazy">`
        : `<a class="btn btn-secondary btn-sm" href="${attachmentSource}" download="${escapeHTML(record.attachedDocument.name)}"><i class="fas fa-download" aria-hidden="true"></i>${escapeHTML(record.attachedDocument.name)}</a>`
      : '<span class="text-subtle fs-xs">لا يوجد مرفق</span>';

    container.innerHTML = `
      <div class="section-card-head">
        <div>
          <div class="section-card-title">منطقة الاستعلام السريع</div>
          <div class="section-card-subtitle">ابحث برقم الحالة أو الوصف لمعرفة هل تم الحل أم ما زال جاري العمل</div>
        </div>
      </div>
      <form class="inquiry-form" onsubmit="submitInquirySearch(event)">
        <input id="inquiry-input" class="form-control" type="search" placeholder="مثال: NCR-2026-0004" value="${escapeHTML(state.inquiryQuery || '')}">
        <button type="submit" class="btn btn-primary btn-sm">استعلام</button>
        <button type="button" class="btn btn-outline btn-sm" onclick="clearInquirySearch()">مسح</button>
      </form>
      ${record ? `
        <div class="inquiry-result">
          <div class="inquiry-header">
            <div>
              <div class="inquiry-case-number">${escapeHTML(record.caseNumber)}</div>
              <div class="inquiry-meta">${escapeHTML(getCategoryLabel(record.category))} • ${escapeHTML(record.departmentName)}</div>
            </div>
            <div class="metrics-inline">
              <span class="badge badge-blue">${escapeHTML(getStatusLabel(record.status))}</span>
              <span class="badge ${record.verificationStatus === 'Verified' ? 'badge-green' : record.verificationStatus === 'Ready' ? 'badge-amber' : 'badge-gray'}">${escapeHTML(getVerificationLabel(record.verificationStatus))}</span>
            </div>
          </div>
          ${buildInquiryTimeline(record)}
          <div class="inquiry-grid">
            <div class="inquiry-panel"><div class="inquiry-label">الوصف</div><div class="inquiry-value">${escapeHTML(record.description || '—')}</div></div>
            <div class="inquiry-panel"><div class="inquiry-label">المسؤول</div><div class="inquiry-value">${escapeHTML(record.ownerName || '—')}</div></div>
            <div class="inquiry-panel"><div class="inquiry-label">المسمى</div><div class="inquiry-value">${escapeHTML(getUserTitle(record.ownerUser))}</div></div>
            <div class="inquiry-panel"><div class="inquiry-label">الاستحقاق</div><div class="inquiry-value">${record.dueDate ? escapeHTML(formatDate(record.dueDate)) : '—'}</div></div>
          </div>
          <div class="inquiry-attachment-wrap">${attachmentMarkup}</div>
          <div class="btn-group inquiry-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick="openNCRDetail('${record.id}')">فتح التفاصيل</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="exportRecordByIdPDF('${record.id}')">PDF فردي</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="shareNCRViaWhatsApp('${record.id}')">واتساب</button>
            <button type="button" class="btn btn-outline btn-sm" onclick="shareNCRViaEmail('${record.id}')">بريد</button>
          </div>
        </div>
      ` : `
        <div class="empty-state compact">
          <i class="fas fa-magnifying-glass-chart" aria-hidden="true"></i>
          <h3>${state.inquiryQuery ? 'لا توجد نتيجة مطابقة' : 'ابدأ بالاستعلام'}</h3>
          <p>${state.inquiryQuery ? 'جرّب رقم حالة آخر أو جزءاً من الوصف.' : 'سيظهر هنا ملخص الحالة، وضع المعالجة، التحقق، والمرفق.'}</p>
        </div>
      `}
    `;
  }

  function buildCaseShareText(record) {
    const attachmentSource = getAttachmentSourceSafe(record.attachedDocument);
    return [
      `VortexFlow NCR`,
      `رقم الحالة: ${record.caseNumber}`,
      `الحالة: ${getStatusLabel(record.status)}`,
      `التحقق: ${getVerificationLabel(record.verificationStatus)}`,
      `الوصف: ${record.description || '—'}`,
      `القسم: ${record.departmentName || '—'}`,
      `المسؤول: ${record.ownerName || '—'}`,
      record.dueDate ? `الاستحقاق: ${formatDate(record.dueDate)}` : null,
      attachmentSource ? `المرفق: ${attachmentSource}` : null,
      `تم الإنشاء عبر ${APP_CONFIG.appName}`
    ].filter(Boolean).join('\n');
  }

  function buildSummaryShareText() {
    const { items, summary } = summarizeFilteredItems();
    return [
      `ملخص ${APP_CONFIG.appName}`,
      `الفترة: ${getDateRangeLabel()}`,
      `الإجمالي: ${summary.total}`,
      `مفتوح: ${summary.open}`,
      `جاري العمل: ${summary.inProgress}`,
      `مغلق: ${summary.closed}`,
      `متحقق: ${summary.verified}`,
      `حرج: ${summary.critical}`,
      `عدد العناصر المعروضة: ${items.length}`
    ].join('\n');
  }

  function openShareUrl(url) {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  async function nativeShareFallback(title, text) {
    if (navigator.share) {
      try {
        await navigator.share({ title, text });
        return true;
      } catch (error) {
        if (error?.name === 'AbortError') {
          return true;
        }
      }
    }

    try {
      await navigator.clipboard.writeText(text);
      showToast('تم نسخ النص إلى الحافظة.', 'success');
      return true;
    } catch (_) {
      return false;
    }
  }

  function buildReportModel(kind, recordId = null) {
    const { items, summary } = summarizeFilteredItems();
    const createdAt = Date.now();
    const rangeLabel = getDateRangeLabel();

    if (kind === 'single') {
      const record = normalizeNcrForPlus(state.ncrs.find(item => item.id === recordId || item.caseNumber === recordId));
      if (!record) {
        throw new Error('التقرير المطلوب غير موجود.');
      }
      return {
        kind,
        title: `تقرير فردي ${record.caseNumber}`,
        subtitle: `${getStatusLabel(record.status)} • ${getVerificationLabel(record.verificationStatus)}`,
        rangeLabel,
        summary,
        createdAt,
        items: [record],
        record
      };
    }

    const sourceItems = kind === 'monthly'
      ? items.filter(item => {
          const reference = new Date(item.date || item.createdAt || Date.now());
          const targetMonth = state.filter.month !== null && state.filter.month !== undefined ? state.filter.month : new Date().getMonth();
          const targetYear = state.filter.year || new Date().getFullYear();
          return reference.getMonth() === targetMonth && reference.getFullYear() === targetYear;
        })
      : items;

    return {
      kind,
      title: kind === 'monthly' ? 'التقرير الشهري NCR' : 'تقرير الفلتر الحالي NCR',
      subtitle: rangeLabel,
      rangeLabel,
      summary,
      createdAt,
      items: sourceItems
    };
  }

  function buildReportPages(model) {
    const pages = [];
    const priorities = getPriorityBreakdown(model.items);
    const departments = getDepartmentBreakdown(model.items);
    const trend = getMonthlyTrend(model.items);
    const topPriority = Math.max(...priorities.map(item => item.value), 1);
    const topDepartment = Math.max(...departments.map(item => item.value), 1);
    const topTrend = Math.max(...trend.map(item => item.value), 1);
    const statusGradient = `conic-gradient(#3b82f6 0 ${model.summary.total ? (model.summary.open / model.summary.total) * 360 : 0}deg, #f59e0b 0 ${model.summary.total ? ((model.summary.open + model.summary.inProgress) / model.summary.total) * 360 : 0}deg, #10b981 0 360deg)`;

    pages.push(`
      <article class="report-page">
        <div class="report-hero">
          <div class="report-brand">
            <img src="${getBrandLogoSource()}" alt="VortexFlow NCR" class="report-logo">
            <div>
              <div class="report-org">${escapeHTML(state.settings?.orgName || 'VortexFlow NCR')}</div>
              <div class="report-title">${escapeHTML(model.title)}</div>
              <div class="report-subtitle">${escapeHTML(model.subtitle)}</div>
            </div>
          </div>
          <div class="report-meta-box">
            <div>Generated: ${escapeHTML(formatDateTime(model.createdAt))}</div>
            <div>Period: ${escapeHTML(model.rangeLabel)}</div>
          </div>
        </div>
        <div class="report-metrics">
          <div class="report-metric"><strong>${model.items.length}</strong><span>عدد الحالات</span></div>
          <div class="report-metric"><strong>${model.summary.open}</strong><span>مفتوح</span></div>
          <div class="report-metric"><strong>${model.summary.inProgress}</strong><span>جاري العمل</span></div>
          <div class="report-metric"><strong>${model.summary.closed}</strong><span>مغلق</span></div>
          <div class="report-metric"><strong>${model.summary.critical}</strong><span>حرج</span></div>
          <div class="report-metric"><strong>${model.summary.verified}</strong><span>تم التحقق</span></div>
        </div>
        <div class="report-grid">
          <section class="report-panel">
            <div class="report-panel-title">حالة التقارير</div>
            <div class="analytics-donut report-donut" style="--donut:${statusGradient}">
              <div class="analytics-donut-hole">
                <strong>${model.summary.total}</strong>
                <span>حالة</span>
              </div>
            </div>
          </section>
          <section class="report-panel">
            <div class="report-panel-title">الأولوية</div>
            ${priorities.map(item => `
              <div class="analytics-bar-row">
                <span>${escapeHTML(item.label)}</span>
                <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${(item.value / topPriority) * 100}%"></div></div>
                <strong>${item.value}</strong>
              </div>
            `).join('')}
          </section>
          <section class="report-panel">
            <div class="report-panel-title">الأقسام</div>
            ${departments.length ? departments.map(item => `
              <div class="analytics-bar-row">
                <span>${escapeHTML(item.label)}</span>
                <div class="analytics-bar-track"><div class="analytics-bar-fill alt" style="width:${(item.value / topDepartment) * 100}%"></div></div>
                <strong>${item.value}</strong>
              </div>
            `).join('') : '<div class="text-subtle fs-xs">لا توجد أقسام مرتبطة.</div>'}
          </section>
          <section class="report-panel">
            <div class="report-panel-title">اتجاه الشهور</div>
            <div class="trend-chart">
              ${trend.length ? trend.map(item => `
                <div class="trend-bar-col">
                  <div class="trend-bar-wrap"><div class="trend-bar" style="height:${Math.max(14, (item.value / topTrend) * 100)}%"></div></div>
                  <strong>${item.value}</strong>
                  <span>${escapeHTML(item.label)}</span>
                </div>
              `).join('') : '<div class="text-subtle fs-xs">لا توجد بيانات كافية.</div>'}
            </div>
          </section>
        </div>
      </article>
    `);

    if (model.kind === 'single' && model.record) {
      const record = model.record;
      const attachmentSource = getAttachmentSourceSafe(record.attachedDocument);
      const attachmentMarkup = record.attachedDocument
        ? (record.attachedDocument.type || '').startsWith('image/')
          ? `<img src="${attachmentSource}" alt="مرفق الحالة" class="report-attachment-image">`
          : `<div class="report-attachment-file">${escapeHTML(record.attachedDocument.name || 'مرفق')}</div>`
        : '<div class="report-attachment-file">لا يوجد مرفق</div>';

      pages.push(`
        <article class="report-page">
          <div class="report-panel-title">تفاصيل التقرير الفردي</div>
          <div class="report-detail-grid">
            <div class="report-detail-card"><span>رقم الحالة</span><strong>${escapeHTML(record.caseNumber)}</strong></div>
            <div class="report-detail-card"><span>الحالة</span><strong>${escapeHTML(getStatusLabel(record.status))}</strong></div>
            <div class="report-detail-card"><span>التحقق</span><strong>${escapeHTML(getVerificationLabel(record.verificationStatus))}</strong></div>
            <div class="report-detail-card"><span>الأولوية</span><strong>${escapeHTML(APP_CONFIG.PRIORITY_LABELS?.[record.priority] || record.priority)}</strong></div>
            <div class="report-detail-card"><span>القسم</span><strong>${escapeHTML(record.departmentName)}</strong></div>
            <div class="report-detail-card"><span>المسؤول</span><strong>${escapeHTML(record.ownerName)}</strong></div>
            <div class="report-detail-card wide"><span>الوصف</span><strong>${escapeHTML(record.description || '—')}</strong></div>
            <div class="report-detail-card wide"><span>الإجراء الاحتوائي</span><strong>${escapeHTML(record.containmentAction || '—')}</strong></div>
            <div class="report-detail-card wide"><span>السبب الجذري</span><strong>${escapeHTML(record.rootCause || '—')}</strong></div>
            <div class="report-detail-card wide"><span>الإجراء التصحيحي</span><strong>${escapeHTML(record.correctiveAction || '—')}</strong></div>
          </div>
          <div class="report-grid">
            <section class="report-panel">
              <div class="report-panel-title">Checklist</div>
              <div class="report-checklist">
                ${record.checklist.length ? record.checklist.map(item => `<div class="report-checklist-item ${item.done ? 'done' : ''}">${item.done ? '✓' : '•'} ${escapeHTML(item.label)}</div>`).join('') : '<div class="text-subtle fs-xs">لا توجد عناصر تحقق.</div>'}
              </div>
            </section>
            <section class="report-panel">
              <div class="report-panel-title">المرفق</div>
              ${attachmentMarkup}
            </section>
          </div>
        </article>
      `);
    } else {
      chunkItems(model.items, REPORT_ROWS_PER_PAGE).forEach((chunk, index, chunks) => {
        pages.push(`
          <article class="report-page">
            <div class="report-panel-title">سجل الحالات — صفحة ${index + 1} من ${chunks.length}</div>
            <table class="report-table">
              <thead>
                <tr>
                  <th>رقم الحالة</th>
                  <th>الوصف</th>
                  <th>الحالة</th>
                  <th>التحقق</th>
                  <th>الأولوية</th>
                  <th>القسم</th>
                  <th>المسؤول</th>
                  <th>التاريخ</th>
                </tr>
              </thead>
              <tbody>
                ${chunk.map(item => `
                  <tr>
                    <td>${escapeHTML(item.caseNumber)}</td>
                    <td>${escapeHTML(item.description || '')}</td>
                    <td>${escapeHTML(getStatusLabel(item.status))}</td>
                    <td>${escapeHTML(getVerificationLabel(item.verificationStatus))}</td>
                    <td>${escapeHTML(APP_CONFIG.PRIORITY_LABELS?.[item.priority] || item.priority)}</td>
                    <td>${escapeHTML(item.departmentName)}</td>
                    <td>${escapeHTML(item.ownerName)}</td>
                    <td>${escapeHTML(formatDate(item.date || item.createdAt))}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </article>
        `);
      });
    }

    return pages;
  }

  async function renderReportPagesToStage(model) {
    if (!window.html2canvas) {
      throw new Error('مكتبة HTML2Canvas غير متاحة حالياً.');
    }

    ensureExportStage();
    const stage = document.getElementById('export-stage');
    stage.innerHTML = buildReportPages(model).join('');
    stage.classList.add('active');
    await waitForVisualAssets(stage);
    return {
      stage,
      pages: Array.from(stage.querySelectorAll('.report-page'))
    };
  }

  function clearReportStage(stage) {
    if (!stage) {
      return;
    }
    stage.classList.remove('active');
    stage.innerHTML = '';
  }

  async function exportModelToPDF(model, fileName) {
    const { jsPDF } = window.jspdf;
    const { stage, pages } = await renderReportPagesToStage(model);
    try {
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      for (let index = 0; index < pages.length; index += 1) {
        const canvas = await window.html2canvas(pages[index], {
          backgroundColor: '#0a1020',
          useCORS: true,
          scale: 2,
          logging: false
        });
        const imageData = canvas.toDataURL('image/png');
        if (index > 0) {
          pdf.addPage('a4', 'landscape');
        }
        pdf.addImage(imageData, 'PNG', 0, 0, pageWidth, pageHeight, undefined, 'FAST');
      }

      pdf.save(fileName);
    } finally {
      clearReportStage(stage);
    }
  }

  async function exportModelToPPTX(model, fileName) {
    const { stage, pages } = await renderReportPagesToStage(model);
    try {
      const pptx = new PptxGenJS();
      pptx.layout = 'LAYOUT_WIDE';
      pptx.author = APP_CONFIG.appName;
      pptx.subject = model.title;
      pptx.title = model.title;

      for (const page of pages) {
        const canvas = await window.html2canvas(page, {
          backgroundColor: '#0a1020',
          useCORS: true,
          scale: 2,
          logging: false
        });
        const imageData = canvas.toDataURL('image/png');
        const slide = pptx.addSlide();
        slide.background = { color: '0A1020' };
        slide.addImage({ data: imageData, x: 0, y: 0, w: 13.333, h: 7.5 });
      }

      await pptx.writeFile({ fileName });
    } finally {
      clearReportStage(stage);
    }
  }

  async function runExport(task, successMessage) {
    closeExportSheet?.();
    try {
      await task();
      showToast(successMessage, 'success');
    } catch (error) {
      showToast(error.message || 'فشل تنفيذ العملية المطلوبة.', 'error');
    }
  }

  window.applyDateRangeFilter = function applyDateRangeFilter() {
    const startValue = document.getElementById('filter-start-date')?.value || '';
    const endValue = document.getElementById('filter-end-date')?.value || '';
    if (startValue && endValue && startValue > endValue) {
      showToast('تاريخ البداية يجب أن يكون قبل تاريخ النهاية.', 'warning');
      return;
    }

    state.filter.startDate = startValue;
    state.filter.endDate = endValue;
    if (startValue || endValue) {
      state.filter.month = null;
    }
    window.renderDashboard();
  };

  window.clearDateRangeFilter = function clearDateRangeFilter() {
    state.filter.startDate = '';
    state.filter.endDate = '';
    window.renderDashboard();
  };

  window.applyQuickDateRange = function applyQuickDateRange(range) {
    const now = new Date();
    if (range === 'year') {
      state.filter.startDate = `${now.getFullYear()}-01-01`;
      state.filter.endDate = `${now.getFullYear()}-12-31`;
    } else {
      const days = Number(range) || 30;
      const start = new Date(now);
      start.setDate(start.getDate() - days + 1);
      state.filter.startDate = getInputDateValue(start);
      state.filter.endDate = getInputDateValue(now);
    }
    state.filter.month = null;
    window.renderDashboard();
  };

  window.submitInquirySearch = function submitInquirySearch(event) {
    event.preventDefault();
    state.inquiryQuery = document.getElementById('inquiry-input')?.value.trim() || '';
    renderInquiryPanel();
  };

  window.clearInquirySearch = function clearInquirySearch() {
    state.inquiryQuery = '';
    renderInquiryPanel();
  };

  window.showUserVerificationInfo = function showUserVerificationInfo(userId) {
    const user = getUserById(userId) || state.currentUser;
    if (!user) {
      return;
    }
    showToast(`${user.fullName} • ${getUserTitle(user)}`, 'info', 4500);
  };

  window.shareNCRViaWhatsApp = function shareNCRViaWhatsApp(id) {
    const record = normalizeNcrForPlus(state.ncrs.find(item => item.id === id));
    if (!record) {
      showToast('التقرير غير موجود.', 'warning');
      return;
    }
    openShareUrl(`https://wa.me/?text=${encodeURIComponent(buildCaseShareText(record))}`);
  };

  window.shareNCRViaEmail = function shareNCRViaEmail(id) {
    const record = normalizeNcrForPlus(state.ncrs.find(item => item.id === id));
    if (!record) {
      showToast('التقرير غير موجود.', 'warning');
      return;
    }
    const subject = encodeURIComponent(`NCR Report - ${record.caseNumber}`);
    const body = encodeURIComponent(buildCaseShareText(record));
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  window.shareFilteredSummaryViaWhatsApp = function shareFilteredSummaryViaWhatsApp() {
    openShareUrl(`https://wa.me/?text=${encodeURIComponent(buildSummaryShareText())}`);
  };

  window.shareFilteredSummaryViaEmail = function shareFilteredSummaryViaEmail() {
    const subject = encodeURIComponent('VortexFlow NCR Summary');
    const body = encodeURIComponent(buildSummaryShareText());
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  };

  window.shareCurrentRecordViaWhatsApp = function shareCurrentRecordViaWhatsApp() {
    if (!state.detailNCRId) {
      showToast('افتح تقريراً أولاً.', 'warning');
      return;
    }
    window.shareNCRViaWhatsApp(state.detailNCRId);
  };

  window.shareCurrentRecordViaEmail = function shareCurrentRecordViaEmail() {
    if (!state.detailNCRId) {
      showToast('افتح تقريراً أولاً.', 'warning');
      return;
    }
    window.shareNCRViaEmail(state.detailNCRId);
  };

  window.exportRecordByIdPDF = function exportRecordByIdPDF(id) {
    runExport(async () => {
      const record = normalizeNcrForPlus(state.ncrs.find(item => item.id === id));
      if (!record) {
        throw new Error('التقرير غير موجود.');
      }
      await exportModelToPDF(buildReportModel('single', id), `${record.caseNumber}_detail_${Date.now()}.pdf`);
    }, 'تم استخراج PDF الفردي بنجاح.');
  };

  window.exportCurrentRecordPDF = function exportCurrentRecordPDF() {
    if (!state.detailNCRId) {
      showToast('افتح تقريراً أولاً.', 'warning');
      return;
    }
    window.exportRecordByIdPDF(state.detailNCRId);
  };

  window.exportCurrentRecordPPTX = function exportCurrentRecordPPTX() {
    if (!state.detailNCRId) {
      showToast('افتح تقريراً أولاً.', 'warning');
      return;
    }

    runExport(async () => {
      const record = normalizeNcrForPlus(state.ncrs.find(item => item.id === state.detailNCRId));
      if (!record) {
        throw new Error('التقرير غير موجود.');
      }
      await exportModelToPPTX(buildReportModel('single', state.detailNCRId), `${record.caseNumber}_detail_${Date.now()}.pptx`);
    }, 'تم استخراج العرض الفردي بنجاح.');
  };

  window.exportMonthlyPDF = function exportMonthlyPDF() {
    runExport(async () => {
      const model = buildReportModel('monthly');
      if (!model.items.length) {
        throw new Error('لا توجد بيانات شهرية ضمن الفلاتر الحالية.');
      }
      await exportModelToPDF(model, `NCR_monthly_${Date.now()}.pdf`);
    }, 'تم استخراج التقرير الشهري PDF.');
  };

  window.exportToPDF = function exportToPDFEnhanced() {
    runExport(async () => {
      const model = buildReportModel('filtered');
      if (!model.items.length) {
        throw new Error('لا توجد بيانات مطابقة للفلاتر الحالية.');
      }
      await exportModelToPDF(model, `NCR_filtered_${Date.now()}.pdf`);
    }, 'تم استخراج PDF بشكل صحيح.');
  };

  window.exportToPPTX = function exportToPPTXEnhanced() {
    runExport(async () => {
      const model = buildReportModel('filtered');
      if (!model.items.length) {
        throw new Error('لا توجد بيانات مطابقة للفلاتر الحالية.');
      }
      await exportModelToPPTX(model, `NCR_presentation_${Date.now()}.pptx`);
    }, 'تم استخراج العرض PowerPoint بنجاح.');
  };

  window.shareNCR = async function shareNCREnhanced(id) {
    const record = normalizeNcrForPlus(state.ncrs.find(item => item.id === id));
    if (!record) {
      showToast('التقرير غير موجود.', 'warning');
      return;
    }

    const text = buildCaseShareText(record);
    const shared = await nativeShareFallback(`NCR ${record.caseNumber}`, text);
    if (!shared) {
      window.shareNCRViaWhatsApp(id);
    }
  };

  window.shareAppSummary = async function shareAppSummaryEnhanced() {
    const text = buildSummaryShareText();
    const shared = await nativeShareFallback('VortexFlow NCR Summary', text);
    if (!shared) {
      window.shareFilteredSummaryViaWhatsApp();
    }
  };

  window.handleUserFormSubmit = async function handleUserFormSubmitEnhanced(event) {
    event.preventDefault();
    if (state.currentUser?.role !== 'admin') {
      showToast('إدارة المستخدمين متاحة فقط لمدير النظام.', 'warning');
      return;
    }

    try {
      await requestJson('/api/users', {
        method: 'POST',
        body: {
          fullName: document.getElementById('u-full-name').value.trim(),
          email: document.getElementById('u-email').value.trim(),
          password: document.getElementById('u-password').value,
          role: document.getElementById('u-role').value,
          jobTitle: document.getElementById('u-job-title')?.value.trim() || null,
          isVerified: !!document.getElementById('u-is-verified')?.checked
        }
      });
      event.target.reset();
      await window.loadAllData();
      populateDeptSelects();
      window.renderUsersView();
      window.renderDashboard();
      showToast('تم إنشاء الحساب الجديد بنجاح.', 'success');
    } catch (error) {
      showToast(error.message || 'فشل إنشاء الحساب.', 'error');
    }
  };

  window.toggleUserActive = async function toggleUserActiveEnhanced(id, isActive) {
    try {
      await requestJson(`/api/users/${id}`, {
        method: 'PATCH',
        body: { isActive }
      });
      await window.loadAllData();
      populateDeptSelects();
      window.renderUsersView();
      window.renderDashboard();
      showToast('تم تحديث حالة الحساب.', 'success');
    } catch (error) {
      showToast(error.message || 'فشل تحديث حالة الحساب.', 'error');
    }
  };

  window.openUserAdminModal = function openUserAdminModalEnhanced(id) {
    const user = getUserById(id);
    if (!user) {
      showToast('المستخدم غير موجود.', 'warning');
      return;
    }

    ensureUserEnhancements();
    state.managingUserId = id;
    const fullNameInput = document.getElementById('ua-full-name');
    const roleInput = document.getElementById('ua-role');
    const passwordInput = document.getElementById('ua-password');
    const activeInput = document.getElementById('ua-is-active');
    const jobTitleInput = document.getElementById('ua-job-title');
    const verifiedInput = document.getElementById('ua-is-verified');
    if (!fullNameInput || !roleInput || !passwordInput || !activeInput) {
      showToast('تعذر تحميل نموذج إدارة المستخدم الآن.', 'error');
      return;
    }
    fullNameInput.value = user.fullName || '';
    roleInput.value = user.role || 'viewer';
    passwordInput.value = '';
    activeInput.checked = !!user.isActive;
    if (jobTitleInput) {
      jobTitleInput.value = user.jobTitle || '';
    }
    if (verifiedInput) {
      verifiedInput.checked = isUserVerified(user);
    }
    openModal('user-admin-modal');
  };

  window.handleUserAdminSubmit = async function handleUserAdminSubmitEnhanced(event) {
    event.preventDefault();
    if (!state.managingUserId) {
      showToast('حدد مستخدماً أولاً.', 'warning');
      return;
    }

    ensureUserEnhancements();
    const fullNameInput = document.getElementById('ua-full-name');
    const roleInput = document.getElementById('ua-role');
    const activeInput = document.getElementById('ua-is-active');
    const passwordInput = document.getElementById('ua-password');
    if (!fullNameInput || !roleInput || !activeInput || !passwordInput) {
      showToast('نموذج إدارة الحساب غير جاهز.', 'error');
      return;
    }

    const payload = {
      fullName: fullNameInput.value.trim(),
      role: roleInput.value,
      isActive: !!activeInput.checked,
      jobTitle: document.getElementById('ua-job-title')?.value.trim() || null,
      isVerified: !!document.getElementById('ua-is-verified')?.checked
    };

    const password = passwordInput.value.trim();
    if (password) {
      payload.password = password;
    }

    try {
      await requestJson(`/api/users/${state.managingUserId}`, {
        method: 'PATCH',
        body: payload
      });
      await window.loadAllData();
      populateDeptSelects();
      closeModal('user-admin-modal');
      state.managingUserId = null;
      window.renderUsersView();
      window.renderDashboard();
      showToast('تم تحديث بيانات الحساب.', 'success');
    } catch (error) {
      showToast(error.message || 'فشل تحديث الحساب.', 'error');
    }
  };

  window.handleAccountPasswordSubmit = async function handleAccountPasswordSubmit(event) {
    event.preventDefault();
    if (!state.currentUser) {
      showToast('يجب تسجيل الدخول أولاً.', 'warning');
      return;
    }

    try {
      await requestJson('/api/users/password', {
        method: 'PATCH',
        body: {
          currentPassword: document.getElementById('account-current-password').value,
          newPassword: document.getElementById('account-new-password').value
        }
      });
      event.target.reset();
      showToast('تم تغيير كلمة المرور بنجاح.', 'success');
    } catch (error) {
      showToast(error.message || 'فشل تغيير كلمة المرور.', 'error');
    }
  };

  window.handleLogoSelect = async function handleLogoSelectEnhanced(event) {
    if (typeof previousHandleLogoSelect === 'function') {
      await previousHandleLogoSelect(event);
    }
    updateCustomLogoUploadState();
  };

  window.removeCompanyLogo = function removeCompanyLogoEnhanced() {
    if (typeof previousRemoveCompanyLogo === 'function') {
      previousRemoveCompanyLogo();
    }
    updateCustomLogoUploadState();
  };

  window.renderUsersView = function renderUsersViewEnhanced() {
    const list = document.getElementById('user-list');
    const form = document.getElementById('user-form');
    const metrics = document.getElementById('user-dashboard-metrics');
    if (!list || !form) {
      return;
    }

    const backendAvailable = !!state.backend?.available;
    const isLocked = backendAvailable && !state.currentUser;
    const isAdmin = state.currentUser?.role === 'admin';

    if (!backendAvailable) {
      form.classList.add('hidden');
      if (metrics) metrics.innerHTML = '';
      list.innerHTML = '<div class="empty-state"><i class="fas fa-database"></i><h3>لا يوجد خادم</h3><p>إدارة الحسابات تحتاج تشغيل API وربط قاعدة البيانات.</p></div>';
      return;
    }

    if (isLocked) {
      form.classList.add('hidden');
      if (metrics) metrics.innerHTML = '';
      list.innerHTML = '<div class="empty-state"><i class="fas fa-user-lock"></i><h3>تسجيل الدخول مطلوب</h3><p>سجل الدخول أولاً لإدارة الحسابات.</p></div>';
      return;
    }

    renderAccountSecuritySummary();

    form.classList.toggle('hidden', !isAdmin);
    if (!isAdmin) {
      if (metrics) metrics.innerHTML = '';
      list.innerHTML = '<div class="empty-state"><i class="fas fa-shield-halved"></i><h3>صلاحية غير كافية</h3><p>لوحة إنشاء الحسابات متاحة فقط لمدير النظام.</p></div>';
      return;
    }

    const activeCount = state.users.filter(item => item.isActive).length;
    const verifiedCount = state.users.filter(item => isUserVerified(item)).length;
    const adminCount = state.users.filter(item => item.role === 'admin').length;
    const engineerCount = state.users.filter(item => item.role === 'engineer').length;
    if (metrics) {
      metrics.innerHTML = `
        <div class="ops-card"><div class="ops-card-label">إجمالي الحسابات</div><div class="ops-card-value">${state.users.length}</div><div class="ops-card-hint">كل المستخدمين المسجلين</div></div>
        <div class="ops-card"><div class="ops-card-label">نشطة</div><div class="ops-card-value">${activeCount}</div><div class="ops-card-hint">قادرة على الدخول</div></div>
        <div class="ops-card"><div class="ops-card-label">موثقة</div><div class="ops-card-value">${verifiedCount}</div><div class="ops-card-hint">بحسابات مع علامة تحقق</div></div>
        <div class="ops-card"><div class="ops-card-label">مدير / مهندس</div><div class="ops-card-value">${adminCount}/${engineerCount}</div><div class="ops-card-hint">توزيع الأدوار التشغيلية</div></div>
      `;
    }

    list.innerHTML = state.users.length
      ? state.users.map(user => `
          <div class="user-card enhanced-user-card">
            <div class="user-card-main">
              <div class="user-avatar">${getInitials(user.fullName)}</div>
              <div class="user-card-stack">
                <div class="user-card-name">
                  ${escapeHTML(user.fullName)}
                  ${buildVerificationBadge(user)}
                </div>
                <div class="user-card-meta">${escapeHTML(user.email)} • ${escapeHTML(getRoleLabel(user.role))}</div>
                <div class="user-card-meta">${escapeHTML(getUserTitle(user))}</div>
                <div class="user-card-meta">آخر دخول: ${user.lastLoginAt ? escapeHTML(formatDateTime(user.lastLoginAt)) : 'لم يسجل الدخول بعد'}</div>
              </div>
            </div>
            <div class="user-card-actions">
              <span class="badge ${user.isActive ? 'badge-green' : 'badge-gray'}">${user.isActive ? 'نشط' : 'معطل'}</span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="openUserAdminModal('${user.id}')">إدارة</button>
              ${state.currentUser?.id !== user.id ? `<button type="button" class="btn btn-outline btn-sm" onclick="toggleUserActive('${user.id}', ${user.isActive ? 'false' : 'true'})">${user.isActive ? 'تعطيل' : 'تفعيل'}</button>` : '<span class="badge badge-blue">حسابك الحالي</span>'}
            </div>
          </div>
        `).join('')
      : '<div class="empty-state"><i class="fas fa-users"></i><h3>لا يوجد مستخدمون</h3><p>ابدأ بإضافة أول حساب من النموذج أعلاه.</p></div>';
  };

  window.openSecretEasterEgg = function openSecretEasterEgg() {
    const modal = document.getElementById('secret-easter-egg-modal');
    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden', 'false');
  };

  window.closeSecretEasterEgg = function closeSecretEasterEgg() {
    const modal = document.getElementById('secret-easter-egg-modal');
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
  };

  window.loadAllData = async function loadAllDataEnhanced() {
    await previousLoadAllData();
    await cleanupLegacyDemoData();
  };

  window.getFilteredNCRs = function getFilteredNCRsEnhanced() {
    const items = (previousGetFilteredNCRs ? previousGetFilteredNCRs() : state.ncrs)
      .map(normalizeNcrForPlus)
      .filter(Boolean);

    const range = buildDateTimeRange();
    return items.filter(item => {
      const value = toTime(item.date || item.createdAt);
      if (range.startTime && value < range.startTime) {
        return false;
      }
      if (range.endTime && value > range.endTime) {
        return false;
      }
      return true;
    });
  };

  window.getStats = function getStatsEnhanced() {
    const items = window.getFilteredNCRs();
    const dueSoon = items.filter(item => item.dueDate && toTime(item.dueDate) > Date.now() && toTime(item.dueDate) - Date.now() < 3 * 24 * 60 * 60 * 1000 && item.status !== 'Closed').length;
    const overdue = items.filter(item => item.dueDate && toTime(item.dueDate) < Date.now() && item.status !== 'Closed').length;
    const critical = items.filter(item => item.priority === 'Critical' || item.severity === 'Critical').length;

    return {
      total: items.length,
      open: items.filter(item => item.status === 'Open').length,
      inProgress: items.filter(item => item.status === 'In Progress').length,
      closed: items.filter(item => item.status === 'Closed').length,
      slaBreached: items.filter(item => item.elapsedDays > APP_CONFIG.SLA_CRITICAL_DAYS && item.status !== 'Closed').length,
      dueSoon,
      overdue,
      critical
    };
  };

  window.openNCRDetail = function openNCRDetailEnhanced(id) {
    previousOpenNCRDetail(id);
    ensureDetailEnhancements();
  };

  window.renderDashboard = function renderDashboardEnhanced() {
    previousRenderDashboard();
    ensureDateRangeControls();
    ensureAnalyticsShell();
    ensureInquiryShell();
    syncDateRangeInputs();
    renderAnalyticsDashboard();
    renderInquiryPanel();
    renderAccountSecuritySummary();
    enhanceHeaderSession();
  };

  window.navigateTo = function navigateToEnhanced(view) {
    previousNavigateTo(view);
    if (view === 'dashboard') {
      window.renderDashboard();
    } else if (view === 'users') {
      window.renderUsersView();
    } else if (view === 'settings') {
      renderAccountSecuritySummary();
    }
  };

  const permissionAwareLoadAllData = window.loadAllData;
  const permissionAwareRenderDashboard = window.renderDashboard;
  const permissionAwareNavigateTo = window.navigateTo;

  window.handleLogoSelect = async function handleLogoSelectFinal(event) {
    if (typeof previousHandleLogoSelect === 'function') {
      await previousHandleLogoSelect(event);
    }
    updateCustomLogoUploadState();
  };

  window.removeCompanyLogo = function removeCompanyLogoFinal() {
    if (typeof previousRemoveCompanyLogo === 'function') {
      previousRemoveCompanyLogo();
    }
    updateCustomLogoUploadState();
  };

  window.renderUsersView = function renderUsersViewFinal() {
    const list = document.getElementById('user-list');
    const form = document.getElementById('user-form');
    const metrics = document.getElementById('user-dashboard-metrics');
    if (!list || !form) {
      return;
    }

    const backendAvailable = !!state.backend?.available;
    const isLocked = backendAvailable && !state.currentUser;
    const isAdmin = state.currentUser?.role === 'admin';

    if (!backendAvailable) {
      form.classList.add('hidden');
      if (metrics) {
        metrics.innerHTML = '';
      }
      list.innerHTML = buildEmptyStateCard({
        title: 'لا يوجد خادم',
        message: 'إدارة الحسابات تحتاج تشغيل API وربط قاعدة البيانات. يمكنك إعادة المحاولة بعد ضبط بيئة النشر.',
        actionLabel: 'إعادة المحاولة',
        actionHandler: 'retryUsersConnection()',
        tone: 'warning'
      });
      return;
    }

    if (isLocked) {
      form.classList.add('hidden');
      if (metrics) {
        metrics.innerHTML = '';
      }
      list.innerHTML = buildEmptyStateCard({
        title: 'تسجيل الدخول مطلوب',
        message: 'يلزم تسجيل الدخول أولاً للوصول إلى لوحة الحسابات والصلاحيات.',
        actionLabel: 'فتح شاشة الدخول',
        actionHandler: 'openAuthModal()',
        tone: 'info'
      });
      return;
    }

    renderAccountSecuritySummary();

    form.classList.toggle('hidden', !isAdmin);
    if (!isAdmin) {
      if (metrics) {
        metrics.innerHTML = '';
      }
      list.innerHTML = buildEmptyStateCard({
        title: 'صلاحية غير كافية',
        message: 'لوحة إنشاء الحسابات وإدارتها متاحة فقط لمدير النظام.',
        actionLabel: 'العودة للوحة التحكم',
        actionHandler: "navigateTo('dashboard')",
        tone: 'danger'
      });
      return;
    }

    const activeCount = state.users.filter(item => item.isActive).length;
    const verifiedCount = state.users.filter(item => isUserVerified(item)).length;
    const adminCount = state.users.filter(item => item.role === 'admin').length;
    const engineerCount = state.users.filter(item => item.role === 'engineer').length;
    if (metrics) {
      metrics.innerHTML = `
        <div class="ops-card"><div class="ops-card-label">إجمالي الحسابات</div><div class="ops-card-value">${state.users.length}</div><div class="ops-card-hint">كل المستخدمين المسجلين</div></div>
        <div class="ops-card"><div class="ops-card-label">نشطة</div><div class="ops-card-value">${activeCount}</div><div class="ops-card-hint">قادرة على الدخول</div></div>
        <div class="ops-card"><div class="ops-card-label">موثقة</div><div class="ops-card-value">${verifiedCount}</div><div class="ops-card-hint">بحسابات مع علامة تحقق</div></div>
        <div class="ops-card"><div class="ops-card-label">مدير / مهندس</div><div class="ops-card-value">${adminCount}/${engineerCount}</div><div class="ops-card-hint">توزيع الأدوار التشغيلية</div></div>
      `;
    }

    list.innerHTML = state.users.length
      ? state.users.map(user => `
          <div class="user-card enhanced-user-card">
            <div class="user-card-main">
              <div class="user-avatar">${getInitials(user.fullName)}</div>
              <div class="user-card-stack">
                <div class="user-card-name">
                  ${escapeHTML(user.fullName)}
                  ${buildVerificationBadge(user)}
                </div>
                <div class="user-card-meta">${escapeHTML(user.email)} • ${escapeHTML(getRoleLabel(user.role))}</div>
                <div class="user-card-meta">${escapeHTML(getUserTitle(user))}</div>
                <div class="user-card-meta">آخر دخول: ${user.lastLoginAt ? escapeHTML(formatDateTime(user.lastLoginAt)) : 'لم يسجل الدخول بعد'}</div>
              </div>
            </div>
            <div class="user-card-actions">
              <span class="badge ${user.isActive ? 'badge-green' : 'badge-gray'}">${user.isActive ? 'نشط' : 'معطل'}</span>
              <button type="button" class="btn btn-secondary btn-sm" onclick="openUserAdminModal('${user.id}')">إدارة</button>
              ${state.currentUser?.id !== user.id ? `<button type="button" class="btn btn-outline btn-sm" onclick="toggleUserActive('${user.id}', ${user.isActive ? 'false' : 'true'})">${user.isActive ? 'تعطيل' : 'تفعيل'}</button>` : '<span class="badge badge-blue">حسابك الحالي</span>'}
            </div>
          </div>
        `).join('')
      : buildEmptyStateCard({
          title: 'لا يوجد مستخدمون إضافيون',
          message: 'ابدأ بإضافة أول عضو فريق من النموذج أعلى الصفحة لتوزيع الأدوار والصلاحيات.',
          tone: 'default'
        });

    applyPermissionUI();
  };

  window.loadAllData = async function loadAllDataFinal() {
    await permissionAwareLoadAllData();
    applyPermissionUI();
  };

  window.renderDashboard = function renderDashboardFinal() {
    permissionAwareRenderDashboard();
    ensureHeaderStatusBadge();
    ensureCustomLogoUpload();
    renderHeaderStatusBadge();
    applyPermissionUI();
  };

  window.navigateTo = function navigateToFinal(view) {
    const targetView = canAccessView(view) ? view : 'dashboard';
    if (targetView !== view) {
      showToast(getAccessDeniedMessage(view), 'warning');
      if (state.backend?.available && !state.currentUser && typeof window.openAuthModal === 'function') {
        window.openAuthModal();
      }
    }

    permissionAwareNavigateTo(targetView);
    if (targetView === 'settings') {
      ensureCustomLogoUpload();
      renderAccountSecuritySummary();
      applySettingsPermissions();
    }
    applyPermissionUI();
  };

  document.addEventListener('click', event => {
    const logo = event.target.closest('.header-logo .logo-icon, #welcome-modal .welcome-logo, .auth-screen-brand .welcome-logo');
    if (!logo) {
      return;
    }

    secretTapCount += 1;
    clearTimeout(secretTapTimer);
    secretTapTimer = setTimeout(() => {
      secretTapCount = 0;
    }, 5000);

    if (secretTapCount >= SECRET_TAP_TARGET) {
      secretTapCount = 0;
      window.openSecretEasterEgg();
    }
  });

  if (document.readyState !== 'loading') {
    ensureSecretModal();
  } else {
    document.addEventListener('DOMContentLoaded', ensureSecretModal, { once: true });
  }

  window.VortexFlowBootstrap = async function enterprisePlusBootstrap() {
    if (typeof previousBootstrap === 'function') {
      await previousBootstrap();
    }

    ensureDateRangeControls();
    ensureAnalyticsShell();
    ensureInquiryShell();
    ensureExportEnhancements();
    ensureDetailEnhancements();
    ensureUserEnhancements();
    ensureAccountEnhancements();
    ensureSecretModal();
    ensureExportStage();
    ensureHeaderStatusBadge();
    ensureCustomLogoUpload();
    renderAccountSecuritySummary();
    window.renderDashboard();
    if (state.view === 'users') {
      window.renderUsersView();
    }
    applyPermissionUI();
  };

  getFilteredNCRs = window.getFilteredNCRs;
  getStats = window.getStats;
  loadAllData = window.loadAllData;
  renderDashboard = window.renderDashboard;
  navigateTo = window.navigateTo;
  openNCRDetail = window.openNCRDetail;
  exportToPDF = window.exportToPDF;
  exportToPPTX = window.exportToPPTX;
  shareNCR = window.shareNCR;
  shareAppSummary = window.shareAppSummary;

})();
