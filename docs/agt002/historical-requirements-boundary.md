# AGT-002 — frontera de minería histórica de requisitos

**Estado del plan recibido:** listo para aprobación y programación

**Estado de ejecución:** no aprobado, no creado y no programado

**Fecha del plan:** 2026-10-02

## 1. Propósito

El frente histórico busca analizar hasta cinco procesos cerrados de seguridad
por corrida y construir conocimiento empírico sobre requisitos habilitantes,
puntuables, desempates y condiciones económico-operativas.

No es una variante de Radar productivo, INITIAL o REANALYSIS:

```text
Fuentes públicas SECOP, read-only
  -> selección de procesos terminados
  -> workset histórico congelado
  -> requisitos atómicos con cita
  -> ocurrencias append-only
  -> familias candidatas
  -> revisión humana metodológica
```

Durante el piloto sólo puede escribir en archivos locales del almacén histórico
aprobado. No escribe en CRM, Supabase, SharePoint, SECOP ni expedientes vivos.

## 2. Separación obligatoria

| Superficie | Minería histórica | Producto AGT-002 vivo |
| --- | --- | --- |
| Unidad de identidad | `process_key` + `portfolio_id` | `opportunity_id` + `tender_id` |
| Selección | Proceso terminado y documentalmente completo | Conversión humana de una oportunidad |
| Persistencia piloto | Matrices y manifiestos locales | Supabase y objetos del producto |
| Resultado | Ocurrencias/familias metodológicas | Corrida canónica revisable |
| Decisión | Promoción humana de metodología | Decisión comercial humana |
| Efectos externos | Ninguno | Fuera del producto inicial |

Un proceso histórico no se convierte artificialmente en oportunidad para poder
usar tablas existentes.

## 3. Reconciliación con capacidades existentes

| Clasificación | Capacidad | Evidencia o límite |
| --- | --- | --- |
| `YA_EXISTE` | Hashing, normalización y patrones append-only | Canonicalizadores, runs y migraciones existentes sirven como referencia |
| `YA_EXISTE` | Worksets documentales congelados | Hay worksets gobernados, pero su implementación viva está ligada a oportunidad y REANALYSIS |
| `YA_EXISTE` | Extracción e inventario de requisitos | `tender-requirement-extraction.js`, `tender-requirement-inventory.js` y sus pruebas |
| `EXISTE_PARCIAL` | Descubrimiento y ranking | Radar posee selección y auditoría, pero no el cliente histórico cerrado sobre los datasets Socrata definidos por el plan |
| `EXISTE_PARCIAL` | Descarga, custodia y extracción | Existen registros y extracción documental del producto; no existe el pipeline local histórico completo e independiente |
| `EXISTE_PARCIAL` | Reconciliación de versiones/adendas | Hay versionado documental y reglas por procesos gobernados, no un reconciliador histórico genérico demostrado |
| `REQUIERE_AJUSTE` | Extractor de requisitos | El extractor actual usa categorías conocidas; no implementa por sí solo atomización general, tipos históricos y citas página/hoja del nuevo contrato |
| `REQUIERE_AJUSTE` | Workset reutilizable | Debe extraerse una función pura; no reutilizar RPCs que exigen oportunidad, perfil, snapshot y enqueue de REANALYSIS |
| `BRECHA_REAL` | Registro histórico de procesos | No existe `PROCESS_REGISTRY.csv` ni contrato equivalente independiente de oportunidades |
| `BRECHA_REAL` | Ocurrencias y familias candidatas | No existen las tres matrices históricas ni la cola de revisión propuestas |
| `BRECHA_REAL` | Resolución por portafolio SECOP II | No se encontraron clientes para `p6dx-8zbt` y los cinco datasets anuales indicados |
| `BRECHA_REAL` | Orquestador y QA diarios | No existe la misión, runner, recibo o programación propuesta |
| `NO_APLICA` | `psi_tender_analysis_runs` | No usar durante el piloto histórico |
| `NO_APLICA` | `psi_agt002_reanalysis_jobs` | No crear ni reutilizar jobs para cumplir una cuota histórica |
| `NO_APLICA` | Oportunidades comerciales | Un proceso histórico no altera el pipeline |

## 4. Contratos mínimos antes de construir

Antes del primer script se deben fijar y probar:

1. schema del registro de procesos;
2. schema de ocurrencia atómica;
3. schema de familia candidata;
4. schema de cola de revisión;
5. catálogo versionado de fuentes;
6. taxonomías versionadas de tema y requisito;
7. manifiesto de corrida y workset;
8. estados de extracción, QA y revisión;
9. reglas de redacción/minimización de datos personales;
10. receipt local de terminación o fallo.

## 5. Gates del piloto

El plan no está autorizado sólo por estar listo. Antes de crear o programar la
misión se requieren las decisiones pendientes del dueño:

- hora diaria;
- destino del reporte;
- confirmación de una primera corrida visible de cinco procesos antes de la
  recurrencia.

La secuencia segura es:

1. contratos y fixtures sintéticos;
2. implementación local sin cron;
3. pruebas sin red mediante respuestas Socrata/archivos simulados;
4. una corrida visible y autorizada sobre fuentes públicas;
5. revisión conjunta de selección, citas, atomización y PII;
6. sólo entonces decidir recurrencia;
7. después de tres corridas, decidir si existe mérito para una integración
   aditiva con AGT-002.

## 6. Invariantes

- Pliego definitivo y adendas reconciliadas son obligatorios.
- Una fila representa un requisito verificable y conserva cita oficial.
- La frecuencia histórica es una señal, nunca una regla jurídica transferida.
- Ninguna familia se promueve automáticamente a metodología aprobada.
- Un faltante real se reporta; no se rellena la cuota.
- No se elude CAPTCHA ni se usan credenciales personales.
- No se incorpora PII de ofertas de terceros salvo necesidad y autorización
  explícitas.
- Un lote inválido no se publica parcialmente.
- La integración futura es aditiva; nunca contamina expedientes vivos ni
  reemplaza INITIAL/REANALYSIS.

## 7. Decisión estructural

La ruta propuesta `/root/.hermes/missions/agt002-historical-requirements/` no
existía al momento de la revisión. No debe crearse hasta aprobar el piloto. Si
se aprueba, seguirá siendo un almacén aislado y reversible; no se añadirá una
migración Supabase durante las tres primeras corridas.
