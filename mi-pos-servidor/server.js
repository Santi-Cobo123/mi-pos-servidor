'use strict';
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, dir } = require('./db');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// ---------- Secreto para las sesiones ----------
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  const f = path.join(dir, 'jwt.secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  SECRET = fs.readFileSync(f, 'utf8').trim();
}

// ---------- Utilidades ----------
class E extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (msg, status = 400) => { throw new E(status, msg); };
const cent = n => { n = Number(n); if (!Number.isFinite(n) || n < 0 || n > 1e7) bad('Monto inválido'); return Math.round(n * 100); };
const d = c => c / 100;
const txt = (v, max, campo) => { v = String(v ?? '').trim(); if (!v || v.length > max) bad(`${campo} es obligatorio (máx. ${max} caracteres)`); return v; };
const int = (v, min, max, campo) => { v = Number(v); if (!Number.isInteger(v) || v < min || v > max) bad(`${campo} inválido`); return v; };

// ---------- Límite de intentos (anti fuerza bruta) ----------
const fallos = new Map();
const VENT = 15 * 60e3, MAX = 8;
const bloqueado = k => { const r = fallos.get(k); if (r && Date.now() - r.t < VENT && r.n >= MAX) bad('Demasiados intentos. Espera 15 minutos.', 429); };
const fallo = k => { const now = Date.now(), r = fallos.get(k); if (!r || now - r.t >= VENT) fallos.set(k, { n: 1, t: now }); else r.n++; };
const olvidar = k => fallos.delete(k);
setInterval(() => { const now = Date.now(); for (const [k, r] of fallos) if (now - r.t >= VENT) fallos.delete(k); }, VENT).unref();
const DUMMY = bcrypt.hashSync('no-existe', 10);

// ---------- App ----------
const app = express();
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'"],
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:'],
      'upgrade-insecure-requests': null
    }
  }
}));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
// Protección CSRF: las peticiones que modifican datos deben ser JSON (el navegador no permite enviarlas desde otros sitios sin permiso).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && !req.is('application/json')) return res.status(415).json({ error: 'Content-Type debe ser application/json' });
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (req, res) => res.send('ok'));

// ---------- Autenticación ----------
function sesion(res, u, recordar) {
  const token = jwt.sign({ id: u.id }, SECRET, { expiresIn: recordar ? '30d' : '12h' });
  res.cookie('pos_token', token, { httpOnly: true, sameSite: 'lax', secure: PROD, ...(recordar ? { maxAge: 30 * 864e5 } : {}) });
}
function perfil(u) {
  const n = db.prepare('SELECT nombre,impuesto,moneda FROM negocios WHERE id=?').get(u.negocio_id);
  return { id: u.id, usuario: u.usuario, rol: u.rol, negocio: n };
}
function auth(req, res, next) {
  const t = req.cookies.pos_token;
  if (!t) return res.status(401).json({ error: 'No autenticado' });
  try {
    const p = jwt.verify(t, SECRET);
    const u = db.prepare('SELECT id,negocio_id,usuario,rol FROM usuarios WHERE id=?').get(p.id);
    if (!u) throw new Error('no user');
    req.user = u; next();
  } catch {
    res.clearCookie('pos_token');
    res.status(401).json({ error: 'Sesión inválida o expirada' });
  }
}
const soloAdmin = (req, res, next) => req.user.rol === 'admin' ? next() : res.status(403).json({ error: 'Solo el administrador puede hacer esto' });

app.post('/api/auth/registro', (req, res) => {
  const key = 'reg:' + req.ip; bloqueado(key); fallo(key);
  const tienda = txt(req.body.tienda, 80, 'El nombre de la tienda');
  const usuario = String(req.body.usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) bad('Usuario: de 3 a 30 caracteres (letras, números, punto, guion)');
  const clave = String(req.body.clave || '');
  if (clave.length < 8 || clave.length > 72) bad('La contraseña debe tener entre 8 y 72 caracteres');
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario=?').get(usuario)) bad('Ese usuario ya existe', 409);
  const hash = bcrypt.hashSync(clave, 10);
  const u = db.transaction(() => {
    const now = Date.now();
    const nid = db.prepare('INSERT INTO negocios(nombre,creado) VALUES(?,?)').run(tienda, now).lastInsertRowid;
    const uid = db.prepare('INSERT INTO usuarios(negocio_id,usuario,clave,rol,creado) VALUES(?,?,?,?,?)').run(nid, usuario, hash, 'admin', now).lastInsertRowid;
    db.prepare('INSERT INTO cajas(negocio_id,nombre) VALUES(?,?)').run(nid, 'Caja 1');
    return { id: uid, negocio_id: nid, usuario, rol: 'admin' };
  })();
  sesion(res, u, false);
  res.status(201).json(perfil(u));
});

