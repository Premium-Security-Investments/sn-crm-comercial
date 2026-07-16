# Matriz funcional de permisos — CRM / SIIO

## Estado

Propuesta funcional derivada del modelo de perfiles y áreas aprobado. No autoriza migraciones, cambios de usuarios, despliegues ni modificaciones en producción.

## Objetivo

Definir permisos exactos por módulo, perfil, alcance y acción. Esta matriz será la fuente funcional para el futuro diseño técnico, las pruebas de autorización y la navegación visible.

## Documentos relacionados

- `docs/superpowers/specs/siio-profile-area-model.md`

## Perfiles

- **ADM:** Administrador.
- **GER:** Gerencia.
- **DIR:** Director.
- **COM:** Comercial.
- **COL:** Colaborador de área.
- **JUN:** Junta.
- **IA:** identidad técnica compartida de agentes.

## Leyenda

- **Todo:** alcance institucional completo.
- **Área:** solo áreas y subáreas asignadas.
- **Equipo comercial:** pipeline completo del equipo, con detalle restringido según esta matriz.
- **Propio:** registros cuyo responsable es la persona.
- **Asignado:** compromisos dirigidos expresamente a la persona.
- **Aprobado:** información publicada o validada para ese público.
- **Proponer:** crear un borrador que requiere validación superior.
- **Solicitar cierre:** marcar el trabajo como terminado y enviar a revisión; no cierra definitivamente.
- **No:** acción no permitida.

## Reglas transversales

1. Toda autorización se verifica en servidor. Ocultar un botón no constituye seguridad.
2. Lectura y escritura se autorizan por separado.
3. Área, subárea, agencia/región y permiso adicional son dimensiones independientes.
4. Un usuario con varias áreas recibe la unión de sus alcances explícitos, no acceso institucional completo.
5. Un Director nunca puede operar fuera de sus áreas asignadas.
6. Un Comercial puede consultar el pipeline general, pero solo puede abrir el detalle sensible y escribir sobre registros propios.
7. Exportar exige más autoridad que consultar en pantalla.
8. Preparar, recomendar o solicitar no equivale a aprobar.
9. Un responsable puede declarar terminado su trabajo, pero el cierre institucional corresponde a Gerencia o Administrador.
10. La Junta solo consume información aprobada.
11. La IA genera hallazgos, análisis y borradores; no recibe autoridad humana.
12. Toda escritura conserva actor, fecha, perfil, área, estado anterior y estado nuevo.
13. Las acciones sensibles deben guardar además motivo, evidencia o aprobación según corresponda.
14. Nómina en SIIO siempre es agregada. Ningún perfil de SIIO recibe salarios o expedientes individuales mediante esta matriz.
15. Los permisos se aplican por defecto de forma restrictiva: si una acción no está expresamente permitida, se deniega.

# Matriz por módulo

## 1. Navegación y sesión

| Acción | ADM | GER | DIR | COM | COL | JUN | IA |
|---|---|---|---|---|---|---|---|
| Iniciar sesión humana | Sí | Sí | Sí | Sí | Sí | Sí | No |
| Ver navegación gerencial | Todo | Todo | Área | No | No | Resumen + Junta | No UI |
| Ver navegación comercial | Todo | Todo | Solo si tiene área Comercial | Sí | No | No | No UI |
| Ver navegación de Licitaciones | Con permiso | Con permiso | Con permiso | Con permiso | No | No | API limitada |
| Ver navegación de Administración | Sí | No | No | No | No | No | No |
| Ver bandeja “Mis asignaciones” | Sí | Sí | Sí | Sí, si tiene asignaciones | Sí | No | No UI |

### Regla

La navegación visible se calcula con los mismos permisos que protege el servidor. No se mantienen excepciones por correo electrónico.

## 2. Usuarios, perfiles y permisos

| Acción | ADM | GER | DIR | COM | COL | JUN | IA |
|---|---|---|---|---|---|---|---|
| Listar usuarios | Todo | No | No | No | No | No | No |
| Crear usuario | Sí | No | No | No | No | No | No |
| Activar/desactivar usuario | Sí | No | No | No | No | No | No |
| Asignar perfil | Sí | No | No | No | No | No | No |
| Asignar áreas/subáreas | Sí | No | No | No | No | No | No |
| Asignar permiso Licitaciones | Sí | No | No | No | No | No | No |
| Restablecer acceso | Sí | No | No | No | No | No | No |
| Consultar su propio perfil | Sí | Sí | Sí | Sí | Sí | Sí | Identidad propia |

