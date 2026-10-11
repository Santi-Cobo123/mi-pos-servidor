'use strict';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let U = null, NEG = null, vista = 'dashboard', carrito = [], PRODS = [], CAJAS = [], cajaSel = null;
const m = n => esc(NEG.moneda) + Number(n).toFixed(2);
const mt = n => NEG.moneda + Number(n).toFixed(2); // texto plano (alert/confirm)
const fecha = d => new Date(d).toLocaleString('es');
const pintar = (v, html) => { if (vista === v) $('#app').innerHTML = html; };
const h = (fn, ...a) => Promise.resolve().then(() => fn(...a)).catch(e => aviso(e.message, true));

async function api(method, url, body) {
  const r = await fetch(url, {
    method, credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401 && !url.startsWith('/api/auth/')) { pantallaAuth('login'); throw new Error('Tu sesión expiró. Inicia sesión de nuevo.'); }
  if (!r.ok) throw new Error(data.error || 'Error del servidor');
  return data;
}

function aviso(texto, error) {
  const t = document.createElement('div');
  t.className = 'toast' + (error ? ' err' : '');
  t.textContent = texto;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), error ? 5000 : 4000);
}

// ============ LOGIN / CREAR CUENTA ============
function pantallaAuth(modo) {
  U = null; $('#shell').hidden = true;
  const a = $('#auth'); a.hidden = false;
  const reg = modo === 'registro';
  a.innerHTML = `<div class="authbox">
    <h1>🛒 Mi POS</h1>
    <p>${reg ? 'Crea tu cuenta' : '¡Bienvenido de vuelta! Inicia sesión'}</p>
    ${reg ? '<input id="a_tienda" placeholder="Nombre de tu tienda" maxlength="80">' : ''}
    <input id="a_user" placeholder="Usuario" autocomplete="username" maxlength="30">
    <input id="a_pass" type="password" placeholder="Contraseña" autocomplete="${reg ? 'new-password' : 'current-password'}">
    ${reg ? '<input id="a_pass2" type="password" placeholder="Repetir contraseña" autocomplete="new-password">'
          : '<label class="rec"><input type="checkbox" id="a_rec"> Recordar sesión</label>'}
    <div id="a_err" class="err"></div>
    <button class="btn" id="a_ok">${reg ? 'Crear cuenta' : 'Entrar a mi oficina'}</button>
    <p>${reg ? '¿Ya tienes cuenta? <a href="#" id="a_sw">Inicia sesión</a>'
             : '¿No tienes una cuenta? <a href="#" id="a_sw">Crear cuenta</a>'}</p>
  </div>`;
  $('#a_sw').onclick = e => { e.preventDefault(); pantallaAuth(reg ? 'login' : 'registro'); };
  $('#a_ok').onclick = () => (reg ? registrar() : login());
  a.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') (reg ? registrar() : login()); });
  (reg ? $('#a_tienda') : $('#a_user')).focus();
}
async function login() {
  try {
    entrar(await api('POST', '/api/auth/login', { usuario: $('#a_user').value, clave: $('#a_pass').value, recordar: $('#a_rec').checked }));
  } catch (e) { $('#a_err').textContent = e.message; }
}
async function registrar() {
  try {
    if ($('#a_pass').value !== $('#a_pass2').value) throw new Error('Las contraseñas no coinciden');
    entrar(await api('POST', '/api/auth/registro', { tienda: $('#a_tienda').value, usuario: $('#a_user').value, clave: $('#a_pass').value }));
  } catch (e) { $('#a_err').textContent = e.message; }
}
function entrar(p) {
  U = p; NEG = p.negocio; carrito = []; cajaSel = null; vista = 'dashboard';
  $('#auth').hidden = true; $('#auth').innerHTML = ''; $('#shell').hidden = false;
  menu(); render();
}
async function salir() {
  await api('POST', '/api/auth/logout', {});
  pantallaAuth('login');
}

// ============ MENÚ ============
function menu() {
  const it = [['dashboard', '📊 Panel'], ['pos', '💳 Punto de venta'], ['cajas', '🗄️ Cajas'], ['productos', '📦 Productos'], ['ventas', '🧾 Ventas']];
  if (U.rol === 'admin') it.push(['usuarios', '👥 Usuarios'], ['config', '⚙️ Configuración']);
  it.push(['cuenta', '🔑 Mi cuenta']);
  $('#side').innerHTML = `<h1>🛒 ${esc(NEG.nombre)}</h1>` +
    it.map(([v, t]) => `<button class="${v === vista ? 'on' : ''}" onclick="ir('${v}')">${t}</button>`).join('') +
    `<div id="usr"><div>👤 ${esc(U.usuario)} (${U.rol})</div><button onclick="h(salir)">🚪 Cerrar sesión</button></div>`;
}
function ir(v) { vista = v; menu(); render(); }
function render() {
  const vistas = { dashboard: vDash, pos: vPOS, cajas: vCajas, productos: vProductos, ventas: vVentas, usuarios: vUsuarios, config: vConfig, cuenta: vCuenta };
  h(vistas[vista]);
}

