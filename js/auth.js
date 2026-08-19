/**
 * AlphaTech Authentication Logic
 * Uses backend API and stores JWT in localStorage for persistence.
 */

const Auth = {
    // API Base URL — evaluated lazily so config.js can load first
    get API_URL() {
        return window.APP_API_URL ? window.APP_API_URL + '/api' : '/api';
    },

    // Store token and user
    saveSession: function(token, user) {
        localStorage.setItem('alphatech_jwt_token', token);
        localStorage.setItem('alphatech_currentUser', JSON.stringify(user));
    },

    // Get currently logged in user
    getCurrentUser: function() {
        return JSON.parse(localStorage.getItem('alphatech_currentUser')) || null;
    },

    // Get Auth Token
    getToken: function() {
        return localStorage.getItem('alphatech_jwt_token');
    },

    // Register a new user via API
    register: async function(username, email, phone, password) {
        try {
            const res = await fetch(`${this.API_URL}/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, email, phone, password })
            });
            const data = await res.json();
            return data; // { success: true/false, message: '...' }
        } catch (error) {
            console.error('Registration failed:', error);
            return { success: false, message: 'Network error. Make sure backend is running.' };
        }
    },

    // Login user via API
    login: async function(email, password) {
        try {
            const res = await fetch(`${this.API_URL}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            
            if (data.success) {
                this.saveSession(data.token, data.user);
            }
            return data;
        } catch (error) {
            console.error('Login failed:', error);
            return { success: false, message: 'Network error. Make sure backend is running.' };
        }
    },

    // Logout user
    logout: function() {
        localStorage.removeItem('alphatech_currentUser');
        localStorage.removeItem('alphatech_jwt_token');
        window.location.href = 'index.html';
    },

    // Clear session without redirecting (used on auth failures)
    clearSession: function() {
        localStorage.removeItem('alphatech_currentUser');
        localStorage.removeItem('alphatech_jwt_token');
    },

    // Handle an expired/invalid token response: clear session and send to login
    handleAuthFailure: function(message) {
        const hadSession = this.isLoggedIn();
        this.clearSession();
        if (hadSession) {
            showToast && showToast(message || 'Session expired. Please log in again.');
            setTimeout(() => { window.location.href = 'login.html'; }, 1500);
        }
    },

    // Check if user is logged in
    isLoggedIn: function() {
        return this.getToken() !== null && this.getCurrentUser() !== null;
    },

    // Get unique cart storage key for current user
    getCartKey: function() {
        const user = this.getCurrentUser();
        return user ? `alphatech_cart_${user.id}` : 'alphatech_cart_guest';
    },

    // Global protection: only require authentication for account-sensitive pages
    requireAuth: function() {
        const path = window.location.pathname;
        const page = path.split("/").pop();
        const publicPages = ['index.html', 'home.html', 'products.html', 'product.html', 'login.html', 'register.html', 'forgot-password.html', 'reset-password.html'];

        if (publicPages.includes(page)) {
            return;
        }

        if (!this.isLoggedIn()) {
            window.location.href = 'login.html';
        }
    },

    // Admin protection: strictly block non-admin users
    requireAdmin: function() {
        this.requireAuth(); 
        const user = this.getCurrentUser();
        if (user && user.role !== 'admin') {
            window.location.href = 'index.html';
        }
    },

    // Update navbar dynamically
    updateNavbar: function() {
        const user = this.getCurrentUser();
        const navLinks = document.querySelector('.nav-links');
        if (!navLinks) return;

        // Manage visibility of hardcoded Admin link
        const adminLink = Array.from(navLinks.querySelectorAll('a')).find(a => a.getAttribute('href') === 'admin.html' || a.getAttribute('href') === '/admin.html');
        if (adminLink) {
            const adminParent = adminLink.parentElement;
            if (user && user.role === 'admin') {
                adminParent.style.display = 'block';
            } else {
                adminParent.style.display = 'none';
            }
        }

        let authLi = document.getElementById('nav-auth-links');
        if (!authLi) {
            authLi = document.createElement('li');
            authLi.id = 'nav-auth-links';
            navLinks.appendChild(authLi);
        }

        if (user) {
            const dashboardLink = user.role === 'admin' 
                ? '<a href="admin.html"><i class="fas fa-cog"></i> Dashboard</a>' 
                : '';
                
            authLi.innerHTML = `
                <div class="user-profile-dropdown" id="user-dropdown">
                    <a href="#" class="user-profile-toggle" id="user-dropdown-toggle">
                        <i class="fas fa-user-circle"></i> Hi, ${user.username} <i class="fas fa-chevron-down" style="font-size: 0.7rem;"></i>
                    </a>
                    <div class="dropdown-content">
                        ${dashboardLink}
                        <a href="orders.html"><i class="fas fa-box"></i> My Orders</a>
                        <a href="settings.html"><i class="fas fa-user-cog"></i> Settings</a>
                        <a href="#" onclick="Auth.logout()"><i class="fas fa-sign-out-alt"></i> Logout</a>
                    </div>
                </div>
            `;

            const toggle = document.getElementById('user-dropdown-toggle');
            const dropdown = document.getElementById('user-dropdown');
            if (toggle && dropdown) {
                toggle.addEventListener('click', (e) => {
                    e.preventDefault();
                    const content = dropdown.querySelector('.dropdown-content');
                    const isOpen = content.style.display === 'block';
                    document.querySelectorAll('.dropdown-content').forEach(c => c.style.display = '');
                    content.style.display = isOpen ? '' : 'block';
                });
                document.addEventListener('click', (e) => {
                    if (!dropdown.contains(e.target)) {
                        dropdown.querySelector('.dropdown-content').style.display = '';
                    }
                });
            }
        } else {
            authLi.innerHTML = `
                <a href="login.html" class="nav-auth-btn">Login</a>
                <a href="register.html" class="btn btn-primary btn-sm" style="margin-left: 1rem; padding: 0.4rem 1rem;">Register</a>
            `;
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    Auth.updateNavbar();
});

const style = document.createElement('style');
style.textContent = `
    .user-profile-dropdown { position: relative; display: inline-block; }
    .user-profile-toggle { display: flex; align-items: center; gap: 0.5rem; cursor: pointer; font-weight: 500; font-size: 0.9rem; }
    .dropdown-content { display: none; position: absolute; right: 0; background-color: var(--card-bg); min-width: 160px; box-shadow: var(--shadow); border-radius: 12px; z-index: 1001; border: 1px solid rgba(0, 0, 0, 0.05); overflow: hidden; margin-top: 0.5rem; }
    .user-profile-dropdown::after { content: ''; position: absolute; top: 100%; left: 0; width: 100%; height: 1rem; display: none; }
    .user-profile-dropdown:hover::after { display: block; }
    .dropdown-content a { color: var(--text-color); padding: 0.8rem 1rem; text-decoration: none; display: flex; align-items: center; gap: 0.8rem; font-size: 0.9rem; transition: var(--transition); }
    .dropdown-content a:hover { background-color: rgba(0, 113, 227, 0.05); color: var(--primary-color); }
    .user-profile-dropdown:hover .dropdown-content { display: block; }
    .nav-auth-btn { font-size: 0.9rem; font-weight: 500; color: var(--text-color); opacity: 0.8; }
    .nav-auth-btn:hover { opacity: 1; color: var(--primary-color); }
`;
document.head.appendChild(style);
