document.addEventListener('DOMContentLoaded', () => {
    if (!Auth.isLoggedIn()) {
        window.location.href = 'login.html';
        return;
    }
    renderCart();
});

async function renderCart() {
    const container = document.getElementById('cart-items-container');
    container.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-spin"></i><p>Loading your cart...</p></div>';

    try {
        const res = await fetch(`${API_URL}/cart`, {
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });
        if (res.status === 401 || res.status === 403) {
            Auth.handleAuthFailure('Session expired. Please log in again.');
            return;
        }
        const cart = await readJsonResponse(res, 'Unable to load cart');
        
        if (cart.length === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 3rem;">
                    <i class="fas fa-shopping-cart" style="font-size: 4rem; color: var(--bg-color); margin-bottom: 1.5rem; display: block;"></i>
                    <h2>Your cart is empty</h2>
                    <p style="color: var(--secondary-color); margin-bottom: 2rem;">Browse our store to find the perfect device.</p>
                    <a href="products.html" class="btn btn-primary">Start Shopping</a>
                </div>
            `;
            updateSummary(0);
            return;
        }

        container.innerHTML = cart.map(item => `
            <div class="cart-item">
                <img src="${getProductImageSrc(item.image)}" alt="${item.name}" loading="lazy" width="80" height="80">
                <div class="cart-item-info">
                    <h3>${item.name}</h3>
                    <p class="price">$${item.price}</p>
                    <button class="remove-btn" onclick="removeFromCart(${item.id})">Remove</button>
                </div>
                <div class="quantity-controls">
                    <button class="quantity-btn" onclick="updateQuantity(${item.id}, ${item.quantity - 1})">-</button>
                    <span>${item.quantity}</span>
                    <button class="quantity-btn" onclick="updateQuantity(${item.id}, ${item.quantity + 1})">+</button>
                </div>
                <div style="font-weight: 700; width: 100px; text-align: right;">
                    $${(item.price * item.quantity).toFixed(2)}
                </div>
            </div>
        `).join('');

        const subtotal = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        updateSummary(subtotal);
    } catch (err) {
        console.error('Cart fetch error:', err);
        container.innerHTML = '<p>Error loading cart. Please try again later.</p>';
    }
}

async function updateQuantity(id, newQuantity) {
    if (newQuantity <= 0) {
        return removeFromCart(id);
    }
    
    try {
        const res = await fetch(`${API_URL}/cart/${id}`, {
            method: 'PUT',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ quantity: newQuantity })
        });
        if (res.status === 401 || res.status === 403) {
            Auth.handleAuthFailure('Session expired. Please log in again.');
            return;
        }
        renderCart();
        updateCartCount();
    } catch (err) {
        console.error('Update qty error:', err);
    }
}

async function removeFromCart(id) {
    try {
        const res = await fetch(`${API_URL}/cart/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });
        if (res.status === 401 || res.status === 403) {
            Auth.handleAuthFailure('Session expired. Please log in again.');
            return;
        }
        renderCart();
        updateCartCount();
    } catch (err) {
        console.error('Remove item error:', err);
    }
}

function updateSummary(subtotal) {
    const tax = subtotal * 0.08; // 8% tax
    const total = subtotal + tax;

    document.getElementById('subtotal').textContent = `$${subtotal.toFixed(2)}`;
    document.getElementById('tax').textContent = `$${tax.toFixed(2)}`;
    document.getElementById('total').textContent = `$${total.toFixed(2)}`;
}
