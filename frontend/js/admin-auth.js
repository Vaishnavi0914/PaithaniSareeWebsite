const ADMIN_TOKEN_KEY = 'adminToken';
const ADMIN_ACTIVITY_KEY = 'admin_activity_log';
const ADMIN_API_STORAGE_KEY = 'paithani_api_base';
const DEFAULT_PROD_API_BASE = 'https://rudrapaithaniyeola.onrender.com';

function sanitizeApiBase(value) {
  if (!value) return '';
  const trimmed = String(value).trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed.replace(/\/+$/, '');
}

function isPrivateIp(value) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  const [a, b] = value.split('.').map(n => Number(n));
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isLocalHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '127.0.0.1') return true;
  return isPrivateIp(host);
}

function readAdminApiBaseFromMeta() {
  const meta = document.querySelector('meta[name="paithani-admin-api-base"]')
    || document.querySelector('meta[name="paithani-api-base"]');
  return meta && meta.content ? meta.content : '';
}

function readAdminApiBaseFromQuery() {
  try {
    const params = new URLSearchParams(window.location.search || '');
    return params.get('api') || params.get('apiBase') || params.get('api_base') || '';
  } catch (err) {
    return '';
  }
}

function readAdminApiBaseFromStorage() {
  try {
    return localStorage.getItem(ADMIN_API_STORAGE_KEY) || '';
  } catch (err) {
    return '';
  }
}

function storeAdminApiBase(value) {
  if (!value) return;
  try {
    localStorage.setItem(ADMIN_API_STORAGE_KEY, value);
  } catch (err) {
    // ignore storage errors
  }
}

function getConfiguredAdminApiBase() {
  const fromQuery = sanitizeApiBase(readAdminApiBaseFromQuery());
  if (fromQuery) {
    storeAdminApiBase(fromQuery);
    return fromQuery;
  }
  const fromGlobal = sanitizeApiBase(window.ADMIN_API_BASE_OVERRIDE || window.PAITHANI_API_BASE);
  if (fromGlobal) return fromGlobal;
  const fromMeta = sanitizeApiBase(readAdminApiBaseFromMeta());
  if (fromMeta) return fromMeta;
  const fromStorage = sanitizeApiBase(readAdminApiBaseFromStorage());
  if (fromStorage && isLocalHost(window.location.hostname || '')) return fromStorage;
  return '';
}

function logAdminActivity(action) {
  try {
    const raw = localStorage.getItem(ADMIN_ACTIVITY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? list : [];
    next.unshift({ action, at: new Date().toISOString() });
    localStorage.setItem(ADMIN_ACTIVITY_KEY, JSON.stringify(next.slice(0, 50)));
  } catch (err) {
    console.warn('activity log error', err);
  }
}

if (typeof window !== 'undefined' && typeof window.logAdminActivity !== 'function') {
  window.logAdminActivity = logAdminActivity;
}

function resolveAdminApiBase() {
  const configured = getConfiguredAdminApiBase();
  if (configured) return configured;
  const origin = window.location.origin || '';
  const host = window.location.hostname || '';
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  const localProtocol = 'http';

  if (!origin || origin === 'null' || origin.startsWith('file:')) {
    return 'http://localhost:5000';
  }
  if (host === 'localhost' || host === '127.0.0.1') {
    return `${localProtocol}://localhost:5000`;
  }
  if (isPrivateIp(host)) {
    return `${localProtocol}://${host}:5000`;
  }
  if (window.location.port === '5000') {
    return `${protocol}://${host}:5000`;
  }
  return DEFAULT_PROD_API_BASE;
}

const ADMIN_API_BASE = resolveAdminApiBase();
window.ADMIN_API_BASE = ADMIN_API_BASE;
window.resolveAdminApiBase = resolveAdminApiBase;

function getAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

function setAdminToken(token) {
  if (!token) return;
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

function ensureAdminAuth() {
  if (!getAdminToken() && !window.location.pathname.includes('admin-login.html')) {
    window.location.href = 'admin-login.html';
  }
}

function redirectIfAdminAuthed() {
  // Intentionally disabled so admin login always shows first.
}

function buildAdminHeaders(extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const token = getAdminToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function adminFetch(url, options = {}) {
  const headers = buildAdminHeaders(options.headers || {});
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    clearAdminToken();
    if (!window.location.pathname.includes('admin-login.html')) {
      window.location.href = 'admin-login.html';
    }
  }
  return res;
}

async function adminFetchJson(url, options = {}) {
  const res = await adminFetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const ADMIN_NOTIFY_MAX = 9;

function ensureAdminNotificationUI() {
  const topbarMeta = document.querySelector('.admin-topbar-meta');
  if (topbarMeta && !topbarMeta.querySelector('.admin-notify-link')) {
    const link = document.createElement('a');
    link.href = 'messages.html';
    link.className = 'admin-notify-link';
    link.setAttribute('aria-label', 'New messages');
    link.innerHTML = '<span class="admin-notify-icon">&#128276;</span><span class="admin-notify-badge is-hidden" data-admin-notify-count>0</span>';
    topbarMeta.prepend(link);
  }

  const headerNavLink = document.querySelector('header.header-main nav a[href="messages.html"]');
  if (headerNavLink && !headerNavLink.querySelector('.admin-nav-badge')) {
    const badge = document.createElement('span');
    badge.className = 'admin-nav-badge is-hidden';
    badge.setAttribute('data-admin-nav-count', '0');
    badge.textContent = '0';
    headerNavLink.appendChild(badge);
  }

  const sideNavLink = document.querySelector('.admin-side-nav a[href="#messages"]');
  if (sideNavLink && !sideNavLink.querySelector('.admin-nav-badge')) {
    const badge = document.createElement('span');
    badge.className = 'admin-nav-badge is-hidden';
    badge.setAttribute('data-admin-nav-count', '0');
    badge.textContent = '0';
    sideNavLink.appendChild(badge);
  }
}

function updateAdminNotificationCount(count) {
  const safeCount = Math.max(0, Number(count) || 0);
  const label = safeCount > ADMIN_NOTIFY_MAX ? `${ADMIN_NOTIFY_MAX}+` : String(safeCount);
  document.querySelectorAll('[data-admin-notify-count]').forEach((badge) => {
    if (safeCount <= 0) {
      badge.classList.add('is-hidden');
      badge.textContent = '0';
      return;
    }
    badge.classList.remove('is-hidden');
    badge.textContent = label;
  });
  document.querySelectorAll('.admin-nav-badge').forEach((badge) => {
    if (safeCount <= 0) {
      badge.classList.add('is-hidden');
      badge.textContent = '0';
      return;
    }
    badge.classList.remove('is-hidden');
    badge.textContent = label;
  });
}

async function refreshAdminNotifications() {
  if (window.location.pathname.includes('admin-login.html')) return;
  ensureAdminNotificationUI();
  try {
    const data = await adminFetchJson(`${ADMIN_API_BASE}/admin/contacts`);
    const list = Array.isArray(data) ? data : [];
    const openCount = list.filter(msg => {
      const status = String(msg.status || (msg.reply ? 'replied' : 'open')).toLowerCase();
      return status === 'open';
    }).length;
    updateAdminNotificationCount(openCount);
  } catch (err) {
    updateAdminNotificationCount(0);
  }
}

window.refreshAdminNotifications = refreshAdminNotifications;

redirectIfAdminAuthed();

document.addEventListener('DOMContentLoaded', () => {
  refreshAdminNotifications();
});
