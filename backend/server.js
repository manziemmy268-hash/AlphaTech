const fs = require('fs');
const path = require('path');
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath });

const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const app = express();
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*';
const corsOptions = ALLOWED_ORIGINS === '*'
    ? { origin: '*' }
    : { origin: ALLOWED_ORIGINS, credentials: true };
app.use(cors(corsOptions));
app.use(express.json());

app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-production';

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'UP', timestamp: new Date() });
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

console.log('✅ All 8 tables ready.');

// Seed admin
const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get();
if (userCount.count === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.prepare("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)")
        .run('Admin', 'admin@phonne.com', hash, 'admin');
    console.log('✅ Default admin seeded (admin@phonne.com / admin123)');
}

// Seed products
const productCount = db.prepare("SELECT COUNT(*) as count FROM products").get();
if (productCount.count === 0) {
    const productsPath = path.join(__dirname, '..', 'data', 'products.json');
    try {
        const rawData = fs.readFileSync(productsPath, 'utf-8');
        const products = JSON.parse(rawData);

        const brands = [...new Set(products.map(p => p.brand))];
        const categoryMap = {};
        const insertCategory = db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)");
        const getCategory = db.prepare("SELECT id FROM categories WHERE name = ?");
        const insertProduct = db.prepare(`INSERT INTO products (name, brand, category_id, price, description, image, specs_processor, specs_display, specs_camera, specs_battery)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

        brands.forEach(brand => {
            insertCategory.run(brand);
            const cat = getCategory.get(brand);
            if (cat) categoryMap[brand] = cat.id;
        });

        const insertMany = db.transaction(() => {
            products.forEach(p => {
                insertProduct.run(p.name, p.brand, categoryMap[p.brand], p.price, p.description, p.image,
                    p.specs.processor, p.specs.display, p.specs.camera, p.specs.battery);
            });
        });
        insertMany();

        console.log(`✅ Seeded ${products.length} products and ${brands.length} categories.`);
    } catch (err) {
        console.error('⚠️ Could not seed products:', err.message);
    }
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

const canonBrands = { apple: 'Apple', samsung: 'Samsung', google: 'Google', oneplus: 'OnePlus', xiaomi: 'Xiaomi', nokia: 'Nokia', tecno: 'Tecno' };

function normalizeName(v) { return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v; }
function normalizeBrand(v) {
    if (typeof v !== 'string') return v;
    const t = v.trim().replace(/\s+/g, ' ');
    return canonBrands[t.toLowerCase()] || t;
}
function normalizeImage(v) { return typeof v === 'string' ? v.trim() : v; }

// ============================================
// AUTH
// ============================================
app.post('/api/register', async (req, res) => {
    try {
        const { username, email, phone, password } = req.body;
        if (!username || !email || !password) {
            return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
        }
        const hash = await bcrypt.hash(password, 10);
        db.prepare("INSERT INTO users (username, email, phone, password_hash) VALUES (?, ?, ?, ?)")
            .run(username, email, phone || null, hash);
        res.json({ success: true, message: 'Registration successful! You can now login.' });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ success: false, message: 'Email already registered.' });
        }
        res.status(500).json({ success: false, message: 'Database error.' });
    }
});

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }
    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) return res.status(400).json({ success: false, message: 'Invalid email or password.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(400).json({ success: false, message: 'Invalid email or password.' });

    const token = jwt.sign(
        { id: user.id, username: user.username, email: user.email, phone: user.phone, role: user.role },
        JWT_SECRET, { expiresIn: '24h' }
    );
    delete user.password_hash;
    res.json({ success: true, message: `Welcome back, ${user.username}!`, token, user });
});

// ============================================
// PASSWORD RESET
// ============================================
app.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email address is required.' });

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!user) return res.status(404).json({ success: false, message: 'Email not registered.' });

    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    db.prepare("INSERT INTO password_resets (user_email, token, expires_at) VALUES (?, ?, ?)")
        .run(email, token, expiresAt);

    const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
    console.log(`\n📧 [MOCK EMAIL] To: ${email} | Reset: ${resetLink}\n`);

    res.json({ success: true, message: 'A recovery link has been generated.', mockLink: resetLink });
});

app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ success: false, message: 'Token and new password are required.' });

    const resetData = db.prepare("SELECT * FROM password_resets WHERE token = ? AND expires_at > CURRENT_TIMESTAMP").get(token);
    if (!resetData) return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });

    try {
        const hash = await bcrypt.hash(newPassword, 10);
        db.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(hash, resetData.user_email);
        db.prepare("DELETE FROM password_resets WHERE user_email = ?").run(resetData.user_email);
        res.json({ success: true, message: 'Password has been successfully reset! You can now log in.' });
    } catch {
        res.status(500).json({ success: false, message: 'Server error generating password.' });
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

    if (oldPassword && newPassword) {
        const match = await bcrypt.compare(oldPassword, user.password_hash);
        if (!match) return res.status(400).json({ success: false, message: 'Incorrect old password.' });
        hashToUpdate = await bcrypt.hash(newPassword, 10);
    }

    const updatedPhone = phone !== undefined ? phone : user.phone;
    db.prepare("UPDATE users SET username = ?, phone = ?, password_hash = ? WHERE id = ?")
        .run(username || user.username, updatedPhone, hashToUpdate, req.user.id);

    const token = jwt.sign(
        { id: user.id, username: username || user.username, email: user.email, phone: updatedPhone, role: user.role },
        JWT_SECRET, { expiresIn: '24h' }
    );

    res.json({ success: true, message: 'Profile updated successfully!', token, user: { ...user, username: username || user.username, phone: updatedPhone, password_hash: undefined } });
});

app.delete('/api/users/me', authenticateToken, async (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    if (!user) return res.status(500).json({ success: false, message: 'Database error.' });

    const match = await bcrypt.compare(req.body.password, user.password_hash);
    if (!match) return res.status(400).json({ success: false, message: 'Incorrect password.' });

    db.prepare("DELETE FROM users WHERE id = ?").run(req.user.id);
    res.json({ success: true, message: 'Your account has been deleted permanently.' });
});

// ============================================
// PRODUCTS
// ============================================
const productQuery = `SELECT p.*, c.name as category_name,
    (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) as review_count,
    (SELECT AVG(rating) FROM reviews WHERE product_id = p.id) as average_rating
    FROM products p LEFT JOIN categories c ON p.category_id = c.id`;

app.get('/api/products', (req, res) => {
    res.json(db.prepare(`${productQuery} ORDER BY p.id`).all());
});

app.get('/api/products/:id', (req, res) => {
    const row = db.prepare(`${productQuery} WHERE p.id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json(row);
});

