const API_BASE = (window.location.origin.includes('localhost') ? 'http://localhost:5000' : window.location.origin);
const API_CONFIG_STORAGE_KEY = 'paithani_api_base';
const CHECKOUT_TAX_RATE = 0;
const SHIPPING_RATE_NASHIK = 200;
const SHIPPING_RATE_MAHARASHTRA = 300;
const SHIPPING_RATE_REST = 500;
const ORDER_CONFIRMATION_KEY = 'paithani_order_confirmation';

function sanitizeApiBase(value) {
    if (!value) return '';
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    if (!/^https?:\/\//i.test(trimmed)) return '';
    return trimmed.replace(/\/+$/, '');
}

function readApiBaseFromMeta() {
    const meta = document.querySelector('meta[name="paithani-api-base"]');
    return meta && meta.content ? meta.content : '';
}

function readApiBaseFromQuery() {
    try {
        const params = new URLSearchParams(window.location.search || '');
        return params.get('api') || params.get('apiBase') || params.get('api_base') || '';
    } catch (err) {
        return '';
    }
}

function readApiBaseFromStorage() {
    try {
        return localStorage.getItem(API_CONFIG_STORAGE_KEY) || '';
    } catch (err) {
        return '';
    }
}

function storeApiBase(value) {
    if (!value) return;
    try {
        localStorage.setItem(API_CONFIG_STORAGE_KEY, value);
    } catch (err) {
        // ignore storage errors
    }
}

function getConfiguredApiBase() {
    const fromQuery = sanitizeApiBase(readApiBaseFromQuery());
    if (fromQuery) {
        storeApiBase(fromQuery);
        return fromQuery;
    }
    const fromGlobal = sanitizeApiBase(window.PAITHANI_API_BASE);
    if (fromGlobal) return fromGlobal;
    const fromMeta = sanitizeApiBase(readApiBaseFromMeta());
    if (fromMeta) return fromMeta;
    const fromStorage = sanitizeApiBase(readApiBaseFromStorage());
    if (fromStorage) return fromStorage;
    return '';
}
function applyDesktopViewportScale() {
    const viewport = document.querySelector('meta[name="viewport"]');
    if (!viewport) return;
    viewport.setAttribute('content', 'width=device-width, initial-scale=1.0');
}

applyDesktopViewportScale();
const DEFAULT_PROD_API_BASE = '';

function resolveApiBase() {
    const configured = getConfiguredApiBase();
    if (configured) return configured;
    const origin = window.location.origin || '';
    if (!origin || origin === 'null' || origin.startsWith('file:')) {
        return 'http://localhost:5000';
    }
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
        return 'http://localhost:5000';
    }
    return DEFAULT_PROD_API_BASE || origin;
}

const API_BASE_URL = resolveApiBase();
window.resolveApiBase = resolveApiBase;
window.API_BASE_URL = API_BASE_URL;

const REPLY_SEEN_PREFIX = 'paithani_reply_seen:';
const NOTIFY_BADGE_MAX = 9;
let notifyReplyCache = [];

function getReplySeenKey(email) {
    return `${REPLY_SEEN_PREFIX}${String(email || '').toLowerCase()}`;
}

function getNotifyEmail() {
    try {
        const authRaw = localStorage.getItem('authUser');
        if (authRaw) {
            const parsed = JSON.parse(authRaw);
            if (parsed && parsed.email) return String(parsed.email).toLowerCase();
        }
    } catch (err) {
        // ignore
    }
    const contactEmail = localStorage.getItem('paithani_contact_email');
    return contactEmail ? String(contactEmail).toLowerCase() : '';
}

function readUserNotificationPrefs(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) {
        return { orders: true, promos: false, messages: true };
    }
    const key = `profile:${normalized}:notifications`;
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return { orders: true, promos: false, messages: true };
        const parsed = JSON.parse(raw);
        return {
            orders: parsed?.orders !== false,
            promos: !!parsed?.promos,
            messages: parsed?.messages !== false
        };
    } catch (err) {
        return { orders: true, promos: false, messages: true };
    }
}

function updateProfileLinks() {
    const links = document.querySelectorAll('.nav-profile-link');
    if (!links.length) return;
    const token = localStorage.getItem('authToken') || '';
    const target = token ? 'profile.html' : 'login.html';
    links.forEach((link) => {
        link.setAttribute('href', target);
        if (!token) {
            link.setAttribute('aria-label', 'Login');
        } else {
            link.setAttribute('aria-label', 'User Profile');
        }
    });
}

function ensureNotifyBell() {
    const path = (window.location.pathname || '').toLowerCase();
    if (path.endsWith('/') || path.endsWith('index.html')) {
        return;
    }
    const headerCart = document.querySelector('.header-cart, .header-actions');
    if (!headerCart || headerCart.querySelector('.nav-notify-link')) return;
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nav-notify-link';
    button.setAttribute('aria-label', 'Notifications');
    button.setAttribute('aria-expanded', 'false');
    button.innerHTML = '<span class="nav-notify-icon">&#128276;</span><span class="nav-notify-badge is-hidden" data-notify-count>0</span>';
    const panel = document.createElement('div');
    panel.className = 'nav-notify-panel is-hidden';
    panel.innerHTML = `
        <div class="nav-notify-header">Notifications</div>
        <div class="nav-notify-list" data-notify-list></div>
        <a class="nav-notify-footer" href="profile.html#support-replies-panel">View all replies</a>
    `;
    wrapper.appendChild(button);
    wrapper.appendChild(panel);
    const cartLink = headerCart.querySelector('.nav-cart-link');
    if (cartLink) {
        headerCart.insertBefore(wrapper, cartLink);
    } else {
        headerCart.appendChild(wrapper);
    }
    const closePanel = () => {
        panel.classList.add('is-hidden');
        button.setAttribute('aria-expanded', 'false');
    };
    button.addEventListener('click', (event) => {
        event.preventDefault();
        const isHidden = panel.classList.contains('is-hidden');
        if (isHidden) {
            panel.classList.remove('is-hidden');
            button.setAttribute('aria-expanded', 'true');
            const email = getNotifyEmail();
            if (email && notifyReplyCache.length) {
                markUserRepliesSeen(email, notifyReplyCache);
                setNotifyBadgeCount(0);
            }
        } else {
            closePanel();
        }
    });
    document.addEventListener('click', (event) => {
        if (!wrapper.contains(event.target)) {
            closePanel();
        }
    });
}

function setNotifyBadgeCount(count) {
    const badge = document.querySelector('[data-notify-count]');
    if (!badge) return;
    const safeCount = Math.max(0, Number(count) || 0);
    if (safeCount <= 0) {
        badge.classList.add('is-hidden');
        badge.textContent = '0';
        return;
    }
    badge.classList.remove('is-hidden');
    badge.textContent = safeCount > NOTIFY_BADGE_MAX ? `${NOTIFY_BADGE_MAX}+` : String(safeCount);
}

function getReplyTimestamp(msg) {
    const raw = msg?.repliedAt || msg?.updatedAt || msg?.createdAt || 0;
    const ts = new Date(raw).getTime();
    return Number.isNaN(ts) ? 0 : ts;
}