### Controles

- Administrador no puede eliminar su propia última cuenta administrativa activa.
- Cambios de perfil, área y permisos generan historial.
- Desactivar una cuenta no borra su trazabilidad histórica.

## 3. CRM Comercial — pipeline y oportunidades

| Acción | ADM | GER | DIR Comercial | Otros DIR | COM | COL | JUN | IA |
|---|---|---|---|---|---|---|---|---|
| Ver resumen del pipeline | Todo | Todo | Área Comercial | No | Equipo comercial | No | Solo indicador aprobado | Lectura autorizada |
| Ver lista de oportunidades | Todo | Todo | Área Comercial | No | Equipo comercial | No | No | Lectura autorizada |
| Ver cliente, etapa, valor, responsable y próxima acción | Todo | Todo | Área Comercial | No | Equipo comercial | No | No | Lectura autorizada |
| Ver contactos, notas, documentos e interacciones | Todo | Todo | Área Comercial | No | Propio | No | No | Solo campos autorizados |
| Crear oportunidad | Cualquier responsable | Cualquier responsable | Dentro de Comercial | No | Propia | No | No | No directa |
| Editar oportunidad | Todo | Todo | Área Comercial | No | Propia | No | No | No |
| Reasignar responsable | Sí | Sí | Dentro de Comercial | No | No | No | No | No |
| Registrar seguimiento | Todo | Todo | Área Comercial | No | Propio | No | No | Solo borrador sugerido |
| Cambiar etapa | Todo | Todo | Área Comercial | No | Propio | No | No | No |
| Marcar perdida | Todo | Todo | Área Comercial | No | Propio, con motivo | No | No | No |
| Aprobar venta o cierre comercial institucional | Sí | Sí | Sí, área Comercial | No | No | No | No | No |
| Exportar pipeline | Todo | Todo | Área Comercial | No | No | No | No | No |

### Alcance de lectura Comercial

“Pipeline completo” significa que un Comercial puede comparar el estado general del equipo. No habilita acceso a:

- correos y teléfonos de contactos ajenos;
- notas internas de otro asesor;
- documentos de otra oportunidad;
- interacciones detalladas de otro asesor;
- edición o exportación masiva.

## 4. Metas, indicadores y alertas comerciales

| Acción | ADM | GER | DIR Comercial | Otros DIR | COM | COL | JUN | IA |
|---|---|---|---|---|---|---|---|---|
| Ver metas del equipo | Todo | Todo | Área Comercial | No | No | No | Solo indicador aprobado | Lectura autorizada |
| Ver meta individual | Todo | Todo | Área Comercial | No | Propia | No | No | Lectura autorizada |
| Crear/modificar metas | Sí | Sí | Área Comercial | No | No | No | No | No |
| Ver alertas comerciales del equipo | Todo | Todo | Área Comercial | No | No | No | No | Lectura autorizada |
| Ver alertas propias | Sí | Sí | Sí | No | Sí | No | No | Lectura autorizada |
| Resolver alerta propia mediante seguimiento | Sí | Sí | Sí | No | Sí | No | No | No |
| Exportar metas/indicadores | Todo | Todo | Área Comercial | No | No | No | Solo informe aprobado | No |

## 5. Licitaciones — acceso general

El permiso adicional **Licitaciones** es obligatorio para todas las acciones del módulo, incluso para ADM, GER y DIR. El perfil define el nivel de autoridad; el permiso habilita la función.

| Acción | ADM + permiso | GER + permiso | DIR + permiso | COM + permiso | COL | JUN | IA |
|---|---|---|---|---|---|---|---|
| Ver Radar | Todo | Todo | Todo el módulo | Todo el módulo | No | No | Fuentes autorizadas |
| Sincronizar fuentes oficiales | Sí | Sí | Sí | Sí | No | No | Sí, ejecución técnica registrada |
| Ver seguimiento | Todo | Todo | Todo el módulo | Todo el módulo | No | No | Lectura autorizada |
| Seleccionar proceso para revisión | Sí | Sí | Sí | Sí | No | No | Proponer |
| Registrar nota/avance | Sí | Sí | Sí | Sí | No | No | Borrador |
| Cambiar responsable | Sí | Sí | Sí | No | No | No | No |
| Descartar proceso del Radar | Sí | Sí | Sí | Proponer descarte | No | No | Recomendar |
| Convertir a oportunidad | Asignar a cualquiera | Asignar a cualquiera | Asignar dentro de Comercial | Crear como propia | No | No | No |
| Exportar Radar/seguimiento | Sí | Sí | Sí | No | No | No | No |

