const express = require('express');
const mongoose = require('mongoose');
const dns = require('dns');
const cors = require('cors');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const fs = require('fs');
const vm = require('vm');
const cloudinary = require('cloudinary').v2;

// Ensure env vars load even when server.js is started from repo root.
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Optional: Override DNS servers for MongoDB SRV lookups if needed.
// Set DNS_SERVERS in .env like: DNS_SERVERS=8.8.8.8,1.1.1.1
const dnsServersEnv = (process.env.DNS_SERVERS || '').split(',').map((s) => s.trim()).filter(Boolean);
if (dnsServersEnv.length) {
  dns.setServers(dnsServersEnv);
  console.log(`Using custom DNS servers: ${dnsServersEnv.join(', ')}`);
}

const Product = require('./models/Product');
const User = require('./models/User');
const Order = require('./models/Order');
const Contact = require('./models/Contact');
const Cart = require('./models/Cart');
const Subscriber = require('./models/Subscriber');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors({
  origin: true,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  maxAge: 86400
}));
app.use(bodyParser.json({ limit: '10mb' }));

// Basic security headers (avoid breaking existing frontend scripts)
app.use((req, res, next) => {
  const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  if (isSecure) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('X-Download-Options', 'noopen');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  next();
});

// Simple in-memory rate limiter (use Redis or a gateway for multi-instance production)
const rateLimitStore = new Map();
function createRateLimiter({ windowMs = 15 * 60 * 1000, max = 100, keyGenerator }) {
  return (req, res, next) => {
    const key = keyGenerator ? keyGenerator(req) : (req.ip || 'unknown');
    const now = Date.now();
    const entry = rateLimitStore.get(key);
    if (!entry || now > entry.resetAt) {
      rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(max - 1));
      res.setHeader('X-RateLimit-Reset', String(Math.ceil((now + windowMs) / 1000)));
      return next();
    }
    entry.count += 1;
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));
    if (entry.count > max) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }
    return next();
  };
}

const generalLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 300, keyGenerator: (req) => (req.ip || 'unknown') + ':general' });
const authLimiter = createRateLimiter({ windowMs: 2 * 60 * 1000, max: 60, keyGenerator: (req) => (req.ip || 'unknown') + ':auth' });
const adminAuthLimiter = createRateLimiter({ windowMs: 2 * 60 * 1000, max: 60, keyGenerator: (req) => (req.ip || 'unknown') + ':admin-login' });
const paymentLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30, keyGenerator: (req) => (req.ip || 'unknown') + ':payment' });
const adminLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 40, keyGenerator: (req) => (req.ip || 'unknown') + ':admin' });

function isStaticAssetPath(pathname = '') {
  if (!pathname) return false;
  if (pathname.startsWith('/css/') || pathname.startsWith('/js/') || pathname.startsWith('/images/') || pathname.startsWith('/fonts/')) return true;
  return /\.(css|js|png|jpg|jpeg|gif|svg|ico|webp|mp4|woff|woff2|ttf|otf)$/i.test(pathname);
}

app.use((req, res, next) => {
  const pathName = req.path || '';
  if (req.method === 'GET' && (isStaticAssetPath(pathName) || pathName.endsWith('.html'))) {
    return next();
  }
  return generalLimiter(req, res, next);
});
app.use('/login', authLimiter);
app.use('/signup', authLimiter);
app.use('/auth/forgot-password', authLimiter);
app.use('/auth/reset-password', authLimiter);
app.use('/admin/login', adminAuthLimiter);
app.use('/admin/forgot-password', adminAuthLimiter);
app.use('/admin/reset-password', adminAuthLimiter);
app.use('/payments/create-order', paymentLimiter);
app.use('/checkout', paymentLimiter);
app.use('/admin', adminLimiter);

// Secret key for JWT (use environment variable in production)
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key_change_in_production';

// Payment gateway configuration
const RAZORPAY_KEY_ID = (process.env.RAZORPAY_KEY_ID || '').trim();
const RAZORPAY_KEY_SECRET = (process.env.RAZORPAY_KEY_SECRET || '').trim();
const isPlaceholderKey = (value = '') => {
  const lower = String(value).toLowerCase();
  return !lower || lower.includes('your_key_id_here') || lower.includes('your_key_secret_here');
};
const hasRazorpay = Boolean(RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET) &&
  !isPlaceholderKey(RAZORPAY_KEY_ID) &&
  !isPlaceholderKey(RAZORPAY_KEY_SECRET);
const razorpayClient = hasRazorpay
  ? new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET })
  : null;

// Cloudinary configuration (for product image uploads)
const CLOUDINARY_CLOUD_NAME = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
const CLOUDINARY_API_KEY = (process.env.CLOUDINARY_API_KEY || '').trim();
const CLOUDINARY_API_SECRET = (process.env.CLOUDINARY_API_SECRET || '').trim();
const CLOUDINARY_FOLDER = (process.env.CLOUDINARY_FOLDER || 'paithani-products').trim();
const hasCloudinary = Boolean(CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET);
const cloudinaryEnvProvided = Boolean(CLOUDINARY_CLOUD_NAME || CLOUDINARY_API_KEY || CLOUDINARY_API_SECRET);

if (hasCloudinary) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
    secure: true
  });
} else if (cloudinaryEnvProvided) {
  console.warn('Cloudinary credentials are incomplete. Product images will be stored as-is.');
}

// Admin credentials (set in .env)
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || '').trim();
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
let adminPasswordPlain = process.env.ADMIN_PASSWORD || '';
let adminPasswordHash = (process.env.ADMIN_PASSWORD_HASH || '').trim();
let adminResetTokenHash = (process.env.ADMIN_RESET_TOKEN_HASH || '').trim();
let adminResetExpires = Number(process.env.ADMIN_RESET_EXPIRES || 0);
const DEFAULT_BCRYPT_ROUNDS = 12;
const MAX_BCRYPT_ROUNDS = 14;
const MIN_BCRYPT_ROUNDS = 10;
const envBcryptRounds = Number(process.env.BCRYPT_SALT_ROUNDS);
const BCRYPT_ROUNDS = Number.isFinite(envBcryptRounds)
  ? Math.max(MIN_BCRYPT_ROUNDS, Math.min(MAX_BCRYPT_ROUNDS, Math.trunc(envBcryptRounds)))
  : DEFAULT_BCRYPT_ROUNDS;
const ENV_PATH = path.join(__dirname, '.env');

// Auto-hash plaintext admin password if present (writes to backend/.env when possible)
if (adminPasswordPlain && !adminPasswordHash) {
  try {
    const hash = bcrypt.hashSync(adminPasswordPlain, BCRYPT_ROUNDS);
    adminPasswordHash = hash;
    adminPasswordPlain = '';
    const envResult = updateEnvFile({
      ADMIN_PASSWORD_HASH: hash,
      ADMIN_PASSWORD: ''
    });
    if (envResult.updated) {
      console.log('Admin password hashed and saved to .env');
    } else {
      console.warn('Admin password hashed in memory. Please update backend/.env to persist after restart.');
    }
  } catch (err) {
    console.warn('Unable to hash plaintext admin password automatically', err);
  }
}

// App base URL for password reset links
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');

function resolveAppBaseUrl(req) {
  if (APP_BASE_URL) {
    try {
      return new URL(APP_BASE_URL).origin;
    } catch (err) {
      return String(APP_BASE_URL || '').replace(/\/+$/, '');
    }
  }
  const origin = String(req?.headers?.origin || '');
  const referer = String(req?.headers?.referer || '');
  const candidate = origin || referer;
  if (candidate) {
    try {
      return new URL(candidate).origin;
    } catch (err) {
      // ignore malformed origin
    }
  }
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  const forwardedHost = req?.headers?.['x-forwarded-host'];
  const host = req?.headers?.host;
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const baseHost = Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost;
  if (baseHost) return `${proto || 'https'}://${baseHost}`;
  if (host) return `${proto || req?.protocol || 'http'}://${host}`;
  return 'http://localhost:5000';
}

const DATA_URL_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

function isDataUrlImage(value) {
  return typeof value === 'string' && DATA_URL_IMAGE_RE.test(value);
}

async function uploadProductImageToCloudinary(dataUrl, { publicId } = {}) {
  if (!hasCloudinary || !dataUrl) return dataUrl;
  const options = {
    resource_type: 'image'
  };
  if (CLOUDINARY_FOLDER) options.folder = CLOUDINARY_FOLDER;
  if (publicId) options.public_id = publicId;
  const result = await cloudinary.uploader.upload(dataUrl, options);
  return result?.secure_url || result?.url || dataUrl;
}