function escapeNotifyText(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function buildMarketingNotifications() {
    const items = [];
    const sale = getSaleSettings?.();
    if (sale && sale.active) {
        const discountText = (sale.type !== 'none' && sale.value > 0)
            ? (sale.type === 'percent' ? `${sale.value}% OFF` : `Rs ${sale.value} OFF`)
            : '';
        const label = sale.label || 'Festive Offer';
        items.push({
            title: 'Sale is Live',
            body: discountText ? `${label} • ${discountText}` : label
        });
    }

    const products = typeof readCachedProducts === 'function' ? readCachedProducts() : [];
    const now = Date.now();
    const cutoff = now - (30 * 24 * 60 * 60 * 1000);
    const newProducts = (products || []).filter(product => {
        const status = String(product?.status || '').toLowerCase();
        if (status.includes('new')) return true;
        const dateRaw = product?.dateAdded || product?.createdAt || product?.updatedAt || 0;
        const dateValue = new Date(dateRaw).getTime();
        if (Number.isNaN(dateValue)) return false;
        return dateValue >= cutoff;
    });

    if (newProducts.length) {
        const names = newProducts.slice(0, 2).map(p => p.name).filter(Boolean);
        const tail = newProducts.length > 2 ? ` and ${newProducts.length - 2} more` : '';
        items.push({
            title: 'New Arrivals',
            body: names.length ? `Just added: ${names.join(', ')}${tail}.` : 'Fresh designs just arrived.'
        });
    }

    const discounted = (products || []).filter(product => {
        const type = String(product?.discountType || 'none').toLowerCase();
        const value = Number(product?.discountValue) || 0;
        return type !== 'none' && value > 0;
    });
    if (discounted.length) {
        const names = discounted.slice(0, 2).map(p => p.name).filter(Boolean);
        const tail = discounted.length > 2 ? ` and ${discounted.length - 2} more` : '';
        items.push({
            title: 'Special Offers',
            body: names.length ? `Discounts on ${names.join(', ')}${tail}.` : 'Limited-time offers available.'
        });
    }

    return items;
}

function markUserRepliesSeen(email, list) {
    if (!email || !Array.isArray(list)) return;
    const latest = list
        .filter(msg => msg && String(msg.reply || '').trim())
        .map(getReplyTimestamp)
        .reduce((max, value) => Math.max(max, value), 0);
    if (latest) {
        localStorage.setItem(getReplySeenKey(email), String(latest));
    }
}

async function refreshUserNotifications() {
    ensureNotifyBell();
    const email = getNotifyEmail();
    const listEl = document.querySelector('[data-notify-list]');
    const prefs = readUserNotificationPrefs(email);
    const marketingItems = prefs.promos ? buildMarketingNotifications() : [];
    const allowMessages = prefs.messages !== false;

    if (!email) {
        setNotifyBadgeCount(0);
        if (listEl) {
            if (marketingItems.length) {
                listEl.innerHTML = marketingItems.map(item => `
                    <div class="nav-notify-item">
                        <strong>${escapeNotifyText(item.title)}</strong>
                        ${escapeNotifyText(item.body)}
                    </div>
                `).join('');
            } else {
                listEl.innerHTML = '<div class="nav-notify-item">No notifications yet.</div>';
            }
        }
        return;
    }
    let lastSeen = Number(localStorage.getItem(getReplySeenKey(email)) || 0);
    if (!Number.isFinite(lastSeen)) lastSeen = 0;
    try {
        const res = await fetch(`${API_BASE_URL}/contacts?email=${encodeURIComponent(email)}`);
        const data = await res.json().catch(() => ([]));
        if (!res.ok) {
            setNotifyBadgeCount(0);
            return;
        }
        const list = Array.isArray(data) ? data : [];
        const replies = allowMessages ? list.filter(msg => msg && String(msg.reply || '').trim()) : [];
        if (!allowMessages) {
            setNotifyBadgeCount(0);
        }
        notifyReplyCache = replies;
        const unread = replies.filter(msg => {
            if (!msg || !String(msg.reply || '').trim()) return false;
            const ts = getReplyTimestamp(msg);
            return ts > lastSeen;
        });
        setNotifyBadgeCount(unread.length);
        if (listEl) {
            const replyItems = replies.length
                ? [...replies].sort((a, b) => getReplyTimestamp(b) - getReplyTimestamp(a)).slice(0, 3).map(msg => ({
                    title: 'Reply received',
                    body: String(msg.reply || '').slice(0, 120)
                }))
                : [];
            const combined = [...replyItems, ...marketingItems];
            if (!combined.length) {
                listEl.innerHTML = '<div class="nav-notify-item">No notifications yet.</div>';
            } else {
                listEl.innerHTML = combined.map(item => `
                    <div class="nav-notify-item">
                        <strong>${escapeNotifyText(item.title)}</strong>
                        ${escapeNotifyText(item.body)}
                    </div>
                `).join('');
            }
        }
    } catch (err) {
        setNotifyBadgeCount(0);
        if (listEl) {
            if (marketingItems.length) {
                listEl.innerHTML = marketingItems.map(item => `
                    <div class="nav-notify-item">
                        <strong>${escapeNotifyText(item.title)}</strong>
                        ${escapeNotifyText(item.body)}
                    </div>
                `).join('');
            } else {
                listEl.innerHTML = '<div class="nav-notify-item">Unable to load notifications.</div>';
            }
        }
    }
}

window.refreshUserNotifications = refreshUserNotifications;
window.markUserRepliesSeen = markUserRepliesSeen;

function getCurrentPage() {
    const path = window.location.pathname.split('/').pop();
    return path && path.trim().length > 0 ? path : "index.html";
}

function setActiveNavLink() {
    const currentPage = getCurrentPage();
    document.querySelectorAll("nav a").forEach(link => {
        const href = link.getAttribute("href") || "";
        const hrefPage = href.split("/").pop();
        if (hrefPage === currentPage) {
            link.classList.add("active");
        } else {
            link.classList.remove("active");
        }
    });
}

let inlineMessageTimer;

function showInlineMessage(message, type = 'success') {
    const header = document.querySelector('header');
    if (!header) return;

    let bar = document.querySelector('.inline-message');
    if (!bar) {
        bar = document.createElement('div');
        bar.className = 'inline-message';
        bar.style.position = 'fixed';
        bar.style.left = '0';
        bar.style.right = '0';
        bar.style.zIndex = '1999';

        const text = document.createElement('span');
        text.className = 'inline-message-text';

        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'inline-message-close';
        close.setAttribute('aria-label', 'Close notification');
        close.textContent = '×';
        close.addEventListener('click', () => {
            if (inlineMessageTimer) clearTimeout(inlineMessageTimer);
            bar.remove();
        });

        bar.appendChild(text);
        bar.appendChild(close);
        header.insertAdjacentElement('afterend', bar);
    }

    const headerHeight = header.getBoundingClientRect().height || 0;
    bar.style.top = `${Math.max(0, Math.round(headerHeight))}px`;

    const textEl = bar.querySelector('.inline-message-text');
    if (textEl) textEl.textContent = message;
    bar.classList.remove('inline-message-success', 'inline-message-error', 'inline-message-info');
    bar.classList.add(`inline-message-${type}`);

    if (inlineMessageTimer) clearTimeout(inlineMessageTimer);
    inlineMessageTimer = setTimeout(() => {
        bar.remove();
    }, 3500);
}

function initMobileNav() {
    const headerMains = document.querySelectorAll('.header-main');
    headerMains.forEach((headerMain, index) => {
        if (headerMain.dataset.navInit === '1') return;
        const nav = headerMain.querySelector('nav');
        if (!nav) return;

        const actions = headerMain.querySelector('.header-cart, .header-actions');
        headerMain.classList.toggle('has-actions', Boolean(actions));

        const navId = nav.id || `site-nav-${index + 1}`;
        nav.id = navId;

        if (!headerMain.querySelector('.nav-toggle')) {
            const toggle = document.createElement('button');
            toggle.type = 'button';
            toggle.className = 'nav-toggle';
            toggle.setAttribute('aria-label', 'Toggle navigation');
            toggle.setAttribute('aria-controls', navId);
            toggle.setAttribute('aria-expanded', 'false');
            toggle.innerHTML = '<span></span><span></span><span></span>';

            const logo = headerMain.querySelector('.logo');
            if (actions && actions.parentElement === headerMain) {
                actions.insertAdjacentElement('afterend', toggle);
            } else if (logo && logo.parentElement === headerMain) {
                logo.insertAdjacentElement('afterend', toggle);
            } else {
                headerMain.insertBefore(toggle, nav);
            }

            const setOpen = (open) => {
                headerMain.classList.toggle('nav-open', open);
                toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
            };

            toggle.addEventListener('click', () => {
                setOpen(!headerMain.classList.contains('nav-open'));
            });

            nav.addEventListener('click', (event) => {
                if (event.target.closest('a')) {
                    setOpen(false);
                }
            });
        }

        headerMain.classList.add('nav-ready');
        headerMain.dataset.navInit = '1';
    });
}
const BACK_TARGET_KEY = 'paithani_back_target';

function storeBackTarget() {
    try {
        const payload = {
            url: window.location.href,
            scrollY: window.scrollY || 0,
            ts: Date.now()
        };
        sessionStorage.setItem(BACK_TARGET_KEY, JSON.stringify(payload));
    } catch (err) {
        console.warn('could not store back target', err);
    }
}

function readBackTarget() {
    try {
        const raw = sessionStorage.getItem(BACK_TARGET_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data.url !== 'string') return null;
        return data;
    } catch (err) {
        console.warn('could not read back target', err);
        return null;
    }
}

function isSameOriginUrl(url) {
    try {
        const target = new URL(url, window.location.origin);
        return target.origin === window.location.origin;
    } catch (err) {
        return false;
    }
}

function restoreBackTargetScroll() {
    const data = readBackTarget();
    if (!data || !data.url) return;
    const currentUrl = window.location.href.split('#')[0];
    const targetUrl = data.url.split('#')[0];
    if (currentUrl !== targetUrl) return;
    const scrollY = Number(data.scrollY);
    if (Number.isFinite(scrollY) && scrollY > 0) {
        window.requestAnimationFrame(() => {
            window.scrollTo(0, scrollY);
        });
    }
    sessionStorage.removeItem(BACK_TARGET_KEY);
}

function navigateBackWithFallback(fallbackUrl = 'products.html') {
    const referrer = document.referrer;
    if (referrer) {
        try {
            const refUrl = new URL(referrer);
            if (refUrl.origin === window.location.origin && window.history.length > 1) {
                window.history.back();
                return;
            }
        } catch (err) {
            console.warn('referrer parse failed', err);
        }
    }
    const target = readBackTarget();
    if (target && isSameOriginUrl(target.url)) {
        window.location.href = target.url;
        return;
    }
    if (window.history.length > 1) {
        window.history.back();
        return;
    }
    window.location.href = fallbackUrl;
}
const productsData = [
    { id: 1, sku: "PAI-001", name: "All Over/Work Paithani", price: 95000, img: "images/All_Over_Work_Paithani.jpg", category: "Pure Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 2, sku: "PAI-002", name: "Half Border Paithani", price: 40000, img: "images/Half_Border_Paithani.jpg", category: "Pure Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 3, sku: "PAI-003", name: "Lotus Broket Paithani", price: 60000, img: "images/Lotus_Broket_Paithani.jpg", category: "Pure Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 4, sku: "PAI-004", name: "More Popat Broket Paithani", price: 40000, img: "images/More_Popat_Broket_Paithani.jpg", category: "Pure Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 5, sku: "PAI-005", name: "Single Muniya Paithani", price: 30000, img: "images/Single_Muniya_Paithani.jpg", category: "Pure Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 6, sku: "PAI-006", name: "Rudra Broket Paithani", price: 90000, img: "images/Rudra_Broket_Paithani.jpg", category: "Pure Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 7, sku: "PAI-007", name: "Nandini Broket Paithani", price: 100000, img: "images/Nandini_Broket_Paithani.jpg", category: "Pure Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 8, sku: "PAI-008", name: "Lili Floral Paithani", price: 75000, img: "images/Lili_Floral_Paithani.jpg", category: "Pure Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 9, sku: "PAI-009", name: "All Over Butta with Gonda Pallu Paithani", price: 18000, img: "images/All_Over_Butta_with_Gonda_Pallu_Paithani.jpg", category: "Semi Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 10, sku: "PAI-010", name: "Floral Zari Semi Paithani", price: 19500, img: "images/Floral_Zari_Semi_Paithani.jpg", category: "Semi Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 11, sku: "PAI-011", name: "Peacock Motif Semi Paithani", price: 21000, img: "images/Peacock_Motif_Semi_Paithani.jpg", category: "Semi Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 12, sku: "PAI-012", name: "Classic Muniya Semi Paithani", price: 20000, img: "images/Classic_Muniya_Semi_Paithani.jpg", category: "Semi Silk Paithani", stock: 12, lowStockThreshold: 3 },
    { id: 13, sku: "PAI-013", name: "Paithani Dupatta", price: 18500, img: "images/Paithani_Dupatta.jpg", category: "Paithani Accessories", stock: 12, lowStockThreshold: 3 },
    { id: 14, sku: "PAI-014", name: "Paithani Jacket", price: 14500, img: "images/Paithani_Jacket.jpg", category: "Paithani Accessories", stock: 12, lowStockThreshold: 3 },
    { id: 15, sku: "PAI-015", name: "Paithani Cap", price: 6200, img: "images/Paithani_Cap.jpg", category: "Paithani Accessories", stock: 12, lowStockThreshold: 3 },
    { id: 16, sku: "PAI-016", name: "Paithani Blouse piece", price: 12500, img: "images/Paithani_Blouse_piece.jpg", category: "Paithani Accessories", stock: 12, lowStockThreshold: 3 }
];

const FEATURED_ORDER_MAP = new Map();
productsData.forEach((item, index) => {
    const keys = [
        item.sku ? String(item.sku).toLowerCase() : '',
        item.id !== undefined && item.id !== null ? String(item.id).toLowerCase() : '',
        item.name ? String(item.name).toLowerCase() : ''
    ].filter(Boolean);
    keys.forEach(key => {
        if (!FEATURED_ORDER_MAP.has(key)) {
            FEATURED_ORDER_MAP.set(key, index);
        }
    });
});

function getProductKey(product) {
    if (!product) return '';
    const skuKey = product?.sku ? String(product.sku).toLowerCase() : '';
    const idKey = product?._id !== undefined && product?._id !== null
        ? String(product._id).toLowerCase()
        : (product?.id !== undefined && product?.id !== null ? String(product.id).toLowerCase() : '');
    const nameKey = product?.name ? String(product.name).toLowerCase() : '';
    return skuKey || idKey || nameKey;
}

function mergeCatalogs(primaryList = [], fallbackList = []) {
    const merged = [];
    const seen = new Set();
    const addList = (list) => {
        (Array.isArray(list) ? list : []).forEach(item => {
            const key = getProductKey(item);
            if (!key || seen.has(key)) return;
            seen.add(key);
            merged.push(item);
        });
    };
    addList(primaryList);
    addList(fallbackList);
    return merged;
}

// Catalog state (used by search/filter UI on products.html)
let allProducts = [];
let currentFilters = {
    search: '',
    category: 'all',
    family: 'all',
    sort: 'relevance'
};

let currentProduct = null;
let currentBasePrice = 0;

const sareeCustomizationOptions = [
    { id: 'custom-fall-pico', label: 'Fall & Pico', price: 300 , stock: 12, lowStockThreshold: 3 },
    { id: 'custom-tassels', label: 'Tassels', price: 250 , stock: 12, lowStockThreshold: 3 },
    { id: 'custom-blouse', label: 'Blouse Stitching', price: 700 , stock: 12, lowStockThreshold: 3 },
    { id: 'custom-gift-wrap', label: 'Gift Wrap', price: 150 , stock: 12, lowStockThreshold: 3 },
    { id: 'custom-express', label: 'Express Delivery', price: 500 }
];
const accessoryCustomizationOptions = [
    { id: 'custom-gift-wrap', label: 'Gift Wrap', price: 150 , stock: 12, lowStockThreshold: 3 },
    { id: 'custom-express', label: 'Express Delivery', price: 500 }
];
const allCustomizationOptions = [
    ...sareeCustomizationOptions,
    ...accessoryCustomizationOptions
];
let activeCustomizationOptions = sareeCustomizationOptions;

function formatPrice(value) {
    const numberValue = Number(value) || 0;
    return `₹${numberValue.toLocaleString('en-IN')}`;
}

const SETTINGS_KEY = 'admin_settings';

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

function getSaleSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        const data = raw ? JSON.parse(raw) : {};
        return {
            active: !!data.saleActive,
            label: data.saleLabel || '',
            type: data.saleType || 'none',
            value: Number(data.saleValue) || 0
        };
    } catch (err) {
        return { active: false, label: '', type: 'none', value: 0 };
    }
}

function getEffectivePrice(product) {
    const base = Number(product?.price) || 0;
    const productType = (product?.discountType || 'none').toLowerCase();
    const productValue = Number(product?.discountValue) || 0;
    const sale = getSaleSettings();

    let type = productType;
    let value = productValue;
    let label = '';

    if ((type === 'none' || value <= 0) && sale.active && sale.type !== 'none' && sale.value > 0) {
        type = sale.type;
        value = sale.value;
        label = sale.label || 'Festival Offer';
    }

    const finalPrice = applyDiscount(base, type, value);
    const hasDiscount = finalPrice < base;
    return { base, final: finalPrice, hasDiscount, label, type, value };
}

function resolveProductImage(product) {
    const raw = product?.image || product?.imageUrl || product?.img || '';
    if (!raw) return 'images/logo.png';
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('/')) return raw;
    if (raw.startsWith('images/')) return raw;
    return `images/${raw}`;
}

function getPriceMarkup(priceInfo) {
    if (!priceInfo || !priceInfo.hasDiscount) {
        return `<p class="price-row">${formatPrice(priceInfo?.final ?? 0)}</p>`;
    }
    const badgeText = priceInfo.label || (priceInfo.type === 'percent' ? `${priceInfo.value}% OFF` : 'SALE');
    return `
        <p class="price-row">
            <span class="price-current">${formatPrice(priceInfo.final)}</span>
            <span class="price-original">${formatPrice(priceInfo.base)}</span>
            <span class="price-badge">${badgeText}</span>
        </p>
    `;
}

function renderSaleBanner() {
    const path = window.location.pathname.toLowerCase();
    const isAdmin = document.body.classList.contains('admin-body') || path.includes('admin-');
    if (isAdmin) return;
    const sale = getSaleSettings();
    if (!sale.active) return;
    const header = document.querySelector('header');
    if (!header || document.getElementById('sale-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'sale-banner';
    banner.className = 'sale-banner';
    const discountText = (sale.type !== 'none' && sale.value > 0)
        ? (sale.type === 'percent' ? `${sale.value}% OFF` : `Rs ${sale.value} OFF`)
        : '';
    const label = sale.label || 'Festive Offer';
    banner.textContent = discountText ? `${label} • ${discountText}` : label;
    const headerMain = header.querySelector('.header-main');
    if (headerMain) {
        header.insertBefore(banner, headerMain);
    } else {
        header.appendChild(banner);
    }
}

function getStockStatus(product) {
    const status = String(product?.status || '').toLowerCase().trim();
    const category = String(product?.category || '').toLowerCase();
    const isPureSilk = category.includes('pure silk');
    if (status === 'preorder' || (isPureSilk && (!status || status === 'available' || status === 'new'))) {
        return { stock: null, threshold: 0, label: 'Preorder', className: 'stock-preorder', isOut: false, isLow: false, isPreorder: true };
    }
    if (status === 'soldout') {
        return { stock: 0, threshold: 0, label: 'Sold out', className: 'stock-out', isOut: true, isLow: false, isPreorder: false };
    }
    const stock = Number(product?.stock);
    const threshold = Number(product?.lowStockThreshold) || 0;
    if (!Number.isFinite(stock)) {
        return { stock: null, threshold, label: 'Inventory unavailable', className: 'stock-unknown', isOut: true, isLow: false, isPreorder: false };
    }
    if (stock <= 0) {
        return { stock, threshold, label: 'Out of stock', className: 'stock-out', isOut: true, isLow: false, isPreorder: false };
    }
    if (stock <= threshold) {
        return { stock, threshold, label: `Only ${stock} left`, className: 'stock-low', isOut: false, isLow: true, isPreorder: false };
    }
    return { stock, threshold, label: 'In stock', className: 'stock-in', isOut: false, isLow: false, isPreorder: false };
}
const CART_KEY_BASE = 'paithani_cart';
const CART_ID_KEY_BASE = 'paithani_cart_id';
const CART_OWNER_KEY = 'cart_owner';
const WISHLIST_KEY_BASE = 'paithani_wishlist';
const WISHLIST_OWNER_KEY = 'wishlist_owner';
const PRODUCTS_CACHE_KEY = 'store_products_cache';

let wishlistIds = new Set();

const normalizeWishlistEmail = (value) => String(value || '').trim().toLowerCase();

function getWishlistProfileEmail() {
    try {
        const raw = localStorage.getItem('authUser');
        if (raw) {
            const parsed = JSON.parse(raw);
            const email = normalizeWishlistEmail(parsed?.email || '');
            if (email) return email;
        }
    } catch (err) {
        // ignore
    }
    return normalizeWishlistEmail(localStorage.getItem('authEmail') || '');
}

function getWishlistStorageKey() {
    const email = getWishlistProfileEmail();
    if (!email) return WISHLIST_KEY_BASE;
    return `profile:${email}:wishlist`;
}

function getCartProfileEmail() {
    return getWishlistProfileEmail();
}

function getCartStorageKey() {
    const email = getCartProfileEmail();
    if (!email) return CART_KEY_BASE;
    return `profile:${email}:cart`;
}

function getCartIdStorageKey() {
    const email = getCartProfileEmail();
    if (!email) return CART_ID_KEY_BASE;
    return `profile:${email}:cart_id`;
}

function loadWishlist() {
    const email = getWishlistProfileEmail();
    const key = getWishlistStorageKey();
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('wishlist parse error', err);
    }

    if (email) {
        return [];
    }

    try {
        const raw = localStorage.getItem(WISHLIST_KEY_BASE);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('wishlist parse error', err);
        return [];
    }
}

function saveWishlist(list) {
    const email = getWishlistProfileEmail();
    const key = getWishlistStorageKey();
    localStorage.setItem(key, JSON.stringify(list));
    if (!email) {
        localStorage.setItem(WISHLIST_KEY_BASE, JSON.stringify(list));
    }
    wishlistIds = new Set(list.map(item => String(item.id || item._id)));
    updateWishlistButtons();
    renderWishlistSection();
}


function cacheProducts(list) {
    try {
        localStorage.setItem(PRODUCTS_CACHE_KEY, JSON.stringify(Array.isArray(list) ? list : []));
    } catch (err) {
        console.warn('product cache error', err);
    }
}

function readCachedProducts() {
    try {
        const raw = localStorage.getItem(PRODUCTS_CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('product cache read error', err);
        return [];
    }
}

function getCartId() {
    const key = getCartIdStorageKey();
    let cartId = localStorage.getItem(key);
    if (!cartId) {
        cartId = 'cart_' + Date.now() + '_' + Math.random().toString(16).slice(2, 8);
        localStorage.setItem(key, cartId);
    }
    return cartId;
}

let renderedProductsById = new Map();

function loadCart() {
    const email = getCartProfileEmail();
    const key = getCartStorageKey();
    try {
        const raw = localStorage.getItem(key);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error('cart parse error', err);
    }

    if (email) {
        return [];
    }

    try {
        const raw = localStorage.getItem(CART_KEY_BASE);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.error('cart parse error', err);
        return [];
    }
}

function saveCart(cart) {
    const email = getCartProfileEmail();
    const key = getCartStorageKey();
    localStorage.setItem(key, JSON.stringify(cart));
    if (!email) {
        localStorage.setItem(CART_KEY_BASE, JSON.stringify(cart));
    } else {
        localStorage.setItem(CART_OWNER_KEY, email);
    }

    updateCartBadge();
    syncCartToBackend(cart);
}

async function syncCartToBackend(cart) {
    try {
        await fetch(API_BASE_URL + '/cart/' + encodeURIComponent(getCartId()), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: cart })
        });
    } catch (err) {
        console.error('cart sync error', err);
    }
}