### Regla de sincronización

Sincronizar fuentes actualiza datos públicos del Radar; no equivale a aprobar una oportunidad ni a enviar una propuesta.

## 6. Licitaciones — perfiles de búsqueda y perfil empresarial

| Acción | ADM + permiso | GER + permiso | DIR + permiso | COM + permiso | IA |
|---|---|---|---|---|---|
| Ver perfiles de búsqueda | Sí | Sí | Sí | Sí | Sí |
| Crear perfil de búsqueda personal | Sí | Sí | Sí | Sí | Sí, como borrador técnico |
| Crear perfil compartido institucional | Sí | Sí | Sí | No | No |
| Eliminar perfil propio | Sí | Sí | Sí | Sí | No |
| Eliminar perfil compartido | Sí | Sí | Sí | No | No |
| Ver ficha empresarial/RUP | Sí | Sí | Sí | Sí | Campos autorizados |
| Modificar ficha empresarial | Sí | Sí | Sí | No | Proponer extracción |
| Cargar RUP/documento corporativo | Sí | Sí | Sí | No | Procesar archivo cargado |
| Confirmar vigencia de información corporativa | Sí | Sí | Sí | No | No |

### Regla

La extracción automática de un documento no reemplaza la confirmación humana de vigencia, alcance o validez.

## 7. Licitaciones — expedientes y documentos

| Acción | ADM + permiso | GER + permiso | DIR + permiso | COM + permiso | IA |
|---|---|---|---|---|---|
| Ver expedientes | Todo | Todo | Todo el módulo | Propios/asignados | Metadatos autorizados |
| Ver documentos | Todo | Todo | Todo el módulo | Propios/asignados | Texto autorizado |
| Importar documentos oficiales | Sí | Sí | Sí | Propios/asignados | Sí, ejecución registrada |
| Cargar documentos complementarios | Sí | Sí | Sí | Propios/asignados | No |
| Generar análisis documental | Sí | Sí | Sí | Propios/asignados | Sí |
| Registrar nota al asistente | Sí | Sí | Sí | Propios/asignados | No |
| Emitir recomendación GO/NO GO | Sí | Sí | Sí | Proponer | Recomendar |
| Aprobar GO/NO GO | Sí | Sí | Sí | No | No |
| Crear Expediente de Oferta | Sí | Sí | Sí | Solicitar | Preparar borrador |
| Descartar oportunidad de licitación | Sí | Sí | Sí | Solicitar con motivo | Recomendar |
| Exportar expediente | Sí | Sí | Sí | Propio/asignado, sin datos restringidos | No |

### Reglas

- Convertir una licitación crea o enlaza una oportunidad; no aprueba la participación.
- GO/NO GO aprobado es el requisito para crear formalmente el Expediente de Oferta.
- Documentos oficiales deben importarse, leerse y analizarse antes de responder sobre SECOP II o ESU; la carga manual es recuperación.

## 8. SIIO — Resumen Ejecutivo

| Acción | ADM | GER | DIR | COM | COL | JUN | IA |
|---|---|---|---|---|---|---|---|
| Ver resumen institucional vivo | Todo | Todo | No | No | No | No | No UI |
| Ver resumen filtrado por áreas asignadas | Todo | Todo | Área | No | No | No | Lectura autorizada |
| Ver resumen aprobado para Junta | Sí | Sí | No | No | No | Sí | No |
| Ver indicadores financieros agregados | Todo | Todo | Solo DIR Financiera | No | No | Solo aprobados | Lectura autorizada |
| Ver nómina agregada | Todo | Todo | Solo DIR Gestión Humana | No | No | Solo indicador aprobado | Lectura autorizada |
| Ver indicador comercial agregado | Todo | Todo | Solo DIR Comercial | No | No | Solo aprobado | Lectura autorizada |
| Ver indicador operativo agregado | Todo | Todo | Solo DIR Operaciones | No | No | Solo aprobado | Lectura autorizada |
| Exportar resumen vivo | Sí | Sí | Área | No | No | No | No |
| Exportar resumen aprobado | Sí | Sí | No | No | No | Sí | No |

