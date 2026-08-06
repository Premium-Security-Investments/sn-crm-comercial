# Identidad visible de Vig‑IA por dominio en SIIO

**Fecha:** 2026-08-06  
**Estado:** diseño aprobado por Juan Botero  
**Alcance:** tres agentes funcionales de SIIO y su frontera con la Plataforma de Agentes
**Modalidad:** especificación local; no autoriza push, deploy, migraciones ni cambios de datos reales

## 1. Problema

La interfaz y los contratos actuales no aplican una identidad Vig‑IA calificada de forma consistente:

- `AGT-001` aparece como **Agente Gerencial SIIO**, sin pertenecer todavía a la familia visible Vig‑IA.
- `AGT-002` aparece en el catálogo como **Copiloto de Licitaciones**, pero su Workbench y contrato operativo exigen **Vig‑IA · Copiloto de Licitaciones**.
- `AGT-003` aparece como **Vig‑IA Comercial**, mientras algunas superficies comerciales muestran sólo **Vig‑IA**.

Los dominios técnicos no están cruzados: `AGT-001` pertenece a Gerencia, `AGT-002` a Licitaciones y `AGT-003` al pipeline comercial privado. La contradicción está en la identidad visible y puede hacer que una persona atribuya capacidades, evidencia o autoridad de un dominio al otro.

La arquitectura institucional contempla además un **Agente IT**. No es un cuarto agente funcional de SIIO: pertenece a la Plataforma de Agentes y actúa como agente maestro o primer molde técnico común. Su ID definitivo permanece fuera del alcance de esta especificación.

## 2. Decisión aprobada

`Vig‑IA` será una marca compartida con un calificativo de dominio obligatorio. Nunca se mostrará sola en una superficie orientada a usuarios de SIIO.

| Identidad interna | Nombre visible obligatorio | Dominio |
|---|---|---|
| `AGT-001` | **Vig‑IA Gerencial** | Inteligencia gerencial, fuentes agregadas y borradores de Junta |
| `AGT-002` | **Vig‑IA Licitaciones** | Oportunidades públicas y licitaciones |
| `AGT-003` | **Vig‑IA Comercial** | Pipeline comercial privado |

Los IDs `AGT-001`, `AGT-002` y `AGT-003` permanecen sin cambios en contratos, productores, base de datos, auditoría, logs técnicos, eventos, linaje e historial. No serán la identidad principal de una tarjeta o pantalla de usuario.

El conteo queda expresado sin ambigüedad:

- **SIIO:** tres agentes funcionales Vig‑IA por dominio.
- **Plan institucional completo:** los tres agentes de SIIO más el Agente IT de la Plataforma de Agentes.
- **Agente Comercial PSI:** interfaz/router hacia Licitaciones o Comercial; no es un motor ni un agente canónico adicional.

## 3. Alternativas consideradas

### 3.1 Reservar Vig‑IA exclusivamente para Licitaciones

Habría exigido retirar la marca de AGT-003 y renombrar completamente la experiencia comercial. Reducía la ambigüedad, pero rompía continuidad con la identidad histórica **Vig‑IA Comercial**.

### 3.2 Reservar Vig‑IA exclusivamente para Comercial

Habría exigido revertir el contrato operativo y la identidad visible ya establecida para el Workbench de AGT-002. Tenía la mayor superficie de cambio y podía afectar contratos, perfil técnico y documentación vigente de Licitaciones.

### 3.3 Marca compartida con dominio obligatorio — seleccionada

Preserva ambos dominios, IDs, contratos técnicos e historial. La diferenciación se resuelve en la capa visible y mediante pruebas que prohíben la forma aislada `Vig‑IA`.

## 4. Arquitectura de identidad

La identidad tendrá dos capas explícitas:

