# Seguridad Nacional — Seguimiento Comercial Web MVP

Aplicación web MVP para seguimiento comercial de Seguridad Nacional conectada a Supabase.

## Pantallas incluidas

1. Inicio / resumen comercial
2. Listado de oportunidades con filtros
3. Detalle de oportunidad + línea de seguimientos
4. Registrar seguimiento
5. Crear / editar oportunidad
6. Dashboard gerencial básico

## Datos

La app consume las tablas y vistas `psi_sales_*` existentes en Supabase mediante un servidor Express local. El `SUPABASE_SERVICE_ROLE_KEY` se usa solo del lado servidor y no se expone al navegador.

## Ejecutar

```bash
cd /root/psi-comercial/plataforma-ventas/app
corepack pnpm install --frozen-lockfile
corepack pnpm run build
corepack pnpm start
```

URL local:

```text
http://127.0.0.1:4173
```

Para desarrollo con recarga en caliente:

```bash
corepack pnpm run server
corepack pnpm run dev
```

Vite proxya `/api` hacia `http://localhost:4173`.

## Archivos clave

- `src/main.tsx`: interfaz React completa.
- `src/styles.css`: estilos visuales.
- `server/index.js`: API Express + conexión Supabase server-side.
- `.env.local.example`: variables necesarias.

## Subsistemas

- [AGT-002 — mapa, límites y hoja de ruta](docs/agt002/README.md): análisis
  gobernado de licitaciones, radar, evidencia, runtime, revisión humana y
  operación.
- [AGT-003 — mapa, límites y hoja de ruta](docs/agt003/README.md): priorización
  comercial privada, preflight, copiloto de seguimiento, evidencia y revisión
  humana.
- [Mapa del ecosistema de agentes](docs/architecture/agent-ecosystem-map.md):
  responsabilidades y relación entre CRM, `agente-it` y
  `plataforma-agentes`.
- [ADR del mapa institucional](docs/architecture/ADR-2026-10-02-plataforma-y-mapa-institucional-de-agentes.md):
  Plataforma Agentes cobija AGT-000..AGT-006 y Agente IT corresponde a
  AGT-000.
- [Registro autoritativo de decisiones](docs/architecture/agent-decision-registry.md):
  decisiones vigentes, sustituciones documentales, gates y orden inmediato de
  trabajo.

## Repositorio oficial y remotos

Desde julio de 2026 el repositorio oficial del CRM vive en la organización empresarial de Premium Security Investments:

```text
https://github.com/Premium-Security-Investments/sn-crm-comercial
```

El remoto principal local debe apuntar a ese repositorio:

```bash
git remote set-url origin https://github.com/Premium-Security-Investments/sn-crm-comercial.git
git branch --set-upstream-to=origin/main main
```

El repositorio anterior de `jmb-max` queda únicamente como respaldo histórico / backup personal:

```text
https://github.com/jmb-max/seguridad-nacional-crm
```

Si se conserva localmente, usarlo con un nombre explícito para evitar pushes accidentales:

```bash
git remote add personal-backup https://github.com/jmb-max/seguridad-nacional-crm.git
```

Regla operativa: todo cambio nuevo del CRM debe entrar por `origin` hacia `Premium-Security-Investments/sn-crm-comercial`; no subir nuevas ramas de trabajo al repo personal salvo respaldo explícito.

## Verificación realizada

- `corepack pnpm run build` pasa.
- `/api/bootstrap` devuelve 266 oportunidades y los KPIs esperados.
- Se verificó en navegador la pantalla de inicio, listado, detalle y dashboard.
- Se probó flujo temporal de crear oportunidad, validar pérdida sin motivo, editar, registrar seguimiento y limpiar el registro de QA.