async function loadCartFromBackend() {
    if (!window.location.pathname.includes('cart.html')) return;
    try {
        const res = await fetch(API_BASE_URL + '/cart/' + encodeURIComponent(getCartId()));
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.items)) {
            localStorage.setItem(getCartStorageKey(), JSON.stringify(data.items));
        }
    } catch (err) {
        console.error('cart load error', err);
    }
}

function normalizeProduct(product) {
    if (!product) return null;
    const id = product.id || product._id;
    const sku = product.sku || '';
    const priceInfo = getEffectivePrice(product);
    return {
        id: id ? String(id) : '',
        sku: sku ? String(sku) : '',
        name: product.name || 'Product',
        price: priceInfo.final,
        image: resolveProductImage(product)
    };
}
function buildCartKey(product, options) {
    const custom = (options.customizations || []).join('|');
    const notes = options.notes || '';
    const base = product.id || '';
    return `${base}::${custom}::${notes}`;
}

function addToCart(product, options = {}) {
    const normalized = normalizeProduct(product);
    if (!normalized || !normalized.id) return;

    const cart = enrichCartItems(loadCart());
    const customizations = options.customizations || [];
    const notes = options.notes || '';
    const addonsTotal = Number(options.addonsTotal) || 0;
    const basePrice = Number(options.basePrice) || normalized.price;
    const unitPrice = Number(options.unitPrice) || (basePrice + addonsTotal);
    const key = buildCartKey(normalized, { customizations, notes });

    const existing = cart.find(item => item.key === key);
    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({
            key,
            id: normalized.id,
            sku: normalized.sku || '',
            name: normalized.name,
            image: normalized.image,
            qty: 1,
            basePrice,
            addonsTotal,
            unitPrice,
            customizations,
            notes
        });
    }

    saveCart(cart);
}

function updateCartBadge() {
    const cart = enrichCartItems(loadCart());
    const count = cart.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    document.querySelectorAll('[data-cart-count]').forEach(el => {
        el.textContent = count;
    });
}

function normalizeLocationValue(value) {
    return String(value || '').trim().toLowerCase();
}

function resolveShippingCharge({ city, state, address } = {}) {
    const cityValue = normalizeLocationValue(city);
    const stateValue = normalizeLocationValue(state);
    const addressValue = normalizeLocationValue(address);
    const combined = `${cityValue} ${stateValue} ${addressValue}`.trim();
    if (!combined) return null;
    if (combined.includes('nashik')) {
        return { amount: SHIPPING_RATE_NASHIK, label: `₹${SHIPPING_RATE_NASHIK} (Nashik)` };
    }
    if (stateValue.includes('maharashtra') || combined.includes('maharashtra')) {
        return { amount: SHIPPING_RATE_MAHARASHTRA, label: `₹${SHIPPING_RATE_MAHARASHTRA} (Maharashtra)` };
    }
    return { amount: SHIPPING_RATE_REST, label: `₹${SHIPPING_RATE_REST} (Other states)` };
}

function calculateCartTotals(cart, location) {
    const subtotal = cart.reduce((sum, item) => sum + (Number(item.unitPrice) || 0) * (Number(item.qty) || 0), 0);
    const count = cart.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    const shippingInfo = resolveShippingCharge(location);
    const shipping = shippingInfo ? shippingInfo.amount : 0;
    const tax = Math.round(subtotal * CHECKOUT_TAX_RATE);
    const total = Math.round(subtotal + shipping + tax);
    return { subtotal, shipping, tax, total, count, shippingInfo };
}


function updateWishlistButtons() {
    document.querySelectorAll('.wishlist-btn').forEach(btn => {
        const id = btn.dataset.productId;
        if (!id) return;
        const active = wishlistIds.has(String(id));
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
        btn.setAttribute('aria-label', active ? 'Remove from wishlist' : 'Add to wishlist');
    });
}

function getProductById(productId) {
    const id = String(productId);
    if (renderedProductsById.has(id)) return renderedProductsById.get(id);
    const fromAll = (allProducts || []).find(item => String(item._id || item.id) === id);
    if (fromAll) return fromAll;
    return productsData.find(item => String(item.id) === id);
}

function toggleWishlist(productId) {
    const list = loadWishlist();
    const id = String(productId);
    const existingIndex = list.findIndex(item => String(item.id || item._id) === id);
    if (existingIndex >= 0) {
        list.splice(existingIndex, 1);
        saveWishlist(list);
        return;
    }
    const product = getProductById(id);
    if (!product) return;
    const priceInfo = getEffectivePrice(product);
    list.unshift({
        id,
        name: product.name || 'Product',
        image: resolveProductImage(product),
        price: priceInfo.final
    });
    saveWishlist(list);
}

function renderWishlistSection() {
    const listEl = document.getElementById('wishlist-list');
    const countEl = document.getElementById('wishlist-count');
    if (!listEl && !countEl) return;
    const list = loadWishlist();
    if (countEl) countEl.textContent = String(list.length || 0);
    if (!listEl) return;
    if (!list.length) {
        listEl.innerHTML = '<p class="muted">No wishlist items yet.</p>';
        return;
    }
    listEl.innerHTML = list.map(item => `
        <div class="wishlist-item">
            <img src="${item.image}" alt="${item.name}">
            <div class="wishlist-info">
                <strong>${item.name}</strong>
                <span>${formatPrice(item.price)}</span>
            </div>
            <button class="wishlist-remove" data-id="${item.id}" data-wishlist-id="${item.id}">Remove</button>
        </div>
    `).join('');

    if (!listEl.dataset.bound) {
        listEl.addEventListener('click', (event) => {
            const button = event.target.closest('button[data-id], button[data-wishlist-id]');
            if (!button) return;
            const id = button.dataset.id || button.dataset.wishlistId;
            if (!id) return;
            toggleWishlist(id);
        });
        listEl.dataset.bound = '1';
    }
}

function updateCartItemQty(key, delta) {
    const cart = enrichCartItems(loadCart());
    const item = cart.find(entry => entry.key === key);
    if (!item) return;
    item.qty += delta;
    if (item.qty <= 0) {
        const index = cart.findIndex(entry => entry.key === key);
        if (index >= 0) cart.splice(index, 1);
    }
    saveCart(cart);
    renderCartPage();
}

function removeCartItem(key) {
    const cart = loadCart().filter(item => item.key !== key);
    saveCart(cart);
    renderCartPage();
}

