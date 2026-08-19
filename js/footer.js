<!-- Shared footer partial — include via JS on pages that need it -->
<footer>
    <div class="container">
        <div class="footer-content">
            <div class="footer-section">
                <h4>AlphaTech</h4>
                <p style="color: var(--secondary-color); font-size: 0.9rem;">The premium destination for the latest
                    mobile technology. Quality guaranteed.</p>
            </div>
            <div class="footer-section">
                <h4>Shop</h4>
                <ul>
                    <li><a href="products.html">All Products</a></li>
                    <li><a href="products.html?brand=Apple">iPhone</a></li>
                    <li><a href="products.html?brand=Samsung">Samsung</a></li>
                </ul>
            </div>
            <div class="footer-section">
                <h4>Support</h4>
                <ul>
                    <li><a href="mailto:hello@alphatech.com">Contact Us</a></li>
                    <li><a href="products.html">Shipping Info</a></li>
                    <li><a href="products.html">Returns & Warranty</a></li>
                </ul>
            </div>
        </div>
        <div class="footer-bottom">
            &copy; <span id="site-year"></span> AlphaTech Store. All rights reserved.
        </div>
    </div>
</footer>
<script>
    var y = document.getElementById('site-year');
    if (y) y.textContent = new Date().getFullYear();
</script>
