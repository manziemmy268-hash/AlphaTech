const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const db = require('./db');

// JWT_SECRET is required for auth, but we provide a safe fallback for local development
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
if (!process.env.JWT_SECRET) {
    if (isProduction) {
        console.error('FATAL: JWT_SECRET must be set in production. Set it in Render Dashboard → Environment.');
        process.exit(1);
    }
    console.warn('JWT_SECRET not set. Using a development fallback secret.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
// Tokens are valid for 7 days.
const JWT_EXPIRES_IN = '7d';

const PORT = process.env.PORT || (isProduction ? 10000 : 3001);

const app = express();

// Trust Render's proxy
app.set('trust proxy', 1);

// Security headers
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://cdnjs.cloudflare.com", "https://fonts.googleapis.com"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
        }
    },
}));

// HTTPS redirect
app.use((req, res, next) => {
    if (isProduction && !req.secure && req.get('x-forwarded-proto') !== 'https') {
        return res.redirect(301, `https://${req.get('host')}${req.originalUrl}`);
    }
    next();
});

// CORS
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*';
if (isProduction && ALLOWED_ORIGINS === '*') {
    console.error('WARNING: ALLOWED_ORIGINS is set to wildcard in production.');
}
app.use(cors(ALLOWED_ORIGINS === '*'
    ? { origin: '*' }
    : { origin: ALLOWED_ORIGINS, credentials: true }
));

app.use(express.json({ limit: '1mb' }));