function initCheckout() {
    if (!window.location.pathname.includes('cart.html')) return;

    const form = document.getElementById('checkout-form');
    const messageEl = document.getElementById('checkout-message');
    const helperEl = document.getElementById('payment-helper');
    if (!form) return;
    const nameEl = document.getElementById('checkout-name');
    const emailEl = document.getElementById('checkout-email');
    const phoneEl = document.getElementById('checkout-phone');
    const addressLineEl = document.getElementById('checkout-address-line');
    const cityEl = document.getElementById('checkout-city');
    const stateEl = document.getElementById('checkout-state');
    const pincodeEl = document.getElementById('checkout-pincode');

    const getPaymentMethod = () => {
        const selected = form.querySelector('input[name="payment-method"]:checked');
        return selected ? selected.value : 'razorpay';
    };

    const toggleButton = (disabled, label = '') => {
        const btn = form.querySelector('button[type="submit"]');
        if (!btn) return;
        if (!btn.dataset.originalText) btn.dataset.originalText = btn.textContent;
        btn.disabled = disabled;
        btn.textContent = disabled ? (label || 'Processing...') : btn.dataset.originalText;
    };

    const setBaseButtonLabel = (label) => {
        const btn = form.querySelector('button[type="submit"]');
        if (!btn) return;
        btn.dataset.originalText = label;
        if (!btn.disabled) btn.textContent = label;
    };

    const syncButtonLabel = () => {
        const method = getPaymentMethod();
        setBaseButtonLabel(method === 'cod' ? 'Place Order' : 'Pay Securely');
    };

    const token = localStorage.getItem('authToken') || '';
    const buildHeaders = () => {
        const headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = `Bearer ${token}`;
        return headers;
    };

    const parseAddressLine = (raw) => {
        const cleaned = String(raw || '')
            .replace(/\s*\n\s*/g, ', ')
            .replace(/\s+/g, ' ')
            .trim();
        if (!cleaned) return { line: '' };
        const parts = cleaned.split(',').map(part => part.trim()).filter(Boolean);
        if (parts.length < 2) {
            return { line: cleaned, city: '', state: '', zip: '' };
        }
        const last = parts[parts.length - 1];
        const zipMatch = last.match(/(\d{6})/);
        const zip = zipMatch ? zipMatch[1] : '';
        const state = zipMatch ? last.replace(zipMatch[1], '').trim() : last;
        const city = parts[parts.length - 2] || '';
        const line = parts.slice(0, -2).join(', ') || parts[0];
        return { line: line || cleaned, city, state, zip };
    };

    const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

    const buildAddressString = ({ line, city, state, pincode }) => {
        const parts = [line, city, state].map(part => String(part || '').trim()).filter(Boolean);
        const zip = String(pincode || '').trim();
        const main = parts.join(', ');
        if (zip) {
            return `${main}${main ? ' ' : ''}${zip}`.trim();
        }
        return main;
    };

    const storeOrderConfirmation = (payload) => {
        if (!payload) return;
        try {
            sessionStorage.setItem(ORDER_CONFIRMATION_KEY, JSON.stringify(payload));
        } catch (err) {
            // ignore storage errors
        }
    };

    const buildOrderConfirmationPayload = ({ orderId, paymentStatus, totals, customer, cart }) => {
        const safeTotals = totals || calculateCartTotals(cart || [], {
            city: customer?.city || '',
            state: customer?.state || '',
            address: customer?.address || ''
        });
        return {
            orderId: orderId || '',
            paymentStatus: paymentStatus || 'pending',
            totals: {
                subtotal: Number(safeTotals.subtotal) || 0,
                shipping: Number(safeTotals.shipping) || 0,
                tax: Number(safeTotals.tax) || 0,
                total: Number(safeTotals.total) || 0
            },
            customer: {
                name: customer?.name || '',
                email: customer?.email || '',
                phone: customer?.phone || '',
                address: customer?.address || ''
            },
            items: (cart || []).map(item => ({
                name: item.name || 'Item',
                qty: Number(item.qty) || 1,
                unitPrice: Number(item.unitPrice) || 0,
                image: item.image || ''
            })),
            placedAt: new Date().toISOString()
        };
    };

    const saveAddressToProfile = (email, rawAddress) => {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !rawAddress) return;
        const key = `profile:${normalizedEmail}:addresses`;
        const defaultKey = `profile:${normalizedEmail}:defaultAddress`;
        let list = [];
        try {
            const stored = localStorage.getItem(key);
            list = stored ? JSON.parse(stored) : [];
        } catch (err) {
            list = [];
        }
        if (!Array.isArray(list)) list = [];
        const parsed = parseAddressLine(rawAddress);
        const line = (parsed.line || rawAddress).trim();
        const exists = list.find(addr => String(addr.line || '').trim() === line);
        if (!exists) {
            const newAddress = {
                id: `addr_${Date.now()}`,
                label: 'Delivery Address',
                line,
                city: parsed.city || '',
                state: parsed.state || '',
                zip: parsed.zip || ''
            };
            list = [newAddress, ...list];
        }
        localStorage.setItem(key, JSON.stringify(list));
        if (!localStorage.getItem(defaultKey) && list[0]?.id) {
            localStorage.setItem(defaultKey, list[0].id);
        }
    };

    const saveLocalOrder = (email, cart, status = 'placed', location = {}) => {
        const normalizedEmail = normalizeEmail(email);
        if (!normalizedEmail || !cart || !cart.length) return;
        const key = `profile:${normalizedEmail}:orders`;
        let list = [];
        try {
            const raw = localStorage.getItem(key);
            list = raw ? JSON.parse(raw) : [];
        } catch (err) {
            list = [];
        }
        if (!Array.isArray(list)) list = [];
        const totals = calculateCartTotals(cart, location);
        const order = {
            _id: `local_${Date.now()}`,
            createdAt: new Date().toISOString(),
            status,
            subtotalAmount: totals.subtotal,
            shippingAmount: totals.shipping,
            taxAmount: totals.tax,
            totalAmount: totals.total,
            items: cart.map(item => ({
                name: item.name,
                qty: item.qty || 1
            }))
        };
        list.unshift(order);
        localStorage.setItem(key, JSON.stringify(list.slice(0, 25)));
    };

    const placeOrder = async (cart, customer, payment) => {
        const res = await fetch(API_BASE_URL + '/checkout', {
            method: 'POST',
            headers: buildHeaders(),
            body: JSON.stringify({
                cartId: getCartId(),
                customer,
                items: cart,
                payment
            })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data.error || 'Unable to place order.');
        }
        return data;
    };

    form.querySelectorAll('input[name="payment-method"]').forEach(input => {
        input.addEventListener('change', () => {
            syncButtonLabel();
            if (helperEl) helperEl.textContent = '';
        });
    });
    syncButtonLabel();

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        setFormMessage(messageEl, '');
        toggleButton(true, 'Processing...');

        const name = nameEl?.value?.trim();
        const email = emailEl?.value?.trim();
        const phone = phoneEl?.value?.trim();
        const addressLine = addressLineEl?.value?.trim();
        const city = cityEl?.value?.trim();
        const state = stateEl?.value?.trim();
        const pincode = pincodeEl?.value?.trim();
        const pincodeOk = /^\d{6}$/.test(pincode || '');
        const address = buildAddressString({ line: addressLine, city, state, pincode });

        if (!name || !email || !phone || !addressLine || !city || !state || !pincode) {
            setFormMessage(messageEl, 'Please fill in all checkout details.');
            toggleButton(false);
            return;
        }
        if (!pincodeOk) {
            setFormMessage(messageEl, 'Please enter a valid 6-digit pincode.');
            toggleButton(false);
            return;
        }

        const cart = enrichCartItems(loadCart());
        if (!cart.length) {
            setFormMessage(messageEl, 'Your cart is empty.');
            toggleButton(false);
            return;
        }

        const method = getPaymentMethod();
        const customer = { name, email, phone, address, city, state, pincode };
        if (email) {
            localStorage.setItem('paithani_last_email', email.toLowerCase());
        }

        if (method === 'cod') {
            try {
                const orderResponse = await placeOrder(cart, customer, { provider: 'cod', status: 'pending' });
                const totals = orderResponse?.totals || calculateCartTotals(cart);
                const confirmation = buildOrderConfirmationPayload({
                    orderId: orderResponse?.orderId,
                    paymentStatus: orderResponse?.paymentStatus,
                    totals,
                    customer,
                    cart
                });
                storeOrderConfirmation(confirmation);
                saveCart([]);
                renderCartPage();
                saveAddressToProfile(email, address);
                saveLocalOrder(email, cart, 'pending', { city, state, address });
                form.reset();
                toggleButton(false);
                window.location.href = `order-confirmation.html?orderId=${encodeURIComponent(confirmation.orderId || '')}`;
            } catch (err) {
                console.error('cod checkout error', err);
                setFormMessage(messageEl, err.message || 'Unable to place order right now.');
                toggleButton(false);
            }
            return;
        }

        if (typeof Razorpay === 'undefined') {
            setFormMessage(messageEl, 'Payment popup could not load. Please check your connection and try again.');
            toggleButton(false);
            return;
        }

        try {
            toggleButton(true, 'Starting payment...');
            const startPaymentRes = await fetch(API_BASE_URL + '/payments/create-order', {
                method: 'POST',
                headers: buildHeaders(),
                body: JSON.stringify({
                    cartId: getCartId(),
                    customer,
                    items: cart
                })
            });
            const paymentData = await startPaymentRes.json().catch(() => ({}));
            if (!startPaymentRes.ok) {
                const message = paymentData.error || 'Unable to start payment. Please try again.';
                const detail = paymentData.details ? ` (${paymentData.details})` : '';
                setFormMessage(messageEl, `${message}${detail}`);
                if (startPaymentRes.status === 503 && helperEl) {
                    helperEl.textContent = 'Online payments are not configured. Choose Pay on Delivery to complete this order.';
                    const codOption = form.querySelector('input[name="payment-method"][value="cod"]');
                    if (codOption) {
                        codOption.checked = true;
                        syncButtonLabel();
                    }
                }
                toggleButton(false);
                return;
            }

            const options = {
                key: paymentData.keyId,
                amount: paymentData.amount,
                currency: paymentData.currency || 'INR',
                name: 'Rudra Paithani Yeola',
                description: 'Secure payment',
                order_id: paymentData.orderId,
                prefill: { name, email, contact: phone },
                notes: { cartId: getCartId(), customerAddress: address },
                theme: { color: '#c5a059' },
                modal: { ondismiss: () => toggleButton(false) },
                handler: async function (response) {
                    setFormMessage(messageEl, 'Verifying payment...');
                    try {
                        const res = await fetch(API_BASE_URL + '/checkout', {
                            method: 'POST',
                            headers: buildHeaders(),
                            body: JSON.stringify({
                                cartId: getCartId(),
                                customer,
                                items: cart,
                                payment: {
                                    provider: 'razorpay',
                                    orderId: response.razorpay_order_id,
                                    paymentId: response.razorpay_payment_id,
                                    signature: response.razorpay_signature,
                                    receipt: paymentData.receipt
                                }
                            })
                        });
                        const data = await res.json().catch(() => ({}));
                        if (!res.ok) {
                            setFormMessage(messageEl, data.error || 'Payment verification failed.');
                            toggleButton(false);
                            return;
                        }
                        const totals = data?.totals || paymentData?.totals || calculateCartTotals(cart);
                        const confirmation = buildOrderConfirmationPayload({
                            orderId: data?.orderId,
                            paymentStatus: data?.paymentStatus,
                            totals,
                            customer,
                            cart
                        });
                        storeOrderConfirmation(confirmation);
                        saveCart([]);
                        renderCartPage();
                        saveAddressToProfile(email, address);
                        saveLocalOrder(email, cart, 'placed', { city, state, address });
                        form.reset();
                        toggleButton(false);
                        window.location.href = `order-confirmation.html?orderId=${encodeURIComponent(confirmation.orderId || '')}`;
                    } catch (err) {
                        console.error('checkout error', err);
                        setFormMessage(messageEl, 'Payment captured, but we could not place the order automatically. Please contact support with your payment id.');
                        toggleButton(false);
                    }
                }
            };

            const rzp = new Razorpay(options);
            rzp.on('payment.failed', function (resp) {
                console.error('razorpay payment failed', resp.error);
                setFormMessage(messageEl, resp?.error?.description || 'Payment was not completed.');
                toggleButton(false);
            });
            rzp.open();
        } catch (err) {
            console.error('checkout error', err);
            setFormMessage(messageEl, 'Unable to place order right now.');
            toggleButton(false);
        }
    });
}
// Ensure cart items have correct details (name, price, image) even if backend/local data is partial
function enrichCartItems(cart) {
    const catalog = (Array.isArray(allProducts) && allProducts.length) ? allProducts : productsData;
    return cart.map(item => {
        const product = catalog.find(p => {
            const productId = String(p._id || p.id || '');
            const productSku = String(p.sku || '');
            const itemId = String(item.id || '');
            const itemSku = String(item.sku || '');
            return (productId && itemId && productId === itemId) || (productSku && itemSku && productSku === itemSku);
        });
        if (!product) return item;
        const fallbackImage = resolveProductImage(product);
        const safeImage = item.image && !/undefined|null/.test(item.image) ? item.image : fallbackImage;
        const basePrice = item.basePrice && Number(item.basePrice) > 0 ? Number(item.basePrice) : Number(product.price) || 0;
        const unitPrice = item.unitPrice && Number(item.unitPrice) > 0 ? Number(item.unitPrice) : basePrice + (Number(item.addonsTotal) || 0);
        return {
            ...item,
            sku: item.sku || product.sku || '',
            name: item.name || product.name || 'Product',
            image: safeImage,
            basePrice,
            unitPrice
        };
    });
}

function getCheckoutLocationFromForm() {
    const addressLineEl = document.getElementById('checkout-address-line');
    const cityEl = document.getElementById('checkout-city');
    const stateEl = document.getElementById('checkout-state');
    return {
        address: addressLineEl?.value || '',
        city: cityEl?.value || '',
        state: stateEl?.value || ''
    };
}

function renderCartPage() {
    if (!window.location.pathname.includes('cart.html')) return;

    const container = document.getElementById('cart-items');
    const countEl = document.getElementById('cart-count');
    const totalEl = document.getElementById('cart-total');
    const subtotalEl = document.getElementById('cart-subtotal');
    const shippingEl = document.getElementById('cart-shipping');
    const taxEl = document.getElementById('cart-tax');
    const checkoutSubtotalEl = document.getElementById('checkout-subtotal');
    const checkoutShippingEl = document.getElementById('checkout-shipping');
    const checkoutTaxEl = document.getElementById('checkout-tax');
    const checkoutTotalEl = document.getElementById('checkout-total');
    if (!container) return;

    const rawCart = enrichCartItems(loadCart());
    const cart = sanitizeCartItems(rawCart);
    const needsSkuSync = cart.some((item, idx) => item.sku && (!rawCart[idx] || rawCart[idx].sku !== item.sku));
    if (cart.length !== rawCart.length || needsSkuSync) {
        saveCart(cart);
    }
    if (!cart.length) {
        container.innerHTML = '<div class="cart-empty">Your cart is empty. <a href="products.html">Shop the collection</a>.</div>';
        if (countEl) countEl.textContent = '0';
        if (subtotalEl) subtotalEl.textContent = formatPrice(0);
        if (shippingEl) shippingEl.textContent = formatPrice(0);
        if (taxEl) taxEl.textContent = formatPrice(0);
        if (totalEl) totalEl.textContent = formatPrice(0);
        if (checkoutSubtotalEl) checkoutSubtotalEl.textContent = formatPrice(0);
        if (checkoutShippingEl) checkoutShippingEl.textContent = formatPrice(0);
        if (checkoutTaxEl) checkoutTaxEl.textContent = formatPrice(0);
        if (checkoutTotalEl) checkoutTotalEl.textContent = formatPrice(0);
        return;
    }

    container.innerHTML = cart.map(item => {
        const customText = item.customizations && item.customizations.length ? item.customizations.join(', ') : 'No customizations';
        const notesText = item.notes ? `Notes: ${item.notes}` : '';
        const lineTotal = (Number(item.unitPrice) || 0) * (Number(item.qty) || 0);
        return `
            <div class="cart-item">
                <img src="${item.image}" alt="${item.name}">
                <div class="cart-item-info">
                    <h4>${item.name}</h4>
                    <p class="cart-item-meta">Customizations: ${customText}</p>
                    ${notesText ? `<p class="cart-item-meta">${notesText}</p>` : ''}
                    <div class="cart-qty">
                        <button class="qty-btn" data-action="decrease" data-key="${encodeURIComponent(item.key)}">-</button>
                        <span>${item.qty}</span>
                        <button class="qty-btn" data-action="increase" data-key="${encodeURIComponent(item.key)}">+</button>
                        <button class="remove-btn" data-action="remove" data-key="${encodeURIComponent(item.key)}">Remove</button>
                    </div>
                </div>
                <div class="cart-item-price">
                    <span>Unit: ${formatPrice(item.unitPrice)}</span>
                    <strong>${formatPrice(lineTotal)}</strong>
                </div>
            </div>
        `;
    }).join('');

    const location = getCheckoutLocationFromForm();
    const totals = calculateCartTotals(cart, location);
    if (countEl) countEl.textContent = totals.count;
    if (subtotalEl) subtotalEl.textContent = formatPrice(totals.subtotal);
    if (shippingEl) shippingEl.textContent = totals.shippingInfo ? formatPrice(totals.shipping) : 'Enter city/state';
    if (taxEl) taxEl.textContent = formatPrice(totals.tax);
    if (totalEl) totalEl.textContent = formatPrice(totals.total);
    if (checkoutSubtotalEl) checkoutSubtotalEl.textContent = formatPrice(totals.subtotal);
    if (checkoutShippingEl) checkoutShippingEl.textContent = totals.shippingInfo ? formatPrice(totals.shipping) : 'Enter city/state';
    if (checkoutTaxEl) checkoutTaxEl.textContent = formatPrice(totals.tax);
    if (checkoutTotalEl) checkoutTotalEl.textContent = formatPrice(totals.total);

    if (!container.dataset.bound) {
        container.addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (!button) return;
            const key = button.dataset.key ? decodeURIComponent(button.dataset.key) : '';
            const action = button.dataset.action;
            if (!key || !action) return;
            if (action === 'increase') updateCartItemQty(key, 1);
            if (action === 'decrease') updateCartItemQty(key, -1);
            if (action === 'remove') removeCartItem(key);
        });
        container.dataset.bound = '1';
    }

    const checkoutForm = document.getElementById('checkout-form');
    if (checkoutForm && !checkoutForm.dataset.bound) {
        const inputs = checkoutForm.querySelectorAll('#checkout-address-line, #checkout-city, #checkout-state');
        inputs.forEach(input => {
            input.addEventListener('input', () => renderCartPage());
            input.addEventListener('change', () => renderCartPage());
        });
        checkoutForm.dataset.bound = '1';
    }
}

