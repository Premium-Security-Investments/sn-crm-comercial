# Diseño: acceso explícito a módulos por usuario

**Fecha:** 2026-07-16  
**Fase:** A / Task 7  
**Estado:** aprobado conceptualmente por Juan; pendiente revisión de este documento antes de implementar

## 1. Objetivo

Permitir que el administrador que crea o edita un usuario defina explícitamente qué módulos y pestañas puede abrir. Crear un usuario no concede módulos por defecto.

El sistema debe aplicar la misma decisión en cuatro capas:

1. formulario de usuarios;
2. navegación visible;
3. acceso por URL directa;
4. endpoints backend asociados.

## 2. Decisiones aprobadas

- **Denegado por defecto:** un usuario nuevo no recibe módulos automáticamente.
- **Control administrativo explícito:** el administrador selecciona módulos durante creación o edición.
- **Rol como límite de seguridad:** el rol no concede módulos automáticamente, pero impide combinaciones peligrosas o incoherentes.
- **Áreas separadas de módulos:** los módulos determinan qué interfaz se abre; las áreas y subáreas determinan el alcance de datos.
- **Identidad inmutable:** editar módulos no cambia el correo ni el vínculo Auth UID ↔ perfil.
- **Sin excepciones por email:** ningún correo concede acceso implícito.
- **Desactivación global:** `active=false` bloquea todos los módulos aunque existan asignaciones.

## 3. Catálogo inicial de módulos

Se reutilizará `psi_access_permissions` como catálogo único de capacidades asignables. Se añadirán estos códigos:

| Código | Etiqueta en panel | Rutas principales |
|---|---|---|
| `modulo_siio_gerencial` | SIIO Gerencial | `#/siio` |
| `modulo_vig_ia` | Vig-IA | `#/vig-ia` |
| `modulo_dashboard_comercial` | Dashboard Comercial | `#/dashboard2` |
| `modulo_alertas_comerciales` | Alertas Comerciales | `#/alerts` |
| `modulo_oportunidades` | Oportunidades | `#/opportunities`, detalle, creación y edición |
| `modulo_metas` | Metas y Cumplimiento | `#/goals` |
| `licitaciones` | Licitaciones | `#/tenders` |
| `modulo_usuarios` | Usuarios y Permisos | `#/users` |

`licitaciones` conserva su código actual porque ya protege navegación y operaciones del módulo. Las acciones sensibles dentro de Licitaciones siguen limitadas adicionalmente por la matriz central y el rol.

No se crearán plantillas de permisos en esta entrega. Podrán añadirse después de observar combinaciones reales durante el piloto.

## 4. Límites por rol

El administrador solo podrá seleccionar módulos compatibles con el rol objetivo:

| Rol | Módulos elegibles |
|---|---|
| `admin` | todos |
| `gerencia` | SIIO, Vig-IA, Dashboard Comercial, Alertas, Oportunidades, Metas, Licitaciones |
| `director` | SIIO, Vig-IA, Dashboard Comercial, Alertas, Oportunidades, Metas, Licitaciones, sujeto a áreas cuando corresponda |
| `comercial` | Alertas, Oportunidades, Metas, Licitaciones |
| `colaborador` | Alertas, Oportunidades y Metas cuando la matriz central permita el alcance requerido |
| `junta` | sin módulos operativos en esta entrega; sus vistas ejecutivas se habilitarán cuando exista una ruta de Junta gobernada |

`modulo_usuarios` requiere simultáneamente rol `admin` y permiso explícito. Un permiso almacenado que sea incompatible con el rol se considera denegado y el backend rechazará nuevos intentos de guardarlo.

## 5. Migración y compatibilidad

Se preparará una migración nueva posterior a 020.

La migración:

1. inserta los códigos nuevos en `psi_access_permissions`;
2. asigna a perfiles existentes únicamente los módulos que hoy ya pueden ver según su rol y configuración;
3. conserva `licitaciones` solo donde ya esté asignado explícitamente;
4. garantiza `modulo_usuarios` para administradores existentes, evitando bloquear el panel;
5. no asigna módulos automáticamente a perfiles creados después de la migración;
6. registra el cambio mediante la infraestructura de auditoría existente cuando el administrador edite un perfil.

El backfill es de compatibilidad, no una regla permanente basada en rol.

## 6. Formulario de administración

El formulario se organiza en cuatro bloques:

### Identidad

- nombre;
- correo;
- rol;
- activo/inactivo;
- invitación o restablecimiento de acceso.

