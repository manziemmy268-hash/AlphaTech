const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// JWT_SECRET is required for auth, but we provide a safe fallback for local development
const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
if (!process.env.JWT_SECRET) {
    if (isProduction) {
        console.error('FATAL: JWT_SECRET must be set in production.');
        process.exit(1);
    }
    console.warn('JWT_SECRET not set. Using a development fallback secret.');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const PORT = process.env.PORT || (isProduction ? 3000 : 3001);

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
    max: 20,
    message: { success: false, message: 'Too many attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    message: { success: false, message: 'Too many requests. Please slow down.' },
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/register', authLimiter);
app.use('/api/login', authLimiter);
app.use('/api/forgot-password', authLimiter);
app.use('/api', apiLimiter);

// Static files with caching
const oneYear = 365 * 24 * 60 * 60 * 1000;
const oneDay = 24 * 60 * 60 * 1000;
app.use(express.static(path.join(__dirname, '..'), {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            return;
        }
        if (filePath.endsWith('.svg') || filePath.endsWith('.png') || filePath.endsWith('.jpg') || filePath.endsWith('.webp')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (filePath.endsWith('.css') || filePath.endsWith('.js')) {
            res.setHeader('Cache-Control', 'public, max-age=86400');
        }
    }
}));

app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
});

// ============================================
// DATABASE
// ============================================
const db = new Database('./database.sqlite');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_email TEXT NOT NULL,
        token TEXT NOT NULL,
        expires_at DATETIME NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        brand TEXT,
        category_id INTEGER,
        price REAL NOT NULL,
        description TEXT,
        image TEXT,
        specs_processor TEXT,
        specs_display TEXT,
        specs_camera TEXT,
        specs_battery TEXT,
        stock INTEGER DEFAULT 10,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        status TEXT DEFAULT 'pending',
        total_amount REAL NOT NULL,
        shipping_name TEXT,
        shipping_email TEXT,
        shipping_address TEXT,
        shipping_city TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price REAL NOT NULL,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id)
    );
    CREATE TABLE IF NOT EXISTS cart_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
        UNIQUE(user_id, product_id)
    );
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER,
        reference_id TEXT UNIQUE NOT NULL,
        phone_number TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'RWF',
        status TEXT DEFAULT 'PENDING',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    );
