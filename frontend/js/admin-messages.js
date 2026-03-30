const API_BASE = window.ADMIN_API_BASE || (typeof resolveAdminApiBase === 'function' ? resolveAdminApiBase() : (window.location.origin.includes('localhost') ? 'http://localhost:5000' : window.location.origin));

ensureAdminAuth();

const root = document.getElementById('messages-root');
const searchInput = document.getElementById('message-search');
const statusFilter = document.getElementById('message-status-filter');
const refreshBtn = document.getElementById('message-refresh');

let messages = [];

function formatDate(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('en-IN');
}

function resolveStatus(msg) {
  if (msg.status) return msg.status;
  return msg.reply ? 'replied' : 'open';
}

function getFilteredMessages() {
  const term = (searchInput?.value || '').toLowerCase().trim();
  const status = statusFilter?.value || '';
  return messages.filter(msg => {
    const haystack = [msg.name, msg.email, msg.message, msg.reply]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    const matchesTerm = term ? haystack.includes(term) : true;
    const resolved = resolveStatus(msg);
    const matchesStatus = status ? resolved === status : true;
    return matchesTerm && matchesStatus;
  });
}

function renderMessages(list) {
  if (!root) return;
  if (!list.length) {
    root.innerHTML = '<p class="muted">No messages match your filters.</p>';
    return;
  }

  root.innerHTML = `
    <table class="admin-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Message</th>
          <th>Status</th>
          <th>Date</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${list.map(msg => {
          const status = resolveStatus(msg);
          const replyText = msg.reply ? msg.reply.replace(/\n/g, '<br>') : '';
          return `
            <tr>
              <td>${msg.name || '-'}</td>
              <td>${msg.email || '-'}</td>
              <td class="message-cell">${(msg.message || '-').replace(/\n/g, '<br>')}</td>
              <td><span class="status-pill status-${status}">${status}</span></td>
              <td>${formatDate(msg.createdAt)}</td>
              <td>
                <div class="admin-table-actions">
                  <button class="admin-inline-btn secondary" data-action="toggle-reply" data-id="${msg._id}">
                    ${msg.reply ? 'View Reply' : 'Reply'}
                  </button>
                </div>
              </td>
            </tr>
            <tr class="message-reply-row" data-reply-for="${msg._id}" style="display:none;">
              <td colspan="6">
                <div class="reply-box">
                  <div class="reply-meta">${msg.reply ? 'Last reply sent ' + formatDate(msg.repliedAt) : 'Send a reply to the customer.'}</div>
                  ${msg.reply ? `<div class="reply-existing">${replyText}</div>` : ''}
                  <textarea class="reply-textarea" id="reply-text-${msg._id}" placeholder="Write your reply..."></textarea>
                  <div class="admin-table-actions">
                    <button class="admin-inline-btn" data-action="send-reply" data-id="${msg._id}">Send Reply</button>
                    <button class="admin-inline-btn secondary" data-action="close-reply" data-id="${msg._id}">Close</button>
                  </div>
                </div>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}

async function loadMessages() {
  if (!root) return;
  try {
    const data = await adminFetchJson(`${API_BASE}/admin/contacts`);
    messages = Array.isArray(data) ? data : [];
    renderMessages(getFilteredMessages());
    if (typeof refreshAdminNotifications === 'function') {
      refreshAdminNotifications();
    }
  } catch (err) {
    console.error('messages fetch error', err);
    root.innerHTML = '<p class="muted">Unable to load messages right now.</p>';
  }
}

async function sendReply(messageId, reply) {
  try {
    const updated = await adminFetchJson(`${API_BASE}/admin/contacts/${messageId}/reply`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply })
    });
    messages = messages.map(msg => msg._id === messageId ? updated : msg);
    renderMessages(getFilteredMessages());
    if (typeof refreshAdminNotifications === 'function') {
      refreshAdminNotifications();
    }
  } catch (err) {
    console.error('reply error', err);
    alert('Unable to send reply.');
  }
}

function bindFilters() {
  searchInput?.addEventListener('input', () => renderMessages(getFilteredMessages()));
  statusFilter?.addEventListener('change', () => renderMessages(getFilteredMessages()));
  refreshBtn?.addEventListener('click', loadMessages);
}

if (root) {
  root.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const messageId = button.dataset.id;
    if (!messageId) return;
    const row = root.querySelector(`[data-reply-for="${messageId}"]`);

    if (action === 'toggle-reply') {
      if (row) row.style.display = row.style.display === 'none' ? 'table-row' : 'none';
      return;
    }
    if (action === 'close-reply') {
      if (row) row.style.display = 'none';
      return;
    }
    if (action === 'send-reply') {
      const textarea = document.getElementById(`reply-text-${messageId}`);
      const reply = textarea?.value?.trim() || '';
      if (!reply) {
        alert('Please enter a reply.');
        return;
      }
      sendReply(messageId, reply);
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  bindFilters();
  loadMessages();
});