1. **Identidad técnica inmutable:** `AGT-001`, `AGT-002` o `AGT-003`. Se usa para autorización, contratos, persistencia, productores, auditoría y observabilidad.
2. **Identidad visible por dominio:** `Vig‑IA Gerencial`, `Vig‑IA Licitaciones` o `Vig‑IA Comercial`. Se usa en títulos, tarjetas, acciones, estados, mensajes, errores y ayudas orientadas a usuarios.

La interfaz no derivará el nombre humano directamente del ID. El catálogo conservará un mapeo explícito y validado entre identidad técnica, nombre visible, dominio, responsable y límites de autoridad.

### 4.1 Vig‑IA Gerencial — AGT-001

- **Nombre visible:** Vig‑IA Gerencial.
- **Responsable institucional:** Dirección/Gerencia PSI.
- **Propósito:** consolidar información gerencial autorizada, presentar datos agregados, explicar vigencia y restricciones de fuentes, preparar recomendaciones trazables y elaborar borradores de Junta sujetos a revisión humana.
- **Permitido:** consultar fuentes autorizadas, mostrar métricas y nómina exclusivamente agregadas, identificar alertas y preparar borradores de Junta.
- **Prohibido:** mostrar datos personales de nómina, aprobar cifras, ocultar alertas, publicar informes o ejecutar decisiones gerenciales.

## 5. Vig‑IA Licitaciones — AGT-002

### 5.1 Identidad y propósito

- **Nombre visible:** Vig‑IA Licitaciones.
- **Descripción secundaria permitida:** Copiloto para análisis de licitaciones.
- **Responsable institucional:** Dirección de Licitaciones.
- **Propósito:** analizar documentos, organizar evidencia, identificar brechas y preparar insumos de una oportunidad pública que ya fue convertida manualmente desde el Radar.

### 5.2 Gate de entrada

Vig‑IA Licitaciones sólo actúa después de que una persona autorizada selecciona un proceso del Radar y lo convierte en **Oportunidad**. La existencia de un proceso en el Radar no autoriza análisis, priorización, conversión ni descarte automático.

### 5.3 Canal visible

**Oportunidades / Mesa Vig‑IA Licitaciones**.

El Radar puede ser fuente de origen del caso, pero no debe presentarse como canal operativo autónomo del agente.

### 5.4 Acciones permitidas

- analizar documentos y evidencia permitida;
- organizar requisitos y brechas;
- preparar insumos y matriz para una decisión humana GO/NO‑GO;
- generar borradores y listas de verificación sujetos a revisión humana;
- conservar evidencia, fuente, fecha, versión y linaje.

### 5.5 Acciones prohibidas

- convertir procesos del Radar en oportunidades;
- analizar indiscriminadamente el Radar;
- decidir, aprobar o registrar GO/NO‑GO;
- descartar procesos sin decisión humana;
- inventar evidencia, vigencia, aplicabilidad, responsables nominales o fechas;
- firmar, enviar o presentar ofertas.

La frase **“priorizar procesos públicos”** se elimina de la identidad institucional porque sugiere actuación previa al gate humano de conversión.

## 6. Vig‑IA Comercial — AGT-003

### 6.1 Identidad y propósito

- **Nombre visible:** Vig‑IA Comercial.
- **Responsable institucional:** Dirección Comercial.
- **Propósito:** detectar oportunidades privadas estancadas, riesgos de seguimiento y prioridades del pipeline comercial autorizado.

### 6.2 Canal visible

**Prioridades Comerciales**.

### 6.3 Acciones permitidas

- leer el pipeline autorizado;
- detectar estancamientos y señales de riesgo;
- priorizar seguimiento;
- explicar el criterio que activó una señal;
- vincular oportunidad, responsable, fecha y evidencia disponible.

### 6.4 Acciones prohibidas

- modificar oportunidades;
- cambiar responsables;
- aprobar ventas;
- enviar comunicaciones externas;
- operar sobre licitaciones o expedientes públicos;
- presentarse como Vig‑IA Licitaciones.

## 7. Matriz de presentación por superficie