`);

console.log('All 8 tables ready.');

// ============================================
// MIGRATIONS
// ============================================
try { db.exec("ALTER TABLE products ADD COLUMN sku TEXT"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN badge TEXT DEFAULT NULL"); } catch (e) {}
try { db.exec("ALTER TABLE products ADD COLUMN featured INTEGER DEFAULT 0"); } catch (e) {}
try {
    db.exec(`
        CREATE TABLE IF NOT EXISTS product_variants (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            name TEXT NOT NULL,
            sku TEXT,
            price REAL,
            stock INTEGER DEFAULT 0,
            image TEXT,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS product_images (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER NOT NULL,
            url TEXT NOT NULL,
            alt TEXT,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        );
    `);
} catch (e) { console.error('Migration error:', e.message); }

// Ensure cart_items has a UNIQUE(user_id, product_id) constraint so the
// upsert works. SQLite auto-creates the index sqlite_autoindex_cart_items_1
// when the constraint exists; if it's missing we rebuild the table.
try {
    const autoIndex = db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'cart_items' AND name LIKE 'sqlite_autoindex_cart_items_%'"
    ).get();
    if (!autoIndex) {
        db.exec(`
            PRAGMA foreign_keys = OFF;
            BEGIN;
            CREATE TABLE cart_items_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                product_id INTEGER NOT NULL,
                quantity INTEGER DEFAULT 1,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
                UNIQUE(user_id, product_id)
            );
            INSERT INTO cart_items_new (id, user_id, product_id, quantity, added_at)
                SELECT id, user_id, product_id, quantity, added_at FROM cart_items;
            DROP TABLE cart_items;
            ALTER TABLE cart_items_new RENAME TO cart_items;
            COMMIT;
            PRAGMA foreign_keys = ON;
        `);
        console.log('Migration: rebuilt cart_items with UNIQUE(user_id, product_id).');
    }
} catch (e) {
    console.error('Cart migration error:', e.message);
    try { db.exec("ROLLBACK; PRAGMA foreign_keys = ON;"); } catch (_) {}
}

// Generate SKUs for existing products
// (runs again after product sync below so newly-synced products also get SKUs)

// Seed some default featured products if none exist
try {
    const featuredCount = db.prepare("SELECT COUNT(*) as count FROM products WHERE featured = 1").get();
    if (featuredCount.count === 0) {
        db.prepare("UPDATE products SET featured = 1 WHERE id IN (1, 2, 3, 6, 7)").run();
        console.log('Set default featured products.');
    }
} catch (e) {
    console.error('Featured seed error:', e.message);
}

console.log('Migrations applied.');

// Seed admin (development only)
if (!isProduction) {
    const adminCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
    if (adminCount.count === 0) {
        const hash = bcrypt.hashSync('admin123', 10);
        db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)")
            .run('Admin', 'admin@alphatech.com', hash, 'admin');
        console.log('Default admin seeded (admin@alphatech.com / admin123)');
    }
}

// Seed products
const productsSeed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'products.json'), 'utf-8'));
// Synchronize products on startup to apply updates from JSON
{
    try {
        const brands = [...new Set(productsSeed.map(p => p.brand))];
        const categoryMap = {};
        const insertCat = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
        const getCat = db.prepare("SELECT id FROM categories WHERE name = ?");
        const existsProduct = db.prepare("SELECT id FROM products WHERE name = ? AND brand = ?");
        const insertProduct = db.prepare(`INSERT INTO products (name, brand, category_id, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock, sku, badge, featured)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        const updateProduct = db.prepare(`UPDATE products SET price=?, stock=?, badge=?, featured=?, image=? WHERE name=? AND brand=?`);

        brands.forEach(brand => {
            insertCat.run(brand);
            const cat = getCat.get(brand);
            if (cat) categoryMap[brand] = cat.id;
        });

        let inserted = 0, updated = 0;
        db.transaction(() => {
            productsSeed.forEach(p => {
                const existing = existsProduct.get(p.name, p.brand);
                if (existing) {
                    updateProduct.run(p.price, p.stock ?? 10, p.badge || null, p.featured ? 1 : 0, p.image, p.name, p.brand);
                    updated++;
                    return;
                }
                insertProduct.run(
                    p.name,
                    p.brand,
                    categoryMap[p.brand] || null,
                    p.price,
                    p.description,
                    p.image,
                    p.specs?.processor || null,
                    p.specs?.display || null,
                    p.specs?.camera || null,
                    p.specs?.battery || null,
                    p.stock ?? 10,
                    null,
                    p.badge || null,
                    p.featured ? 1 : 0
                );
                inserted++;
            });
        })();

        console.log(`Products: ${inserted} inserted, ${updated} updated. Brands: ${brands.length}.`);
    } catch (err) {
        console.error('Could not seed products:', err.message);
    }

    // Ensure every product has a SKU (fresh inserts from the sync get one here)
    db.prepare(`UPDATE products SET sku = 'PHN-' || printf('%04d', id) WHERE sku IS NULL`).run();
}

// ============================================
// HELPERS
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function sanitizeText(value, maxLength = 2000) {
    if (typeof value !== 'string') return '';
    return value
        .replace(/<[^>]*>/g, '')
        .replace(/[<>]/g, '')
        .trim()
        .slice(0, maxLength);
}

function validatePassword(password) {
    if (!password || password.length < 8) return 'Password must be at least 8 characters.';
    if (!/[a-zA-Z]/.test(password)) return 'Password must contain at least one letter.';
    if (!/[0-9]/.test(password)) return 'Password must contain at least one number.';
    return null;
}

const canonBrands = { apple: 'Apple', samsung: 'Samsung', google: 'Google', oneplus: 'OnePlus', xiaomi: 'Xiaomi', nokia: 'Nokia', tecno: 'Tecno', sony: 'Sony', motorola: 'Motorola', honor: 'Honor' };

