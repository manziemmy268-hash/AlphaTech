// Shared App Logic
document.addEventListener('DOMContentLoaded', async () => {
    updateCartCount();
    setupSearch();
    setupScrollAnimations();
    setupPasswordToggle();
    setupMobileNav();
    setupBackToTop();
    setupNavbarScrollBehavior();
    setupAnimatedCounters();
    setupTypingEffect();
    setupHeroParallax();
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
    const fallback = 'assets/images/google_phone.jpg';
    return image && image.trim() ? image.trim() : fallback;
}

function handleProductImageError(img) {
    img.onerror = null;
    img.src = 'assets/images/google_phone.jpg';
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
// Updates: icon, button class, and toast
function addToWishlist(productId) {
    const wishlist = JSON.parse(localStorage.getItem('alphatech_wishlist') || '[]');
    const id = String(productId);
    const index = wishlist.indexOf(id);

    // Find the wishlist button for this product
    const btn = document.querySelector(`.wishlist-btn[data-product-id="${id}"]`);
    const icon = btn ? btn.querySelector('i') : document.getElementById(`wishlist-icon-${productId}`);

    if (index > -1) {
        wishlist.splice(index, 1);
        if (btn) btn.classList.remove('wishlisted');
        if (icon) { icon.className = 'far fa-heart'; }
        showToast('Removed from wishlist');
    } else {
        wishlist.push(id);
        if (btn) btn.classList.add('wishlisted');
        if (icon) { icon.className = 'fas fa-heart'; }
        showToast('&#x2764;&#xFE0F; Added to wishlist!');
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
        // Remove auth links from clone — they are handled by syncMobileAuth below
        const cloneAuthLi = clone.querySelector('#nav-auth-links');
        if (cloneAuthLi) cloneAuthLi.remove();

        // Add search bar at top of mobile panel
        const mobileSearch = document.createElement('div');
        mobileSearch.className = 'mobile-search-bar';
        mobileSearch.innerHTML = `
            <div style="position:relative;margin-bottom:1rem;">
                <i class="fas fa-search" style="position:absolute;left:1rem;top:50%;transform:translateY(-50%);color:var(--secondary-color);pointer-events:none;"></i>
                <input type="text" id="mobile-search-input" placeholder="Search devices..." style="width:100%;padding:0.75rem 1rem 0.75rem 2.8rem;border-radius:12px;border:1px solid var(--border-color);background:var(--bg-color);color:var(--text-color);font-size:1rem;font-family:inherit;">
            </div>
        `;
        mobilePanel.appendChild(mobileSearch);

        // Wire mobile search: navigate to products page with query
        const mobileSearchInput = mobileSearch.querySelector('#mobile-search-input');
        mobileSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && mobileSearchInput.value.trim()) {
                window.location.href = `products.html?search=${encodeURIComponent(mobileSearchInput.value.trim())}`;
            }
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

// ── Add to cart with spinner + success animation ──────────────────────────
async function handleAddToCartBtn(productId, btn) {
    const originalHTML = btn.innerHTML;
    btn.classList.add('loading');
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    try {
        await addToCart(productId, 1);
        btn.classList.remove('loading');
        btn.classList.add('success');
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(() => {
            btn.innerHTML = originalHTML;
            btn.classList.remove('success');
        }, 1600);
    } catch {
        btn.innerHTML = originalHTML;
        btn.classList.remove('loading');
    }
}

// ── Navbar scroll shrink ──────────────────────────────────────────────────
function setupNavbarScrollBehavior() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;
    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 12);
    }, { passive: true });
}

// ── Animated stat counters ───────────────────────────────────────────────
function setupAnimatedCounters() {
    const counters = document.querySelectorAll('.stat-number[data-target]');
    if (!counters.length) return;

    const easeOut = (t) => 1 - Math.pow(1 - t, 3);

    function animateCounter(el) {
        const target = parseInt(el.dataset.target, 10);
        const suffix = el.dataset.suffix || '';
        const duration = 1400;
        const start = performance.now();

        function step(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const value = Math.round(easeOut(progress) * target);
            el.textContent = value.toLocaleString() + suffix;
            if (progress < 1) requestAnimationFrame(step);
        }
        requestAnimationFrame(step);
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                observer.unobserve(entry.target);
            }
        });
    }, { threshold: 0.4 });

    counters.forEach(el => observer.observe(el));
}

// ── Hero cycling typing effect ────────────────────────────────────────────
function setupTypingEffect() {
    const el = document.getElementById('cycling-text');
    if (!el) return;

    const phrases = [
        '\uD83D\uDE80 New arrivals added every week',
        '\u2713 All devices verified & in-stock',
        '\uD83D\uDD12 Secure checkout guaranteed',
        '\uD83D\uDCE6 Fast delivery nationwide',
        '\u2605 Rated 4.9 / 5 by our customers',
    ];
    let phraseIdx = 0;
    let charIdx = 0;
    let deleting = false;
    const TYPE_SPEED = 48;
    const DELETE_SPEED = 22;
    const PAUSE_MS = 2600;

    function tick() {
        const phrase = phrases[phraseIdx];
        if (!deleting) {
            charIdx++;
            el.textContent = phrase.slice(0, charIdx);
            if (charIdx === phrase.length) {
                deleting = true;
                setTimeout(tick, PAUSE_MS);
                return;
            }
        } else {
            charIdx--;
            el.textContent = phrase.slice(0, charIdx);
            if (charIdx === 0) {
                deleting = false;
                phraseIdx = (phraseIdx + 1) % phrases.length;
            }
        }
        setTimeout(tick, deleting ? DELETE_SPEED : TYPE_SPEED);
    }

    // Start after short delay so entrance animation finishes first
    setTimeout(tick, 900);
}

// ── Hero parallax (desktop only) ──────────────────────────────────────────
function setupHeroParallax() {
    if (window.matchMedia('(max-width: 768px)').matches) return;
    const hero = document.querySelector('.hero');
    if (!hero) return;
    window.addEventListener('scroll', () => {
        const scrolled = window.scrollY;
        if (scrolled < 800) {
            hero.style.backgroundPositionY = (scrolled * 0.35) + 'px';
        }
    }, { passive: true });
}