async function resolveProductImage(imageValue) {
  if (!isDataUrlImage(imageValue)) return imageValue;
  if (!hasCloudinary) return imageValue;
  try {
    return await uploadProductImageToCloudinary(imageValue);
  } catch (err) {
    console.error('Cloudinary upload failed', err);
    throw new Error('Unable to upload product image to Cloudinary.');
  }
}

const ORDER_STATUS_FLOW = ['placed', 'paid', 'packed', 'shipped', 'delivered', 'returned', 'refunded', 'cancelled'];
const ORDER_STATUS_SET = new Set(ORDER_STATUS_FLOW);

function normalizeOrderStatus(value) {
  const raw = String(value || '').trim().toLowerCase();
  return ORDER_STATUS_SET.has(raw) ? raw : '';
}

function pushOrderStatusHistory(order, status, note = '', by = '') {
  if (!order) return;
  if (!Array.isArray(order.statusHistory)) {
    order.statusHistory = [];
  }
  order.statusHistory.push({
    status,
    note: note || '',
    at: new Date(),
    by: by || ''
  });
}

function applyOrderStatusTimestamps(order, status) {
  if (!order) return;
  const now = new Date();
  switch (status) {
    case 'packed':
      if (!order.packedAt) order.packedAt = now;
      break;
    case 'shipped':
      if (!order.shippedAt) order.shippedAt = now;
      break;
    case 'delivered':
      if (!order.deliveredAt) order.deliveredAt = now;
      break;
    case 'returned':
      if (!order.returnedAt) order.returnedAt = now;
      break;
    case 'refunded':
      if (!order.refundedAt) order.refundedAt = now;
      if (order.payment) order.payment.status = 'refunded';
      break;
    case 'cancelled':
      if (!order.cancelledAt) order.cancelledAt = now;
      break;
    default:
      break;
  }
}

function loadDefaultProducts() {
  const seedPath = path.join(__dirname, '../frontend/js/script.js');
  if (!fs.existsSync(seedPath)) return [];
  try {
    const content = fs.readFileSync(seedPath, 'utf8');
    const match = content.match(/const\s+productsData\s*=\s*\[([\s\S]*?)\];/);
    if (!match) return [];
    const arrayLiteral = `[${match[1]}]`;
    const data = vm.runInNewContext(arrayLiteral, {});
    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.error('product seed parse error', err);
    return [];
  }
}

function normalizeSeedProduct(item = {}, idx = 0) {
  const statusRaw = String(item?.status || '').toLowerCase();
  const status = ['available', 'new', 'preorder', 'soldout'].includes(statusRaw)
    ? statusRaw
    : (statusRaw.includes('new') ? 'new' : 'available');
  const price = Number(item?.price) || 0;
  const stock = Number.isFinite(Number(item?.stock)) ? Number(item.stock) : 0;
  const threshold = Number.isFinite(Number(item?.lowStockThreshold)) ? Number(item.lowStockThreshold) : 2;
  const discountValue = Number(item?.discountValue) || 0;
  return {
    name: item?.name || `Product ${idx + 1}`,
    price,
    description: item?.description || '',
    category: item?.category || 'Pure Silk Paithani',
    familyGroup: item?.familyGroup || '',
    image: item?.image || item?.img || '',
    sku: item?.sku || '',
    status,
    stock,
    lowStockThreshold: threshold,
    discountType: item?.discountType || 'none',
    discountValue,
    featured: Boolean(item?.featured),
    dateAdded: item?.dateAdded ? new Date(item.dateAdded) : new Date()
  };
}

async function seedProductsIfEmpty() {
  const shouldSeed = String(process.env.SEED_PRODUCTS_ON_START || 'true').toLowerCase();
  if (shouldSeed === 'false' || shouldSeed === '0') return;
  const count = await Product.countDocuments();
  if (count > 0) return;
  const defaults = loadDefaultProducts();
  if (!defaults.length) return;
  const docs = defaults.map(normalizeSeedProduct);
  await Product.insertMany(docs, { ordered: true });
  console.log(`? Seeded ${docs.length} default products`);
}

// Email (SMTP) configuration
const SMTP_HOST = (process.env.SMTP_HOST || '').trim();
const SMTP_PORT = Number(process.env.SMTP_PORT || 0);
const SMTP_USER = (process.env.SMTP_USER || '').trim();
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = (process.env.SMTP_FROM || SMTP_USER || 'paithanisareewebsite@gmail.com').trim();
const SMTP_TLS_REJECT_UNAUTHORIZED = String(process.env.SMTP_TLS_REJECT_UNAUTHORIZED || '').trim();
const smtpRejectUnauthorized = SMTP_TLS_REJECT_UNAUTHORIZED
  ? !(SMTP_TLS_REJECT_UNAUTHORIZED === '0' || SMTP_TLS_REJECT_UNAUTHORIZED.toLowerCase() === 'false')
  : true;
const isPlaceholder = (value = '') => {
  const lower = String(value || '').toLowerCase();
  return !lower || lower.includes('example.com') || lower.includes('your_') || lower.includes('changeme');
};
const hasSmtp = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS) &&
  !isPlaceholder(SMTP_HOST) &&
  !isPlaceholder(SMTP_USER) &&
  !isPlaceholder(SMTP_PASS);
const mailer = hasSmtp
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: smtpRejectUnauthorized }
    })
  : null;

// serve frontend static files (optional)
app.use(express.static(path.join(__dirname, '../frontend')));

// ============= HEALTH CHECK ENDPOINTS =============
app.get('/', (req, res) => {
  res.status(200).json({
    message: 'Paithani Saree API Server',
    status: 'running',
    version: '1.0.0'
  });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// MongoDB connection
const mongoUri = (process.env.MONGO_URI || '').trim();
if (!mongoUri) {
  console.error('? Missing MONGO_URI. Set it in backend/.env before starting the server.');
  process.exit(1);
}

mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 })
  .then(async () => {
    console.log('? MongoDB connected successfully');
    try {
      await seedProductsIfEmpty();
    } catch (err) {
      console.error('? Product seed error:', err);
    }
  })
  .catch((err) => {
    console.error('? MongoDB connection error:', err);
    process.exit(1);
  });

const SHIPPING_RATE_NASHIK = Number(process.env.SHIPPING_RATE_NASHIK || 200);
const SHIPPING_RATE_MAHARASHTRA = Number(process.env.SHIPPING_RATE_MAHARASHTRA || 300);
const SHIPPING_RATE_REST = Number(process.env.SHIPPING_RATE_REST || 500);
const TAX_RATE = Number(process.env.TAX_RATE || 0);

function roundRupees(value) {
  return Math.round(Number(value) || 0);
}

function calculateSubtotal(items = []) {
  return items.reduce((sum, item) => {
    const qty = Number(item.qty) || 0;
    const unit = Number(item.unitPrice) || 0;
    return sum + qty * unit;
  }, 0);
}