function normalizeName(v) { return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v; }
function normalizeBrand(v) {
    if (typeof v !== 'string') return v;
    const t = v.trim().replace(/\s+/g, ' ');
    return canonBrands[t.toLowerCase()] || t;
}
function normalizeImage(v) { return typeof v === 'string' ? v.trim() : v; }

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'UP', timestamp: new Date() });
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
        db.prepare("INSERT INTO users (username, email, phone, password_hash) VALUES (?, ?, ?, ?)")
            .run(username.trim(), email.toLowerCase().trim(), phone || null, hash);
        res.json({ success: true, message: 'Registration successful! You can now login.' });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(409).json({ success: false, message: 'An account with this email already exists.' });
        }
        console.error('Register error:', err);
        res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
    if (!user) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
        return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const token = jwt.sign(
        { id: user.id, username: user.username, email: user.email, phone: user.phone, role: user.role },
        JWT_SECRET, { expiresIn: '24h' }
    );

    res.json({
        success: true,
        message: `Welcome back, ${user.username}!`,
        token,
        user: { id: user.id, username: user.username, email: user.email, phone: user.phone, role: user.role }
    });
});

// ============================================
// PASSWORD RESET
// ============================================
app.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email || !EMAIL_RE.test(email)) {
        return res.status(400).json({ success: false, message: 'A valid email address is required.' });
    }

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());

    // Always return success to prevent email enumeration
    if (!user) {
        return res.json({ success: true, message: 'If this email is registered, a password reset link will be sent.' });
    }

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    db.prepare("DELETE FROM password_resets WHERE expires_at < CURRENT_TIMESTAMP").run();
    db.prepare("INSERT INTO password_resets (user_email, token, expires_at) VALUES (?, ?, ?)")
        .run(email, token, expiresAt);

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

    const resetData = db.prepare("SELECT * FROM password_resets WHERE token = ? AND expires_at > CURRENT_TIMESTAMP").get(token);
    if (!resetData) {
        return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
    }

    try {
        const hash = await bcrypt.hash(newPassword, 10);
        db.transaction(() => {
            db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(hash, resetData.user_email);
            db.prepare("DELETE FROM password_resets WHERE user_email = ?").run(resetData.user_email);
        })();
        res.json({ success: true, message: 'Password has been reset successfully! You can now log in.' });
    } catch {
        res.status(500).json({ success: false, message: 'Server error. Please try again.' });
    }
});

// ============================================
// USER PROFILE
// ============================================
app.put('/api/users/me', authenticateToken, async (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
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
    db.prepare("UPDATE users SET username = ?, phone = ?, password_hash = ? WHERE id = ?")
        .run(username || user.username, updatedPhone, hashToUpdate, req.user.id);

    const token = jwt.sign(
        { id: user.id, username: username || user.username, email: user.email, phone: updatedPhone, role: user.role },
        JWT_SECRET, { expiresIn: '24h' }
    );

    res.json({
        success: true,
        message: 'Profile updated!',
        token,
        user: { id: user.id, username: username || user.username, email: user.email, phone: updatedPhone, role: user.role }
    });
});

app.delete('/api/users/me', authenticateToken, async (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(500).json({ success: false, message: 'Database error.' });

    const match = await bcrypt.compare(req.body.password, user.password_hash);
    if (!match) return res.status(403).json({ success: false, message: 'Incorrect password.' });

    db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
    res.json({ success: true, message: 'Account deleted permanently.' });
});

// ============================================
// PRODUCT CATALOG
// ============================================
const productCols = `p.id, p.name, p.brand, p.sku, p.badge, p.featured, p.price, p.description, p.image, p.stock,
    p.specs_processor, p.specs_display, p.specs_camera, p.specs_battery, p.created_at,
    c.name as category_name, c.id as category_id,
    (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) as review_count,
    (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE product_id = p.id) as average_rating`;

const productJoins = `FROM products p LEFT JOIN categories c ON p.category_id = c.id`;

