require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const fs = require('fs');

const app = express();
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*';
app.use(cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
}));
app.use(express.json());

// Serve frontend files
app.use(express.static(path.join(__dirname, '..')));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-in-production';

// Health check route
app.get('/api/health', (req, res) => {
    res.json({ status: 'UP', timestamp: new Date() });
});

// ============================================
// DATABASE INITIALIZATION
// ============================================
const db = new sqlite3.Database('./database.sqlite', (err) => {
    if (err) {
        console.error('❌ Error opening database', err.message);
    } else {
        console.log('✅ Connected to SQLite database.');
        db.run("PRAGMA foreign_keys = ON"); // Enable foreign keys
        initializeDatabase();
    }
});

function initializeDatabase() {
    db.serialize(() => {
        // 1. USERS TABLE
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            password_hash TEXT NOT NULL,
            role TEXT DEFAULT 'user',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Handle dev upgrades dynamically
        db.run("ALTER TABLE users ADD COLUMN phone TEXT", (err) => {});

        // 1.5. PASSWORD RESETS TABLE
        db.run(`CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT NOT NULL,
            token TEXT NOT NULL,
            expires_at DATETIME NOT NULL
        )`);

        // 2. CATEGORIES TABLE
        db.run(`CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 3. PRODUCTS TABLE
        db.run(`CREATE TABLE IF NOT EXISTS products (
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
        )`);

        // 4. ORDERS TABLE
        db.run(`CREATE TABLE IF NOT EXISTS orders (
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
        )`);

        // 5. ORDER ITEMS TABLE
        db.run(`CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            unit_price REAL NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id)
        )`);

        // 6. CART ITEMS TABLE
        db.run(`CREATE TABLE IF NOT EXISTS cart_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            quantity INTEGER DEFAULT 1,
            added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
            UNIQUE(user_id, product_id)
        )`);

        // 7. TRANSACTIONS TABLE
        db.run(`CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            reference_id TEXT UNIQUE NOT NULL,
            phone_number TEXT NOT NULL,
            amount REAL NOT NULL,
            currency TEXT DEFAULT 'RWF',
            status TEXT DEFAULT 'PENDING',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
        )`);

        // 8. REVIEWS TABLE
        db.run(`CREATE TABLE IF NOT EXISTS reviews (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            product_id INTEGER NOT NULL,
            rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
            comment TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )`);

        console.log('✅ All 8 tables created successfully.');

        // Seed default admin
        db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (row && row.count === 0) {
                bcrypt.hash('admin123', 10, (err, hash) => {
                    db.run("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)",
                        ['Admin', 'admin@phonne.com', hash, 'admin']);
                    console.log('✅ Default admin seeded (admin@phonne.com / admin123)');
                });
            }
        });

        // Seed products from products.json
        db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
            if (row && row.count === 0) {
                seedProducts();
            }
        });
    });
}

function seedProducts() {
    const productsPath = path.join(__dirname, '..', 'data', 'products.json');
    try {
        const rawData = fs.readFileSync(productsPath, 'utf-8');
        const products = JSON.parse(rawData);

        // First, seed unique categories (brands)
        const brands = [...new Set(products.map(p => p.brand))];
        const categoryMap = {};

        let completed = 0;
        brands.forEach(brand => {
            db.run("INSERT OR IGNORE INTO categories (name) VALUES (?)", [brand], function() {
                db.get("SELECT id FROM categories WHERE name = ?", [brand], (err, cat) => {
                    if (cat) categoryMap[brand] = cat.id;
                    completed++;
                    if (completed === brands.length) {
                        // Now seed products
                        products.forEach(p => {
                            db.run(`INSERT INTO products (name, brand, category_id, price, description, image, specs_processor, specs_display, specs_camera, specs_battery)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                [p.name, p.brand, categoryMap[p.brand], p.price, p.description, p.image,
                                 p.specs.processor, p.specs.display, p.specs.camera, p.specs.battery]);
                        });
                        console.log(`✅ Seeded ${products.length} products and ${brands.length} categories.`);
                    }
                });
            });
        });
    } catch (err) {
        console.error('⚠️ Could not seed products:', err.message);
    }
}