app.post('/api/products', authenticateToken, requireAdmin, (req, res) => {
    const { name, brand, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock } = req.body;
    const nb = normalizeBrand(brand);
    db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(nb);
    const cat = db.prepare("SELECT id FROM categories WHERE name = ?").get(nb);
    const result = db.prepare(`INSERT INTO products (name, brand, category_id, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(normalizeName(name), nb, cat ? cat.id : null, price, description, normalizeImage(image),
            specs_processor, specs_display, specs_camera, specs_battery, stock || 10);
    res.json({ success: true, id: result.lastInsertRowid, message: 'Product added successfully!' });
});

app.put('/api/products/:id', authenticateToken, requireAdmin, (req, res) => {
    const { name, brand, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock } = req.body;
    const nb = normalizeBrand(brand);
    db.prepare("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(nb);
    const cat = db.prepare("SELECT id FROM categories WHERE name = ?").get(nb);
    db.prepare(`UPDATE products SET name=?, brand=?, category_id=?, price=?, description=?, image=?, specs_processor=?, specs_display=?, specs_camera=?, specs_battery=?, stock=? WHERE id=?`)
        .run(normalizeName(name), nb, cat ? cat.id : null, price, description, normalizeImage(image),
            specs_processor, specs_display, specs_camera, specs_battery, stock, req.params.id);
    res.json({ success: true, message: 'Product updated successfully!' });
});

app.delete('/api/products/:id', authenticateToken, requireAdmin, (req, res) => {
    db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
    res.json({ success: true, message: 'Product deleted.' });
});

app.get('/api/categories', (req, res) => {
    res.json(db.prepare("SELECT * FROM categories ORDER BY name").all());
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
    db.prepare(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)
        ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = quantity + ?`)
        .run(req.user.id, product_id, quantity || 1, quantity || 1);
    res.json({ success: true, message: 'Added to cart!' });
});

