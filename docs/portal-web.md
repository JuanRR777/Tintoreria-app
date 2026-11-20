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

---

## Despliegue a Cloudflare

Requiere sesión de wrangler en este PC (`npx wrangler login`, una vez).

### 1. Revisar migraciones pendientes en producción

```powershell
cd web
npx wrangler d1 migrations list tintoreria --remote
```

- **Si solo aparece `0014_web_auth_warehouses.sql` como pendiente**: `npm run db:migrate:remote`.
- **Si aparecen también 0008–0013 como pendientes**: **no** uses `migrations apply`. La app de Python ya agregó esas columnas al arrancar y wrangler fallaría por columnas duplicadas. Aplica solo la 0014, que es segura de repetir:

  ```powershell
  npx wrangler d1 execute tintoreria --remote --file ../worker/migrations/0014_web_auth_warehouses.sql
  ```

La 0014 solo **agrega** tablas (`web_users`, `web_sessions`, `web_audit`, `warehouses`); no cambia nada que use la app de escritorio.

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
