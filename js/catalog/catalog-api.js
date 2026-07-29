const CatalogAPI = {
    BASE: window.APP_API_URL ? window.APP_API_URL + '/api' : '/api',
    _pending: new Map(),

    async fetch(endpoint, options = {}) {
        const url = `${this.BASE}${endpoint}`;
        const cacheKey = url + JSON.stringify(options.body || '');

        if (options.cache !== false && !options.retry) {
            const cached = CatalogCache.get(cacheKey);
            if (cached) return cached;
        }

        if (this._pending.has(cacheKey)) return this._pending.get(cacheKey);

        const promise = this._request(url, options, 0);
        this._pending.set(cacheKey, promise);
        const result = await promise;
        this._pending.delete(cacheKey);

        if (options.cache !== false && result) {
            CatalogCache.set(cacheKey, result, options.ttl || 300000);
        }
        return result;
    },

    async _request(url, options, attempt) {
        const maxRetries = options.retry !== undefined ? options.retry : 2;
        try {
            const res = await fetch(url, {
                method: options.method || 'GET',
                headers: { 'Content-Type': 'application/json', ...options.headers },
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: options.signal,
            });
            if (!res.ok) {
                const text = await res.text();
                let msg;
                try { msg = JSON.parse(text).message || text; } catch { msg = text; }
                throw new Error(msg || `HTTP ${res.status}`);
            }
            return await res.json();
        } catch (err) {
            if (err.name === 'AbortError') throw err;
            if (attempt < maxRetries) {
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                return this._request(url, options, attempt + 1);
            }
            throw err;
        }
    },

    getProducts(params = {}) {
        const q = new URLSearchParams();
        Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
        return this.fetch(`/products?${q}`, { ttl: 60000 });
    },

    getProduct(id) { return this.fetch(`/products/${id}`, { ttl: 120000 }); },
    getFeatured(limit = 8) { return this.fetch(`/products/featured?limit=${limit}`, { ttl: 300000 }); },
    getTrending(limit = 8) { return this.fetch(`/products/trending?limit=${limit}`, { ttl: 300000 }); },
    getRelated(id, limit = 4) { return this.fetch(`/products/related/${id}?limit=${limit}`, { ttl: 120000 }); },
    getCategories() { return this.fetch('/categories', { ttl: 300000 }); },
    getBrands() { return this.fetch('/brands', { ttl: 300000 }); },

    invalidateProducts() {
        CatalogCache.clear();
    }
};