// GET /api/products — paginated, searchable, filterable
app.get('/api/products', (req, res) => {
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
        where.push("(p.name LIKE ? OR p.brand LIKE ? OR p.description LIKE ? OR p.sku LIKE ?)");
        const q = `%${search}%`;
        params.push(q, q, q, q);
    }
    if (brand) {
        where.push("p.brand = ?");
        params.push(brand);
    }
    if (category) {
        where.push("c.name = ?");
        params.push(category);
    }
    if (!isNaN(minPrice)) {
        where.push("p.price >= ?");
        params.push(minPrice);
    }
    if (!isNaN(maxPrice)) {
        where.push("p.price <= ?");
        params.push(maxPrice);
    }
    if (featured === 'true' || featured === '1') {
        where.push("p.featured = 1");
    }
    if (badge) {
        where.push("p.badge = ?");
        params.push(badge);
    }

    const whereClause = where.join(' AND ');

    const countRow = db.prepare(`SELECT COUNT(*) as total ${productJoins} WHERE ${whereClause}`).get(...params);
    const total = countRow.total;

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

    const rows = db.prepare(`SELECT ${productCols} ${productJoins} WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);

    const brandQuery = db.prepare(`SELECT p.brand, COUNT(*) as count FROM products p ${category ? `JOIN categories c ON p.category_id = c.id WHERE c.name = ?` : 'WHERE 1=1'} GROUP BY p.brand ORDER BY p.brand`);
    const brands = category ? brandQuery.all(category) : brandQuery.all();
    const categories = db.prepare("SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.name").all();

    res.json({
        products: rows,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        filters: { brands, categories },
    });
});

// GET /api/products/featured
app.get('/api/products/featured', (req, res) => {
    const limit = Math.min(20, parseInt(req.query.limit) || 8);
    res.json(db.prepare(`SELECT ${productCols} ${productJoins} WHERE p.featured = 1 ORDER BY p.created_at DESC LIMIT ?`).all(limit));
});

// GET /api/products/trending
app.get('/api/products/trending', (req, res) => {
    const limit = Math.min(20, parseInt(req.query.limit) || 8);
    res.json(db.prepare(`SELECT ${productCols} ${productJoins}
        ORDER BY (SELECT COUNT(*) FROM order_items oi WHERE oi.product_id = p.id) DESC, p.created_at DESC LIMIT ?`).all(limit));
});

// GET /api/products/related/:id
app.get('/api/products/related/:id', (req, res) => {
    const product = db.prepare("SELECT brand, category_id FROM products WHERE id = ?").get(req.params.id);
    if (!product) return res.json([]);
    const limit = Math.min(8, parseInt(req.query.limit) || 4);
    res.json(db.prepare(`SELECT ${productCols} ${productJoins}
        WHERE p.id != ? AND (p.brand = ? OR p.category_id = ?) ORDER BY p.created_at DESC LIMIT ?`)
        .all(req.params.id, product.brand, product.category_id, limit));
});

// GET /api/products/:id — single product with variants and images
app.get('/api/products/:id', (req, res) => {
    const row = db.prepare(`SELECT ${productCols} ${productJoins} WHERE p.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ success: false, message: 'Product not found.' });

    row.variants = db.prepare("SELECT * FROM product_variants WHERE product_id = ? ORDER BY sort_order").all(row.id);
    row.gallery = db.prepare("SELECT * FROM product_images WHERE product_id = ? ORDER BY sort_order").all(row.id);
    if (!row.gallery.length && row.image) {
        row.gallery = [{ url: row.image, alt: row.name }];
    }

    res.json(row);
});

