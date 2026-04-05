// Central API base configuration for production deployments.
// Set this once to your backend URL (no trailing slash).
(function () {
  if (typeof window === 'undefined') return;
  const existing = (window.PAITHANI_API_BASE || '').trim();
  if (existing) return;

  const host = (window.location && window.location.hostname) ? window.location.hostname.toLowerCase() : '';
  const protocol = (window.location && window.location.protocol) ? window.location.protocol : '';
  const isLocal = protocol === 'file:' || host === 'localhost' || host === '127.0.0.1';

  // TODO: Replace with your deployed backend URL for production.
  // Example: 'https://api.yourdomain.com'
  const apiBase = isLocal ? 'http://localhost:5000' : 'https://rudrapaithaniyeola.onrender.com';
  if (!/^https?:\/\//i.test(apiBase)) return;
  window.PAITHANI_API_BASE = apiBase.replace(/\/+$/, '');
  window.ADMIN_API_BASE_OVERRIDE = window.PAITHANI_API_BASE;
})();