function normalizeLocationValue(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveShippingCharge(customer = {}) {
  const city = normalizeLocationValue(customer.city || '');
  const state = normalizeLocationValue(customer.state || '');
  const address = normalizeLocationValue(customer.address || '');
  const combined = `${city} ${state} ${address}`.trim();
  if (!combined) return 0;
  if (combined.includes('nashik')) return SHIPPING_RATE_NASHIK;
  if (state.includes('maharashtra') || combined.includes('maharashtra')) return SHIPPING_RATE_MAHARASHTRA;
  return SHIPPING_RATE_REST;
}

function calculateOrderTotals(items = [], customer = {}) {
  const subtotal = calculateSubtotal(items);
  const shipping = resolveShippingCharge(customer);
  const tax = roundRupees(subtotal * TAX_RATE);
  const total = roundRupees(subtotal + shipping + tax);
  return { subtotal, shipping, tax, total };
}

async function fetchCartItems(cartId, fallbackItems) {
  const cart = cartId ? await Cart.findOne({ cartId }) : null;
  const items = cart?.items?.length ? cart.items : (Array.isArray(fallbackItems) ? fallbackItems : []);
  return { cart, items };
}

function verifyRazorpaySignature({ orderId, paymentId, signature }) {
  if (!orderId || !paymentId || !signature || !RAZORPAY_KEY_SECRET) return false;
  const generatedSignature = crypto
    .createHmac('sha256', RAZORPAY_KEY_SECRET)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');
  return generatedSignature === signature;
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function isAdminConfigured() {
  return Boolean(ADMIN_USERNAME && (adminPasswordHash || adminPasswordPlain));
}

function signAdminToken(username) {
  return jwt.sign({ role: 'admin', username }, JWT_SECRET, { expiresIn: '8h' });
}

let adminPasswordWarned = false;
async function verifyAdminPassword(password) {
  if (adminPasswordHash) {
    return bcrypt.compare(password, adminPasswordHash);
  }
  if (adminPasswordPlain) {
    if (!adminPasswordWarned) {
      adminPasswordWarned = true;
      console.warn('Admin password is using plaintext env var. Set ADMIN_PASSWORD_HASH for stronger security.');
    }
    return safeEqual(password, adminPasswordPlain);
  }
  return false;
}

function updateEnvFile(updates = {}) {
  const keys = Object.keys(updates);
  if (!keys.length) return { updated: false };
  try {
    const raw = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    const lines = raw.split(/\r?\n/);
    keys.forEach((key) => {
      const value = updates[key];
      const idx = lines.findIndex(line => line.startsWith(`${key}=`));
      const nextLine = `${key}=${value}`;
      if (idx >= 0) {
        lines[idx] = nextLine;
      } else {
        lines.push(nextLine);
      }
    });
    fs.writeFileSync(ENV_PATH, lines.join('\n'));
    return { updated: true };
  } catch (err) {
    console.warn('env update error', err);
    return { updated: false, error: err };
  }
}

function createResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

function setAdminResetToken(tokenHash, expiresAt) {
  adminResetTokenHash = tokenHash;
  adminResetExpires = expiresAt;
  updateEnvFile({
    ADMIN_RESET_TOKEN_HASH: tokenHash,
    ADMIN_RESET_EXPIRES: String(expiresAt)
  });
}

function clearAdminResetToken() {
  adminResetTokenHash = '';
  adminResetExpires = 0;
  updateEnvFile({
    ADMIN_RESET_TOKEN_HASH: '',
    ADMIN_RESET_EXPIRES: ''
  });
}

function isAdminResetTokenValid(token) {
  if (!token || !adminResetTokenHash || !adminResetExpires) return false;
  if (Date.now() > adminResetExpires) return false;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  return safeEqual(tokenHash, adminResetTokenHash);
}

function requireUserAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.userId) {
      return res.status(403).json({ error: 'Invalid token payload' });
    }
    req.user = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function getAuthUserFromRequest(req) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || !payload.userId) return null;
    const user = await User.findById(payload.userId);
    return user || null;
  } catch (err) {
    return null;
  }
}

function requireAdminAuth(req, res, next) {
  const authHeader = String(req.headers.authorization || '');
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Admin authentication required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (!payload || payload.role !== 'admin') {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    req.admin = payload;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

async function sendEmail({ to, subject, text, html }) {
  if (!mailer) {
    return { ok: false, skipped: true };
  }
  try {
    await mailer.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
      html
    });
    return { ok: true };
  } catch (err) {
    console.error('email send error', err);
    return { ok: false, error: err };
  }
}

function getRequestIp(req) {
  const forwarded = String(req?.headers?.['x-forwarded-for'] || '');
  const ip = forwarded.split(',')[0].trim() || String(req?.ip || '').trim();
  return ip || 'unknown';
}

function formatLoginTimestamp() {
  return new Date().toISOString();
}

async function sendLoginNotifications(user, req) {
  if (!hasSmtp || !mailer || !user) return;
  const userEmail = String(user.email || '').trim().toLowerCase();
  if (!userEmail) return;
  const ip = getRequestIp(req);
  const agent = String(req?.headers?.['user-agent'] || '').trim();
  const timestamp = formatLoginTimestamp();
  const subject = 'New login to your Rudra Paithani account';
  const text = `Hi ${user.name || 'there'},\n\n` +
    `We noticed a login to your Rudra Paithani account.\n\n` +
    `Time: ${timestamp}\n` +
    `IP: ${ip}\n` +
    (agent ? `Device: ${agent}\n\n` : '\n') +
    `If this was you, no action is needed. If not, please reset your password immediately.`;
  const html = `
    <p>Hi ${user.name || 'there'},</p>
    <p>We noticed a login to your Rudra Paithani account.</p>
    <ul>
      <li><strong>Time:</strong> ${timestamp}</li>
      <li><strong>IP:</strong> ${ip}</li>
      ${agent ? `<li><strong>Device:</strong> ${agent}</li>` : ''}
    </ul>
    <p>If this was you, no action is needed. If not, please reset your password immediately.</p>
  `;
  const adminSubject = 'User login notification';
  const adminText = `User login detected.\n\nEmail: ${userEmail}\nTime: ${timestamp}\nIP: ${ip}\n` +
    (agent ? `Device: ${agent}\n` : '');
  const adminHtml = `
    <p>User login detected.</p>
    <ul>
      <li><strong>Email:</strong> ${userEmail}</li>
      <li><strong>Time:</strong> ${timestamp}</li>
      <li><strong>IP:</strong> ${ip}</li>
      ${agent ? `<li><strong>Device:</strong> ${agent}</li>` : ''}
    </ul>
  `;
  const sends = [
    sendEmail({ to: userEmail, subject, text, html })
  ];
  if (ADMIN_EMAIL) {
    sends.push(sendEmail({ to: ADMIN_EMAIL, subject: adminSubject, text: adminText, html: adminHtml }));
  }
  await Promise.allSettled(sends);
}

function computeStockStatus(product) {
  const status = String(product?.status || '').toLowerCase().trim();
  const category = String(product?.category || '').toLowerCase();
  const isPureSilk = category.includes('pure silk');
  if (status === 'preorder' || (isPureSilk && (!status || status === 'available'))) return 'preorder';
  const stock = Number(product?.stock);
  const threshold = Number(product?.lowStockThreshold) || 0;
  if (!Number.isFinite(stock)) return 'unknown';
  if (stock <= 0) return 'out_of_stock';
  if (stock <= threshold) return 'low_stock';
  return 'in_stock';
}

function normalizeItemQuantities(items = []) {
  const idQuantities = new Map();
  const skuQuantities = new Map();
  const invalidItems = [];
  items.forEach((item) => {
    const id = item?.id || item?._id || '';
    const sku = String(item?.sku || '').trim();
    const qty = Number(item?.qty) || 0;
    if (qty <= 0) return;
    const idStr = String(id || '').trim();
    if (idStr && mongoose.Types.ObjectId.isValid(idStr)) {
      idQuantities.set(idStr, (idQuantities.get(idStr) || 0) + qty);
      return;
    }
    if (sku) {
      skuQuantities.set(sku, (skuQuantities.get(sku) || 0) + qty);
      return;
    }
    if (idStr) {
      invalidItems.push({ id: idStr, name: item?.name || '', reason: 'invalid_id' });
    } else {
      invalidItems.push({ id: '', name: item?.name || '', reason: 'missing_identifier' });
    }
  });
  return { idQuantities, skuQuantities, invalidItems };
}

async function getInventorySnapshot(idQuantities, skuQuantities) {
  const ids = Array.from(idQuantities.keys());
  const skus = Array.from(skuQuantities.keys());
  if (!ids.length && !skus.length) {
    return { productsById: new Map(), productsBySku: new Map() };
  }
  const query = [];
  if (ids.length) query.push({ _id: { $in: ids } });
  if (skus.length) query.push({ sku: { $in: skus } });
  const products = await Product.find(query.length > 1 ? { $or: query } : query[0])
    .select('name stock lowStockThreshold sku');
  const productsById = new Map();
  const productsBySku = new Map();
  products.forEach((product) => {
    const id = String(product._id);
    productsById.set(id, product);
    if (product.sku) productsBySku.set(String(product.sku), product);
  });
  return { productsById, productsBySku };
}

