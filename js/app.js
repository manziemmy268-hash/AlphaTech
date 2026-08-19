// Shared App Logic
document.addEventListener('DOMContentLoaded', async () => {
    updateCartCount();
    setupSearch();
    setupScrollAnimations();
    setupPasswordToggle();
    setupMobileNav();
    setupBackToTop();
});

// Setup scroll reveal animations using Intersection Observer
window.scrollObserver = window.scrollObserver || new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('active');
            window.scrollObserver.unobserve(entry.target);
        }
    });
}, { threshold: 0.1 });

function setupPasswordToggle() {
    document.querySelectorAll('.toggle-password').forEach(icon => {
        icon.addEventListener('click', function() {
            const input = this.parentElement.querySelector('input');
            if (input.type === 'password') {
                input.type = 'text';
                this.classList.remove('fa-eye');
                this.classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                this.classList.remove('fa-eye-slash');
                this.classList.add('fa-eye');
            }
        });
    });
}

function setupScrollAnimations() {
    document.querySelectorAll('.reveal:not(.active)').forEach((el) => {
        window.scrollObserver.observe(el);
    });
}

// Products are now managed by the backend
const API_URL = window.APP_API_URL ? window.APP_API_URL + '/api' : '/api';

async function readJsonResponse(res, fallbackMessage) {
    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();

    if (!raw) {
        if (res.ok) return null;
        throw new Error(fallbackMessage || `Request failed with status ${res.status}`);
    }

    if (contentType.includes('application/json')) {
        try {
            return JSON.parse(raw);
        } catch (err) {
            throw new Error(fallbackMessage || 'Received malformed JSON from the server.');
        }
    }

    if (res.ok) {
        return raw;
    }

    throw new Error(raw.trim() || fallbackMessage || `Request failed with status ${res.status}`);
}

async function fetchProducts() {
    try {
        const res = await fetch(`${API_URL}/products`);
        if (!res.ok) throw new Error('Unable to load products');
        return await readJsonResponse(res, 'Unable to load products');
    } catch (err) {
        console.error('Failed to fetch products:', err);
        return [];
    }
}

async function fetchProductById(id) {
    try {
        const res = await fetch(`${API_URL}/products/${id}`);
        if (!res.ok) throw new Error('Unable to load product');
        return await readJsonResponse(res, 'Unable to load product');
    } catch (err) {
        console.error('Failed to fetch product:', err);
        return null;
    }
}

// Update cart counter in the navbar
async function updateCartCount() {
    const countElement = document.getElementById('cart-count');
    if (!countElement) return;

    if (!Auth.isLoggedIn()) {
        countElement.textContent = '0';
        return;
    }

    try {
        const res = await fetch(`${API_URL}/cart`, {
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });
        if (res.status === 401 || res.status === 403) {
            Auth.clearSession();
            countElement.textContent = '0';
            return;
        }
        const cart = await readJsonResponse(res, 'Unable to load cart count');
        const totalItems = Array.isArray(cart) ? cart.reduce((sum, item) => sum + item.quantity, 0) : 0;
        countElement.textContent = totalItems;
    } catch (err) {
        console.error('Failed to update cart count:', err);
        countElement.textContent = '0';
    }
}

// Global search setup (press enter to go to products page with search query)
function setupSearch() {
    const searchInput = document.getElementById('global-search');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                const query = searchInput.value.trim();
                if (query) {
                    window.location.href = `products.html?search=${encodeURIComponent(query)}`;
                }
            }
        });
    }
}

// Utility to get URL parameters
function getQueryParam(param) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(param);
}

function getProductImageSrc(image) {
    const fallback = 'assets/images/placeholder.svg';
    return image && image.trim() ? image.trim() : fallback;
}

function handleProductImageError(img) {
    img.onerror = null;
    img.src = 'assets/images/placeholder.svg';
    img.alt = 'Product image unavailable';
    img.classList.add('image-fallback');
}

// Cart management shared functions
async function addToCart(productId, quantity) {
    if (!Auth.isLoggedIn()) {
        showToast('Please login to add items to cart.');
        setTimeout(() => window.location.href = 'login.html', 1500);
        return;
    }

    const qty = Math.max(1, Math.min(99, Number(quantity) || 1));

    try {
        const res = await fetch(`${API_URL}/cart`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ product_id: productId, quantity: qty })
        });
        if (res.status === 401 || res.status === 403) {
            Auth.handleAuthFailure('Session expired. Please log in again.');
            return;
        }
        const result = await readJsonResponse(res, 'Unable to add to cart');
        if (result.success) {
            updateCartCount();
            showToast('Item added to cart!');
        } else {
            showToast(result.message || 'Error adding to cart');
        }
    } catch (err) {
        console.error('Cart add error:', err);
        console.error('Cart add details:', { message: err.message, stack: err.stack, name: err.name });
        showToast('Server error: ' + (err.message || 'Unable to add to cart'));
    }
}

// Wishlist toggle (stored in localStorage)
function addToWishlist(productId) {
    const wishlist = JSON.parse(localStorage.getItem('alphatech_wishlist') || '[]');
    const index = wishlist.indexOf(productId);
    const icon = document.getElementById(`wishlist-icon-${productId}`);
    if (index > -1) {
        wishlist.splice(index, 1);
        if (icon) icon.className = 'far fa-heart';
        showToast('Removed from wishlist');
    } else {
        wishlist.push(productId);
        if (icon) icon.className = 'fas fa-heart';
        showToast('Added to wishlist!');
    }
    localStorage.setItem('alphatech_wishlist', JSON.stringify(wishlist));
}