app.post('/api/auth/login', (req, res) => {
  const usuario = String(req.body.usuario || '').trim().toLowerCase();
  const clave = String(req.body.clave || '');
  const key = 'login:' + req.ip + ':' + usuario; bloqueado(key);
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario=?').get(usuario);
  const ok = bcrypt.compareSync(clave, u ? u.clave : DUMMY);
  if (!u || !ok) { fallo(key); bad('Usuario o contraseña incorrectos', 401); }
  olvidar(key);
  sesion(res, u, !!req.body.recordar);
  res.json(perfil(u));
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('pos_token'); res.json({ ok: true }); });
app.get('/api/yo', auth, (req, res) => res.json(perfil(req.user)));

app.post('/api/clave', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM usuarios WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(String(req.body.actual || ''), u.clave)) bad('La contraseña actual no es correcta', 401);
  const nueva = String(req.body.nueva || '');
  if (nueva.length < 8 || nueva.length > 72) bad('La nueva contraseña debe tener entre 8 y 72 caracteres');
  db.prepare('UPDATE usuarios SET clave=? WHERE id=?').run(bcrypt.hashSync(nueva, 10), u.id);
  res.json({ ok: true });
});

// ---------- Configuración del negocio ----------
app.put('/api/config', auth, soloAdmin, (req, res) => {
  const nombre = txt(req.body.nombre, 80, 'El nombre');
  const impuesto = Number(req.body.impuesto);
  if (!Number.isFinite(impuesto) || impuesto < 0 || impuesto > 100) bad('El impuesto debe estar entre 0 y 100');
  const moneda = txt(req.body.moneda, 4, 'La moneda');
  db.prepare('UPDATE negocios SET nombre=?,impuesto=?,moneda=? WHERE id=?').run(nombre, impuesto, moneda, req.user.negocio_id);
  res.json(perfil(req.user));
});

// ---------- Usuarios (solo administrador) ----------
app.get('/api/usuarios', auth, soloAdmin, (req, res) => {
  res.json(db.prepare('SELECT id,usuario,rol,creado FROM usuarios WHERE negocio_id=? ORDER BY id').all(req.user.negocio_id));
});
app.post('/api/usuarios', auth, soloAdmin, (req, res) => {
  const usuario = String(req.body.usuario || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) bad('Usuario: de 3 a 30 caracteres (letras, números, punto, guion)');
  const clave = String(req.body.clave || '');
  if (clave.length < 8 || clave.length > 72) bad('La contraseña debe tener entre 8 y 72 caracteres');
  const rol = ['admin', 'cajero'].includes(req.body.rol) ? req.body.rol : 'cajero';
  if (db.prepare('SELECT 1 FROM usuarios WHERE usuario=?').get(usuario)) bad('Ese usuario ya existe', 409);
  const id = db.prepare('INSERT INTO usuarios(negocio_id,usuario,clave,rol,creado) VALUES(?,?,?,?,?)')
    .run(req.user.negocio_id, usuario, bcrypt.hashSync(clave, 10), rol, Date.now()).lastInsertRowid;
  res.status(201).json({ id, usuario, rol });
});
app.delete('/api/usuarios/:id', auth, soloAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) bad('No puedes eliminar tu propio usuario');
  const u = db.prepare('SELECT id FROM usuarios WHERE id=? AND negocio_id=?').get(id, req.user.negocio_id);
  if (!u) bad('Usuario no encontrado', 404);
  if (db.prepare('SELECT 1 FROM cajas WHERE cajero_id=? AND abierta=1').get(id)) bad('Ese usuario tiene una caja abierta. Ciérrala primero.', 409);
  db.prepare('DELETE FROM usuarios WHERE id=?').run(id);
  res.json({ ok: true });
});

