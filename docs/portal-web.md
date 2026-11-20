# Portal web (fase 1): login, roles, usuarios y bodegas

Portal para consultar el sistema desde celular o computador, fuera de la app de escritorio.
Vive en `web/` y es un **Worker de Cloudflare separado** del puente que usa Python (`worker/`).

| | Puente Python (`worker/`) | Portal web (`web/`) |
|---|---|---|
| Quién lo usa | La API local de cada PC de planta | Personas desde el navegador |
| Qué acepta | SQL con la clave `WORKER_API_KEY` | Solo rutas fijas, con sesión y rol |
| Recetas | Sí (las necesita la app) | **Nunca**: no hay rutas ni consultas a recetas, pesajes ni bitácora de procesos |

Ambos usan la misma base D1 `tintoreria`.

---

## Seguridad incluida

- **Contraseñas**: PBKDF2-SHA256 con sal aleatoria (100 000 iteraciones, el máximo que admite Cloudflare). Nunca se guardan ni se devuelven en claro.
- **Reglas de contraseña**: 10+ caracteres, mayúscula, minúscula, número, símbolo y sin contener el usuario.
- **Contraseña temporal**: el administrador crea la cuenta con una temporal; al primer ingreso el usuario debe cambiarla antes de ver cualquier dato.
- **Sesión**: cookie `HttpOnly`, `Secure`, `SameSite=Strict` (`__Host-tsid`). En la base solo se guarda el SHA-256 del token.
- **Cierre automático**: 30 min sin actividad o 12 h como máximo (`SESSION_IDLE_MINUTES`, `SESSION_MAX_HOURS` en `wrangler.toml`).
- **Bloqueo**: 5 intentos fallidos bloquean la cuenta 15 min; 20 fallos desde una misma IP en 15 min frenan esa IP. El mensaje de error es siempre el mismo, para no revelar si un usuario existe.
- **Permisos en el servidor**: cada ruta valida el rol; ocultar botones no es la protección.
- **CSRF**: toda escritura exige que la petición venga del mismo portal (`Origin`).
- **Cabeceras**: CSP estricta sin scripts ni estilos en línea, `X-Frame-Options: DENY`, HSTS, `nosniff`, sin referrer.
- **Auditoría**: ingresos, fallos, bloqueos, cambios de contraseña, usuarios y bodegas quedan en `web_audit` (vista **Actividad**).
- **Al cambiar rol, desactivar o restablecer contraseña** se cierran las sesiones abiertas de esa persona.

### Roles

| Permiso | Admin | Gerencia | Compras | Almacén | Consulta |
|---|---|---|---|---|---|
| Usuarios y actividad | ✓ | | | | |
| Ver bodegas | ✓ | ✓ | ✓ | ✓ | ✓ |
| Crear / editar bodegas | ✓ | | | | |
| *Fase 2:* registrar conteo | ✓ | | | ✓ | |
| *Fase 2:* aprobar y aplicar conteo | ✓ | | | | |
| *Fase 3:* precios y compras | ✓ | ✓ | ✓ | | |
| *Fase 3:* inventario, procesos y máquinas | ✓ | ✓ | ✓ | ✓ | ✓ |

Los usuarios del portal son **independientes** de los de la app de escritorio.

### Bodegas

La migración crea **Principal** (`10502`) y **Laboratorio** (`LAB`). Están enlazadas con los saldos que ya usa la app (`stock_quantity` y `lab_quantity`), por eso su código no cambia y no se pueden desactivar. Se pueden agregar otras; tener saldo propio en una tercera bodega requerirá el cambio de modelo descrito en la fase 2.

---

## Fase 2: conteo físico

Menú **Conteo físico** (roles administrador y almacén).

1. **Abrir** (administrador): elige Principal o Laboratorio. Se guarda una foto del saldo por producto y lote. Solo puede haber un conteo activo por bodega.
2. **Contar** (almacén, desde el celular): busca por código o nombre, elige el lote (o *S/N*, u *Otro lote…* si no existe) y escribe la cantidad en kg o g. Es **a ciegas**: nunca ve el saldo del sistema. Si un producto está en dos sitios se registra dos veces y se suman. Cada quien puede corregir o borrar solo sus registros.
   - **Por envases**: bulto, saco, caneca, garrafa, tambor, cuñete, caja, bolsa u otro. Se indica cuántos, cuánto trae cada uno y, opcionalmente, un sobrante suelto (ej. 3 bultos × 25 kg + 12,5 kg = 87,5 kg). El portal recuerda el último envase usado de cada producto y lo propone.
   - **Litros o galones** de un producto que se guarda en kg (o al revés) se convierten con la **densidad** registrada en la app de escritorio (ficha del químico). Sin densidad, el portal solo ofrece unidades de la misma clase.
