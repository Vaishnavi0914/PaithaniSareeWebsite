(() => {
  if (!window.location.pathname.includes('dashboard.html')) return;

  const resolveBase = typeof resolveApiBase === 'function'
    ? resolveApiBase
    : () => (window.location.origin.includes('localhost') ? 'http://localhost:5000' : window.location.origin);
  const API_BASE_URL = resolveBase();
  const token = localStorage.getItem('authToken') || '';

  const bySelector = (sel) => document.querySelector(sel);
  const setText = (selector, value) => {
    document.querySelectorAll(selector).forEach((el) => {
      el.textContent = value;
    });
  };

  const buildHeaders = () => {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  };

  const fetchJson = async (path, options = {}) => {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: buildHeaders()
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data?.error || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  };

  const formatAddress = (user) => {
    const list = Array.isArray(user.addresses) ? user.addresses : [];
    const primary = list.find(addr => addr.id === user.defaultAddressId) || list[0];
    if (!primary) return '';
    const line = primary.line || '';
    const cityLine = [primary.city, primary.state, primary.zip].filter(Boolean).join(', ');
    return [line, cityLine].filter(Boolean).join('\n');
  };

  let cachedOrders = [];

  const updateDashboard = (user, orders = []) => {
    const name = user.name || 'Customer';
    const email = user.email || '';
    const phone = user.phone || '';
    const initials = (name || email || 'RP').trim().slice(0, 2).toUpperCase();
    const addressText = formatAddress(user);
    const cityLabel = addressText ? addressText.split('\n').slice(-1)[0] : 'Not set';

    setText('[data-user-name]', name);
    setText('[data-user-email]', email || 'Not set');
    setText('[data-user-phone]', phone || 'Not set');
    setText('[data-user-address]', addressText || 'Not set');
    setText('[data-user-initials]', initials);
    setText('[data-address-city]', cityLabel || 'Not set');

    const currentOrders = orders.filter(o => !['delivered', 'cancelled'].includes(String(o.status || 'placed').toLowerCase()));
    const previousOrders = orders.filter(o => ['delivered', 'cancelled'].includes(String(o.status || 'placed').toLowerCase()));

    setText('[data-current-count]', currentOrders.length);
    setText('[data-previous-count]', previousOrders.length);

    const currentBtn = bySelector('#current-orders-btn');
    const previousBtn = bySelector('#previous-orders-btn');
    if (currentBtn) {
      currentBtn.disabled = !currentOrders.length;
      currentBtn.onclick = () => { window.location.href = 'profile.html#orders-section'; };
    }
    if (previousBtn) {
      previousBtn.disabled = !previousOrders.length;
      previousBtn.onclick = () => { window.location.href = 'profile.html#orders-section'; };
    }

    const profileName = bySelector('#profile-name');
    const profileEmail = bySelector('#profile-email');
    const profilePhone = bySelector('#profile-phone');
    const profileAddress = bySelector('#profile-address');
    if (profileName) profileName.value = name || '';
    if (profileEmail) profileEmail.value = email || '';
    if (profilePhone) profilePhone.value = phone || '';
    if (profileAddress) profileAddress.value = addressText || '';
  };

  const bindProfileForm = () => {
    const form = bySelector('#profile-form');
    if (!form) return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = bySelector('#profile-name')?.value?.trim() || '';
      const phone = bySelector('#profile-phone')?.value?.trim() || '';
      const note = bySelector('#profile-save-note');
      if (note) note.textContent = 'Saving to your account...';
      try {
        const data = await fetchJson('/me', {
          method: 'PATCH',
          body: JSON.stringify({ name, phone })
        });
        const updated = data.user || data;
        localStorage.setItem('authUser', JSON.stringify(updated));
        updateDashboard(updated, cachedOrders);
        if (note) note.textContent = 'Saved to your account.';
      } catch (err) {
        if (note) note.textContent = err?.data?.error || 'Unable to save details.';
      }
    });
  };

  const init = async () => {
    if (!token) {
      window.location.href = 'login.html';
      return;
    }
    try {
      const profile = await fetchJson('/me');
      const user = profile.user || profile;
      localStorage.setItem('authUser', JSON.stringify(user));
      bindProfileForm();
      let orders = [];
      try {
        orders = await fetchJson('/orders');
      } catch (err) {
        orders = [];
      }
      cachedOrders = orders;
      updateDashboard(user, cachedOrders);
    } catch (err) {
      localStorage.removeItem('authToken');
      window.location.href = 'login.html';
    }
  };

  document.addEventListener('DOMContentLoaded', init);
})();
