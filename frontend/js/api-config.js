// Central API base configuration for production deployments.
// Set this once to your backend URL (no trailing slash).
(function () {
  if (typeof window === 'undefined') return;
  const existing = (window.PAITHANI_API_BASE || '').trim();
  if (existing) return;

  const origin = window.location.origin || '';
  const host = window.location.hostname || '';
  const protocol = window.location.protocol === 'https:' ? 'https' : 'http';
  const isLocalHost = host === 'localhost' || host === '127.0.0.1';
  const isFileOrigin = !origin || origin === 'null' || origin.startsWith('file:');
  const isPrivateIp = (value) => {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
    const [a, b] = value.split('.').map(n => Number(n));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  };

  let apiBase = origin;
  if (isFileOrigin) {
    apiBase = 'http://localhost:5000';
  } else if (window.location.port === '5000') {
    apiBase = `${protocol}://${host}:5000`;
  } else if (isLocalHost) {
    apiBase = 'http://localhost:5000';
  } else if (isPrivateIp(host)) {
    apiBase = `${protocol}://${host}:5000`;
  }
  if (!/^https?:\/\//i.test(apiBase)) return;
  window.PAITHANI_API_BASE = apiBase.replace(/\/+$/, '');
  window.ADMIN_API_BASE_OVERRIDE = window.PAITHANI_API_BASE;
})();
