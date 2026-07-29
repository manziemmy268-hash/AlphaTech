const CatalogRecent = {
    KEY: 'catalog_recent',
    MAX: 20,

    get() {
        try {
            return JSON.parse(localStorage.getItem(this.KEY)) || [];
        } catch { return []; }
    },

    add(product) {
        let list = this.get().filter(p => p.id !== product.id);
        list.unshift({ id: product.id, name: product.name, price: product.price, image: product.image, badge: product.badge });
        if (list.length > this.MAX) list = list.slice(0, this.MAX);
        localStorage.setItem(this.KEY, JSON.stringify(list));
    },

    render(container) {
        const el = typeof container === 'string' ? document.getElementById(container) : container;
        if (!el) return;
        const items = this.get();
        if (items.length === 0) { el.remove(); return; }
        el.innerHTML = `
            <div class="section">
                <h2 class="section-title">Recently Viewed</h2>
                <div class="products-grid">
                    ${items.map(p => CatalogUI.card(p, { lazy: true })).join('')}
                </div>
            </div>`;
    },

    clear() {
        localStorage.removeItem(this.KEY);
    }
};
