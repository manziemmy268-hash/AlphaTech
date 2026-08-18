document.addEventListener('DOMContentLoaded', () => {
    if (!Auth.isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }

    const orderId = getQueryParam('id');
    if (orderId) {
        loadOrderDetail(orderId);
    } else {
        loadOrdersList();
    }
});

async function loadOrdersList() {
    const container = document.getElementById('orders-container');
    container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>Loading your orders...</p></div>';

    try {
        const res = await fetch(`${API_URL}/orders`, {
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });

        if (res.status === 401 || res.status === 403) {
            Auth.handleAuthFailure('Session expired. Please log in again.');
            return;
        }

        const orders = await readJsonResponse(res, 'Unable to load orders');

        if (!Array.isArray(orders) || orders.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 4rem 2rem;">
                    <i class="fas fa-receipt" style="font-size: 4rem; color: var(--bg-color, #f0f0f0); margin-bottom: 1.5rem; display: block;"></i>
                    <h2>No orders yet</h2>
                    <p style="color: var(--secondary-color); margin-bottom: 2rem;">When you place an order, it will appear here.</p>
                    <a href="products.html" class="btn btn-primary">Start Shopping</a>
                </div>
            `;
            return;
        }

        container.innerHTML = orders.map(order => {
            const date = new Date(order.created_at).toLocaleDateString('en-US', {
                year: 'numeric', month: 'short', day: 'numeric'
            });
            const statusClass = order.status === 'paid' ? 'badge-paid' : 'badge-pending';
            const statusLabel = order.status === 'paid' ? 'Paid' : 'Pending';

            return `
                <a href="orders.html?id=${order.id}" class="order-card">
                    <div>
                        <div style="font-weight: 600; margin-bottom: 0.3rem;">Order #${order.id}</div>
                        <div style="font-size: 0.85rem; color: var(--secondary-color);">${date}</div>
                    </div>
                    <span class="badge ${statusClass}">${statusLabel}</span>
                    <div style="font-weight: 700; color: var(--primary-color);">$${Number(order.total_amount).toFixed(2)}</div>
                </a>
            `;
        }).join('');

    } catch (err) {
        console.error('Orders fetch error:', err);
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem;">
                <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: #ff3b30; margin-bottom: 1rem; display: block;"></i>
                <h3>Failed to load orders</h3>
                <p style="color: var(--secondary-color); margin-bottom: 1.5rem;">Please try again later.</p>
                <button onclick="loadOrdersList()" class="btn btn-primary">Retry</button>
            </div>
        `;
    }
}

async function loadOrderDetail(orderId) {
    document.getElementById('orders-list-view').style.display = 'none';
    document.getElementById('order-detail-view').style.display = 'block';
    document.getElementById('detail-order-id').textContent = orderId;

    const container = document.getElementById('order-detail-container');
    container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>Loading order details...</p></div>';

    try {
        const res = await fetch(`${API_URL}/orders/${orderId}`, {
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });

        if (res.status === 401 || res.status === 403) {
            Auth.handleAuthFailure('Session expired. Please log in again.');
            return;
        }

        if (res.status === 404) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem;">
                    <h2>Order not found</h2>
                    <p style="color: var(--secondary-color); margin-bottom: 1.5rem;">This order does not exist or you do not have access.</p>
                    <a href="orders.html" class="btn btn-primary">Back to Orders</a>
                </div>
            `;
            return;
        }

        const order = await readJsonResponse(res, 'Unable to load order details');

        const date = new Date(order.created_at).toLocaleDateString('en-US', {
            year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const statusClass = order.status === 'paid' ? 'badge-paid' : 'badge-pending';
        const statusLabel = order.status === 'paid' ? 'Paid' : 'Pending';

        const itemsHtml = (order.items || []).map(item => `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                        <img src="${getProductImageSrc(item.image)}" alt="${escapeHtml(item.name)}"
                             style="width: 45px; height: 45px; object-fit: contain; background: var(--bg-color, #f5f5f7); border-radius: 8px; padding: 0.3rem;" loading="lazy">
                        <div>
                            <a href="product.html?id=${item.product_id}">${escapeHtml(item.name)}</a>
                            <div style="font-size: 0.8rem; color: var(--secondary-color);">${escapeHtml(item.brand || '')}</div>
                        </div>
                    </div>
                </td>
                <td style="text-align: center;">${item.quantity}</td>
                <td>$${Number(item.unit_price).toFixed(2)}</td>
                <td style="font-weight: 600;">$${(item.unit_price * item.quantity).toFixed(2)}</td>
            </tr>
        `).join('');

        const subtotal = order.total_amount / 1.08;
        const tax = order.total_amount - subtotal;

        container.innerHTML = `
            <div class="detail-section">
                <h2><i class="fas fa-info-circle"></i> Order Information</h2>
                <div class="order-info-grid">
                    <div class="order-info-item">
                        <label>Order Number</label>
                        <span>#${order.id}</span>
                    </div>
                    <div class="order-info-item">
                        <label>Date Placed</label>
                        <span>${date}</span>
                    </div>
                    <div class="order-info-item">
                        <label>Status</label>
                        <span><span class="badge ${statusClass}">${statusLabel}</span></span>
                    </div>
                    <div class="order-info-item">
                        <label>Total</label>
                        <span style="color: var(--primary-color); font-size: 1.1rem;">$${Number(order.total_amount).toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div class="detail-section">
                <h2><i class="fas fa-truck"></i> Shipping Details</h2>
                <div class="order-info-grid">
                    <div class="order-info-item">
                        <label>Name</label>
                        <span>${escapeHtml(order.shipping_name || 'N/A')}</span>
                    </div>
                    <div class="order-info-item">
                        <label>Email</label>
                        <span>${escapeHtml(order.shipping_email || 'N/A')}</span>
                    </div>
                    <div class="order-info-item">
                        <label>Address</label>
                        <span>${escapeHtml(order.shipping_address || 'N/A')}</span>
                    </div>
                    <div class="order-info-item">
                        <label>City</label>
                        <span>${escapeHtml(order.shipping_city || 'N/A')}</span>
                    </div>
                </div>
            </div>

            <div class="detail-section">
                <h2><i class="fas fa-box-open"></i> Items Ordered</h2>
                <table class="order-items-table">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th style="text-align: center;">Qty</th>
                            <th>Price</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>${itemsHtml}</tbody>
                </table>

                <div style="max-width: 300px; margin-left: auto; margin-top: 1.5rem;">
                    <div class="summary-row">
                        <span>Subtotal</span>
                        <span>$${subtotal.toFixed(2)}</span>
                    </div>
                    <div class="summary-row">
                        <span>Tax (8%)</span>
                        <span>$${tax.toFixed(2)}</span>
                    </div>
                    <div class="summary-row summary-total">
                        <span>Total</span>
                        <span>$${Number(order.total_amount).toFixed(2)}</span>
                    </div>
                </div>
            </div>

            <div style="text-align: center; margin-top: 2rem;">
                <a href="orders.html" class="btn btn-secondary">
                    <i class="fas fa-arrow-left"></i> Back to My Orders
                </a>
            </div>
        `;

    } catch (err) {
        console.error('Order detail error:', err);
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem;">
                <i class="fas fa-exclamation-circle" style="font-size: 3rem; color: #ff3b30; margin-bottom: 1rem; display: block;"></i>
                <h3>Failed to load order</h3>
                <p style="color: var(--secondary-color); margin-bottom: 1.5rem;">Please try again later.</p>
                <button onclick="loadOrderDetail('${orderId}')" class="btn btn-primary">Retry</button>
            </div>
        `;
    }
}