// ============================================
// JWT MIDDLEWARE
// ============================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"
    
    if (!token) return res.status(401).json({ success: false, message: 'Authentication required.' });
    
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ success: false, message: 'Invalid or expired token.' });
        req.user = user;
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required.' });
    }
    next();
}

function normalizeProductName(value) {
    return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value;
}

function normalizeBrandName(value) {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (!trimmed) return trimmed;
    const canonicalMap = {
        apple: 'Apple',
        samsung: 'Samsung',
        google: 'Google',
        oneplus: 'OnePlus',
        xiaomi: 'Xiaomi',
        nokia: 'Nokia',
        tecno: 'Tecno'
    };
    return canonicalMap[trimmed.toLowerCase()] || trimmed;
}

function normalizeImagePath(value) {
    return typeof value === 'string' ? value.trim() : value;
}

// ============================================
// AUTH ROUTES
// ============================================
app.post('/api/register', async (req, res) => {
    const { username, email, phone, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ success: false, message: 'Name, email, and password are required.' });
    }
    try {
        const hash = await bcrypt.hash(password, 10);
        db.run("INSERT INTO users (username, email, phone, password_hash) VALUES (?, ?, ?, ?)", 
            [username, email, phone || null, hash], 
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ success: false, message: 'Email already registered.' });
                    }
                    return res.status(500).json({ success: false, message: 'Database error.' });
                }
                res.json({ success: true, message: 'Registration successful! You can now login.' });
            }
        );
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }
    db.get("SELECT * FROM users WHERE email = ?", [email], async (err, user) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        if (!user) return res.status(400).json({ success: false, message: 'Invalid email or password.' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (match) {
            const token = jwt.sign(
                { id: user.id, username: user.username, email: user.email, phone: user.phone, role: user.role }, 
                JWT_SECRET, { expiresIn: '24h' }
            );
            delete user.password_hash;
            res.json({ success: true, message: `Welcome back, ${user.username}!`, token, user });
        } else {
            res.status(400).json({ success: false, message: 'Invalid email or password.' });
        }
    });
});

// ============================================
// PASSWORD RECOVERY ROUTES
// ============================================
app.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, message: 'Email address is required.' });

    db.get("SELECT * FROM users WHERE email = ?", [email], (err, user) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        if (!user) return res.status(404).json({ success: false, message: 'Email not registered.' });

        const token = uuidv4(); // Generate secure token
        const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 Hour

        db.run("INSERT INTO password_resets (user_email, token, expires_at) VALUES (?, ?, ?)", 
               [email, token, expiresAt], function(err) {
            if (err) return res.status(500).json({ success: false, message: 'Error generating reset token.' });
            
            const resetLink = `${req.protocol}://${req.get('host')}/reset-password.html?token=${token}`;
            console.log(`\n📧 [MOCK EMAIL DELIVERED]`);
            console.log(`To: ${email}`);
            console.log(`Subject: Password Reset Request`);
            console.log(`Body: Click here to reset your password -> ${resetLink}\n`);

            res.json({ success: true, message: 'A recovery link has been generated.', mockLink: resetLink });
        });
    });
});

app.post('/api/reset-password', async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ success: false, message: 'Token and new password are required.' });

    db.get("SELECT * FROM password_resets WHERE token = ? AND expires_at > CURRENT_TIMESTAMP", [token], async (err, resetData) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        if (!resetData) return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });

        try {
            const hash = await bcrypt.hash(newPassword, 10);
            db.run("UPDATE users SET password_hash = ? WHERE email = ?", [hash, resetData.user_email], function(err) {
                if (err) return res.status(500).json({ success: false, message: 'Error updating password.' });

                db.run("DELETE FROM password_resets WHERE user_email = ?", [resetData.user_email]); // Burn token logic
                res.json({ success: true, message: 'Password has been successfully reset! You can now log in.' });
            });
        } catch (err) {
            res.status(500).json({ success: false, message: 'Server error generating password.' });
        }
    });
});

