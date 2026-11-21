import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { SEED_PRODUCTS } from './catalog.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.DB_PATH || path.join(DATA_DIR, 'vaanicart.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  category TEXT NOT NULL,
  price INTEGER NOT NULL,
  mrp INTEGER NOT NULL,
  rating REAL NOT NULL,
  reviews INTEGER NOT NULL,
  stock INTEGER NOT NULL,
  highlights TEXT NOT NULL,
  specs TEXT NOT NULL,
  image TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS carts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  coupon_code TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_carts_session ON carts(session_id, status);

CREATE TABLE IF NOT EXISTS cart_items (
  cart_id TEXT NOT NULL REFERENCES carts(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL,
  PRIMARY KEY (cart_id, product_id)
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  cart_id TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  discount INTEGER NOT NULL,
  total INTEGER NOT NULL,
  coupon_code TEXT,
  status TEXT NOT NULL,
  payment TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  order_id TEXT NOT NULL REFERENCES orders(id),
  product_id TEXT NOT NULL,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,
  quantity INTEGER NOT NULL
);
`);

/** Seed (or re-seed) the simulated catalog. Stock is only reset when a product is first inserted. */
export function seedCatalog() {
  const insert = db.prepare(`
    INSERT INTO products (id, name, brand, category, price, mrp, rating, reviews, stock, highlights, specs, image)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, brand=excluded.brand, category=excluded.category,
      price=excluded.price, mrp=excluded.mrp, rating=excluded.rating, reviews=excluded.reviews,
      highlights=excluded.highlights, specs=excluded.specs, image=excluded.image
  `);
  for (const p of SEED_PRODUCTS) {
    insert.run(p.id, p.name, p.brand, p.category, p.price, p.mrp, p.rating, p.reviews, p.stock,
      JSON.stringify(p.highlights), JSON.stringify(p.specs), `/api/images/${p.id}.svg`);
  }
}

export function resetStock() {
  const upd = db.prepare('UPDATE products SET stock = ? WHERE id = ?');
  for (const p of SEED_PRODUCTS) upd.run(p.stock, p.id);
}