3. **Sin señal**: el registro queda guardado en el celular («N sin enviar») y se envía solo al volver la señal. Cada registro lleva un identificador propio, así que reenviarlo no lo duplica.
4. **Hallazgos**: lo que no está en la lista se registra con el nombre de la etiqueta; el administrador lo asigna a un producto o lo descarta.
5. **Revisar** (administrador): diferencias por producto y lote valorizadas con el último precio, productos con movimientos durante el conteo, reconteo de un producto (descarta sus registros y lo marca para almacén).
6. **Cerrar → Aplicar**: para aplicar no puede haber hallazgos pendientes ni productos con existencias sin contar (se cuentan o se **confirman en cero**). Al aplicar, en una sola transacción:
   - cada lote queda igual a lo contado (0 si no se encontró) y los lotes nuevos se crean,
   - el total del producto queda igual a la suma de sus lotes,
   - cada cambio genera un movimiento `adjustment` con referencia `conteo` (o `conteo_lab`) a nombre del usuario administrador de la app de escritorio; la nota dice quién lo aprobó en el portal.
7. **SIESA**: *Descargar diferencias* genera un CSV (separado por `;`, decimales con coma) por producto y lote. Tras el ajuste manual en SIESA, **Marcar ajustado en SIESA**.

**Protección en la app de escritorio (desde 1.0.8):** no deja importar el informe de inventario de SIESA mientras haya un conteo de Principal abierto, en revisión, o aplicado sin marcar como ajustado en SIESA; si se importara, reemplazaría lo contado.

Recomendación operativa: mientras dure el conteo, no mover mercancía de esa bodega. Lo que se mueva aparece marcado en la revisión, pero al aplicar el saldo queda igual a lo contado.

---

## Desarrollo local

Usa una base D1 **local** en `web/.wrangler/` (no toca producción).

```powershell
cd web
npm install
npm run db:migrate:local
npm run admin:local -- --username tu.usuario --name "Tu Nombre"
npm run dev            # http://127.0.0.1:8787
```

Prueba automática (con `npm run dev -- --port 8788` corriendo):

```powershell
$env:SMOKE_ADMIN_USER = "tu.usuario"
$env:SMOKE_ADMIN_PASSWORD = "<la contraseña que elegiste>"
npm run test:smoke
```

La prueba crea usuarios y una bodega de prueba, por eso se niega a correr contra un servidor que no sea local.

Prueba del conteo físico (42 casos) con inventario de ejemplo (`PRB-001` a `PRB-004`):

```powershell
npx wrangler d1 execute tintoreria --local --file scripts/seed-local-inventory.sql
node scripts/count-test.mjs
```

---

## Despliegue a Cloudflare

Requiere sesión de wrangler en este PC (`npx wrangler login`, una vez).

### 1. Aplicar migraciones pendientes en producción

```powershell
cd web
npx wrangler d1 migrations list tintoreria --remote
npm run db:migrate:remote
```

El registro de migraciones de producción quedó ordenado el 20-11-2026 (0006–0014 marcadas como aplicadas tras verificar sus columnas), así que `migrations apply` funciona normal. Las migraciones del portal (0014, 0015) solo **agregan** tablas; no cambian nada que use la app de escritorio.

### 2. Publicar el Worker

```powershell
npm run deploy
```

Queda en `https://tintoreria-web.<tu-subdominio>.workers.dev`.

### 3. Crear el primer administrador

```powershell
npm run admin:remote -- --username tu.usuario --name "Tu Nombre"
```

Pide la contraseña sin mostrarla. Los demás usuarios se crean desde el portal (**Usuarios → Nuevo usuario**).

### 4. Probar el ingreso en el plan gratuito

El plan gratuito da muy poco tiempo de CPU por petición, y el login calcula PBKDF2. Si al ingresar aparece un error de Cloudflare (por ejemplo 1102 *exceeded resource limits*):

1. Baja `PBKDF2_ITERATIONS` en `wrangler.toml` (por ejemplo a `50000`) y vuelve a publicar.
2. Las contraseñas ya creadas siguen funcionando. Al pasar al plan pago, se vuelve a `100000` y cada contraseña se refuerza sola en el siguiente ingreso de su usuario.

---

## Opcional: más capas

- **Turnstile** (captcha gratuito de Cloudflare): crear el widget en el panel de Cloudflare, poner la *site key* en `TURNSTILE_SITE_KEY` (`wrangler.toml`) y la secreta con `npx wrangler secret put TURNSTILE_SECRET`. El login la exige automáticamente.
- **Dominio propio** y **Cloudflare Access** (gratis hasta 50 usuarios): que solo correos autorizados lleguen siquiera a la pantalla de login.
