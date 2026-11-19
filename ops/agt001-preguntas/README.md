# AGT-001 · Pregúntele a Vig-IA

Los directivos escriben preguntas en la pestaña Vig-IA de la Torre (`/api/siio/preguntas`). Este trabajador residente
las contesta una a la vez:

1. Mira la cola cada 5 s (`siio_vigia_preguntas`, índice parcial sobre `status = 'pendiente'`) y toma la más antigua.
2. Corre `claude -p` con la sesión de AGT-001 (`/opt/agt001-bridge/.claude`), sin herramientas propias y solo con las de
   `mcp-datos.mjs`: Avancys, SecurityOps y una lista de tablas del CRM, todo de solo lectura, más una base SQLite en
   memoria para contar con SQL.
3. Escribe la respuesta, la tabla (si la hay) y lo aprendido (`siio_vigia_conocimiento`). Un turno se corta a los 8 min.

Decisiones de Juan (2026-11-19): todo el que ve la Torre pregunta; datos completos (nombres, cédulas, salarios); cada
persona ve solo lo suyo; Vig-IA aprende, y el administrador ve lo que más se pregunta y lo aprendido.

## Instalación (root)

```sh
cp ops/agt001-preguntas/agt001-preguntas.service /etc/systemd/system/
mkdir -p /etc/systemd/system/agt001-preguntas.service.d
# 10-release.conf con WorkingDirectory y ExecStart en /opt/psi-comercial/releases/<sha> (receta de ops/release)
systemctl daemon-reload && systemctl enable --now agt001-preguntas
journalctl -u agt001-preguntas -f   # eventos vigia_pregunta_respondida / vigia_pregunta_fallida
```

Si la sesión de Claude de AGT-001 vence, las preguntas fallan con `VIGIA_SESION_VENCIDA` y la Torre lo dice en palabras.