app.put('/api/cart/:id', authenticateToken, (req, res) => {
    db.prepare("UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?")
        .run(req.body.quantity, req.params.id, req.user.id);
    res.json({ success: true, message: 'Cart updated.' });
});

app.delete('/api/cart/:id', authenticateToken, (req, res) => {
    db.prepare("DELETE FROM cart_items WHERE id = ? AND user_id = ?").run(req.params.id, req.user.id);
    res.json({ success: true, message: 'Removed from cart.' });
});

app.delete('/api/cart', authenticateToken, (req, res) => {
    db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.user.id);
    res.json({ success: true, message: 'Cart cleared.' });
});

// ============================================
// ORDERS (with proper transaction)
// ============================================
app.post('/api/orders', authenticateToken, (req, res) => {
    const { shipping_name, shipping_email, shipping_address, shipping_city } = req.body;

    const placeOrder = db.transaction(() => {
        const cartItems = db.prepare(`SELECT ci.quantity, p.id as product_id, p.price, p.stock, p.name
            FROM cart_items ci JOIN products p ON ci.product_id = p.id
            WHERE ci.user_id = ?`).all(req.user.id);

        if (cartItems.length === 0) {
            return { error: 'Cart is empty.' };
        }

        const outOfStock = cartItems.filter(i => i.stock < i.quantity);
        if (outOfStock.length > 0) {
            return { error: `Insufficient stock for: ${outOfStock.map(i => i.name).join(', ')}` };
        }

        const total = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);
        const orderResult = db.prepare(`INSERT INTO orders (user_id, total_amount, shipping_name, shipping_email, shipping_address, shipping_city)
            VALUES (?, ?, ?, ?, ?, ?)`).run(req.user.id, total, shipping_name, shipping_email, shipping_address, shipping_city);

        const orderId = orderResult.lastInsertRowid;
        const insertItem = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)");
        const updateStock = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");

        cartItems.forEach(item => {
            insertItem.run(orderId, item.product_id, item.quantity, item.price);
            updateStock.run(item.quantity, item.product_id);
        });

        db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(req.user.id);
        return { success: true, orderId, totalAmount: total, message: 'Order placed successfully!' };
    });

    const result = placeOrder();
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
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.user_id !== req.user.id && req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Unauthorized' });
    }
    order.items = db.prepare(`SELECT oi.*,         p.name, p.image, p.brand
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
            return res.status(400).json({ error: 'Phone number and amount are required' });
        }

        const referenceId = uuidv4();
        db.prepare(`INSERT INTO transactions (order_id, reference_id, phone_number, amount, currency, status)
            VALUES (?, ?, ?, ?, ?, 'PENDING')`).run(orderId || null, referenceId, phoneNumber, amount, currency);

        console.log(`[MoMo] Payment ${amount} ${currency} for ${phoneNumber} | Ref: ${referenceId}`);

        res.status(202).json({
            status: 'PENDING',
            referenceId,
            message: 'Payment request sent to phone. Waiting for PIN approval.'
        });

        setTimeout(() => {
            db.prepare("UPDATE transactions SET status = 'SUCCESSFUL' WHERE reference_id = ?").run(referenceId);
            if (orderId) {
                db.prepare("UPDATE orders SET status = 'paid' WHERE id = ?").run(orderId);
            }
            console.log(`[MoMo] Payment ${referenceId} → SUCCESSFUL`);
        }, 5000);

    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ error: 'Payment initialization failed' });
    }
});

app.get('/status/:referenceId', (req, res) => {
    const tx = db.prepare("SELECT * FROM transactions WHERE reference_id = ?").get(req.params.referenceId);
    res.json({ referenceId: req.params.referenceId, status: tx ? tx.status : 'PENDING' });
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
        return res.status(400).json({ success: false, message: 'You have already reviewed this product.' });
    }

    db.prepare("INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)")
        .run(req.user.id, product_id, rating, comment);
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
// START
// ============================================
const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📦 Database: SQLite (WAL mode)`);
    console.log(`🔑 JWT Auth: Enabled`);
    console.log(`💳 MoMo Pay: Mock Mode`);
    console.log(`📡 Health: http://localhost:${PORT}/api/health\n`);
});

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