function buildInventoryIssues(idQuantities, skuQuantities, productsById, productsBySku, invalidItems = []) {
  const issues = [];
  const resolvedQuantities = new Map(idQuantities);

  invalidItems.forEach((item) => {
    issues.push({
      id: item.id,
      name: item.name,
      reason: item.reason || 'invalid_id'
    });
  });

  for (const [sku, qty] of skuQuantities.entries()) {
    const product = productsBySku.get(sku);
    if (!product) {
      issues.push({ sku, qty, reason: 'sku_not_found' });
      continue;
    }
    const id = String(product._id);
    resolvedQuantities.set(id, (resolvedQuantities.get(id) || 0) + qty);
  }

  for (const [id, qty] of resolvedQuantities.entries()) {
    const product = productsById.get(id);
    if (!product) {
      issues.push({ id, qty, reason: 'not_found' });
      continue;
    }
    const stock = Number(product.stock);
    if (!Number.isFinite(stock)) {
      issues.push({ id, qty, name: product.name, reason: 'stock_unset' });
      continue;
    }
    if (stock < qty) {
      issues.push({
        id,
        qty,
        name: product.name,
        available: stock,
        reason: 'insufficient_stock'
      });
    }
  }
  return { issues, quantities: resolvedQuantities };
}

async function validateInventory(items) {
  const { idQuantities, skuQuantities, invalidItems } = normalizeItemQuantities(items);
  const { productsById, productsBySku } = await getInventorySnapshot(idQuantities, skuQuantities);
  const { issues, quantities } = buildInventoryIssues(idQuantities, skuQuantities, productsById, productsBySku, invalidItems);
  return { ok: issues.length === 0, issues, quantities };
}

async function applyInventoryDeductions(quantities) {
  const adjustments = [];
  for (const [id, qty] of quantities.entries()) {
    const result = await Product.updateOne(
      { _id: id, stock: { $gte: qty } },
      { $inc: { stock: -qty } }
    );
    if (!result || result.modifiedCount !== 1) {
      for (const adj of adjustments) {
        await Product.updateOne({ _id: adj.id }, { $inc: { stock: adj.qty } });
      }
      return { ok: false, issues: [{ id, qty, reason: 'insufficient_stock' }] };
    }
    adjustments.push({ id, qty });
  }
  return { ok: true };
}


async function restoreInventory(quantities) {
  if (!quantities) return;
  for (const [id, qty] of quantities.entries()) {
    await Product.updateOne({ _id: id }, { $inc: { stock: qty } });
  }
}

const PASSWORD_RULE_MESSAGE = 'Password must be at least 8 characters and include a letter, a number, and a special character';

function validatePasswordStrength(password) {
  const value = String(password || '');
  if (value.length < 8) return { ok: false, message: PASSWORD_RULE_MESSAGE };
  if (!/[A-Za-z]/.test(value)) return { ok: false, message: PASSWORD_RULE_MESSAGE };
  if (!/\d/.test(value)) return { ok: false, message: PASSWORD_RULE_MESSAGE };
  if (!/[^A-Za-z0-9]/.test(value)) return { ok: false, message: PASSWORD_RULE_MESSAGE };
  return { ok: true };
}
// ============= AUTH ENDPOINTS =============
app.post('/signup', async (req, res) => {
  try {
    const { name, email, password, confirmPassword, phone } = req.body;
    const normalizedName = String(name || '').trim();
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPhone = String(phone || '').trim();

    if (!normalizedName || !normalizedEmail || !password || !confirmPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ error: passwordCheck.message });
    }

    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const shouldVerify = Boolean(hasSmtp && mailer);
    let verifyToken = '';
    let verifyTokenHash = '';
    let verifyExpires = null;

    if (shouldVerify) {
      verifyToken = crypto.randomBytes(32).toString('hex');
      verifyTokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
      verifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    }

    const user = new User({
      name: normalizedName,
      email: normalizedEmail,
      password,
      phone: normalizedPhone,
      emailVerified: shouldVerify ? false : true,
      emailVerifyTokenHash: verifyTokenHash,
      emailVerifyExpires: verifyExpires
    });
    await user.save();

    if (shouldVerify) {
      const verifyUrl = `${resolveAppBaseUrl(req)}/verify-email.html?token=${verifyToken}`;
      const subject = 'Verify your Rudra Paithani account';
      const text = `Welcome to Rudra Paithani!\\n\\nPlease verify your email to activate your account:\\n${verifyUrl}\\n\\nThis link is valid for 24 hours.`;
      const html = `
        <p>Welcome to Rudra Paithani!</p>
        <p>Please verify your email to activate your account:</p>
        <p><a href="${verifyUrl}">Verify my email</a> (valid for 24 hours).</p>
      `;
      const emailResult = await sendEmail({ to: user.email, subject, text, html });
      if (!emailResult.ok) {
        return res.status(500).json({ error: 'Unable to send verification email. Please try again later.' });
      }
      return res.status(201).json({
        message: 'Verification email sent. Please check your inbox.',
        needsVerification: true
      });
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });
    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone }
    });
  } catch (err) {
    console.error('signup error', err);
    res.status(500).json({ error: 'Signup failed' });
  }
});

// Verify email
app.post('/auth/verify-email', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Token is required' });
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      emailVerifyTokenHash: tokenHash,
      emailVerifyExpires: { $gt: new Date() }
    });
    if (!user) {
      return res.status(400).json({ error: 'Verification link is invalid or expired' });
    }
    user.emailVerified = true;
    user.emailVerifyTokenHash = '';
    user.emailVerifyExpires = undefined;
    await user.save();
    return res.status(200).json({ message: 'Email verified successfully' });
  } catch (err) {
    console.error('verify email error', err);
    return res.status(500).json({ error: 'Unable to verify email' });
  }
});

// Resend verification email
app.post('/auth/resend-verification', async (req, res) => {
  try {
    if (!hasSmtp || !mailer) {
      return res.status(503).json({ error: 'Email service is not configured' });
    }
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(200).json({ message: 'If this email is registered, a verification link has been sent.' });
    }
    if (user.emailVerified !== false) {
      return res.status(200).json({ message: 'Email is already verified.' });
    }
    const token = crypto.randomBytes(32).toString('hex');
    user.emailVerifyTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    user.emailVerifyExpires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await user.save();

    const verifyUrl = `${resolveAppBaseUrl(req)}/verify-email.html?token=${token}`;
    const subject = 'Verify your Rudra Paithani account';
    const text = `Please verify your email to activate your account:\\n${verifyUrl}\\n\\nThis link is valid for 24 hours.`;
    const html = `
      <p>Please verify your email to activate your account:</p>
      <p><a href="${verifyUrl}">Verify my email</a> (valid for 24 hours).</p>
    `;
    const result = await sendEmail({ to: user.email, subject, text, html });
    if (!result.ok) {
      return res.status(500).json({ error: 'Unable to send verification email' });
    }
    return res.status(200).json({ message: 'Verification email sent. Please check your inbox.' });
  } catch (err) {
    console.error('resend verification error', err);
    return res.status(500).json({ error: 'Unable to resend verification email' });
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }
    if (user.isBlocked) {
      return res.status(403).json({ error: 'Account is blocked. Please contact support.' });
    }
    if (user.emailVerified === false) {
      return res.status(403).json({ error: 'Email not verified. Please check your inbox.', needsVerification: true });
    }

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

    rateLimitStore.delete((req.ip || 'unknown') + ':auth');
    sendLoginNotifications(user, req).catch((err) => {
      console.error('login notification error', err);
    });
    res.json({
      message: 'Login successful',
      token,
      user: { id: user._id, name: user.name, email: user.email, phone: user.phone }
    });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Current user profile
app.get('/me', requireUserAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('name email phone addresses defaultAddressId');
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ user });
  } catch (err) {
    console.error('me fetch error', err);
    return res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Update current user profile (name/phone only)
app.patch('/me', requireUserAuth, async (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const update = {};
    if (name) update.name = name;
    if (phone) update.phone = phone;
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      update,
      { returnDocument: 'after' }
    ).select('name email phone addresses defaultAddressId');
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json({ user });
  } catch (err) {
    console.error('profile update error', err);
    return res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
app.post('/me/password', requireUserAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'Current, new, and confirm password are required' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New passwords do not match' });
    }
    const passwordCheck = validatePasswordStrength(newPassword);
    if (!passwordCheck.ok) {
      return res.status(400).json({ error: passwordCheck.message });
    }
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const ok = await user.comparePassword(currentPassword);
    if (!ok) return res.status(400).json({ error: 'Current password is incorrect' });
    user.password = newPassword;
    await user.save();
    return res.status(200).json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error('password update error', err);
    return res.status(500).json({ error: 'Unable to update password' });
  }
});

