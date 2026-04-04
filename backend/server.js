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

// Ensure env vars load even when server.js is started from repo root.
require('dotenv').config({ path: path.join(__dirname, '.env') });

// Prefer public DNS resolvers for MongoDB SRV lookups (avoids local DNS issues).
dns.setServers(['8.8.8.8', '1.1.1.1']);

const Product = require('./models/Product');
const User = require('./models/User');
const Order = require('./models/Order');
const Contact = require('./models/Contact');
const Cart = require('./models/Cart');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
app.use(bodyParser.json());

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
const authLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 100, keyGenerator: (req) => (req.ip || 'unknown') + ':auth' });
const adminAuthLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 120, keyGenerator: (req) => (req.ip || 'unknown') + ':admin-login' });
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

// App base URL for password reset links
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');

function resolveAppBaseUrl(req) {
  if (APP_BASE_URL) return APP_BASE_URL;
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
const hasSmtp = Boolean(SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS);
const mailer = hasSmtp
  ? nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
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

function calculateTotalAmount(items = []) {
  return items.reduce((sum, item) => {
    const qty = Number(item.qty) || 0;
    const unit = Number(item.unitPrice) || 0;
    return sum + qty * unit;
  }, 0);
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

    const user = new User({
      name: normalizedName,
      email: normalizedEmail,
      password,
      phone: normalizedPhone
    });
    await user.save();

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

    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      return res.status(400).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user._id, email: user.email }, JWT_SECRET, { expiresIn: '7d' });

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
      { new: true }
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

// Forgot password (send reset link)
app.post('/auth/forgot-password', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    const user = await User.findOne({ email });
    let emailResult = { ok: false, skipped: true };
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
          return res.status(200).json({
            message: 'Reset link generated. Email service is not configured yet.',
            resetUrl
          });
        }
      } else {
        return res.status(200).json({
          message: 'Reset link generated. SMTP not configured, use the link below.',
          resetUrl
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
      { upsert: true, new: true }
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

    const totalAmount = calculateTotalAmount(items);
    const amountPaise = Math.round(totalAmount * 100);
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
      keyId: RAZORPAY_KEY_ID
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

    const totalAmount = calculateTotalAmount(items);

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
    const derivedStatus = 'placed';

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
      totalAmount,
      status: derivedStatus,
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
      const text = `Thank you for your order!\n\nOrder ID: ${order._id}\nTotal: Rs ${totalAmount}\nStatus: ${derivedStatus}\n\nItems:\n${itemsList}\n\nWe will update you when your order ships.`;
      const html = `
        <p>Thank you for your order!</p>
        <p><strong>Order ID:</strong> ${order._id}</p>
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
      paymentStatus: paymentInfo.status
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
    const { status } = req.body;
    const allowed = ['placed', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const updated = await Order.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Order not found' });
    return res.status(200).json(updated);
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
      { new: true }
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
      { new: true }
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

// ============= PRODUCT ENDPOINTS =============
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

app.post('/products', async (req, res) => {
  try {
    const { name, price, description, image, category, familyGroup, sku, status, stock, lowStockThreshold, discountType, discountValue, featured } = req.body;

    if (!name || price === undefined || !description) {
      return res.status(400).json({ error: 'Name, price, and description are required' });
    }

    const prod = new Product({
      name,
      price,
      description,
      image,
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
    console.error('save product error', err);
    return res.status(400).json({ error: 'Bad request', details: err.message });
  }
});

app.put('/products/:id', async (req, res) => {
  try {
    const { name, price, description, image, category, familyGroup, sku, status, stock, lowStockThreshold, discountType, discountValue, featured } = req.body;
    const updateData = {};

    if (name !== undefined) updateData.name = name;
    if (price !== undefined) updateData.price = price;
    if (description !== undefined) updateData.description = description;
    if (category !== undefined) updateData.category = category;
    if (familyGroup !== undefined) updateData.familyGroup = familyGroup;
    if (image !== undefined) updateData.image = image;
    if (sku !== undefined) updateData.sku = sku;
    if (status !== undefined) updateData.status = status;
    if (stock !== undefined) updateData.stock = stock;
    if (lowStockThreshold !== undefined) updateData.lowStockThreshold = lowStockThreshold;
    if (discountType !== undefined) updateData.discountType = discountType || 'none';
    if (discountValue !== undefined) updateData.discountValue = Number(discountValue) || 0;
    if (featured !== undefined) updateData.featured = Boolean(featured);

    const updated = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true });
    if (!updated) return res.status(404).json({ error: 'Product not found' });
    return res.status(200).json(updated);
  } catch (err) {
    console.error('update product error', err);
    return res.status(400).json({ error: 'Bad request', details: err.message });
  }
});

app.delete('/products/:id', async (req, res) => {
  try {
    const removed = await Product.findByIdAndDelete(req.params.id);
    if (!removed) return res.status(404).json({ error: 'Product not found' });
    return res.status(200).json({ message: 'Product deleted successfully', product: removed });
  } catch (err) {
    console.error('delete product error', err);
    return res.status(500).json({ error: 'Failed to delete', details: err.message });
  }
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













