# Prompt: rediseño de tarjeta de Solicitud (SOC/OCC) con stepper de proceso

Redisena el componente de tarjeta de "Solicitudes" (vista de trazabilidad de compras) reemplazando el badge de estado suelto y la barra de progreso única por el siguiente diseño. Usa este documento como especificación completa: colores, tipografía, estructura y lógica del stepper. Ya conoces el modelo de datos del sistema (SOC, OCC, estados, bodegas) — intégralo con eso, no inventes campos nuevos.

## Objetivo del cambio

Hoy la tarjeta mezcla dos conceptos distintos en un solo indicador:
1. **Etapa del proceso** (creación de solicitud → aprobación → creación de OCC → pedido → cumplido)
2. **Cantidad surtida** (KG pedidos vs KG con OCC)

Esto hace que una solicitud 100% aprobada pero con poca cantidad entregada (ej. 13%) se vea "atrasada" igual que una recién creada. Hay que separarlos visualmente: un **stepper horizontal** para la etapa, y una **barra de progreso** aparte, más pequeña, solo para la cantidad.

## Estructura de la tarjeta (de arriba a abajo)

1. **Header**: número de SOC (o OCC si no tiene SOC previa) + nombre de proveedor(es) a la izquierda; monto neto a la derecha.
2. **Separador** (línea horizontal fina).
3. **Stepper de proceso** (ver lógica abajo).
4. **Barra de cantidad surtida**: label "Surtido", texto "X / Y KG · Z%", barra delgada de progreso.
5. **Resumen de items colapsado**: "N items · M en espera de OCC" con chevron para expandir (evita listas largas cuando hay 10+ líneas, como en SOC con múltiples OCC).

## Lógica del stepper — mapeo de datos

El stepper tiene 4 pasos por defecto. Ajusta los nombres exactos a los estados reales del sistema, pero la secuencia conceptual es:

| Paso | Se marca como completado cuando... |
|---|---|
| Solicitud | La SOC fue creada (existe registro SOC) |
| Aprobada | La SOC pasó a estado "aprobada" (fin del tiempo "Creación → aprobación de la solicitud") |
| OCC creada | Existe al menos una OCC asociada a la SOC (fin del tiempo "SOC aprobada → OCC creada") |
| Cumplido | El estado final es "Cumplido" (100% de la cantidad con OCC recibida) |

Casos especiales que el stepper debe manejar, no solo el "camino feliz":
- **"Sin SOC"**: la tarjeta viene de una OCC directa sin solicitud previa. El stepper debe arrancar visualmente en el paso "OCC creada" (los pasos previos no aplican, no se muestran como "pendientes", se omiten o se muestran atenuados sin marcar como error).
- **Multi-OCC**: si una SOC tiene varias OCC (ej. SOC-00028888 con 3 OCC), el paso "OCC creada" se completa cuando existe al menos una, pero el paso "Cumplido" solo se marca cuando TODAS las OCC asociadas están cumplidas.
- **Paso actual**: el paso en curso se muestra como círculo vacío con borde grueso (ni check ni gris apagado) — es el único paso "activo".
- **Tooltip opcional en cada paso**: al hacer hover, mostrar el tiempo que tomó esa transición (los datos ya existen: "SOC → OCC 46 min", etc.), para no repetir esos tiempos como texto suelto en la tarjeta.

## Tokens de diseño (colores y tipografía)

Usa variables CSS, no valores hardcodeados, para que la tarjeta responda a modo claro/oscuro automáticamente.

### Superficies y bordes
```css
background: var(--surface-2);      /* fondo de la tarjeta, blanco en claro */
border: 0.5px solid var(--border); /* borde por defecto de la tarjeta */
border-radius: 12px;               /* radio de tarjeta */
padding: 1.25rem;
```
Contenedor de fondo detrás de la grilla de tarjetas: `var(--surface-1)`.

### Texto
```css
--text-primary     /* número de SOC, montos, valores principales */
--text-secondary   /* labels, proveedor, "Surtido", subtítulos */
```

### Stepper — estados
- **Paso completado**: círculo `background: var(--fill-success)` (verde), ícono check `ti-check` en `color: var(--on-success)`, tamaño 20px. Línea conectora hacia el siguiente paso: `background: var(--fill-success)`.
- **Paso activo (en curso)**: círculo vacío, `border: 2px solid var(--border-strong)`, `background: var(--surface-2)`.
- **Paso pendiente**: línea conectora `background: var(--border)` (gris claro, no verde).
- Labels del stepper: 11px, `color: var(--text-secondary)`, sentence case, centrados bajo cada círculo.

### Barra de cantidad surtida
```css
height: 6px;
background: var(--border);       /* riel */
border-radius: 4px;
```
Relleno: `background: var(--fill-accent)` (azul, distinto del verde del stepper para no confundir "cantidad" con "etapa").