// Rate limiters
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    // Configurable so test suites (or high-traffic auth endpoints) can raise the cap
    // without weakening the default anti-bruteforce posture. Defaults to 20.
    max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 20,
    message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    // Configurable so test suites / high-traffic deployments can raise the cap.
    max: Number(process.env.API_RATE_LIMIT_MAX) || 600,
    message: { success: false, message: 'Rate limit exceeded. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// ============================================
// DATABASE BOOTSTRAP (self-healing on Supabase)
// ============================================
// Ensures all tables exist so a fresh Supabase project "just works".
// The same DDL lives in backend/schema.sql for manual reference.
async function bootstrapSchema() {
    try {
        await db.execute(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT,
                password_hash TEXT NOT NULL,
                role TEXT DEFAULT 'user',
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS password_resets (
                id SERIAL PRIMARY KEY,
                user_email TEXT NOT NULL,
                token TEXT NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                brand TEXT,
                category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
                price REAL NOT NULL,
                description TEXT,
                image TEXT,
                specs_processor TEXT,
                specs_display TEXT,
                specs_camera TEXT,
                specs_battery TEXT,
                stock INTEGER DEFAULT 10,
                sku TEXT,
                badge TEXT DEFAULT NULL,
                featured INTEGER DEFAULT 0,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status TEXT DEFAULT 'pending',
                total_amount REAL NOT NULL,
                shipping_name TEXT,
                shipping_email TEXT,
                shipping_address TEXT,
                shipping_city TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS order_items (
                id SERIAL PRIMARY KEY,
                order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id),
                quantity INTEGER NOT NULL DEFAULT 1,
                unit_price REAL NOT NULL
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS cart_items (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                quantity INTEGER DEFAULT 1,
                added_at TIMESTAMPTZ DEFAULT now(),
                UNIQUE(user_id, product_id)
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS transactions (
                id SERIAL PRIMARY KEY,
                order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
                reference_id TEXT UNIQUE NOT NULL,
                phone_number TEXT NOT NULL,
                amount REAL NOT NULL,
                currency TEXT DEFAULT 'USD',
                status TEXT DEFAULT 'PENDING',
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
                comment TEXT,
                created_at TIMESTAMPTZ DEFAULT now()
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS product_variants (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                sku TEXT,
                price REAL,
                stock INTEGER DEFAULT 0,
                image TEXT,
                sort_order INTEGER DEFAULT 0
            )
        `);
        await db.execute(`
            CREATE TABLE IF NOT EXISTS product_images (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                url TEXT NOT NULL,
                alt TEXT,
                sort_order INTEGER DEFAULT 0
            )
        `);
        console.log('Database schema ready.');
    } catch (e) {
        console.error('Schema bootstrap error:', e.message);
    }
}

// ============================================
// HELPER QUERY BITS
// ============================================
const productCols = `p.id, p.name, p.brand, p.sku, p.badge, p.featured, p.price, p.description, p.image, p.stock,
    p.specs_processor, p.specs_display, p.specs_camera, p.specs_battery, p.created_at,
    c.name as category_name, c.id as category_id,
    (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) as review_count,
    (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE product_id = p.id) as average_rating`;

const productJoins = `FROM products p LEFT JOIN categories c ON p.category_id = c.id`;

// Normalize brand to canonical casing / fallback
const canonBrands = { apple: 'Apple', samsung: 'Samsung', google: 'Google', oneplus: 'OnePlus', xiaomi: 'Xiaomi', nokia: 'Nokia', tecno: 'Tecno', sony: 'Sony', motorola: 'Motorola', honor: 'Honor' };

function normalizeName(v) { return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v; }
function normalizeBrand(v) {
    if (typeof v !== 'string') return v;
    const t = v.trim().replace(/\s+/g, ' ');
    return canonBrands[t.toLowerCase()] || t;
}
function normalizeImage(v) { return typeof v === 'string' ? v.trim() : v; }
function sanitizeText(value, maxLength = 2000) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/<[^>]*>/g, '')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, maxLength);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validatePassword(password) {
    if (!password || password.length < 8) return 'Password must be at least 8 characters.';
    if (!/[a-zA-Z]/.test(password)) return 'Password must contain at least one letter.';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
    return null;
}

// ============================================
// AUTH MIDDLEWARE
// ============================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ success: false, message: 'Authentication required.' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch {
        return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
    }
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    next();
}

// Rate limiters per route
app.use('/api/register', authLimiter);
app.use('/api/login', authLimiter);
app.use('/api/forgot-password', authLimiter);
app.use('/api', apiLimiter);

app.get('/api/health', async (req, res) => {
    try {
        await db.ping();
        res.json({ status: 'UP', timestamp: new Date() });
    } catch (e) {
        res.status(500).json({ status: 'DOWN', error: e.message });
    }
});

// ============================================
// AUTH
// ============================================
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, phone, password } = req.body;
        if (!username || !username.trim()) {
            return res.status(400).json({ success: false, message: 'Name is required.' });
        }
        if (username.trim().length > 100) {
            return res.status(400).json({ success: false, message: 'Name too long (max 100 characters).' });
        }
        if (!email || !EMAIL_RE.test(email)) {
            return res.status(400).json({ success: false, message: 'A valid email address is required.' });
        }
        const pwErr = validatePassword(password);
        if (pwErr) return res.status(400).json({ success: false, message: pwErr });

        const hash = await bcrypt.hash(password, 10);
        await db.run("INSERT INTO users (username, email, phone, password_hash) VALUES ($1, $2, $3, $4)",
            [username.trim(), email.toLowerCase().trim(), phone || null, hash]);
        res.json({ success: true, message: 'Registration successful! You can now login.' });
    } catch (err) {
        if (err.message.includes('duplicate key') || err.message.includes('unique')) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
        }
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required.' });
        }

        const user = await db.get("SELECT * FROM users WHERE email = $1", [email.toLowerCase().trim()]);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) {
            return res.status(401).json({ success: false, message: 'Invalid email or password.' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, phone: user.phone, role: user.role },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            success: true,
            message: `Welcome back, ${user.username}!`,
            token,
            user: { id: user.id, username: user.username, email: user.email, phone: user.phone, role: user.role }
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
    }
});

// POST /api/auth/refresh — silently renew a valid (non-expired) token.
app.post('/api/auth/refresh', authenticateToken, async (req, res) => {
    try {
        const user = await db.get("SELECT * FROM users WHERE id = $1", [req.user.id]);
        if (!user) {
            return res.status(401).json({ success: false, message: 'User not found.' });
        }
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, phone: user.phone, role: user.role },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
        );
        res.json({
            success: true,
            token,
            user: { id: user.id, username: user.username, email: user.email, phone: user.phone, role: user.role }
        });
    } catch (err) {
        console.error('Refresh error:', err);
        res.status(500).json({ success: false, message: 'Refresh failed.' });
    }
});

// ============================================
// PASSWORD RESET
// ============================================
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ success: false, message: 'A valid email address is required.' });
    }

    const user = await db.get("SELECT * FROM users WHERE email = $1", [email.toLowerCase().trim()]);
    // Always return success to prevent email enumeration
    if (!user) {
        return res.json({ success: true, message: 'If this email is registered, a password reset link will be sent.' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    await db.execute("DELETE FROM password_resets WHERE expires_at < now()");
    await db.run("INSERT INTO password_resets (user_email, token, expires_at) VALUES ($1, $2, $3)",
        [email.toLowerCase().trim(), token, expiresAt]);

    const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
    console.log(`[EMAIL] Password reset requested for: ${email}`);

    res.json({ success: true, message: 'If this email is registered, a password reset link will be sent.' });
});

app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
        return res.status(400).json({ success: false, message: 'Token and new password are required.' });
    }

    const pwErr = validatePassword(newPassword);
    if (pwErr) return res.status(400).json({ success: false, message: pwErr });

    const resetData = await db.get(
        "SELECT * FROM password_resets WHERE token = $1 AND expires_at > now()", [token]);
    if (!resetData) {
        return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
    }

    try {
        const hash = await bcrypt.hash(newPassword, 10);
        await db.transaction(async (tx) => {
            await tx.run("UPDATE users SET password_hash = $1 WHERE email = $2", [hash, resetData.user_email]);
            await tx.execute("DELETE FROM password_resets WHERE user_email = $1", [resetData.user_email]);
        });
        res.json({ success: true, message: 'Password has been reset successfully! You can now log in.' });
    } catch (err) {
        console.error('Reset error:', err);
        res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// ============================================
// USER PROFILE
// ============================================
app.put('/api/users/me', authenticateToken, async (req, res) => {
    try {
        const user = await db.get("SELECT * FROM users WHERE id = $1", [req.user.id]);
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        const { username, phone, oldPassword, newPassword } = req.body;
        let hashToUpdate = user.password_hash;

        if (oldPassword || newPassword) {
            if (!oldPassword || !newPassword) {
                return res.status(400).json({ success: false, message: 'Both old and new password are required to change password.' });
            }
            const match = await bcrypt.compare(oldPassword, user.password_hash);
            if (!match) return res.status(403).json({ success: false, message: 'Incorrect current password.' });
            const pwErr = validatePassword(newPassword);
            if (pwErr) return res.status(400).json({ success: false, message: pwErr });
            hashToUpdate = await bcrypt.hash(newPassword, 10);
        }

        const updatedPhone = phone !== undefined ? phone : user.phone;
        await db.run("UPDATE users SET username = $1, phone = $2, password_hash = $3 WHERE id = $4",
            [username || user.username, updatedPhone, hashToUpdate, req.user.id]);

        const token = jwt.sign(
            { id: user.id, username: username || user.username, email: user.email, phone: updatedPhone, role: user.role },
            JWT_SECRET, { expiresIn: JWT_EXPIRES_IN }
        );

        res.json({
            success: true,
            message: 'Profile updated!',
            token,
            user: { id: user.id, username: username || user.username, email: user.email, phone: updatedPhone, role: user.role }
        });
    } catch (err) {
        console.error('Profile update error:', err);
        res.status(500).json({ success: false, message: 'Failed to update profile.' });
    }
});

app.delete('/api/users/me', authenticateToken, async (req, res) => {
    try {
        const user = await db.get("SELECT * FROM users WHERE id = $1", [req.user.id]);
        if (!user) return res.status(500).json({ success: false, message: 'Database error.' });

        const match = await bcrypt.compare(req.body.password, user.password_hash);
        if (!match) return res.status(403).json({ success: false, message: 'Incorrect password.' });

        await db.execute("DELETE FROM users WHERE id = $1", [req.user.id]);
        res.json({ success: true, message: 'Account deleted permanently.' });
    } catch (err) {
        console.error('Account delete error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete account.' });
    }
});

// ============================================
// PRODUCT CATALOG
// ============================================
// GET /api/products — paginated, searchable, filterable
app.get('/api/products', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 12));
        const offset = (page - 1) * limit;
        const search = (req.query.search || '').trim();
        const brand = (req.query.brand || '').trim();
        const category = (req.query.category || '').trim();
        const sort = (req.query.sort || 'created_at').trim();
        const minPrice = parseFloat(req.query.minPrice);
        const maxPrice = parseFloat(req.query.maxPrice);
        const featured = req.query.featured;
        const badge = (req.query.badge || '').trim();

        let where = ['1=1'];
        let params = [];

        if (search) {
            where.push("(p.name ILIKE ? OR p.brand ILIKE ? OR p.description ILIKE ? OR p.sku ILIKE ?)");
            const like = `%${search}%`;
            params.push(like, like, like, like);
        }
        if (brand) {
            params.push(brand);
            where.push('p.brand = ?');
        }
        if (category) {
            params.push(category);
            where.push('c.name = ?');
        }
        if (!isNaN(minPrice)) {
            params.push(minPrice);
            where.push('p.price >= ?');
        }
        if (!isNaN(maxPrice)) {
            params.push(maxPrice);
            where.push('p.price <= ?');
        }
        if (featured === 'true' || featured === '1') {
            where.push('p.featured = 1');
        }
        if (badge) {
            params.push(badge);
            where.push('p.badge = ?');
        }

        const whereClause = where.join(' AND ');

        const sortMap = {
            'price_asc': 'p.price ASC',
            'price_desc': 'p.price DESC',
            'name_asc': 'p.name ASC',
            'name_desc': 'p.name DESC',
            'newest': 'p.created_at DESC',
            'oldest': 'p.created_at ASC',
            'rating': 'average_rating DESC',
            'popular': '(SELECT COUNT(*) FROM order_items oi WHERE oi.product_id = p.id) DESC',
        };
        const orderBy = sortMap[sort] || 'p.created_at DESC';

        const countRes = await db.all(
            `SELECT COUNT(*) as total ${productJoins} WHERE ${whereClause}`,
            params
        );
        const total = Number(countRes[0].total);

        const rows = await db.all(
            `SELECT ${productCols} ${productJoins} WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const brandQuery = `SELECT p.brand as name, COUNT(*) as count FROM products p ${category ? `JOIN categories c ON p.category_id = c.id WHERE c.name = ?` : 'WHERE 1=1'} GROUP BY p.brand ORDER BY p.brand`;
        const brands = category ? await db.all(brandQuery, [category]) : await db.all(brandQuery);
        const categories = await db.all(
            "SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.name"
        );

        res.json({
            products: rows,
            pagination: { page, limit, total, pages: Math.ceil(total / limit) },
            filters: { brands, categories },
        });
    } catch (err) {
        console.error('Products error:', err);
        res.status(500).json({ success: false, message: 'Failed to load products.' });
    }
});

// GET /api/products/featured
app.get('/api/products/featured', async (req, res) => {
    try {
        const limit = Math.min(20, parseInt(req.query.limit) || 8);
        const rows = await db.all(
            `SELECT ${productCols} ${productJoins} WHERE p.featured = 1 ORDER BY p.created_at DESC LIMIT $1`,
            [limit]
        );
        res.json(rows);
    } catch (err) {
        console.error('Featured error:', err);
        res.status(500).json({ success: false, message: 'Failed to load featured products.' });
    }
});

// GET /api/products/trending
app.get('/api/products/trending', async (req, res) => {
    try {
        const limit = Math.min(20, parseInt(req.query.limit) || 8);
        const rows = await db.all(
            `SELECT ${productCols} ${productJoins}
            ORDER BY (SELECT COUNT(*) FROM order_items oi WHERE oi.product_id = p.id) DESC, p.created_at DESC LIMIT $1`,
            [limit]
        );
        res.json(rows);
    } catch (err) {
        console.error('Trending error:', err);
        res.status(500).json({ success: false, message: 'Failed to load trending products.' });
    }
});

// GET /api/products/related/:id
app.get('/api/products/related/:id', async (req, res) => {
    try {
        const product = await db.get("SELECT brand, category_id FROM products WHERE id = $1", [req.params.id]);
        if (!product) return res.json([]);
        const limit = Math.min(8, parseInt(req.query.limit) || 4);
        const rows = await db.all(
            `SELECT ${productCols} ${productJoins}
            WHERE p.id != $1 AND (p.brand = $2 OR p.category_id = $3) ORDER BY p.created_at DESC LIMIT $4`,
            [req.params.id, product.brand, product.category_id, limit]
        );
        res.json(rows);
    } catch (err) {
        console.error('Related error:', err);
        res.status(500).json({ success: false, message: 'Failed to load related products.' });
    }
});

// GET /api/products/:id — single product with variants and images
app.get('/api/products/:id', async (req, res) => {
    try {
        const row = await db.get(`SELECT ${productCols} ${productJoins} WHERE p.id = $1`, [req.params.id]);
        if (!row) return res.status(404).json({ success: false, message: 'Product not found.' });

        row.variants = await db.all("SELECT * FROM product_variants WHERE product_id = $1 ORDER BY sort_order", [row.id]);
        row.gallery = await db.all("SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order", [row.id]);
        if (!row.gallery.length && row.image) {
            row.gallery = [{ url: row.image, alt: row.name }];
        }

        res.json(row);
    } catch (err) {
        console.error('Product detail error:', err);
        res.status(500).json({ success: false, message: 'Failed to load product.' });
    }
});

// POST /api/products
app.post('/api/products', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, brand, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock, sku, badge, featured } = req.body;
        const nb = normalizeBrand(brand);
        await db.execute("INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [nb]);
        const cat = await db.get("SELECT id FROM categories WHERE name = $1", [nb]);
        const result = await db.run(
            `INSERT INTO products (name, brand, category_id, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock, sku, badge, featured)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [normalizeName(name), nb, cat ? cat.id : null, price, sanitizeText(description), normalizeImage(image),
            specs_processor, specs_display, specs_camera, specs_battery, stock || 10,
            sku || null, badge || null, featured ? 1 : 0]
        );
        const id = result.lastInsertRowid;
        if (!sku) {
            await db.run("UPDATE products SET sku = $1 WHERE id = $2", [`PHN-${String(id).padStart(4, '0')}`, id]);
        }
        res.json({ success: true, id, message: 'Product added!' });
    } catch (err) {
        console.error('Add product error:', err);
        res.status(500).json({ success: false, message: 'Failed to add product.' });
    }
});

// PUT /api/products/:id
app.put('/api/products/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { name, brand, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock, sku, badge, featured } = req.body;
        const nb = normalizeBrand(brand);
        await db.execute("INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [nb]);
        const cat = await db.get("SELECT id FROM categories WHERE name = $1", [nb]);
        await db.run(
            `UPDATE products SET name=$1, brand=$2, category_id=$3, price=$4, description=$5, image=$6,
            specs_processor=$7, specs_display=$8, specs_camera=$9, specs_battery=$10, stock=$11, sku=$12, badge=$13, featured=$14 WHERE id=$15`,
            [normalizeName(name), nb, cat ? cat.id : null, price, sanitizeText(description), normalizeImage(image),
            specs_processor, specs_display, specs_camera, specs_battery, stock, sku || null, badge || null, featured ? 1 : 0, req.params.id]
        );
        res.json({ success: true, message: 'Product updated!' });
    } catch (err) {
        console.error('Update product error:', err);
        res.status(500).json({ success: false, message: 'Failed to update product.' });
    }
});

// DELETE /api/products/:id
app.delete('/api/products/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        await db.execute("DELETE FROM products WHERE id = $1", [req.params.id]);
        res.json({ success: true, message: 'Product deleted.' });
    } catch (err) {
        console.error('Delete product error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete product.' });
    }
});

// GET /api/categories — with product counts
app.get('/api/categories', async (req, res) => {
    try {
        const rows = await db.all(
            "SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.name"
        );
        res.json(rows);
    } catch (err) {
        console.error('Categories error:', err);
        res.status(500).json({ success: false, message: 'Failed to load categories.' });
    }
});

// GET /api/brands — with product counts
app.get('/api/brands', async (req, res) => {
    try {
        const rows = await db.all(
            "SELECT brand as name, COUNT(*) as product_count FROM products GROUP BY brand ORDER BY brand"
        );
        res.json(rows);
    } catch (err) {
        console.error('Brands error:', err);
        res.status(500).json({ success: false, message: 'Failed to load brands.' });
    }
});

// ============================================
// CART
// ============================================
app.get('/api/cart', authenticateToken, async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT ci.id, ci.quantity, ci.added_at,
            p.id as product_id, p.name, p.brand, p.price, p.image
            FROM cart_items ci JOIN products p ON ci.product_id = p.id
            WHERE ci.user_id = $1 ORDER BY ci.added_at DESC`,
            [req.user.id]
        );
        res.json(rows);
    } catch (err) {
        console.error('Get cart error:', err);
        res.status(500).json({ success: false, message: 'Failed to load cart.' });
    }
});

app.post('/api/cart', authenticateToken, async (req, res) => {
    const { product_id, quantity } = req.body;
    if (!product_id || !Number.isInteger(Number(product_id))) {
        return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const qty = Math.max(1, Math.min(99, Number(quantity) || 1));

    try {
        const product = await db.get("SELECT id, stock FROM products WHERE id = $1", [product_id]);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }
        if (product.stock <= 0) {
            return res.status(400).json({ success: false, message: 'This product is out of stock.' });
        }

        await db.transaction(async (tx) => {
            const existing = await tx.get("SELECT id, quantity FROM cart_items WHERE user_id = $1 AND product_id = $2",
                [req.user.id, product_id]);
            if (existing) {
                await tx.run("UPDATE cart_items SET quantity = LEAST(99, quantity + $1) WHERE id = $2",
                    [qty, existing.id]);
            } else {
                await tx.run("INSERT INTO cart_items (user_id, product_id, quantity) VALUES ($1, $2, $3)",
                    [req.user.id, product_id, qty]);
            }
        });

        res.json({ success: true, message: 'Added to cart!' });
    } catch (err) {
        console.error('Error adding to cart:', err);
        res.status(500).json({ success: false, message: 'Failed to add item to cart.' });
    }
});

app.put('/api/cart/:id', authenticateToken, async (req, res) => {
    try {
        const qty = Math.max(1, Math.min(99, Number(req.body.quantity) || 1));
        const item = await db.get(
            "SELECT ci.id, ci.product_id, p.stock FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.id = $1 AND ci.user_id = $2",
            [req.params.id, req.user.id]
        );
        if (!item) return res.status(404).json({ success: false, message: 'Cart item not found.' });
        if (qty > item.stock) return res.status(400).json({ success: false, message: `Only ${item.stock} in stock.` });
        await db.run("UPDATE cart_items SET quantity = $1 WHERE id = $2 AND user_id = $3",
            [qty, req.params.id, req.user.id]);
        res.json({ success: true, message: 'Cart updated.' });
    } catch (err) {
        console.error('Error updating cart:', err);
        res.status(500).json({ success: false, message: 'Failed to update cart.' });
    }
});

app.delete('/api/cart/:id', authenticateToken, async (req, res) => {
    try {
        await db.execute("DELETE FROM cart_items WHERE id = $1 AND user_id = $2", [req.params.id, req.user.id]);
        res.json({ success: true, message: 'Removed from cart.' });
    } catch (err) {
        console.error('Error removing cart item:', err);
        res.status(500).json({ success: false, message: 'Failed to remove cart item.' });
    }
});

app.delete('/api/cart', authenticateToken, async (req, res) => {
    try {
        await db.execute("DELETE FROM cart_items WHERE user_id = $1", [req.user.id]);
        res.json({ success: true, message: 'Cart cleared.' });
    } catch (err) {
        console.error('Error clearing cart:', err);
        res.status(500).json({ success: false, message: 'Failed to clear cart.' });
    }
});

// ============================================
// ORDERS
// ============================================
app.post('/api/orders', authenticateToken, async (req, res) => {
    const { shipping_name, shipping_email, shipping_address, shipping_city } = req.body;
    if (!shipping_name || !shipping_email || !shipping_address || !shipping_city) {
        return res.status(400).json({ success: false, message: 'All shipping fields are required.' });
    }

    try {
        const { error, orderId, totalAmount, success, message } = await db.transaction(async (tx) => {
            const cartItems = await tx.all(
                `SELECT ci.quantity, p.id as product_id, p.price, p.stock, p.name
                FROM cart_items ci JOIN products p ON ci.product_id = p.id
                WHERE ci.user_id = $1`,
                [req.user.id]
            );

            if (cartItems.length === 0) return { error: 'Cart is empty.' };

            const outOfStock = cartItems.filter(i => i.stock < i.quantity);
            if (outOfStock.length > 0) {
                return { error: `Insufficient stock for: ${outOfStock.map(i => i.name).join(', ')}` };
            }

            const subtotal = Number(cartItems.reduce((s, i) => s + Number(i.price) * i.quantity, 0).toFixed(2));
            const total = Number((subtotal * 1.08).toFixed(2));
            const orderResult = await tx.run(
                `INSERT INTO orders (user_id, total_amount, shipping_name, shipping_email, shipping_address, shipping_city)
                VALUES ($1, $2, $3, $4, $5, $6)`,
                [req.user.id, total, shipping_name, shipping_email, shipping_address, shipping_city]
            );

            const orderId = orderResult.lastInsertRowid;
            for (const item of cartItems) {
                await tx.run("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES ($1, $2, $3, $4)",
                    [orderId, item.product_id, item.quantity, Number(item.price)]);
                const updated = await tx.execute(
                    "UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1",
                    [item.quantity, item.product_id]
                );
                if (updated.changes === 0) {
                    throw new Error(`Insufficient stock for: ${item.name}`);
                }
            }

            await tx.execute("DELETE FROM cart_items WHERE user_id = $1", [req.user.id]);
            return { success: true, orderId, totalAmount: total, message: 'Order placed!' };
        });

        if (error) return res.status(400).json({ success: false, message: error });
        res.json({ success, orderId, totalAmount, message });
    } catch (err) {
        console.error('Order placement error:', err);
        res.status(500).json({ success: false, message: 'Failed to place order.' });
    }
});

app.get('/api/orders', authenticateToken, async (req, res) => {
    try {
        const query = req.user.role === 'admin'
            ? `SELECT o.*, u.username, u.email as user_email FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC`
            : `SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC`;
        const params = req.user.role === 'admin' ? [] : [req.user.id];
        res.json(await db.all(query, params));
    } catch (err) {
        console.error('Get orders error:', err);
        res.status(500).json({ success: false, message: 'Failed to load orders.' });
    }
});

app.get('/api/orders/:id', authenticateToken, async (req, res) => {
    try {
        const order = await db.get("SELECT * FROM orders WHERE id = $1", [req.params.id]);
        if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
        if (order.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, message: 'Unauthorized.' });
        }
        order.items = await db.all(
            `SELECT oi.*, p.name, p.image, p.brand
            FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = $1`,
            [order.id]
        );
        res.json(order);
    } catch (err) {
        console.error('Get order error:', err);
        res.status(500).json({ success: false, message: 'Failed to load order.' });
    }
});

