const DEFAULT_ADMIN_API_BASE = 'https://rudrapaithaniyeola.onrender.com';

function resolveAdminApiBaseSafe() {
  if (window.ADMIN_API_BASE) return window.ADMIN_API_BASE;
  if (typeof resolveAdminApiBase === 'function') return resolveAdminApiBase();
  const origin = window.location.origin || '';
  const host = window.location.hostname || '';
  if (!origin || origin === 'null' || origin.startsWith('file:')) return 'http://localhost:5000';
  if (host === 'localhost' || host === '127.0.0.1') return 'http://localhost:5000';
  return DEFAULT_ADMIN_API_BASE;
}

const API_BASE = resolveAdminApiBaseSafe();
ensureAdminAuth();

let products = [];
let ordersCache = [];
let usersCache = [];
let messagesCache = [];

const byId = (id) => document.getElementById(id);

const ACTIVITY_KEY = 'admin_activity_log';
const SETTINGS_KEY = 'admin_settings';
const PRODUCTS_CACHE_KEY = 'store_products_cache';
const ORDER_STATUS_OPTIONS = ['placed', 'processing', 'shipped', 'delivered', 'cancelled'];
const PASSWORD_RULE_MESSAGE = 'Password must be at least 8 characters and include a letter, a number, and a special character.';

function isStrongPassword(value) {
  const pwd = String(value || '');
  return pwd.length >= 8 && /[A-Za-z]/.test(pwd) && /\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
}

function formatCurrency(value) {
  const amount = Number(value) || 0;
  return `Rs ${amount.toLocaleString('en-IN')}`;
}

function cacheProducts(list) {
  try {
    localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch (err) {
    console.warn('product cache error', err);
  }
}

function applyDiscount(basePrice, type, value) {
  const base = Number(basePrice) || 0;
  const amount = Number(value) || 0;
  if (type === 'percent') {
    return Math.max(0, Math.round(base - (base * amount / 100)));
  }
  if (type === 'flat') {
    return Math.max(0, Math.round(base - amount));
  }
  return base;
}

function getDiscountSummary(type, value) {
  const amount = Number(value) || 0;
  if (type === 'percent' && amount > 0) return `${amount}% off`;
  if (type === 'flat' && amount > 0) return `Rs ${amount} off`;
  return '';
}

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-IN');
}

function normalizeOrderStatus(value) {
  const raw = String(value || '').toLowerCase().trim();
  if (ORDER_STATUS_OPTIONS.includes(raw)) return raw;
  if (raw === 'paid' || raw === 'pending_payment') return 'placed';
  return 'placed';
}

function logAdminActivity(action) {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(list) ? list : [];
    next.unshift({ action, at: new Date().toISOString() });
    localStorage.setItem(ACTIVITY_KEY, JSON.stringify(next.slice(0, 50)));
  } catch (err) {
    console.warn('activity log error', err);
  }
}

function renderActivityLog() {
  const root = byId('admin-activity-log');
  if (!root) return;
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list) || list.length === 0) {
      root.innerHTML = '<li><span>No activity yet</span><span>-</span></li>';
      return;
    }
    root.innerHTML = list.slice(0, 6).map(item => `
      <li><span>${item.action || 'Update'}</span><span>${formatDate(item.at)}</span></li>
    `).join('');
  } catch (err) {
    console.warn('activity log render error', err);
    root.innerHTML = '<li><span>No activity yet</span><span>-</span></li>';
  }
}

function showModal(id) {
  const el = byId(id);
  if (el) el.style.display = 'flex';
}

function hideModal(id) {
  const el = byId(id);
  if (el) el.style.display = 'none';
}

function getStockStatus(product) {
  const stock = Number(product?.stock);
  const threshold = Number(product?.lowStockThreshold) || 0;
  if (!Number.isFinite(stock)) return { label: 'Unknown', className: 'stock-unknown' };
  if (stock <= 0) return { label: 'Out of stock', className: 'stock-out' };
  if (stock <= threshold) return { label: 'Low stock', className: 'stock-low' };
  return { label: 'In stock', className: 'stock-in' };
}