### Tipografía
- Fuente del sistema (Anthropic Sans / la fuente base del proyecto), sin serif.
- Dos pesos únicamente: 400 (regular) y 500 (bold/semibold para números y título de SOC). No usar 600 ni 700.
- Tamaños: número de SOC 16px/500, proveedor 13px/400, monto neto 15px/500 (label "Neto" 13px/400 encima), labels de stepper 11px, texto de barra "Surtido" y porcentaje 13px.
- Sentence case en todos los labels ("Surtido", "En espera de OCC"), nunca Title Case ni mayúsculas.

### Iconografía
- Set de íconos: Tabler outline (`ti ti-check`, `ti ti-chevron-down`). No usar variantes `-filled`.
- Tamaño dentro del círculo de check: 13px. Chevron del resumen de items: 16px.

### Reglas generales
- Sin gradientes, sombras decorativas, ni fondos oscuros/de color en el contenedor externo — todo transparente sobre `var(--surface-1)` o `var(--surface-2)`.
- Todo color debe tener equivalente en modo oscuro (usar variables, no hex fijos).
- Radios: 12px en la tarjeta, `var(--radius)` (8px) en controles internos como el botón de expandir items.

## Referencia de implementación (HTML/CSS de ejemplo)

```html
<div style="background: var(--surface-2); border-radius: 12px; border: 0.5px solid var(--border); padding: 1.25rem; width: 360px;">

  <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
    <div>
      <p style="font-weight: 500; font-size: 16px; margin: 0;">SOC-00028888</p>
      <p style="font-size: 13px; color: var(--text-secondary); margin: 2px 0 0;">TAUROQUIMICA S.A. +2</p>
    </div>
    <div style="text-align: right;">
      <p style="font-size: 13px; color: var(--text-secondary); margin: 0;">Neto</p>
      <p style="font-weight: 500; font-size: 15px; margin: 2px 0 0;">$25.686.150</p>
    </div>
  </div>

  <div style="border-top: 0.5px solid var(--border); margin: 12px 0 16px;"></div>

  <!-- Stepper: repetir por cada paso, alternando círculo + línea conectora -->
  <div style="display: flex; align-items: center; margin-bottom: 6px;">
    <div style="display: flex; align-items: center; flex: 1;">
      <div style="width: 20px; height: 20px; border-radius: 50%; background: var(--fill-success); display: flex; align-items: center; justify-content: center;">
        <i class="ti ti-check" style="font-size: 13px; color: var(--on-success);" aria-hidden="true"></i>
      </div>
      <div style="flex: 1; height: 2px; background: var(--fill-success);"></div>
    </div>
    <!-- ... repetir pasos siguientes, línea gris (var(--border)) si el paso destino aún no se completa -->
    <div style="display: flex; align-items: center; flex: 0;">
      <div style="width: 20px; height: 20px; border-radius: 50%; border: 2px solid var(--border-strong); background: var(--surface-2);"></div>
    </div>
  </div>
  <div style="display: flex; font-size: 11px; color: var(--text-secondary); text-align: center; margin-bottom: 16px;">
    <span style="flex: 1;">Solicitud</span>
    <span style="flex: 1;">Aprobada</span>
    <span style="flex: 1;">OCC creada</span>
    <span style="flex: 0; min-width: 46px;">Cumplido</span>
  </div>

  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
    <span style="font-size: 13px; color: var(--text-secondary);">Surtido</span>
    <span style="font-size: 13px; font-weight: 500;">11.300 / 13.515 KG · 84%</span>
  </div>
  <div style="height: 6px; background: var(--border); border-radius: 4px; overflow: hidden; margin-bottom: 16px;">
    <div style="height: 100%; width: 84%; background: var(--fill-accent);"></div>
  </div>

  <button style="width: 100%; display: flex; justify-content: space-between; align-items: center; font-size: 13px;">
    <span>4 items · 3 en espera de OCC</span>
    <i class="ti ti-chevron-down" style="font-size: 16px;" aria-hidden="true"></i>
  </button>

</div>
```

## Instrucción final para la IA integradora

Implementa este componente dentro del sistema actual reutilizando los componentes/estilos base ya existentes (tarjetas, botones, tokens de color) en vez de crear una hoja de estilos paralela. El stepper debe alimentarse dinámicamente del estado real de cada SOC/OCC — usa el modelo de datos y las transiciones de estado que el sistema ya maneja (los mismos que hoy calculan las métricas "Aprobación SOC", "Paso a compra" y "Aprobación OCC" del dashboard) para determinar qué pasos marcar como completados, cuál es el paso activo, y cómo manejar el caso "Sin SOC" descrito arriba. No hace falta crear una tabla ni campo nuevo para el estado del stepper: derívalo del estado y las fechas que ya existen por SOC/OCC.