| Superficie | AGT-001 | AGT-002 | AGT-003 | ID técnico visible |
|---|---|---|---|---|
| Catálogo de Agentes | Vig‑IA Gerencial | Vig‑IA Licitaciones | Vig‑IA Comercial | No como encabezado principal |
| SIIO Gerencial | Vig‑IA Gerencial | No aplica | No aplica | No en copy ordinario |
| Oportunidades y Workbench | No aplica | Vig‑IA Licitaciones | No aplica | Sólo en auditoría técnica si corresponde |
| Prioridades Comerciales | No aplica | No aplica | Vig‑IA Comercial | No en copy ordinario |
| Mensajes y errores para usuarios | Vig‑IA Gerencial | Vig‑IA Licitaciones | Vig‑IA Comercial | Sólo en payload o detalle técnico controlado |
| Logs, eventos, productores y contratos | `AGT-001` | `AGT-002` | `AGT-003` | Sí |
| Documentación histórica fechada | Se conserva | Se conserva | Se conserva | Se conserva |
| Documentación autoritativa vigente | Nombre compuesto | Nombre compuesto | Nombre compuesto | Sólo cuando explica arquitectura o auditoría |

El **Agente IT** no se agrega a este catálogo funcional de SIIO. Su identidad y capacidades se gobiernan en la Plataforma de Agentes.

## 8. Reglas de lenguaje

1. Se prohíbe `Vig‑IA` sin calificativo en títulos, botones, tarjetas, estados, mensajes o errores orientados a usuarios de SIIO.
2. `Vig‑IA Gerencial` nunca se describe como aprobador de cifras, publicador de Junta o ejecutor de decisiones.
3. `Vig‑IA Licitaciones` nunca se describe como actor autónomo del Radar.
4. `Vig‑IA Comercial` nunca se describe como analista de licitaciones.
5. “Preparar matriz GO/NO‑GO” se expresa como **“Preparar insumos y matriz para decisión humana GO/NO‑GO”**.
6. Los IDs `AGT-*`, estados como `operativo_parcial` y frentes `F1–F5` no se usan como lenguaje principal para usuarios.
7. Los errores visibles deben nombrar el dominio; el payload técnico puede conservar `agent_id`, `producer` o `analysis_engine`.
8. El nombre visible no cambia la autoridad: los tres agentes funcionales permanecen subordinados a revisión humana y a sus permisos técnicos.

## 9. Componentes y archivos candidatos

La implementación deberá inspeccionar y modificar únicamente los archivos necesarios, con alcance esperado en:

- `src/siioAgents.ts` — nombres visibles, propósito, canal y límites del catálogo;
- `src/siio/SiioAgentsView.tsx` — presentación humana y tratamiento del ID técnico;
- `src/tenders/components/TenderDossierVigiaWorkbench.tsx` — nombre visible compuesto de Licitaciones;
- `agt002-workbench-contract.js` — validación del nombre visible de AGT-002 sin alterar su ID;
- `src/vigia/VigiaCommercial.tsx` — nombre visible compuesto de Comercial;
- `src/vigia/VigiaOpportunityCopilot.tsx` — copy comercial no ambiguo;
- `src/main.tsx` — títulos, fallbacks y actores visibles relacionados;
- pruebas estáticas y de contrato de SIIO, AGT-002 y AGT-003;
- documentación autoritativa vigente.

Las rutas definitivas se confirmarán durante el plan de implementación. No se reescribirá documentación histórica fechada salvo que actualmente funcione como referencia autoritativa.

## 10. Estrategia TDD

### 10.1 Pruebas rojas

Antes de modificar producción, las pruebas deberán demostrar fallos por:

- uso visible de `Vig‑IA` sin `Gerencial`, `Licitaciones` o `Comercial`;
- tarjeta de AGT-001 nombrada “Agente Gerencial SIIO” en lugar de “Vig‑IA Gerencial”;
- tarjeta de AGT-002 nombrada sólo “Copiloto de Licitaciones”;
- AGT-002 descrito como priorizador autónomo del Radar;
- AGT-003 presentado como actor de Licitaciones;
- acción que sugiera decisión automática de GO/NO‑GO;
- ID `AGT-*` usado como identidad principal en una superficie ordinaria;
- cambio accidental de los IDs internos o productores canónicos.

Las pruebas distinguirán copy de usuario de payloads, logs y contratos técnicos para no prohibir los IDs donde sí son obligatorios.

### 10.2 Implementación mínima

Se cambiarán únicamente mapeos y textos visibles, más la validación semántica necesaria. No se modificará la lógica de dominio, autorización, persistencia, contratos de linaje ni esquema de datos.

### 10.3 Regresión

Se ejecutarán secuencialmente:

- pruebas focales del catálogo de Agentes;
- pruebas de lenguaje y Workbench AGT-002;
- pruebas de UI y prioridades AGT-003;
- pruebas de navegación y permisos SIIO;
- TypeScript;
- paridad Express/Vercel si se toca copy compartido del backend;
- build Vite;
- `git diff --check`;
- una revisión independiente del lote completo.

## 11. Criterios de aceptación

1. Toda identidad visible de SIIO dice **Vig‑IA Gerencial**, **Vig‑IA Licitaciones** o **Vig‑IA Comercial**.
2. Una búsqueda controlada no encuentra `Vig‑IA` aislado en copy de usuario.
3. AGT-001 continúa siendo el agente gerencial, AGT-002 el productor técnico de Licitaciones y AGT-003 el de Comercial.
4. No cambian IDs, productores, contratos de linaje ni registros históricos.
5. El catálogo describe correctamente el gate Oportunidad antes del análisis de Licitaciones.
6. Ningún texto atribuye decisión automática GO/NO‑GO a Vig‑IA Licitaciones.
7. Vig‑IA Comercial permanece read-only sobre el pipeline y fuera del dominio licitatorio.
8. Los tests focales, TypeScript y build pasan con evidencia fresca.
9. El QA visual confirma los nombres compuestos en SIIO Gerencial, Agentes, Licitaciones y Prioridades Comerciales.
10. No se realiza deploy sin aprobación humana posterior.
11. El Agente IT permanece fuera del catálogo funcional de SIIO y conserva su gobierno en la Plataforma de Agentes.

## 12. Rollout y rollback

1. Implementación local en una rama o worktree controlado.
2. Pruebas y build secuenciales.
3. Revisión independiente única.
4. QA visual autenticado en preview o entorno autorizado.
5. Gate humano para push, integración y deploy.
6. Verificación productiva de SIIO Gerencial, Agentes, Licitaciones y Prioridades Comerciales.

El rollback consiste en revertir el commit de presentación. No requiere rollback SQL ni modificación de datos porque el cambio no altera esquema, IDs, productores o historial.

## 13. Fuera de alcance

- crear nuevos agentes;
- fusionar AGT-001, AGT-002 o AGT-003;
- incorporar el Agente IT al catálogo funcional de SIIO;
- asignar un ID definitivo al Agente IT;
- modificar permisos o responsables institucionales;
- alterar algoritmos de priorización o análisis;
- cambiar el gate humano Radar → Oportunidad;
- automatizar GO/NO‑GO, firma, envío o presentación;
- cambiar contratos de persistencia, tablas o migraciones;
- reescribir análisis, eventos o documentación histórica;
- activar E6, timers, drains o procesos productivos;
- desplegar la corrección como parte de esta especificación.

## 14. Resultado esperado

Una persona podrá distinguir inmediatamente si está viendo Vig‑IA Gerencial, Vig‑IA Licitaciones o Vig‑IA Comercial, qué dominio atiende cada una y qué autoridad posee. La arquitectura conservará sus IDs técnicos y trazabilidad. El Agente IT permanecerá como agente maestro de la Plataforma de Agentes, separado del catálogo funcional de SIIO.