function isPureSilkCategory(category) {
  return String(category || '').toLowerCase().includes('pure silk');
}

function setStatusOptions(selectEl, category, currentValue = '') {
  if (!selectEl) return;
  const isPureSilk = isPureSilkCategory(category);
  const options = isPureSilk
    ? [
        { value: 'preorder', label: 'Preorder' },
        { value: 'new', label: 'New Arrival' },
        { value: 'soldout', label: 'Sold Out' }
      ]
    : [
        { value: 'available', label: 'Available' },
        { value: 'new', label: 'New Arrival' },
        { value: 'soldout', label: 'Sold Out' }
      ];

  const desired = currentValue || selectEl.value || '';
  selectEl.innerHTML = options.map(opt => `<option value="${opt.value}">${opt.label}</option>`).join('');
  selectEl.value = options.some(opt => opt.value === desired) ? desired : options[0].value;
}

function toggleFamilyGroupFields(category, selectEl, value = "") {
  if (!selectEl) return;
  const isFamily = String(category || "").trim() === "Family";
  selectEl.disabled = !isFamily;
  if (!isFamily) {
    selectEl.value = "";
    return;
  }
  if (value) {
    selectEl.value = value;
  }
}


function renderProductList() {
  const root = byId('admin-data-root');
  if (!root) return;
  if (!products.length) {
    root.innerHTML = '<p class="muted">No products yet.</p>';
    return;
  }
  root.innerHTML = `
    <h3>Existing Products</h3>
    <table class="admin-table">
      <thead><tr><th>Name</th><th>Category</th><th>Status</th><th>Inventory</th><th>Price</th></tr></thead>
      <tbody>
        ${products.map(p => {
          const status = getStockStatus(p);
          const stockValue = Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0;
          const threshold = Number.isFinite(Number(p.lowStockThreshold)) ? Number(p.lowStockThreshold) : 0;
            const sku = p.sku ? `<div class="muted">SKU: ${p.sku}</div>` : '';
            const featuredBadge = p.featured ? `<span class="status-pill status-new" style="margin-left:6px;">Featured</span>` : '';
          const originalPrice = Number(p.price) || 0;
          const discountType = p.discountType || 'none';
          const discountValue = Number(p.discountValue) || 0;
          const finalPrice = applyDiscount(originalPrice, discountType, discountValue);
          const discountLabel = getDiscountSummary(discountType, discountValue);
          const priceHtml = discountLabel && finalPrice < originalPrice
            ? `<div><span class="price-strike">${formatCurrency(originalPrice)}</span> <span class="price-final">${formatCurrency(finalPrice)}</span></div><div class="muted">${discountLabel}</div>`
            : `${formatCurrency(originalPrice)}`;
          return `
            <tr>
                <td>${p.name}${featuredBadge}${sku}</td>
              <td>${p.category || ''}</td>
              <td>${p.status || 'available'}</td>
              <td>
                <span class="stock-pill ${status.className}">${status.label}</span>
                <div class="muted">Qty: ${stockValue} | Low: ${threshold}</div>
              </td>
              <td>${priceHtml}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

function populateSelects() {
  const opts = ['productSelect', 'deleteProductSelect'].map(byId).filter(Boolean);
  opts.forEach(sel => {
    sel.innerHTML = '<option value="">Choose a product...</option>' +
      products.map(p => `<option value="${p._id}">${p.name}</option>`).join('');
  });
}

async function fetchJson(url, options = {}) {
  return adminFetchJson(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
}

async function loadProducts() {
    try {
      products = await fetchJson(`${API_BASE}/products`).catch(() => []);
      cacheProducts(products);
      renderProductList();
      populateSelects();
      renderLowStockList();
      renderOverviewSummary();
      return products;
  } catch (err) {
    console.error('load products error', err);
    return [];
  }
}

function renderTopProducts() {
  const listEl = byId('top-products-list');
  if (!listEl) return;
  if (!ordersCache.length) {
    listEl.innerHTML = '<li><span>No sales yet</span><span>-</span></li>';
    return;
  }
  const map = new Map();
  ordersCache.forEach(order => {
    (order.items || []).forEach(item => {
      const key = item.name || item.id || 'Product';
      const qty = Number(item.qty) || 0;
      map.set(key, (map.get(key) || 0) + qty);
    });
  });
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!sorted.length) {
    listEl.innerHTML = '<li><span>No sales yet</span><span>-</span></li>';
    return;
  }
  listEl.innerHTML = sorted.map(([name, qty]) => `
    <li><span>${name}</span><span>${qty} sold</span></li>
  `).join('');

  const topProduct = sorted[0] ? sorted[0][0] : '-';
  const topEl = byId('kpi-top-product');
  if (topEl) topEl.textContent = topProduct || '-';
}

function renderLowStockList() {
  const listEl = byId('low-stock-list');
  if (!listEl) return;
  const lowStock = (products || []).filter(p => {
    const status = getStockStatus(p);
    return status.className === 'stock-low' || status.className === 'stock-out';
  }).slice(0, 5);
  if (!lowStock.length) {
    listEl.innerHTML = '<li><span>No low stock items</span><span>-</span></li>';
    return;
  }
  listEl.innerHTML = lowStock.map(p => {
    const stockValue = Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0;
    return `<li><span>${p.name}</span><span>${stockValue} left</span></li>`;
  }).join('');
}

function renderRecentOrders() {
  const root = byId('recent-orders-root');
  if (!root) return;
  if (!ordersCache.length) {
    root.innerHTML = '<p class="muted">No orders yet.</p>';
    return;
  }
  const latest = [...ordersCache]
    .sort((a, b) => {
      const aTime = new Date(a.createdAt || a.updatedAt || 0).getTime();
      const bTime = new Date(b.createdAt || b.updatedAt || 0).getTime();
      return bTime - aTime;
    })
    .slice(0, 5);
  root.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table admin-table-compact">
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Total</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${latest.map(order => {
            const customer = order.customer || {};
            const status = normalizeOrderStatus(order.status);
            return `
              <tr>
                <td>${order._id || '-'}</td>
                <td>${customer.name || '-'}</td>
                <td>${formatCurrency(order.totalAmount)}</td>
                <td><span class="status-pill status-${status}">${status}</span></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderOverviewSummary() {
  const ordersCount = ordersCache.length;
  const usersCount = usersCache.length;
  const revenue = ordersCache.reduce((sum, order) => sum + (Number(order.totalAmount) || 0), 0);
  const aov = ordersCount ? revenue / ordersCount : 0;

  const ordersEl = byId('kpi-orders');
  const usersEl = byId('kpi-users');
  const revenueEl = byId('kpi-revenue');
  const aovEl = byId('kpi-aov');

  if (ordersEl) ordersEl.textContent = ordersCount.toString();
  if (usersEl) usersEl.textContent = usersCount.toString();
  if (revenueEl) revenueEl.textContent = formatCurrency(revenue);
  if (aovEl) aovEl.textContent = formatCurrency(aov);

  const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const orders30 = ordersCache.filter(order => new Date(order.createdAt).getTime() >= cutoff).length;
  const users30 = usersCache.filter(user => new Date(user.createdAt).getTime() >= cutoff).length;

  const orders30El = byId('kpi-orders-30');
  const users30El = byId('kpi-users-30');
  if (orders30El) orders30El.textContent = orders30.toString();
  if (users30El) users30El.textContent = users30.toString();

  const ordersSummary = byId('orders-summary');
  if (ordersSummary) {
    ordersSummary.textContent = ordersCount ? `${ordersCount} total orders in system.` : 'No orders yet.';
  }
  const usersSummary = byId('users-summary');
  if (usersSummary) {
    usersSummary.textContent = usersCount ? `${usersCount} total users registered.` : 'No users yet.';
  }
  const messagesSummary = byId('messages-summary');
  if (messagesSummary) {
    const openCount = messagesCache.filter(msg => (msg.status || 'open') === 'open').length;
    messagesSummary.textContent = openCount ? `${openCount} messages awaiting reply.` : 'No pending messages.';
  }
}

async function loadOverview() {
  try {
    ordersCache = await fetchJson(`${API_BASE}/admin/orders`).catch(() => []);
  } catch (err) {
    console.error('overview orders error', err);
    ordersCache = [];
  }
  try {
    usersCache = await fetchJson(`${API_BASE}/admin/users`).catch(() => []);
  } catch (err) {
    console.error('overview users error', err);
    usersCache = [];
  }
  try {
    messagesCache = await fetchJson(`${API_BASE}/admin/contacts`).catch(() => []);
  } catch (err) {
    console.error('overview messages error', err);
    messagesCache = [];
  }
  renderOverviewSummary();
  renderRecentOrders();
  renderTopProducts();
}

function bindSettings() {
  const form = byId('admin-settings-form');
  if (!form) return;
  const fields = {
    adminName: byId('setting-admin-name'),
    adminEmail: byId('setting-admin-email'),
    storeEmail: byId('setting-store-email'),
    storePhone: byId('setting-store-phone'),
    lowStock: byId('setting-low-stock'),
    homeBanner: byId('setting-home-banner'),
    saleActive: byId('setting-sale-active'),
    saleLabel: byId('setting-sale-label'),
    saleType: byId('setting-sale-type'),
    saleValue: byId('setting-sale-value')
  };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    if (fields.adminName) fields.adminName.value = saved.adminName || '';
    if (fields.adminEmail) fields.adminEmail.value = saved.adminEmail || '';
    if (fields.storeEmail) fields.storeEmail.value = saved.storeEmail || '';
    if (fields.storePhone) fields.storePhone.value = saved.storePhone || '';
    if (fields.lowStock) fields.lowStock.value = saved.lowStock ?? 2;
    if (fields.homeBanner) fields.homeBanner.value = saved.homeBanner || '';
    if (fields.saleActive) fields.saleActive.checked = !!saved.saleActive;
    if (fields.saleLabel) fields.saleLabel.value = saved.saleLabel || '';
    if (fields.saleType) fields.saleType.value = saved.saleType || 'none';
    if (fields.saleValue) fields.saleValue.value = saved.saleValue ?? 0;
  } catch (err) {
    console.warn('settings load error', err);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const payload = {
      adminName: fields.adminName?.value?.trim() || '',
      adminEmail: fields.adminEmail?.value?.trim() || '',
      storeEmail: fields.storeEmail?.value?.trim() || '',
      storePhone: fields.storePhone?.value?.trim() || '',
      lowStock: Number(fields.lowStock?.value) || 0,
      homeBanner: fields.homeBanner?.value?.trim() || '',
      saleActive: !!fields.saleActive?.checked,
      saleLabel: fields.saleLabel?.value?.trim() || '',
      saleType: fields.saleType?.value || 'none',
      saleValue: Number(fields.saleValue?.value) || 0
    };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(payload));
      const status = byId('settings-status');
      if (status) status.textContent = 'Settings saved.';
      logAdminActivity('Updated admin settings');
      renderActivityLog();
    } catch (err) {
      console.warn('settings save error', err);
      const status = byId('settings-status');
      if (status) status.textContent = 'Unable to save settings.';
    }
  });
}

function bindAdminPasswordChange() {
  const form = byId('admin-password-form');
  if (!form) return;
  const status = byId('admin-password-status');
  const currentInput = byId('admin-current-password');
  const newInput = byId('admin-new-password');
  const confirmInput = byId('admin-confirm-password');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (status) status.textContent = '';
    const currentPassword = String(currentInput?.value || '');
    const newPassword = String(newInput?.value || '');
    const confirmPassword = String(confirmInput?.value || '');
    if (!currentPassword || !newPassword || !confirmPassword) {
      if (status) status.textContent = 'Please fill in all password fields.';
      return;
    }
    if (newPassword !== confirmPassword) {
      if (status) status.textContent = 'New passwords do not match.';
      return;
    }
    if (!isStrongPassword(newPassword)) {
      if (status) status.textContent = PASSWORD_RULE_MESSAGE;
      return;
    }
    try {
      await fetchJson(`${API_BASE}/admin/password`, {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword })
      });
      if (status) status.textContent = 'Password updated. Please log in again.';
      logAdminActivity('Updated admin password');
      renderActivityLog();
      form.reset();
      setTimeout(() => {
        clearAdminToken();
        sessionStorage.removeItem('adminSession');
        window.location.href = 'admin-login.html';
      }, 900);
    } catch (err) {
      console.error('admin password update error', err);
      if (status) status.textContent = err?.data?.error || 'Unable to update password.';
    }
  });
}

function bindLogout() {
  const btn = byId('admin-logout-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    logAdminActivity('Admin logout');
    clearAdminToken();
    sessionStorage.removeItem('adminSession');
    window.location.href = 'admin-login.html';
  });
}

function bindModals() {
  byId('addProductBtn')?.addEventListener('click', () => showModal('addProductModal'));
  byId('editProductBtn')?.addEventListener('click', () => showModal('editProductModal'));
  byId('deleteProductBtn')?.addEventListener('click', () => showModal('deleteProductModal'));
  document.querySelectorAll('.modal .close').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.modal').style.display = 'none');
  });
  window.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) e.target.style.display = 'none';
  });
  byId('cancelDelete')?.addEventListener('click', () => hideModal('deleteProductModal'));
}

function bindAddForm() {
  const form = byId('addProductForm');
  if (!form) return;
  const categorySelect = byId('productCategory');
  const statusSelect = byId('productStatus');
  const familySelect = byId('productFamilyGroup');
  setStatusOptions(statusSelect, categorySelect?.value || '');
  toggleFamilyGroupFields(categorySelect?.value || '', familySelect);
  categorySelect?.addEventListener('change', () => {
    setStatusOptions(statusSelect, categorySelect.value);
    toggleFamilyGroupFields(categorySelect.value, familySelect);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      name: byId('productName').value.trim(),
      price: Number(byId('productPrice').value) || 0,
      discountType: byId('productDiscountType')?.value || 'none',
      discountValue: Number(byId('productDiscountValue')?.value) || 0,
      category: byId('productCategory').value,
      familyGroup: byId('productFamilyGroup')?.value || '',
        status: byId('productStatus')?.value || 'new',
      description: byId('productDescription').value.trim(),
      image: (byId('productImage').files?.[0]?.name) || 'images/logo.png',
        sku: byId('productSku')?.value?.trim() || '',
        stock: Number(byId('productStock')?.value) || 0,
        lowStockThreshold: Number(byId('productLowStock')?.value) || 0,
        featured: !!byId('productFeatured')?.checked,
        dateAdded: new Date()
      };
    try {
        const saved = await fetchJson(`${API_BASE}/products`, { method: 'POST', body: JSON.stringify(payload) });
        products.unshift(saved);
        cacheProducts(products);
        renderProductList();
        populateSelects();
        renderLowStockList();
      hideModal('addProductModal');
      form.reset();
      logAdminActivity(`Added product: ${payload.name}`);
      renderActivityLog();
      alert('Product added');
    } catch (err) {
      console.error(err);
      const message = err?.data?.error || err?.message || 'Add failed';
      alert(message);
    }
  });
}

function bindEditForm() {
  const form = byId('editProductForm');
  const select = byId('productSelect');
  if (!form || !select) return;

  const editCategorySelect = byId('editProductCategory');
  const editFamilySelect = byId('editProductFamilyGroup');
  const editStatusSelect = byId('editProductStatus');
  editCategorySelect?.addEventListener('change', () => {
    setStatusOptions(editStatusSelect, editCategorySelect.value);
    toggleFamilyGroupFields(editCategorySelect.value, editFamilySelect);
  });

  select.addEventListener('change', () => {
    const prod = products.find(p => p._id === select.value);
    if (!prod) return;
    const categoryValue = prod.category || 'Pure Silk Paithani';
    const familyValue = prod.familyGroup || '';
    byId('editProductName').value = prod.name || '';
    byId('editProductPrice').value = prod.price || '';
    byId('editProductDiscountType').value = prod.discountType || 'none';
    byId('editProductDiscountValue').value = Number(prod.discountValue) || 0;
    byId('editProductCategory').value = categoryValue;
    toggleFamilyGroupFields(categoryValue, editFamilySelect, familyValue);
    setStatusOptions(byId('editProductStatus'), categoryValue, prod.status || 'available');
    byId('editProductDescription').value = prod.description || '';
      byId('editProductSku').value = prod.sku || '';
      byId('editProductStock').value = Number.isFinite(Number(prod.stock)) ? Number(prod.stock) : 0;
      byId('editProductLowStock').value = Number.isFinite(Number(prod.lowStockThreshold)) ? Number(prod.lowStockThreshold) : 0;
      const featuredField = byId('editProductFeatured');
      if (featuredField) featuredField.checked = !!prod.featured;
    });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = select.value;
    if (!id) return alert('Select a product');
      const payload = {
        name: byId('editProductName').value.trim(),
        price: Number(byId('editProductPrice').value) || 0,
        discountType: byId('editProductDiscountType')?.value || 'none',
        discountValue: Number(byId('editProductDiscountValue')?.value) || 0,
        category: byId('editProductCategory').value,
        familyGroup: byId('editProductFamilyGroup')?.value || '',
        status: byId('editProductStatus')?.value || 'available',
        description: byId('editProductDescription').value.trim(),
        sku: byId('editProductSku')?.value?.trim() || '',
        stock: Number(byId('editProductStock')?.value) || 0,
        lowStockThreshold: Number(byId('editProductLowStock')?.value) || 0,
        featured: !!byId('editProductFeatured')?.checked
      };
    const fileName = byId('editProductImage').files?.[0]?.name;
    if (fileName) payload.image = fileName;
    try {
        const updated = await fetchJson(`${API_BASE}/products/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        products = products.map(p => p._id === id ? updated : p);
        cacheProducts(products);
        renderProductList();
        populateSelects();
        renderLowStockList();
      hideModal('editProductModal');
      form.reset();
      logAdminActivity(`Updated product: ${payload.name}`);
      renderActivityLog();
      alert('Product updated');
    } catch (err) {
      console.error(err);
      const message = err?.data?.error || err?.message || 'Update failed';
      alert(message);
    }
  });
}

function bindDeleteForm() {
  const form = byId('deleteProductForm');
  const select = byId('deleteProductSelect');
  if (!form || !select) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const id = select.value;
    if (!id) return alert('Select a product');
    if (!confirm('Delete this product?')) return;
    try {
      const product = products.find(p => p._id === id);
        await fetchJson(`${API_BASE}/products/${id}`, { method: 'DELETE' });
        products = products.filter(p => p._id !== id);
        cacheProducts(products);
        renderProductList();
        populateSelects();
        renderLowStockList();
      hideModal('deleteProductModal');
      form.reset();
      logAdminActivity(`Deleted product: ${product?.name || id}`);
      renderActivityLog();
      alert('Product deleted');
    } catch (err) {
      console.error(err);
      const message = err?.data?.error || err?.message || 'Delete failed';
      alert(message);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindModals();
  bindAddForm();
  bindEditForm();
  bindDeleteForm();
  bindSettings();
  bindAdminPasswordChange();
  bindLogout();
  const dateEl = byId('admin-today');
  if (dateEl) {
    const now = new Date();
    dateEl.textContent = now.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
  }
  renderActivityLog();
  loadProducts();
  loadOverview();
});






