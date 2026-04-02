'use strict';

(function enterpriseLayer() {
  if (typeof APP_CONFIG === 'undefined' || typeof state === 'undefined') {
    return;
  }

  const SETTINGS_KEY = `${APP_CONFIG.storageName}_settings`;
  const TEMPLATES_KEY = `${APP_CONFIG.storageName}_templates`;
  const DEFAULT_SETTINGS = {
    orgName: 'VortexFlow',
    siteName: 'Main Facility',
    casePrefix: 'NCR',
    accentColor: '#f59e0b',
    printSubtitle: 'سجل تقارير عدم المطابقة',
    slaWarningDays: 3,
    slaCriticalDays: 5,
    showOnboarding: true,
    compactPrint: true,
    autoPrintAfterSave: false
  };

  const legacy = {
    loadAllData: window.loadAllData,
    deleteNCR: window.deleteNCR,
    renderStats: window.renderStats,
    renderNCRList: window.renderNCRList,
    renderMonthFilter: window.renderMonthFilter,
    renderFilePreview: window.renderFilePreview,
    removeFile: window.removeFile,
    openModal: window.openModal,
    closeModal: window.closeModal,
    registerServiceWorker: window.registerServiceWorker,
    initKeyboardShortcuts: window.initKeyboardShortcuts,
    initSwipeGestures: window.initSwipeGestures,
    initFileDragDrop: window.initFileDragDrop,
    startSLATimer: window.startSLATimer,
    checkFirstVisit: window.checkFirstVisit,
    refreshApp: window.refreshApp
  };

  Object.assign(APP_CONFIG, {
    version: '2.0.0',
    MAX_LOCAL_FILE_SIZE: 10 * 1024 * 1024,
    MAX_REMOTE_FILE_SIZE: 3 * 1024 * 1024,
    PRIORITY_LABELS: {
      Low: 'منخفضة',
      Medium: 'متوسطة',
      High: 'مرتفعة',
      Critical: 'حرجة'
    },
    SEVERITY_LABELS: {
      Minor: 'طفيف',
      Major: 'جوهري',
      Critical: 'حرج'
    },
    ROLE_LABELS: {
      admin: 'Admin',
      engineer: 'Engineer',
      viewer: 'Viewer'
    }
  });

  Object.assign(state, {
    users: [],
    currentUser: null,
    templates: [],
    settings: { ...DEFAULT_SETTINGS },
    backend: {
      available: false,
      hasUsers: false,
      mode: 'local',
      lastSyncAt: null,
      error: null,
      authMode: 'login'
    }
  });

  state.filter.priority = state.filter.priority || 'all';

  function timeValue(value) {
    if (!value) {
      return 0;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  }

  function sortNcrs(items) {
    return [...items].sort((a, b) => timeValue(b.date || b.createdAt) - timeValue(a.date || a.createdAt));
  }

  function parseTags(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean);
    }

    return String(value || '')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }

  function loadCustomization() {
    try {
      const rawSettings = localStorage.getItem(SETTINGS_KEY);
      if (rawSettings) {
        state.settings = {
          ...DEFAULT_SETTINGS,
          ...JSON.parse(rawSettings)
        };
      }
    } catch (_) {
      state.settings = { ...DEFAULT_SETTINGS };
    }

    try {
      const rawTemplates = localStorage.getItem(TEMPLATES_KEY);
      state.templates = rawTemplates ? JSON.parse(rawTemplates) : [];
    } catch (_) {
      state.templates = [];
    }

    APP_CONFIG.SLA_WARNING_DAYS = Math.max(1, parseInt(state.settings.slaWarningDays, 10) || DEFAULT_SETTINGS.slaWarningDays);
    APP_CONFIG.SLA_CRITICAL_DAYS = Math.max(APP_CONFIG.SLA_WARNING_DAYS + 1, parseInt(state.settings.slaCriticalDays, 10) || DEFAULT_SETTINGS.slaCriticalDays);
  }

  function persistCustomization() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(state.templates));
  }

  function generateEnterpriseCaseNumber() {
    const year = new Date().getFullYear();
    const prefix = String(state.settings.casePrefix || 'NCR').trim().toUpperCase();
    const seq = (state.ncrs.length + 1).toString().padStart(4, '0');
    return `${prefix}-${year}-${seq}`;
  }

  function applyBranding() {
    const orgName = state.settings.orgName || 'VortexFlow';
    const siteName = state.settings.siteName || 'NCR System';
    const accent = state.settings.accentColor || DEFAULT_SETTINGS.accentColor;

    document.documentElement.style.setProperty('--vf-amber', accent);
    document.title = `${orgName} NCR`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', accent);
    document.querySelector('meta[name="description"]')?.setAttribute('content', `${orgName} NCR - ${state.settings.printSubtitle || DEFAULT_SETTINGS.printSubtitle}`);

    const headerTitle = document.querySelector('.header-title');
    const headerSubtitle = document.querySelector('.header-subtitle');
    const welcomeName = document.querySelector('.welcome-app-name');
    const welcomeSubtitle = document.querySelector('.welcome-subtitle');

    if (headerTitle) {
      headerTitle.textContent = orgName;
    }
    if (headerSubtitle) {
      headerSubtitle.textContent = siteName;
    }
    if (welcomeName) {
      welcomeName.textContent = `${orgName} NCR`;
    }
    if (welcomeSubtitle) {
      welcomeSubtitle.textContent = `${siteName} • v${APP_CONFIG.version}`;
    }
  }

  function formatLastSync(timestamp) {
    if (!timestamp) {
      return 'لم تتم مزامنة بعد';
    }

    return new Date(timestamp).toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  function isRemoteMode() {
    return state.backend.available && !!state.currentUser;
  }

  function isRemoteLocked() {
    return state.backend.available && !state.currentUser;
  }

  function canManageRecords() {
    if (!state.backend.available) {
      return true;
    }

    return !!state.currentUser && ['admin', 'engineer'].includes(state.currentUser.role);
  }

  function isAdmin() {
    return !!state.currentUser && state.currentUser.role === 'admin';
  }

  function getUserNameById(userId) {
    const user = state.users.find(item => item.id === userId);
    return user ? user.fullName : '—';
  }

  function getPriorityBadge(priority) {
    const map = {
      Low: { cls: 'badge-gray', label: 'Low' },
      Medium: { cls: 'badge-blue', label: 'Medium' },
      High: { cls: 'badge-amber', label: 'High' },
      Critical: { cls: 'badge-red', label: 'Critical' }
    };

    const target = map[priority] || map.Medium;
    return `<span class="badge ${target.cls}">${escapeHTML(APP_CONFIG.PRIORITY_LABELS[priority] || target.label)}</span>`;
  }

  function getSeverityBadge(severity) {
    const map = {
      Minor: { cls: 'badge-blue', label: 'Minor' },
      Major: { cls: 'badge-purple', label: 'Major' },
      Critical: { cls: 'badge-red', label: 'Critical' }
    };

    const target = map[severity] || map.Major;
    return `<span class="badge ${target.cls}">${escapeHTML(APP_CONFIG.SEVERITY_LABELS[severity] || target.label)}</span>`;
  }

  async function apiRequest(path, options = {}) {
    const requestOptions = {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(options.headers || {})
      }
    };

    if (options.body !== undefined) {
      requestOptions.headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(path, requestOptions);
    const text = await response.text();
    const data = text ? JSON.parse(text) : {};

    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return data;
  }

  function updateFileHint() {
    const hint = document.querySelector('.file-upload-hint');
    if (!hint) {
      return;
    }

    if (isRemoteMode()) {
      hint.textContent = 'صور و PDF و Office — حد أقصى 3 ميجابايت عند الحفظ على الخادم';
    } else {
      hint.textContent = 'صور و PDF و Office — حد أقصى 10 ميجابايت في الوضع المحلي';
    }
  }

  function injectEnterpriseMarkup() {
    if (!document.getElementById('sync-banner')) {
      const headerActions = document.querySelector('.header-actions');
      headerActions?.insertAdjacentHTML('beforebegin', '<div id="header-session" class="header-session"></div>');

      const mainContent = document.getElementById('main-content');
      mainContent?.insertAdjacentHTML(
        'beforebegin',
        `
          <div id="sync-banner" class="sync-banner hidden" aria-live="polite">
            <div class="sync-banner-copy">
              <div class="sync-banner-title" id="sync-banner-title">وضع التشغيل</div>
              <div class="sync-banner-meta" id="sync-banner-meta"></div>
            </div>
            <div class="sync-banner-actions">
              <button id="btn-sync-now" type="button" class="btn btn-secondary btn-sm" onclick="syncNow()">مزامنة الآن</button>
              <button id="btn-open-auth" type="button" class="btn btn-primary btn-sm" onclick="openAuthModal()">تسجيل الدخول</button>
            </div>
          </div>
        `
      );
    }

    const filterSection = document.querySelector('#view-dashboard .filter-section');
    if (filterSection && !document.getElementById('dashboard-ops')) {
      filterSection.insertAdjacentHTML('beforebegin', '<div id="dashboard-ops" class="ops-grid"></div>');
      filterSection.insertAdjacentHTML(
        'beforeend',
        `
          <div class="filter-row">
            <span class="filter-label">الأولوية:</span>
            <div class="filter-pills priority-pills" role="group" aria-label="تصفية بالأولوية">
              <button class="filter-pill active" data-priority="all" onclick="setPriorityFilter('all', this)">الكل</button>
              <button class="filter-pill" data-priority="Medium" onclick="setPriorityFilter('Medium', this)">متوسطة</button>
              <button class="filter-pill" data-priority="High" onclick="setPriorityFilter('High', this)">مرتفعة</button>
              <button class="filter-pill" data-priority="Critical" onclick="setPriorityFilter('Critical', this)">حرجة</button>
            </div>
          </div>
        `
      );
    }

    const departmentGroup = document.getElementById('f-department')?.closest('.form-group');
    if (departmentGroup && !document.getElementById('f-priority')) {
      departmentGroup.insertAdjacentHTML(
        'afterend',
        `
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="f-priority">الأولوية</label>
              <select id="f-priority" class="form-control">
                <option value="Medium">متوسطة</option>
                <option value="Low">منخفضة</option>
                <option value="High">مرتفعة</option>
                <option value="Critical">حرجة</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="f-severity">درجة التأثير</label>
              <select id="f-severity" class="form-control">
                <option value="Major">جوهري</option>
                <option value="Minor">طفيف</option>
                <option value="Critical">حرج</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label class="form-label" for="f-owner-id">المسؤول</label>
              <select id="f-owner-id" class="form-control">
                <option value="">-- غير محدد --</option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label" for="f-due-date">تاريخ الاستحقاق</label>
              <input type="date" id="f-due-date" class="form-control">
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="f-tags">وسوم</label>
            <input
              type="text"
              id="f-tags"
              class="form-control"
              placeholder="مثل: لحام, مورد, QA"
              autocomplete="off"
            >
          </div>
          <div class="form-group">
            <label class="form-label" for="f-root-cause">السبب الجذري</label>
            <textarea id="f-root-cause" class="form-control" rows="2" placeholder="ما سبب عدم المطابقة؟"></textarea>
          </div>
          <div class="form-group">
            <label class="form-label" for="f-corrective-action">الإجراء التصحيحي</label>
            <textarea id="f-corrective-action" class="form-control" rows="2" placeholder="ما الإجراء المطلوب؟"></textarea>
          </div>
        `
      );
    }

    const mainContent = document.getElementById('main-content');
    if (mainContent && !document.getElementById('view-users')) {
      mainContent.insertAdjacentHTML(
        'beforeend',
        `
          <section id="view-users" class="view" role="region" aria-label="المستخدمون">
            <div class="dashboard-hero" style="padding-bottom:20px">
              <div class="view-title">Team</div>
              <div class="view-heading">إدارة المستخدمين والصلاحيات</div>
              <form id="user-form" onsubmit="handleUserFormSubmit(event)" style="margin-top:8px">
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label required" for="u-full-name">الاسم</label>
                    <input id="u-full-name" class="form-control" type="text" required autocomplete="off">
                  </div>
                  <div class="form-group">
                    <label class="form-label required" for="u-email">البريد</label>
                    <input id="u-email" class="form-control" type="email" required autocomplete="off" dir="ltr">
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label class="form-label required" for="u-password">كلمة المرور</label>
                    <input id="u-password" class="form-control" type="password" required minlength="8">
                  </div>
                  <div class="form-group">
                    <label class="form-label required" for="u-role">الدور</label>
                    <select id="u-role" class="form-control">
                      <option value="viewer">Viewer</option>
                      <option value="engineer">Engineer</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                </div>
                <div class="btn-group">
                  <button type="submit" class="btn btn-primary">
                    <i class="fas fa-user-plus" aria-hidden="true"></i>
                    إضافة مستخدم
                  </button>
                </div>
              </form>
            </div>
            <div class="section-card">
              <div class="section-card-head">
                <div>
                  <div class="section-card-title">قائمة المستخدمين</div>
                  <div class="section-card-subtitle">حسابات التشغيل والصلاحيات الحالية</div>
                </div>
              </div>
              <div id="user-list" class="user-list"></div>
            </div>
          </section>
        `
      );
    }

    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav && !document.getElementById('nav-users')) {
      bottomNav.insertAdjacentHTML(
        'beforeend',
        `
          <button class="nav-item" id="nav-users" data-view="users" onclick="navigateTo('users')" aria-label="المستخدمون">
            <i class="fas fa-users" aria-hidden="true"></i>
            <span>المستخدمون</span>
          </button>
        `
      );
    }

    if (!document.getElementById('auth-modal')) {
      document.body.insertAdjacentHTML(
        'beforeend',
        `
          <div id="auth-modal" class="modal-overlay" role="dialog" aria-modal="true" aria-label="المصادقة">
            <div class="modal-box auth-modal-box">
              <div class="modal-header">
                <div class="modal-title" id="auth-modal-title">تسجيل الدخول</div>
              </div>
              <div class="modal-body">
                <div class="auth-state-banner" id="auth-state-banner"></div>
                <p class="auth-note" id="auth-note"></p>
                <form id="auth-form" onsubmit="handleAuthSubmit(event)">
                  <div class="form-group" id="auth-name-group">
                    <label class="form-label required" for="auth-full-name">الاسم الكامل</label>
                    <input id="auth-full-name" class="form-control" type="text" autocomplete="off">
                  </div>
                  <div class="form-group">
                    <label class="form-label required" for="auth-email">البريد الإلكتروني</label>
                    <input id="auth-email" class="form-control" type="email" required autocomplete="off" dir="ltr">
                  </div>
                  <div class="form-group">
                    <label class="form-label required" for="auth-password">كلمة المرور</label>
                    <input id="auth-password" class="form-control" type="password" required minlength="8">
                  </div>
                  <div class="btn-group">
                    <button type="button" class="btn btn-secondary" onclick="closeAuthModal()">إغلاق</button>
                    <button type="submit" class="btn btn-primary" id="auth-submit-btn">متابعة</button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        `
      );
    }
  }

  function renderHeaderSession() {
    const container = document.getElementById('header-session');
    if (!container) {
      return;
    }

    if (isRemoteMode()) {
      container.innerHTML = `
        <div class="session-chip">
          <span class="sync-dot"></span>
          <span>${escapeHTML(state.currentUser.fullName)}</span>
          <span class="session-chip-role">${escapeHTML(APP_CONFIG.ROLE_LABELS[state.currentUser.role] || state.currentUser.role)}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" onclick="logoutCurrentUser()">خروج</button>
      `;
      return;
    }

    if (state.backend.available) {
      container.innerHTML = `
        <button type="button" class="btn btn-primary btn-sm" onclick="openAuthModal()">
          <i class="fas fa-user-shield" aria-hidden="true"></i>
          دخول
        </button>
      `;
      return;
    }

    container.innerHTML = `
      <div class="session-chip local">
        <span class="sync-dot warning"></span>
        <span>وضع محلي</span>
        <span class="session-chip-role">Offline</span>
      </div>
    `;
  }

  function renderSyncBanner() {
    const banner = document.getElementById('sync-banner');
    const title = document.getElementById('sync-banner-title');
    const meta = document.getElementById('sync-banner-meta');
    const syncButton = document.getElementById('btn-sync-now');
    const authButton = document.getElementById('btn-open-auth');

    if (!banner || !title || !meta || !syncButton || !authButton) {
      return;
    }

    banner.classList.remove('hidden');

    if (isRemoteMode()) {
      title.textContent = 'متصل بقاعدة البيانات';
      meta.textContent = `آخر مزامنة: ${formatLastSync(state.backend.lastSyncAt)}`;
      syncButton.classList.remove('hidden');
      authButton.classList.add('hidden');
      return;
    }

    if (state.backend.available) {
      title.textContent = state.backend.hasUsers ? 'الخادم متاح ويتطلب تسجيل الدخول' : 'إعداد الحساب الإداري الأول';
      meta.textContent = state.backend.hasUsers
        ? 'لن يتم عرض البيانات أو تعديلها قبل تسجيل الدخول.'
        : 'أنشئ أول مستخدم Admin لبدء تشغيل النظام على Vercel.';
      syncButton.classList.add('hidden');
      authButton.classList.remove('hidden');
      authButton.textContent = state.backend.hasUsers ? 'تسجيل الدخول' : 'إعداد الحساب';
      return;
    }

    title.textContent = 'تشغيل محلي بدون خادم';
    meta.textContent = 'التطبيق يعمل على IndexedDB محلياً. لتفعيل المستخدمين وقاعدة البيانات استخدم Vercel + PostgreSQL.';
    syncButton.classList.add('hidden');
    authButton.classList.add('hidden');
  }

  function updateAuthModal() {
    const title = document.getElementById('auth-modal-title');
    const note = document.getElementById('auth-note');
    const nameGroup = document.getElementById('auth-name-group');
    const submit = document.getElementById('auth-submit-btn');
    const stateBanner = document.getElementById('auth-state-banner');

    if (!title || !note || !nameGroup || !submit || !stateBanner) {
      return;
    }

    const setupMode = state.backend.authMode === 'setup';
    title.textContent = setupMode ? 'إعداد الحساب الإداري الأول' : 'تسجيل الدخول';
    note.textContent = setupMode
      ? 'سيتم إنشاء أول حساب Admin على قاعدة البيانات وربط الجلسة الحالية به.'
      : 'سجّل الدخول للوصول إلى البيانات المشتركة وإدارة المستخدمين والتقارير.';
    stateBanner.textContent = setupMode
      ? 'Vercel Backend جاهز لكن لا يوجد مستخدمون بعد.'
      : 'يتم استخدام جلسة آمنة عبر API محلي على نفس الدومين.';
    nameGroup.classList.toggle('hidden', !setupMode);
    submit.textContent = setupMode ? 'إنشاء الحساب' : 'تسجيل الدخول';
  }

  async function refreshBackendSession() {
    try {
      const session = await apiRequest('/api/auth/session');
      state.backend.available = true;
      state.backend.hasUsers = !!session.hasUsers;
      state.currentUser = session.user || null;
      state.backend.mode = state.currentUser
        ? 'remote'
        : state.backend.hasUsers
          ? 'locked'
          : 'setup';
      state.backend.authMode = state.backend.hasUsers ? 'login' : 'setup';
      state.backend.error = null;
    } catch (error) {
      state.backend.available = false;
      state.backend.hasUsers = false;
      state.currentUser = null;
      state.backend.mode = 'local';
      state.backend.authMode = 'login';
      state.backend.error = error.message;
    }

    renderHeaderSession();
    renderSyncBanner();
    updateAuthModal();
    updateFileHint();
  }

  function appendLocalHistory(ncr, message, action) {
    const history = Array.isArray(ncr.history) ? [...ncr.history] : [];
    history.unshift({
      id: generateId(),
      action,
      message,
      actorId: null,
      actorName: state.currentUser?.fullName || 'Local Device',
      metadata: {},
      createdAt: Date.now()
    });

    return history.slice(0, 20);
  }

  async function saveNCRLocal(data) {
    const now = Date.now();
    const ncr = {
      id: generateId(),
      caseNumber: data.caseNumber || generateEnterpriseCaseNumber(),
      subCase: data.subCase || '',
      date: data.date || now,
      description: data.description,
      status: data.status,
      step: data.step || 1,
      priority: data.priority || 'Medium',
      severity: data.severity || 'Major',
      dueDate: data.dueDate || null,
      rootCause: data.rootCause || '',
      correctiveAction: data.correctiveAction || '',
      tags: parseTags(data.tags),
      ownerId: data.ownerId || null,
      ownerName: getUserNameById(data.ownerId) || null,
      colorCode: data.colorCode || '#3b82f6',
      departmentId: data.departmentId || null,
      attachedDocument: data.attachedDocument || null,
      sourceMode: 'local',
      createdAt: now,
      updatedAt: now
    };

    ncr.history = appendLocalHistory(ncr, `تم إنشاء التقرير ${ncr.caseNumber} محلياً.`, 'ncr.created');
    await ncrStore.setItem(ncr.id, ncr);
    state.ncrs = sortNcrs([ncr, ...state.ncrs]);
    return ncr;
  }

  async function updateNCRLocal(id, updates) {
    const existing = await ncrStore.getItem(id);
    if (!existing) {
      throw new Error('التقرير غير موجود');
    }

    const updated = {
      ...existing,
      ...updates,
      tags: updates.tags !== undefined ? parseTags(updates.tags) : existing.tags || [],
      ownerName: updates.ownerId !== undefined ? getUserNameById(updates.ownerId) : existing.ownerName,
      updatedAt: Date.now()
    };

    updated.history = appendLocalHistory(updated, `تم تحديث التقرير ${updated.caseNumber}.`, 'ncr.updated');
    await ncrStore.setItem(id, updated);
    state.ncrs = sortNcrs(state.ncrs.map(item => (item.id === id ? updated : item)));
    return updated;
  }

  async function deleteNCRLocal(id) {
    await ncrStore.removeItem(id);
    state.ncrs = state.ncrs.filter(item => item.id !== id);

    const relatedInvitations = state.invitations.filter(item => item.caseId === id);
    for (const invitation of relatedInvitations) {
      await invStore.removeItem(invitation.id);
    }

    state.invitations = state.invitations.filter(item => item.caseId !== id);
  }

  async function saveDepartmentLocal(name) {
    const department = {
      id: generateId(),
      name: name.trim(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    await deptStore.setItem(department.id, department);
    state.departments = [...state.departments, department].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    return department;
  }

  async function updateDepartmentLocal(id, name) {
    const existing = await deptStore.getItem(id);
    if (!existing) {
      throw new Error('القسم غير موجود');
    }

    const updated = {
      ...existing,
      name: name.trim(),
      updatedAt: Date.now()
    };

    await deptStore.setItem(id, updated);
    state.departments = state.departments.map(item => (item.id === id ? updated : item)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    return updated;
  }

  async function deleteDepartmentLocal(id) {
    await deptStore.removeItem(id);
    state.departments = state.departments.filter(item => item.id !== id);

    for (const ncr of state.ncrs.filter(item => item.departmentId === id)) {
      await updateNCRLocal(ncr.id, { departmentId: null });
    }

    for (const invitation of state.invitations.filter(item => item.departmentId === id)) {
      await invStore.removeItem(invitation.id);
    }

    state.invitations = state.invitations.filter(item => item.departmentId !== id);
  }

  async function saveInvitationLocal(data) {
    const invitation = {
      id: generateId(),
      caseId: data.caseId,
      departmentId: data.departmentId,
      assignee: data.assignee,
      invitationStatus: data.invitationStatus || 'Update',
      createdAt: Date.now()
    };

    await invStore.setItem(invitation.id, invitation);
    state.invitations = [invitation, ...state.invitations];

    const ncr = state.ncrs.find(item => item.id === invitation.caseId);
    if (ncr) {
      const updatedNcr = {
        ...ncr,
        updatedAt: Date.now(),
        history: appendLocalHistory(ncr, `تم إرسال دعوة إلى ${data.assignee}.`, 'invitation.created')
      };
      await ncrStore.setItem(updatedNcr.id, updatedNcr);
      state.ncrs = sortNcrs(state.ncrs.map(item => (item.id === updatedNcr.id ? updatedNcr : item)));
    }

    return invitation;
  }

  async function deleteInvitationLocal(id) {
    await invStore.removeItem(id);
    state.invitations = state.invitations.filter(item => item.id !== id);
  }

  async function loadRemoteData() {
    const [ncrsResponse, departmentsResponse, invitationsResponse, usersResponse] = await Promise.all([
      apiRequest('/api/ncrs'),
      apiRequest('/api/departments'),
      apiRequest('/api/invitations'),
      apiRequest('/api/users')
    ]);

    state.ncrs = sortNcrs(ncrsResponse.items || []);
    state.departments = [...(departmentsResponse.items || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
    state.invitations = invitationsResponse.items || [];
    state.users = usersResponse.items || [];
    state.backend.lastSyncAt = Date.now();
    state.backend.error = null;
  }

  function renderTemplateOptions() {
    const select = document.getElementById('f-template-select');
    if (!select) {
      return;
    }

    const currentValue = select.value;
    select.innerHTML =
      '<option value="">-- بدون قالب --</option>' +
      state.templates.map(template => `<option value="${template.id}">${escapeHTML(template.name)}</option>`).join('');

    if (currentValue && state.templates.some(template => template.id === currentValue)) {
      select.value = currentValue;
    }
  }

  function renderSettingsSummary() {
    const container = document.getElementById('settings-summary');
    if (!container) {
      return;
    }

    container.innerHTML = `
      <div class="settings-summary-item">
        <span>اسم الجهة</span>
        <strong>${escapeHTML(state.settings.orgName)}</strong>
      </div>
      <div class="settings-summary-item">
        <span>بادئة الحالات</span>
        <strong dir="ltr">${escapeHTML(state.settings.casePrefix)}</strong>
      </div>
      <div class="settings-summary-item">
        <span>SLA</span>
        <strong>${state.settings.slaWarningDays} / ${state.settings.slaCriticalDays} يوم</strong>
      </div>
      <div class="settings-summary-item">
        <span>القوالب</span>
        <strong>${state.templates.length}</strong>
      </div>
    `;
  }

  function renderTemplateList() {
    const container = document.getElementById('template-list');
    if (!container) {
      return;
    }

    if (state.templates.length === 0) {
      container.innerHTML = '<div class="empty-state"><i class="fas fa-layer-group"></i><h3>لا توجد قوالب</h3><p>احفظ أول قالب للاستخدام السريع داخل نموذج التقرير.</p></div>';
      return;
    }

    container.innerHTML = state.templates.map(template => `
      <div class="template-card">
        <div class="template-card-head">
          <div>
            <div class="template-card-title">${escapeHTML(template.name)}</div>
            <div class="template-card-meta">${getPriorityBadge(template.priority || 'Medium')} ${getSeverityBadge(template.severity || 'Major')}</div>
          </div>
          <div class="template-card-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick="applyTemplateById('${template.id}')">تطبيق</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="deleteTemplate('${template.id}')">حذف</button>
          </div>
        </div>
        <div class="template-card-body">
          <p>${escapeHTML(template.description || 'بدون وصف افتراضي')}</p>
          ${template.tags?.length ? `<div class="template-tags">${template.tags.map(tag => `<span class="badge badge-gray">${escapeHTML(tag)}</span>`).join(' ')}</div>` : ''}
        </div>
      </div>
    `).join('');
  }

  function fillSettingsForm() {
    const settings = state.settings;
    const mappings = {
      's-org-name': settings.orgName,
      's-site-name': settings.siteName,
      's-case-prefix': settings.casePrefix,
      's-accent-color': settings.accentColor,
      's-sla-warning': settings.slaWarningDays,
      's-sla-critical': settings.slaCriticalDays,
      's-print-subtitle': settings.printSubtitle
    };

    Object.entries(mappings).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) {
        element.value = value;
      }
    });

    const onboarding = document.getElementById('s-show-onboarding');
    const compactPrint = document.getElementById('s-compact-print');
    const autoPrint = document.getElementById('s-auto-print-save');

    if (onboarding) onboarding.checked = !!settings.showOnboarding;
    if (compactPrint) compactPrint.checked = !!settings.compactPrint;
    if (autoPrint) autoPrint.checked = !!settings.autoPrintAfterSave;
  }

  function renderSettingsView() {
    fillSettingsForm();
    renderTemplateOptions();
    renderTemplateList();
    renderSettingsSummary();
  }

  function getTemplatePayloadFromForm() {
    return {
      id: generateId(),
      name: document.getElementById('t-name').value.trim(),
      priority: document.getElementById('t-priority').value,
      severity: document.getElementById('t-severity').value,
      description: document.getElementById('t-description').value.trim(),
      rootCause: document.getElementById('t-root-cause').value.trim(),
      correctiveAction: document.getElementById('t-corrective-action').value.trim(),
      tags: parseTags(document.getElementById('t-tags').value),
      createdAt: Date.now()
    };
  }

  function applyTemplateToForm(template) {
    if (!template) {
      return;
    }

    navigateTo('add-ncr');
    document.getElementById('f-priority').value = template.priority || 'Medium';
    document.getElementById('f-severity').value = template.severity || 'Major';
    document.getElementById('f-description').value = template.description || '';
    document.getElementById('f-root-cause').value = template.rootCause || '';
    document.getElementById('f-corrective-action').value = template.correctiveAction || '';
    document.getElementById('f-tags').value = (template.tags || []).join(', ');
    document.getElementById('f-template-select').value = template.id;
  }

  async function ensureWritableAccess() {
    if (!state.backend.available) {
      return;
    }

    if (!state.currentUser) {
      openAuthModal();
      const error = new Error('يجب تسجيل الدخول أولاً.');
      error.status = 401;
      throw error;
    }

    if (!canManageRecords()) {
      const error = new Error('صلاحياتك الحالية لا تسمح بالتعديل.');
      error.status = 403;
      throw error;
    }
  }

  window.loadAllData = async function loadAllDataEnterprise() {
    if (isRemoteMode()) {
      await loadRemoteData();
      return;
    }

    if (isRemoteLocked()) {
      state.ncrs = [];
      state.departments = [];
      state.invitations = [];
      state.users = [];
      return;
    }

    state.users = [];
    await legacy.loadAllData();
    state.ncrs = sortNcrs(state.ncrs);
  };

  window.saveNCR = async function saveNCREnterprise(data) {
    await ensureWritableAccess();

    if (isRemoteMode()) {
      await apiRequest('/api/ncrs', {
        method: 'POST',
        body: data
      });
      await loadRemoteData();
      return state.ncrs[0];
    }

    return saveNCRLocal(data);
  };

  window.updateNCR = async function updateNCREnterprise(id, updates) {
    await ensureWritableAccess();

    if (isRemoteMode()) {
      await apiRequest(`/api/ncrs/${id}`, {
        method: 'PATCH',
        body: updates
      });
      await loadRemoteData();
      return state.ncrs.find(item => item.id === id) || null;
    }

    return updateNCRLocal(id, updates);
  };

  window.deleteNCR = async function deleteNCREnterprise(id) {
    await ensureWritableAccess();

    if (isRemoteMode()) {
      await apiRequest(`/api/ncrs/${id}`, {
        method: 'DELETE'
      });
      await loadRemoteData();
      return;
    }

    await deleteNCRLocal(id);
  };

  window.saveDepartment = async function saveDepartmentEnterprise(name) {
    await ensureWritableAccess();

    if (isRemoteMode()) {
      const response = await apiRequest('/api/departments', {
        method: 'POST',
        body: { name }
      });
      state.departments = [...state.departments, response.item].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
      return response.item;
    }

    return saveDepartmentLocal(name);
  };

  window.updateDepartment = async function updateDepartmentEnterprise(id, name) {
    await ensureWritableAccess();

    if (isRemoteMode()) {
      const response = await apiRequest(`/api/departments/${id}`, {
        method: 'PATCH',
        body: { name }
      });
      state.departments = state.departments.map(item => (item.id === id ? response.item : item)).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
      return response.item;
    }

    return updateDepartmentLocal(id, name);
  };

  window.deleteDepartment = async function deleteDepartmentEnterprise(id) {
    await ensureWritableAccess();

    if (isRemoteMode()) {
      await apiRequest(`/api/departments/${id}`, {
        method: 'DELETE'
      });
      await loadRemoteData();
      return;
    }

    await deleteDepartmentLocal(id);
  };

  window.saveInvitation = async function saveInvitationEnterprise(data) {
    await ensureWritableAccess();

    if (isRemoteMode()) {
      const response = await apiRequest('/api/invitations', {
        method: 'POST',
        body: data
      });
      state.invitations = [response.item, ...state.invitations];
      await loadRemoteData();
      return response.item;
    }

    return saveInvitationLocal(data);
  };

  window.deleteInvitation = async function deleteInvitationEnterprise(id) {
    await ensureWritableAccess();

    if (isRemoteMode()) {
      await apiRequest(`/api/invitations/${id}`, {
        method: 'DELETE'
      });
      state.invitations = state.invitations.filter(item => item.id !== id);
      await loadRemoteData();
      return;
    }

    await deleteInvitationLocal(id);
  };

  window.fileToBase64 = function fileToBase64Enterprise(file) {
    return new Promise((resolve, reject) => {
      if (!file) {
        resolve(null);
        return;
      }

      const maxSize = isRemoteMode() ? APP_CONFIG.MAX_REMOTE_FILE_SIZE : APP_CONFIG.MAX_LOCAL_FILE_SIZE;
      if (file.size > maxSize) {
        reject(new Error(`حجم الملف يتجاوز ${Math.round(maxSize / (1024 * 1024))} ميجابايت`));
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
  };

  window.populateDeptSelects = function populateDeptSelectsEnterprise() {
    const selects = ['f-department', 'inv-dept-select'];
    selects.forEach(selectId => {
      const select = document.getElementById(selectId);
      if (!select) {
        return;
      }

      const currentValue = select.value;
      const options = state.departments.map(item => `<option value="${item.id}">${escapeHTML(item.name)}</option>`).join('');
      const defaultOption = selectId === 'f-department'
        ? '<option value="">-- لا يوجد --</option>'
        : '<option value="">-- اختر القسم --</option>';
      select.innerHTML = defaultOption + options;
      if (currentValue) {
        select.value = currentValue;
      }
    });

    const ownerSelect = document.getElementById('f-owner-id');
    if (ownerSelect) {
      const currentValue = ownerSelect.value;
      ownerSelect.innerHTML =
        '<option value="">-- غير محدد --</option>' +
        state.users
          .filter(item => item.isActive)
          .map(item => `<option value="${item.id}">${escapeHTML(item.fullName)}</option>`)
          .join('');
      if (currentValue) {
        ownerSelect.value = currentValue;
      }
    }

    renderTemplateOptions();
  };

  window.getFilteredNCRs = function getFilteredNCRsEnterprise() {
    const { month, year, status, search, priority } = state.filter;

    return state.ncrs
      .map(ncr => ({
        ...ncr,
        tags: parseTags(ncr.tags),
        elapsedDays: calculateElapsedDays(ncr.date)
      }))
      .filter(ncr => {
        const date = new Date(ncr.date || ncr.createdAt || Date.now());
        if (month !== null && (date.getMonth() !== month || date.getFullYear() !== year)) {
          return false;
        }

        if (status !== 'all' && ncr.status !== status) {
          return false;
        }

        if (priority !== 'all' && (ncr.priority || 'Medium') !== priority) {
          return false;
        }

        if (!search) {
          return true;
        }

        const query = search.toLowerCase();
        return [
          ncr.caseNumber,
          ncr.description,
          ncr.subCase,
          ncr.rootCause,
          ncr.correctiveAction,
          ncr.ownerName,
          ncr.departmentName || getDeptName(ncr.departmentId),
          (ncr.tags || []).join(' ')
        ]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(query));
      });
  };

  window.getStats = function getStatsEnterprise() {
    const items = state.ncrs.map(item => ({
      ...item,
      elapsedDays: calculateElapsedDays(item.date)
    }));

    const dueSoon = items.filter(item => item.dueDate && timeValue(item.dueDate) > Date.now() && timeValue(item.dueDate) - Date.now() < 3 * 24 * 60 * 60 * 1000 && item.status !== 'Closed').length;
    const overdue = items.filter(item => item.dueDate && timeValue(item.dueDate) < Date.now() && item.status !== 'Closed').length;
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

  window.setPriorityFilter = function setPriorityFilter(priority, el) {
    state.filter.priority = priority;
    document.querySelectorAll('.priority-pills .filter-pill').forEach(item => item.classList.remove('active'));
    if (el) {
      el.classList.add('active');
    }
    renderDashboard();
  };

  window.renderNCRList = function renderNCRListEnterprise() {
    const container = document.getElementById('ncr-list');
    if (!container) {
      return;
    }

    if (isRemoteLocked()) {
      container.innerHTML = `
        <div class="empty-state" role="status">
          <i class="fas fa-user-lock" aria-hidden="true"></i>
          <h3>تسجيل الدخول مطلوب</h3>
          <p>هذا الإصدار متصل بقاعدة بيانات مشتركة. سجّل الدخول لعرض التقارير.</p>
          <button class="btn btn-primary btn-sm" onclick="openAuthModal()" style="margin-top:8px">
            <i class="fas fa-right-to-bracket" aria-hidden="true"></i>
            تسجيل الدخول
          </button>
        </div>`;
      return;
    }

    legacy.renderNCRList();
  };

  function renderOperationalSummary() {
    const container = document.getElementById('dashboard-ops');
    if (!container) {
      return;
    }

    const stats = getStats();
    container.innerHTML = `
      <div class="ops-card">
        <div class="ops-card-label">حالات حرجة</div>
        <div class="ops-card-value">${stats.critical}</div>
        <div class="ops-card-hint">بحسب الأولوية أو درجة التأثير</div>
      </div>
      <div class="ops-card">
        <div class="ops-card-label">متأخرة عن الاستحقاق</div>
        <div class="ops-card-value">${stats.overdue}</div>
        <div class="ops-card-hint">تقارير مفتوحة تجاوزت موعدها</div>
      </div>
      <div class="ops-card">
        <div class="ops-card-label">قريبة من الاستحقاق</div>
        <div class="ops-card-value">${stats.dueSoon}</div>
        <div class="ops-card-hint">خلال أقل من 3 أيام</div>
      </div>
    `;
  }

  window.renderNCRCard = function renderNCRCardEnterprise(ncr) {
    const sla = getSLAStatus(ncr.elapsedDays);
    const deptName = ncr.departmentName || getDeptName(ncr.departmentId);
    const ownerName = ncr.ownerName || getUserNameById(ncr.ownerId);
    const hasAttachment = !!ncr.attachedDocument;
    const dueDate = ncr.dueDate ? formatDate(ncr.dueDate) : null;
    const canEdit = canManageRecords();

    return `
      <article class="ncr-card ${ncr.priority === 'Critical' ? 'sla-critical' : ''}" role="listitem" data-id="${ncr.id}">
        ${hasAttachment ? '<div class="has-attachment-indicator" title="يحتوي على مرفق"></div>' : ''}
        <div class="ncr-card-accent ${ncr.status === 'Closed' ? 'status-closed' : ncr.status === 'In Progress' ? 'status-progress' : 'status-open'}"></div>
        <div class="ncr-card-body">
          <div class="ncr-card-header">
            <div>
              <div class="ncr-case-number">${escapeHTML(ncr.caseNumber)}</div>
              <div class="ncr-subcase" style="margin-top:2px">${formatDate(ncr.date)}</div>
            </div>
            <div class="metrics-inline">
              ${getStatusBadge(ncr.status)}
              ${getPriorityBadge(ncr.priority || 'Medium')}
              ${getSeverityBadge(ncr.severity || 'Major')}
              <span class="sla-badge ${sla.cls}">
                <i class="fas ${sla.icon}" aria-hidden="true"></i>
                ${sla.label}
              </span>
            </div>
          </div>
          <p class="ncr-description">${escapeHTML(ncr.description)}</p>
          <div class="ncr-meta">
            ${deptName && deptName !== '—' ? `<span class="ncr-meta-item"><i class="fas fa-building" aria-hidden="true"></i>${escapeHTML(deptName)}</span>` : ''}
            ${ownerName && ownerName !== '—' ? `<span class="ncr-meta-item"><i class="fas fa-user" aria-hidden="true"></i>${escapeHTML(ownerName)}</span>` : ''}
            ${dueDate ? `<span class="ncr-meta-item"><i class="fas fa-calendar-day" aria-hidden="true"></i>${escapeHTML(dueDate)}</span>` : ''}
            ${hasAttachment ? `<span class="ncr-meta-item" style="color:var(--vf-cyan)"><i class="fas fa-paperclip" aria-hidden="true"></i>مرفق</span>` : ''}
          </div>
        </div>
        <div class="ncr-card-footer">
          ${canEdit ? `<button class="card-action-btn edit" onclick="editNCR('${ncr.id}')"><i class="fas fa-pen" aria-hidden="true"></i>تعديل</button>` : ''}
          ${canEdit ? `<button class="card-action-btn invite" onclick="openInviteModal('${ncr.id}')"><i class="fas fa-envelope" aria-hidden="true"></i>دعوة</button>` : ''}
          <button class="card-action-btn share" onclick="shareNCR('${ncr.id}')"><i class="fas fa-share-alt" aria-hidden="true"></i>مشاركة</button>
          <button class="card-action-btn" onclick="openNCRDetail('${ncr.id}')" style="color:var(--vf-text-muted)"><i class="fas fa-eye" aria-hidden="true"></i></button>
          ${canEdit ? `<button class="card-action-btn delete" onclick="confirmDeleteNCR('${ncr.id}')"><i class="fas fa-trash" aria-hidden="true"></i></button>` : ''}
        </div>
      </article>
    `;
  };

  window.renderDashboard = function renderDashboardEnterprise() {
    legacy.renderStats();
    renderNCRList();
    renderOperationalSummary();
    renderHeaderSession();
    renderSyncBanner();
  };

  window.renderDepartments = function renderDepartmentsEnterprise() {
    const deptForm = document.getElementById('dept-form');

    if (isRemoteLocked()) {
      const deptList = document.getElementById('dept-list');
      const invList = document.getElementById('inv-list');
      if (deptForm) {
        deptForm.classList.add('hidden');
      }
      if (deptList) {
        deptList.innerHTML = '<div class="empty-state"><i class="fas fa-user-lock"></i><h3>تسجيل الدخول مطلوب</h3><p>يجب تسجيل الدخول لعرض الأقسام المشتركة.</p></div>';
      }
      if (invList) {
        invList.innerHTML = '';
      }
      return;
    }

    const deptList = document.getElementById('dept-list');
    const invList = document.getElementById('inv-list');
    const canEdit = canManageRecords();
    if (deptForm) {
      deptForm.classList.toggle('hidden', !canEdit);
    }

    if (deptList) {
      deptList.innerHTML = state.departments.length
        ? state.departments.map(dept => `
            <div class="dept-card" role="listitem">
              <div class="dept-icon"><i class="fas fa-building" aria-hidden="true"></i></div>
              <div class="dept-info">
                <div class="dept-name">${escapeHTML(dept.name)}</div>
                <div class="dept-inv-count">${state.invitations.filter(item => item.departmentId === dept.id).length} دعوة مرتبطة</div>
              </div>
              <div class="dept-actions">
                ${canEdit ? `<button class="icon-btn" onclick="editDept('${dept.id}', '${escapeHTML(dept.name)}')"><i class="fas fa-pen" aria-hidden="true"></i></button>` : ''}
                ${canEdit ? `<button class="icon-btn" onclick="confirmDeleteDept('${dept.id}')" style="color:var(--vf-red)"><i class="fas fa-trash" aria-hidden="true"></i></button>` : ''}
              </div>
            </div>
          `).join('')
        : '<div class="empty-state"><i class="fas fa-building-circle-xmark"></i><h3>لا توجد أقسام</h3><p>أضف قسماً جديداً أو ابدأ بتفعيل قاعدة البيانات.</p></div>';
    }

    if (invList) {
      invList.innerHTML = state.invitations.length
        ? [...state.invitations].sort((a, b) => timeValue(b.createdAt) - timeValue(a.createdAt)).map(invitation => {
            const caseNumber = invitation.caseNumber || state.ncrs.find(item => item.id === invitation.caseId)?.caseNumber || '—';
            const departmentName = invitation.departmentName || getDeptName(invitation.departmentId);
            const departmentSuffix = departmentName && departmentName !== '—' ? ` — ${escapeHTML(departmentName)}` : '';

            return `
              <div class="inv-card" role="listitem">
                <div class="inv-avatar">${getInitials(invitation.assignee)}</div>
                <div class="inv-info">
                  <div class="inv-assignee">${escapeHTML(invitation.assignee)}</div>
                  <div class="inv-case">${escapeHTML(caseNumber)}${departmentSuffix}</div>
                </div>
                <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px">
                  <span class="${invitation.invitationStatus === 'Cancel' ? 'inv-status-cancel' : 'inv-status-update'}">${escapeHTML(invitation.invitationStatus)}</span>
                  ${canEdit ? `<button class="icon-btn" onclick="confirmDeleteInvitation('${invitation.id}')" style="width:24px;height:24px;font-size:11px;color:var(--vf-text-subtle)"><i class="fas fa-times" aria-hidden="true"></i></button>` : ''}
                </div>
              </div>
            `;
          }).join('')
        : '<p class="text-subtle fs-xs" style="padding:8px 0">لا توجد دعوات مسجلة بعد.</p>';
    }

    populateDeptSelects();
  };

  window.renderUsersView = function renderUsersView() {
    const list = document.getElementById('user-list');
    const form = document.getElementById('user-form');
    if (!list || !form) {
      return;
    }

    if (!state.backend.available) {
      form.classList.add('hidden');
      list.innerHTML = '<div class="empty-state"><i class="fas fa-database"></i><h3>لا يوجد خادم</h3><p>إدارة المستخدمين متاحة فقط عند تشغيل API على Vercel وربط قاعدة بيانات.</p></div>';
      return;
    }

    if (isRemoteLocked()) {
      form.classList.add('hidden');
      list.innerHTML = '<div class="empty-state"><i class="fas fa-user-lock"></i><h3>تسجيل الدخول مطلوب</h3><p>سجّل الدخول أولاً لعرض المستخدمين.</p></div>';
      return;
    }

    if (!isAdmin()) {
      form.classList.add('hidden');
      list.innerHTML = '<div class="empty-state"><i class="fas fa-shield-halved"></i><h3>صلاحية غير كافية</h3><p>إدارة المستخدمين متاحة فقط للحساب الإداري.</p></div>';
      return;
    }

    form.classList.remove('hidden');
    list.innerHTML = state.users.length
      ? state.users.map(user => `
          <div class="user-card">
            <div class="user-card-main">
              <div class="user-avatar">${getInitials(user.fullName)}</div>
              <div>
                <div class="user-card-name">${escapeHTML(user.fullName)}</div>
                <div class="user-card-meta">${escapeHTML(user.email)} • ${escapeHTML(APP_CONFIG.ROLE_LABELS[user.role] || user.role)} • ${user.isActive ? 'نشط' : 'معطل'}</div>
              </div>
            </div>
            <div class="user-card-actions">
              <span class="badge ${user.isActive ? 'badge-green' : 'badge-gray'}">${user.isActive ? 'Active' : 'Disabled'}</span>
              ${state.currentUser?.id !== user.id ? `<button type="button" class="btn btn-secondary btn-sm" onclick="toggleUserActive('${user.id}', ${user.isActive ? 'false' : 'true'})">${user.isActive ? 'تعطيل' : 'تفعيل'}</button>` : ''}
            </div>
          </div>
        `).join('')
      : '<div class="empty-state"><i class="fas fa-users"></i><h3>لا يوجد مستخدمون</h3><p>أضف أول عضو فريق من النموذج أعلاه.</p></div>';
  };

  window.prepareAddNCRForm = function prepareAddNCRFormEnterprise() {
    if (!state.editingNCRId) {
      document.getElementById('ncr-form').reset();
      document.getElementById('f-case-number').value = generateEnterpriseCaseNumber();
      document.getElementById('f-editing-id').value = '';
      document.getElementById('form-view-label').textContent = 'إضافة تقرير جديد';
      document.getElementById('form-view-heading').textContent = 'تقرير عدم مطابقة NCR';
      document.getElementById('submit-btn-text').textContent = 'حفظ التقرير';
      document.getElementById('f-priority').value = 'Medium';
      document.getElementById('f-severity').value = 'Major';
      document.getElementById('f-template-select').value = '';
      document.getElementById('file-preview-container').innerHTML = '';
      state.fileData = null;
    }

    populateDeptSelects();
  };

  window.editNCR = function editNCREnterprise(id) {
    const ncr = state.ncrs.find(item => item.id === id);
    if (!ncr) {
      showToast('التقرير غير موجود', 'error');
      return;
    }

    state.editingNCRId = id;
    closeNCRDetailModal();
    navigateTo('add-ncr');

    document.getElementById('f-case-number').value = ncr.caseNumber || '';
    document.getElementById('f-sub-case').value = ncr.subCase || '';
    document.getElementById('f-description').value = ncr.description || '';
    document.getElementById('f-status').value = ncr.status || 'Open';
    document.getElementById('f-step').value = ncr.step || 1;
    document.getElementById('f-priority').value = ncr.priority || 'Medium';
    document.getElementById('f-severity').value = ncr.severity || 'Major';
    document.getElementById('f-owner-id').value = ncr.ownerId || '';
    document.getElementById('f-due-date').value = ncr.dueDate ? new Date(ncr.dueDate).toISOString().slice(0, 10) : '';
    document.getElementById('f-tags').value = parseTags(ncr.tags).join(', ');
    document.getElementById('f-root-cause').value = ncr.rootCause || '';
    document.getElementById('f-corrective-action').value = ncr.correctiveAction || '';
    document.getElementById('f-color').value = ncr.colorCode || '#3b82f6';
    document.getElementById('f-department').value = ncr.departmentId || '';
    document.getElementById('f-editing-id').value = id;
    document.getElementById('form-view-label').textContent = 'تعديل التقرير';
    document.getElementById('form-view-heading').textContent = ncr.caseNumber || 'تعديل';
    document.getElementById('submit-btn-text').textContent = 'تحديث التقرير';

    if (ncr.attachedDocument) {
      state.fileData = ncr.attachedDocument;
      renderFilePreview(ncr.attachedDocument.name, ncr.attachedDocument.size);
    } else {
      state.fileData = null;
      document.getElementById('file-preview-container').innerHTML = '';
    }
  };

  window.handleNCRFormSubmit = async function handleNCRFormSubmitEnterprise(event) {
    event.preventDefault();
    if (state.isSubmitting) {
      return;
    }

    const form = event.target;
    if (!form.checkValidity()) {
      form.querySelectorAll(':invalid')[0]?.focus();
      showToast('يرجى ملء الحقول المطلوبة', 'warning');
      return;
    }

    state.isSubmitting = true;
    const submitButton = document.getElementById('btn-submit-ncr');
    const originalHtml = submitButton.innerHTML;
    submitButton.innerHTML = '<span class="spinner"></span> جارٍ الحفظ...';
    submitButton.disabled = true;

    try {
      const payload = {
        caseNumber: document.getElementById('f-case-number').value.trim(),
        subCase: document.getElementById('f-sub-case').value.trim(),
        description: document.getElementById('f-description').value.trim(),
        status: document.getElementById('f-status').value,
        step: parseInt(document.getElementById('f-step').value || '1', 10) || 1,
        priority: document.getElementById('f-priority').value,
        severity: document.getElementById('f-severity').value,
        ownerId: document.getElementById('f-owner-id').value || null,
        dueDate: document.getElementById('f-due-date').value || null,
        tags: parseTags(document.getElementById('f-tags').value),
        rootCause: document.getElementById('f-root-cause').value.trim(),
        correctiveAction: document.getElementById('f-corrective-action').value.trim(),
        colorCode: document.getElementById('f-color').value,
        departmentId: document.getElementById('f-department').value || null,
        attachedDocument: state.fileData || null
      };

      const editingId = document.getElementById('f-editing-id').value;
      if (editingId) {
        await updateNCR(editingId, payload);
        showToast('تم تحديث التقرير بنجاح', 'success');
      } else {
        await saveNCR(payload);
        showToast('تم حفظ التقرير بنجاح', 'success');
      }

      state.editingNCRId = null;
      document.getElementById('f-editing-id').value = '';
      form.reset();
      document.getElementById('file-preview-container').innerHTML = '';
      state.fileData = null;
      navigateTo('dashboard');
      if (state.settings.autoPrintAfterSave) {
        setTimeout(() => printCurrentReport(), 250);
      }
    } catch (error) {
      showToast(error.message || 'فشل حفظ التقرير', 'error');
    } finally {
      state.isSubmitting = false;
      submitButton.innerHTML = originalHtml;
      submitButton.disabled = false;
    }
  };

  window.openNCRDetail = function openNCRDetailEnterprise(id) {
    const ncr = state.ncrs.find(item => item.id === id);
    if (!ncr) {
      return;
    }

    state.detailNCRId = id;
    const deptName = ncr.departmentName || getDeptName(ncr.departmentId);
    const ownerName = ncr.ownerName || getUserNameById(ncr.ownerId);
    const sla = getSLAStatus(calculateElapsedDays(ncr.date));
    const history = Array.isArray(ncr.history) ? ncr.history : [];
    const attachmentMarkup = ncr.attachedDocument
      ? (ncr.attachedDocument.type || '').startsWith('image/')
        ? `<img src="${ncr.attachedDocument.base64}" alt="مرفق" class="attachment-preview" loading="lazy">`
        : `<a href="${ncr.attachedDocument.base64}" download="${escapeHTML(ncr.attachedDocument.name)}" class="btn btn-secondary btn-sm"><i class="fas fa-download" aria-hidden="true"></i>${escapeHTML(ncr.attachedDocument.name)}</a>`
      : '—';

    document.getElementById('detail-modal-title').textContent = 'تفاصيل التقرير';
    document.getElementById('detail-modal-case-num').textContent = ncr.caseNumber;
    document.getElementById('detail-modal-body').innerHTML = `
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-circle-dot" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">الحالة</div>
          <div class="detail-field-value metrics-inline">
            ${getStatusBadge(ncr.status)}
            ${getPriorityBadge(ncr.priority || 'Medium')}
            ${getSeverityBadge(ncr.severity || 'Major')}
          </div>
        </div>
      </div>
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-clock" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">SLA</div>
          <div class="detail-field-value"><span class="sla-badge ${sla.cls}"><i class="fas ${sla.icon}" aria-hidden="true"></i>${sla.label}</span></div>
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
        <div class="detail-field-icon"><i class="fas fa-user" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">المسؤول</div>
          <div class="detail-field-value">${escapeHTML(ownerName || '—')}</div>
        </div>
      </div>
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-building" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">القسم</div>
          <div class="detail-field-value">${escapeHTML(deptName || '—')}</div>
        </div>
      </div>
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-calendar-day" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">تاريخ الاستحقاق</div>
          <div class="detail-field-value">${ncr.dueDate ? escapeHTML(formatDate(ncr.dueDate)) : '—'}</div>
        </div>
      </div>
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-diagram-project" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">السبب الجذري</div>
          <div class="detail-field-value">${escapeHTML(ncr.rootCause || '—')}</div>
        </div>
      </div>
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-screwdriver-wrench" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">الإجراء التصحيحي</div>
          <div class="detail-field-value">${escapeHTML(ncr.correctiveAction || '—')}</div>
        </div>
      </div>
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-tags" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">الوسوم</div>
          <div class="detail-field-value">${parseTags(ncr.tags).length ? parseTags(ncr.tags).map(tag => `<span class="badge badge-gray">${escapeHTML(tag)}</span>`).join(' ') : '—'}</div>
        </div>
      </div>
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-paperclip" aria-hidden="true"></i></div>
        <div>
          <div class="detail-field-label">المرفق</div>
          <div class="detail-field-value">${attachmentMarkup}</div>
        </div>
      </div>
      <div class="detail-field">
        <div class="detail-field-icon"><i class="fas fa-timeline" aria-hidden="true"></i></div>
        <div style="width:100%">
          <div class="detail-field-label">سجل النشاط</div>
          <div class="activity-list">
            ${history.length ? history.map(item => `
              <div class="detail-history-item">
                <div>${escapeHTML(item.message)}</div>
                <div class="detail-history-time">${escapeHTML(item.actorName || 'System')} • ${escapeHTML(formatDateTime(item.createdAt))}</div>
              </div>
            `).join('') : '<div class="detail-field-value">لا يوجد سجل نشاط بعد.</div>'}
          </div>
        </div>
      </div>
    `;

    document.getElementById('detail-edit-btn').classList.toggle('hidden', !canManageRecords());
    document.getElementById('detail-invite-btn').classList.toggle('hidden', !canManageRecords());
    openModal('ncr-detail-modal');
  };

  window.navigateTo = function navigateToEnterprise(view) {
    if (view === 'add-ncr' && !canManageRecords()) {
      showToast('صلاحياتك الحالية لا تسمح بإضافة تقرير.', 'warning');
      if (state.backend.available) {
        openAuthModal();
      }
      view = 'dashboard';
    }

    state.view = view;
    document.querySelectorAll('.view').forEach(item => item.classList.remove('active'));
    const target = document.getElementById(`view-${view}`);
    if (target) {
      target.classList.add('active');
    }

    document.querySelectorAll('.nav-item').forEach(item => {
      const active = item.dataset.view === view;
      item.classList.toggle('active', active);
      item.setAttribute('aria-current', active ? 'page' : 'false');
    });

    const fab = document.getElementById('fab');
    if (fab) {
      fab.classList.toggle('hidden', view !== 'dashboard' || !canManageRecords());
    }

    if (view === 'dashboard') {
      renderDashboard();
    } else if (view === 'departments') {
      renderDepartments();
    } else if (view === 'users') {
      renderUsersView();
    } else if (view === 'settings') {
      renderSettingsView();
    } else if (view === 'add-ncr') {
      prepareAddNCRForm();
    }

    document.getElementById('main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  window.openAuthModal = function openAuthModal(mode) {
    if (!state.backend.available) {
      return;
    }
    state.backend.authMode = mode || state.backend.authMode || (state.backend.hasUsers ? 'login' : 'setup');
    updateAuthModal();
    legacy.openModal('auth-modal');
  };

  window.closeAuthModal = function closeAuthModal() {
    if (isRemoteLocked()) {
      return;
    }
    legacy.closeModal('auth-modal');
  };

  window.handleAuthSubmit = async function handleAuthSubmit(event) {
    event.preventDefault();
    const setupMode = state.backend.authMode === 'setup';
    const body = {
      fullName: document.getElementById('auth-full-name')?.value.trim(),
      email: document.getElementById('auth-email').value.trim(),
      password: document.getElementById('auth-password').value
    };

    try {
      const response = await apiRequest(setupMode ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body
      });
      state.currentUser = response.user;
      state.backend.hasUsers = true;
      await loadAllData();
      legacy.closeModal('auth-modal');
      renderHeaderSession();
      renderSyncBanner();
      populateDeptSelects();
      navigateTo('dashboard');
      showToast(setupMode ? 'تم إنشاء الحساب الإداري' : 'تم تسجيل الدخول بنجاح', 'success');
    } catch (error) {
      showToast(error.message || 'فشل تسجيل الدخول', 'error');
    }
  };

  window.logoutCurrentUser = async function logoutCurrentUser() {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
    } catch (_) {
      // Ignore logout transport failures and still reset local state.
    }

    state.currentUser = null;
    state.users = [];
    state.ncrs = [];
    state.departments = [];
    state.invitations = [];
    state.backend.mode = 'locked';
    state.backend.authMode = 'login';
    renderHeaderSession();
    renderSyncBanner();
    renderDashboard();
    openAuthModal('login');
  };

  window.handleUserFormSubmit = async function handleUserFormSubmit(event) {
    event.preventDefault();
    if (!isAdmin()) {
      showToast('إدارة المستخدمين متاحة فقط للمسؤول', 'warning');
      return;
    }

    const form = event.target;
    try {
      await apiRequest('/api/users', {
        method: 'POST',
        body: {
          fullName: document.getElementById('u-full-name').value.trim(),
          email: document.getElementById('u-email').value.trim(),
          password: document.getElementById('u-password').value,
          role: document.getElementById('u-role').value
        }
      });
      form.reset();
      await loadRemoteData();
      renderUsersView();
      populateDeptSelects();
      showToast('تمت إضافة المستخدم', 'success');
    } catch (error) {
      showToast(error.message || 'فشل إضافة المستخدم', 'error');
    }
  };

  window.toggleUserActive = async function toggleUserActive(id, isActive) {
    try {
      await apiRequest(`/api/users/${id}`, {
        method: 'PATCH',
        body: { isActive }
      });
      await loadRemoteData();
      renderUsersView();
      populateDeptSelects();
      showToast('تم تحديث حالة المستخدم', 'success');
    } catch (error) {
      showToast(error.message || 'فشل تحديث المستخدم', 'error');
    }
  };

  window.handleSettingsSubmit = function handleSettingsSubmit(event) {
    event.preventDefault();

    const warningDays = Math.max(1, parseInt(document.getElementById('s-sla-warning').value || '3', 10));
    const criticalDays = Math.max(warningDays + 1, parseInt(document.getElementById('s-sla-critical').value || '5', 10));

    state.settings = {
      orgName: document.getElementById('s-org-name').value.trim() || DEFAULT_SETTINGS.orgName,
      siteName: document.getElementById('s-site-name').value.trim() || DEFAULT_SETTINGS.siteName,
      casePrefix: document.getElementById('s-case-prefix').value.trim().toUpperCase() || DEFAULT_SETTINGS.casePrefix,
      accentColor: document.getElementById('s-accent-color').value || DEFAULT_SETTINGS.accentColor,
      slaWarningDays: warningDays,
      slaCriticalDays: criticalDays,
      printSubtitle: document.getElementById('s-print-subtitle').value.trim() || DEFAULT_SETTINGS.printSubtitle,
      showOnboarding: document.getElementById('s-show-onboarding').checked,
      compactPrint: document.getElementById('s-compact-print').checked,
      autoPrintAfterSave: document.getElementById('s-auto-print-save').checked
    };

    APP_CONFIG.SLA_WARNING_DAYS = warningDays;
    APP_CONFIG.SLA_CRITICAL_DAYS = criticalDays;
    if (!state.settings.showOnboarding) {
      localStorage.setItem(APP_CONFIG.firstVisitKey, '1');
    } else {
      localStorage.removeItem(APP_CONFIG.firstVisitKey);
    }
    persistCustomization();
    applyBranding();
    if (state.view === 'add-ncr' && !state.editingNCRId) {
      document.getElementById('f-case-number').value = generateEnterpriseCaseNumber();
    }
    renderSettingsView();
    renderDashboard();
    showToast('تم حفظ الإعدادات', 'success');
  };

  window.resetCustomization = function resetCustomization() {
    state.settings = { ...DEFAULT_SETTINGS };
    persistCustomization();
    localStorage.removeItem(APP_CONFIG.firstVisitKey);
    loadCustomization();
    applyBranding();
    renderSettingsView();
    renderDashboard();
    showToast('تمت إعادة الإعدادات إلى الوضع الافتراضي', 'info');
  };

  window.handleTemplateSubmit = function handleTemplateSubmit(event) {
    event.preventDefault();
    const template = getTemplatePayloadFromForm();

    if (!template.name) {
      showToast('اسم القالب مطلوب', 'warning');
      return;
    }

    state.templates.unshift(template);
    persistCustomization();
    event.target.reset();
    renderSettingsView();
    showToast('تم حفظ القالب', 'success');
  };

  window.deleteTemplate = function deleteTemplate(id) {
    state.templates = state.templates.filter(template => template.id !== id);
    persistCustomization();
    renderSettingsView();
    showToast('تم حذف القالب', 'info');
  };

  window.applyTemplateById = function applyTemplateById(id) {
    const template = state.templates.find(item => item.id === id);
    if (!template) {
      showToast('القالب غير موجود', 'warning');
      return;
    }
    applyTemplateToForm(template);
    showToast(`تم تطبيق قالب ${template.name}`, 'success');
  };

  window.applySelectedTemplate = function applySelectedTemplate() {
    const templateId = document.getElementById('f-template-select')?.value;
    if (!templateId) {
      showToast('اختر قالباً أولاً', 'warning');
      return;
    }
    applyTemplateById(templateId);
  };

  window.saveCurrentAsTemplate = function saveCurrentAsTemplate() {
    const description = document.getElementById('f-description').value.trim();
    const rootCause = document.getElementById('f-root-cause')?.value.trim() || '';
    const correctiveAction = document.getElementById('f-corrective-action')?.value.trim() || '';
    const tags = parseTags(document.getElementById('f-tags')?.value || '');

    if (!description && !rootCause && !correctiveAction) {
      showToast('املأ بعض بيانات التقرير أولاً ثم احفظها كقالب', 'warning');
      return;
    }

    const templateName = prompt('اسم القالب الجديد:');
    if (!templateName) {
      return;
    }

    state.templates.unshift({
      id: generateId(),
      name: templateName.trim(),
      priority: document.getElementById('f-priority').value,
      severity: document.getElementById('f-severity').value,
      description,
      rootCause,
      correctiveAction,
      tags,
      createdAt: Date.now()
    });
    persistCustomization();
    renderTemplateOptions();
    renderTemplateList();
    renderSettingsSummary();
    showToast('تم حفظ القالب من النموذج الحالي', 'success');
  };

  function buildPrintMarkup(title, rowsMarkup, metaMarkup = '') {
    return `
      <div class="print-sheet ${state.settings.compactPrint ? 'compact' : ''}">
        <div class="print-header">
          <div>
            <div class="print-org">${escapeHTML(state.settings.orgName)}</div>
            <div class="print-title">${escapeHTML(title)}</div>
            <div class="print-subtitle">${escapeHTML(state.settings.printSubtitle)}</div>
          </div>
          <div class="print-meta">
            <div>${escapeHTML(state.settings.siteName)}</div>
            <div>${escapeHTML(formatDateTime(Date.now()))}</div>
          </div>
        </div>
        ${metaMarkup ? `<div class="print-meta-grid">${metaMarkup}</div>` : ''}
        <div class="print-body">${rowsMarkup}</div>
      </div>
    `;
  }

  function openPrintSurface(markup) {
    const root = document.getElementById('print-root');
    if (!root) {
      return;
    }

    root.innerHTML = markup;
    root.setAttribute('aria-hidden', 'false');
    document.body.classList.add('print-mode');

    const cleanup = () => {
      document.body.classList.remove('print-mode');
      root.setAttribute('aria-hidden', 'true');
      setTimeout(() => {
        root.innerHTML = '';
      }, 100);
      window.removeEventListener('afterprint', cleanup);
    };

    window.addEventListener('afterprint', cleanup);
    window.print();
  }

  window.printCurrentReport = function printCurrentReport() {
    closeExportSheet?.();
    const rows = getFilteredNCRs();
    if (!rows.length) {
      showToast('لا توجد بيانات للطباعة', 'warning');
      return;
    }

    const stats = getStats();
    const metaMarkup = `
      <div class="print-chip">الإجمالي: ${rows.length}</div>
      <div class="print-chip">مفتوح: ${stats.open}</div>
      <div class="print-chip">قيد العمل: ${stats.inProgress}</div>
      <div class="print-chip">مغلق: ${stats.closed}</div>
      <div class="print-chip">SLA متجاوز: ${stats.slaBreached}</div>
    `;

    const rowsMarkup = `
      <table class="print-table">
        <thead>
          <tr>
            <th>رقم الحالة</th>
            <th>الوصف</th>
            <th>الحالة</th>
            <th>الأولوية</th>
            <th>المسؤول</th>
            <th>القسم</th>
            <th>الاستحقاق</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(item => `
            <tr>
              <td>${escapeHTML(item.caseNumber)}</td>
              <td>${escapeHTML(item.description || '')}</td>
              <td>${escapeHTML(APP_CONFIG.STATUS_LABELS[item.status] || item.status)}</td>
              <td>${escapeHTML(APP_CONFIG.PRIORITY_LABELS[item.priority] || item.priority || '')}</td>
              <td>${escapeHTML(item.ownerName || getUserNameById(item.ownerId))}</td>
              <td>${escapeHTML(item.departmentName || getDeptName(item.departmentId))}</td>
              <td>${item.dueDate ? escapeHTML(formatDate(item.dueDate)) : '—'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    openPrintSurface(buildPrintMarkup('طباعة سجل NCR', rowsMarkup, metaMarkup));
  };

  window.printDetailReport = function printDetailReport() {
    const id = state.detailNCRId;
    const ncr = id ? state.ncrs.find(item => item.id === id) : null;
    if (!ncr) {
      showToast('افتح تقريراً أولاً ثم اطبعه', 'warning');
      return;
    }

    const rowsMarkup = `
      <div class="print-detail-grid">
        <div class="print-detail-card"><span>رقم الحالة</span><strong>${escapeHTML(ncr.caseNumber)}</strong></div>
        <div class="print-detail-card"><span>الحالة</span><strong>${escapeHTML(APP_CONFIG.STATUS_LABELS[ncr.status] || ncr.status)}</strong></div>
        <div class="print-detail-card"><span>الأولوية</span><strong>${escapeHTML(APP_CONFIG.PRIORITY_LABELS[ncr.priority] || ncr.priority || '—')}</strong></div>
        <div class="print-detail-card"><span>التأثير</span><strong>${escapeHTML(APP_CONFIG.SEVERITY_LABELS[ncr.severity] || ncr.severity || '—')}</strong></div>
        <div class="print-detail-card"><span>المسؤول</span><strong>${escapeHTML(ncr.ownerName || getUserNameById(ncr.ownerId))}</strong></div>
        <div class="print-detail-card"><span>القسم</span><strong>${escapeHTML(ncr.departmentName || getDeptName(ncr.departmentId))}</strong></div>
        <div class="print-detail-card wide"><span>الوصف</span><strong>${escapeHTML(ncr.description || '—')}</strong></div>
        <div class="print-detail-card wide"><span>السبب الجذري</span><strong>${escapeHTML(ncr.rootCause || '—')}</strong></div>
        <div class="print-detail-card wide"><span>الإجراء التصحيحي</span><strong>${escapeHTML(ncr.correctiveAction || '—')}</strong></div>
      </div>
    `;

    openPrintSurface(buildPrintMarkup(`تقرير ${ncr.caseNumber}`, rowsMarkup));
  };

  window.generateCaseNumber = generateEnterpriseCaseNumber;
  generateCaseNumber = window.generateCaseNumber;
  loadAllData = window.loadAllData;
  saveNCR = window.saveNCR;
  updateNCR = window.updateNCR;
  deleteNCR = window.deleteNCR;
  saveDepartment = window.saveDepartment;
  updateDepartment = window.updateDepartment;
  deleteDepartment = window.deleteDepartment;
  saveInvitation = window.saveInvitation;
  deleteInvitation = window.deleteInvitation;
  fileToBase64 = window.fileToBase64;
  populateDeptSelects = window.populateDeptSelects;
  getFilteredNCRs = window.getFilteredNCRs;
  getStats = window.getStats;
  renderNCRList = window.renderNCRList;
  renderNCRCard = window.renderNCRCard;
  renderDashboard = window.renderDashboard;
  renderDepartments = window.renderDepartments;
  prepareAddNCRForm = window.prepareAddNCRForm;
  editNCR = window.editNCR;
  handleNCRFormSubmit = window.handleNCRFormSubmit;
  openNCRDetail = window.openNCRDetail;
  navigateTo = window.navigateTo;
  getExportData = window.getExportData;

  window.syncNow = async function syncNow() {
    if (!isRemoteMode()) {
      return;
    }

    try {
      await loadRemoteData();
      renderDashboard();
      if (state.view === 'departments') {
        renderDepartments();
      }
      if (state.view === 'users') {
        renderUsersView();
      }
      showToast('تمت مزامنة البيانات', 'success');
    } catch (error) {
      showToast(error.message || 'فشلت المزامنة', 'error');
    }
  };

  window.getExportData = function getExportDataEnterprise() {
    const ncrs = getFilteredNCRs();
    const monthLabel = state.filter.month !== null
      ? `${APP_CONFIG.MONTHS_AR[state.filter.month]} ${state.filter.year}`
      : 'الكل';

    const rows = ncrs.map(ncr => ({
      'رقم الحالة': ncr.caseNumber || '',
      'الحالة': APP_CONFIG.STATUS_LABELS[ncr.status] || ncr.status,
      'الأولوية': APP_CONFIG.PRIORITY_LABELS[ncr.priority] || ncr.priority || '',
      'التأثير': APP_CONFIG.SEVERITY_LABELS[ncr.severity] || ncr.severity || '',
      'الوصف': ncr.description || '',
      'السبب الجذري': ncr.rootCause || '',
      'الإجراء التصحيحي': ncr.correctiveAction || '',
      'المسؤول': ncr.ownerName || getUserNameById(ncr.ownerId),
      'القسم': ncr.departmentName || getDeptName(ncr.departmentId),
      'الاستحقاق': ncr.dueDate ? formatDate(ncr.dueDate) : '',
      'SLA': calculateElapsedDays(ncr.date),
      'الوسوم': parseTags(ncr.tags).join(', '),
      'التاريخ': formatDate(ncr.date)
    }));

    return { rows, ncrs, monthLabel };
  };

  window.VortexFlowBootstrap = async function enterpriseBootstrap() {
    console.log(`[VF] Initializing ${APP_CONFIG.appName} v${APP_CONFIG.version}`);

    loadCustomization();
    applyBranding();
    injectEnterpriseMarkup();
    await legacy.registerServiceWorker();
    await refreshBackendSession();
    await loadAllData();

    renderMonthFilter();
    populateDeptSelects();
    renderSettingsView();
    navigateTo('dashboard');
    legacy.initKeyboardShortcuts();
    legacy.initSwipeGestures();
    legacy.initFileDragDrop();
    legacy.startSLATimer();
    if (state.settings.showOnboarding) {
      setTimeout(() => legacy.checkFirstVisit(), 600);
    } else {
      localStorage.setItem(APP_CONFIG.firstVisitKey, '1');
    }

    if (state.backend.available && !state.currentUser) {
      openAuthModal(state.backend.authMode);
    }
  };
})();
