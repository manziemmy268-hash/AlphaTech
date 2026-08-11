class CatalogDetail {
    constructor(container, api) {
        this.container = typeof container === 'string' ? document.getElementById(container) : container;
        this.api = api;
        this.product = null;
        this._abort = null;
    }

    async load(productId) {
        if (this._abort) this._abort.abort();
        this._abort = new AbortController();
        this._showLoading();
        try {
            const data = await this.api.getProduct(productId);
            this.product = data?.product || data;
            this._render();
            CatalogRecent.add(this.product);
            return this.product;
        } catch (err) {
            if (err.name === 'AbortError') return;
            this._showError(err.message);
            throw err;
        }
    }

    _showLoading() {
        this.container.innerHTML = `
            <div class="product-detail-loading" style="display:grid;grid-template-columns:1fr 1fr;gap:3rem;padding:2rem 0">
                <div class="skeleton-img" style="width:100%;height:400px;background:var(--skeleton-color);border-radius:16px;animation:pulse 1.5s infinite"></div>
                <div>
                    <div class="skeleton-text" style="height:14px;width:30%;background:var(--skeleton-color);border-radius:8px;margin-bottom:1rem;animation:pulse 1.5s infinite"></div>
                    <div class="skeleton-text" style="height:28px;width:80%;background:var(--skeleton-color);border-radius:8px;margin-bottom:1rem;animation:pulse 1.5s infinite"></div>
                    <div class="skeleton-text" style="height:18px;width:50%;background:var(--skeleton-color);border-radius:8px;margin-bottom:1rem;animation:pulse 1.5s infinite"></div>
                    <div class="skeleton-text" style="height:40px;width:40%;background:var(--skeleton-color);border-radius:8px;margin-bottom:1rem;animation:pulse 1.5s infinite"></div>
                    <div class="skeleton-text" style="height:100px;width:100%;background:var(--skeleton-color);border-radius:8px;animation:pulse 1.5s infinite"></div>
                </div>
            </div>`;
    }

    _showError(msg) {
        this.container.innerHTML = `
            <div style="text-align:center;padding:4rem 2rem">
                <i class="fas fa-exclamation-triangle" style="font-size:3rem;color:#ff3b30;margin-bottom:1rem;display:block"></i>
                <h3>${msg || 'Failed to load product.'}</h3>
                <a href="products.html" class="btn btn-primary" style="margin-top:1rem;display:inline-block">Browse Products</a>
            </div>`;
    }

    _render() {
        const p = this.product;
        const imgSrc = getProductImageSrc(p.image);

        const gallery = (p.gallery || []).length > 0 ? p.gallery : [{ url: p.image }];

        const variants = (p.variants || []).map(v =>
            `<span class="variant-chip" style="display:inline-block;padding:0.3rem 0.8rem;border:1px solid var(--secondary-color);border-radius:6px;margin:0.2rem;font-size:0.85rem" title="${v.value}">${v.name}: ${v.value}${v.stock !== undefined ? ` (${v.stock})` : ''}</span>`
        ).join('');

        const relatedHtml = `
            <div id="related-products" class="section">
                <h2 class="section-title">Related Products</h2>
                <div id="related-grid" class="products-grid">${CatalogUI.skeleton(4)}</div>
            </div>`;

        this.container.innerHTML = `
            <div class="product-detail" style="display:grid;grid-template-columns:1fr 1fr;gap:3rem;padding:2rem 0" itemscope itemtype="https://schema.org/Product">
                <div class="product-gallery" style="position:relative">
                    <div class="gallery-main" style="position:relative;border-radius:16px;overflow:hidden;background:var(--skeleton-color);margin-bottom:1rem">
                        <img id="main-image" src="${imgSrc}" alt="${p.name}" class="gallery-main-img" style="width:100%;height:auto;display:block;transition:opacity 0.3s" itemprop="image" onerror="handleProductImageError(this)">
                        ${p.badge ? `<span style="position:absolute;top:1rem;left:1rem;background:#34c759;color:#fff;font-size:0.75rem;font-weight:700;padding:0.3rem 0.8rem;border-radius:8px;text-transform:uppercase">${p.badge}</span>` : ''}
                    </div>
                    <div class="gallery-thumbs" style="display:flex;gap:0.5rem;overflow-x:auto;padding-bottom:0.5rem">
                        ${gallery.map((g, i) => `
                            <img src="${getProductImageSrc(g.url)}" alt="${p.name} ${i + 1}"
                                class="gallery-thumb${i === 0 ? ' active' : ''}"
                                style="width:72px;height:72px;object-fit:cover;border-radius:8px;cursor:pointer;border:2px solid ${i === 0 ? 'var(--primary-color)' : 'transparent'};flex-shrink:0"
                                onclick="switchGalleryImage(this, '${getProductImageSrc(g.url).replace(/'/g, "\\'")}')"
                                loading="lazy">
                        `).join('')}
                    </div>
                </div>
                <div class="product-info">
                    <span class="product-brand" style="font-size:0.85rem;color:var(--secondary-color);text-transform:uppercase;letter-spacing:1px">${p.brand || 'General'}</span>
                    <h1 class="product-name" style="font-size:1.8rem;margin:0.5rem 0" itemprop="name">${p.name}</h1>
                    ${p.sku ? `<span style="font-size:0.8rem;color:var(--secondary-color)">SKU: ${p.sku}</span>` : ''}
                    <div style="margin:0.5rem 0">
                        ${CatalogUI.stars(p.average_rating)}
                        <span style="color:var(--secondary-color);font-size:0.9rem">(${p.review_count || 0} reviews)</span>
                    </div>
                    <p class="product-price" style="font-size:2rem;margin:0.5rem 0" itemprop="price" content="${p.price}">
                        $${Number(p.price).toFixed(2)}
                    </p>
                    <p style="font-size:0.9rem;color:${p.stock > 0 ? '#34c759' : '#ff3b30'};font-weight:600">
                        ${p.stock > 0 ? `In Stock (${p.stock} available)` : 'Out of Stock'}
                    </p>
                    <p class="product-description" style="line-height:1.6;color:var(--text-color);margin:1rem 0" itemprop="description">${p.description || 'No description available.'}</p>
                    ${p.featured ? '<p style="background:#f0f7ff;padding:0.5rem 1rem;border-radius:8px;font-size:0.85rem"><i class="fas fa-star" style="color:#0071e3"></i> Featured Product</p>' : ''}
                    ${variants ? `<div style="margin:1rem 0"><strong style="display:block;margin-bottom:0.5rem">Variants:</strong><div>${variants}</div></div>` : ''}
                    <div style="display:flex;gap:1rem;margin-top:2rem">
                        <div class="qty-controls" style="display:flex;align-items:center;border:1px solid var(--border-color);border-radius:8px;overflow:hidden">
                            <button class="btn qty-btn" onclick="adjustQty(-1)" aria-label="Decrease quantity" style="border:none;padding:0.6rem 1rem;background:transparent;cursor:pointer"><i class="fas fa-minus"></i></button>
                            <span id="qty-display" style="padding:0.6rem 1rem;font-weight:600;min-width:40px;text-align:center">1</span>
                            <button class="btn qty-btn" onclick="adjustQty(1)" aria-label="Increase quantity" style="border:none;padding:0.6rem 1rem;background:transparent;cursor:pointer"><i class="fas fa-plus"></i></button>
                        </div>
                        <button id="add-to-cart-btn" class="btn btn-primary" style="flex:1;padding:0.8rem 2rem" onclick="detailHandleAddToCart(${p.id})" ${p.stock === 0 ? 'disabled' : ''} aria-label="Add ${p.name} to cart">
                            <i class="fas fa-cart-plus"></i> Add to Cart
                        </button>
                    </div>
                    <div style="margin-top:1rem;padding:1rem;background:var(--bg-secondary);border-radius:12px">
                        <p style="margin:0;font-size:0.85rem;color:var(--secondary-color)">
                            <i class="fas fa-truck"></i> Free shipping on orders over $50
                        </p>
                        <p style="margin:0.3rem 0 0;font-size:0.85rem;color:var(--secondary-color)">
                            <i class="fas fa-undo"></i> 30-day easy returns
                        </p>
                    </div>
                </div>
            </div>
            ${relatedHtml}`;

        this._loadRelated(p.id);
    }

    async _loadRelated(productId) {
        try {
            const data = await this.api.getRelated(productId);
            const products = data?.products || data || [];
            const grid = document.getElementById('related-grid');
            if (grid) {
                if (products.length === 0) {
                    grid.innerHTML = '<p style="grid-column:1/-1;text-align:center;color:var(--secondary-color)">No related products found.</p>';
                } else {
                    grid.innerHTML = products.map(p => CatalogUI.card(p, { lazy: true })).join('');
                }
            }
        } catch (err) {
            console.error('Failed to load related products:', err);
            const grid = document.getElementById('related-grid');
            if (grid) grid.innerHTML = '';
        }
    }
}
