class CatalogState {
    constructor() {
        this._listeners = new Map();
        this._state = {
            products: [],
            pagination: { page: 1, limit: 12, total: 0, pages: 0 },
            filters: { brands: [], categories: [] },
            loading: true,
            error: null,
            page: 1,
            search: '',
            sort: 'newest',
            brand: '',
            category: '',
            minPrice: '',
            maxPrice: '',
            featured: ''
        };
    }

    get state() { return { ...this._state }; }

    setState(updates) {
        Object.assign(this._state, updates);
        this._syncPriceRadio();
        this._notify();
    }

    setFilter(key, value) {
        this._state[key] = value;
        this._state.page = 1;
        this._syncPriceRadio();
        this._notify();
    }

    setPage(page) {
        this._state.page = Math.max(1, Math.min(page, this._state.pagination.pages || 1));
        this._syncPriceRadio();
        this._notify();
    }

    on(event, fn) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(fn);
        return () => this._listeners.get(event)?.delete(fn);
    }

    _notify() {
        const s = this.state;
        this._listeners.get('change')?.forEach(fn => fn(s));
    }

    toQuery() {
        const p = new URLSearchParams();
        if (this._state.search) p.set('search', this._state.search);
        if (this._state.sort && this._state.sort !== 'newest') p.set('sort', this._state.sort);
        if (this._state.brand) p.set('brand', this._state.brand);
        if (this._state.category) p.set('category', this._state.category);
        if (this._state.minPrice) p.set('minPrice', this._state.minPrice);
        if (this._state.maxPrice) p.set('maxPrice', this._state.maxPrice);
        if (this._state.page > 1) p.set('page', this._state.page);
        return p;
    }

    fromQuery(search) {
        const p = new URLSearchParams(search);
        const updates = {};
        ['search', 'sort', 'brand', 'category', 'minPrice', 'maxPrice'].forEach(k => {
            const v = p.get(k);
            if (v) updates[k] = v;
        });
        const page = parseInt(p.get('page'), 10);
        if (page > 1) updates.page = page;
        if (Object.keys(updates).length) this.setState(updates);
    }

    _syncPriceRadio() {
        const radios = document.querySelectorAll('input[type="radio"][name="price-range"]');
        if (!radios.length) return;
        const min = this._state.minPrice;
        const max = this._state.maxPrice;
        let val = 'all';
        if (min === '1000' && !max) val = '1000plus';
        else if (min && max) val = `${min}-${max}`;
        radios.forEach(rb => { rb.checked = rb.value === val; });
    }
}