// POST /api/products
app.post('/api/products', authenticateToken, requireAdmin, (req, res) => {
    const { name, brand, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock, sku, badge, featured } = req.body;
    const nb = normalizeBrand(brand);
    db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(nb);
    const cat = db.prepare("SELECT id FROM categories WHERE name = ?").get(nb);
    const result = db.prepare(`INSERT INTO products (name, brand, category_id, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock, sku, badge, featured)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(normalizeName(name), nb, cat ? cat.id : null, price, sanitizeText(description), normalizeImage(image),
            specs_processor, specs_display, specs_camera, specs_battery, stock || 10,
            sku || null, badge || null, featured ? 1 : 0);
    const id = result.lastInsertRowid;
    if (!sku) {
        db.prepare("UPDATE products SET sku = ? WHERE id = ?").run(`PHN-${String(id).padStart(4, '0')}`, id);
    }
    res.json({ success: true, id, message: 'Product added!' });
});

// PUT /api/products/:id
app.put('/api/products/:id', authenticateToken, requireAdmin, (req, res) => {
    const { name, brand, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock, sku, badge, featured } = req.body;
    const nb = normalizeBrand(brand);
    db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(nb);
    const cat = db.prepare("SELECT id FROM categories WHERE name = ?").get(nb);
    db.prepare(`UPDATE products SET name=?, brand=?, category_id=?, price=?, description=?, image=?,
        specs_processor=?, specs_display=?, specs_camera=?, specs_battery=?, stock=?, sku=?, badge=?, featured=? WHERE id=?`)
        .run(normalizeName(name), nb, cat ? cat.id : null, price, sanitizeText(description), normalizeImage(image),
            specs_processor, specs_display, specs_camera, specs_battery, stock, sku || null, badge || null, featured ? 1 : 0, req.params.id);
    res.json({ success: true, message: 'Product updated!' });
});

// DELETE /api/products/:id
app.delete('/api/products/:id', authenticateToken, requireAdmin, (req, res) => {
    db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: 'Product deleted.' });
});

// GET /api/categories — with product counts
app.get('/api/categories', (req, res) => {
    res.json(db.prepare("SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count FROM categories c ORDER BY c.name").all());
});

// GET /api/brands — with product counts
app.get('/api/brands', (req, res) => {
    res.json(db.prepare("SELECT brand as name, COUNT(*) as product_count FROM products GROUP BY brand ORDER BY brand").all());
});

// ============================================
// CART
// ============================================
app.get('/api/cart', authenticateToken, (req, res) => {
    res.json(db.prepare(`SELECT ci.id, ci.quantity, ci.added_at,
        p.id as product_id, p.name, p.brand, p.price, p.image
        FROM cart_items ci JOIN products p ON ci.product_id = p.id
        WHERE ci.user_id = ? ORDER BY ci.added_at DESC`).all(req.user.id));
});

app.post('/api/cart', authenticateToken, (req, res) => {
    const { product_id, quantity } = req.body;
    if (!product_id || !Number.isInteger(Number(product_id))) {
        return res.status(400).json({ success: false, message: 'Invalid product ID.' });
    }

    const qty = Math.max(1, Math.min(99, Number(quantity) || 1));

    try {
        const product = db.prepare("SELECT id, stock FROM products WHERE id = ?").get(product_id);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found.' });
        }
        if (product.stock <= 0) {
            return res.status(400).json({ success: false, message: 'This product is out of stock.' });
        }

        db.transaction(() => {
            const existing = db.prepare("SELECT id, quantity FROM cart_items WHERE user_id = ? AND product_id = ?")
                .get(req.user.id, product_id);
            if (existing) {
                db.prepare("UPDATE cart_items SET quantity = MIN(99, quantity + ?) WHERE id = ?")
                    .run(qty, existing.id);
            } else {
                db.prepare("INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)")
                    .run(req.user.id, product_id, qty);
            }
        })();

        res.json({ success: true, message: 'Added to cart!' });
    } catch (err) {
        console.error('Error adding to cart:', err);
        res.status(500).json({ success: false, message: 'Failed to add item to cart.' });
    }
});

app.put('/api/cart/:id', authenticateToken, (req, res) => {
    try {
        const qty = Math.max(1, Math.min(99, Number(req.body.quantity) || 1));
        const item = db.prepare("SELECT ci.id, ci.product_id, p.stock FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.id = ? AND ci.user_id = ?").get(req.params.id, req.user.id);
        if (!item) return res.status(404).json({ success: false, message: 'Cart item not found.' });
        if (qty > item.stock) return res.status(400).json({ success: false, message: `Only ${item.stock} in stock.` });
        db.prepare("UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?")
            .run(qty, req.params.id, req.user.id);
        res.json({ success: true, message: 'Cart updated.' });
    } catch (err) {
        console.error('Error updating cart:', err);
        res.status(500).json({ success: false, message: 'Failed to update cart.' });
    }
});

app.delete('/api/cart/:id', authenticateToken, (req, res) => {
    try {
        db.prepare("DELETE FROM cart_items WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
        res.json({ success: true, message: 'Removed from cart.' });
    } catch (err) {
        console.error('Error removing cart item:', err);
        res.status(500).json({ success: false, message: 'Failed to remove cart item.' });
    }
});

app.delete('/api/cart', authenticateToken, (req, res) => {
    try {
        db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.user.id);
        res.json({ success: true, message: 'Cart cleared.' });
    } catch (err) {
        console.error('Error clearing cart:', err);
        res.status(500).json({ success: false, message: 'Failed to clear cart.' });
    }
});

// ============================================
// ORDERS
// ============================================
app.post('/api/orders', authenticateToken, (req, res) => {
    const { shipping_name, shipping_email, shipping_address, shipping_city } = req.body;
    if (!shipping_name || !shipping_email || !shipping_address || !shipping_city) {
        return res.status(400).json({ success: false, message: 'All shipping fields are required.' });
    }

    const result = db.transaction(() => {
        const cartItems = db.prepare(`SELECT ci.quantity, p.id as product_id, p.price, p.stock, p.name
            FROM cart_items ci JOIN products p ON ci.product_id = p.id
            WHERE ci.user_id = ?`).all(req.user.id);

        if (cartItems.length === 0) return { error: 'Cart is empty.' };

        const outOfStock = cartItems.filter(i => i.stock < i.quantity);
        if (outOfStock.length > 0) {
            return { error: `Insufficient stock for: ${outOfStock.map(i => i.name).join(', ')}` };
        }

        const subtotal = Number(cartItems.reduce((s, i) => s + Number(i.price) * i.quantity, 0).toFixed(2));
        const total = Number((subtotal * 1.08).toFixed(2));
        const orderResult = db.prepare(`INSERT INTO orders (user_id, total_amount, shipping_name, shipping_email, shipping_address, shipping_city)
            VALUES (?, ?, ?, ?, ?, ?)`).run(req.user.id, total, shipping_name, shipping_email, shipping_address, shipping_city);

        const orderId = orderResult.lastInsertRowid;
        const insertItem = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)");
        const updateStock = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?");

        for (const item of cartItems) {
            insertItem.run(orderId, item.product_id, item.quantity, Number(item.price));
            const result = updateStock.run(item.quantity, item.product_id, item.quantity);
            if (result.changes === 0) {
                throw new Error(`Insufficient stock for: ${item.name}`);
            }
        }

        db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.user.id);
        return { success: true, orderId, totalAmount: total, message: 'Order placed!' };
    })();

    if (result.error) return res.status(400).json({ success: false, message: result.error });
    res.json(result);
});

app.get('/api/orders', authenticateToken, (req, res) => {
    const query = req.user.role === 'admin'
        ? `SELECT o.*, u.username, u.email as user_email FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC`
        : `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`;
    const params = req.user.role === 'admin' ? [] : [req.user.id];
    res.json(db.prepare(query).all(...params));
});

app.get('/api/orders/:id', authenticateToken, (req, res) => {
    const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'Order not found.' });
    if (order.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Unauthorized.' });
    }
    order.items = db.prepare(`SELECT oi.*, p.name, p.image, p.brand
        FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`).all(order.id);
    res.json(order);
});

// ============================================
// MOMO PAYMENT (Mock)
// ============================================
app.post('/pay', authenticateToken, async (req, res) => {
    try {
        const { phoneNumber, amount, orderId, currency = 'RWF' } = req.body;
        if (!phoneNumber || !amount) {
            return res.status(400).json({ success: false, message: 'Phone number and amount are required.' });
        }
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'Order ID is required.' });
        }

        const order = db.prepare("SELECT id, user_id, status, total_amount FROM orders WHERE id = ?").get(orderId);
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
        db.prepare(`INSERT INTO transactions (order_id, reference_id, phone_number, amount, currency, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING')`).run(orderId, referenceId, phoneNumber, Number(amount), currency);

        console.log(`[MoMo] ${amount} ${currency} | Ref: ${referenceId}`);

        res.status(202).json({
            status: 'PENDING',
            referenceId,
            message: 'Payment request sent. Check your phone to approve.'
        });

        setTimeout(() => {
            db.transaction(() => {
                db.prepare("UPDATE transactions SET status = 'SUCCESSFUL' WHERE reference_id = ?").run(referenceId);
                db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(orderId);
            })();
            console.log(`[MoMo] ${referenceId} -> SUCCESSFUL`);
        }, 5000);
    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ success: false, message: 'Payment initialization failed.' });
    }
});

