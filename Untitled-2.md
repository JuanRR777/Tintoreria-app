# Prompt: rediseño de sección Stock (inventario) con tarjetas categorizadas

Redisena la vista de "Stock" (estado de inventario, alertas y movimientos de químicos) reemplazando las tres tablas planas actuales ("Stock bajo - requiere reposición", "Lotes próximos a vencer" y "En espera / pedido (sin entrada a bodega)") por **tarjetas grandes categorizadas por urgencia**, cada una con un grid interno de **mini-tarjetas** por químico. Usa este documento como especificación completa. Ya conoces el modelo de datos del sistema (químicos, lotes, SOC, OCC, proveedores) — intégralo con eso, no inventes campos nuevos.

## Objetivo del cambio

Hoy las tres tablas se leen con el mismo peso visual aunque representan urgencias distintas: stock en 0 kg es crítico, un lote por vencer es una alerta temporal, y "en espera/pedido" es solo seguimiento de proceso. Convertirlas en tarjetas grandes con color e ícono por categoría comunica la urgencia antes de leer una sola palabra.

**Regla no negociable: todo debe verse sin interacción.** No hay botones "ver más", no hay paginación, no hay contenido colapsado. Si una categoría tiene 16 items, los 16 se muestran. La página crece verticalmente, nunca esconde contenido.

## Métricas superiores (sin cambios)

La fila de 5 tarjetas de métrica (Total químicos, Alertas stock bajo, Lotes por vencer, En espera SOC, Pedido OCC) ya funciona bien — ícono en círculo de color + número grande + label. Se mantiene igual, no se toca.

## Las 3 tarjetas grandes categorizadas

### 1. Stock crítico (tema rojo/coral)
- Fuente de datos: la tabla actual "Stock bajo - requiere reposición".
- Header: ícono `ti-alert-triangle`, título "Stock crítico", subtítulo "Requiere reposición inmediata", contador total a la derecha.
- Fondo del header: `var(--bg-danger)`. Ícono en cuadro `var(--fill-danger)`.
- Cada mini-tarjeta: código (mono, tenue) + ícono `ti-flask` en rojo arriba; nombre del químico; stock actual en rojo grande; stock mínimo en gris pequeño debajo (omitir esta línea si el mínimo no está definido, en vez de mostrar "0.00 kg" engañoso).

### 2. Por vencer (tema ámbar)
- Fuente de datos: la tabla actual "Lotes próximos a vencer (30 días)".
- Header: ícono `ti-clock-exclamation`, título "Por vencer", subtítulo "Próximos 30 días", contador total.
- Fondo del header: `var(--bg-warning)`. Ícono en cuadro `var(--fill-warning)`.
- Cada mini-tarjeta: código + ícono `ti-flask` en ámbar; nombre del químico; número de lote; días restantes destacado; fecha de vencimiento en gris pequeño.
- Estado vacío (como hoy, "Sin lotes por vencer"): mensaje centrado discreto, sin grid vacío ni tabla en blanco.

### 3. En espera / pedido (tema azul)
- Fuente de datos: la tabla actual "En espera / pedido (sin entrada a bodega)".
- Header: ícono `ti-truck-delivery`, título "En tránsito", subtítulo "Sin entrada a bodega", contador total.
- Fondo del header: `var(--bg-accent)`. Ícono en cuadro `var(--fill-accent)`.
- Dentro de esta tarjeta van **dos sub-grupos apilados** (no tarjetas separadas, es un solo flujo): "En espera" primero, luego "Pedido" — cada uno con su propio mini-header de texto (13px, `var(--text-secondary)`) y su propio grid de mini-tarjetas.
- Mini-tarjeta de "En espera": código + nombre + badge de estado "En espera" (`var(--bg-warning)` / `var(--text-warning)`, texto pequeño).
- Mini-tarjeta de "Pedido": código + nombre + cantidad pendiente + proveedor (texto pequeño, enlace) + valor unitario — lleva una línea más que "En espera" porque tiene más datos disponibles.