// ============================================
// USER PROFILE ROUTES
// ============================================
app.put('/api/users/me', authenticateToken, async (req, res) => {
    const { username, phone, oldPassword, newPassword } = req.body;
    db.get("SELECT * FROM users WHERE id = ?", [req.user.id], async (err, user) => {
        if (err) return res.status(500).json({ success: false, message: 'Database error.' });
        if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

        let hashToUpdate = user.password_hash;

        // If trying to change password
        if (oldPassword && newPassword) {
            const match = await bcrypt.compare(oldPassword, user.password_hash);
            if (!match) return res.status(400).json({ success: false, message: 'Incorrect old password.' });
            hashToUpdate = await bcrypt.hash(newPassword, 10);
        }

        const updatedPhone = phone !== undefined ? phone : user.phone;

        db.run("UPDATE users SET username = ?, phone = ?, password_hash = ? WHERE id = ?", [username || user.username, updatedPhone, hashToUpdate, req.user.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: 'Could not update profile.' });
            
            // Generate new token with updated username/phone
            const token = jwt.sign(
                { id: user.id, username: username || user.username, email: user.email, phone: updatedPhone, role: user.role }, 
                JWT_SECRET, { expiresIn: '24h' }
            );

            res.json({ success: true, message: 'Profile updated successfully!', token, user: { ...user, username: username || user.username, phone: updatedPhone, password_hash: undefined } });
        });
    });
});

app.delete('/api/users/me', authenticateToken, async (req, res) => {
    const { password } = req.body;
    db.get("SELECT * FROM users WHERE id = ?", [req.user.id], async (err, user) => {
        if (err || !user) return res.status(500).json({ success: false, message: 'Database error.' });

        const match = await bcrypt.compare(password, user.password_hash);
        if (!match) return res.status(400).json({ success: false, message: 'Incorrect password.' });

        // SQLite's ON DELETE CASCADE will handle clearing related orders/cart info natively!
        db.run("DELETE FROM users WHERE id = ?", [req.user.id], function(err) {
            if (err) return res.status(500).json({ success: false, message: 'Error deleting account.' });
            res.json({ success: true, message: 'Your account has been deleted permanently.' });
        });
    });
});

// ============================================
// PRODUCT ROUTES (Public + Admin)
// ============================================

