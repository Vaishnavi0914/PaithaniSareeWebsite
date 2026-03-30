const WHATSAPP_NUMBER = '917888118137';
const WHATSAPP_MESSAGE = 'Hi, I want to know about Paithani sarees.';
const WHATSAPP_CONFIRM_TEXT = 'Do you want to chat directly with us on WhatsApp?';

function initWhatsAppFab() {
    if (document.getElementById('whatsapp-fab')) return;

    const path = window.location.pathname.toLowerCase();
    const isAdmin = document.body.classList.contains('admin-body') || path.includes('admin-');
    if (isAdmin) return;

    const button = document.createElement('button');
    button.id = 'whatsapp-fab';
    button.type = 'button';
    button.className = 'whatsapp-fab';
    button.setAttribute('aria-label', 'Chat on WhatsApp');
    button.title = 'Chat on WhatsApp';
    button.innerHTML = `
        <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
            <path d="M16.1 4.2c-6.6 0-12 5.1-12 11.4 0 2 0.6 4 1.7 5.6L4 28l7.2-1.9c1.5 0.8 3.2 1.3 5 1.3 6.6 0 12-5.1 12-11.4S22.7 4.2 16.1 4.2zm0 20.8c-1.6 0-3.2-0.4-4.5-1.2l-0.3-0.2-4.3 1.2 1.2-4.1-0.2-0.3c-1-1.5-1.5-3.2-1.5-5 0-5.1 4.4-9.2 9.6-9.2s9.6 4.1 9.6 9.2-4.4 9.2-9.6 9.2zm5.4-6.4c-0.3-0.1-1.7-0.8-2-0.9-0.3-0.1-0.5-0.1-0.7 0.1-0.2 0.2-0.8 0.9-1 1.1-0.2 0.2-0.4 0.2-0.7 0.1-0.3-0.1-1.4-0.5-2.6-1.6-1-0.9-1.6-2-1.8-2.3-0.2-0.3 0-0.4 0.1-0.6 0.1-0.1 0.3-0.3 0.4-0.5 0.1-0.2 0.2-0.3 0.3-0.5 0.1-0.2 0-0.4 0-0.5 0-0.1-0.7-1.6-1-2.2-0.2-0.5-0.5-0.4-0.7-0.4h-0.6c-0.2 0-0.5 0.1-0.8 0.4-0.3 0.3-1 1-1 2.5s1 2.9 1.1 3.1c0.1 0.2 2 3.1 4.8 4.3 0.7 0.3 1.2 0.5 1.6 0.6 0.7 0.2 1.3 0.2 1.8 0.1 0.6-0.1 1.7-0.7 1.9-1.4 0.2-0.7 0.2-1.3 0.2-1.4 0-0.1-0.3-0.2-0.6-0.3z"/>
        </svg>
    `;

    button.addEventListener('click', () => {
        if (!WHATSAPP_NUMBER || !String(WHATSAPP_NUMBER).trim()) {
            alert('WhatsApp number is not set. Please update it in js/whatsapp-chat.js');
            return;
        }
        const cleaned = String(WHATSAPP_NUMBER).replace(/\D/g, '');
        const text = WHATSAPP_MESSAGE ? `?text=${encodeURIComponent(WHATSAPP_MESSAGE)}` : '';
        const url = `https://wa.me/${cleaned}${text}`;
        if (confirm(WHATSAPP_CONFIRM_TEXT)) {
            window.open(url, '_blank', 'noopener');
        }
    });

    document.body.appendChild(button);
}

document.addEventListener('DOMContentLoaded', initWhatsAppFab);