function initOrderConfirmationPage() {
    if (!window.location.pathname.includes('order-confirmation.html')) return;
    const content = document.getElementById('order-confirmation-content');
    const emptyState = document.getElementById('order-confirmation-empty');
    const params = new URLSearchParams(window.location.search);
    const orderIdParam = params.get('orderId') || '';
    let data = null;
    try {
        const raw = sessionStorage.getItem(ORDER_CONFIRMATION_KEY);
        if (raw) data = JSON.parse(raw);
    } catch (err) {
        data = null;
    }
    if (!data || (orderIdParam && data.orderId && data.orderId !== orderIdParam)) {
        if (content) content.classList.add('is-hidden');
        if (emptyState) emptyState.classList.remove('is-hidden');
        return;
    }
    if (emptyState) emptyState.classList.add('is-hidden');
    if (content) content.classList.remove('is-hidden');

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value || '-';
    };
    const statusLabel = data.paymentStatus === 'paid' ? 'Paid' : (data.paymentStatus || 'Pending');
    setText('confirm-order-id', data.orderId || orderIdParam || '-');
    setText('confirm-status', statusLabel);
    const placedAt = data.placedAt ? new Date(data.placedAt) : new Date();
    setText('confirm-date', Number.isNaN(placedAt.getTime()) ? '-' : placedAt.toLocaleString('en-IN'));
    setText('confirm-name', data.customer?.name || '-');
    setText('confirm-email', data.customer?.email || '-');
    setText('confirm-phone', data.customer?.phone || '-');
    setText('confirm-address', data.customer?.address || '-');
    setText('confirm-subtotal', formatPrice(data.totals?.subtotal || 0));
    setText('confirm-shipping', formatPrice(data.totals?.shipping || 0));
    setText('confirm-total', formatPrice(data.totals?.total || 0));
    const trackLink = document.getElementById('track-order-link');
    const trackOrderId = data.orderId || orderIdParam || '';
    if (trackLink && trackOrderId) {
        trackLink.setAttribute('href', `track-order.html?orderId=${encodeURIComponent(trackOrderId)}`);
    }

    const itemsRoot = document.getElementById('confirm-items');
    if (itemsRoot) {
        const items = Array.isArray(data.items) ? data.items : [];
        if (!items.length) {
            itemsRoot.innerHTML = '<p class="muted">No items found in this order.</p>';
        } else {
            itemsRoot.innerHTML = items.map(item => `
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
    }
}

function getCustomizationAddons() {
    return activeCustomizationOptions.reduce((sum, option) => {
        const checkbox = document.getElementById(option.id);
        return checkbox && checkbox.checked ? sum + option.price : sum;
    }, 0);
}

function updateCustomizationSummary() {
    const basePriceEl = document.getElementById('custom-base-price');
    const addonsEl = document.getElementById('custom-addons');
    const totalEl = document.getElementById('custom-total');
    if (!basePriceEl || !addonsEl || !totalEl) return;

    const addonsTotal = getCustomizationAddons();
    basePriceEl.textContent = formatPrice(currentBasePrice);
    addonsEl.textContent = formatPrice(addonsTotal);
    totalEl.textContent = formatPrice(currentBasePrice + addonsTotal);
}

function bindCustomizationEvents() {
    allCustomizationOptions.forEach(option => {
        const checkbox = document.getElementById(option.id);
        if (checkbox) {
            checkbox.addEventListener('change', updateCustomizationSummary);
        }
    });
}

function initProductZoom() {
    const zoomImage = document.getElementById('zoom-image');
    if (!zoomImage) return;

    const zoomInBtn = document.getElementById('zoom-in-btn');
    const zoomOutBtn = document.getElementById('zoom-out-btn');
    const fullscreenBtn = document.getElementById('fullscreen-btn');
    const modal = document.getElementById('fullscreen-modal');
    const modalClose = document.getElementById('modal-close');

    zoomImage.addEventListener('click', function() {
        this.classList.toggle('zoomed');
    });

    if (zoomInBtn) {
        zoomInBtn.addEventListener('click', function() {
            zoomImage.classList.add('zoomed');
        });
    }

    if (zoomOutBtn) {
        zoomOutBtn.addEventListener('click', function() {
            zoomImage.classList.remove('zoomed');
        });
    }

    if (fullscreenBtn && modal) {
        fullscreenBtn.addEventListener('click', function() {
            modal.classList.add('active');
        });
    }

    if (modalClose && modal) {
        modalClose.addEventListener('click', function() {
            modal.classList.remove('active');
        });
    }

    if (modal) {
        modal.addEventListener('click', function(event) {
            if (event.target === modal) {
                modal.classList.remove('active');
            }
        });
    }
}

function setActiveCustomizationOptions(category) {
    const normalized = getCategoryLabel(category);
    if (normalized === 'Paithani Accessories') {
        activeCustomizationOptions = accessoryCustomizationOptions;
    } else {
        activeCustomizationOptions = sareeCustomizationOptions;
    }

    const allowed = new Set(activeCustomizationOptions.map(opt => opt.id));
    const optionIds = ['custom-fall-pico', 'custom-tassels', 'custom-blouse', 'custom-gift-wrap', 'custom-express'];
    optionIds.forEach(id => {
        const input = document.getElementById(id);
        if (!input) return;
        const label = input.closest('label');
        if (!label) return;
        if (allowed.has(id)) {
            label.style.display = '';
            input.disabled = false;
        } else {
            label.style.display = 'none';
            input.checked = false;
            input.disabled = true;
        }
    });
}

function sanitizeCartItems(cart) {
    if (!Array.isArray(cart)) return [];
    const sanitized = [];
    cart.forEach((item, index) => {
        if (!item || typeof item !== 'object') return;
        const rawId = item.id !== undefined && item.id !== null ? String(item.id) : '';
        const rawSku = item.sku !== undefined && item.sku !== null ? String(item.sku) : '';
        const name = String(item.name || '').trim();
        const qty = Number(item.qty) || 0;
        if (!rawId && !name) return;
        if (qty <= 0) return;
        const customizations = Array.isArray(item.customizations) ? item.customizations : [];
        const notes = typeof item.notes === 'string' ? item.notes : '';
        const baseId = rawId || (name ? name.toLowerCase().replace(/\s+/g, '-') : '');
        const key = item.key || buildCartKey({ id: baseId }, { customizations, notes }) || `cart_${Date.now()}_${index}`;
        sanitized.push({
            ...item,
            id: rawId || baseId,
            sku: rawSku,
            name: name || 'Product',
            qty,
            customizations,
            notes,
            key
        });
    });
    return sanitized;
}

function getProductInfoRows(product) {
    const categoryLabel = getCategoryLabel(product.category);
    const isAccessory = categoryLabel === 'Paithani Accessories';
    const material = product.material
        || (categoryLabel.includes('Semi Silk')
            ? 'Semi Silk'
            : categoryLabel.includes('Pure Silk')
                ? 'Pure Silk'
                : isAccessory
                    ? 'Paithani Silk Blend'
                    : 'Silk');
    const weave = product.weave || 'Handwoven Paithani';
    const origin = product.origin || 'Yeola, Maharashtra';
    const work = product.work || product.motif || 'Traditional zari motifs';
    const occasion = product.occasion || (isAccessory ? 'Festive, wedding, gifting' : 'Weddings, festive, cultural');
    const care = product.care || 'Dry clean only';

    if (isAccessory) {
        return [
            { label: 'Material', value: material },
            { label: 'Craft', value: product.craft || 'Paithani hand finish' },
            { label: 'Motif', value: product.motif || product.work || 'Classic zari pattern' },
            { label: 'Size', value: product.size || 'Standard / custom on request' },
            { label: 'Occasion', value: occasion },
            { label: 'Care', value: care }
        ];
    }

    return [
        { label: 'Fabric', value: material },
        { label: 'Weave', value: weave },
        { label: 'Zari/Work', value: work },
        { label: 'Length', value: product.length || '5.5 m + blouse piece' },
        { label: 'Blouse Piece', value: product.blousePiece || 'Included' },
        { label: 'Origin', value: origin },
        { label: 'Occasion', value: occasion },
        { label: 'Care', value: care }
    ];
}

function renderProductInfo(product) {
    const infoGrid = document.getElementById('product-info-grid');
    if (!infoGrid) return;
    const rows = getProductInfoRows(product);
    infoGrid.innerHTML = rows
        .map(row => `
            <div class="product-info-item">
                <span class="product-info-label">${row.label}</span>
                <span class="product-info-value">${row.value}</span>
            </div>
        `)
        .join('');
}

function syncProductDetailHeights() {
    const imageSection = document.querySelector('.product-image-section');
    const infoSection = document.querySelector('.product-info-section');
    if (!imageSection || !infoSection) return;
    const rect = imageSection.getBoundingClientRect();
    if (rect.height > 0) {
        infoSection.style.setProperty('--product-info-max', `${Math.round(rect.height)}px`);
    }
}

function renderRelatedProducts(currentProduct, products) {
    const grid = document.getElementById('related-product-grid');
    if (!grid) return;
    const related = products || [];
    if (!related.length) {
        grid.innerHTML = '<div class="catalog-empty">No related products found right now.</div>';
        return;
    }

    grid.innerHTML = related.map(product => {
        const productId = product._id || product.id;
        const imageUrl = resolveProductImage(product);
        const priceInfo = getEffectivePrice(product);
        return `
            <div class="related-card">
                <img src="${imageUrl}" alt="${product.name}">
                <h4>${product.name || 'Product'}</h4>
                <span class="related-category">${getCategoryLabel(product.category)}</span>
                <span class="related-price">${priceInfo.hasDiscount ? formatPrice(priceInfo.final) : formatPrice(priceInfo.final)}</span>
                ${priceInfo.hasDiscount ? `<span class="related-original">${formatPrice(priceInfo.base)}</span>` : ''}
                <button class="related-btn" data-product-id="${productId}">View Details</button>
            </div>
        `;
    }).join('');

    if (!grid.dataset.bound) {
        grid.addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (!button) return;
            const productId = button.dataset.productId;
            if (productId) viewDetails(productId);
        });
        grid.dataset.bound = '1';
    }
}

async function loadRelatedProducts(currentProduct) {
    if (!currentProduct) return;
    let products = [];
    try {
        const res = await fetch(API_BASE_URL + '/products');
        if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data)) products = data;
        }
    } catch (err) {
        console.warn('related products fetch failed', err);
    }

    if (!products.length) {
        products = productsData;
    }

    const currentId = String(currentProduct._id || currentProduct.id || '');
    const currentCategory = getCategoryLabel(currentProduct.category);

    let related = products.filter(item => {
        const itemId = String(item._id || item.id || '');
        if (!itemId || itemId === currentId) return false;
        return getCategoryLabel(item.category) === currentCategory;
    });

    if (related.length < 4) {
        const others = products.filter(item => {
            const itemId = String(item._id || item.id || '');
            return itemId && itemId !== currentId;
        });
        related = [...related, ...others.filter(item => !related.includes(item))];
    }

    renderRelatedProducts(currentProduct, related.slice(0, 4));
}

function updateCustomizationCopy(category) {
    const heading = document.querySelector('.customization-section h3');
    const notesField = document.getElementById('custom-notes');
    const categoryLabel = getCategoryLabel(category);
    const isAccessory = categoryLabel === 'Paithani Accessories';
    if (heading) {
        heading.textContent = isAccessory ? 'Customize Your Accessory' : 'Customize Your Saree';
    }
    if (notesField) {
        notesField.placeholder = isAccessory
            ? 'Share any special requests (size, color, gifting notes).'
            : 'Share any special requests (colors, border, blouse size).';
    }
}

function displayProductDetails(product) {
    const imageUrl = resolveProductImage(product);
    const zoomImage = document.getElementById('zoom-image');
    const fullscreenImage = document.getElementById('fullscreen-image');

    if (zoomImage) {
        zoomImage.onload = () => syncProductDetailHeights();
        zoomImage.src = imageUrl;
    }
    if (fullscreenImage) fullscreenImage.src = imageUrl;

    currentProduct = product;
    const priceInfo = getEffectivePrice(product);
    currentBasePrice = priceInfo.final;

    const nameEl = document.getElementById('product-name');
    const priceEl = document.getElementById('product-price');
    const categoryEl = document.getElementById('product-category');
    const descEl = document.getElementById('product-description');

    if (nameEl) nameEl.textContent = product.name || 'Product';
    if (priceEl) {
        if (priceInfo.hasDiscount) {
            const badgeText = priceInfo.label || (priceInfo.type === 'percent' ? `${priceInfo.value}% OFF` : 'SALE');
            priceEl.innerHTML = `
                <span class="price-current">${formatPrice(priceInfo.final)}</span>
                <span class="price-original">${formatPrice(priceInfo.base)}</span>
                <span class="price-badge">${badgeText}</span>
            `;
        } else {
            priceEl.textContent = formatPrice(currentBasePrice);
        }
    }
    if (categoryEl) categoryEl.textContent = getCategoryLabel(product.category);
    if (descEl) {
        descEl.textContent = product.description || product.desc || 'High-quality Paithani saree with authentic design and craftsmanship.';
    }

    renderProductInfo(product);
    loadRelatedProducts(product);
    syncProductDetailHeights();

    const stockEl = document.getElementById('stock-status');
    const stockInfo = getStockStatus(product);
    if (stockEl) {
        stockEl.textContent = stockInfo.label;
        stockEl.className = `stock-status ${stockInfo.className}`;
    }

    const addToBagBtn = document.getElementById('add-to-bag');
    const buyNowBtn = document.getElementById('buy-now');
    const preorderBtn = document.getElementById('preorder-btn');

    if (stockInfo.isPreorder) {
        if (preorderBtn) preorderBtn.style.display = '';
        if (addToBagBtn) addToBagBtn.style.display = 'none';
        if (buyNowBtn) buyNowBtn.style.display = 'none';
    } else {
        if (preorderBtn) preorderBtn.style.display = 'none';
        if (addToBagBtn) addToBagBtn.style.display = '';
        if (buyNowBtn) buyNowBtn.style.display = '';
        const toggleDisabled = (btn, isDisabled) => {
            if (!btn) return;
            btn.classList.toggle('is-disabled', isDisabled);
            btn.setAttribute('aria-disabled', isDisabled ? 'true' : 'false');
            if (isDisabled) {
                btn.removeAttribute('disabled');
                btn.title = 'Out of stock';
            } else {
                btn.removeAttribute('title');
            }
        };
        toggleDisabled(addToBagBtn, stockInfo.isOut);
        toggleDisabled(buyNowBtn, stockInfo.isOut);
    }

    const contactBtn = document.getElementById('contact-to-buy');
    if (contactBtn) {
        const params = new URLSearchParams();
        params.set('productId', product._id || product.id || '');
        params.set('name', product.name || '');
        params.set('price', currentBasePrice || 0);
        contactBtn.href = `contact.html?${params.toString()}`;
    }

    setActiveCustomizationOptions(product.category);
    updateCustomizationCopy(product.category);
    updateCustomizationSummary();
}

async function loadProductDetails() {
    if (!window.location.pathname.includes('product-details.html')) return;

    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');
    const container = document.querySelector('.product-details-container');

    if (!productId) {
        if (container) container.innerHTML = '<h2 class="page-title">Product not found</h2>';
        return;
    }

    let product = null;

    try {
        const res = await fetch(API_BASE_URL + '/products/' + encodeURIComponent(productId));
        if (res.ok) {
            product = await res.json();
        }
    } catch (err) {
        console.error('Backend fetch failed, using static data', err);
    }

    if (!product) {
        try {
            const cachedRaw = sessionStorage.getItem(`product_details_cache:${productId}`);
            if (cachedRaw) {
                product = JSON.parse(cachedRaw);
            }
        } catch (err) {
            // ignore cache errors
        }
    }

    if (!product) {
        const cached = readCachedProducts();
        if (Array.isArray(cached) && cached.length) {
            product = cached.find(item => String(item._id || item.id) === String(productId));
        }
    }

    if (!product) {
        product = productsData.find(item => String(item.id) === String(productId));
    }

    if (!product) {
        if (container) container.innerHTML = '<h2 class="page-title">Product not found</h2>';
        return;
    }

    displayProductDetails(product);
}

function initProductDetailsPage() {
    if (!window.location.pathname.includes('product-details.html')) return;
    initProductZoom();
    bindCustomizationEvents();
    loadProductDetails();
    window.addEventListener('resize', syncProductDetailHeights);

    const addToBagBtn = document.getElementById('add-to-bag');
    const buyNowBtn = document.getElementById('buy-now');
    const preorderBtn = document.getElementById('preorder-btn');
    const contactBtn = document.getElementById('contact-to-buy');
    const backBtn = document.getElementById('back-btn');
    const helpEl = document.getElementById('action-help');
    const setHelp = (text) => { if (helpEl) helpEl.textContent = text; };
    const showActionMessage = (text, type = 'info') => {
        setHelp(text);
        showInlineMessage(text, type);
    };
    const isActionDisabled = (btn) => btn && btn.classList.contains('is-disabled');

    const initFeedback = () => {
        const stars = Array.from(document.querySelectorAll('#feedback-stars .star-btn'));
        const label = document.getElementById('feedback-rating-label');
        const note = document.getElementById('feedback-note');
        const textArea = document.getElementById('feedback-text');
        const submitBtn = document.getElementById('submit-feedback');
        if (!stars.length || !submitBtn) return;

        const params = new URLSearchParams(window.location.search);
        const productId = params.get('id') || 'product';
        const storageKey = `productFeedback:${productId}`;
        let currentRating = 0;

        const paintStars = (value, isHover = false) => {
            stars.forEach((star, index) => {
                star.classList.toggle('is-active', index < value);
                if (isHover) {
                    star.classList.toggle('is-hover', index < value);
                } else {
                    star.classList.remove('is-hover');
                }
            });
        };

        const setRatingLabel = (value) => {
            if (!label) return;
            label.textContent = value ? `You rated ${value}/5` : 'Select a rating';
        };

        const loadSavedFeedback = () => {
            try {
                const raw = localStorage.getItem(storageKey);
                if (!raw) return;
                const saved = JSON.parse(raw);
                if (saved && saved.rating) {
                    currentRating = saved.rating;
                    paintStars(currentRating);
                    setRatingLabel(currentRating);
                }
                if (textArea && saved && typeof saved.comment === 'string') {
                    textArea.value = saved.comment;
                }
            } catch (err) {
                console.warn('feedback load error', err);
            }
        };

        stars.forEach((star) => {
            const value = Number(star.dataset.rating || 0);
            star.addEventListener('mouseenter', () => paintStars(value, true));
            star.addEventListener('mouseleave', () => paintStars(currentRating));
            star.addEventListener('click', () => {
                currentRating = value;
                paintStars(currentRating);
                setRatingLabel(currentRating);
                if (note) note.textContent = '';
            });
        });

        submitBtn.addEventListener('click', () => {
            const comment = textArea ? textArea.value.trim() : '';
            if (!currentRating && !comment) {
                if (note) note.textContent = 'Please select a rating or add a comment.';
                return;
            }
            const payload = {
                rating: currentRating,
                comment,
                savedAt: new Date().toISOString()
            };
            try {
                localStorage.setItem(storageKey, JSON.stringify(payload));
                if (note) note.textContent = 'Thanks! Your feedback has been saved.';
            } catch (err) {
                if (note) note.textContent = 'Unable to save feedback. Please try again.';
            }
        });

        setRatingLabel(currentRating);
        loadSavedFeedback();
    };

    initFeedback();

    const pushCurrentSelectionToCart = () => {
        if (!currentProduct) {
            showActionMessage('Please wait, product details are still loading.', 'info');
            return null;
        }
        const stockInfo = getStockStatus(currentProduct);
        if (stockInfo.isPreorder) {
            openPreorderModal(currentProduct);
            return null;
        }
        if (stockInfo.isOut) {
            showActionMessage('Sorry, this item is out of stock right now.', 'error');
            return null;
        }
        const addonsTotal = getCustomizationAddons();
        const selections = activeCustomizationOptions
            .filter(option => {
                const checkbox = document.getElementById(option.id);
                return checkbox && checkbox.checked;
            })
            .map(option => option.label);
        const notes = document.getElementById('custom-notes')?.value?.trim();
        const totalPrice = currentBasePrice + addonsTotal;

        addToCart(currentProduct, {
            customizations: selections,
            notes,
            addonsTotal,
            basePrice: currentBasePrice,
            unitPrice: totalPrice
        });
        return { selections, notes };
    };

    if (addToBagBtn) {
        addToBagBtn.addEventListener('click', function() {
            if (isActionDisabled(addToBagBtn)) {
                showActionMessage('Sorry, this item is out of stock right now.', 'error');
                return;
            }
            const result = pushCurrentSelectionToCart();
            if (!result) return;
            setHelp('Added to cart. You can keep shopping or proceed to cart.');
            showInlineMessage(`${currentProduct.name} added to your cart.`, 'success');
        });
    }

    if (buyNowBtn) {
        buyNowBtn.addEventListener('click', function() {
            if (isActionDisabled(buyNowBtn)) {
                showActionMessage('Sorry, this item is out of stock right now.', 'error');
                return;
            }
            const result = pushCurrentSelectionToCart();
            if (!result) return;
            setHelp('Takes you to checkout with this item ready to pay.');
            window.location.href = 'cart.html';
        });
    }

    if (preorderBtn) {
        preorderBtn.addEventListener('click', function() {
            if (!currentProduct) return;
            openPreorderModal(currentProduct);
        });
    }

    if (contactBtn && currentProduct) {
        const params = new URLSearchParams();
        params.set('productId', currentProduct._id || currentProduct.id || '');
        params.set('name', currentProduct.name || '');
        params.set('price', currentBasePrice || 0);
        contactBtn.href = `contact.html?${params.toString()}`;
        contactBtn.addEventListener('click', () => setHelp('Opens contact form with this product prefilled.'));
    }

    if (backBtn) {
        backBtn.addEventListener('click', function() {
            setHelp('Back to the product list.');
            navigateBackWithFallback('products.html');
        });
    }
}

function setFormMessage(messageEl, text, type = 'error', isHtml = false) {
    if (!messageEl) return;
    if (isHtml) {
        messageEl.innerHTML = text || '';
    } else {
        messageEl.textContent = text || '';
    }
    messageEl.classList.remove('is-error', 'is-success');
    if (text) {
        messageEl.classList.add(type === 'success' ? 'is-success' : 'is-error');
    }
}

function initFooterNewsletter() {
    const forms = document.querySelectorAll('.footer-form');
    if (!forms.length) return;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    forms.forEach((form) => {
        const input = form.querySelector('input[type="email"]');
        const note = form.parentElement?.querySelector('[data-footer-note]') || form.parentElement?.querySelector('small');
        const submitBtn = form.querySelector('button[type="submit"]');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const value = String(input?.value || '').trim();
            if (!value || !emailRegex.test(value)) {
                showToast('Please enter a valid email address.', 'error', { icon: '!' });
                if (note) note.textContent = 'Please enter a valid email address.';
                if (input) {
                    input.focus();
                }
                return;
            }
            if (submitBtn) submitBtn.disabled = true;
            if (note) note.textContent = 'Subscribing...';
            try {
                const res = await fetch(`${API_BASE_URL}/subscribe`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: value })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const message = data?.error || 'Unable to subscribe right now.';
                    showToast(message, 'error', { icon: '!' });
                    if (note) note.textContent = message;
                    return;
                }
                const message = data?.message || 'Thanks for subscribing! We will be in touch soon.';
                showToast(message, 'success', { icon: '✓', confetti: true });
                if (note) note.textContent = message;
                if (input) {
                    input.value = '';
                }
            } catch (err) {
                showToast('Unable to subscribe right now.', 'error', { icon: '!' });
                if (note) note.textContent = 'Unable to subscribe right now.';
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', initFooterNewsletter);

function initFooterAdminReveal() {
    const footer = document.querySelector('.site-footer');
    if (!footer) return;
    let trigger = footer.querySelector('.footer-admin-trigger');
    if (!trigger) {
        trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'footer-admin-trigger';
        trigger.setAttribute('aria-label', 'Show admin login');
        trigger.setAttribute('title', 'Admin');
        footer.appendChild(trigger);
    }
    const isInteractive = (target) => !!target.closest('a, button, input, textarea, select, label, form');
    const showHint = (event) => {
        if (isInteractive(event.target)) return;
        footer.classList.add('is-admin-hint');
    };
    footer.addEventListener('click', showHint);
    footer.addEventListener('pointerdown', showHint);
    trigger.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        footer.classList.toggle('is-admin-reveal');
        footer.classList.add('is-admin-hint');
    });
    document.addEventListener('click', (event) => {
        if (!footer.contains(event.target)) {
            footer.classList.remove('is-admin-reveal');
            footer.classList.remove('is-admin-hint');
        }
    });
}

document.addEventListener('DOMContentLoaded', initFooterAdminReveal);

function showToast(message, type = 'success', options = {}) {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = options.icon || (type === 'success' ? '✓' : '!');
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-text">${message}</span>
    `;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    if (options.confetti) {
        launchToastConfetti(toast);
    }

    const remove = () => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 250);
    };

    setTimeout(remove, 2200);
}