// ---------- Productos ----------
const P = r => ({ id: r.id, codigo: r.codigo, nombre: r.nombre, precio: d(r.precio), stock: r.stock });
function prodBody(b) {
  return { codigo: txt(b.codigo, 40, 'El código'), nombre: txt(b.nombre, 120, 'El nombre'), precio: cent(b.precio), stock: int(b.stock, 0, 1e7, 'Stock') };
}
const dup = e => { if (/UNIQUE constraint failed/i.test(e.message)) bad('Ese código ya existe', 409); throw e; };

app.get('/api/productos', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM productos WHERE negocio_id=? ORDER BY nombre COLLATE NOCASE').all(req.user.negocio_id).map(P));
});
app.post('/api/productos', auth, soloAdmin, (req, res) => {
  const p = prodBody(req.body);
  try {
    const id = db.prepare('INSERT INTO productos(negocio_id,codigo,nombre,precio,stock) VALUES(?,?,?,?,?)').run(req.user.negocio_id, p.codigo, p.nombre, p.precio, p.stock).lastInsertRowid;
    res.status(201).json(P(db.prepare('SELECT * FROM productos WHERE id=?').get(id)));
  } catch (e) { dup(e); }
});
app.put('/api/productos/:id', auth, soloAdmin, (req, res) => {
  const p = prodBody(req.body);
  try {
    const r = db.prepare('UPDATE productos SET codigo=?,nombre=?,precio=?,stock=? WHERE id=? AND negocio_id=?').run(p.codigo, p.nombre, p.precio, p.stock, Number(req.params.id), req.user.negocio_id);
    if (!r.changes) bad('Producto no encontrado', 404);
    res.json(P(db.prepare('SELECT * FROM productos WHERE id=?').get(Number(req.params.id))));
  } catch (e) { dup(e); }
});
app.delete('/api/productos/:id', auth, soloAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM productos WHERE id=? AND negocio_id=?').run(Number(req.params.id), req.user.negocio_id);
  if (!r.changes) bad('Producto no encontrado', 404);
  res.json({ ok: true });
});

// ---------- Cajas registradoras ----------
const C = r => ({ id: r.id, nombre: r.nombre, abierta: !!r.abierta, apertura: d(r.apertura), fecha_apertura: r.fecha_apertura, cajero_id: r.cajero_id, cajero: r.cajero || '' });
const getCaja = (user, id) => db.prepare('SELECT * FROM cajas WHERE id=? AND negocio_id=?').get(Number(id), user.negocio_id) || bad('Caja no encontrada', 404);
const puedeUsar = (user, c) => user.rol === 'admin' || c.cajero_id === user.id;

app.get('/api/cajas', auth, (req, res) => {
  res.json(db.prepare('SELECT c.*,u.usuario AS cajero FROM cajas c LEFT JOIN usuarios u ON u.id=c.cajero_id WHERE c.negocio_id=? ORDER BY c.id').all(req.user.negocio_id).map(C));
});
app.post('/api/cajas', auth, soloAdmin, (req, res) => {
  const nombre = txt(req.body.nombre, 60, 'El nombre');
  const id = db.prepare('INSERT INTO cajas(negocio_id,nombre) VALUES(?,?)').run(req.user.negocio_id, nombre).lastInsertRowid;
  res.status(201).json({ id, nombre });
});
app.delete('/api/cajas/:id', auth, soloAdmin, (req, res) => {
  const c = getCaja(req.user, req.params.id);
  if (c.abierta) bad('No puedes eliminar una caja abierta', 409);
  db.prepare('DELETE FROM cajas WHERE id=?').run(c.id);
  res.json({ ok: true });
});
app.post('/api/cajas/:id/abrir', auth, (req, res) => {
  const monto = cent(req.body.monto ?? 0);
  db.transaction(() => {
    const c = getCaja(req.user, req.params.id);
    if (c.abierta) bad('La caja ya está abierta', 409);
    if (db.prepare('SELECT 1 FROM cajas WHERE negocio_id=? AND cajero_id=? AND abierta=1').get(req.user.negocio_id, req.user.id)) bad('Ya tienes otra caja abierta. Ciérrala primero.', 409);
    db.prepare('UPDATE cajas SET abierta=1,apertura=?,fecha_apertura=?,cajero_id=? WHERE id=?').run(monto, Date.now(), req.user.id, c.id);
  })();
  res.json({ ok: true });
});
function resumenCaja(c) {
  const rows = db.prepare('SELECT pago,COALESCE(SUM(total),0) t,COUNT(*) n FROM ventas WHERE caja_id=? AND fecha>=? GROUP BY pago').all(c.id, c.fecha_apertura);
  let ef = 0, otros = 0, n = 0;
  for (const r of rows) { if (r.pago === 'Efectivo') ef += r.t; else otros += r.t; n += r.n; }
  return { ef, otros, n, esperado: c.apertura + ef };
}
const resumenOut = (c, r) => ({ apertura: d(c.apertura), ventas_efectivo: d(r.ef), ventas_otros: d(r.otros), num_ventas: r.n, esperado: d(r.esperado) });