### Regla de Junta

El perfil Junta no consume el endpoint vivo de SIIO. Consulta una versión publicada e inmutable para el periodo correspondiente.

## 9. SIIO — Seguimiento Gerencial

| Acción | ADM | GER | DIR | COM | COL | JUN | IA |
|---|---|---|---|---|---|---|---|
| Ver todos los asuntos | Sí | Sí | No | No | No | No | Lectura autorizada |
| Ver asuntos del área | Sí | Sí | Área | No | No | No | Lectura autorizada |
| Ver asignaciones propias | Sí | Sí | Sí | Sí | Sí | No | No UI |
| Crear asunto oficial | Sí | Sí | Área | No | No | No | No |
| Crear hallazgo/borrador | Sí | Sí | Área | No | No | No | Sí |
| Editar asunto | Sí | Sí | Área | No | No | No | No |
| Asignar responsable | Sí | Sí | Dentro del área | No | No | No | No |
| Cambiar prioridad/fecha | Sí | Sí | Dentro del área | No | No | No | No |
| Registrar avance | Sí | Sí | Área | Asignado | Asignado | No | Borrador/evidencia técnica |
| Informar bloqueo | Sí | Sí | Área | Asignado | Asignado | No | Detectar/recomendar |
| Adjuntar evidencia | Sí | Sí | Área | Asignado | Asignado | No | Evidencia técnica autorizada |
| Marcar trabajo terminado | Sí | Sí | Área | Asignado | Asignado | No | No |
| Solicitar cierre | Sí | Sí | Área | Asignado | Asignado | No | Recomendar |
| Reabrir asunto | Sí | Sí | Área | No | No | No | No |
| Cerrar definitivamente | Sí | Sí | No | No | No | No | No |
| Eliminar asunto | No físico; anular | No físico; anular | No | No | No | No | No |
| Exportar seguimiento | Todo | Todo | Área | Solo comprobante propio | Solo comprobante propio | No | No |

### Flujo mínimo

```text
Hallazgo o borrador
→ revisión humana
→ asunto oficial
→ responsable y fecha
→ avances/evidencia
→ trabajo terminado
→ solicitud de cierre
→ validación Gerencia/Administrador
→ cierre definitivo
```

### Regla de cierre

El Director controla la ejecución de su área, pero el cierre definitivo institucional lo valida Gerencia o Administrador. Esto evita que quien ejecuta sea la única persona que certifique el resultado.

## 10. SIIO — Fuentes e inteligencia

| Acción | ADM | GER | DIR | COM | COL | JUN | IA |
|---|---|---|---|---|---|---|---|
| Ver catálogo completo de fuentes | Sí | Sí | No | No | No | No | Metadatos autorizados |
| Ver fuentes aprobadas del área | Sí | Sí | Área | No | No | No | Según agente |
| Ver restricciones de una fuente | Sí | Sí | Área | No | No | No | Sí |
| Proponer nueva fuente | Sí | Sí | Área | No | No | No | Sí |
| Registrar fuente como borrador | Sí | Sí | Área | No | No | No | Sí |
| Validar fuente | Sí | Sí | No | No | No | No | No |
| Activar/desactivar fuente | Sí | Sí | No | No | No | No | No |
| Cambiar nivel de visibilidad | Sí | Sí | No | No | No | No | No |
| Modificar restricciones | Sí | Sí | No | No | No | No | No |
| Consultar datos sensibles sin agregación | Según autorización explícita | Según autorización explícita | No por defecto | No | No | No | Solo procesamiento autorizado |
| Exportar catálogo | Sí | Sí | Área sin secretos | No | No | No | No |

### Estados de fuente

```text
Borrador
→ en validación
→ activa
→ suspendida
→ retirada
```

Ninguna fuente propuesta por Director o IA entra en producción sin validación de Gerencia o Administrador.

## 11. SIIO — Agentes

