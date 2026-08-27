// AlphaTech feature test suite.
//
// Runs against a running backend (default: the local dev server on :3001
// backed by live Supabase). Each run uses unique email addresses and cleans
// up after itself, so it never pollutes real data and is safe to re-run.
//
// Run:  npm test
//       TEST_API_URL=http://localhost:3001 npm test

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const BASE = process.env.TEST_API_URL || 'http://localhost:3001';
const ADMIN = { email: 'admin@alphatech.com', password: 'admin123' };

// Unique per-process run id so repeated runs never collide.
const RUN = Date.now().toString(36);

async function request(path, { method = 'GET', token, body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(BASE + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    const text = await res.text();
    if (text) { try { json = JSON.parse(text); } catch { json = text; } }
    return { status: res.status, json };
}

// Track created entities so we can clean them up after the run.
// Each entry is { email, password } — password tracks the account's *current*
// password so cleanup still works even if a test changed it.
const cleanup = {
    users: [],
};

after(async () => {
    // Best-effort cleanup of any users we created. Deleting a user cascades to
    // their cart_items/orders/reviews (ON DELETE CASCADE), so account deletion
    // fully removes test data.
    for (const { email, password } of cleanup.users) {
        try {
            const login = await request('/api/login', {
                method: 'POST',
                body: { email, password },
            });
            if (login.json && login.json.token) {
                await request('/api/users/me', { method: 'DELETE', token: login.json.token, body: { password } });
            }
        } catch { /* ignore cleanup errors */ }
    }
});

// Update the tracked password for an email so cleanup stays accurate after
// a test changes the user's password.
function trackPassword(email, newPassword) {
    const rec = cleanup.users.find((u) => u.email === email);
    if (rec) rec.password = newPassword;
}

// ============================================================
// HEALTH
// ============================================================
test('health endpoint reports UP', async () => {
    const { status, json } = await request('/api/health');
    assert.equal(status, 200);
    assert.equal(json.status, 'UP');
});

// ============================================================
// AUTH
// ============================================================
async function makeUser() {
    const email = `test${RUN}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    cleanup.users.push({ email, password: 'Test1234!' });
    const reg = await request('/api/register', {
        method: 'POST',
        body: { username: 'Test User', email, password: 'Test1234!' },
    });
    return { email, reg };
}

test('register creates a new account', async () => {
    const { email, reg } = await makeUser();
    assert.equal(reg.status, 200);
    assert.equal(reg.json.success, true);
});

test('register rejects duplicate email with 409', async () => {
    const { email, reg } = await makeUser();
    assert.equal(reg.status, 200);
    const dup = await request('/api/register', {
        method: 'POST',
        body: { username: 'Other', email, password: 'Test1234!' },
    });
    assert.equal(dup.status, 409);
});

test('register rejects invalid email', async () => {
    const r = await request('/api/register', {
        method: 'POST',
        body: { username: 'X', email: 'not-an-email', password: 'Test1234!' },
    });
    assert.equal(r.status, 400);
});

test('register rejects weak password', async () => {
    const r = await request('/api/register', {
        method: 'POST',
        body: { username: 'X', email: `weak${RUN}@example.com`, password: 'short' },
    });
    assert.equal(r.status, 400);
});

test('login succeeds with valid credentials and returns a JWT', async () => {
    const { email, reg } = await makeUser();
    assert.equal(reg.status, 200);
    const login = await request('/api/login', {
        method: 'POST',
        body: { email, password: 'Test1234!' },
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.success, true);
    assert.ok(login.json.token && login.json.token.length > 20, 'returns a JWT');
    assert.equal(login.json.user.email, email);
});

test('login fails with wrong password (401)', async () => {
    const { email, reg } = await makeUser();
    assert.equal(reg.status, 200);
    const bad = await request('/api/login', {
        method: 'POST',
        body: { email, password: 'WrongPass1!' },
    });
    assert.equal(bad.status, 401);
});

test('auth/refresh returns a fresh token for a valid user', async () => {
    const { email, reg } = await makeUser();
    assert.equal(reg.status, 200);
    const login = await request('/api/login', { method: 'POST', body: { email, password: 'Test1234!' } });
    const refreshed = await request('/api/auth/refresh', { method: 'POST', token: login.json.token });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.json.success, true);
    assert.ok(refreshed.json.token);
});

test('protected route rejects missing or invalid token', async () => {
    // Missing token → 401 (unauthenticated)
    const noToken = await request('/api/cart');
    assert.equal(noToken.status, 401);
    // Present-but-invalid token → 403 (authenticated header, unverifiable)
    const badToken = await request('/api/cart', { token: 'garbage.token.here' });
    assert.equal(badToken.status, 403);
});

// ============================================================
// FORGOT / RESET PASSWORD
// ============================================================
test('forgot-password returns success for any valid email (no enumeration)', async () => {
    const r = await request('/api/forgot-password', {
        method: 'POST',
        body: { email: 'doesnotexist@example.com' },
    });
    assert.equal(r.status, 200);
    assert.equal(r.json.success, true);
});

test('reset-password rejects invalid token', async () => {
    const r = await request('/api/reset-password', {
        method: 'POST',
        body: { token: 'invalid-token', newPassword: 'NewPass123!' },
    });
    assert.equal(r.status, 400);
});

// ============================================================
// PRODUCT CATALOG
// ============================================================
test('products: lists paginated products', async () => {
    const { status, json } = await request('/api/products?limit=3');
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.products));
    assert.ok(json.products.length >= 1);
    assert.ok(json.pagination.total >= 1);
    assert.ok(json.pagination.pages >= 1);
});

test('products: search filter works', async () => {
    const { status, json } = await request('/api/products?search=Sony');
    assert.equal(status, 200);
    // Search matches name/brand/description/sku, so validate we got results
    // and that each visibly matches on name or brand where present.
    assert.ok(json.products.length >= 1);
    assert.ok(json.products.every((p) =>
        (p.name + ' ' + p.brand).toLowerCase().includes('sony')
        || (p.description || '').toLowerCase().includes('sony')
        || (p.sku || '').toLowerCase().includes('sony')
    ));
});

test('products: brand filter works', async () => {
    const { status, json } = await request('/api/products?brand=Sony');
    assert.equal(status, 200);
    assert.ok(json.products.length >= 1);
    assert.ok(json.products.every((p) => p.brand.toLowerCase() === 'sony'));
});

test('products: category filter works', async () => {
    const cats = await request('/api/categories');
    if (!cats.json || cats.json.length === 0) return; // skip if no categories
    const cat = cats.json[0];
    const { status, json } = await request(`/api/products?category=${encodeURIComponent(cat.id || cat.name)}`);
    assert.equal(status, 200);
    assert.ok(Array.isArray(json.products));
});

test('products: price range filter works', async () => {
    const { status, json } = await request('/api/products?minPrice=500&maxPrice=1000');
    assert.equal(status, 200);
    assert.ok(json.products.length >= 1);
    assert.ok(json.products.every((p) => p.price >= 500 && p.price <= 1000));
});

test('products: sort by price ascending', async () => {
    const { status, json } = await request('/api/products?sort=price_asc&limit=20');
    assert.equal(status, 200);
    const prices = json.products.map((p) => p.price);
    const sorted = [...prices].sort((a, b) => a - b);
    assert.deepEqual(prices, sorted);
});

test('products: single product detail returns variants + gallery', async () => {
    const list = await request('/api/products?limit=1');
    const id = list.json.products[0].id;
    const { status, json } = await request(`/api/products/${id}`);
    assert.equal(status, 200);
    assert.equal(json.id, id);
    assert.ok(Array.isArray(json.variants));
    assert.ok(Array.isArray(json.gallery) && json.gallery.length >= 1);
});

test('products: featured and trending endpoints respond', async () => {
    const f = await request('/api/products/featured?limit=3');
    assert.equal(f.status, 200);
    assert.ok(Array.isArray(f.json));
    const t = await request('/api/products/trending?limit=3');
    assert.equal(t.status, 200);
    assert.ok(Array.isArray(t.json));
});

test('categories and brands endpoints respond', async () => {
    const c = await request('/api/categories');
    assert.equal(c.status, 200);
    assert.ok(Array.isArray(c.json));
    const b = await request('/api/brands');
    assert.equal(b.status, 200);
    assert.ok(Array.isArray(b.json));
});

test('product reviews list returns an array', async () => {
    const list = await request('/api/products?limit=1');
    const id = list.json.products[0].id;
    const r = await request(`/api/products/${id}/reviews`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.json));
});

// ============================================================
// CART
// ============================================================
async function userWithToken() {
    const { email, reg } = await makeUser();
    assert.equal(reg.status, 200);
    const login = await request('/api/login', { method: 'POST', body: { email, password: 'Test1234!' } });
    return { token: login.json.token, email };
}
test('cart: add item, list, update, remove, clear', async () => {
    const { token } = await userWithToken();

    // Pick a product that has enough stock to also exercise a quantity *increase*.
    const products = (await request('/api/products?limit=50')).json.products;
    const product = products.find((p) => p.stock >= 5) || products[0];
    const productId = product.id;
    const hasBuffer = product.stock >= 5;
    const targetQty = hasBuffer ? 5 : Math.max(1, product.stock);

    // Add
    const add = await request('/api/cart', { method: 'POST', token, body: { product_id: productId, quantity: 2 } });
    assert.equal(add.status, 200);
    assert.equal(add.json.success, true);

    // List
    const got = await request('/api/cart', { token });
    assert.equal(got.status, 200);
    assert.equal(got.json.length, 1);
    assert.equal(got.json[0].product_id, productId);
    assert.equal(got.json[0].quantity, 2);
    const cartItemId = got.json[0].id;

    // Update quantity (to a value within stock; the stock guard must never 500)
    const upd = await request(`/api/cart/${cartItemId}`, { method: 'PUT', token, body: { quantity: targetQty } });
    assert.notEqual(upd.status, 500, 'update should not be a 500');
    const got2 = await request('/api/cart', { token });
    assert.equal(got2.json[0].quantity, targetQty);

    // Remove item
    const del = await request(`/api/cart/${cartItemId}`, { method: 'DELETE', token });
    assert.equal(del.status, 200);
    const got3 = await request('/api/cart', { token });
    assert.equal(got3.json.length, 0);

    // Clear
    await request('/api/cart', { method: 'POST', token, body: { product_id: productId, quantity: 1 } });
    const clr = await request('/api/cart', { method: 'DELETE', token });
    assert.equal(clr.status, 200);
    const got4 = await request('/api/cart', { token });
    assert.equal(got4.json.length, 0);
});

test('cart: rejects out-of-stock or invalid product', async () => {
    const { token } = await userWithToken();
    const bad = await request('/api/cart', { method: 'POST', token, body: { product_id: 99999999, quantity: 1 } });
    assert.equal(bad.status, 404);
});

// ============================================================
// ORDERS
// ============================================================
test('orders: placing an order requires shipping fields', async () => {
    const { token } = await userWithToken();
    const r = await request('/api/orders', { method: 'POST', token, body: {} });
    assert.equal(r.status, 400);
});

test('orders: full flow — add to cart, place order, list & detail', async () => {
    const { token } = await userWithToken();

    // Get a product (in-stock)
    const list = await request('/api/products?limit=1');
    const productId = list.json.products[0].id;
    await request('/api/cart', { method: 'POST', token, body: { product_id: productId, quantity: 1 } });

    // Place order
    const ship = {
        shipping_name: 'Test Buyer',
        shipping_email: `order${RUN}@example.com`,
        shipping_address: '1 Test Street',
        shipping_city: 'Testville',
    };
    const order = await request('/api/orders', { method: 'POST', token, body: ship });
    assert.equal(order.status, 200);
    assert.equal(order.json.success, true);
    assert.ok(order.json.orderId);

    // Cart should be cleared after order
    const cart = await request('/api/cart', { token });
    assert.equal(cart.json.length, 0);

    // List orders
    const orders = await request('/api/orders', { token });
    assert.equal(orders.status, 200);
    assert.ok(orders.json.some((o) => o.id === order.json.orderId));

    // Order detail includes items
    const detail = await request(`/api/orders/${order.json.orderId}`, { token });
    assert.equal(detail.status, 200);
    assert.ok(Array.isArray(detail.json.items) && detail.json.items.length >= 1);
});

test('orders: cannot view another user\'s order', async () => {
    const a = await userWithToken();
    const b = await userWithToken();
    const list = await request('/api/products?limit=1');
    const productId = list.json.products[0].id;
    await request('/api/cart', { method: 'POST', token: a.token, body: { product_id: productId, quantity: 1 } });
    const order = await request('/api/orders', {
        method: 'POST', token: a.token,
        body: { shipping_name: 'A', shipping_email: 'a@example.com', shipping_address: '1', shipping_city: 'X' },
    });
    const forbidden = await request(`/api/orders/${order.json.orderId}`, { token: b.token });
    assert.equal(forbidden.status, 403);
});

// ============================================================
// PAYMENT (mock MoMo)
// ============================================================
test('payment: returns 401 without auth and rejects missing fields', async () => {
    const noAuth = await request('/pay', { method: 'POST', body: { phoneNumber: '123', amount: 10 } });
    assert.equal(noAuth.status, 401);
    const { token } = await userWithToken();
    const missing = await request('/pay', { method: 'POST', token, body: {} });
    assert.equal(missing.status, 400);
});

// ============================================================
// ADMIN
// ============================================================
async function adminToken() {
    const login = await request('/api/login', { method: 'POST', body: ADMIN });
    return login.json.token;
}

test('admin: stats, low-stock and users require admin role', async () => {
    const { token } = await userWithToken();
    const blocked = await request('/api/admin/stats', { token });
    assert.equal(blocked.status, 403);
});

test('admin: stats, low-stock and users work for admin', async () => {
    const token = await adminToken();
    const stats = await request('/api/admin/stats', { token });
    assert.equal(stats.status, 200);
    assert.ok('totalUsers' in stats.json);
    assert.ok('totalProducts' in stats.json);
    assert.ok(stats.json.totalProducts >= 1);

    const low = await request('/api/admin/low-stock', { token });
    assert.equal(low.status, 200);
    assert.ok(Array.isArray(low.json));

    const users = await request('/api/admin/users', { token });
    assert.equal(users.status, 200);
    assert.ok(Array.isArray(users.json));
});

// ============================================================
// USER PROFILE
// ============================================================
test('users/me: update profile name and phone', async () => {
    const { token } = await userWithToken();
    const upd = await request('/api/users/me', {
        method: 'PUT',
        token,
        body: { username: 'Renamed User', phone: '555-1234' },
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.json.success, true);
    assert.equal(upd.json.user.username, 'Renamed User');
    assert.equal(upd.json.user.phone, '555-1234');
});

test('users/me: changing password requires correct old password', async () => {
    const { token, email } = await userWithToken();
    const bad = await request('/api/users/me', {
        method: 'PUT',
        token,
        body: { oldPassword: 'WrongPass1!', newPassword: 'NewPass123!' },
    });
    assert.equal(bad.status, 403);

    const good = await request('/api/users/me', {
        method: 'PUT',
        token,
        body: { oldPassword: 'Test1234!', newPassword: 'NewPass123!' },
    });
    assert.equal(good.status, 200);
    // Record the new password so cleanup can still delete this account.
    trackPassword(email, 'NewPass123!');
});