function normalizeAddressPayload(body = {}) {
  return {
    label: String(body.label || '').trim(),
    line: String(body.line || '').trim(),
    city: String(body.city || '').trim(),
    state: String(body.state || '').trim(),
    zip: String(body.zip || '').trim(),
    country: String(body.country || 'India').trim() || 'India'
  };
}

app.post('/me/addresses', requireUserAuth, async (req, res) => {
  try {
    const payload = normalizeAddressPayload(req.body || {});
    if (!payload.line || !payload.city || !payload.state || !payload.zip) {
      return res.status(400).json({ error: 'Address line, city, state, and PIN code are required' });
    }
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const address = { id: new mongoose.Types.ObjectId().toString(), ...payload };
    user.addresses.push(address);
    if (!user.defaultAddressId) user.defaultAddressId = address.id;
    await user.save();
    return res.status(201).json({ address, addresses: user.addresses, defaultAddressId: user.defaultAddressId });
  } catch (err) {
    console.error('add address error', err);
    return res.status(500).json({ error: 'Failed to save address', details: err.message });
  }
});

app.put('/me/addresses/:id', requireUserAuth, async (req, res) => {
  try {
    const payload = normalizeAddressPayload(req.body || {});
    if (!payload.line || !payload.city || !payload.state || !payload.zip) {
      return res.status(400).json({ error: 'Address line, city, state, and PIN code are required' });
    }
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const idx = user.addresses.findIndex(addr => addr.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Address not found' });
    user.addresses[idx] = { ...user.addresses[idx].toObject?.() || user.addresses[idx], ...payload, id: user.addresses[idx].id };
    await user.save();
    return res.status(200).json({ addresses: user.addresses, defaultAddressId: user.defaultAddressId });
  } catch (err) {
    console.error('update address error', err);
    return res.status(500).json({ error: 'Failed to update address', details: err.message });
  }
});

app.delete('/me/addresses/:id', requireUserAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const before = user.addresses.length;
    user.addresses = user.addresses.filter(addr => addr.id !== req.params.id);
    if (user.addresses.length === before) {
      return res.status(404).json({ error: 'Address not found' });
    }
    if (user.defaultAddressId === req.params.id) {
      user.defaultAddressId = user.addresses[0]?.id || '';
    }
    await user.save();
    return res.status(200).json({ addresses: user.addresses, defaultAddressId: user.defaultAddressId });
  } catch (err) {
    console.error('delete address error', err);
    return res.status(500).json({ error: 'Failed to delete address', details: err.message });
  }
});

app.patch('/me/default-address', requireUserAuth, async (req, res) => {
  try {
    const addressId = String(req.body?.addressId || '').trim();
    if (!addressId) return res.status(400).json({ error: 'addressId is required' });
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const exists = user.addresses.some(addr => addr.id === addressId);
    if (!exists) return res.status(404).json({ error: 'Address not found' });
    user.defaultAddressId = addressId;
    await user.save();
    return res.status(200).json({ defaultAddressId: user.defaultAddressId });
  } catch (err) {
    console.error('default address error', err);
    return res.status(500).json({ error: 'Failed to update default address', details: err.message });
  }
});

// Current user's orders
app.get('/orders', requireUserAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('email');
    if (!user) return res.status(404).json({ error: 'User not found' });
    const email = String(user.email || '').toLowerCase();
    const safeEmail = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const orders = await Order.find({
      $or: [
        { userId: String(req.user.userId) },
        { 'customer.email': { $regex: new RegExp(`^${safeEmail}$`, 'i') } }
      ]
    }).sort({ createdAt: -1 }).limit(100);
    return res.status(200).json(orders);
  } catch (err) {
    console.error('fetch user orders error', err);
    return res.status(500).json({ error: 'Failed to fetch orders', details: err.message });
  }
});

// Track order by orderId + email (public)
app.post('/orders/track', async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const phone = String(req.body?.phone || '').trim();
    if (!orderId || !email) {
      return res.status(400).json({ error: 'orderId and email are required' });
    }
    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ error: 'Invalid orderId' });
    }

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const orderEmail = String(order?.customer?.email || '').trim().toLowerCase();
    if (!orderEmail || orderEmail !== email) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (phone) {
      const normalizePhone = (value) => String(value || '').replace(/\D/g, '');
      const inputPhone = normalizePhone(phone);
      const orderPhone = normalizePhone(order?.customer?.phone || '');
      if (inputPhone && orderPhone && inputPhone !== orderPhone) {
        return res.status(404).json({ error: 'Order not found' });
      }
    }

    return res.status(200).json({
      _id: order._id,
      status: order.status,
      statusHistory: order.statusHistory || [],
      tracking: order.tracking || {},
      packedAt: order.packedAt,
      shippedAt: order.shippedAt,
      deliveredAt: order.deliveredAt,
      returnedAt: order.returnedAt,
      refundedAt: order.refundedAt,
      cancelledAt: order.cancelledAt,
      payment: {
        status: order.payment?.status || '',
        provider: order.payment?.provider || ''
      },
      totals: {
        subtotal: order.subtotalAmount || 0,
        shipping: order.shippingAmount || 0,
        tax: order.taxAmount || 0,
        total: order.totalAmount || 0
      },
      items: Array.isArray(order.items) ? order.items : [],
      customer: {
        name: order.customer?.name || '',
        email: orderEmail,
        phone: order.customer?.phone || '',
        address: order.customer?.address || ''
      },
      createdAt: order.createdAt
    });
  } catch (err) {
    console.error('track order error', err);
    return res.status(500).json({ error: 'Unable to track order right now.' });
  }
});

// Cancel order within 2 days
app.post('/orders/:id/cancel', requireUserAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('email');
    const userEmail = String(user?.email || '').toLowerCase();
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const orderEmail = String(order?.customer?.email || '').toLowerCase();
    const belongsToUser = (order.userId && order.userId === String(req.user.userId)) ||
      (userEmail && orderEmail && userEmail === orderEmail);
    if (!belongsToUser) {
      return res.status(403).json({ error: 'Not authorized to cancel this order' });
    }

    const status = String(order.status || '').toLowerCase();
    if (['cancelled', 'packed', 'shipped', 'delivered', 'returned', 'refunded'].includes(status)) {
      return res.status(400).json({ error: `Order cannot be cancelled (status: ${status})` });
    }

    const createdAt = new Date(order.createdAt || 0).getTime();
    const now = Date.now();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    if (!createdAt || now - createdAt > twoDaysMs) {
      return res.status(400).json({ error: 'Order cancellation window has expired (2 days).' });
    }

    order.status = 'cancelled';
    applyOrderStatusTimestamps(order, 'cancelled');
    pushOrderStatusHistory(order, 'cancelled', 'Cancelled by customer', 'customer');
    const updated = await order.save();
    return res.status(200).json(updated);
  } catch (err) {
    console.error('order cancel error', err);
    return res.status(500).json({ error: 'Unable to cancel order', details: err.message });
  }
});

// Forgot password (send reset link)
app.post('/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const user = await User.findOne({ email });
    let emailResult = { ok: false, skipped: false };
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      user.resetPasswordTokenHash = tokenHash;
      user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000);
      await user.save();

      const resetUrl = `${resolveAppBaseUrl(req)}/reset-password.html?token=${token}`;
      const subject = 'Reset your Rudra Paithani account password';
      const text = `We received a request to reset your password.\n\nOpen this link to reset it (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`;
      const html = `
        <p>We received a request to reset your password.</p>
        <p><a href="${resetUrl}">Click here to reset your password</a> (valid for 1 hour).</p>
        <p>If you did not request this, you can ignore this email.</p>
      `;
      try {
        if (hasSmtp && mailer) {
          emailResult = await sendEmail({ to: user.email, subject, text, html });
        }
      } catch (err) {
        console.error('forgot password email error', err);
        emailResult = { ok: false, skipped: true };
      }

      if (!hasSmtp || !mailer || emailResult.skipped) {
        return res.status(200).json({
          message: 'Reset link generated. Email service is not configured yet.',
          resetUrl,
          emailSent: false,
          emailSkipped: true
        });
      }

      if (!emailResult.ok) {
        return res.status(500).json({
          error: 'Unable to send reset email. Please try again later.',
          emailSent: false
        });
      }
    }
    return res.status(200).json({
      message: 'If this email is registered, a reset link has been sent.',
      emailSent: emailResult.ok,
      emailSkipped: emailResult.skipped
    });
  } catch (err) {
    console.error('forgot password error', err);
    return res.status(500).json({ error: 'Unable to process request', details: err.message });
  }
});

