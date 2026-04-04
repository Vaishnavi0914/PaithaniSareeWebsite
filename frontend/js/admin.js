function logAdminActivity(action) {
  try {
    const raw = localStorage.getItem('admin_activity_log');
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? list : [];
    next.unshift({ action, at: new Date().toISOString() });
    localStorage.setItem('admin_activity_log', JSON.stringify(next.slice(0, 50)));
  } catch (err) {
    console.warn('activity log error', err);
  }
}

function resolveAdminApiBaseFallback() {
  const origin = window.location.origin || '';
  const host = window.location.hostname || '';
  const localProtocol = 'http';

  const isPrivateIp = (value) => {
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
    const [a, b] = value.split('.').map(n => Number(n));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 192 && b === 168) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    return false;
  };

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
    return `${window.location.protocol}//${host}:5000`;
  }
  return origin;
}

const API_BASE = window.ADMIN_API_BASE || (typeof resolveAdminApiBase === 'function'
  ? resolveAdminApiBase()
  : resolveAdminApiBaseFallback());
const PASSWORD_RULE_MESSAGE = 'Password must be at least 8 characters and include a letter, a number, and a special character.';

function isStrongPassword(value) {
  const pwd = String(value || '');
  return pwd.length >= 8 && /[A-Za-z]/.test(pwd) && /\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
}

function initAdminLoginForm() {
  const form = document.getElementById('admin-login-form');
  if (!form || form.dataset.bound === '1') return;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    adminLogin();
  });
  form.dataset.bound = '1';
}

function setAdminLoginMessage(message, type = 'error') {
  const el = document.getElementById('admin-login-message');
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('success');
  if (message) {
    el.classList.add(type === 'success' ? 'success' : 'error');
  } else {
    el.classList.remove('error');
  }
}

function setAdminForgotMessage(message, type = 'error', isHtml = false) {
  const el = document.getElementById('admin-forgot-message');
  if (!el) return;
  if (isHtml) {
    el.innerHTML = message || '';
  } else {
    el.textContent = message || '';
  }
  el.classList.remove('success');
  if (message) {
    el.classList.add(type === 'success' ? 'success' : 'error');
  } else {
    el.classList.remove('error');
  }
}

function setAdminResetMessage(message, type = 'error') {
  const el = document.getElementById('admin-reset-message');
  if (!el) return;
  el.textContent = message || '';
  el.classList.remove('success');
  if (message) {
    el.classList.add(type === 'success' ? 'success' : 'error');
  } else {
    el.classList.remove('error');
  }
}

async function adminLogin() {
  const username = document.getElementById("admin-username").value?.trim() || '';
  const password = document.getElementById("admin-password").value || '';

  if (!username || !password) {
    setAdminLoginMessage('Please enter admin username and password.');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAdminLoginMessage(data.error || 'Invalid credentials');
      return;
    }
    if (data.token) {
      setAdminToken(data.token);
    }
    sessionStorage.setItem('adminSession', '1');
    logAdminActivity('Admin login');
    if (typeof showToast === 'function') {
      showToast('Admin login successful!', 'success', { confetti: true, icon: '✓' });
    }
    setAdminLoginMessage('Login successful. Redirecting…', 'success');
    window.location.href = "admin-dashboard.html";
  } catch (err) {
    console.error('admin login error', err);
    setAdminLoginMessage('Unable to reach server. Please try again.');
  }
}

function initAdminForgotForm() {
  const form = document.getElementById('admin-forgot-form');
  if (!form || form.dataset.bound === '1') return;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('admin-forgot-email')?.value?.trim().toLowerCase() || '';
    const username = document.getElementById('admin-forgot-username')?.value?.trim() || '';
    if (!email) {
      setAdminForgotMessage('Please enter the admin email.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/admin/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdminForgotMessage(data.error || 'Unable to send reset link.');
        return;
      }
      if (data.resetUrl) {
        const safeUrl = String(data.resetUrl || '').replace(/"/g, '&quot;');
        setAdminForgotMessage(
          `Reset link generated. <a href="${safeUrl}">Open reset page</a>`,
          'success',
          true
        );
      } else {
        setAdminForgotMessage(data.message || 'If the admin account is configured, a reset link has been sent.', 'success');
      }
    } catch (err) {
      console.error('admin forgot error', err);
      setAdminForgotMessage('Unable to reach server. Please try again.');
    }
  });
  form.dataset.bound = '1';
}

function initAdminResetForm() {
  const form = document.getElementById('admin-reset-form');
  if (!form || form.dataset.bound === '1') return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';
  if (!token) {
    setAdminResetMessage('Reset link is invalid or missing.');
    form.querySelectorAll('input').forEach(input => input.setAttribute('disabled', 'disabled'));
    form.querySelector('button')?.setAttribute('disabled', 'disabled');
  }
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('admin-reset-password')?.value || '';
    const confirmPassword = document.getElementById('admin-reset-confirm')?.value || '';
    if (!password || !confirmPassword) {
      setAdminResetMessage('Please enter and confirm the new password.');
      return;
    }
    if (password !== confirmPassword) {
      setAdminResetMessage('Passwords do not match.');
      return;
    }
    if (!isStrongPassword(password)) {
      setAdminResetMessage(PASSWORD_RULE_MESSAGE);
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/admin/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password, confirmPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAdminResetMessage(data.error || 'Unable to reset password.');
        return;
      }
      setAdminResetMessage('Password updated. Redirecting to admin login...', 'success');
      setTimeout(() => { window.location.href = 'admin-login.html'; }, 1000);
    } catch (err) {
      console.error('admin reset error', err);
      setAdminResetMessage('Unable to reach server. Please try again.');
    }
  });
  form.dataset.bound = '1';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    initAdminLoginForm();
    initAdminForgotForm();
    initAdminResetForm();
  });
} else {
  initAdminLoginForm();
  initAdminForgotForm();
  initAdminResetForm();
}
