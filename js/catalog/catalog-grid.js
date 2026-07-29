class CatalogGrid {
    constructor(container, state, api) {
        this.container = typeof container === 'string' ? document.getElementById(container) : container;
        this.state = state;
        this.api = api;
        this._abort = null;
        this._loading = false;

        this.state.on('change', () => {
            if (!this._loading) this.load();
        });
    }

    async load(skipSkeleton) {
        if (this._loading || this._abort) this._abort?.abort();
        this._loading = true;
        this._abort = new AbortController();

        if (!skipSkeleton) this.container.innerHTML = CatalogUI.skeleton(6);

        try {
            const st = this.state.state;
            const params = {
                page: st.page,
                limit: st.pagination.limit,
                search: st.search || undefined,
                sort: st.sort || undefined,
                brand: st.brand || undefined,
                category: st.category || undefined,
                minPrice: st.minPrice || undefined,
                maxPrice: st.maxPrice || undefined,
            };

            const data = await this.api.getProducts(params);

            if (!data || !data.products) throw new Error('Invalid response');

            this.render(data.products, data.pagination, data.filters);
        } catch (err) {
            if (err.name === 'AbortError') return;
            console.error('CatalogGrid error:', err);
            this.container.innerHTML = CatalogUI.errorState(err.message);
        } finally {
            this._loading = false;
        }
    }

    render(products, pagination, filters) {
        const count = document.getElementById('product-count');
        if (count) count.textContent = pagination.total;

        if (!products || products.length === 0) {
            this.container.innerHTML = CatalogUI.emptyState('No products matched your filters.');
            this._updatePagination(pagination);
            return;
        }

        this.container.innerHTML = products.map(p => CatalogUI.card(p)).join('');
        this._updatePagination(pagination);
        this._updateFilterCounts(filters);
        if (typeof setupScrollAnimations === 'function') setupScrollAnimations();
    }

    _updatePagination(pagination) {
        const container = document.getElementById('pagination');
        if (!container) return;

        if (pagination.pages <= 1) {
            container.innerHTML = '';
            return;
        }

        const p = pagination.page;
        const total = pagination.pages;
        let html = '<div class="pagination" role="navigation" aria-label="Product pagination">';

        html += `<button class="pagination-btn" onclick="catalogState.setPage(${p - 1})" ${p <= 1 ? 'disabled' : ''} aria-label="Previous page"><i class="fas fa-chevron-left"></i></button>`;

        const range = 2;
        const start = Math.max(1, p - range);
        const end = Math.min(total, p + range);

        if (start > 1) {
            html += `<button class="pagination-btn" onclick="catalogState.setPage(1)" aria-label="Page 1">1</button>`;
            if (start > 2) html += '<span class="pagination-ellipsis">...</span>';
        }

        for (let i = start; i <= end; i++) {
            html += `<button class="pagination-btn${i === p ? ' active' : ''}" onclick="catalogState.setPage(${i})" aria-label="Page ${i}" ${i === p ? 'aria-current="page"' : ''}>${i}</button>`;
        }

        if (end < total) {
            if (end < total - 1) html += '<span class="pagination-ellipsis">...</span>';
            html += `<button class="pagination-btn" onclick="catalogState.setPage(${total})" aria-label="Page ${total}">${total}</button>`;
        }

        html += `<button class="pagination-btn" onclick="catalogState.setPage(${p + 1})" ${p >= total ? 'disabled' : ''} aria-label="Next page"><i class="fas fa-chevron-right"></i></button>`;
        html += '</div>';
        container.innerHTML = html;
    }

    _updateFilterCounts(filters) {
        if (!filters) return;
        document.querySelectorAll('input[name="brand"]').forEach(cb => {
            const brand = filters.brands?.find(b => b.brand === cb.value);
            const label = cb.closest('label');
            if (label && brand) {
                const existing = label.querySelector('.filter-count');
                if (existing) existing.textContent = `(${brand.count})`;
                else label.insertAdjacentHTML('beforeend', ` <span class="filter-count" style="color:var(--secondary-color);font-size:0.75rem">(${brand.count})</span>`);
            }
        });
    }
}
