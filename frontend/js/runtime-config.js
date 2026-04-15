// Runtime config for deployment.
// Set API_BASE to your backend URL (no trailing slash) before deploying.
// Example: const API_BASE = 'https://api.example.com';
(function () {
  if (typeof window === 'undefined') return;
  const API_BASE = 'https://api.rudrapaithaniyeola.online';
  if (!API_BASE) return;
  if (!window.PAITHANI_API_BASE) {
    window.PAITHANI_API_BASE = API_BASE;
  }
  if (!window.ADMIN_API_BASE_OVERRIDE) {
    window.ADMIN_API_BASE_OVERRIDE = window.PAITHANI_API_BASE;
  }
})();

