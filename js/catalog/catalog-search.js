class CatalogSearch {
    constructor(inputEl, state) {
        this.input = typeof inputEl === 'string' ? document.getElementById(inputEl) : inputEl;
        this.state = state;
        this._debounceTimer = null;
        this._init();
    }

    _init() {
        if (!this.input) return;
        this.input.addEventListener('input', (e) => {
            clearTimeout(this._debounceTimer);
            this._debounceTimer = setTimeout(() => {
                this.state.setFilter('search', e.target.value.trim());
                this._syncURL();
            }, 300);
        });
        this.input.addEventListener('search', (e) => {
            if (!e.target.value) this.state.setFilter('search', '');
        });
        this.state.on('change', (s) => {
            if (this.input.value !== s.search) this.input.value = s.search;
        });
    }

    _syncURL() {
        const q = this.state.toQuery();
        const url = q.toString() ? `products.html?${q}` : 'products.html';
        window.history.replaceState({}, '', url);
    }
}
