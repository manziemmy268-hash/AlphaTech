const CatalogUI = {
    stars(rating) {
        const r = Math.round(rating || 0);
        return '<span class="stars" aria-label="' + r + ' out of 5 stars">' +
            [1,2,3,4,5].map(i =>
                `<i class="${i <= r ? 'fas' : 'far'} fa-star" style="color:${i <= r ? '#f59e0b' : '#d1d5db'}"></i>`
            ).join('') +
            '</span>';
    },

    badge(badge) {
        if (!badge) return '';
        const colors = { new: '#34c759', sale: '#ff3b30', featured: '#0071e3' };
        return `<span class="product-badge" style="background:${colors[badge] || '#0071e3'};color:#fff;font-size:0.7rem;font-weight:700;padding:0.2rem 0.6rem;border-radius:6px;text-transform:uppercase;letter-spacing:0.5px">${badge}</span>`;
    },

    card(product, opts = {}) {
        const imgSrc = getProductImageSrc(product.image);
        return `
            <div class="product-card reveal" role="article" aria-label="${product.name}">
                <div style="position:relative">
                    <a href="product.html?id=${product.id}" aria-label="View ${product.name}">
                        <img src="${imgSrc}" alt="${product.name}" class="product-image"
                            loading="${opts.lazy !== false ? 'lazy' : 'eager'}"
                            width="400" height="300"
                            onerror="handleProductImageError(this)">
                    </a>
                    ${this.badge(product.badge)}
                    ${product.stock <= 0 ? '<span style="position:absolute;top:0.5rem;right:0.5rem;background:rgba(0,0,0,0.6);color:#fff;font-size:0.7rem;padding:0.2rem 0.5rem;border-radius:4px">Out of Stock</span>' : ''}
                    ${product.featured ? '<span style="position:absolute;top:0.5rem;left:0.5rem;background:#0071e3;color:#fff;font-size:0.65rem;padding:0.2rem 0.5rem;border-radius:4px;font-weight:600">Featured</span>' : ''}
                </div>
                <div style="padding:0 1rem 1rem">
                    <span class="product-brand">${product.brand || ''}</span>
                    <h3 class="product-name" style="margin:0.2rem 0">
                        <a href="product.html?id=${product.id}" style="color:inherit;text-decoration:none">${product.name}</a>
                    </h3>
                    <div style="font-size:0.8rem;margin-bottom:0.5rem">
                        ${this.stars(product.average_rating)}
                        <span style="color:var(--secondary-color)">(${product.review_count || 0})</span>
                    </div>
                    <p class="product-price">$${Number(product.price).toFixed(2)}</p>
                    <div style="display:flex;gap:0.5rem;padding-bottom:0.5rem">
                        <a href="product.html?id=${product.id}" class="btn" style="border:1px solid var(--primary-color);color:var(--primary-color);flex:1;text-decoration:none;text-align:center">Details</a>
                        <button class="btn btn-primary" style="flex:1" onclick="handleAddToCart(${product.id})" ${product.stock === 0 ? 'disabled' : ''} aria-label="Add ${product.name} to cart">
                            ${product.stock === 0 ? '<i class="fas fa-times"></i>' : '<i class="fas fa-cart-plus"></i>'}
                        </button>
                    </div>
                </div>
            </div>`;
    },

    skeleton(count = 6) {
        const card = `
            <div class="product-card" aria-hidden="true">
                <div class="skeleton-img" style="width:100%;height:220px;background:var(--skeleton-color);border-radius:16px;margin-bottom:1rem;animation:pulse 1.5s infinite"></div>
                <div style="padding:0 1rem 1rem">
                    <div class="skeleton-text" style="height:14px;width:60%;background:var(--skeleton-color);border-radius:8px;margin-bottom:0.5rem;animation:pulse 1.5s infinite"></div>
                    <div class="skeleton-text" style="height:18px;width:85%;background:var(--skeleton-color);border-radius:8px;margin-bottom:0.5rem;animation:pulse 1.5s infinite"></div>
                    <div class="skeleton-text" style="height:12px;width:40%;background:var(--skeleton-color);border-radius:8px;margin-bottom:0.5rem;animation:pulse 1.5s infinite"></div>
                    <div class="skeleton-text" style="height:22px;width:30%;background:var(--skeleton-color);border-radius:8px;margin-bottom:0.5rem;animation:pulse 1.5s infinite"></div>
                    <div style="display:flex;gap:0.5rem">
                        <div class="skeleton-text" style="height:36px;flex:1;background:var(--skeleton-color);border-radius:8px;animation:pulse 1.5s infinite"></div>
                        <div class="skeleton-text" style="height:36px;flex:1;background:var(--skeleton-color);border-radius:8px;animation:pulse 1.5s infinite"></div>
                    </div>
                </div>
            </div>`;
        return Array(count).fill(card).join('');
    },

    emptyState(message = 'No products found.', action = null) {
        return `
            <div class="empty-state" style="grid-column:1/-1;text-align:center;padding:4rem 2rem">
                <i class="fas fa-box-open" style="font-size:3rem;color:var(--secondary-color);margin-bottom:1rem;display:block"></i>
                <h3>${message}</h3>
                <p style="color:var(--secondary-color)">Try adjusting your search or filters.</p>
                ${action || ''}
            </div>`;
    },

    errorState(message = 'Failed to load products.') {
        return `
            <div class="empty-state" style="grid-column:1/-1;text-align:center;padding:4rem 2rem">
                <i class="fas fa-exclamation-triangle" style="font-size:3rem;color:#ff3b30;margin-bottom:1rem;display:block"></i>
                <h3>${message}</h3>
                <p style="color:var(--secondary-color)">Please check your connection and try again.</p>
                <button class="btn btn-primary catalog-retry-btn" style="margin-top:1rem">Retry</button>
            </div>`;
    }
};