// ============================================
// MOMO PAYMENT (Mock)
// ============================================
app.post('/pay', authenticateToken, async (req, res) => {
    try {
        const { phoneNumber, amount, orderId, currency = 'USD' } = req.body;
        if (!phoneNumber || !amount) {
            return res.status(400).json({ success: false, message: 'Phone number and amount are required.' });
        }
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'Order ID is required.' });
        }

        const order = await db.get("SELECT id, user_id, status, total_amount FROM orders WHERE id = $1", [orderId]);
        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }
        if (order.user_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Unauthorized.' });
        }
        if (order.status === 'paid') {
            return res.status(400).json({ success: false, message: 'This order has already been paid.' });
        }
        if (Number(amount) !== Number(order.total_amount)) {
            return res.status(400).json({ success: false, message: 'Payment amount does not match the order total.' });
        }

        const referenceId = uuidv4();
        await db.run(
            `INSERT INTO transactions (order_id, reference_id, phone_number, amount, currency, status)
            VALUES ($1, $2, $3, $4, $5, 'PENDING')`,
            [orderId, referenceId, phoneNumber, Number(amount), currency]
        );

        console.log(`[MoMo] ${amount} ${currency} | Ref: ${referenceId}`);

        res.status(202).json({
            status: 'PENDING',
            referenceId,
            message: 'Payment request sent. Check your phone to approve.'
        });

        setTimeout(async () => {
            try {
                await db.transaction(async (tx) => {
                    await tx.run("UPDATE transactions SET status = 'SUCCESSFUL' WHERE reference_id = $1", [referenceId]);
                    await tx.run("UPDATE orders SET status = 'paid' WHERE id = $1", [orderId]);
                });
                console.log(`[MoMo] ${referenceId} -> SUCCESSFUL`);
            } catch (e) {
                console.error('Payment finalize error:', e);
            }
        }, 5000);
    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ success: false, message: 'Payment initialization failed.' });
    }
});

