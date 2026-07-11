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
npm install
npm run build
npm start
```

URL local:

```text
http://127.0.0.1:4173
```

Para desarrollo con recarga en caliente:

```bash
npm run server
npm run dev
```

Vite proxya `/api` hacia `http://localhost:4173`.

## Archivos clave

- `src/main.tsx`: interfaz React completa.
- `src/styles.css`: estilos visuales.
- `server/index.js`: API Express + conexión Supabase server-side.
- `.env.local.example`: variables necesarias.

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

- `npm run build` pasa.
- `/api/bootstrap` devuelve 266 oportunidades y los KPIs esperados.
- Se verificó en navegador la pantalla de inicio, listado, detalle y dashboard.
- Se probó flujo temporal de crear oportunidad, validar pérdida sin motivo, editar, registrar seguimiento y limpiar el registro de QA.
