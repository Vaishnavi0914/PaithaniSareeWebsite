(() => {
﻿const API_BASE = window.ADMIN_API_BASE || (typeof resolveAdminApiBase === 'function' ? resolveAdminApiBase() : (window.location.origin.includes('localhost') ? 'http://localhost:5000' : window.location.origin));
const root = document.getElementById('orders-root');
const ensureAuth = (typeof ensureAdminAuth === 'function')
  ? ensureAdminAuth
  : (typeof window !== 'undefined' ? window.ensureAdminAuth : null);
const fetchJson = (typeof adminFetchJson === 'function')
  ? adminFetchJson
  : (typeof window !== 'undefined' ? window.adminFetchJson : null);

if (ensureAuth) ensureAuth();
const searchInput = document.getElementById('order-search');
const statusFilter = document.getElementById('order-status-filter');
const refreshBtn = document.getElementById('order-refresh');

const STATUS_OPTIONS = ['placed', 'processing', 'shipped', 'delivered', 'cancelled'];

let orders = [];

function normalizeOrderStatus(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (STATUS_OPTIONS.includes(raw)) return raw;
  if (raw === 'paid' || raw === 'pending_payment') return 'placed';
  return 'placed';
}

function recordAdminActivity(action) {
  if (typeof logAdminActivity === 'function') {
    logAdminActivity(action);
  }
}

function formatPrice(value) {
  const amount = Number(value) || 0;
  return `Rs ${amount.toLocaleString('en-IN')}`;
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-IN');
}

function buildStatusSelect(order) {
  const current = normalizeOrderStatus(order.status);
  return `
    <select class="admin-select" id="order-status-${order._id}">
      ${STATUS_OPTIONS.map(status => `
        <option value="${status}" ${status === current ? 'selected' : ''}>${status}</option>
      `).join('')}
    </select>
  `;
}

function getFilteredOrders() {
  const term = (searchInput?.value || '').toLowerCase().trim();
  const status = statusFilter?.value || '';
  return orders.filter(order => {
    const customer = order.customer || {};
    const haystack = [order._id, customer.name, customer.email, customer.phone]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesTerm = term ? haystack.includes(term) : true;
    const matchesStatus = status ? (order.status || 'placed') === status : true;
    return matchesTerm && matchesStatus;
  });
}

function renderOrders(list) {
  if (!root) return;
  if (!list.length) {
    root.innerHTML = '<p class="muted">No orders match your filters.</p>';
    return;
  }

  root.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Order ID</th>
          <th>Customer</th>
          <th>Items</th>
          <th>Total</th>
          <th>Status</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(order => {
          const customer = order.customer || {};
          const customerLine = [customer.name, customer.phone, customer.email].filter(Boolean).join(' · ');
          const itemCount = Array.isArray(order.items)
            ? order.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
            : 0;
          const status = normalizeOrderStatus(order.status);
          return `
            <tr>
              <td>${order._id || '-'}</td>
              <td>${customerLine || '-'}</td>
              <td>${itemCount}</td>
              <td>${formatPrice(order.totalAmount)}</td>
              <td><span class="status-pill status-${status}">${status}</span></td>
              <td>${formatDate(order.createdAt)}</td>
              <td>
                <div class="admin-table-actions">
                  ${buildStatusSelect(order)}
                  <button class="admin-inline-btn" data-action="update-status" data-id="${order._id}">Update</button>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function loadOrders() {
  if (!root) return;
  if (!fetchJson) {
    root.innerHTML = '<p class="muted">Admin tools failed to load. Please refresh.</p>';
    return;
  }
  try {
    const data = await fetchJson(`${API_BASE}/admin/orders`);
    orders = Array.isArray(data) ? data : [];
    renderOrders(getFilteredOrders());
  } catch (err) {
    console.error('orders fetch error', err);
    root.innerHTML = '<p class="muted">Unable to load orders right now.</p>';
  }
}

async function updateOrderStatus(orderId, status) {
  try {
    const updated = await fetchJson(`${API_BASE}/admin/orders/${orderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    orders = orders.map(order => order._id === orderId ? updated : order);
    renderOrders(getFilteredOrders());
    recordAdminActivity(`Updated order ${orderId} to ${status}`);
  } catch (err) {
    console.error('order status update error', err);
    alert('Unable to update order status.');
  }
}

function bindFilters() {
  searchInput?.addEventListener('input', () => renderOrders(getFilteredOrders()));
  statusFilter?.addEventListener('change', () => renderOrders(getFilteredOrders()));
  refreshBtn?.addEventListener('click', async () => {
    await loadOrders();
    recordAdminActivity('Refreshed orders list');
  });
}

if (root) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="update-status"]');
    if (!button) return;
    const orderId = button.dataset.id;
    if (!orderId) return;
    const select = document.getElementById(`order-status-${orderId}`);
    const status = select?.value || 'placed';
    updateOrderStatus(orderId, status);
  });
}

const initOrders = () => {
  bindFilters();
  loadOrders();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOrders);
} else {
  initOrders();
}
})();
