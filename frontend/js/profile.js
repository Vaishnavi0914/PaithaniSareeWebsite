window.__profileLoaded = true;

const resolveProfileApiBase = () => {
  if (typeof window.resolveApiBase === 'function') {
    return window.resolveApiBase();
  }
  const origin = window.location.origin || '';
  if (!origin || origin === 'null' || origin.startsWith('file:')) {
    return 'http://localhost:5000';
  }
  if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
    return 'http://localhost:5000';
  }
  return origin;
};

const PROFILE_API_BASE_URL = resolveProfileApiBase();

const byId = (id) => document.getElementById(id);
const statusClass = (s = 'placed') => s.toLowerCase();
const setText = (id, value) => {
  const el = byId(id);
  if (el) el.textContent = value;
};

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const PASSWORD_RULE_MESSAGE = 'Password must be at least 8 characters and include a letter, a number, and a special character.';
const isStrongPassword = (value) => {
  const pwd = String(value || '');
  return pwd.length >= 8 && /[A-Za-z]/.test(pwd) && /\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
};

const escapeHtml = (value) => String(value || '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const formatMultiline = (value) => escapeHtml(value).replace(/\n/g, '<br>');

const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
};
const readStorageKey = (storageKey, fallback) => {
  const raw = localStorage.getItem(storageKey);
  if (raw === null || typeof raw === 'undefined') return fallback;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return fallback;
  }
};

const writeStorageKey = (storageKey, value) => {
  localStorage.setItem(storageKey, JSON.stringify(value));
};