// Reset password with token
app.post('/auth/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    if (!token || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Token, password, and confirmPassword are required' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ error: passwordCheck.message });
    }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await User.findOne({
      resetPasswordTokenHash: tokenHash,
      resetPasswordExpires: { $gt: new Date() }
    });
    if (!user) {
      return res.status(400).json({ error: 'Reset link is invalid or expired' });
    }
    user.password = password;
    user.resetPasswordTokenHash = '';
    user.resetPasswordExpires = undefined;
    await user.save();
    return res.status(200).json({ message: 'Password reset successful' });
  } catch (err) {
    console.error('reset password error', err);
    return res.status(500).json({ error: 'Unable to reset password', details: err.message });
  }
});

// Admin login (token-based)
app.post('/admin/login', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!isAdminConfigured()) {
    return res.status(503).json({ error: 'Admin credentials not configured' });
  }
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const ok = safeEqual(username, ADMIN_USERNAME) && await verifyAdminPassword(password);
  if (!ok) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signAdminToken(username);
  rateLimitStore.delete((req.ip || 'unknown') + ':admin-login');
  return res.status(200).json({ token });
});

// Admin forgot password (send reset link)
app.post('/admin/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const username = String(req.body?.username || '').trim();
    const isMatch = Boolean(
      ADMIN_EMAIL &&
      email &&
      safeEqual(email, ADMIN_EMAIL) &&
      (!username || safeEqual(username, ADMIN_USERNAME))
    );

    if (isMatch) {
      const { token, tokenHash } = createResetToken();
      const expiresAt = Date.now() + 60 * 60 * 1000;
      setAdminResetToken(tokenHash, expiresAt);
      const resetUrl = `${resolveAppBaseUrl(req)}/admin-reset-password.html?token=${token}`;
      if (hasSmtp && mailer) {
        try {
          await mailer.sendMail({
            from: SMTP_FROM,
            to: ADMIN_EMAIL,
            subject: 'Reset your admin password',
            text: `We received a request to reset the admin password.\n\nOpen this link to reset it (valid for 1 hour):\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
            html: `
              <p>We received a request to reset the admin password.</p>
              <p><a href="${resetUrl}">Click here to reset it</a> (valid for 1 hour).</p>
              <p>If you did not request this, you can ignore this email.</p>
            `
          });
        } catch (err) {
          console.error('admin reset email error', err);
          return res.status(500).json({
            error: 'Unable to send reset email. Please try again later.',
            emailSent: false
          });
        }
      } else {
        return res.status(200).json({
          message: 'Reset link generated. SMTP not configured, use the link below.',
          resetUrl,
          emailSent: false,
          emailSkipped: true
        });
      }
    }
    return res.status(200).json({
      message: 'If the admin account is configured, a reset link has been sent.'
    });
  } catch (err) {
    console.error('admin forgot password error', err);
    return res.status(500).json({ error: 'Unable to process admin reset request' });
  }
});

// Admin reset password with token
app.post('/admin/reset-password', async (req, res) => {
  try {
    const token = String(req.body?.token || '');
    const password = String(req.body?.password || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    if (!token || !password || !confirmPassword) {
      return res.status(400).json({ error: 'Token, password, and confirmPassword are required' });
    }
    if (password !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' });
    }
    const passwordCheck = validatePasswordStrength(password);
    if (!passwordCheck.ok) {
      return res.status(400).json({ error: passwordCheck.message });
    }
    if (!isAdminResetTokenValid(token)) {
      return res.status(400).json({ error: 'Reset token is invalid or expired' });
    }
    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    adminPasswordHash = hash;
    adminPasswordPlain = '';
    clearAdminResetToken();
    updateEnvFile({
      ADMIN_PASSWORD_HASH: hash,
      ADMIN_PASSWORD: ''
    });
    return res.status(200).json({ message: 'Admin password reset successful' });
  } catch (err) {
    console.error('admin reset password error', err);
    return res.status(500).json({ error: 'Unable to reset admin password' });
  }
});

// ============= CART ENDPOINTS =============
app.get('/cart/:cartId', async (req, res) => {
  try {
    const cart = await Cart.findOne({ cartId: req.params.cartId });
    if (!cart) return res.status(200).json({ cartId: req.params.cartId, items: [] });
    return res.status(200).json(cart);
  } catch (err) {
    console.error('fetch cart error', err);
    return res.status(500).json({ error: 'Failed to fetch cart' });
  }
});

app.put('/cart/:cartId', async (req, res) => {
  try {
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    const updated = await Cart.findOneAndUpdate(
      { cartId: req.params.cartId },
      { cartId: req.params.cartId, items, updatedAt: new Date() },
      { upsert: true, returnDocument: 'after' }
    );
    return res.status(200).json(updated);
  } catch (err) {
    console.error('update cart error', err);
    return res.status(500).json({ error: 'Failed to update cart' });
  }
});

app.delete('/cart/:cartId', async (req, res) => {
  try {
    await Cart.deleteOne({ cartId: req.params.cartId });
    return res.status(200).json({ message: 'Cart cleared' });
  } catch (err) {
    console.error('delete cart error', err);
    return res.status(500).json({ error: 'Failed to clear cart' });
  }
});

// ============= PAYMENT ENDPOINTS =============
function buildRazorpayReceipt(cartId = '') {
  const safeCart = String(cartId).replace(/[^a-zA-Z0-9]/g, '');
  const ts = Date.now().toString(36);
  const tail = safeCart.slice(-6);
  let receipt = `c${ts}${tail ? `_${tail}` : ''}`;
  if (receipt.length > 40) {
    receipt = receipt.slice(0, 40);
  }
  return receipt;
}

app.post('/payments/create-order', async (req, res) => {
  if (!hasRazorpay) {
    return res.status(503).json({ error: 'Payment gateway not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to .env.' });
  }

  try {
    const { cartId, items: fallbackItems, customer } = req.body;
    if (!cartId) return res.status(400).json({ error: 'cartId is required' });

    const { items } = await fetchCartItems(cartId, fallbackItems);
    if (!items.length) return res.status(400).json({ error: 'Cart is empty' });

    const inventoryCheck = await validateInventory(items);
    if (!inventoryCheck.ok) {
      return res.status(409).json({ error: 'Some items are out of stock', issues: inventoryCheck.issues });
    }

    const totals = calculateOrderTotals(items, customer);
    const amountPaise = Math.round(totals.total * 100);
    if (amountPaise < 100) return res.status(400).json({ error: 'Amount must be at least Rs 1' });

    const receipt = buildRazorpayReceipt(cartId);
    const order = await razorpayClient.orders.create({
      amount: amountPaise,
      currency: 'INR',
      receipt,
      notes: {
        cartId,
        customerName: customer?.name || '',
        customerEmail: customer?.email || '',
        customerPhone: customer?.phone || ''
      }
    });

    return res.status(201).json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receipt: order.receipt,
      keyId: RAZORPAY_KEY_ID,
      totals
    });
  } catch (err) {
    const details = err?.error?.description || err?.error?.message || err?.message || '';
    console.error('create razorpay order error', details || err);
    return res.status(500).json({ error: 'Unable to create payment order', details });
  }
});

// ============= CHECKOUT ENDPOINT =============
app.post('/checkout', async (req, res) => {
  let inventoryAdjusted = null;
  try {
    const { cartId, customer, items: fallbackItems, payment } = req.body;
    if (!cartId) return res.status(400).json({ error: 'cartId is required' });

    const authUser = await getAuthUserFromRequest(req);
    const { cart, items } = await fetchCartItems(cartId, fallbackItems);
    if (!items.length) return res.status(400).json({ error: 'Cart is empty' });

    const totals = calculateOrderTotals(items, customer);
    const totalAmount = totals.total;

    let paymentInfo = {
      provider: payment?.provider || '',
      status: 'pending',
      amount: totalAmount,
      currency: 'INR',
      orderId: payment?.orderId || '',
      paymentId: payment?.paymentId || '',
      signature: payment?.signature || '',
      receipt: payment?.receipt || ''
    };

    if (paymentInfo.provider === 'razorpay') {
      if (!hasRazorpay) {
        return res.status(503).json({ error: 'Payment gateway not configured on server' });
      }
      const isValid = verifyRazorpaySignature({
        orderId: paymentInfo.orderId,
        paymentId: paymentInfo.paymentId,
        signature: paymentInfo.signature
      });
      if (!isValid) {
        return res.status(400).json({ error: 'Payment verification failed' });
      }
      paymentInfo.status = 'paid';
      paymentInfo.verifiedAt = new Date();
    }

    const inventoryCheck = await validateInventory(items);
    if (!inventoryCheck.ok) {
      return res.status(409).json({ error: 'Some items are out of stock', issues: inventoryCheck.issues });
    }

    const inventoryDeduction = await applyInventoryDeductions(inventoryCheck.quantities);
    if (!inventoryDeduction.ok) {
      const refresh = await validateInventory(items);
      return res.status(409).json({
        error: 'Inventory changed. Some items are no longer available.',
        issues: refresh.issues.length ? refresh.issues : inventoryDeduction.issues
      });
    }

    inventoryAdjusted = inventoryCheck.quantities;

    // Order status tracks fulfillment; payment status lives under payment.status.
    let derivedStatus = 'placed';
    const statusHistory = [
      { status: 'placed', note: 'Order placed', at: new Date(), by: 'system' }
    ];
    if (paymentInfo.status === 'paid') {
      derivedStatus = 'paid';
      statusHistory.push({ status: 'paid', note: 'Payment captured', at: new Date(), by: 'system' });
    }

    const customerEmail = String(customer?.email || authUser?.email || '').trim().toLowerCase();
    const order = new Order({
      userId: authUser ? String(authUser._id) : '',
      cartId,
      customer: {
        name: customer?.name || authUser?.name || '',
        email: customerEmail,
        phone: customer?.phone || authUser?.phone || '',
        address: customer?.address || ''
      },
      items,
      subtotalAmount: totals.subtotal,
      shippingAmount: totals.shipping,
      taxAmount: totals.tax,
      totalAmount,
      status: derivedStatus,
      statusHistory,
      payment: paymentInfo
    });

    await order.save();

    if (cart) {
      cart.items = [];
      cart.updatedAt = new Date();
      await cart.save();
    }

    if (customerEmail) {
      const subject = `Order confirmation - ${order._id}`;
      const itemsList = items.map(item => `- ${item.qty || 1} x ${item.name || 'Item'}`).join('\n');
      const text = `Thank you for your order!\n\nOrder ID: ${order._id}\nSubtotal: Rs ${totals.subtotal}\nShipping: Rs ${totals.shipping}\nTotal: Rs ${totalAmount}\nStatus: ${derivedStatus}\n\nItems:\n${itemsList}\n\nWe will update you when your order ships.`;
      const html = `
        <p>Thank you for your order!</p>
        <p><strong>Order ID:</strong> ${order._id}</p>
        <p><strong>Subtotal:</strong> Rs ${totals.subtotal}</p>
        <p><strong>Shipping:</strong> Rs ${totals.shipping}</p>
        <p><strong>Total:</strong> Rs ${totalAmount}</p>
        <p><strong>Status:</strong> ${derivedStatus}</p>
        <p><strong>Items:</strong></p>
        <ul>${items.map(item => `<li>${item.qty || 1} × ${item.name || 'Item'}</li>`).join('')}</ul>
        <p>We will update you when your order ships.</p>
      `;
      await sendEmail({ to: customerEmail, subject, text, html });
    }

    return res.status(201).json({
      message: paymentInfo.status === 'paid' ? 'Payment successful and order placed' : 'Order placed. Awaiting payment.',
      orderId: order._id,
      paymentStatus: paymentInfo.status,
      totals: {
        subtotal: totals.subtotal,
        shipping: totals.shipping,
        tax: totals.tax,
        total: totalAmount
      }
    });
  } catch (err) {
    if (inventoryAdjusted) {
      try {
        await restoreInventory(inventoryAdjusted);
      } catch (rollbackErr) {
        console.error('inventory rollback failed', rollbackErr);
      }
    }
    console.error('checkout error', err);
    return res.status(500).json({ error: 'Checkout failed' });
  }
});

// Protect admin routes (except /admin/login which is defined earlier)
app.use('/admin', requireAdminAuth);

// ============= ADMIN ENDPOINTS =============
app.post('/admin/password', async (req, res) => {
  try {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    const confirmPassword = String(req.body?.confirmPassword || '');
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'Current, new, and confirm password are required' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New passwords do not match' });
    }
    const passwordCheck = validatePasswordStrength(newPassword);
    if (!passwordCheck.ok) {
      return res.status(400).json({ error: passwordCheck.message });
    }
    const ok = await verifyAdminPassword(currentPassword);
    if (!ok) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    adminPasswordHash = hash;
    adminPasswordPlain = '';
    const envResult = updateEnvFile({
      ADMIN_PASSWORD_HASH: hash,
      ADMIN_PASSWORD: ''
    });
    const message = envResult.updated
      ? 'Admin password updated successfully'
      : 'Admin password updated. Please update backend/.env to persist after restart.';
    return res.status(200).json({ message });
  } catch (err) {
    console.error('admin password update error', err);
    return res.status(500).json({ error: 'Unable to update admin password' });
  }
});

app.get('/admin/orders', async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 }).limit(100);
    return res.status(200).json(orders);
  } catch (err) {
    console.error('fetch orders error', err);
    return res.status(500).json({ error: 'Failed to fetch orders', details: err.message });
  }
});

app.get('/admin/contacts', async (req, res) => {
  try {
    const messages = await Contact.find({}).sort({ createdAt: -1 }).limit(100);
    return res.status(200).json(messages);
  } catch (err) {
    console.error('fetch contacts error', err);
    return res.status(500).json({ error: 'Failed to fetch contacts', details: err.message });
  }
});

app.get('/contacts', async (req, res) => {
  try {
    const emailRaw = String(req.query?.email || '').trim();
    if (!emailRaw) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const safeEmail = emailRaw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const messages = await Contact.find({
      email: { $regex: new RegExp(`^${safeEmail}$`, 'i') }
    }).sort({ createdAt: -1 }).limit(50);
    return res.status(200).json(messages);
  } catch (err) {
    console.error('fetch contact replies error', err);
    return res.status(500).json({ error: 'Failed to fetch messages', details: err.message });
  }
});

app.post('/contacts', async (req, res) => {
  try {
    const { name, email, message } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const contact = new Contact({ name, email, message });
    const saved = await contact.save();

    return res.status(201).json({ message: 'Message saved successfully', contact: saved });
  } catch (err) {
    console.error('save contact error', err);
    return res.status(500).json({ error: 'Failed to save message', details: err.message });
  }
});

app.post('/subscribe', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    const existing = await Subscriber.findOne({ email });
    if (existing) {
      return res.status(200).json({ message: 'You are already subscribed.', subscribed: false, already: true });
    }
    const subscriber = new Subscriber({ email });
    await subscriber.save();

    const userSubject = 'Welcome to Rudra Paithani updates';
    const userText = 'Thanks for subscribing to Rudra Paithani Yeola updates. ' +
      'We will share new arrivals, offers, and important updates with you.';
    const userHtml = `
      <p>Thanks for subscribing to Rudra Paithani Yeola updates.</p>
      <p>We will share new arrivals, offers, and important updates with you.</p>
    `;
    const adminSubject = 'New newsletter subscriber';
    const adminText = `New subscriber: ${email}`;
    const adminHtml = `<p>New subscriber: <strong>${email}</strong></p>`;

    const sends = [];
    if (hasSmtp && mailer) {
      sends.push(sendEmail({ to: email, subject: userSubject, text: userText, html: userHtml }));
      if (ADMIN_EMAIL) {
        sends.push(sendEmail({ to: ADMIN_EMAIL, subject: adminSubject, text: adminText, html: adminHtml }));
      }
      await Promise.allSettled(sends);
    }

    return res.status(201).json({ message: 'Thanks for subscribing!', subscribed: true });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(200).json({ message: 'You are already subscribed.', subscribed: false, already: true });
    }
    console.error('subscribe error', err);
    return res.status(500).json({ error: 'Unable to subscribe right now.' });
  }
});

app.get('/admin/users', async (req, res) => {
  try {
    const users = await User.find({}).select('-password -__v').sort({ createdAt: -1 }).limit(100);
    return res.status(200).json(users);
  } catch (err) {
    console.error('fetch users error', err);
    return res.status(500).json({ error: 'Failed to fetch users', details: err.message });
  }
});

app.patch('/admin/orders/:id', async (req, res) => {
  try {
    const incomingStatus = req.body?.status;
    const nextStatus = normalizeOrderStatus(incomingStatus);
    const trackingPayload = req.body?.tracking && typeof req.body.tracking === 'object'
      ? req.body.tracking
      : {};
    const note = String(req.body?.note || '').trim();

    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    let updated = false;

    if (incomingStatus !== undefined) {
      if (!nextStatus) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      if (order.status !== nextStatus) {
        order.status = nextStatus;
        if (nextStatus === 'paid' && order.payment) {
          order.payment.status = 'paid';
        }
        pushOrderStatusHistory(order, nextStatus, note || `Status updated to ${nextStatus}`, 'admin');
        applyOrderStatusTimestamps(order, nextStatus);
        updated = true;
      }
    }

    const trackingUpdates = {
      carrier: trackingPayload.carrier ?? req.body?.carrier,
      trackingNumber: trackingPayload.trackingNumber ?? req.body?.trackingNumber,
      trackingUrl: trackingPayload.trackingUrl ?? req.body?.trackingUrl
    };
    Object.entries(trackingUpdates).forEach(([key, value]) => {
      if (value !== undefined) {
        if (!order.tracking) order.tracking = {};
        order.tracking[key] = String(value || '').trim();
        updated = true;
      }
    });

    if (!updated) {
      return res.status(400).json({ error: 'No updates supplied' });
    }

    const saved = await order.save();
    return res.status(200).json(saved);
  } catch (err) {
    console.error('update order status error', err);
    return res.status(500).json({ error: 'Failed to update order', details: err.message });
  }
});

app.patch('/admin/users/:id', async (req, res) => {
  try {
    const isBlocked = Boolean(req.body?.isBlocked);
    const update = { isBlocked, blockedAt: isBlocked ? new Date() : null };
    const updated = await User.findByIdAndUpdate(
      req.params.id,
      update,
      { returnDocument: 'after' }
    ).select('-password -__v');
    if (!updated) return res.status(404).json({ error: 'User not found' });
    return res.status(200).json(updated);
  } catch (err) {
    console.error('update user status error', err);
    return res.status(500).json({ error: 'Failed to update user', details: err.message });
  }
});

app.patch('/admin/contacts/:id/reply', async (req, res) => {
  try {
    const reply = String(req.body?.reply || '').trim();
    if (!reply) {
      return res.status(400).json({ error: 'Reply is required' });
    }
    const updated = await Contact.findByIdAndUpdate(
      req.params.id,
      { reply, status: 'replied', repliedAt: new Date() },
      { returnDocument: 'after' }
    );
    if (!updated) return res.status(404).json({ error: 'Message not found' });
    let emailResult = { ok: false, skipped: true };
    if (updated.email) {
      const subject = 'Reply from Rudra Paithani Yeola';
      const text = `Hello ${updated.name || ''},\n\n${reply}\n\n— Rudra Paithani Yeola`;
      const html = `
        <p>Hello ${updated.name || ''},</p>
        <p>${reply.replace(/\n/g, '<br>')}</p>
        <p>— Rudra Paithani Yeola</p>
      `;
      emailResult = await sendEmail({ to: updated.email, subject, text, html });
    }
    return res.status(200).json({
      ...updated.toObject(),
      emailSent: emailResult.ok,
      emailSkipped: emailResult.skipped
    });
  } catch (err) {
    console.error('reply message error', err);
    return res.status(500).json({ error: 'Failed to send reply', details: err.message });
  }
});

// ============= PUBLIC PRODUCT ENDPOINTS (for customers) =============
app.get('/products', async (req, res) => {
  try {
    const products = await Product.find({}).sort({ dateAdded: -1 });
    const response = products.map((product) => ({ ...product.toObject(), stockStatus: computeStockStatus(product) }));
    return res.status(200).json(response);
  } catch (err) {
    console.error('fetch products error', err);
    return res.status(500).json({ error: 'Failed to fetch products', details: err.message });
  }
});

app.get('/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    return res.status(200).json({ ...product.toObject(), stockStatus: computeStockStatus(product) });
  } catch (err) {
    console.error('fetch single product error', err);
    return res.status(500).json({ error: 'Failed to fetch product', details: err.message });
  }
});

// ============= ADMIN-PROTECTED PRODUCT ENDPOINTS =============
app.get('/admin/products', async (req, res) => {
  try {
    const products = await Product.find({}).sort({ dateAdded: -1 });
    const response = products.map((product) => ({ ...product.toObject(), stockStatus: computeStockStatus(product) }));
    return res.status(200).json(response);
  } catch (err) {
    console.error('admin fetch products error', err);
    return res.status(500).json({ error: 'Failed to fetch products', details: err.message });
  }
});

app.get('/admin/products/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: 'Product not found' });
    return res.status(200).json({ ...product.toObject(), stockStatus: computeStockStatus(product) });
  } catch (err) {
    console.error('admin fetch single product error', err);
    return res.status(500).json({ error: 'Failed to fetch product', details: err.message });
  }
});

  app.post('/admin/products', async (req, res) => {
    try {
      const { name, price, description, image, category, familyGroup, sku, status, stock, lowStockThreshold, discountType, discountValue, featured } = req.body;

      if (!name || price === undefined || !String(description || '').trim()) {
        return res.status(400).json({ error: 'Name, price, and description are required' });
      }

      const resolvedImage = await resolveProductImage(image);
      const prod = new Product({
        name,
        price,
        description,
        image: resolvedImage,
        category,
        familyGroup,
        sku,
        status: status || 'new',
        stock,
      lowStockThreshold,
      featured: Boolean(featured),
      discountType: discountType || 'none',
      discountValue: Number(discountValue) || 0,
      dateAdded: new Date()
    });
    const saved = await prod.save();
    return res.status(201).json(saved);
  } catch (err) {
    console.error('admin save product error', err);
    return res.status(400).json({ error: 'Bad request', details: err.message });
  }
});

  app.put('/admin/products/:id', async (req, res) => {
    try {
      const { name, price, description, image, category, familyGroup, sku, status, stock, lowStockThreshold, discountType, discountValue, featured } = req.body;
      const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (price !== undefined) updateData.price = price;
    if (description !== undefined) updateData.description = description;
      if (category !== undefined) updateData.category = category;
      if (familyGroup !== undefined) updateData.familyGroup = familyGroup;
      if (image !== undefined) updateData.image = await resolveProductImage(image);
    if (sku !== undefined) updateData.sku = sku;
    if (status !== undefined) updateData.status = status;
    if (stock !== undefined) updateData.stock = stock;
    if (lowStockThreshold !== undefined) updateData.lowStockThreshold = lowStockThreshold;
    if (discountType !== undefined) updateData.discountType = discountType || 'none';
    if (discountValue !== undefined) updateData.discountValue = Number(discountValue) || 0;
    if (featured !== undefined) updateData.featured = Boolean(featured);

    const updated = await Product.findByIdAndUpdate(
      req.params.id,
      updateData,
      { returnDocument: 'after', runValidators: true }
    );
    if (!updated) return res.status(404).json({ error: 'Product not found' });
    return res.status(200).json(updated);
  } catch (err) {
    console.error('admin update product error', err);
    return res.status(400).json({ error: 'Bad request', details: err.message });
  }
});

app.delete('/admin/products/:id', async (req, res) => {
  try {
    const removed = await Product.findByIdAndDelete(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Product not found' });
    return res.status(200).json({ message: 'Product deleted successfully', product: removed });
  } catch (err) {
    console.error('admin delete product error', err);
    return res.status(500).json({ error: 'Failed to delete', details: err.message });
  }
});

// ============= LEGACY PUBLIC ENDPOINTS (deprecated, kept for backward compatibility) =============
app.post('/products', async (req, res) => {
  return res.status(403).json({ error: 'Use /admin/products to create products' });
});

app.put('/products/:id', async (req, res) => {
  return res.status(403).json({ error: 'Use /admin/products/:id to update products' });
});

app.delete('/products/:id', async (req, res) => {
  return res.status(403).json({ error: 'Use /admin/products/:id to delete products' });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log('??????????????????????????????');
  console.log(' Paithani Saree Store API');
  console.log(' Status: Running');
  console.log(` Port: ${PORT}`);
  console.log(` URL: http://localhost:${PORT}`);
  console.log(` Razorpay enabled: ${hasRazorpay ? 'yes' : 'no (set keys in .env)'}`);
  console.log('??????????????????????????????');
});