app.get('/status/:referenceId', async (req, res) => {
    try {
        const tx = await db.get("SELECT * FROM transactions WHERE reference_id = $1", [req.params.referenceId]);
        if (!tx) {
            return res.status(404).json({ success: false, message: 'Payment reference not found.' });
        }
        res.json({ referenceId: req.params.referenceId, status: tx.status });
    } catch (err) {
        console.error('Payment status error:', err);
        res.status(500).json({ success: false, message: 'Failed to check payment status.' });
    }
});

// ============================================
// REVIEWS
// ============================================
app.get('/api/products/:id/reviews', async (req, res) => {
    try {
        const rows = await db.all(
            `SELECT r.*, u.username FROM reviews r
            JOIN users u ON r.user_id = u.id WHERE r.product_id = $1
            ORDER BY r.created_at DESC`,
            [req.params.id]
        );
        res.json(rows);
    } catch (err) {
        console.error('Reviews error:', err);
        res.status(500).json({ success: false, message: 'Failed to load reviews.' });
    }
});

app.post('/api/reviews', authenticateToken, async (req, res) => {
    try {
        const { product_id, rating, comment } = req.body;
        if (!product_id || !rating) {
            return res.status(400).json({ success: false, message: 'Product ID and rating are required.' });
        }
        const r = Number(rating);
        if (!Number.isInteger(r) || r < 1 || r > 5) {
            return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
        }

        const purchase = await db.get(
            `SELECT 1 FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            WHERE o.user_id = $1 AND oi.product_id = $2 AND o.status = 'paid' LIMIT 1`,
            [req.user.id, product_id]
        );

        if (!purchase) {
            return res.status(403).json({ success: false, message: 'Only verified buyers can review this product.' });
        }

        const existing = await db.get("SELECT id FROM reviews WHERE user_id = $1 AND product_id = $2",
            [req.user.id, product_id]);
        if (existing) {
            return res.status(409).json({ success: false, message: 'You have already reviewed this product.' });
        }

        await db.run("INSERT INTO reviews (user_id, product_id, rating, comment) VALUES ($1, $2, $3, $4)",
            [req.user.id, product_id, r, sanitizeText(comment) || null]);
        res.json({ success: true, message: 'Thank you for your review!' });
    } catch (err) {
        console.error('Review submit error:', err);
        res.status(500).json({ success: false, message: 'Failed to submit review.' });
    }
});