function buildAuthHeaders(token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function apiFetchJson(path, token, options = {}) {
  const res = await fetch(`${PROFILE_API_BASE_URL}${path}`, {
    ...options,
    headers: buildAuthHeaders(token)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function loadLocalOrders(user) {
  if (!user?.email) return [];
  const normalized = normalizeEmail(user.email);
  const normalizedKey = `profile:${normalized}:orders`;

  let keyToUse = normalizedKey;
  if (!localStorage.getItem(normalizedKey)) {
    const legacyKey = `profile:${user.email}:orders`;
    if (localStorage.getItem(legacyKey)) {
      keyToUse = legacyKey;
    } else {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('profile:') || !key.endsWith(':orders')) continue;
        const keyEmail = key.slice(8, -7);
        if (normalizeEmail(keyEmail) === normalized) {
          keyToUse = key;
          break;
        }
      }
    }
  }

  const list = storage.get(keyToUse, []);
  if (keyToUse !== normalizedKey && Array.isArray(list) && list.length) {
    storage.set(normalizedKey, list);
  }
  return Array.isArray(list) ? list : [];
}

async function loadOrders(token, user) {
  if (!token) return loadLocalOrders(user);
  try {
    const data = await apiFetchJson('/orders', token);
    return Array.isArray(data) && data.length ? data : loadLocalOrders(user);
  } catch (err) {
    console.error('orders fetch error', err);
    if (err?.status === 401) {
      localStorage.removeItem('authToken');
    }
    return loadLocalOrders(user);
  }
}

function renderAddresses(addresses) {
  const list = byId('address-list');
  if (!list) return;
  if (!addresses.length) {
    list.innerHTML = '<p class="profile-note">No saved addresses yet.</p>';
    return;
  }
  list.innerHTML = addresses.map(addr => `
    <div class="address-card">
      <div class="address-title">${addr.label || 'Address'}</div>
      <div class="meta">${addr.line || ''}</div>
      <div class="meta">${[addr.city, addr.state, addr.zip].filter(Boolean).join(', ')}</div>
      <div class="profile-actions">
        <button class="profile-btn outline" type="button" data-edit-address="${addr.id}">Edit</button>
        <button class="profile-btn outline" type="button" data-remove-address="${addr.id}">Remove</button>
      </div>
    </div>
  `).join('');
}

function renderWishlist(items) {
  const list = byId('wishlist-list');
  if (!list) return;
  if (!Array.isArray(items) || !items.length) {
    list.innerHTML = '<p class="profile-note">Your wishlist is empty.</p>';
    return;
  }
  list.innerHTML = items.map((item) => {
    const data = (typeof item === 'string') ? { name: item } : (item || {});
    const rawId = data.id || data._id || data.name || '';
    const safeId = escapeHtml(String(rawId));
    const label = escapeHtml(data.name || 'Wishlist item');
    const priceValue = Number(data.price || data.finalPrice || 0);
    const hasPrice = !Number.isNaN(priceValue) && priceValue > 0;
    const priceText = hasPrice ? `₹${priceValue.toLocaleString('en-IN')}` : 'Saved item';
    const imageSrc = data.image || 'images/logo.png';
    return `
      <div class="wishlist-item" data-wishlist-card>
        <img src="${escapeHtml(imageSrc)}" alt="${label}">
        <div class="wishlist-info">
          <strong>${label}</strong>
          <span>${priceText}</span>
        </div>
        <button class="wishlist-remove" type="button" data-wishlist-id="${safeId}">Remove</button>
      </div>
    `;
  }).join('');
}

function renderSupportReplies(list = []) {
  const listEl = byId('support-replies-list');
  if (!listEl) return;
  if (!list.length) {
    listEl.innerHTML = '<p class="profile-note">No replies yet. We will get back to you soon.</p>';
    return;
  }
  listEl.innerHTML = list.map((msg) => {
    const status = (msg.status || (msg.reply ? 'replied' : 'open')).toLowerCase();
    const timestamp = msg.updatedAt || msg.createdAt || Date.now();
    const replyBlock = msg.reply
      ? `<div class="support-reply-content">${formatMultiline(msg.reply)}</div>`
      : '<div class="support-reply-content profile-note">Awaiting reply from our team.</div>';
    return `
      <div class="support-reply-card">
        <div class="support-reply-header">
          <span class="status-pill status-${escapeHtml(status)}">${escapeHtml(status)}</span>
          <span>${escapeHtml(new Date(timestamp).toLocaleString('en-IN'))}</span>
        </div>
        <div class="support-reply-message">${formatMultiline(msg.message || '')}</div>
        ${replyBlock}
      </div>
    `;
  }).join('');
}

function normalizeAddresses(list) {
  if (!Array.isArray(list)) return [];
  return list.map(addr => ({
    id: addr.id || addr._id || addr.addressId || '',
    label: addr.label || '',
    line: addr.line || '',
    city: addr.city || '',
    state: addr.state || '',
    zip: addr.zip || '',
    country: addr.country || 'India'
  })).filter(addr => addr.id || addr.line || addr.city || addr.state || addr.zip || addr.label);
}

function updateDefaultAddressSelect(addresses, selectedId) {
  const select = byId('default-address');
  if (!select) return;
  if (!addresses.length) {
    select.innerHTML = '<option value="">No saved addresses</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;
  select.innerHTML = addresses.map(addr => {
    const id = addr.id || addr._id || '';
    return `<option value="${id}">${addr.label || 'Address'} - ${addr.city || ''}</option>`;
  }).join('');
  const fallbackId = addresses[0]?.id || addresses[0]?._id || '';
  select.value = selectedId || fallbackId;
}

function safeParseUser(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (err) {
    return null;
  }
}

async function fetchCurrentUser(token) {
  if (!token) return null;
  try {
    const res = await fetch(`${PROFILE_API_BASE_URL}/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    return data?.user || null;
  } catch (err) {
    return null;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const storedUser = safeParseUser(localStorage.getItem('authUser'));
  const token = localStorage.getItem('authToken') || '';
  let user = storedUser;

  if (!token) {
    localStorage.removeItem('authUser');
    window.location.href = 'login.html';
    return;
  }

  const freshUser = await fetchCurrentUser(token);
  if (freshUser && freshUser.email) {
    user = freshUser;
    localStorage.setItem('authUser', JSON.stringify(freshUser));
  }

  if (!user || !user.email) {
    localStorage.removeItem('authUser');
    localStorage.removeItem('authToken');
    window.location.href = 'login.html';
    return;
  }

  const rawEmail = user.email || '';
  const profileEmail = normalizeEmail(rawEmail);
  const key = (suffix) => `profile:${profileEmail}:${suffix}`;
  const legacyKey = (suffix) => `profile:${rawEmail}:${suffix}`;

  const readProfileJson = (suffix, fallback) => {
    const primary = key(suffix);
    if (localStorage.getItem(primary) !== null) {
      return readStorageKey(primary, fallback);
    }
    const legacy = legacyKey(suffix);
    if (legacy !== primary && localStorage.getItem(legacy) !== null) {
      const value = readStorageKey(legacy, fallback);
      writeStorageKey(primary, value);
      return value;
    }
    return fallback;
  };

  const readProfileString = (suffix, fallback = '') => {
    const primary = key(suffix);
    const primaryRaw = localStorage.getItem(primary);
    if (primaryRaw !== null) return primaryRaw;
    const legacy = legacyKey(suffix);
    const legacyRaw = legacy !== primary ? localStorage.getItem(legacy) : null;
    if (legacyRaw !== null) {
      localStorage.setItem(primary, legacyRaw);
      return legacyRaw;
    }
    return fallback;
  };

  const writeProfileJson = (suffix, value) => {
    writeStorageKey(key(suffix), value);
  };

  const writeProfileString = (suffix, value) => {
    localStorage.setItem(key(suffix), value);
  };

  const avatar = byId('profile-avatar');
  const image = byId('profile-image');
  byId('profile-name').textContent = user.name || 'Customer';
  byId('profile-email').textContent = user.email || '';
  byId('profile-phone').textContent = user.phone || '';
  avatar.textContent = (user.name || user.email || 'RP').slice(0, 2).toUpperCase();

  const storedPhoto = readProfileString('photo', '');
  if (storedPhoto) {
    image.src = storedPhoto;
    image.style.display = 'block';
    avatar.style.display = 'none';
  }

  byId('profile-photo-input').addEventListener('change', (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      writeProfileString('photo', reader.result);
      image.src = reader.result;
      image.style.display = 'block';
      avatar.style.display = 'none';
    };
    reader.readAsDataURL(file);
  });

  const cachedAddresses = normalizeAddresses(readProfileJson('addresses', []));
  const userAddresses = normalizeAddresses(user.addresses);
  let addresses = userAddresses.length ? userAddresses : cachedAddresses;
  let defaultAddressId = user.defaultAddressId || readProfileString('defaultAddress', '') || '';
  let editingAddressId = '';

  const addressForm = byId('address-form');
  const addressSubmit = byId('address-submit');
  const addressCancel = byId('address-cancel');

  const setAddressFormMode = (address) => {
    if (address) {
      editingAddressId = address.id;
      byId('address-name').value = address.label || '';
      byId('address-line').value = address.line || '';
      byId('address-city').value = address.city || '';
      byId('address-state').value = address.state || '';
      byId('address-zip').value = address.zip || '';
      if (addressSubmit) addressSubmit.textContent = 'Update Address';
      if (addressCancel) addressCancel.style.display = '';
      return;
    }
    editingAddressId = '';
    addressForm.reset();
    if (addressSubmit) addressSubmit.textContent = 'Save Address';
    if (addressCancel) addressCancel.style.display = 'none';
  };

  renderAddresses(addresses);
  updateDefaultAddressSelect(addresses, defaultAddressId);
  if (!defaultAddressId && addresses[0]?.id) {
    defaultAddressId = addresses[0].id;
    writeProfileString('defaultAddress', defaultAddressId);
    updateDefaultAddressSelect(addresses, defaultAddressId);
  }
  setText('address-count', addresses.length);

  addressForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      label: byId('address-name').value.trim(),
      line: byId('address-line').value.trim(),
      city: byId('address-city').value.trim(),
      state: byId('address-state').value.trim(),
      zip: byId('address-zip').value.trim()
    };
    try {
      if (token) {
        if (editingAddressId) {
          const data = await apiFetchJson('/me/addresses/' + editingAddressId, token, {
            method: 'PUT',
            body: JSON.stringify(payload)
          });
          addresses = normalizeAddresses(data.addresses || addresses);
          defaultAddressId = data.defaultAddressId || defaultAddressId;
        } else {
          const data = await apiFetchJson('/me/addresses', token, {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          addresses = normalizeAddresses(data.addresses || [data.address, ...addresses]);
          defaultAddressId = data.defaultAddressId || defaultAddressId;
        }
        writeProfileJson('addresses', addresses);
      } else {
        const newAddress = { id: String(Date.now()), ...payload };
        if (editingAddressId) {
          addresses = addresses.map(addr => (addr.id === editingAddressId ? newAddress : addr));
        } else {
          addresses = [newAddress, ...addresses];
        }
        writeProfileJson('addresses', addresses);
        if (!defaultAddressId) {
          defaultAddressId = newAddress.id;
          writeProfileString('defaultAddress', defaultAddressId);
        }
      }

      renderAddresses(addresses);
      updateDefaultAddressSelect(addresses, defaultAddressId);
      if (!defaultAddressId && addresses[0]?.id) {
        defaultAddressId = addresses[0].id;
        writeProfileString('defaultAddress', defaultAddressId);
        updateDefaultAddressSelect(addresses, defaultAddressId);
      }
      setText('address-count', addresses.length);
      setAddressFormMode();
    } catch (err) {
      console.error('address save error', err);
      alert('Unable to save address. Please try again.');
    }
  });

  if (addressCancel) {
    addressCancel.addEventListener('click', () => setAddressFormMode());
  }

  byId('address-list').addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit-address]');
    if (editBtn) {
      const editId = editBtn.getAttribute('data-edit-address');
      const address = addresses.find(addr => addr.id === editId);
      if (address) setAddressFormMode(address);
      return;
    }
    const button = event.target.closest('[data-remove-address]');
    if (!button) return;
    const removeId = button.getAttribute('data-remove-address');
    try {
      if (token) {
        const data = await apiFetchJson('/me/addresses/' + removeId, token, { method: 'DELETE' });
        addresses = normalizeAddresses(data.addresses || addresses.filter(addr => addr.id !== removeId));
        defaultAddressId = data.defaultAddressId || '';
        writeProfileJson('addresses', addresses);
      } else {
        addresses = addresses.filter(addr => addr.id !== removeId);
        writeProfileJson('addresses', addresses);
        if (defaultAddressId === removeId) defaultAddressId = addresses[0]?.id || '';
      }
      renderAddresses(addresses);
      updateDefaultAddressSelect(addresses, defaultAddressId);
      if (!defaultAddressId && addresses[0]?.id) {
        defaultAddressId = addresses[0].id;
        writeProfileString('defaultAddress', defaultAddressId);
        updateDefaultAddressSelect(addresses, defaultAddressId);
      }
      setText('address-count', addresses.length);
      if (editingAddressId === removeId) setAddressFormMode();
    } catch (err) {
      console.error('address delete error', err);
      alert('Unable to delete address. Please try again.');
    }
  });
  byId('default-address').addEventListener('change', async (event) => {
    const nextId = event.target.value;
    defaultAddressId = nextId;
    writeProfileString('defaultAddress', nextId);
    if (!token) {
      return;
    }
    try {
      await apiFetchJson('/me/default-address', token, {
        method: 'PATCH',
        body: JSON.stringify({ addressId: nextId })
      });
    } catch (err) {
      console.error('default address save error', err);
    }
  });

  const WISHLIST_STORAGE_KEY = 'paithani_wishlist';

  const loadWishlistItems = () => {
    const primary = readStorageKey(WISHLIST_STORAGE_KEY, []);
    if (Array.isArray(primary) && primary.length) return primary;
    const legacyProfile = readProfileJson('wishlist', []);
    const legacyGlobal = readStorageKey('wishlistItems', []);
    const legacy = (Array.isArray(legacyProfile) && legacyProfile.length)
      ? legacyProfile
      : (Array.isArray(legacyGlobal) ? legacyGlobal : []);
    if (legacy.length) {
      writeStorageKey(WISHLIST_STORAGE_KEY, legacy);
    }
    return legacy;
  };

  const saveWishlistItems = (items) => {
    writeStorageKey(WISHLIST_STORAGE_KEY, items);
    writeProfileJson('wishlist', items);
    writeStorageKey('wishlistItems', items);
    if (typeof window.updateWishlistButtons === 'function') {
      window.updateWishlistButtons();
    }
    if (typeof window.renderWishlistSection === 'function') {
      window.renderWishlistSection();
    }
  };

  let wishlistItems = loadWishlistItems();
  renderWishlist(wishlistItems);
  setText('wishlist-count', wishlistItems.length);

  const wishlistList = byId('wishlist-list');
  if (wishlistList && wishlistList.dataset.bound !== '1') {
    wishlistList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-wishlist-id]');
      if (!button) return;
      const id = button.getAttribute('data-wishlist-id');
      wishlistItems = wishlistItems.filter((item) => {
        const data = (typeof item === 'string') ? { name: item } : (item || {});
        const itemId = String(data.id || data._id || data.name || '');
        if (!id) return true;
        return itemId !== id;
      });
      saveWishlistItems(wishlistItems);
      renderWishlist(wishlistItems);
      setText('wishlist-count', wishlistItems.length);
    });
    wishlistList.dataset.bound = '1';
  }

  const repliesMeta = byId('support-replies-meta');
  const repliesButton = byId('refresh-replies');
  const loadSupportReplies = async () => {
    if (!user?.email || user.email === 'guest@local') {
      if (repliesMeta) repliesMeta.textContent = 'Log in to see support replies.';
      renderSupportReplies([]);
      return;
    }
    if (repliesMeta) repliesMeta.textContent = 'Checking for replies...';
    try {
      const res = await fetch(`${PROFILE_API_BASE_URL}/contacts?email=${encodeURIComponent(user.email)}`);
      const data = await res.json().catch(() => ([]));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to load replies');
      }
      const list = Array.isArray(data) ? data : [];
      renderSupportReplies(list);
      if (typeof window.markUserRepliesSeen === 'function') {
        window.markUserRepliesSeen(user.email, list);
      }
      if (typeof window.refreshUserNotifications === 'function') {
        window.refreshUserNotifications();
      }
      if (repliesMeta) repliesMeta.textContent = `Replies linked to ${user.email}`;
    } catch (err) {
      console.error('support replies error', err);
      if (repliesMeta) repliesMeta.textContent = 'Unable to load replies right now.';
      renderSupportReplies([]);
    }
  };

  if (repliesButton) {
    repliesButton.addEventListener('click', loadSupportReplies);
  }
  loadSupportReplies();

  const prefs = readProfileJson('notifications', {
    orders: true,
    promos: false,
    messages: true
  });
  byId('pref-orders').checked = !!prefs.orders;
  byId('pref-promos').checked = !!prefs.promos;
  byId('pref-messages').checked = !!prefs.messages;

  byId('save-preferences-btn').addEventListener('click', () => {
    const updated = {
      orders: byId('pref-orders').checked,
      promos: byId('pref-promos').checked,
      messages: byId('pref-messages').checked
    };
    writeProfileJson('notifications', updated);
    setText('preferences-note', 'Preferences saved.');
  });

  byId('change-password-btn').addEventListener('click', async () => {
    const current = byId('current-password').value.trim();
    const next = byId('new-password').value.trim();
    const confirm = byId('confirm-password').value.trim();
    const note = byId('password-note');

    if (!current || !next || !confirm) {
      note.textContent = 'Please fill all password fields.';
      return;
    }
    if (next !== confirm) {
      note.textContent = 'New password and confirmation do not match.';
      return;
    }

    if (!isStrongPassword(next)) {
      note.textContent = PASSWORD_RULE_MESSAGE;
      return;
    }

    if (!token) {
      note.textContent = 'Please log in again to update your password.';
      return;
    }

    note.textContent = 'Updating password...';
    try {
      await apiFetchJson('/me/password', token, {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: current,
          newPassword: next,
          confirmPassword: confirm
        })
      });
      writeProfileString('passwordUpdated', new Date().toISOString());
      note.textContent = 'Password updated successfully.';
      byId('current-password').value = '';
      byId('new-password').value = '';
      byId('confirm-password').value = '';
    } catch (err) {
      note.textContent = err?.data?.error || 'Unable to update password.';
    }
  });

  const orders = await loadOrders(token, user);
  const list = byId('orders-list');
  byId('order-count').textContent = `${orders.length} order${orders.length === 1 ? '' : 's'}`;
  setText('order-count-hero', orders.length);

  if (!orders.length) {
    list.innerHTML = '<p class="profile-note">No orders yet.</p>';
  } else {
    list.innerHTML = orders.map(o => {
      const items = (o.items || []).map(i => `<li>${i.qty || 1} × ${i.name || 'Item'}</li>`).join('');
      return `
        <div class="order-card">
          <div class="order-top">
            <div><strong>Order ID:</strong> ${o._id || ''}</div>
            <span class="status ${statusClass(o.status)}">${o.status || 'placed'}</span>
          </div>
          <div class="meta">Placed: ${o.createdAt ? new Date(o.createdAt).toLocaleString() : ''}</div>
          <div class="meta">Total: Rs ${(o.totalAmount || 0).toLocaleString('en-IN')}</div>
          <ul class="order-items">${items}</ul>
        </div>
      `;
    }).join('');
  }

  const lastLoginKey = key('lastLogin');
  let lastLogin = readProfileString('lastLogin', '');
  if (!lastLogin) {
    lastLogin = new Date().toISOString();
    writeProfileString('lastLogin', lastLogin);
  }
  byId('last-login').textContent = new Date(lastLogin).toLocaleString();

  byId('profile-logout').addEventListener('click', () => {
    localStorage.removeItem('authUser');
    localStorage.removeItem('authToken');
    window.location.href = 'login.html';
  });
  window.__profileInitDone = true;
});

