function launchToastConfetti(anchor) {
    const confetti = document.createElement('div');
    confetti.className = 'toast-confetti';
    const colors = ['#c5a059', '#7a1f29', '#f2d7a1', '#ffffff'];
    for (let i = 0; i < 18; i += 1) {
        const piece = document.createElement('span');
        const size = 6 + Math.floor(Math.random() * 6);
        piece.style.width = `${size}px`;
        piece.style.height = `${size * 0.6}px`;
        piece.style.background = colors[i % colors.length];
        piece.style.left = `${5 + Math.random() * 90}%`;
        piece.style.animationDelay = `${Math.random() * 0.2}s`;
        confetti.appendChild(piece);
    }
    anchor.appendChild(confetti);
}

function ensurePreorderModal() {
    if (document.getElementById('preorder-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'preorder-modal';
    modal.className = 'modal preorder-modal';
    modal.style.display = 'none';
    modal.innerHTML = `
        <div class="modal-content preorder-content">
            <div class="preorder-header">
                <div>
                    <span class="preorder-tag">Preorder</span>
                    <h2>Reserve this saree</h2>
                    <p class="muted">Share your details and we will confirm availability within 24 hours.</p>
                </div>
                <button type="button" class="close preorder-close" aria-label="Close preorder form">&times;</button>
            </div>
            <div class="preorder-summary">
                <div class="preorder-summary-main">
                    <span class="preorder-label">Selected product</span>
                    <strong id="preorder-product-name">Product</strong>
                </div>
                <span id="preorder-product-price" class="preorder-price">0</span>
            </div>
            <form id="preorder-form" class="preorder-form">
                <div class="preorder-grid">
                    <div class="preorder-field">
                        <label for="preorder-name">Full Name</label>
                        <input type="text" id="preorder-name" placeholder="Your full name" required>
                    </div>
                    <div class="preorder-field">
                        <label for="preorder-email">Email</label>
                        <input type="email" id="preorder-email" placeholder="you@example.com" required>
                    </div>
                    <div class="preorder-field">
                        <label for="preorder-phone">Phone</label>
                        <input type="text" id="preorder-phone" placeholder="+91 90000 00000" required>
                    </div>
                    <div class="preorder-field">
                        <label for="preorder-qty">Quantity</label>
                        <input type="number" id="preorder-qty" min="1" value="1" required>
                    </div>
                    <div class="preorder-field preorder-full">
                        <label for="preorder-address">Delivery Address</label>
                        <textarea id="preorder-address" placeholder="House no, street, area, city, state, pincode" required></textarea>
                    </div>
                    <div class="preorder-field preorder-full">
                        <label for="preorder-notes">Notes (optional)</label>
                        <textarea id="preorder-notes" placeholder="Share color, pallu, border preferences, or timeline."></textarea>
                    </div>
                </div>
                <p id="preorder-message" class="form-message"></p>
                <div class="preorder-actions">
                    <button type="submit" class="preorder-submit">Submit Preorder</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    const closeModal = () => {
        modal.style.display = 'none';
    };

    modal.querySelector('.close')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeModal();
    });

    const form = modal.querySelector('#preorder-form');
    const messageEl = modal.querySelector('#preorder-message');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (messageEl) {
            messageEl.textContent = '';
            messageEl.classList.remove('is-error', 'is-success');
        }

        const name = modal.querySelector('#preorder-name')?.value?.trim();
        const email = modal.querySelector('#preorder-email')?.value?.trim();
        const phone = modal.querySelector('#preorder-phone')?.value?.trim();
        const address = modal.querySelector('#preorder-address')?.value?.trim();
        const qty = modal.querySelector('#preorder-qty')?.value || '1';
        const notes = modal.querySelector('#preorder-notes')?.value?.trim();

        if (!name || !email || !phone || !address) {
            if (messageEl) {
                messageEl.textContent = 'Please fill in all required fields.';
                messageEl.classList.add('is-error');
            }
            return;
        }

        const productName = form.dataset.productName || 'Product';
        const productId = form.dataset.productId || '';
        const productPrice = form.dataset.productPrice || '';

        const message = [
            'Preorder request',
            `Product: ${productName}`,
            productId ? `Product ID: ${productId}` : '',
            productPrice ? `Price: Rs ${productPrice}` : '',
            `Quantity: ${qty}`,
            `Phone: ${phone}`,
            `Address: ${address}`,
            notes ? `Notes: ${notes}` : ''
        ].filter(Boolean).join('\n');

        try {
            const res = await fetch(API_BASE_URL + '/contacts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, message })
            });

            if (!res.ok) {
                throw new Error('Preorder request failed');
            }

            if (messageEl) {
                messageEl.textContent = 'Preorder request sent. We will contact you soon.';
                messageEl.classList.add('is-success');
            }
            form.reset();
        } catch (err) {
            console.error('preorder error', err);
            if (messageEl) {
                messageEl.textContent = 'Could not submit preorder request right now. Please try again.';
                messageEl.classList.add('is-error');
            }
        }
    });
}

function openPreorderModal(product) {
    if (!product) return;
    ensurePreorderModal();
    const modal = document.getElementById('preorder-modal');
    const nameEl = modal.querySelector('#preorder-product-name');
    const priceEl = modal.querySelector('#preorder-product-price');
    const form = modal.querySelector('#preorder-form');

    if (nameEl) nameEl.textContent = product.name || 'Product';
    if (priceEl) priceEl.textContent = formatPrice(product.price || 0);

    form.dataset.productId = product._id || product.id || '';
    form.dataset.productName = product.name || '';
    form.dataset.productPrice = product.price !== undefined ? String(product.price) : '';

    modal.style.display = 'flex';
}

// helper used by both fallback and API result
const FEATURED_COUNT = 16;
const CATEGORY_ORDER = [
    'Pure Silk Paithani',
    'Semi Silk Paithani',
    'Paithani Accessories',
    'Festival Specials',
    'Family'
];

function normalizeCategory(category) {
    if (!category) return 'Pure Silk Paithani';
    const normalized = String(category).toLowerCase().trim();
    if (normalized.includes('family')) return 'Family';
    if (normalized.includes('access')) return 'Paithani Accessories';
    if (normalized.includes('semi')) return 'Semi Silk Paithani';
    if (normalized.includes('pure')) return 'Pure Silk Paithani';
    return category;
}

function getCategoryLabel(category) {
    const normalized = normalizeCategory(category);
    return normalized || 'Pure Silk Paithani';
}

const FAMILY_GROUPS = ['Children', 'Parents', 'Grandparents'];

function normalizeFamilyGroup(value) {
    if (!value) return '';
    const normalized = String(value).toLowerCase().trim();
    if (normalized.startsWith('child')) return 'Children';
    if (normalized.startsWith('parent')) return 'Parents';
    if (normalized.startsWith('grand')) return 'Grandparents';
    return '';
}

function getFamilyGroup(product) {
    if (!product) return '';
    const category = getCategoryLabel(product.category);
    if (category !== 'Family') return '';
    const explicit = normalizeFamilyGroup(product.familyGroup || product.family || product.audience);
    if (explicit) return explicit;
    return normalizeFamilyGroup(product.subcategory || product.familyMember || product.segment || '');
}

function createProductCard(product) {
    const productId = product._id || product.id;
    const imageUrl = resolveProductImage(product);
    const priceInfo = getEffectivePrice(product);
    const isPlaceholder = /logo\.png$/i.test(imageUrl);
    const rawStock = Number(product.stock);
    const rawThreshold = Number(product.lowStockThreshold);
    const stockInfo = getStockStatus(product);
    const showPrice = !isHomePage();
    const showMeta = !isHomePage();
    const wishlistActive = wishlistIds.has(String(productId));

    if (productId) {
        renderedProductsById.set(String(productId), {
            id: productId,
            name: product.name || 'Product',
            price: priceInfo.final,
            image: imageUrl,
            category: getCategoryLabel(product.category),
            stock: Number.isFinite(rawStock) ? rawStock : undefined,
            lowStockThreshold: Number.isFinite(rawThreshold) ? rawThreshold : 0,
            status: product.status || ''
        });
    }

    const addDisabled = stockInfo.isOut ? 'disabled' : '';
    const addLabel = stockInfo.isOut ? 'Out of Stock' : 'Add to Cart';
    const hidePreorderOnHome = stockInfo.isPreorder && isHomePage();
    const actionButton = hidePreorderOnHome
        ? `<button class="btn-small add-to-cart-btn" data-product-id="${productId}" ${addDisabled}>${addLabel}</button>`
        : (stockInfo.isPreorder
            ? `<button class="btn-small preorder-btn" data-product-id="${productId}">Preorder</button>`
            : `<button class="btn-small add-to-cart-btn" data-product-id="${productId}" ${addDisabled}>${addLabel}</button>`);

    const priceMarkup = showPrice ? getPriceMarkup(priceInfo) : '';

    const stockChip = (!showMeta || stockInfo.isPreorder)
        ? ''
        : `<span class="stock-chip ${stockInfo.className}">${stockInfo.label}</span>`;

    return `
        <div class="product-card" data-product-id="${productId}">
            <button class="wishlist-btn ${wishlistActive ? 'active' : ''}" data-product-id="${productId}" aria-pressed="${wishlistActive ? 'true' : 'false'}" aria-label="${wishlistActive ? 'Remove from wishlist' : 'Add to wishlist'}">❤</button>
            <img src="${imageUrl}" alt="${product.name}" class="${isPlaceholder ? 'placeholder-img' : ''}">
            <h4>${product.name}</h4>
            ${priceMarkup}
            <div class="product-meta-row">
                <span class="product-category-chip">${getCategoryLabel(product.category)}</span>
                ${stockChip}
            </div>
            <div class="product-actions-row">
                <button class="btn-small view-details-btn" data-product-id="${productId}">View Details</button>
                ${actionButton}
            </div>
        </div>
    `;
}

function isHomePage() {

    const path = window.location.pathname.toLowerCase();
    return path === '/' || path === '' || path.endsWith('/index.html') || path.endsWith('index.html');
}

function renderProducts(products) {
    const productGrid = document.getElementById('product-container');
    if (!productGrid) return;

    productGrid.innerHTML = '';
    renderedProductsById = new Map();

    if (!products || !products.length) {
        productGrid.innerHTML = '<div class=\"catalog-empty\">No products match your filters right now. Clear the search or browse another category.</div>';
        if (window.location.pathname.includes('products.html')) {
            updateResultCount(0);
        }
        return;
    }

    const featuredRank = (product) => {
        const skuKey = product?.sku ? String(product.sku).toLowerCase() : '';
        const idKey = product?.id !== undefined && product?.id !== null ? String(product.id).toLowerCase() : '';
        const nameKey = product?.name ? String(product.name).toLowerCase() : '';
        if (skuKey && FEATURED_ORDER_MAP.has(skuKey)) return FEATURED_ORDER_MAP.get(skuKey);
        if (idKey && FEATURED_ORDER_MAP.has(idKey)) return FEATURED_ORDER_MAP.get(idKey);
        if (nameKey && FEATURED_ORDER_MAP.has(nameKey)) return FEATURED_ORDER_MAP.get(nameKey);
        return Number.MAX_SAFE_INTEGER;
    };

    const productsToRender = window.location.pathname.includes('products.html')
        ? products
        : (isHomePage()
            ? (() => {
                const featured = products.filter(item => item && (item.featured || String(item.status || '').toLowerCase() === 'new'));
                const sortByFeatured = (a, b) => {
                    const aFeatured = !!a?.featured;
                    const bFeatured = !!b?.featured;
                    if (aFeatured !== bFeatured) return aFeatured ? -1 : 1;
                    const rankA = featuredRank(a);
                    const rankB = featuredRank(b);
                    if (rankA !== rankB) return rankA - rankB;
                    return getProductTimestamp(b) - getProductTimestamp(a);
                };
                const featuredSorted = [...featured].sort(sortByFeatured);
                if (!featuredSorted.length) {
                    return [...products].sort(sortByFeatured).slice(0, FEATURED_COUNT);
                }
                const featuredKeys = new Set(featuredSorted.map(item => getProductKey(item)).filter(Boolean));
                const filler = products.filter(item => item && !featuredKeys.has(getProductKey(item))).sort(sortByFeatured);
                return [...featuredSorted, ...filler].slice(0, FEATURED_COUNT);
            })()
            : products);

    productGrid.innerHTML = productsToRender.map(createProductCard).join('');

    if (!productGrid.dataset.bound) {
        productGrid.addEventListener('click', (event) => {
            const button = event.target.closest('button');
            if (button) {
                const productId = button.dataset.productId;
                if (!productId) return;
                if (button.classList.contains('wishlist-btn')) {
                    toggleWishlist(productId);
                    return;
                }
                if (button.classList.contains('view-details-btn')) {
                    viewDetails(productId);
                    return;
                }
                if (button.classList.contains('preorder-btn')) {
                    const product = renderedProductsById.get(String(productId));
                    if (product) {
                        openPreorderModal(product);
                    }
                    return;
                }
                if (button.classList.contains('add-to-cart-btn')) {
                    const product = renderedProductsById.get(String(productId));
                    if (product) {
                        const stockInfo = getStockStatus(product);
                        if (stockInfo.isPreorder) {
                            openPreorderModal(product);
                            return;
                        }
                        if (stockInfo.isOut) {
                            showInlineMessage('Sorry, this item is out of stock right now.', 'error');
                            return;
                        }
                        addToCart(product);
                        showInlineMessage(`${product.name} added to your cart.`, 'success');
                    }
                }
                return;
            }

            const card = event.target.closest('.product-card');
            if (!card) return;
            const productId = card.dataset.productId;
            if (!productId) return;
            viewDetails(productId);
        });
        productGrid.dataset.bound = '1';
    }

    if (window.location.pathname.includes('products.html')) {
        updateResultCount(products.length);
    }
}

function getProductTimestamp(product) {
    const raw = product?.dateAdded || product?.createdAt || product?.updatedAt;
    const parsed = raw ? new Date(raw).getTime() : 0;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    const id = product?._id || product?.id;
    if (typeof id === 'string' && id.length >= 8) {
        const tsHex = id.slice(0, 8);
        const ts = Number.parseInt(tsHex, 16);
        if (Number.isFinite(ts)) return ts * 1000;
    }
    return 0;
}


function updateResultCount(count) {
    const counter = document.getElementById('result-count');
    if (!counter) return;
    counter.textContent = count === 1 ? '1 item' : `${count} items`;
}

function matchesSearch(product, term) {
    if (!term) return true;
    const haystack = [product.name, product.category, product.description, product.desc]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return haystack.includes(term);
}

function sortProducts(list, sort) {
    const sorted = [...list];
    if (sort === 'price-asc') return sorted.sort((a, b) => (Number(a.price) || 0) - (Number(b.price) || 0));
    if (sort === 'price-desc') return sorted.sort((a, b) => (Number(b.price) || 0) - (Number(a.price) || 0));
    if (sort === 'name') return sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    return sorted.sort((a, b) => (a.__idx || 0) - (b.__idx || 0));
}

function populateCategoryFilter() {
    const select = document.getElementById('filter-category');
    if (!select) return;
    const baseCategories = ['all', ...CATEGORY_ORDER, 'Paithani Accessories', 'Festival Specials'];
    const categories = Array.from(new Set(baseCategories));
    const current = select.value || 'all';
    select.innerHTML = '';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat === 'all' ? 'all' : cat;
        option.textContent = cat === 'all' ? 'All categories' : cat;
        select.appendChild(option);
    });
    select.value = current;
}

function syncCategoryControls() {
    const categorySelect = document.getElementById('filter-category');
    const pills = document.querySelectorAll('.category-pill');
    if (categorySelect) {
        categorySelect.value = currentFilters.category || 'all';
    }
    pills.forEach(btn => {
        const value = btn.dataset.category || 'all';
        if (value === currentFilters.category) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    syncFamilyControls();
}

function syncFamilyControls() {
    const wrapper = document.getElementById('family-filters');
    if (!wrapper) return;
    const isFamily = currentFilters.category === 'Family';
    wrapper.classList.toggle('is-hidden', !isFamily);
    if (!isFamily) {
        currentFilters.family = 'all';
        return;
    }
    const buttons = wrapper.querySelectorAll('.family-pill');
    buttons.forEach(btn => {
        const value = btn.dataset.family || 'all';
        if (value === currentFilters.family) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
}

function applyProductFilters() {
    if (!allProducts.length) {
        renderProducts([]);
        updateResultCount(0);
        return;
    }
    const isCatalogPage = window.location.pathname.includes('products.html');
    let filtered = allProducts.map((item, idx) => ({ ...item, __idx: item.__idx ?? idx }));

    const term = (currentFilters.search || '').trim().toLowerCase();
    if (term) {
        filtered = filtered.filter(product => matchesSearch(product, term));
    }

    if (isCatalogPage && currentFilters.category !== 'all') {
        if (currentFilters.category === 'Family') {
            filtered = filtered.filter(product => getFamilyGroup(product));
            if (currentFilters.family && currentFilters.family !== 'all') {
                filtered = filtered.filter(product => getFamilyGroup(product) === currentFilters.family);
            }
        } else {
            filtered = filtered.filter(product => getCategoryLabel(product.category) === currentFilters.category);
        }
    }

    filtered = sortProducts(filtered, currentFilters.sort);
    syncCategoryControls();
    updateResultCount(filtered.length);
    renderProducts(filtered);
}

function initCatalogFilters() {
    const searchInput = document.getElementById('product-search');
    const searchBtn = document.querySelector('.search-box .search-btn');
    const categorySelect = document.getElementById('filter-category');
    const sortSelect = document.getElementById('sort-price');
    const categoryPills = document.querySelectorAll('.category-pill');
    const familyPills = document.querySelectorAll('.family-pill');

    if (searchInput) {
        searchInput.addEventListener('input', (event) => {
            currentFilters.search = event.target.value;
            applyProductFilters();
        });
    }

    if (searchBtn && searchInput) {
        searchBtn.addEventListener('click', () => {
            currentFilters.search = searchInput.value || '';
            applyProductFilters();
            searchInput.focus();
        });
    }

    if (categorySelect) {
        categorySelect.addEventListener('change', (event) => {
            currentFilters.category = event.target.value || 'all';
            if (currentFilters.category !== 'Family') {
                currentFilters.family = 'all';
            }
            applyProductFilters();
        });
    }

    if (categoryPills.length) {
        categoryPills.forEach(btn => {
            btn.addEventListener('click', () => {
                currentFilters.category = btn.dataset.category || 'all';
                if (currentFilters.category !== 'Family') {
                    currentFilters.family = 'all';
                }
                applyProductFilters();
            });
        });
    }

    if (familyPills.length) {
        familyPills.forEach(btn => {
            btn.addEventListener('click', () => {
                currentFilters.family = btn.dataset.family || 'all';
                applyProductFilters();
            });
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (event) => {
            currentFilters.sort = event.target.value || 'relevance';
            applyProductFilters();
        });
    }

    syncCategoryControls();
}


async function loadProducts() {
    const productGrid = document.getElementById('product-container');
    if (!productGrid) return;

    const fallback = productsData.map((item, idx) => ({ ...item, __idx: idx }));
    const featuredRank = (product, fallbackIndex = 0) => {
        const skuKey = product?.sku ? String(product.sku).toLowerCase() : '';
        const idKey = product?.id !== undefined && product?.id !== null ? String(product.id).toLowerCase() : '';
        const nameKey = product?.name ? String(product.name).toLowerCase() : '';
        if (skuKey && FEATURED_ORDER_MAP.has(skuKey)) return FEATURED_ORDER_MAP.get(skuKey);
        if (idKey && FEATURED_ORDER_MAP.has(idKey)) return FEATURED_ORDER_MAP.get(idKey);
        if (nameKey && FEATURED_ORDER_MAP.has(nameKey)) return FEATURED_ORDER_MAP.get(nameKey);
        return FEATURED_ORDER_MAP.size + fallbackIndex;
    };

    try {
        const res = await fetch(API_BASE_URL + '/products');
        if (!res.ok) throw new Error(res.statusText);
        const products = await res.json();
        if (Array.isArray(products) && products.length) {
            allProducts = products.map((item, idx) => ({ ...item, __idx: featuredRank(item, idx) }));
            cacheProducts(allProducts);
        } else {
            const cached = readCachedProducts();
            allProducts = cached.length
                ? cached.map((item, idx) => ({ ...item, __idx: item.__idx ?? featuredRank(item, idx) }))
                : fallback;
        }
    } catch (err) {
        console.error('could not fetch products from backend, using cached fallback', err);
        const cached = readCachedProducts();
        allProducts = cached.length
            ? cached.map((item, idx) => ({ ...item, __idx: item.__idx ?? featuredRank(item, idx) }))
            : fallback;
    }

    populateCategoryFilter();
    applyProductFilters();
}
function viewDetails(productId) {
    if (!productId) return;
    storeBackTarget();
    const product = getProductById(productId);
    if (product) {
        try {
            sessionStorage.setItem(`product_details_cache:${productId}`, JSON.stringify(product));
        } catch (err) {
            // ignore storage errors
        }
    }
    window.location.href = `product-details.html?id=${encodeURIComponent(productId)}`;
}
// Event Listeners for Forms
document.addEventListener('DOMContentLoaded', () => {
    initMobileNav();
    setActiveNavLink();
    updateProfileLinks();
    restoreBackTargetScroll();
    updateCartBadge();
    wishlistIds = new Set(loadWishlist().map(item => String(item.id || item._id)));
    updateWishlistButtons();
    renderWishlistSection();
    loadCartFromBackend().then(renderCartPage);
    initCheckout();
    initOrderConfirmationPage();
    renderSaleBanner();

    // For Contact Form 
    const contactForm = document.querySelector('.form-container form');
    if (contactForm && window.location.pathname.includes('contact.html')) {
        const CONTACT_EMAIL_KEY = 'paithani_contact_email';
        const params = new URLSearchParams(window.location.search);
        const productName = params.get('name');
        const productId = params.get('productId');
        const productPrice = params.get('price');
        const nameField = document.getElementById('contactName');
        const messageField = document.getElementById('contactMessage');
        const emailField = document.getElementById('contactEmail');
        const repliesBtn = document.getElementById('contactRepliesBtn');
        const statusField = document.querySelector('[data-preview-status]');
        const repliesRoot = document.getElementById('contactReplies');
        const repliesMeta = document.getElementById('contactRepliesMeta');
        const repliesList = document.getElementById('contactRepliesList');

        const escapeHtml = (value) => String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        const formatMultiline = (value) => escapeHtml(value).replace(/\n/g, '<br>');

        const setStatus = (text, tone = 'info') => {
            if (!statusField) return;
            statusField.textContent = text;
            statusField.classList.remove('status-good', 'status-bad');
            if (tone === 'success') statusField.classList.add('status-good');
            if (tone === 'error') statusField.classList.add('status-bad');
        };

        const renderReplies = (list = []) => {
            if (!repliesList) return;
            if (!list.length) {
                repliesList.innerHTML = '<p class="muted">No replies yet. We will get back to you soon.</p>';
                return;
            }
            repliesList.innerHTML = list.map((msg) => {
                const status = (msg.status || (msg.reply ? 'replied' : 'open')).toLowerCase();
                const replyBlock = msg.reply
                    ? `<div class="reply-content">${formatMultiline(msg.reply)}</div>`
                    : '<div class="reply-content muted">Awaiting reply from our team.</div>';
                return `
                    <div class="reply-card">
                        <div class="reply-header">
                            <span class="reply-status status-pill status-${status}">${escapeHtml(status)}</span>
                            <span class="reply-date">${escapeHtml(new Date(msg.createdAt).toLocaleString('en-IN'))}</span>
                        </div>
                        <div class="reply-message">${formatMultiline(msg.message || '')}</div>
                        ${replyBlock}
                    </div>
                `;
            }).join('');
        };

        const loadReplies = async (email) => {
            if (!email || !repliesRoot) return;
            if (repliesMeta) repliesMeta.textContent = 'Checking for replies...';
            try {
                const res = await fetch(`${API_BASE_URL}/contacts?email=${encodeURIComponent(email)}`);
                const data = await res.json().catch(() => ([]));
                if (!res.ok) {
                    throw new Error(data?.error || 'Failed to load replies');
                }
                const list = Array.isArray(data) ? data : [];
                renderReplies(list);
                markUserRepliesSeen(email, list);
                if (typeof refreshUserNotifications === 'function') {
                    refreshUserNotifications();
                }
                if (repliesMeta) {
                    repliesMeta.textContent = 'Replies linked to ' + email;
                }
            } catch (err) {
                console.error('contact replies error', err);
                if (repliesMeta) repliesMeta.textContent = 'Unable to load replies right now.';
                renderReplies([]);
            }
        };

        if (productName && messageField) {
            const prettyPrice = productPrice ? ` (Price: ?${Number(productPrice || 0).toLocaleString('en-IN')})` : '';
            messageField.value = `I am interested in ${productName}${prettyPrice}. Please share availability and buying options. Product ID: ${productId || ''}`;
        }
        if (productName && nameField && !nameField.value) {
            nameField.value = 'Guest';
        }
        const savedEmail = localStorage.getItem(CONTACT_EMAIL_KEY);
        if (savedEmail && emailField && !emailField.value) {
            emailField.value = savedEmail;
            if (typeof updatePreview === 'function') updatePreview();
            if (repliesMeta) repliesMeta.textContent = `Ready to check replies for ${savedEmail}.`;
        }
        repliesBtn?.addEventListener('click', () => {
            const email = emailField?.value?.trim().toLowerCase() || '';
            if (!email) {
                if (repliesMeta) repliesMeta.textContent = 'Please enter your email first.';
                return;
            }
            localStorage.setItem(CONTACT_EMAIL_KEY, email);
            loadReplies(email);
        });

        contactForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            const name = nameField?.value?.trim() || '';
            const email = emailField?.value?.trim().toLowerCase() || '';
            const message = messageField?.value?.trim() || '';
            const gender = document.querySelector('input[name="gender"]:checked')?.value || '';
            const state = document.getElementById('contactState')?.value || '';
            const products = Array.from(document.querySelectorAll('input[name="products"]:checked')).map((input) => input.value);

            if (!name || !email || !message) {
                setStatus('Please fill in your name, email, and message.', 'error');
                return;
            }

            const metaLines = [
                gender ? `Gender: ${gender}` : '',
                state ? `State: ${state}` : '',
                products.length ? `Interested products: ${products.join(', ')}` : ''
            ].filter(Boolean);
            const finalMessage = metaLines.length ? `${message}\n\n${metaLines.join('\n')}` : message;

            setStatus('Sending your message...', 'info');
            try {
                const res = await fetch(API_BASE_URL + '/contacts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, message: finalMessage })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    throw new Error(data?.error || 'Failed to send message');
                }
                localStorage.setItem(CONTACT_EMAIL_KEY, email);
                setStatus('Submitted. We will reply here and by email.', 'success');
                if (typeof updatePreview === 'function') updatePreview();
                loadReplies(email);
                contactForm.reset();
                if (emailField) emailField.value = email;
                if (nameField) nameField.value = name;
                if (typeof updatePreview === 'function') updatePreview();
            } catch (err) {
                console.error('contact submit error', err);
                setStatus('Unable to send your message right now. Please try again.', 'error');
            }
        });
    }

    // For Login Form 
    const loginForm = document.getElementById('login-form');
    if (loginForm && window.location.pathname.includes('login.html')) {
        const loginMessage = document.getElementById('login-message');
        loginForm.addEventListener('submit', async function(event) {
            event.preventDefault(); // Prevent default form submission
            if (window.__userLoginInFlight) return;
            setFormMessage(loginMessage, '');
            const email = document.getElementById('login-email')?.value?.trim().toLowerCase() || '';
            const password = document.getElementById('login-password')?.value || '';
            if (!email || !password) {
                setFormMessage(loginMessage, 'Please enter email and password.');
                return;
            }
            const submitBtn = loginForm.querySelector('button[type="submit"]');
            window.__userLoginInFlight = true;
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.setAttribute('aria-busy', 'true');
            }
            try {
                const res = await fetch(API_BASE_URL + '/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    if (res.status === 429) {
                        setFormMessage(loginMessage, 'Too many login attempts. Please wait 2 minutes and try again.');
                        return;
                    }
                    if (res.status === 403 && data?.needsVerification) {
                        try {
                            await fetch(API_BASE_URL + '/auth/resend-verification', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ email })
                            });
                        } catch (err) {
                            // ignore resend errors
                        }
                        setFormMessage(loginMessage, data.error || 'Email not verified. We sent a verification link.', 'error');
                        return;
                    }
                    setFormMessage(loginMessage, data.error || 'Login failed. Please try again.');
                    return;
                }
                if (data.token) {
                    localStorage.setItem('authToken', data.token);
                }
                if (data.user) {
                    localStorage.setItem('authUser', JSON.stringify(data.user));
                }
                localStorage.setItem('authEmail', email);
                setFormMessage(loginMessage, 'Login successful! Redirecting...', 'success');
                showToast('Welcome back!', 'success', { confetti: true, icon: '✓' });
                loginForm.reset();
                setTimeout(() => { window.location.href = 'index.html'; }, 800);
            } catch (err) {
                console.error('login error', err);
                setFormMessage(loginMessage, 'Unable to reach server. Please try again.');
            } finally {
                window.__userLoginInFlight = false;
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.removeAttribute('aria-busy');
                }
            }
        });
    }
    const PASSWORD_RULE_MESSAGE = 'Password must be at least 8 characters and include a letter, a number, and a special character.';
    const isStrongPassword = (value) => {
        const pwd = String(value || '');
        return pwd.length >= 8 && /[A-Za-z]/.test(pwd) && /\d/.test(pwd) && /[^A-Za-z0-9]/.test(pwd);
    };

    const attachPasswordHint = (inputEl, hintEl) => {
        if (!inputEl || !hintEl) return;
        const updateHint = () => {
            const value = String(inputEl.value || '');
            if (!value) {
                hintEl.textContent = PASSWORD_RULE_MESSAGE;
                hintEl.className = 'password-hint';
                return;
            }
            if (isStrongPassword(value)) {
                hintEl.textContent = 'Strong password.';
                hintEl.className = 'password-hint is-success';
            } else {
                hintEl.textContent = PASSWORD_RULE_MESSAGE;
                hintEl.className = 'password-hint is-error';
            }
        };
        inputEl.addEventListener('input', updateHint);
        inputEl.addEventListener('blur', updateHint);
        updateHint();
    };

    const signupForm = document.getElementById('signup-form');
    if (signupForm && window.location.pathname.includes('signup.html')) {
        const signupMessage = document.getElementById('signup-message');
        attachPasswordHint(
            document.getElementById('signup-password'),
            document.getElementById('signup-password-hint')
        );
        signupForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            setFormMessage(signupMessage, '');
            const name = document.getElementById('signup-name')?.value?.trim() || '';
            const email = document.getElementById('signup-email')?.value?.trim().toLowerCase() || '';
            const phone = document.getElementById('signup-phone')?.value?.trim() || '';
            const password = document.getElementById('signup-password')?.value || '';
            const confirm = document.getElementById('signup-confirm')?.value || '';
            if (!name || !email || !password || !confirm) {
                setFormMessage(signupMessage, 'Please fill in all required fields.');
                return;
            }
            if (password !== confirm) {
                setFormMessage(signupMessage, 'Passwords do not match. Please try again.');
                return;
            }
            if (!isStrongPassword(password)) {
                setFormMessage(signupMessage, PASSWORD_RULE_MESSAGE);
                return;
            }
            try {
                const res = await fetch(API_BASE_URL + '/signup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, password, confirmPassword: confirm, phone })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setFormMessage(signupMessage, data.error || 'Signup failed. Please try again.');
                    return;
                }
                if (data.needsVerification) {
                    setFormMessage(signupMessage, data.message || 'Verification email sent. Please check your inbox.', 'success');
                    showToast('Verification email sent', 'success', { icon: '✉' });
                    signupForm.reset();
                    return;
                }
                setFormMessage(signupMessage, 'Account created! Redirecting to login...', 'success');
                showToast('Account created!', 'success', { confetti: true, icon: '✓' });
                signupForm.reset();
                setTimeout(() => { window.location.href = 'login.html'; }, 900);
            } catch (err) {
                console.error('signup error', err);
                setFormMessage(signupMessage, 'Unable to reach server. Please try again.');
            }
        });
    }

    const forgotForm = document.getElementById('forgot-form');
    if (forgotForm && window.location.pathname.includes('forgot-password.html')) {
        const forgotMessage = document.getElementById('forgot-message');
        forgotForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            setFormMessage(forgotMessage, '');
            const email = document.getElementById('forgot-email')?.value?.trim() || '';
            if (!email) {
                setFormMessage(forgotMessage, 'Please enter your email address.');
                return;
            }
            try {
                const res = await fetch(API_BASE_URL + '/auth/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setFormMessage(forgotMessage, data.error || 'Unable to send reset link. Please try again.');
                    return;
                }
                if (data.resetUrl) {
                    const safeUrl = String(data.resetUrl || '').replace(/"/g, '&quot;');
                    setFormMessage(
                        forgotMessage,
                        `Reset link generated. <a href="${safeUrl}">Open reset page</a>`,
                        'success',
                        true
                    );
                    forgotForm.reset();
                    return;
                }
                if (data.emailSkipped) {
                    setFormMessage(forgotMessage, 'Email service is not configured yet. Please contact support to reset your password.', 'error');
                    return;
                }
                setFormMessage(forgotMessage, data.message || 'If this email is registered, a reset link has been sent.', 'success');
                forgotForm.reset();
            } catch (err) {
                console.error('forgot password error', err);
                setFormMessage(forgotMessage, 'Unable to reach server. Please try again.');
            }
        });
    }

    const verifyMessage = document.getElementById('verify-message');
    if (verifyMessage && window.location.pathname.includes('verify-email.html')) {
        const params = new URLSearchParams(window.location.search || '');
        const token = params.get('token') || '';
        if (!token) {
            setFormMessage(verifyMessage, 'Verification link is missing or invalid.', 'error');
        } else {
            (async () => {
                try {
                    const res = await fetch(API_BASE_URL + '/auth/verify-email', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ token })
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok) {
                        setFormMessage(verifyMessage, data.error || 'Unable to verify email.', 'error');
                        return;
                    }
                    setFormMessage(verifyMessage, data.message || 'Email verified successfully. You can now log in.', 'success');
                    setTimeout(() => { window.location.href = 'login.html'; }, 1500);
                } catch (err) {
                    console.error('verify email error', err);
                    setFormMessage(verifyMessage, 'Unable to verify email. Please try again.', 'error');
                }
            })();
        }
    }

    const resetForm = document.getElementById('reset-form');
    if (resetForm && window.location.pathname.includes('reset-password.html')) {
        const resetMessage = document.getElementById('reset-message');
        attachPasswordHint(
            document.getElementById('reset-password'),
            document.getElementById('reset-password-hint')
        );
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token') || '';
        if (!token) {
            setFormMessage(resetMessage, 'Reset link is invalid or missing.');
            resetForm.querySelectorAll('input').forEach(input => input.setAttribute('disabled', 'disabled'));
        }
        resetForm.addEventListener('submit', async function(event) {
            event.preventDefault();
            setFormMessage(resetMessage, '');
            const password = document.getElementById('reset-password')?.value || '';
            const confirm = document.getElementById('reset-confirm')?.value || '';
            if (!token) {
                setFormMessage(resetMessage, 'Reset link is invalid or missing.');
                return;
            }
            if (!password || !confirm) {
                setFormMessage(resetMessage, 'Please enter and confirm your new password.');
                return;
            }
            if (password !== confirm) {
                setFormMessage(resetMessage, 'Passwords do not match.');
                return;
            }
            if (!isStrongPassword(password)) {
                setFormMessage(resetMessage, PASSWORD_RULE_MESSAGE);
                return;
            }
            try {
                const res = await fetch(API_BASE_URL + '/auth/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token, password, confirmPassword: confirm })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    setFormMessage(resetMessage, data.error || 'Unable to reset password. Please try again.');
                    return;
                }
                setFormMessage(resetMessage, 'Password updated! Redirecting to login...', 'success');
                resetForm.reset();
                setTimeout(() => { window.location.href = 'login.html'; }, 1200);
            } catch (err) {
                console.error('reset password error', err);
                setFormMessage(resetMessage, 'Unable to reach server. Please try again.');
            }
        });
    }

    initProductDetailsPage();
    initCatalogFilters();

    // Load products if on home or products page
    Promise.resolve(loadProducts()).then(() => {
        refreshUserNotifications();
    });
});



















