### Módulos y pestañas

- lista de casillas obtenida desde el catálogo del servidor;
- solo se muestran o habilitan opciones compatibles con el rol;
- cambiar el rol limpia selecciones incompatibles antes de guardar;
- usuario nuevo inicia con todas las casillas desmarcadas.

### Áreas y subáreas

Se conserva el selector actual de Gerencia, Comercial, Operaciones, Financiera, Gestión Humana y Tecnología e Innovación con sus subáreas.

### Resumen antes de guardar

El formulario muestra de forma legible:

- estado;
- rol;
- módulos seleccionados;
- áreas y subáreas seleccionadas.

No se añade un wizard ni plantillas en esta entrega.

## 7. Autorización y flujo de datos

### Fuente de verdad

`getAuthContext` seguirá derivando desde servidor las áreas y los permisos del perfil autenticado. El cliente nunca podrá declarar sus propios permisos.

### Matriz central

`access-control.js` incorporará acciones explícitas para cada módulo. La decisión requiere:

1. identidad humana activa;
2. rol compatible;
3. permiso de módulo presente;
4. alcance de área cuando la acción acceda a datos acotados.

### Navegación

`navPermissions.ts` dejará de usar roles como concesión automática. Cada elemento se filtra mediante la capacidad equivalente. Los grupos vacíos no se muestran.

### URL directa

`canAccessRoute` utilizará la misma capacidad que el elemento de navegación. Una ruta denegada llevará a una vista de acceso no autorizado y no renderizará el módulo solicitado.

### Backend

Los endpoints de entrada de cada módulo usarán `requireAction`. Ocultar el menú nunca será el único control.

Para endpoints compartidos, la autorización se aplicará a la acción concreta y al recurso, sin crear guards duplicados.

## 8. Fallos y recuperación

- Catálogo no disponible: el formulario falla cerrado y no permite guardar.
- Permiso desconocido: petición rechazada con 400.
- Combinación rol–módulo inválida: petición rechazada con 400.
- Perfil inactivo: todo acceso operativo denegado.
- Actualización concurrente: se conserva el control transaccional y de versión de Task 6.
- Error parcial: la transacción revierte perfil, áreas y permisos juntos.
- El administrador no puede desactivarse, quitarse su rol admin ni retirar su propio `modulo_usuarios`.

## 9. Pruebas TDD

### Matriz de capacidades

- usuario activo + módulo compatible: permitido;
- mismo rol sin módulo: denegado;
- módulo presente pero rol incompatible: denegado;
- perfil inactivo: denegado;
- email histórico sin permiso: denegado;
- permiso desconocido: denegado.

### Administración

- usuario nuevo inicia sin módulos;
- administrador puede asignar y retirar módulos;
- cambio de rol elimina módulos incompatibles;
- autobloqueo administrativo rechazado;
- actualización conserva identidad Auth y correo;
- transacción revierte ante error.

### Navegación y rutas

- solo aparecen elementos permitidos;
- grupos vacíos desaparecen;
- URL directa sin permiso queda bloqueada;
- Oportunidades protege detalle, creación y edición con la misma familia de capacidad;
- navegación y backend usan los mismos códigos.

### Migración PGlite

- catálogo insertado;
- backfill compatible para perfiles existentes;
- perfiles nuevos sin concesión automática;
- grants permanecen backend-only;
- rollback no reintroduce accesos implícitos inseguros.

### Regresión

- suite completa;
- build;
- paridad de backends;
- checks SIIO;
- revisión independiente;
- QA visual del panel y de perfiles representativos.

## 10. Criterios de aceptación del piloto

1. Juan puede crear un usuario activo o inactivo.
2. Juan puede seleccionar exactamente sus módulos elegibles y áreas.
3. Un módulo desmarcado no aparece, no abre por URL y no responde por API.
4. Retirar un módulo surte efecto en la siguiente carga autenticada sin alterar identidad ni datos.
5. Un usuario inactivo no puede operar.
6. El administrador conserva acceso al panel y no puede autobloquearse.
7. No existen concesiones por email ni módulos automáticos para usuarios nuevos.
8. Tests, build, migraciones aisladas y QA pasan antes del preview.

## 11. Fuera de alcance

- plantillas de permisos;
- administración de roles personalizados;
- interfaz para crear nuevos códigos de módulo;
- permisos por registro individual fuera de la matriz existente;
- despliegue productivo sin preview y autorización explícita de Juan.
