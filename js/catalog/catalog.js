(function () {
    'use strict';

    let currentQty = 1;

    window.handleAddToCart = function (id, qty) {
        if (typeof addToCart === 'function') addToCart(id, qty);
    };

    window.adjustQty = function (delta) {
        const display = document.getElementById('qty-display');
        if (!display) return;
        currentQty = Math.max(1, currentQty + delta);
        display.textContent = currentQty;
    };

    window.detailHandleAddToCart = function (productId) {
        handleAddToCart(productId, currentQty);
    };

    window.switchGalleryImage = function (thumb, src) {
        document.querySelectorAll('.gallery-thumb').forEach(t => t.style.borderColor = 'transparent');
        thumb.style.borderColor = 'var(--primary-color)';
        const main = document.getElementById('main-image');
        if (main) main.src = src;
    };

    const catalogState = window.catalogState = new CatalogState();

    document.addEventListener('DOMContentLoaded', function () {
        const gridContainer = document.getElementById('products-grid');
        const filtersContainer = document.getElementById('filter-panel');
        const searchInput = document.getElementById('search-input');
        const sortSelect = document.getElementById('sort-select');
        const productDetailContainer = document.getElementById('product-detail');
        const recentContainer = document.getElementById('recent-products');
        const breadcrumbProductName = document.getElementById('breadcrumb-product-name');

        if (gridContainer && filtersContainer) {
            const grid = new CatalogGrid(gridContainer, catalogState, CatalogAPI);
            const filters = new CatalogFilters(filtersContainer, catalogState, CatalogAPI);
            if (searchInput) new CatalogSearch(searchInput, catalogState);

            if (sortSelect) {
                sortSelect.addEventListener('change', function () {
                    catalogState.setFilter('sort', this.value);
                });
                catalogState.on('change', function (s) {
                    if (sortSelect.value !== s.sort) sortSelect.value = s.sort;
                });
            }

            gridContainer.addEventListener('click', function (e) {
                if (e.target.closest('.catalog-retry-btn')) grid.load();
            });

            const urlParams = new URLSearchParams(window.location.search);
            if (urlParams.toString()) {
                catalogState.fromQuery(urlParams.toString());
            } else {
                grid.load();
            }

            const clearBtn = document.getElementById('clear-filters-btn');
            if (clearBtn) clearBtn.addEventListener('click', function () { filters._clearAll(); });
        }

        if (productDetailContainer) {
            const params = new URLSearchParams(window.location.search);
            const productId = params.get('id');
            if (productId) {
                const detail = new CatalogDetail(productDetailContainer, CatalogAPI);
                detail.load(parseInt(productId) || productId).then(function (p) {
                    if (p && breadcrumbProductName) breadcrumbProductName.textContent = p.name;
                    if (p) document.title = p.name + ' - Phonne';
                }).catch(function () {});
            } else {
                productDetailContainer.innerHTML = `
                    <div style="text-align:center;padding:4rem 2rem">
                        <i class="fas fa-box-open" style="font-size:3rem;color:var(--secondary-color);margin-bottom:1rem;display:block"></i>
                        <h3>No product specified.</h3>
                        <a href="products.html" class="btn btn-primary" style="margin-top:1rem;display:inline-block">Browse Products</a>
                    </div>`;
            }
        }

        if (recentContainer) {
            CatalogRecent.render(recentContainer);
        }

        const featuredGrid = document.getElementById('featured-products-grid');
        if (featuredGrid) {
            CatalogAPI.getFeatured().then(function (data) {
                const products = data?.products || data || [];
                if (products.length) {
                    featuredGrid.innerHTML = products.map(p => CatalogUI.card(p, { lazy: false })).join('');
                    if (typeof setupScrollAnimations === 'function') setupScrollAnimations();
                }
            }).catch(function (err) {
                console.error('Featured load error:', err);
            });
        }

        const trendingGrid = document.getElementById('trending-products-grid');
        if (trendingGrid) {
            CatalogAPI.getTrending().then(function (data) {
                const products = data?.products || data || [];
                if (products.length) {
                    trendingGrid.innerHTML = products.map(p => CatalogUI.card(p, { lazy: true })).join('');
                    if (typeof setupScrollAnimations === 'function') setupScrollAnimations();
                }
            }).catch(function (err) {
                console.error('Trending load error:', err);
            });
        }
    });

}());
