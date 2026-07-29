const CatalogCache = {
    _memory: new Map(),
    _storage: window.sessionStorage,
    _prefix: 'cat_',

    get(key) {
        if (this._memory.has(key)) return this._memory.get(key);
        try {
            const raw = this._storage.getItem(this._prefix + key);
            if (!raw) return null;
            const item = JSON.parse(raw);
            if (item.expiry && Date.now() > item.expiry) {
                this._storage.removeItem(this._prefix + key);
                return null;
            }
            this._memory.set(key, item.data);
            return item.data;
        } catch { return null; }
    },

    set(key, data, ttlMs = 300000) {
        this._memory.set(key, data);
        try {
            this._storage.setItem(this._prefix + key, JSON.stringify({
                data,
                expiry: ttlMs ? Date.now() + ttlMs : null
            }));
        } catch { /* storage full */ }
    },

    invalidate(key) {
        this._memory.delete(key);
        this._storage.removeItem(this._prefix + key);
    },

    clear() {
        this._memory.clear();
        Object.keys(sessionStorage).filter(k => k.startsWith(this._prefix))
            .forEach(k => sessionStorage.removeItem(k));
    }
};