| Acción | ADM | GER | DIR | COM | COL | JUN | IA |
|---|---|---|---|---|---|---|---|
| Ver catálogo de agentes | Sí | Sí | Agentes de su área | No | No | No | Identidad propia |
| Ver historial de ejecuciones | Todo | Todo | Área | No | No | No | Propio |
| Solicitar análisis | Sí | Sí | Área | No | No | No | Ejecutar solicitud autorizada |
| Ejecutar acción de solo lectura | Sí | Sí | Solicitar en área | No | No | No | Sí, con registro |
| Activar/desactivar agente | Sí | Sí | No | No | No | No | No |
| Cambiar fuentes del agente | Sí | Sí | Proponer | No | No | No | No |
| Cambiar instrucciones/reglas | Sí | Sí | Proponer | No | No | No | No |
| Aprobar resultado como decisión | Sí | Sí | No | No | No | No | No |
| Contactar personas o sistemas externos | Requiere autorización específica | Requiere autorización específica | No por defecto | No | No | No | Solo con aprobación registrada |
| Ejecutar acción con costo | Requiere autorización vigente | Requiere autorización vigente | Solicitar | No | No | No | Solo con aprobación registrada |

### Trazabilidad obligatoria

Cada ejecución conserva:

- identidad técnica compartida;
- `agent_id` específico;
- versión de instrucciones;
- fuentes utilizadas;
- solicitante humano o disparador autorizado;
- costo estimado y real cuando aplique;
- resultado;
- aprobación humana posterior.

## 12. SIIO — Junta

| Acción | ADM | GER | DIR | COM | COL | JUN | IA |
|---|---|---|---|---|---|---|---|
| Ver borrador de Junta | Sí | Sí | No | No | No | No | Preparar borrador |
| Aportar información solicitada | Sí | Sí | Mediante asignación de área | Mediante asignación | Mediante asignación | No | Preparar evidencia |
| Editar borrador | Sí | Sí | No | No | No | No | No |
| Aprobar informe | Sí | Sí | No | No | No | No | No |
| Publicar versión para Junta | Sí | Sí | No | No | No | No | No |
| Ver versión publicada | Sí | Sí | No | No | No | Sí | No |
| Descargar versión publicada | Sí | Sí | No | No | No | Sí | No |
| Ver histórico publicado | Sí | Sí | No | No | No | Sí | No |
| Retirar publicación | Sí | Sí | No | No | No | No | No |

### Controles

- Una versión publicada es inmutable.
- Cualquier corrección crea una nueva versión.
- Publicar registra autor, aprobador, fecha y periodo.
- Retirar una publicación no borra el historial de auditoría.

## 13. Exportaciones

| Tipo de exportación | ADM | GER | DIR | COM | COL | JUN |
|---|---|---|---|---|---|---|
| Usuarios y permisos | Sí | No | No | No | No | No |
| Pipeline comercial | Todo | Todo | Área Comercial | No | No | No |
| Licitaciones | Con permiso | Con permiso | Con permiso | No | No | No |
| SIIO vivo | Todo | Todo | Área | No | No | No |
| Asignación individual | Sí | Sí | Sí | Propia | Propia | No |
| Informe aprobado de Junta | Sí | Sí | No | No | No | Sí |
| Fuentes | Sí | Sí | Área sin secretos | No | No | No |

Toda exportación registra usuario, filtros, alcance, fecha y formato.

# Mapeo de áreas iniciales

| Área | Subáreas iniciales | Dimensión adicional |
|---|---|---|
| Gerencia | Por definir posteriormente | — |
| Comercial | Seguridad Física; Tecnología; Licitaciones | — |
| Operaciones | Vigilancia Física; Seguridad Electrónica; Sistemas Integrados | Agencia/región |
| Financiera | Contabilidad; Tesorería; Cartera; Planeación y Presupuesto | — |
| Gestión Humana | Selección y Contratación; Nómina; Relaciones Laborales; Bienestar y Desarrollo; SST | — |
| Tecnología e Innovación | Infraestructura y Soporte; Aplicaciones, Datos e Integraciones; IA y Automatización; Innovación y Productos; Seguridad de la Información | — |

# Visibilidad de datos sensibles

## Niveles propuestos

1. **Público interno:** visible para cualquier usuario autenticado autorizado al módulo.
2. **Área:** visible únicamente para perfiles con alcance sobre el área.
3. **Gerencial:** Administrador y Gerencia.
4. **Junta aprobado:** versión expresamente publicada para Junta.
5. **Restringido:** acceso nominal adicional; no se obtiene solo por perfil o área.
6. **Procesamiento IA:** la IA puede procesar bajo autorización, pero no necesariamente mostrar el dato bruto a humanos sin permiso.

