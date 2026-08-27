-- AlphaTech Postgres Schema (Supabase)
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)
-- All single-quoted statements below are safe to run.

-- ============================================
-- USERS
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- PASSWORD RESETS
-- ============================================
CREATE TABLE IF NOT EXISTS password_resets (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);

-- ============================================
-- CATEGORIES
-- ============================================
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- PRODUCTS
-- ============================================
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
);

-- ============================================
-- ORDERS
-- ============================================
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
);

-- ============================================
-- ORDER ITEMS
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
    id SERIAL PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL
);

-- ============================================
-- CART ITEMS
-- ============================================
CREATE TABLE IF NOT EXISTS cart_items (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    quantity INTEGER DEFAULT 1,
    added_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(user_id, product_id)
);

-- ============================================
-- TRANSACTIONS
-- ============================================
CREATE TABLE IF NOT EXISTS transactions (
    id SERIAL PRIMARY KEY,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    reference_id TEXT UNIQUE NOT NULL,
    phone_number TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'USD',
    status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- REVIEWS
-- ============================================
CREATE TABLE IF NOT EXISTS reviews (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================
-- PRODUCT VARIANTS
-- ============================================
CREATE TABLE IF NOT EXISTS product_variants (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sku TEXT,
    price REAL,
    stock INTEGER DEFAULT 0,
    image TEXT,
    sort_order INTEGER DEFAULT 0
);

-- ============================================
-- PRODUCT IMAGES
-- ============================================
CREATE TABLE IF NOT EXISTS product_images (
    id SERIAL PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    alt TEXT,
    sort_order INTEGER DEFAULT 0
);

-- ============================================
-- INDEXES (mirror SQLite lookups + sorting perf)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_products_brand ON products(brand);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_featured ON products(featured);
CREATE INDEX IF NOT EXISTS idx_cart_user ON cart_items(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_product ON reviews(user_id, product_id);
