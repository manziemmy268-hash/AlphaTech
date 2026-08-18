document.addEventListener('DOMContentLoaded', () => {
    if (!Auth.isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }
    loadOrderSummary();
    setupForm();
});

async function loadOrderSummary() {
    const itemsContainer = document.getElementById('checkout-items');
    itemsContainer.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>Calculating your order...</p></div>';

    try {
        const res = await fetch(`${API_URL}/cart`, {
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });
        if (res.status === 401 || res.status === 403) {
            Auth.handleAuthFailure('Session expired. Please log in again.');
            return;
        }
        const cart = await readJsonResponse(res, 'Unable to load checkout summary');
        
        if (cart.length === 0) {
            window.location.href = 'products.html';
            return;
        }

        let subtotal = 0;
        itemsContainer.innerHTML = cart.map(item => {
            const itemTotal = item.price * item.quantity;
            subtotal += itemTotal;
            return `
                <div class="checkout-item">
                    <span class="checkout-item-name">${item.quantity}x ${item.name}</span>
                    <span>$${itemTotal.toFixed(2)}</span>
                </div>
            `;
        }).join('');

        const tax = subtotal * 0.08;
        const total = subtotal + tax;

        document.getElementById('subtotal').textContent = `$${subtotal.toFixed(2)}`;
        document.getElementById('tax').textContent = `$${tax.toFixed(2)}`;
        document.getElementById('total').textContent = `$${total.toFixed(2)}`;
        document.getElementById('btn-total').textContent = `$${total.toFixed(2)}`;

        // Auto-fill from Auth
        const user = Auth.getCurrentUser();
        if (user) {
            if (document.getElementById('email')) document.getElementById('email').value = user.email || '';
            if (document.getElementById('fname')) document.getElementById('fname').value = user.username || '';
        }
    } catch (err) {
        console.error('Checkout summary error:', err);
    }
}

function setupForm() {
    const form = document.getElementById('checkout-form');
    const momoInput = document.getElementById('momo-phone');
    if (momoInput) {
        momoInput.addEventListener('input', function(e) {
            this.value = this.value.replace(/[^0-9]/g, '');
        });
    }

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (form.checkValidity()) {
            processCheckout();
        }
    });
}

async function processCheckout() {
    const btn = document.getElementById('place-order-btn');
    const formInputs = document.querySelectorAll('#checkout-form input');
    const paymentBaseUrl = window.APP_API_URL || window.location.origin;
    
    // UI Loading State
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Order...';
    formInputs.forEach(input => input.disabled = true);

    const fullName = `${document.getElementById('fname').value} ${document.getElementById('lname').value}`.trim();

    try {
        // Step 1: Create Order in DB
        const orderRes = await fetch(`${API_URL}/orders`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({
                shipping_name: fullName,
                shipping_email: document.getElementById('email').value,
                shipping_address: document.getElementById('address').value,
                shipping_city: document.getElementById('city').value
            })
        });

        if (orderRes.status === 401 || orderRes.status === 403) {
            Auth.handleAuthFailure('Session expired. Please log in again.');
            return;
        }
        const orderData = await readJsonResponse(orderRes, 'Order creation failed');
        if (!orderRes.ok) throw new Error(orderData.message || 'Order creation failed');

        // Step 2: Initialize MoMo Payment
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing MoMo Payment...';
        const payRes = await fetch(`${paymentBaseUrl}/pay`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({
                phoneNumber: document.getElementById('momo-phone').value,
                amount: orderData.totalAmount,
                orderId: orderData.orderId
            })
        });

        const payData = await readJsonResponse(payRes, 'Payment failed');
        if (!payRes.ok) throw new Error(payData.message || payData.error || 'Payment failed');

        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Awaiting PIN approval on phone...';

        // Step 3: Poll for Status (max 30 attempts / ~60 seconds)
        let attempts = 0;
        const maxAttempts = 30;
        const pollInterval = setInterval(async () => {
            attempts++;
            try {
                const statusRes = await fetch(`${paymentBaseUrl}/status/${payData.referenceId}`);

                if (statusRes.status === 404) {
                    clearInterval(pollInterval);
                    alert('Payment reference expired. Please try again.');
                    resetCheckout(btn, formInputs);
                    return;
                }

                const statusData = await readJsonResponse(statusRes, 'Unable to check payment status');

                if (statusData.status === 'SUCCESSFUL') {
                    clearInterval(pollInterval);
                    finishCheckout(orderData.orderId);
                } else if (statusData.status === 'FAILED') {
                    clearInterval(pollInterval);
                    alert('MoMo Payment failed.');
                    resetCheckout(btn, formInputs);
                } else if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    alert('Payment is taking too long. Please check your phone or contact support.');
                    resetCheckout(btn, formInputs);
                }
            } catch (err) {
                console.error('Polling error:', err);
                if (attempts >= maxAttempts) {
                    clearInterval(pollInterval);
                    alert('Unable to confirm payment. Please check your phone or contact support.');
                    resetCheckout(btn, formInputs);
                }
            }
        }, 2000);

    } catch (err) {
        console.error('Checkout Error:', err);
        alert(err.message || 'An error occurred during checkout.');
        resetCheckout(btn, formInputs);
    }
}

function resetCheckout(btn, formInputs) {
    btn.disabled = false;
    btn.innerHTML = `Place Order - ${document.getElementById('btn-total').textContent}`;
    formInputs.forEach(input => input.disabled = false);
}

async function finishCheckout(orderId) {
    updateCartCount(); // In app.js

    const modal = document.getElementById('success-modal');

    try {
        const res = await fetch(`${API_URL}/orders/${orderId}`, {
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });

        if (res.ok) {
            const order = await readJsonResponse(res, null);

            document.getElementById('receipt-order-id').textContent = `#${order.id}`;

            const items = order.items || [];
            document.getElementById('receipt-items').innerHTML = items.map(item => `
                <div class="receipt-item">
                    <span class="receipt-item-name">${escapeHtml(item.name)}</span>
                    <span class="receipt-item-qty">x${item.quantity}</span>
                    <span class="receipt-item-price">$${(item.unit_price * item.quantity).toFixed(2)}</span>
                </div>
            `).join('');

            const subtotal = order.total_amount / 1.08;
            const tax = order.total_amount - subtotal;

            document.getElementById('receipt-subtotal').textContent = `$${subtotal.toFixed(2)}`;
            document.getElementById('receipt-tax').textContent = `$${tax.toFixed(2)}`;
            document.getElementById('receipt-total').textContent = `$${Number(order.total_amount).toFixed(2)}`;

            document.getElementById('receipt-shipping').innerHTML = `
                <h4>Shipping To</h4>
                <p>${escapeHtml(order.shipping_name || '')}</p>
                <p>${escapeHtml(order.shipping_address || '')}, ${escapeHtml(order.shipping_city || '')}</p>
                <p>${escapeHtml(order.shipping_email || '')}</p>
            `;

            document.getElementById('view-order-btn').href = `orders.html?id=${order.id}`;
        }
    } catch (err) {
        console.error('Failed to load receipt:', err);
    }

    modal.style.display = 'flex';
}
