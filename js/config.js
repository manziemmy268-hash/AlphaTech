const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const defaultApiUrl = isLocal ? 'http://localhost:3001' : 'https://alphatech-hu3y.onrender.com';
window.APP_API_URL = window.APP_API_URL || defaultApiUrl;
