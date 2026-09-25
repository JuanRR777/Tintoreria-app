# Prompt: rediseño del formulario "Nueva máquina" con datos técnicos de teñido

Redisena el modal "Nueva máquina" separando los campos administrativos de los técnicos, agregando el formato de teñido (madeja/cono) como decisión estructural visible, y calculando la relación de baño automáticamente a partir de la capacidad declarada. Usa este documento como especificación completa. Ya conoces el modelo de datos del sistema (recetas, relación de baño, producción) — intégralo con eso, no inventes campos nuevos fuera de lo aquí descrito.

## Objetivo del cambio

El formulario actual mezcla todos los campos en un solo bloque plano y trata el tipo de máquina y el formato de teñido como datos secundarios de un dropdown. En una tintorería industrial, el formato de teñido (madeja o cono) determina qué tipo de tela puede procesar la máquina, y la relación de baño (litros de agua por kg de fibra) es un parámetro crítico de proceso — ambos merecen ser protagonistas del formulario, no campos perdidos entre otros.

Además, la relación de baño ya existe como parámetro objetivo en las Recetas (ver especificación de rediseño de Recetas). Calcularla aquí automáticamente, a partir de capacidad máxima y capacidad de agua, es lo que permite más adelante — cuando se construya el módulo de Producción — validar si una receta es compatible con una máquina antes de asignarla, evitando errores de proceso.

## Estructura del formulario (secciones)

### 1. Identificación
- Nombre * (texto libre, como ya existe)
- Tipo * (dropdown). Poblar con tipos reales de máquina tiñidora industrial: Jet, Overflow, Carretel (Winch), Autoclave, Continuo, Barca, Jigger, Otro. Confirmar con el usuario/cliente cuáles aplican a su operación antes de fijar la lista final — no todos los talleres tienen los mismos tipos.
- Año de fabricación (texto/número, como ya existe)
- Estado — cambia de dropdown de texto a selector de pastillas de 3 opciones con color semántico: Activa (`var(--bg-success)` / `var(--text-success)`), Mantenimiento (`var(--bg-warning)` / `var(--text-warning)`), Inactiva (neutro). Selección única, estilo consistente con los badges de estado ya usados en Solicitudes y Stock.

### 2. Formato de teñido (sección nueva, obligatoria)
- Selector de pastillas de 3 opciones, no dropdown: **Madeja**, **Cono**, **Ambos**.
- Selección única. Este dato es estructural: filtra qué recetas/órdenes de producción pueden asignarse a esta máquina más adelante.
- Iconografía sugerida (Tabler outline): `ti-circles` para Madeja, `ti-disc` para Cono, `ti-arrows-shuffle` para Ambos — o los que el equipo de diseño considere más representativos; lo importante es que cada opción tenga un ícono distintivo, no solo texto.

### 3. Capacidad y proceso (sección nueva, reemplaza "Capacidad (kg)" suelta)
- Capacidad máxima (kg) — input numérico con sufijo "kg" dentro del campo (no solo en el placeholder).
- Capacidad de agua (L) — input numérico con sufijo "L" dentro del campo.
- Relación de baño resultante — campo **calculado, no editable**, mostrado como texto de ayuda debajo de los dos inputs: `Relación de baño resultante: 1:X L/kg`, donde X = capacidad de agua ÷ capacidad máxima, redondeado a 1 decimal. Se recalcula en vivo al cambiar cualquiera de los dos valores. Ícono `ti-calculator` a la izquierda del texto, fondo `var(--surface-1)`, texto `var(--text-secondary)`.
- Si capacidad máxima es 0 o está vacía, no mostrar el cálculo (evitar división por cero) — mostrar el bloque solo cuando ambos valores son válidos y mayores a 0.

### 4. Descripción
- Igual que hoy: textarea de notas adicionales, sin cambios.

## Tokens de diseño

Mismos principios que las especificaciones anteriores (Solicitudes, Stock, Recetas) — reutilizar componentes y variables existentes, no crear una hoja de estilos paralela:
- Encabezados de sección: 12px, weight 500, `color: var(--text-secondary)`, sentence case, separados por `border-top: 0.5px solid var(--border)` antes de cada sección (excepto la primera).
- Selector de pastillas (Estado y Formato de teñido): botones en fila, `flex: 1` cada uno, `padding: 8-10px`, texto 12-13px. La opción seleccionada usa fondo/texto del color semántico correspondiente; las no seleccionadas quedan con el estilo de botón neutro ya definido en el sistema (fondo transparente, borde `var(--border-strong)`).
- Sufijos de unidad dentro de inputs: `position: absolute`, alineados a la derecha del campo, 12px, `color: var(--text-muted)`, sin interferir con la edición del valor.
- Bloque de dato calculado: `background: var(--surface-1)`, `border-radius: var(--radius)`, padding 8px 12px, 12px de texto — mismo patrón visual que otros "hints" informativos del sistema (evitar crear un componente nuevo).
- Íconos Tabler outline únicamente, nunca `-filled`.
- Sentence case en todos los labels y botones ("Activa", "Mantenimiento", no "ACTIVA").

## Referencia de implementación (sección de capacidad, ejemplo)

```html
<div style="display: flex; gap: 12px; margin-bottom: 8px;">
  <div style="flex: 1;">
    <label style="font-size: 13px; display: block; margin-bottom: 4px;">Capacidad máxima</label>
    <div style="position: relative;">
      <input type="text" placeholder="Ej: 100" style="width: 100%; padding-right: 32px;" />
      <span style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; color: var(--text-muted);">kg</span>
    </div>
  </div>
  <div style="flex: 1;">
    <label style="font-size: 13px; display: block; margin-bottom: 4px;">Capacidad de agua</label>
    <div style="position: relative;">
      <input type="text" placeholder="Ej: 1000" style="width: 100%; padding-right: 24px;" />
      <span style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%); font-size: 12px; color: var(--text-muted);">L</span>
    </div>
  </div>
</div>
<div style="background: var(--surface-1); border-radius: var(--radius); padding: 8px 12px; font-size: 12px; color: var(--text-secondary); display: flex; align-items: center; gap: 6px;">
  <i class="ti ti-calculator" style="font-size: 14px;" aria-hidden="true"></i>
  Relación de baño resultante: 1:10 L/kg
</div>
```

## Instrucción final para la IA integradora

Implementa este formulario reutilizando los componentes/estilos base ya existentes en el sistema (inputs, selects, botones, badges de color) en vez de crear estilos paralelos. Guarda "Formato de teñido" y "Relación de baño resultante" (o los dos valores de capacidad que la originan) como parte del registro de la máquina — estos datos son los que, en el futuro módulo de Producción, permitirán filtrar qué máquinas son compatibles con una receta dada (por formato de teñido y por relación de baño alcanzable). No es necesario construir esa validación ahora, pero el modelo de datos de la máquina debe quedar listo para soportarla sin migraciones futuras.