## Reglas

- Contactos comerciales ajenos son de nivel Área/Propio según pantalla.
- Nómina individual no forma parte de SIIO.
- Secretos, credenciales y tokens nunca se muestran mediante el CRM.
- Documentos de licitación pueden tener restricciones adicionales por expediente.
- El resumen de Junta se genera a partir de datos aprobados, no de acceso directo a fuentes vivas.

# Brechas frente al sistema actual

## Críticas

1. `admin`, `gerencia` y `director` comparten actualmente acceso SIIO completo mediante `requireSiioAccess`.
2. Los mismos tres perfiles pueden crear y modificar registros, fuentes y decisiones sin separar propuesta, aprobación o cierre.
3. SIIO bootstrap entrega todas las áreas, fuentes, decisiones, finanzas y nómina agregada a cualquier perfil gerencial.
4. Licitaciones usa `canViewTenders` como permiso único para lectura y casi todas las escrituras.
5. Existe una excepción de Licitaciones basada en correo electrónico.
6. No existen perfiles `colaborador` ni `junta`.
7. No existen asignaciones de múltiples áreas/subáreas por cuenta.
8. No existe publicación inmutable diferenciada para Junta.
9. No existe identidad técnica compartida de IA con `agent_id` obligatorio.

## Comerciales

1. El bootstrap actual filtra oportunidades para Comerciales y no permite lectura del pipeline completo.
2. La edición propia sí está protegida mediante `ensureOpportunityAccess`, pero la futura lista general deberá excluir datos sensibles ajenos.
3. El frontend permite que varios perfiles aparezcan como gestores de metas; el servidor restringe escritura a perfiles gerenciales.
4. Actualmente `director` puede modificar metas aunque el mensaje del servidor diga “gerencia/admin”. La matriz objetivo lo permite solo al Director Comercial.

## Licitaciones

1. Lectura, sincronización, perfiles de búsqueda, ficha empresarial, seguimiento, conversión y documentos dependen de un guard demasiado amplio.
2. Comercial con excepción por correo puede realizar acciones que en la matriz requieren Director, Gerencia o Administrador.
3. GO/NO GO, creación de expediente y descarte no están separados claramente entre solicitud y aprobación.
4. Los perfiles de búsqueda no distinguen personales de institucionales.

## SIIO y Junta

1. No hay alcance por área para Directores.
2. No hay bandeja limitada para Colaboradores.
3. Director puede escribir fuentes y decisiones con autoridad equivalente a Gerencia.
4. Los informes de Junta se consultan mediante el mismo acceso SIIO vivo.
5. No hay versionado/publicación para usuarios Junta.

# Requisitos técnicos derivados

Sin constituir todavía un plan de implementación, la matriz requiere como mínimo:

1. Catálogo de perfiles ampliado: `admin`, `gerencia`, `director`, `comercial`, `colaborador`, `junta`.
2. Catálogo de áreas y subáreas.
3. Relación muchos-a-muchos entre usuarios y áreas/subáreas.
4. Permisos adicionales, iniciando con Licitaciones.
5. Clasificación por área/subárea de registros SIIO, fuentes, decisiones y compromisos.
6. Asignaciones individuales para Colaboradores y otros responsables.
7. Estados separados para hallazgo, asunto, compromiso, solicitud de cierre y cierre.
8. Versiones publicadas de Junta separadas del SIIO vivo.
9. Identidad técnica de IA y campo `agent_id` obligatorio.
10. Historial de cambios y exportaciones.
11. Guards de servidor por acción, no solo por módulo.
12. Respuestas filtradas por perfil, área y visibilidad.
13. Pruebas negativas: cada perfil debe recibir `403` cuando intenta una acción no autorizada.

# Fuera de alcance de esta definición

- migraciones SQL;
- cambios de navegación;
- asignación de perfiles a usuarios reales;
- modificación de endpoints;
- despliegue;
- publicación;
- automatizaciones externas;
- creación del ciclo gerencial.

# Próximo paso

Preparar un plan de implementación por fases que preserve compatibilidad con los usuarios actuales:

1. modelo de datos y catálogo de permisos;
2. guards del servidor y pruebas;
3. navegación y pantallas por perfil;
4. migración controlada de usuarios existentes;
5. preview con cuentas de prueba;
6. QA por perfil;
7. autorización explícita antes de producción.
