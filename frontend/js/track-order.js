(() => {
  if (!window.location.pathname.includes('track-order.html')) return;

  const API_BASE = window.API_BASE_URL || window.PAITHANI_API_BASE || window.location.origin;
  const form = document.getElementById('track-form');
  const messageEl = document.getElementById('track-message');
  const resultCard = document.getElementById('track-result');

  const orderIdInput = document.getElementById('track-order-id');
  const emailInput = document.getElementById('track-email');
  const phoneInput = document.getElementById('track-phone');

  const setMessage = (text, type = '') => {
    if (!messageEl) return;
    messageEl.textContent = text || '';
    messageEl.classList.remove('error', 'success');
    if (type) messageEl.classList.add(type);
  };

  const formatPrice = (value) => {
    const amount = Number(value) || 0;
    return `Rs ${amount.toLocaleString('en-IN')}`;
  };

  const formatDate = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-IN');
  };

  const STATUS_FLOW = ['placed', 'paid', 'packed', 'shipped', 'delivered', 'returned', 'refunded', 'cancelled'];
  const STATUS_LABELS = {
    placed: 'Placed',
    paid: 'Paid',
    packed: 'Packed',
    shipped: 'Shipped',
    delivered: 'Delivered',
    returned: 'Returned',
    refunded: 'Refunded',
    cancelled: 'Cancelled'
  };

  function renderSteps(currentStatus) {
    const container = document.getElementById('tracking-steps');
    if (!container) return;
    const status = String(currentStatus || '').toLowerCase();
    const activeIndex = STATUS_FLOW.indexOf(status);
    container.innerHTML = STATUS_FLOW.map((step, idx) => {
      const isDone = activeIndex > -1 && idx < activeIndex;
      const isCurrent = activeIndex === idx;
      const classes = ['tracking-step'];
      if (isDone) classes.push('is-done');
      if (isCurrent) classes.push('is-current');
      return `
        <div class="${classes.join(' ')}">
          <span class="tracking-dot"></span>
          <span class="tracking-label">${STATUS_LABELS[step]}</span>
        </div>
      `;
    }).join('');
  }

  function renderItems(items) {
    const itemsRoot = document.getElementById('track-items');
    if (!itemsRoot) return;
    const list = Array.isArray(items) ? items : [];
    if (!list.length) {
      itemsRoot.innerHTML = '<p class="muted">No items found in this order.</p>';
      return;
    }
    itemsRoot.innerHTML = list.map(item => `
      <div class="order-confirmation-item">
        ${item.image ? `<img src="${item.image}" alt="${item.name || 'Item'}">` : ''}
        <div class="order-confirmation-item-details">
          <strong>${item.name || 'Item'}</strong>
          <span>Qty: ${Number(item.qty) || 1}</span>
          <span>Unit: ${formatPrice(item.unitPrice || 0)}</span>
        </div>
      </div>
    `).join('');
  }

  function renderTrackingShipment(tracking, status) {
    const container = document.getElementById('tracking-shipment');
    if (!container) return;
    const carrier = tracking?.carrier || '';
    const number = tracking?.trackingNumber || '';
    const url = tracking?.trackingUrl || '';
    const parts = [];
    if (carrier) parts.push(`<div><strong>Carrier:</strong> ${carrier}</div>`);
    if (number) parts.push(`<div><strong>Tracking #:</strong> ${number}</div>`);
    if (url) parts.push(`<div><a href="${url}" target="_blank" rel="noopener noreferrer">Open tracking link</a></div>`);
    if (!parts.length) {
      container.innerHTML = `<p class="muted">Tracking details will appear here once shipped.</p>`;
      return;
    }
    container.innerHTML = `
      <div class="tracking-shipment-card">
        <div class="tracking-shipment-title">Shipment Tracking</div>
        ${parts.join('')}
        <div class="tracking-shipment-status">Current status: ${STATUS_LABELS[status] || status}</div>
      </div>
    `;
  }

  function renderResult(data) {
    if (!resultCard) return;
    resultCard.classList.remove('is-hidden');

    const setText = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value || '-';
    };

    const status = String(data?.status || 'placed').toLowerCase();
    setText('track-order-display', data?._id || '-');
    setText('track-status-display', STATUS_LABELS[status] || status);
    setText('track-date-display', formatDate(data?.createdAt));
    setText('track-name', data?.customer?.name || '-');
    setText('track-email-display', data?.customer?.email || '-');
    setText('track-phone-display', data?.customer?.phone || '-');
    setText('track-address', data?.customer?.address || '-');
    setText('track-subtotal', formatPrice(data?.totals?.subtotal || 0));
    setText('track-shipping', formatPrice(data?.totals?.shipping || 0));
    setText('track-total', formatPrice(data?.totals?.total || 0));

    const statusTitle = document.getElementById('track-status-title');
    const statusSubtitle = document.getElementById('track-status-subtitle');
    if (statusTitle) statusTitle.textContent = `Your order is ${STATUS_LABELS[status] || status}`;
    if (statusSubtitle) {
      const subtitle = status === 'cancelled'
        ? 'This order has been cancelled. Contact support if you need help.'
        : status === 'refunded'
          ? 'This order has been refunded.'
          : status === 'returned'
            ? 'This order has been returned and is under review.'
            : 'We will update you as your order moves to the next step.';
      statusSubtitle.textContent = subtitle;
    }

    renderSteps(status);
    renderItems(data?.items || []);
    renderTrackingShipment(data?.tracking || {}, status);
  }

  async function fetchTracking(payload) {
    const res = await fetch(`${API_BASE}/orders/track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = data?.error || 'Unable to find that order. Please verify the details.';
      const error = new Error(err);
      error.status = res.status;
      throw error;
    }
    return data;
  }

  const params = new URLSearchParams(window.location.search || '');
  const prefillOrderId = params.get('orderId') || '';
  const prefillEmail = params.get('email') || '';
  if (prefillOrderId && orderIdInput) orderIdInput.value = prefillOrderId;
  if (prefillEmail && emailInput) emailInput.value = prefillEmail;

  if (form) {
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      setMessage('');
      const orderId = orderIdInput?.value?.trim();
      const email = emailInput?.value?.trim().toLowerCase();
      const phone = phoneInput?.value?.trim();
      if (!orderId || !email) {
        setMessage('Please enter both order ID and email.', 'error');
        return;
      }
      try {
        setMessage('Checking order status...', 'success');
        const data = await fetchTracking({ orderId, email, phone });
        setMessage('');
        renderResult(data);
        resultCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (err) {
        console.error('track order error', err);
        setMessage(err?.message || 'Unable to track order right now.', 'error');
      }
    });
  }
})();