// ============ PANEL ============
async function vDash() {
  const t0 = new Date(); t0.setHours(0, 0, 0, 0);
  const [r, cajas] = await Promise.all([api('GET', '/api/resumen?desde=' + t0.getTime()), api('GET', '/api/cajas')]);
  pintar('dashboard', `<h2>Panel</h2>
  <div class="stats">
    <div class="stat"><small>Ventas de hoy</small><b>${m(r.ventas_hoy)}</b></div>
    <div class="stat"><small>Transacciones hoy</small><b>${r.num_hoy}</b></div>
    <div class="stat"><small>Productos</small><b>${r.productos}</b></div>
    <div class="stat"><small>Stock bajo (≤10)</small><b>${r.bajos.length}</b></div>
  </div>
  <div class="card" style="margin-top:16px"><h3>Cajas</h3><table><tr><th>Caja</th><th>Estado</th><th>Cajero</th></tr>
  ${cajas.map(c => `<tr><td>${esc(c.nombre)}</td><td><span class="badge ${c.abierta ? 'abierta' : 'cerrada'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span></td><td>${esc(c.cajero) || '-'}</td></tr>`).join('')}</table></div>
  ${r.bajos.length ? `<div class="card"><h3>⚠️ Stock bajo</h3>${r.bajos.map(p => `<div>${esc(p.nombre)}: <b>${p.stock}</b></div>`).join('')}</div>` : ''}`);
}

// ============ PUNTO DE VENTA ============
async function vPOS() {
  [PRODS, CAJAS] = await Promise.all([api('GET', '/api/productos'), api('GET', '/api/cajas')]);
  const usables = CAJAS.filter(c => c.abierta && (U.rol === 'admin' || c.cajero_id === U.id));
  if (!usables.some(c => c.id === cajaSel)) cajaSel = (usables.find(c => c.cajero_id === U.id) || usables[0] || {}).id || null;
  if (!cajaSel) {
    pintar('pos', `<h2>Punto de venta</h2><div class="aviso">No tienes una caja abierta. Ve a <b>Cajas</b> y abre una para poder vender.</div>`);
    return;
  }
  const caja = CAJAS.find(c => c.id === cajaSel);
  pintar('pos', `<h2>Punto de venta · ${esc(caja.nombre)} <small style="color:var(--gris);font-weight:400">(${esc(caja.cajero)})</small></h2>
  ${usables.length > 1 ? `<div class="row" style="margin-bottom:12px"><label>Caja: <select onchange="cajaSel=Number(this.value);h(vPOS)">${usables.map(c => `<option value="${c.id}" ${c.id === cajaSel ? 'selected' : ''}>${esc(c.nombre)} (${esc(c.cajero)})</option>`).join('')}</select></label></div>` : ''}
  <div class="pos">
    <div class="card">
      <input id="busq" placeholder="🔍 Buscar por nombre o escanear código..." style="width:100%" oninput="listaProd()" onkeydown="if(event.key==='Enter')escanear()">
      <div class="grid" id="lista"></div>
    </div>
    <div class="card" id="cart"></div>
  </div>`);
  listaProd(); pintarCarrito(); const b = $('#busq'); if (b) b.focus();
}
function listaProd() {
  const q = $('#busq').value.toLowerCase();
  const r = PRODS.filter(p => p.nombre.toLowerCase().includes(q) || p.codigo.toLowerCase().includes(q));
  $('#lista').innerHTML = r.map(p => `<div class="prod" onclick="addCarrito(${p.id})"><b>${esc(p.nombre)}</b><span>${m(p.precio)}</span><small>Stock: ${p.stock}</small></div>`).join('') || '<p>Sin resultados</p>';
}
function escanear() {
  const q = $('#busq').value.trim().toLowerCase(); const p = PRODS.find(p => p.codigo.toLowerCase() === q);
  if (p) { addCarrito(p.id); $('#busq').value = ''; listaProd(); }
}
function addCarrito(id) {
  const p = PRODS.find(p => p.id === id), it = carrito.find(i => i.id === id);
  if ((it ? it.cant : 0) + 1 > p.stock) return aviso('Stock insuficiente', true);
  it ? it.cant++ : carrito.push({ id, cant: 1 });
  pintarCarrito();
}
function cambiar(id, dlt) {
  const it = carrito.find(i => i.id === id), p = PRODS.find(p => p.id === id);
  it.cant += dlt;
  if (it.cant > p.stock) { it.cant = p.stock; aviso('Stock insuficiente', true); }
  if (it.cant <= 0) carrito = carrito.filter(i => i.id !== id);
  pintarCarrito();
}
function calc() {
  const sub = carrito.reduce((a, i) => a + PRODS.find(p => p.id === i.id).precio * i.cant, 0);
  const imp = sub * NEG.impuesto / 100;
  return { sub, imp, total: sub + imp };
}
function pintarCarrito() {
  const t = calc();
  $('#cart').innerHTML = `<h3>Carrito</h3>
  <table>${carrito.map(i => { const p = PRODS.find(p => p.id === i.id); return `<tr><td>${esc(p.nombre)}</td>
    <td class="qty"><button onclick="cambiar(${i.id},-1)">−</button> ${i.cant} <button onclick="cambiar(${i.id},1)">+</button></td>
    <td>${m(p.precio * i.cant)}</td></tr>`; }).join('') || '<tr><td>Vacío</td></tr>'}</table>
  <div class="tot"><div><span>Subtotal</span><span>${m(t.sub)}</span></div>
  <div><span>Impuesto (${esc(NEG.impuesto)}%)</span><span>${m(t.imp)}</span></div>
  <div class="grande"><span>TOTAL</span><span>${m(t.total)}</span></div></div>
  <div class="row" style="margin-top:12px"><select id="pago" style="flex:1"><option>Efectivo</option><option>Tarjeta</option><option>Transferencia</option></select>
  <input id="recibido" type="number" step="0.01" min="0" placeholder="Recibido" style="width:110px"></div>
  <div class="row" style="margin-top:12px"><button class="btn verde" style="flex:1" onclick="h(cobrar)">✅ Cobrar</button>
  <button class="btn rojo" onclick="carrito=[];pintarCarrito()">Vaciar</button></div>`;
}
async function cobrar() {
  if (!carrito.length) throw new Error('El carrito está vacío');
  const pago = $('#pago').value;
  const body = { caja_id: cajaSel, pago, items: carrito.map(i => ({ producto_id: i.id, cant: i.cant })) };
  if (pago === 'Efectivo') body.recibido = $('#recibido').value;
  const v = await api('POST', '/api/ventas', body);
  carrito = [];
  await vPOS();
  aviso(v.cambio > 0 ? 'Venta registrada · Cambio: ' + mt(v.cambio) : 'Venta registrada ✅');
  imprimir(v);
}
function imprimir(v) {
  const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
    @page{size:80mm auto;margin:0}
    body{font-family:monospace;font-size:12px;width:72mm;margin:0;padding:4mm}
    hr{border:0;border-top:1px dashed #000}
  </style></head><body>
  <center><b>${esc(NEG.nombre)}</b><br>Recibo #${v.numero}<br>${esc(fecha(v.fecha))}<br>Cajero: ${esc(v.cajero)}</center><hr>
  ${v.items.map(i => `${i.cant} x ${esc(i.nombre)}<br>&nbsp;&nbsp;&nbsp;${m(i.precio * i.cant)}`).join('<br>')}<hr>
  Subtotal: ${m(v.subtotal)}<br>Impuesto: ${m(v.impuesto)}<br><b>TOTAL: ${m(v.total)}</b><br>
  Pago: ${esc(v.pago)}${v.cambio ? '<br>Cambio: ' + m(v.cambio) : ''}<hr>
  <center>¡Gracias por su compra!</center></body></html>`;
  let f = document.getElementById('printFrame');
  if (!f) {
    f = document.createElement('iframe'); f.id = 'printFrame';
    f.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    document.body.appendChild(f);
  }
  f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); };
  f.srcdoc = html;
}