## Grid de mini-tarjetas — densidad

Para que todo quepa sin "ver más":
```css
display: grid;
grid-template-columns: repeat(auto-fit, minmax(128px, 1fr));
gap: 8px;
padding: 0.875rem;
```
Cada mini-tarjeta:
```css
background: var(--surface-1);
border-radius: var(--radius); /* 8px */
padding: 8px 10px;
```
Contenido interno de la mini-tarjeta, de arriba a abajo:
1. Línea de ícono + código: ícono 12px en el color del tema de la categoría, código en `font-family: var(--font-mono)`, 10px, `var(--text-muted)`.
2. Nombre del químico: 12px, weight 500, `line-height: 1.25`, máx. 2 líneas (truncar con ellipsis si es más largo).
3. Dato principal (stock / días restantes / cantidad): 13px, weight 500, en el color de texto del tema (`var(--text-danger)`, `var(--text-warning)` o color neutro según categoría).
4. Dato secundario opcional (mínimo, vencimiento, proveedor): 11px, `var(--text-muted)`. Se omite la línea completa si el dato no aplica — no mostrar guiones ni "—" sueltos.

## Tokens de diseño (colores y tipografía)

Mismos principios que la tarjeta de Solicitudes ya implementada — reutilizar, no duplicar:
- Variables CSS siempre, nunca hex fijos, para que responda a modo claro/oscuro.
- Tarjeta contenedora grande: `background: var(--surface-2)`, `border: 0.5px solid var(--border)`, `border-radius: 12px`, `overflow: hidden` (para que el header con fondo de color respete el radio).
- Header de cada tarjeta grande: `padding: 1rem 1.25rem`, ícono en cuadro de 32px con `border-radius: 8px`.
- Tipografía: dos pesos únicos (400 y 500), sentence case en todos los labels, sin mayúsculas tipo "STOCK BAJO" (el sistema actual usa versalitas en los headers de tabla — al migrar a tarjetas, pasar todo a sentence case normal).
- Íconos: Tabler outline únicamente (`ti-alert-triangle`, `ti-clock-exclamation`, `ti-truck-delivery`, `ti-flask`), nunca variantes `-filled`.
- Sin gradientes ni sombras decorativas. El único acento visual por categoría es el color de fondo del header (`bg-danger` / `bg-warning` / `bg-accent`) y el color del ícono en las mini-tarjetas — el resto de la tarjeta permanece neutro (`var(--surface-1)` para las mini-tarjetas, sin importar la categoría).

## Referencia de implementación (una mini-tarjeta de ejemplo)

```html
<div style="background: var(--surface-1); border-radius: var(--radius); padding: 8px 10px;">
  <div style="display: flex; align-items: center; gap: 5px; margin-bottom: 4px;">
    <i class="ti ti-flask" style="font-size: 12px; color: var(--text-danger);" aria-hidden="true"></i>
    <span style="font-size: 10px; color: var(--text-muted); font-family: var(--font-mono);">0027912</span>
  </div>
  <p style="font-size: 12px; font-weight: 500; margin: 0 0 4px; line-height: 1.25;">Bisulfito de sodio</p>
  <p style="font-size: 13px; font-weight: 500; color: var(--text-danger); margin: 0;">0.00 kg</p>
</div>
```

## Instrucción final para la IA integradora

Implementa estas tres tarjetas reutilizando los componentes/estilos base del sistema (los mismos ya usados en el header, colores y radios de la tarjeta de Solicitudes) en vez de crear una hoja de estilos paralela. Las tres tablas actuales ("Stock bajo", "Lotes próximos a vencer", "En espera/pedido") se eliminan y se reemplazan completamente por estas tarjetas — no coexisten ambas versiones. El grid debe ser responsivo (`auto-fit`) para que en pantallas angostas las mini-tarjetas se reacomoden en menos columnas mostrando siempre el 100% de los items, nunca ocultando ninguno detrás de scroll horizontal, paginación o botones de expandir.