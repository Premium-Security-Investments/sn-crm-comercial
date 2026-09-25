# AGT-003 — Canal e intención del próximo seguimiento

**Fecha:** 2026-09-25  
**Estado:** Diseño aprobado; implementación pendiente  
**Producto:** Vig-IA, copiloto de oportunidades comerciales privadas en SIIO

## Decisión

Antes de generar un próximo seguimiento, el comercial debe seleccionar el canal y puede indicar el objetivo específico del contacto. No se crea una pestaña adicional.

El diseño reemplaza el botón directo de generación por una preparación breve:

1. **¿Cómo será el próximo contacto?** — selección obligatoria y sin valor preseleccionado: `WhatsApp` o `Correo`.
2. **¿Qué necesita lograr con este contacto?** — texto libre opcional, máximo 500 caracteres.
3. **Generar seguimiento** — deshabilitado hasta seleccionar el canal.

No se mostrará la etiqueta: “Piloto interno: revise antes de usar; no actualiza SIIO ni envía mensajes”. La revisión humana seguirá indicada de forma contextual junto al resultado.

## Alcance funcional

- Disponible en cada oportunidad comercial privada que el usuario pueda consultar, sujeto a los permisos vigentes y a que el engine esté habilitado.
- WhatsApp: genera un mensaje editable, sin asunto; acción `Copiar WhatsApp` copia sólo el mensaje.
- Correo: genera asunto y cuerpo editables; acción `Copiar correo` copia ambos.
- El canal y la intención quedan asociados a una generación concreta.
- `Cambiar preparación` descarta localmente el resultado anterior y vuelve al formulario conservando los datos para edición.
- Un error o reintento conserva canal e intención.
- Cambiar de oportunidad limpia formulario, resultado y errores para impedir contaminación entre casos.

## Límite de autoridad

“Sin escritura ni comunicación externa” es un control del sistema, no una etiqueta obligatoria de interfaz. Significa que Vig-IA:

- no modifica campos ni etapa de la oportunidad;
- no crea actividades, interacciones o seguimientos en SIIO;
- no envía correo ni WhatsApp;
- no contacta al cliente.

El comercial sí puede editar, copiar o descartar el borrador. Envío directo o registro automático serían capacidades posteriores con autorización, permisos y diseño independientes.

## Contrato

La solicitud cerrada de generación debe incluir:

- `opportunity_id`: obligatorio;
- `contact_channel`: obligatorio, enum `whatsapp | email`;
- `commercial_intent`: opcional, recortado, máximo 500 caracteres.

No existe canal por defecto ni fallback silencioso.

El request interno del agente debe preservar canal e intención. La intención es una instrucción del comercial, no un hecho del CRM y no puede utilizarse como evidencia.

La respuesta identifica el canal:

- `email`: asunto no vacío y cuerpo no vacío;
- `whatsapp`: asunto `null` y cuerpo no vacío.

Frontend, endpoint, contratos, validadores, prompt y presentación deben publicarse juntos para evitar incompatibilidades parciales. No requiere migración de base de datos.

## Flujo

1. El comercial abre una oportunidad privada.
2. Selecciona WhatsApp o Correo.
3. Opcionalmente explica qué necesita lograr.
4. La UI valida y envía la solicitud.
5. El backend autentica, autoriza, carga la oportunidad y sus interacciones permitidas, construye el snapshot y llama al engine gobernado.
6. El proveedor recibe canal e intención claramente separados de los hechos SIIO.
7. La respuesta se valida contra el contrato.
8. La UI presenta un brief y borrador ajustados al canal.
9. El comercial edita o copia; no ocurre envío ni escritura automática.

## Errores y privacidad

- Canal ausente: impedir generación y mostrar validación junto al selector.
- Intención mayor a 500 caracteres: impedir generación y mostrar contador/límite.
- Timeout, engine deshabilitado, autorización o contrato inválido: conservar la preparación y permitir reintento cuando corresponda.
- No agregar persistencia del texto libre.
- La telemetría nueva registra únicamente canal y `intent_present`; no duplica el texto libre en logs nuevos.
- La intención sí forma parte del input enviado al modelo gobernado.

## Accesibilidad y móvil

- Selector operable por teclado y con nombres accesibles.
- Estado no comunicado sólo mediante color.
- Foco de error visible.
- Controles y borrador utilizables en pantallas móviles.

## Pruebas requeridas

### Contrato y backend

- rechazo de canal ausente o desconocido;
- aceptación de `whatsapp` y `email`;
- normalización y límite de intención;
- cuerpo cerrado sin propiedades adicionales;
- propagación exacta de canal e intención;
- separación entre instrucción comercial y evidencia CRM;
- respuesta condicional: asunto requerido sólo en correo y `null` en WhatsApp;
- permanencia de `crm_write_allowed=false` y `external_send_allowed=false`;
- autenticación, autorización y engine deshabilitado continúan fail-closed.

### Frontend

- no hay canal preseleccionado;
- botón deshabilitado hasta elegir canal;
- payload correcto por canal y con/sin intención;
- WhatsApp no muestra asunto y copia sólo el cuerpo;
- correo muestra y copia asunto/cuerpo;
- errores y reintentos conservan preparación;
- `Cambiar preparación` invalida el resultado anterior;
- cambio de oportunidad limpia estado;
- no aparece la etiqueta descartada;
- teclado, nombres accesibles y layout móvil.

## Criterios de aceptación

1. Cada generación exige una selección explícita de WhatsApp o correo.
2. La intención es opcional, editable y limitada a 500 caracteres.
3. El resultado y la acción de copiar se adaptan al canal.
4. No existe envío, contacto externo ni mutación automática de SIIO.
5. No aparece la etiqueta de piloto descartada.
6. No hay defaults o degradaciones silenciosas.
7. No hay migración ni nueva persistencia de la intención.
8. La suite AGT-003 y las pruebas nuevas quedan GREEN.
9. Una revisión independiente Sonnet cierra el bloque local.
10. El cambio queda preparado para todas las oportunidades privadas autorizadas, pero deploy y activación del engine requieren un gate humano separado.

## Fuera de alcance

- enviar WhatsApp o correo desde SIIO;
- integraciones con proveedores de mensajería;
- registrar automáticamente la interacción;
- una pestaña genérica para cualquier tarea;
- feedback estructurado sobre la calidad del brief;
- cambios de modelo, costo, concurrencia o límite diario;
- deploy, activación del engine o acciones productivas.