// GET all products (public)
app.get('/api/products', (req, res) => {
    db.all(`SELECT p.*, c.name as category_name,
                   (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) as review_count,
                   (SELECT AVG(rating) FROM reviews WHERE product_id = p.id) as average_rating
            FROM products p 
            LEFT JOIN categories c ON p.category_id = c.id
            ORDER BY p.id`, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// GET single product (public) with reviews summary
app.get('/api/products/:id', (req, res) => {
    db.get(`SELECT p.*, c.name as category_name,
                   (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) as review_count,
                   (SELECT AVG(rating) FROM reviews WHERE product_id = p.id) as average_rating
            FROM products p 
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = ?`, [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(404).json({ error: 'Product not found' });
        res.json(row);
    });
});

// POST new product (admin only)
app.post('/api/products', authenticateToken, requireAdmin, (req, res) => {
    const { name, brand, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock } = req.body;
    const normalizedName = normalizeProductName(name);
    const normalizedBrand = normalizeBrandName(brand);
    const normalizedImage = normalizeImagePath(image);
    
    // Get or create category from brand
    db.run("INSERT OR IGNORE INTO categories (name) VALUES (?)", [normalizedBrand], function() {
        db.get("SELECT id FROM categories WHERE name = ?", [normalizedBrand], (err, cat) => {
            const categoryId = cat ? cat.id : null;
            db.run(`INSERT INTO products (name, brand, category_id, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock) 
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [normalizedName, normalizedBrand, categoryId, price, description, normalizedImage, specs_processor, specs_display, specs_camera, specs_battery, stock || 10],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, id: this.lastID, message: 'Product added successfully!' });
                }
            );
        });
    });
});

// PUT update product (admin only)
app.put('/api/products/:id', authenticateToken, requireAdmin, (req, res) => {
    const { name, brand, price, description, image, specs_processor, specs_display, specs_camera, specs_battery, stock } = req.body;
    const normalizedName = normalizeProductName(name);
    const normalizedBrand = normalizeBrandName(brand);
    const normalizedImage = normalizeImagePath(image);
    
    db.run("INSERT OR IGNORE INTO categories (name) VALUES (?)", [normalizedBrand], function() {
        db.get("SELECT id FROM categories WHERE name = ?", [normalizedBrand], (err, cat) => {
            const categoryId = cat ? cat.id : null;
            db.run(`UPDATE products SET name=?, brand=?, category_id=?, price=?, description=?, image=?, specs_processor=?, specs_display=?, specs_camera=?, specs_battery=?, stock=? WHERE id=?`,
                [normalizedName, normalizedBrand, categoryId, price, description, normalizedImage, specs_processor, specs_display, specs_camera, specs_battery, stock, req.params.id],
                function(err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ success: true, message: 'Product updated successfully!' });
                }
            );
        });
    });
});

// DELETE product (admin only)
app.delete('/api/products/:id', authenticateToken, requireAdmin, (req, res) => {
    db.run("DELETE FROM products WHERE id = ?", [req.params.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Product deleted.' });
    });
});

// GET all categories (public)
app.get('/api/categories', (req, res) => {
    db.all("SELECT * FROM categories ORDER BY name", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ============================================
// CART ROUTES (Authenticated)
// ============================================

// GET cart items for logged-in user
app.get('/api/cart', authenticateToken, (req, res) => {
    db.all(`SELECT ci.id, ci.quantity, ci.added_at,
                   p.id as product_id, p.name, p.brand, p.price, p.image
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            WHERE ci.user_id = ?
            ORDER BY ci.added_at DESC`, [req.user.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST add to cart
app.post('/api/cart', authenticateToken, (req, res) => {
    const { product_id, quantity } = req.body;
    
    // If item already in cart, increase quantity
    db.run(`INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)
            ON CONFLICT(user_id, product_id) DO UPDATE SET quantity = quantity + ?`,
        [req.user.id, product_id, quantity || 1, quantity || 1],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Added to cart!' });
        }
    );
});

// PUT update cart item quantity
app.put('/api/cart/:id', authenticateToken, (req, res) => {
    const { quantity } = req.body;
    db.run("UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?",
        [quantity, req.params.id, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Cart updated.' });
        }
    );
});

// DELETE remove from cart
app.delete('/api/cart/:id', authenticateToken, (req, res) => {
    db.run("DELETE FROM cart_items WHERE id = ? AND user_id = ?",
        [req.params.id, req.user.id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, message: 'Removed from cart.' });
        }
    );
});

// DELETE clear entire cart
app.delete('/api/cart', authenticateToken, (req, res) => {
    db.run("DELETE FROM cart_items WHERE user_id = ?", [req.user.id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, message: 'Cart cleared.' });
    });
});

// ============================================
// ORDER ROUTES (Authenticated)
// ============================================

// POST create order from cart (with stock management)
app.post('/api/orders', authenticateToken, (req, res) => {
    const { shipping_name, shipping_email, shipping_address, shipping_city } = req.body;

    // 1. Get cart items with current stock info
    db.all(`SELECT ci.quantity, p.id as product_id, p.price, p.stock, p.name
            FROM cart_items ci
            JOIN products p ON ci.product_id = p.id
            WHERE ci.user_id = ?`, [req.user.id], (err, cartItems) => {
        
        if (err) return res.status(500).json({ error: err.message });
        if (!cartItems || cartItems.length === 0) {
            return res.status(400).json({ success: false, message: 'Cart is empty.' });
        }

        // 2. Check if all items are in stock
        const outOfStockItems = cartItems.filter(item => item.stock < item.quantity);
        if (outOfStockItems.length > 0) {
            const itemNames = outOfStockItems.map(i => i.name).join(', ');
            return res.status(400).json({ 
                success: false, 
                message: `Insufficient stock for: ${itemNames}` 
            });
        }

        const totalAmount = cartItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        // 3. Start Order Creation (using manual sequence to simulate transaction in SQLite)
        db.run(`INSERT INTO orders (user_id, total_amount, shipping_name, shipping_email, shipping_address, shipping_city) 
                VALUES (?, ?, ?, ?, ?, ?)`,
            [req.user.id, totalAmount, shipping_name, shipping_email, shipping_address, shipping_city],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                
                const orderId = this.lastID;

                // 4. Insert order items AND update product stock
                const insertItemStmt = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (?, ?, ?, ?)");
                const updateStockStmt = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");

                cartItems.forEach(item => {
                    insertItemStmt.run(orderId, item.product_id, item.quantity, item.price);
                    updateStockStmt.run(item.quantity, item.product_id);
                });

                insertItemStmt.finalize();
                updateStockStmt.finalize();

                // 5. Clear cart
                db.run("DELETE FROM cart_items WHERE user_id = ?", [req.user.id]);

                res.json({ success: true, orderId, totalAmount, message: 'Order placed successfully!' });
            }
        );
    });
});

// GET user's orders
app.get('/api/orders', authenticateToken, (req, res) => {
    const query = req.user.role === 'admin'
        ? `SELECT o.*, u.username, u.email as user_email FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC`
        : `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`;
    
    const params = req.user.role === 'admin' ? [] : [req.user.id];
    
    db.all(query, params, (err, orders) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(orders);
    });
});

// GET single order with items
app.get('/api/orders/:id', authenticateToken, (req, res) => {
    db.get("SELECT * FROM orders WHERE id = ?", [req.params.id], (err, order) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!order) return res.status(404).json({ error: 'Order not found' });
        
        // Check ownership or admin
        if (order.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        db.all(`SELECT oi.*, p.name, p.image, p.brand 
                FROM order_items oi 
                JOIN products p ON oi.product_id = p.id 
                WHERE oi.order_id = ?`, [order.id], (err, items) => {
            if (err) return res.status(500).json({ error: err.message });
            order.items = items;
            res.json(order);
        });
    });
});

// ============================================
// MOMO PAYMENT ROUTES
// ============================================
const MOMO_BASE_URL = 'https://sandbox.momodeveloper.mtn.com/collection';
const SUBSCRIPTION_KEY = process.env.MOMO_SUBSCRIPTION_KEY || 'dummy-key';

async function getMoMoToken() {
    return 'mock_bearer_token_12345';
}

// POST /pay — now saves transaction to DB
app.post('/pay', authenticateToken, async (req, res) => {
    try {
        const { phoneNumber, amount, orderId, currency = 'RWF' } = req.body;

        if (!phoneNumber || !amount) {
            return res.status(400).json({ error: 'Phone number and amount are required' });
        }

        const referenceId = uuidv4();

        // Save transaction to DB
        db.run(`INSERT INTO transactions (order_id, reference_id, phone_number, amount, currency, status) 
                VALUES (?, ?, ?, ?, ?, 'PENDING')`,
            [orderId || null, referenceId, phoneNumber, amount, currency]);

        console.log(`[MoMo] Payment of ${amount} ${currency} for ${phoneNumber} | Ref: ${referenceId}`);

        res.status(202).json({
            status: 'PENDING',
            referenceId: referenceId,
            message: 'Payment request sent to phone. Waiting for PIN approval.'
        });

        // MOCK: Simulate PIN approval after 5 seconds
        setTimeout(() => {
            db.run("UPDATE transactions SET status = 'SUCCESSFUL' WHERE reference_id = ?", [referenceId]);
            if (orderId) {
                db.run("UPDATE orders SET status = 'paid' WHERE id = ?", [orderId]);
            }
            console.log(`[MoMo] Payment ${referenceId} → SUCCESSFUL`);
        }, 5000);

    } catch (error) {
        console.error('Payment error:', error);
        res.status(500).json({ error: 'Payment initialization failed' });
    }
});

// GET /status/:referenceId — now reads from DB
app.get('/status/:referenceId', (req, res) => {
    db.get("SELECT * FROM transactions WHERE reference_id = ?", [req.params.referenceId], (err, tx) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({
            referenceId: req.params.referenceId,
            status: tx ? tx.status : 'PENDING'
        });
    });
});

// ============================================
// REVIEW ROUTES
// ============================================

// GET reviews for a product
app.get('/api/products/:id/reviews', (req, res) => {
    db.all(`SELECT r.*, u.username 
            FROM reviews r 
            JOIN users u ON r.user_id = u.id 
            WHERE r.product_id = ? 
            ORDER BY r.created_at DESC`, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// POST a new review (Verified Purchase Only)
app.post('/api/reviews', authenticateToken, (req, res) => {
    const { product_id, rating, comment } = req.body;
    
    if (!product_id || !rating) {
        return res.status(400).json({ success: false, message: 'Product ID and rating are required.' });
    }

    // Verify purchase: User must have a 'paid' order containing this product
    db.get(`SELECT 1 FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'paid'
            LIMIT 1`, [req.user.id, product_id], (err, purchase) => {
        
        if (err) return res.status(500).json({ success: false, message: 'Verification error.' });
        if (!purchase) {
            return res.status(403).json({ success: false, message: 'Only verified buyers can review this product.' });
        }

        // Check if user already reviewed
        db.get("SELECT id FROM reviews WHERE user_id = ? AND product_id = ?", [req.user.id, product_id], (err, existing) => {
            if (existing) {
                return res.status(400).json({ success: false, message: 'You have already reviewed this product.' });
            }

            db.run("INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)",
                [req.user.id, product_id, rating, comment], function(err) {
                    if (err) return res.status(500).json({ success: false, message: 'Could not save review.' });
                    res.json({ success: true, message: 'Thank you for your review!' });
                }
            );
        });
    });
});

// ============================================
// ADMIN STATS ROUTE
// ============================================
app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
    const stats = {};
    db.get("SELECT COUNT(*) as count FROM users", (err, row) => {
        stats.totalUsers = row ? row.count : 0;
        db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
            stats.totalProducts = row ? row.count : 0;
            db.get("SELECT COUNT(*) as count FROM orders", (err, row) => {
                stats.totalOrders = row ? row.count : 0;
                db.get("SELECT SUM(amount) as total FROM transactions WHERE status = 'SUCCESSFUL'", (err, row) => {
                    stats.totalRevenue = row ? row.total || 0 : 0;
                    db.get("SELECT COUNT(*) as count FROM products WHERE stock <= 3", (err, row) => {
                        stats.lowStockCount = row ? row.count : 0;
                        res.json(stats);
                    });
                });
            });
        });
    });
});

// GET low stock products (admin only)
app.get('/api/admin/low-stock', authenticateToken, requireAdmin, (req, res) => {
    db.all("SELECT id, name, brand, stock, image FROM products WHERE stock <= 3 ORDER BY stock ASC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ============================================
// ADMIN USERS ROUTE
// ============================================
app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
    db.all("SELECT id, username, email, role, created_at FROM users ORDER BY created_at DESC", (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ============================================
// START SERVER
// ============================================
const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server is running on http://localhost:${PORT}`);
    console.log(`📦 Database: SQLite (./database.sqlite)`);
    console.log(`🔑 JWT Auth: Enabled`);
    console.log(`💳 MoMo Pay: Mock Mode`);
    console.log(`📡 Health Check: http://localhost:${PORT}/api/health\n`);
});

// Graceful Shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down server...');
    server.close(() => {
        db.close((err) => {
            if (err) console.error('Error closing database', err.message);
            else console.log('Database connection closed.');
            process.exit(0);
        });
    });
});

process.on('SIGTERM', () => {
    console.log('\n🛑 SIGTERM received. Shutting down...');
    server.close(() => {
        db.close(() => process.exit(0));
    });
});