app.get('/status/:referenceId', (req, res) => {
    const tx = db.prepare("SELECT * FROM transactions WHERE reference_id = ?").get(req.params.referenceId);
    if (!tx) {
        return res.status(404).json({ success: false, message: 'Payment reference not found.' });
    }
    res.json({ referenceId: req.params.referenceId, status: tx.status });
});

// ============================================
// REVIEWS
// ============================================
app.get('/api/products/:id/reviews', (req, res) => {
    res.json(db.prepare(`SELECT r.*, u.username FROM reviews r
        JOIN users u ON r.user_id = u.id WHERE r.product_id = ?
        ORDER BY r.created_at DESC`).all(req.params.id));
});

app.post('/api/reviews', authenticateToken, (req, res) => {
    const { product_id, rating, comment } = req.body;
    if (!product_id || !rating) {
        return res.status(400).json({ success: false, message: 'Product ID and rating are required.' });
    }
    const r = Number(rating);
    if (!Number.isInteger(r) || r < 1 || r > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5.' });
    }

    const purchase = db.prepare(`SELECT 1 FROM orders o
        JOIN order_items oi ON o.id = oi.order_id
        WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'paid' LIMIT 1`)
        .get(req.user.id, product_id);

    if (!purchase) {
        return res.status(403).json({ success: false, message: 'Only verified buyers can review this product.' });
    }

    const existing = db.prepare("SELECT id FROM reviews WHERE user_id = ? AND product_id = ?")
        .get(req.user.id, product_id);
    if (existing) {
        return res.status(409).json({ success: false, message: 'You have already reviewed this product.' });
    }

    db.prepare("INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)")
        .run(req.user.id, product_id, r, sanitizeText(comment) || null);
    res.json({ success: true, message: 'Thank you for your review!' });
});

// ============================================
// ADMIN
// ============================================
app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
    const getCount = (sql) => db.prepare(sql).get().count;
    const rev = db.prepare("SELECT SUM(amount) as total FROM transactions WHERE status = 'SUCCESSFUL'").get();
    res.json({
        totalUsers: getCount("SELECT COUNT(*) as count FROM users"),
        totalProducts: getCount("SELECT COUNT(*) as count FROM products"),
        totalOrders: getCount("SELECT COUNT(*) as count FROM orders"),
        totalRevenue: rev ? rev.total || 0 : 0,
        lowStockCount: getCount("SELECT COUNT(*) as count FROM products WHERE stock <= 3"),
    });
});

app.get('/api/admin/low-stock', authenticateToken, requireAdmin, (req, res) => {
    res.json(db.prepare("SELECT id, name, brand, stock, image FROM products WHERE stock <= 3 ORDER BY stock ASC").all());
});

app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
    res.json(db.prepare("SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC").all());
});

// ============================================
// ERROR HANDLER
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
app.get('*', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, '..', '404.html'));
});

// ============================================
// START
// ============================================
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