// ============ CAJAS ============
async function vCajas() {
  const [cajas, cierres] = await Promise.all([api('GET', '/api/cajas'), api('GET', '/api/cierres')]);
  CAJAS = cajas;
  const admin = U.rol === 'admin';
  pintar('cajas', `<h2>Cajas registradoras</h2>
  ${admin ? `<div class="card row"><input id="ncaja" placeholder="Nombre de la nueva caja" maxlength="60"><button class="btn" onclick="h(addCaja)">+ Crear caja</button></div>` : ''}
  <div class="card"><table><tr><th>Caja</th><th>Estado</th><th>Apertura</th><th>Cajero</th><th>Acción</th></tr>
  ${cajas.map(c => `<tr><td>${esc(c.nombre)}</td>
    <td><span class="badge ${c.abierta ? 'abierta' : 'cerrada'}">${c.abierta ? 'Abierta' : 'Cerrada'}</span></td>
    <td>${c.abierta ? m(c.apertura) + ' · ' + esc(fecha(c.fecha_apertura)) : '-'}</td><td>${esc(c.cajero) || '-'}</td>
    <td>${c.abierta
      ? (admin || c.cajero_id === U.id ? `<button class="btn rojo" onclick="h(cerrarCaja,${c.id})">Cerrar caja</button>` : 'En uso')
      : `<button class="btn verde" onclick="h(abrirCaja,${c.id})">Abrir caja</button>`}
    ${admin && !c.abierta && cajas.length > 1 ? `<button class="btn gris" onclick="h(delCaja,${c.id})">🗑</button>` : ''}</td></tr>`).join('')}</table></div>
  <div class="card"><h3>Últimos cierres</h3><table><tr><th>Cierre</th><th>Caja</th><th>Cajero</th><th>Ventas</th><th>Efectivo esperado</th></tr>
  ${cierres.map(c => `<tr><td>${esc(fecha(c.fecha_cierre))}</td><td>${esc(c.caja)}</td><td>${esc(c.cajero)}</td><td>${m(c.ventas_efectivo + c.ventas_otros)} (${c.num_ventas})</td><td>${m(c.esperado)}</td></tr>`).join('') || '<tr><td colspan="5">Aún no hay cierres</td></tr>'}</table></div>`);
}
async function addCaja() { const n = $('#ncaja').value.trim(); if (!n) return; await api('POST', '/api/cajas', { nombre: n }); vCajas(); }
async function delCaja(id) { if (!confirm('¿Eliminar esta caja?')) return; await api('DELETE', '/api/cajas/' + id); vCajas(); }
async function abrirCaja(id) {
  const s = prompt('Monto inicial en efectivo:', '0'); if (s === null) return;
  const n = Number(s); if (!isFinite(n) || n < 0) throw new Error('Monto inválido');
  await api('POST', `/api/cajas/${id}/abrir`, { monto: n });
  cajaSel = id; vCajas();
}
async function cerrarCaja(id) {
  const r = await api('GET', `/api/cajas/${id}/resumen`);
  if (!confirm(`CIERRE DE CAJA\n\nApertura: ${mt(r.apertura)}\nVentas efectivo: ${mt(r.ventas_efectivo)}\nVentas tarjeta/otros: ${mt(r.ventas_otros)}\nTotal ventas: ${mt(r.ventas_efectivo + r.ventas_otros)} (${r.num_ventas})\n\nEfectivo esperado en caja: ${mt(r.esperado)}\n\n¿Cerrar caja?`)) return;
  await api('POST', `/api/cajas/${id}/cerrar`, {});
  vCajas();
}

