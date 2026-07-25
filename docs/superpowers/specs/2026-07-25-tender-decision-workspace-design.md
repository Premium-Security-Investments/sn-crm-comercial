# Diseño — Espacio de decisión guiado para Licitaciones

**Fecha:** 2026-07-25

**Estado:** aprobado por Juan Botero para implementación completa

**Repositorio:** `Premium-Security-Investments/sn-crm-comercial`

**Rama:** `feat/tender-decision-workspace`

## 1. Problema

El módulo ya tiene contratos separados para Radar, Seguimiento, Oportunidades, documentos, análisis, decisión humana y preparación. La interfaz no refleja esa secuencia con suficiente claridad:

- las búsquedas guardadas ocupan espacio permanente en Radar;
- la Base habilitante mezcla consulta, edición y carga del RUP;
- el detalle pierde la navegación del módulo y el acceso visible a la fuente oficial;
- Revisión documental mezcla fuente, carga, lista y análisis;
- el análisis desaparece por completo cuando no existe un run vigente;
- GO/NO GO queda visualmente expuesto sin el análisis que debe preparar la decisión;
- Preparación ocupa demasiado espacio aun antes de un GO;
- los datos comerciales muestran información de origen como texto crudo;
- slugs internos aparecen en la interfaz.

Además, la importación oficial actual vuelve a descargar y guardar documentos sin comparar el contenido. El `upsert` por una identidad derivada de nombre/tamaño no conserva de forma fiable las versiones modificadas. La Base empresarial no tiene inventario documental tipado ni vigencias.

## 2. Objetivo

Crear un espacio de decisión guiado en una sola página que haga explícita la secuencia:

```text
Resumen → Documentos → Análisis → Decisión → Preparación → Seguimiento
```

La interfaz guía, pero no convierte la ausencia, obsolescencia o fallo de análisis en un bloqueo formal para una persona autorizada a registrar GO/NO GO.

## 3. Principios

1. Una licitación evoluciona; no se copia entre Radar, Seguimiento y Oportunidades.
2. La fuente oficial permanece accesible en todas las etapas.
3. El análisis siempre tiene una sección visible antes de GO/NO GO.
4. El análisis prepara; la persona autorizada decide.
5. Actualizar documentos y analizar son acciones diferentes.
6. Toda modificación de evidencia invalida visualmente el análisis anterior mediante el hash del snapshot.
7. Una actualización oficial es idempotente y conserva versiones.
8. La Base empresarial se consulta por defecto y se edita sólo mediante una acción explícita.
9. Los documentos empresariales tienen tipo, vigencia, versión, estado y archivo.
10. Ningún slug interno se presenta al usuario.
11. AGT-002 y HERMES-INTERIM no se activan con este lote.
12. El productor real de cada análisis permanece visible y auditable.

## 4. Dirección visual

Se conserva el lenguaje visual SIIO existente: azul institucional, superficies blancas, borde frío y tipografía actual. La decisión distintiva será una **línea de avance del expediente** que funciona simultáneamente como navegación interna y resumen de estado; no se introduce un nuevo sistema visual ajeno al CRM.

Paleta derivada del producto existente:

- Tinta institucional: `#10213d`
- Azul de acción: `#1f5fbf`
- Azul de contexto: `#eef5ff`
- Ámbar de atención: `#b7791f`
- Rojo de riesgo: `#b42318`
- Verde de confirmación: `#157347`

La línea de avance usa etiquetas reales de negocio y estados, no numeración decorativa.

## 5. Navegación

El detalle de una oportunidad de licitación conserva:

- tabs `Radar | Seguimiento | Oportunidades`, con Oportunidades activa;
- breadcrumb `Licitaciones / Oportunidades / <entidad>`;
- acción `Volver a Oportunidades`;
- acción `Abrir fuente oficial`;
- navegación interna `Resumen | Documentos | Análisis | Decisión | Preparación | Seguimiento`.

Cada enlace interno usa anclas accesibles y no cambia la etapa de negocio.

## 6. Radar y búsquedas guardadas

Radar mantiene convertidos y otros estados en la misma fuente de datos. Las acciones por tarjeta dependen del estado y conservan `Abrir fuente`.

La barra de filtros muestra dos acciones compactas:

- `Guardar búsqueda`: despliega únicamente el nombre y confirmación.
- `Búsquedas guardadas`: abre un panel/dialog con aplicar y eliminar.

La lista no se renderiza expandida por defecto. El dialog gestiona foco, Escape y retorno de foco.

## 7. Base empresarial de licitaciones

El nombre visible cambia de `Configuración protegida` a `Base empresarial de licitaciones`.

### 7.1 Consulta

La pantalla abre en modo lectura y muestra:

- nombre legal, NIT y estado RUP;
- RUP vigente, versión, fecha de actualización y estado de vigencia;
- resumen de capacidades;
- inventario de documentos empresariales;
- próximos vencimientos y documentos vencidos.

### 7.2 Acciones

Usuarios autorizados ven:

- `Editar información`;
- `Actualizar RUP`;
- `Añadir documento empresarial`.

Editar información abre un panel/formulario explícito. Cancelar restaura los valores cargados.