// Custom Toast Notification System
function showToast(message) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `<i class="fas fa-check-circle"></i> <span></span>`;
    toast.querySelector('span').textContent = message;
    container.appendChild(toast);
    
    // Trigger reflow to start animation
    setTimeout(() => toast.classList.add('show'), 10);
    
    // Auto remove after 3 seconds
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Mobile hamburger menu
function setupMobileNav() {
    const navbar = document.querySelector('.navbar');
    const navContainer = document.querySelector('.nav-container');
    const navLinks = document.querySelector('.nav-links');
    const navActions = document.querySelector('.nav-actions');
    if (!navbar || !navContainer || !navLinks) return;

    // Inject hamburger button
    let hamburger = document.getElementById('hamburger-btn');
    if (!hamburger) {
        hamburger = document.createElement('button');
        hamburger.id = 'hamburger-btn';
        hamburger.className = 'hamburger';
        hamburger.setAttribute('aria-label', 'Toggle navigation menu');
        hamburger.innerHTML = '<span></span><span></span><span></span>';
        const logo = document.querySelector('.logo');
        if (logo) logo.after(hamburger);
    }

    // Inject mobile nav overlay
    let mobileOverlay = document.getElementById('mobile-nav-overlay');
    if (!mobileOverlay) {
        mobileOverlay = document.createElement('div');
        mobileOverlay.id = 'mobile-nav-overlay';
        mobileOverlay.className = 'mobile-nav-overlay';
        document.body.appendChild(mobileOverlay);

        const mobilePanel = document.createElement('div');
        mobilePanel.className = 'mobile-nav-panel';
        mobileOverlay.appendChild(mobilePanel);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'mobile-nav-close';
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';
        closeBtn.addEventListener('click', toggleMobileNav);
        mobilePanel.appendChild(closeBtn);

        // Clone nav links
        const clone = navLinks.cloneNode(true);
        clone.id = 'mobile-nav-links';
        clone.querySelectorAll('.user-profile-dropdown').forEach(d => {
            d.addEventListener('click', (e) => e.stopPropagation());
        });
        mobilePanel.appendChild(clone);

        // Add auth section at bottom
        const mobileAuth = document.createElement('div');
        mobileAuth.className = 'mobile-nav-auth';
        mobilePanel.appendChild(mobileAuth);

        mobileOverlay.addEventListener('click', (e) => {
            if (e.target === mobileOverlay) toggleMobileNav();
        });
    }

    // Keep mobile auth synced with desktop auth
    function syncMobileAuth() {
        const mobileAuth = document.querySelector('.mobile-nav-auth');
        if (!mobileAuth) return;
        const user = Auth.getCurrentUser();
        if (user) {
            mobileAuth.innerHTML = `
                <div class="mobile-user-info">
                    <i class="fas fa-user-circle"></i> ${user.username}
                </div>
                ${user.role === 'admin' ? '<a href="admin.html" class="mobile-nav-link"><i class="fas fa-cog"></i> Dashboard</a>' : ''}
                <a href="orders.html" class="mobile-nav-link"><i class="fas fa-box"></i> My Orders</a>
                <a href="settings.html" class="mobile-nav-link"><i class="fas fa-user-cog"></i> Settings</a>
                <a href="#" class="mobile-nav-link" onclick="Auth.logout()"><i class="fas fa-sign-out-alt"></i> Logout</a>
            `;
        } else {
            mobileAuth.innerHTML = `
                <a href="login.html" class="btn btn-primary" style="width:100%;text-align:center;">Login</a>
                <a href="register.html" class="btn btn-secondary" style="width:100%;text-align:center;margin-top:0.5rem;">Register</a>
            `;
        }
    }

    // Run sync on auth state change
    const origUpdate = Auth.updateNavbar;
    Auth.updateNavbar = function() {
        origUpdate.call(Auth);
        syncMobileAuth();
    };
    syncMobileAuth();

    hamburger.addEventListener('click', toggleMobileNav);
}

function toggleMobileNav() {
    document.getElementById('mobile-nav-overlay').classList.toggle('active');
    document.getElementById('hamburger-btn').classList.toggle('active');
    document.body.classList.toggle('nav-open');
}

// Back to top button
function setupBackToTop() {
    let btn = document.getElementById('back-to-top');
    if (!btn) {
        btn = document.createElement('button');
        btn.id = 'back-to-top';
        btn.className = 'back-to-top';
        btn.innerHTML = '<i class="fas fa-arrow-up"></i>';
        btn.setAttribute('aria-label', 'Back to top');
        document.body.appendChild(btn);
        btn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    window.addEventListener('scroll', () => {
        btn.classList.toggle('visible', window.scrollY > 400);
    }, { passive: true });
}

// Skeleton loading helper
function createSkeleton(count, type) {
    const items = [];
    for (let i = 0; i < count; i++) {
        items.push(`<div class="skeleton skeleton-${type}"><div class="skeleton-shimmer"></div></div>`);
    }
    return items.join('');
}

// Mobile filter toggle for products page
function toggleFilters() {
    const sidebar = document.getElementById('filters-sidebar');
    const btn = document.getElementById('filter-toggle-btn');
    if (sidebar) {
        sidebar.classList.toggle('active');
        btn.innerHTML = sidebar.classList.contains('active')
            ? '<i class="fas fa-times"></i> Close Filters'
            : '<i class="fas fa-sliders-h"></i> Filters';
    }
}

// Utility to render star ratings based on a numeric value
function renderStars(rating) {
    let starsHtml = '';
    for (let i = 1; i <= 5; i++) {
        if (i <= Math.round(rating)) {
            starsHtml += '<i class="fas fa-star" style="color: #fcc419;"></i>';
        } else {
            starsHtml += '<i class="far fa-star" style="color: #dee2e6;"></i>';
        }
    }
    return starsHtml;
}

// Escape user-generated text before inserting into the DOM
function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