// ============================================
// ADMIN
// ============================================
app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const getCount = async (sql) => {
            const rows = await db.all(sql);
            return Number(rows[0].count);
        };
        const revRows = await db.all("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'SUCCESSFUL'");
        const rev = revRows[0];
        res.json({
            totalUsers: await getCount("SELECT COUNT(*) as count FROM users"),
            totalProducts: await getCount("SELECT COUNT(*) as count FROM products"),
            totalOrders: await getCount("SELECT COUNT(*) as count FROM orders"),
            totalRevenue: rev ? Number(rev.total) || 0 : 0,
            lowStockCount: await getCount("SELECT COUNT(*) as count FROM products WHERE stock <= 3"),
        });
    } catch (err) {
        console.error('Admin stats error:', err);
        res.status(500).json({ success: false, message: 'Failed to load stats.' });
    }
});

app.get('/api/admin/low-stock', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const rows = await db.all(
            "SELECT id, name, brand, stock, image FROM products WHERE stock <= 3 ORDER BY stock ASC"
        );
        res.json(rows);
    } catch (err) {
        console.error('Low stock error:', err);
        res.status(500).json({ success: false, message: 'Failed to load low stock products.' });
    }
});

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const rows = await db.all(
            "SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC"
        );
        res.json(rows);
    } catch (err) {
        console.error('Admin users error:', err);
        res.status(500).json({ success: false, message: 'Failed to load users.' });
    }
});

