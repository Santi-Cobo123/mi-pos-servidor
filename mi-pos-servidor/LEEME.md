# Mi POS - Versión con servidor

Sistema de punto de venta con **Node.js + SQLite**. Cada tienda tiene su cuenta,
sus cajeros, sus productos, sus cajas y su historial de ventas. Los datos viven
en el servidor, así que puedes usarlo desde varias computadoras o celulares.

## Cómo ejecutarlo en Visual Studio Code

1. Instala **Node.js 22.13 o superior** (recomendado: la versión LTS más reciente) desde https://nodejs.org.
2. Descomprime el zip y abre la carpeta `mi-pos-servidor` en VS Code.
3. Abre la terminal (menú Terminal > Nueva terminal) y escribe:

       npm install
       npm start

4. Abre en el navegador: http://localhost:3000
5. Pulsa **Crear cuenta** (tu tienda y tu usuario serán el administrador).

Para desarrollo con recarga automática: `npm run dev`.

Al iniciar verás un aviso "ExperimentalWarning: SQLite is an experimental feature". Es normal: usa el SQLite que ya trae Node, por eso no necesita compilar nada.

## Cómo se usa

- **Cajas**: abre una caja con el efectivo inicial. Al cerrarla ves el cuadre (efectivo esperado).
- **Punto de venta**: toca los productos (o escanea el código y pulsa Enter) y cobra. Se imprime un recibo de 80 mm.
- **Productos / Usuarios / Configuración**: solo el administrador. Crea cajeros desde Usuarios.
- Un cajero solo ve y usa su propia caja, y solo sus ventas.

## Qué incluye de seguridad

- Contraseñas cifradas con bcrypt; sesión en cookie httpOnly.
- El servidor calcula precios, impuesto, total y stock (no confía en el navegador).
- Las ventas son transacciones: si algo falla, no se descuenta stock.
- Cada tienda solo accede a sus propios datos.
- Bloqueo tras varios intentos fallidos de inicio de sesión.

## Respaldo

Toda la información está en el archivo `data/pos.db`. Cópialo regularmente
(con el servidor detenido) para tener respaldo.

## Estructura

    server.js        API y servidor
    db.js            base de datos (SQLite)
    public/          pantalla del sistema (HTML, CSS, JS)
    data/            se crea sola (base de datos y clave de sesiones)

## Publicarlo en internet

Necesita un hosting que ejecute Node.js y conserve el disco (Render, Railway, Fly.io o un VPS).
Variables: `NODE_ENV=production`, `TRUST_PROXY=1`, `DATA_DIR` apuntando al disco persistente.
