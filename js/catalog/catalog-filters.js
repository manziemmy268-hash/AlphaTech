class CatalogFilters {
    constructor(container, state, api) {
        this.container = typeof container === 'string' ? document.getElementById(container) : container;
        this.state = state;
        this.api = api;
        this._init();
    }

    async _init() {
        this.state.on('change', (s) => {
            this._syncUI(s);
        });
        this._bindEvents();
        await this._loadFilterOptions();
    }

    _bindEvents() {
        const container = this.container;

        container.addEventListener('change', (e) => {
            const input = e.target;
            if (input.name === 'brand') {
                this.state.setFilter('brand', input.checked ? input.value : '');
            }
            if (input.name === 'category' && input.type === 'radio') {
                this.state.setFilter('category', input.value);
            }
            if (input.name === 'price-range' && input.type === 'radio') {
                const val = input.value;
                if (val === 'all') {
                    this.state.setState({ minPrice: '', maxPrice: '', page: 1 });
                } else if (val === '1000plus') {
                    this.state.setState({ minPrice: '1000', maxPrice: '', page: 1 });
                } else {
                    const parts = val.split('-');
                    if (parts.length === 2) {
                        this.state.setState({ minPrice: parts[0], maxPrice: parts[1], page: 1 });
                    }
                }
            }
        });

        container.addEventListener('click', (e) => {
            const clearBtn = e.target.closest('[data-clear-filters]');
            if (clearBtn) this._clearAll();
        });

        const toggleBtn = document.querySelector('[data-toggle-filters]');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this._toggleMobile();
            });
        }

        document.addEventListener('click', (e) => {
            if (this.container.classList.contains('filters-panel--open') &&
                !this.container.contains(e.target) &&
                !e.target.closest('[data-toggle-filters]')) {
                this.container.classList.remove('filters-panel--open');
            }
        });
    }

    _syncUI(s) {
        this.container.querySelectorAll('input[name="brand"]').forEach(cb => {
            cb.checked = cb.value === s.brand;
        });
        this.container.querySelectorAll('input[name="category"]').forEach(rb => {
            rb.checked = rb.value === s.category;
        });
        document.querySelectorAll('[data-sort-select]').forEach(el => {
            const sel = el.tagName === 'SELECT' ? el : el.querySelector('select');
            if (sel) sel.value = s.sort;
        });
    }

    async _loadFilterOptions() {
        try {
            const [brandsData, categoriesData] = await Promise.all([
                this.api.getBrands(),
                this.api.getCategories()
            ]);

            const brands = brandsData?.brands || brandsData || [];
            const categories = categoriesData?.categories || categoriesData || [];

            this._renderBrands(brands);
            this._renderCategories(categories);
        } catch (err) {
            console.error('Failed to load filter options:', err);
        }
    }

    _renderBrands(brands) {
        const list = this.container.querySelector('[data-brands-list]');
        if (!list) return;
        if (!brands || brands.length === 0) {
            list.innerHTML = '<p style="color:var(--secondary-color);font-size:0.85rem">No brands available.</p>';
            return;
        }
        list.innerHTML = brands.map(b => {
            const name = b.brand || b.name;
            const count = b.count || b.product_count || 0;
            return `
            <label class="filter-option" style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;padding:0.3rem 0">
                <input type="checkbox" name="brand" value="${name}" ${this.state.state.brand === name ? 'checked' : ''}>
                <span>${name}</span>
                <span class="filter-count" style="color:var(--secondary-color);font-size:0.75rem">(${count})</span>
            </label>`;
        }).join('');
    }

    _renderCategories(categories) {
        const list = this.container.querySelector('[data-categories-list]');
        if (!list) return;
        if (!categories || categories.length === 0) {
            list.innerHTML = '<p style="color:var(--secondary-color);font-size:0.85rem">No categories available.</p>';
            return;
        }
        list.innerHTML = `
            <label class="filter-option" style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;padding:0.3rem 0">
                <input type="radio" name="category" value="" ${!this.state.state.category ? 'checked' : ''}>
                <span>All Categories</span>
            </label>
        ` + categories.map(c => `
            <label class="filter-option" style="display:flex;align-items:center;gap:0.5rem;cursor:pointer;padding:0.3rem 0">
                <input type="radio" name="category" value="${c.name}" ${this.state.state.category === c.name ? 'checked' : ''}>
                <span>${c.name}</span>
                <span class="filter-count" style="color:var(--secondary-color);font-size:0.75rem">(${c.count || c.product_count || 0})</span>
            </label>
        `).join('');
    }

    _clearAll() {
        this.state.setState({ brand: '', category: '', minPrice: '', maxPrice: '', search: '', sort: 'newest', page: 1 });
        const searchInput = document.querySelector('[data-search-input]');
        if (searchInput) searchInput.value = '';
        this.container.querySelectorAll('input[type="radio"][name="price-range"]').forEach(rb => {
            if (rb.value === 'all') rb.checked = true;
        });
        window.history.replaceState({}, '', 'products.html');
    }

    _toggleMobile() {
        this.container.classList.toggle('filters-panel--open');
    }
}