// ============================================
// SEED (products + default admin) — run at startup
// ============================================
async function seedData() {
    try {
        const adminCount = await db.get("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
        if (Number(adminCount.count) === 0) {
            const hash = bcrypt.hashSync('admin123', 10);
            await db.run("INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, 'admin') ON CONFLICT (email) DO NOTHING",
                ['Admin', 'admin@alphatech.com', hash]);
            console.log('Default admin seeded (admin@alphatech.com / admin123)');
        }

        const productsSeed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf-8'));
        let inserted = 0, updated = 0;

        for (const p of productsSeed) {
            const existing = await db.get("SELECT id FROM products WHERE name = $1 AND brand = $2", [p.name, p.brand]);
            if (existing) {
                await db.run(
                    `UPDATE products SET price=$1, stock=$2, badge=$3, featured=$4, image=$5 WHERE name=$6 AND brand=$7`,
                    [p.price, p.stock ?? 10, p.badge || null, p.featured ? 1 : 0, p.image, p.name, p.brand]
                );
                updated++;
            } else {
                let catId = null;
                const cat = await db.get("SELECT id FROM categories WHERE name = $1", [p.brand]);
                if (cat) catId = cat.id;
                await db.execute("INSERT INTO categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING", [p.brand]);
                const cat2 = cat ? cat : await db.get("SELECT id FROM categories WHERE name = $1", [p.brand]);
                if (cat2) catId = cat2.id;
                await db.run(
                    `INSERT INTO products (name, brand, category_id, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock, badge, featured)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                    [p.name, p.brand, catId, p.price, p.description, p.image,
                    p.specs?.processor || null, p.specs?.display || null, p.specs?.camera || null, p.specs?.battery || null,
                    p.stock ?? 10, p.badge || null, p.featured ? 1 : 0]
                );
                inserted++;
            }
        }
        console.log(`Products: ${inserted} inserted, ${updated} updated.`);
    } catch (err) {
        console.error('Seed error:', err.message);
    }
}

// ============================================
// ERROR HANDLER & 404
// ============================================
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({
        success: false,
        message: 'Internal server error.',
        error: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
});

// 404 handler for unknown /api routes
app.use('/api', (req, res) => {
    res.status(404).json({ success: false, message: 'Route not found.' });
});

// Catch-all for non-API routes → custom 404
app.get('/{*splat}', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, '..', '404.html'));
});

// ============================================
// START
// ============================================
async function start() {
    try {
        await db.ping();
        console.log('Postgres connection OK.');
    } catch (e) {
        console.error('Could not connect to Postgres:', e.message);
        if (isProduction) process.exit(1);
    }
    await bootstrapSchema();
    await seedData();

    const server = app.listen(PORT, () => {
        const mode = isProduction ? 'PRODUCTION' : 'DEVELOPMENT';
        console.log(`\nServer running on http://localhost:${PORT} [${mode}]`);
        console.log(`JWT Auth: Enabled`);
        console.log(`Rate Limiting: Enabled`);
        console.log(`Security Headers: Enabled`);
        console.log(`HTTPS Redirect: ${isProduction ? 'Active' : 'Disabled (dev mode)'}\n`);
    });

    process.on('SIGINT', () => { server.close(() => process.exit(0)); });
    process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
}

start();
