let allProducts = [];
let filteredProducts = [];

document.addEventListener('DOMContentLoaded', () => {
    loadProducts();
    setupFilters();
});

async function loadProducts() {
    const list = document.getElementById('products-list');
    try {
        list.innerHTML = createSkeleton(6, 'card');
        allProducts = await fetchProducts();
        
        // Initial application of URL query params
        applyInitialParams();
        
        renderBrandFilters();
        applyFilters();
    } catch (err) {
        console.error('Error loading products:', err);
        list.innerHTML = '<div class="empty-state"><h3>We are having trouble loading products right now.</h3><p>Please check your connection and try again.</p><button class="btn btn-primary" onclick="location.reload()">Retry</button></div>';
    }
}

function applyInitialParams() {
    const searchParam = getQueryParam('search');
    if (searchParam) {
        document.getElementById('global-search').value = searchParam;
    }

    const brandParam = getQueryParam('brand');
    if (brandParam) {
        // We'll handle this in the brand render to check the right checkbox
    }
}

function renderBrandFilters() {
    const brands = [...new Set(allProducts.map(p => p.brand))];
    const brandContainer = document.getElementById('brand-filters');
    const brandParam = getQueryParam('brand');

    brandContainer.innerHTML = brands.map(brand => `
        <label class="filter-option">
            <input type="checkbox" name="brand" value="${brand}" ${brand === brandParam ? 'checked' : ''}> ${brand}
        </label>
    `).join('');

    // Re-attach listeners to new checkboxes
    brandContainer.querySelectorAll('input').forEach(cb => {
        cb.addEventListener('change', applyFilters);
    });
}

function setupFilters() {
    // Price range filters
    document.querySelectorAll('input[name="price-range"]').forEach(radio => {
        radio.addEventListener('change', applyFilters);
    });

    // Sort select
    document.getElementById('sort-select').addEventListener('change', applyFilters);

    // Global search input (live filter)
    document.getElementById('global-search').addEventListener('input', applyFilters);

    // Clear filters
    document.getElementById('clear-filters').addEventListener('click', () => {
        document.getElementById('global-search').value = '';
        document.querySelectorAll('input[name="brand"]').forEach(cb => cb.checked = false);
        document.querySelector('input[name="price-range"][value="all"]').checked = true;
        document.getElementById('sort-select').value = 'featured';
        applyFilters();
    });
}

function applyFilters() {
    const searchQuery = document.getElementById('global-search').value.toLowerCase();
    const selectedBrands = Array.from(document.querySelectorAll('input[name="brand"]:checked')).map(cb => cb.value);
    const priceRange = document.querySelector('input[name="price-range"]:checked').value;
    const sortBy = document.getElementById('sort-select').value;

    filteredProducts = allProducts.filter(product => {
        // Search filter
        const matchesSearch = product.name.toLowerCase().includes(searchQuery) || 
                             product.brand.toLowerCase().includes(searchQuery);

        // Brand filter
        const matchesBrand = selectedBrands.length === 0 || selectedBrands.includes(product.brand);

        // Price filter
        let matchesPrice = true;
        if (priceRange === '0-500') matchesPrice = product.price <= 500;
        else if (priceRange === '500-1000') matchesPrice = product.price > 500 && product.price <= 1000;
        else if (priceRange === '1000plus') matchesPrice = product.price > 1000;

        return matchesSearch && matchesBrand && matchesPrice;
    });

    // Sort products
    sortProducts(sortBy);

    renderProducts();
}

function sortProducts(sortBy) {
    if (sortBy === 'low-high') {
        filteredProducts.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'high-low') {
        filteredProducts.sort((a, b) => b.price - a.price);
    } else if (sortBy === 'name') {
        filteredProducts.sort((a, b) => a.name.localeCompare(b.name));
    }
    // 'featured' keeps the original order (or you could implement featured logic)
}

function renderProducts() {
    const list = document.getElementById('products-list');
    const count = document.getElementById('product-count');
    
    count.textContent = filteredProducts.length;

    if (filteredProducts.length === 0) {
        list.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;"><h3>No products matched your filters.</h3><p>Try broadening your search or clearing a few filters.</p></div>';
        return;
    }

    list.innerHTML = filteredProducts.map(product => `
        <div class="product-card reveal">
            <img src="${getProductImageSrc(product.image)}" alt="${product.name}" class="product-image" onerror="handleProductImageError(this)">
            <div style="padding: 0 1rem;">
                <span class="product-brand">${product.brand}</span>
                <h3 class="product-name" style="margin: 0.2rem 0;">${product.name}</h3>
                <div style="font-size: 0.8rem; margin-bottom: 0.5rem;">
                    ${renderStars(product.average_rating || 0)}
                    <span style="color: var(--secondary-color);">(${product.review_count || 0})</span>
                </div>
                <p class="product-price">$${product.price}</p>
                <div style="display: flex; gap: 0.5rem; padding-bottom: 1rem;">
                    <a href="product.html?id=${product.id}" class="btn" style="border: 1px solid var(--primary-color); color: var(--primary-color); flex: 1;">Details</a>
                    <button class="btn btn-primary" style="flex: 1;" onclick="handleAddToCart(${product.id})" ${product.stock === 0 ? 'disabled' : ''}>
                        ${product.stock === 0 ? '<i class="fas fa-times"></i>' : '<i class="fas fa-cart-plus"></i>'}
                    </button>
                </div>
            </div>
        </div>
    `).join('');
    
    setupScrollAnimations();
}

// Handler for the add to cart button in the grid
async function handleAddToCart(id) {
    await addToCart(id);
}
