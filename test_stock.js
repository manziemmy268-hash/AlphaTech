const sqlite3 = require('./backend/node_modules/sqlite3').verbose();
const db = new sqlite3.Database('./database.sqlite');

const productId = 1;
const quantityToBuy = 1;

console.log("--- Stock Decrement Test ---");

db.get("SELECT name, stock FROM products WHERE id = ?", [productId], (err, initial) => {
    console.log(`Initial Stock for ${initial.name}: ${initial.stock}`);
    
    // Simulate the order logic
    const updateStockStmt = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?");
    updateStockStmt.run(quantityToBuy, productId, (err) => {
        if (err) {
            console.error("Error decrementing stock:", err);
            process.exit(1);
        }
        
        db.get("SELECT name, stock FROM products WHERE id = ?", [productId], (err, final) => {
            console.log(`Final Stock for ${final.name}: ${final.stock}`);
            
            if (final.stock === initial.stock - quantityToBuy) {
                console.log("\n✅ SUCCESS: Stock correctly decremented!");
            } else {
                console.log("\n❌ FAILURE: Stock did not decrement as expected.");
            }
            db.close();
        });
    });
});
