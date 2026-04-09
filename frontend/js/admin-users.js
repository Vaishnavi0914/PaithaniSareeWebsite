(() => {
﻿const API_BASE = window.ADMIN_API_BASE || (typeof resolveAdminApiBase === 'function' ? resolveAdminApiBase() : (window.location.origin.includes('localhost') ? 'http://localhost:5000' : window.location.origin));
const root = document.getElementById('users-root');
const ensureAuth = (typeof ensureAdminAuth === 'function')
  ? ensureAdminAuth
  : (typeof window !== 'undefined' ? window.ensureAdminAuth : null);
const fetchJson = (typeof adminFetchJson === 'function')
  ? adminFetchJson
  : (typeof window !== 'undefined' ? window.adminFetchJson : null);

if (ensureAuth) ensureAuth();
const searchInput = document.getElementById('user-search');
const statusFilter = document.getElementById('user-status-filter');
const refreshBtn = document.getElementById('user-refresh');

let users = [];

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-IN');
}

function getFilteredUsers() {
  const term = (searchInput?.value || '').toLowerCase().trim();
  const status = statusFilter?.value || '';
  return users.filter(user => {
    const haystack = [user.name, user.email, user.phone].filter(Boolean).join(' ').toLowerCase();
    const matchesTerm = term ? haystack.includes(term) : true;
    const isBlocked = Boolean(user.isBlocked);
    const matchesStatus = status === ''
      ? true
      : (status === 'blocked' ? isBlocked : !isBlocked);
    return matchesTerm && matchesStatus;
  });
}

function renderUsers(list) {
  if (!root) return;
  if (!list.length) {
    root.innerHTML = '<p class="muted">No users match your filters.</p>';
    return;
  }

  root.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Phone</th>
          <th>Status</th>
          <th>Joined</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(user => {
          const isBlocked = Boolean(user.isBlocked);
          return `
            <tr>
              <td>${user.name || '-'}</td>
              <td>${user.email || '-'}</td>
              <td>${user.phone || '-'}</td>
              <td><span class="status-pill ${isBlocked ? 'status-blocked' : 'status-active'}">${isBlocked ? 'blocked' : 'active'}</span></td>
              <td>${formatDate(user.createdAt)}</td>
              <td>
                <div class="admin-table-actions">
                  <button class="admin-inline-btn ${isBlocked ? 'secondary' : 'danger'}" data-action="toggle" data-id="${user._id}" data-blocked="${isBlocked}">
                    ${isBlocked ? 'Unblock' : 'Block'}
                  </button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function loadUsers() {
  if (!root) return;
  if (!fetchJson) {
    root.innerHTML = '<p class="muted">Admin tools failed to load. Please refresh.</p>';
    return;
  }
  try {
    const data = await fetchJson(`${API_BASE}/admin/users`);
    users = Array.isArray(data) ? data : [];
    renderUsers(getFilteredUsers());
  } catch (err) {
    console.error('users fetch error', err);
    root.innerHTML = '<p class="muted">Unable to load users right now.</p>';
  }
}

async function toggleUserBlock(userId, isBlocked) {
  try {
    const updated = await fetchJson(`${API_BASE}/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isBlocked })
    });
    users = users.map(user => user._id === userId ? updated : user);
    renderUsers(getFilteredUsers());
  } catch (err) {
    console.error('user update error', err);
    alert('Unable to update user status.');
  }
}

function bindFilters() {
  searchInput?.addEventListener('input', () => renderUsers(getFilteredUsers()));
  statusFilter?.addEventListener('change', () => renderUsers(getFilteredUsers()));
  refreshBtn?.addEventListener('click', loadUsers);
}

if (root) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="toggle"]');
    if (!button) return;
    const userId = button.dataset.id;
    const currentlyBlocked = button.dataset.blocked === 'true';
    const nextBlocked = !currentlyBlocked;
    const label = nextBlocked ? 'Block this user?' : 'Unblock this user?';
    if (!confirm(label)) return;
    toggleUserBlock(userId, nextBlocked);
  });
}

const initUsers = () => {
  bindFilters();
  loadUsers();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initUsers);
} else {
  initUsers();
}
})();
