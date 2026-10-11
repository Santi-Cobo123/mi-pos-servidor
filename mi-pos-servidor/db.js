'use strict';
const { DatabaseSync } = require('node:sqlite'); // SQLite integrado en Node (no requiere compilar nada)
const path = require('path');
const fs = require('fs');

const dir = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(path.join(dir, 'pos.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Transacciones: si algo falla dentro, se deshace todo.
db.transaction = fn => (...args) => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(...args); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
};

// Todos los montos se guardan en centavos (enteros) para evitar errores de redondeo.
db.exec(`
CREATE TABLE IF NOT EXISTS negocios(
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  impuesto REAL NOT NULL DEFAULT 18,
  moneda TEXT NOT NULL DEFAULT '$',
  creado INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usuarios(
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  usuario TEXT NOT NULL UNIQUE,
  clave TEXT NOT NULL,
  rol TEXT NOT NULL CHECK(rol IN ('admin','cajero')),
  creado INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS productos(
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  nombre TEXT NOT NULL,
  precio INTEGER NOT NULL CHECK(precio >= 0),
  stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
  UNIQUE(negocio_id, codigo)
);
CREATE TABLE IF NOT EXISTS cajas(
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  abierta INTEGER NOT NULL DEFAULT 0,
  apertura INTEGER NOT NULL DEFAULT 0,
  fecha_apertura INTEGER,
  cajero_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS ventas(
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  numero INTEGER NOT NULL,
  caja_id INTEGER REFERENCES cajas(id) ON DELETE SET NULL,
  caja_nombre TEXT NOT NULL,
  cajero_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  cajero TEXT NOT NULL,
  fecha INTEGER NOT NULL,
  pago TEXT NOT NULL,
  subtotal INTEGER NOT NULL,
  impuesto INTEGER NOT NULL,
  total INTEGER NOT NULL,
  recibido INTEGER,
  cambio INTEGER NOT NULL DEFAULT 0,
  UNIQUE(negocio_id, numero)
);
CREATE TABLE IF NOT EXISTS venta_items(
  id INTEGER PRIMARY KEY,
  venta_id INTEGER NOT NULL REFERENCES ventas(id) ON DELETE CASCADE,
  producto_id INTEGER,
  nombre TEXT NOT NULL,
  precio INTEGER NOT NULL,
  cant INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cierres(
  id INTEGER PRIMARY KEY,
  negocio_id INTEGER NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  caja_nombre TEXT NOT NULL,
  cajero TEXT NOT NULL,
  apertura INTEGER NOT NULL,
  fecha_apertura INTEGER NOT NULL,
  fecha_cierre INTEGER NOT NULL,
  ventas_efectivo INTEGER NOT NULL,
  ventas_otros INTEGER NOT NULL,
  num_ventas INTEGER NOT NULL,
  esperado INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ventas_neg_fecha ON ventas(negocio_id, fecha);
CREATE INDEX IF NOT EXISTS idx_ventas_caja ON ventas(caja_id, fecha);
CREATE INDEX IF NOT EXISTS idx_items_venta ON venta_items(venta_id);
CREATE INDEX IF NOT EXISTS idx_prod_neg ON productos(negocio_id);
`);

module.exports = { db, dir };