### 7.3 Documentos empresariales

Cada versión persiste:

- categoría;
- nombre legible;
- fecha de expedición;
- fecha de vencimiento;
- versión;
- hash SHA-256;
- MIME y tamaño;
- ruta privada;
- actor y fechas;
- estado vigente/no vigente.

Actualizar RUP crea una versión documental y actualiza la ficha derivada. Otros documentos se pueden añadir sin sobrescribir categorías no relacionadas.

## 8. Oportunidades

La tarjeta muestra etiquetas legibles para documentos, análisis, decisión y oferta. Incluye:

- `Abrir fuente oficial` cuando exista URL;
- `Abrir expediente`;
- `Actualizar documentos` como acción normal;
- `Reintentar actualización` sólo cuando el último intento falló.

La actualización no ejecuta análisis automáticamente. Devuelve conteos `nuevos`, `actualizados`, `sin cambios` y `fallidos`.

## 9. Espacio de decisión guiado

### 9.1 Resumen

Muestra en una franja compacta:

- cobertura documental;
- estado del análisis;
- recomendación preliminar;
- riesgo principal;
- preguntas críticas;
- siguiente acción;
- decisión humana vigente.

### 9.2 Documentos

Acciones en una barra:

- `Abrir fuente oficial`;
- `Actualizar documentos oficiales`;
- `Añadir documentos complementarios`;
- `Analizar documentos`.

La carga manual se expande bajo demanda. La lista está colapsada inicialmente, agrupada por tipo y con búsqueda/filtros. Los errores y cambios se muestran antes del listado completo.

### 9.3 Análisis

La sección siempre existe antes de GO/NO GO.

Estados:

- `pendiente`: documentos disponibles sin run;
- `vigente`: run del snapshot actual;
- `obsoleto`: existe run, pero el snapshot documental/perfil vigente difiere;
- `fallido`: el último run falló;
- `sin documentos`: invita a actualizar o cargar evidencia.

Contenido cuando existe:

- recomendación y productor;
- resumen decisorio;
- fortalezas;
- debilidades y bloqueadores;
- dudas/preguntas;
- información no verificada;
- siguiente acción;
- detalle por frente colapsado;
- historial de versiones.

### 9.4 Decisión

GO/NO GO se presenta después del análisis. Antes de los botones resume la recomendación, vigencia, riesgo y preguntas críticas. La ausencia o fallo del análisis es advertencia no bloqueante. La decisión conserva el modal e historial inmutable existentes.

### 9.5 Preparación

Antes de GO se muestra una tarjeta compacta no expandida. Después de GO se habilita el paquete, checklist, estados y pendientes. No se activa SharePoint ni envíos.

### 9.6 Seguimiento

Al final:

- contexto comercial resumido;
- datos técnicos de origen dentro de `Ver información de origen`;
- URL retirada del texto crudo y presentada como acción;
- formulario compacto;
- timeline.

## 10. Persistencia documental oficial

Se agrega una tabla tipada de versiones documentales por oportunidad. La identidad oficial usa fuente + `source_document_id`; la identidad de versión usa SHA-256 del contenido.

Flujo de actualización:

1. listar documentos oficiales;
2. descargar cada candidato dentro de límites existentes;
3. calcular SHA-256 del buffer;
4. comparar contra la versión vigente de esa identidad oficial;
5. si coincide, registrar `sin cambios` sin subir ni duplicar;
6. si cambia, subir a una ruta que incluye el hash, marcar la anterior no vigente e insertar la nueva;
7. si es nuevo, insertar versión 1;
8. conservar errores por documento;
9. crear un evento de actualización con conteos;
10. devolver documentos y análisis vigente/obsoleto sin generar un run nuevo.

La conversión inicial puede seguir importando y generando el preanálisis por reglas existente. Las actualizaciones posteriores separan importar de analizar.

## 11. Migración

La migración será aditiva e idempotente e incluirá:

- `psi_tender_document_versions`;
- `psi_company_procurement_documents`;
- índices por oportunidad/fuente/vigencia y por categoría/vigencia;
- RPCs server-side para registrar versiones y controlar la única versión vigente por identidad;
- RLS sin acceso de escritura directa del navegador;
- grants mínimos para `service_role`;
- compatibilidad de lectura con interacciones históricas.

No borra ni transforma decisiones, análisis o archivos históricos.

## 12. Responsive y accesibilidad

- 1440, 1024, 768 y 390 px;
- tabs y línea de avance con scroll horizontal controlado en móvil;
- acciones sin superposición;
- dialogs con foco inicial, Escape, trampa de foco y retorno de foco;
- `aria-current`, `aria-expanded`, `role=status/alert`;
- `:focus-visible` preservado;
- sin animaciones esenciales.

## 13. Verificación

- TDD por comportamiento;
- migraciones estáticas y PGlite;
- paridad `server/index.js` / `api/[...path].js`;
- build TypeScript/Vite;
- suite completa;
- una revisión del lote;
- QA autenticada desktop/móvil;
- smoke productivo de sólo lectura y acciones reversibles autorizadas;
- AGT-002, HERMES-INTERIM, envíos y datos sintéticos permanecen desactivados.
