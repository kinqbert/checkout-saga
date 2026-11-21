/** Demo catalog. Prices in cents. Sneakers have low stock on purpose. */
export const SEED_PRODUCTS = [
  { sku: "tee", name: "Logo T-shirt", price: 2400, stock: 50 },
  { sku: "mug", name: "Enamel mug", price: 1200, stock: 40 },
  { sku: "cap", name: "Dad cap", price: 2200, stock: 30 },
  { sku: "hoodie", name: "Zip hoodie", price: 6800, stock: 20 },
  { sku: "keyboard", name: "Mechanical keyboard", price: 18900, stock: 10 },
  { sku: "sneakers", name: "Limited sneakers", price: 32000, stock: 3 },
] as const;