// ============ PRODUCTOS ============
async function vProductos() {
  PRODS = await api('GET', '/api/productos');
  const admin = U.rol === 'admin';
  pintar('productos', `<h2>Productos</h2>
  ${admin ? `<div class="card row"><input id="pc" placeholder="Código" maxlength="40"><input id="pn" placeholder="Nombre" maxlength="120"><input id="pp" type="number" step="0.01" min="0" placeholder="Precio"><input id="ps" type="number" min="0" placeholder="Stock">
  <button class="btn" onclick="h(addProd)">+ Agregar</button></div>` : ''}
  <div class="card"><table><tr><th>Código</th><th>Nombre</th><th>Precio</th><th>Stock</th>${admin ? '<th></th>' : ''}</tr>
  ${PRODS.map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td>${m(p.precio)}</td><td>${p.stock}</td>
  ${admin ? `<td><button class="btn gris" onclick="h(editProd,${p.id})">✏️</button> <button class="btn rojo" onclick="h(delProd,${p.id})">🗑</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="5">Aún no hay productos</td></tr>'}</table></div>`);
}
async function addProd() {
  await api('POST', '/api/productos', { codigo: $('#pc').value, nombre: $('#pn').value, precio: $('#pp').value, stock: $('#ps').value });
  vProductos();
}
async function editProd(id) {
  const p = PRODS.find(p => p.id === id);
  const n = prompt('Nombre:', p.nombre); if (n === null) return;
  const pr = prompt('Precio:', p.precio); if (pr === null) return;
  const st = prompt('Stock:', p.stock); if (st === null) return;
  await api('PUT', '/api/productos/' + id, { codigo: p.codigo, nombre: n, precio: pr, stock: st });
  vProductos();
}
async function delProd(id) { if (!confirm('¿Eliminar producto?')) return; await api('DELETE', '/api/productos/' + id); vProductos(); }

// ============ VENTAS ============
async function vVentas() {
  const vs = await api('GET', '/api/ventas?limit=200');
  pintar('ventas', `<h2>Historial de ventas</h2><div class="card"><table>
  <tr><th>#</th><th>Fecha</th><th>Caja/Cajero</th><th>Pago</th><th>Total</th><th></th></tr>
  ${vs.map(v => `<tr><td>${v.numero}</td><td>${esc(fecha(v.fecha))}</td><td>${esc(v.caja)} / ${esc(v.cajero)}</td><td>${esc(v.pago)}</td><td><b>${m(v.total)}</b></td>
  <td><button class="btn gris" onclick="h(reimprimir,${v.id})">🖨</button></td></tr>`).join('') || '<tr><td colspan="6">Aún no hay ventas</td></tr>'}</table></div>`);
}
async function reimprimir(id) { imprimir(await api('GET', '/api/ventas/' + id)); }

// ============ USUARIOS ============
async function vUsuarios() {
  const us = await api('GET', '/api/usuarios');
  pintar('usuarios', `<h2>Usuarios</h2>
  <div class="card row"><input id="un" placeholder="Usuario" maxlength="30"><input id="uc" type="password" placeholder="Contraseña (mín. 8)" autocomplete="new-password">
  <select id="ur"><option value="cajero">Cajero</option><option value="admin">Administrador</option></select>
  <button class="btn" onclick="h(addUsuario)">+ Crear usuario</button></div>
  <div class="card"><table><tr><th>Usuario</th><th>Rol</th><th>Creado</th><th></th></tr>
  ${us.map(u => `<tr><td>${esc(u.usuario)}</td><td>${esc(u.rol)}</td><td>${esc(fecha(u.creado))}</td>
  <td>${u.id === U.id ? '(tú)' : `<button class="btn rojo" onclick="h(delUsuario,${u.id})">🗑</button>`}</td></tr>`).join('')}</table></div>`);
}
async function addUsuario() {
  await api('POST', '/api/usuarios', { usuario: $('#un').value, clave: $('#uc').value, rol: $('#ur').value });
  aviso('Usuario creado'); vUsuarios();
}
async function delUsuario(id) { if (!confirm('¿Eliminar este usuario?')) return; await api('DELETE', '/api/usuarios/' + id); vUsuarios(); }

// ============ CONFIGURACIÓN / MI CUENTA ============
function vConfig() {
  pintar('config', `<h2>Configuración</h2><div class="card col">
  <label>Nombre de la tienda<input id="ct" value="${esc(NEG.nombre)}" maxlength="80"></label>
  <label>Impuesto (%)<input id="ci" type="number" step="0.01" min="0" max="100" value="${esc(NEG.impuesto)}"></label>
  <label>Símbolo de moneda<input id="cm" value="${esc(NEG.moneda)}" maxlength="4"></label>
  <button class="btn" onclick="h(saveConf)">Guardar</button></div>`);
}
async function saveConf() {
  const p = await api('PUT', '/api/config', { nombre: $('#ct').value, impuesto: $('#ci').value, moneda: $('#cm').value });
  NEG = p.negocio; menu(); aviso('Configuración guardada');
}
function vCuenta() {
  pintar('cuenta', `<h2>Mi cuenta</h2><div class="card col"><h3>Cambiar contraseña</h3>
  <input id="k1" type="password" placeholder="Contraseña actual" autocomplete="current-password">
  <input id="k2" type="password" placeholder="Nueva contraseña (mín. 8)" autocomplete="new-password">
  <button class="btn" onclick="h(cambiarClave)">Cambiar contraseña</button></div>`);
}
async function cambiarClave() {
  await api('POST', '/api/clave', { actual: $('#k1').value, nueva: $('#k2').value });
  $('#k1').value = ''; $('#k2').value = ''; aviso('Contraseña actualizada');
}

// ============ INICIO ============
(async () => {
  try { entrar(await api('GET', '/api/yo')); }
  catch { pantallaAuth('login'); }
})();