app.get('/api/cajas/:id/resumen', auth, (req, res) => {
  const c = getCaja(req.user, req.params.id);
  if (!c.abierta) bad('La caja está cerrada', 409);
  if (!puedeUsar(req.user, c)) bad('Esta caja la tiene abierta otro cajero', 403);
  res.json(resumenOut(c, resumenCaja(c)));
});
app.post('/api/cajas/:id/cerrar', auth, (req, res) => {
  const out = db.transaction(() => {
    const c = getCaja(req.user, req.params.id);
    if (!c.abierta) bad('La caja ya está cerrada', 409);
    if (!puedeUsar(req.user, c)) bad('Esta caja la tiene abierta otro cajero', 403);
    const r = resumenCaja(c);
    const cajero = db.prepare('SELECT usuario FROM usuarios WHERE id=?').get(c.cajero_id)?.usuario || '-';
    db.prepare('INSERT INTO cierres(negocio_id,caja_nombre,cajero,apertura,fecha_apertura,fecha_cierre,ventas_efectivo,ventas_otros,num_ventas,esperado) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .run(req.user.negocio_id, c.nombre, cajero, c.apertura, c.fecha_apertura, Date.now(), r.ef, r.otros, r.n, r.esperado);
    db.prepare('UPDATE cajas SET abierta=0,cajero_id=NULL,fecha_apertura=NULL,apertura=0 WHERE id=?').run(c.id);
    return resumenOut(c, r);
  })();
  res.json(out);
});
app.get('/api/cierres', auth, (req, res) => {
  const admin = req.user.rol === 'admin';
  const rows = db.prepare(`SELECT * FROM cierres WHERE negocio_id=@n${admin ? '' : ' AND cajero=@cajero'} ORDER BY id DESC LIMIT 30`)
    .all(admin ? { n: req.user.negocio_id } : { n: req.user.negocio_id, cajero: req.user.usuario });
  res.json(rows.map(r => ({ id: r.id, caja: r.caja_nombre, cajero: r.cajero, apertura: d(r.apertura), fecha_apertura: r.fecha_apertura, fecha_cierre: r.fecha_cierre, ventas_efectivo: d(r.ventas_efectivo), ventas_otros: d(r.ventas_otros), num_ventas: r.num_ventas, esperado: d(r.esperado) })));
});

// ---------- Ventas ----------
function ventaCompleta(id, nid) {
  const v = db.prepare('SELECT * FROM ventas WHERE id=? AND negocio_id=?').get(id, nid);
  if (!v) return null;
  const items = db.prepare('SELECT nombre,precio,cant FROM venta_items WHERE venta_id=? ORDER BY id').all(id).map(i => ({ nombre: i.nombre, precio: d(i.precio), cant: i.cant }));
  return { id: v.id, numero: v.numero, fecha: v.fecha, caja: v.caja_nombre, cajero: v.cajero, pago: v.pago, subtotal: d(v.subtotal), impuesto: d(v.impuesto), total: d(v.total), recibido: v.recibido == null ? null : d(v.recibido), cambio: d(v.cambio), items };
}

app.post('/api/ventas', auth, (req, res) => {
  const b = req.body;
  const pago = ['Efectivo', 'Tarjeta', 'Transferencia'].includes(b.pago) ? b.pago : bad('Método de pago inválido');
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 200) bad('El carrito está vacío');
  const want = new Map();
  for (const it of b.items) {
    const id = int(it.producto_id, 1, Number.MAX_SAFE_INTEGER, 'Producto');
    want.set(id, (want.get(id) || 0) + int(it.cant, 1, 1e5, 'Cantidad'));
  }
  const nid = req.user.negocio_id;
  const vid = db.transaction(() => {
    const c = getCaja(req.user, b.caja_id);
    if (!c.abierta) bad('La caja está cerrada. Ábrela para vender.', 409);
    if (!puedeUsar(req.user, c)) bad('Esta caja la tiene abierta otro cajero', 403);
    const neg = db.prepare('SELECT impuesto FROM negocios WHERE id=?').get(nid);
    let sub = 0; const lines = [];
    for (const [id, cant] of want) {
      const p = db.prepare('SELECT * FROM productos WHERE id=? AND negocio_id=?').get(id, nid);
      if (!p) bad('Producto no encontrado', 404);
      const r = db.prepare('UPDATE productos SET stock=stock-? WHERE id=? AND stock>=?').run(cant, id, cant);
      if (!r.changes) bad(`Stock insuficiente de "${p.nombre}" (disponible: ${p.stock})`, 409);
      sub += p.precio * cant;
      lines.push({ id, nombre: p.nombre, precio: p.precio, cant });
    }
    const imp = Math.round(sub * neg.impuesto / 100), total = sub + imp;
    let recibido = null, cambio = 0;
    if (pago === 'Efectivo') {
      recibido = cent(b.recibido);
      if (recibido < total) bad('El monto recibido es menor al total');
      cambio = recibido - total;
    }
    const numero = db.prepare('SELECT COALESCE(MAX(numero),0)+1 n FROM ventas WHERE negocio_id=?').get(nid).n;
    const vid = db.prepare('INSERT INTO ventas(negocio_id,numero,caja_id,caja_nombre,cajero_id,cajero,fecha,pago,subtotal,impuesto,total,recibido,cambio) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(nid, numero, c.id, c.nombre, req.user.id, req.user.usuario, Date.now(), pago, sub, imp, total, recibido, cambio).lastInsertRowid;
    const ins = db.prepare('INSERT INTO venta_items(venta_id,producto_id,nombre,precio,cant) VALUES(?,?,?,?,?)');
    for (const l of lines) ins.run(vid, l.id, l.nombre, l.precio, l.cant);
    return vid;
  })();
  res.status(201).json(ventaCompleta(vid, nid));
});

app.get('/api/ventas', auth, (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 500);
  const admin = req.user.rol === 'admin';
  const prm = { n: req.user.negocio_id, limit }; if (!admin) prm.uid = req.user.id;
  const rows = db.prepare(`SELECT id,numero,fecha,caja_nombre,cajero,pago,total FROM ventas WHERE negocio_id=@n${admin ? '' : ' AND cajero_id=@uid'} ORDER BY id DESC LIMIT @limit`).all(prm);
  res.json(rows.map(r => ({ id: r.id, numero: r.numero, fecha: r.fecha, caja: r.caja_nombre, cajero: r.cajero, pago: r.pago, total: d(r.total) })));
});
app.get('/api/ventas/:id', auth, (req, res) => {
  const v = ventaCompleta(Number(req.params.id), req.user.negocio_id);
  if (!v) bad('Venta no encontrada', 404);
  res.json(v);
});

// ---------- Panel ----------
app.get('/api/resumen', auth, (req, res) => {
  const desde = Number(req.query.desde) || 0, nid = req.user.negocio_id;
  const admin = req.user.rol === 'admin';
  const prm = { n: nid, desde }; if (!admin) prm.uid = req.user.id;
  const hoy = db.prepare(`SELECT COALESCE(SUM(total),0) t,COUNT(*) n FROM ventas WHERE negocio_id=@n AND fecha>=@desde${admin ? '' : ' AND cajero_id=@uid'}`).get(prm);
  const productos = db.prepare('SELECT COUNT(*) n FROM productos WHERE negocio_id=?').get(nid).n;
  const bajos = db.prepare('SELECT nombre,stock FROM productos WHERE negocio_id=? AND stock<=10 ORDER BY stock LIMIT 20').all(nid);
  res.json({ ventas_hoy: d(hoy.t), num_hoy: hoy.n, productos, bajos });
});

// ---------- Errores ----------
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
app.use((err, req, res, next) => {
  if (err instanceof E) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Solicitud inválida' });
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

app.listen(PORT, () => console.log(`Mi POS listo en http://localhost:${PORT}`));
