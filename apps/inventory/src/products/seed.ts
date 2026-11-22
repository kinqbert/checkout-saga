/**
 * Demo catalog. Prices in cents. Regular products are replenished by the
 * supplier whenever they run short, so "Place an order" always succeeds.
 * Only the sneakers are limited, so "Out of stock" always has something to hit.
 */
export const SEED_PRODUCTS = [
  { sku: "tee", name: "Logo T-shirt", price: 2400, stock: 50, limited: false },
  { sku: "mug", name: "Enamel mug", price: 1200, stock: 40, limited: false },
  { sku: "cap", name: "Dad cap", price: 2200, stock: 30, limited: false },
  { sku: "hoodie", name: "Zip hoodie", price: 6800, stock: 20, limited: false },
  { sku: "keyboard", name: "Mechanical keyboard", price: 18900, stock: 10, limited: false },
  { sku: "sneakers", name: "Limited sneakers", price: 32000, stock: 3, limited: true },
] as const;

export const seedLevel = (sku: string): number => SEED_PRODUCTS.find((p) => p.sku === sku)?.stock ?? 0;
