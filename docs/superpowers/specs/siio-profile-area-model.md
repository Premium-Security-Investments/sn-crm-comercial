# Modelo funcional de perfiles y áreas — CRM / SIIO

## Estado

Definición funcional aprobada por Juan Botero. Este documento no autoriza cambios en producción, migraciones ni asignación de perfiles a usuarios existentes.

## Objetivo

Definir quién usa el CRM/SIIO, qué alcance general tiene y cómo se clasifica la información institucional antes de diseñar el ciclo de hallazgos, decisiones, compromisos y cierres.

## Principios aprobados

1. Perfil, área, subárea y permiso adicional son conceptos diferentes.
2. Una cuenta puede tener una o varias áreas explícitamente asignadas.
3. Las áreas pueden tener subáreas opcionales.
4. El alcance por área se aplica tanto a lectura como a escritura.
5. Administrador conserva autoridad gerencial completa además de la administración técnica.
6. Gerencia tiene autoridad empresarial transversal, pero no administra usuarios.
7. Los agentes de IA no utilizan perfiles humanos.
8. Licitaciones es un permiso adicional que puede combinarse con perfiles humanos.
9. Auditoría queda prevista para una fase posterior.
10. La primera etapa utiliza únicamente seis áreas institucionales.

## Perfiles humanos aprobados

### 1. Administrador

**Alcance:** toda la empresa.

Puede:

- administrar usuarios y permisos;
- consultar toda la información del CRM/SIIO;
- registrar y modificar asuntos gerenciales;
- aprobar decisiones;
- asignar responsables;
- validar cierres;
- preparar y aprobar informes de Junta.

La autoridad técnica y gerencial permanecen unidas para este perfil.

### 2. Gerencia

**Alcance:** toda la empresa.

Puede:

- consultar todas las áreas;
- ver el consolidado institucional;
- consultar información financiera y nómina agregada;
- crear y modificar asuntos;
- asignar responsables;
- aprobar decisiones;
- validar cierres;
- consultar fuentes autorizadas;
- preparar y aprobar contenido para Junta.

No puede:

- crear o desactivar usuarios;
- asignar perfiles;
- modificar permisos técnicos.

### 3. Director

**Alcance:** únicamente las áreas y subáreas explícitamente asignadas.

Puede, dentro de su alcance:

- consultar indicadores y hallazgos;
- crear y gestionar asuntos;
- asignar compromisos;
- supervisar responsables;
- actualizar avances;
- adjuntar evidencia;
- solicitar o validar cierres según la futura matriz de permisos.

No puede:

- consultar información de áreas no asignadas;
- modificar asuntos de otras áreas;
- ver fuentes restringidas de otras áreas;
- administrar usuarios.

Una cuenta puede tener una o varias áreas asignadas sin recibir acceso general de Gerencia.

### 4. Comercial

**Lectura:** pipeline comercial completo del equipo.

**Escritura:** únicamente clientes, oportunidades y seguimientos propios.

Puede:

- consultar todas las oportunidades del equipo;
- consultar cliente, etapa, valor, responsable y próxima acción;
- crear oportunidades propias;
- modificar oportunidades asignadas a él;
- registrar seguimientos sobre sus oportunidades;
- consultar sus propias metas y cumplimiento.

No puede:

- modificar oportunidades de otro comercial;
- reasignar responsables;
- modificar metas;
- acceder al SIIO Gerencial;
- consultar finanzas, nómina u otras áreas.

El Director Comercial gestiona el consolidado y los registros del área Comercial.

### 5. Colaborador de área

**Alcance:** únicamente compromisos y asignaciones dirigidos a la persona.

Puede:

- consultar sus asignaciones;
- registrar avances;
- informar bloqueos;
- adjuntar evidencia;
- solicitar revisión o cierre.

No puede:

- acceder al dashboard gerencial;
- consultar asuntos de otras personas;
- consultar toda la información de su área;
- crear decisiones;
- asignar trabajo;
- cerrar definitivamente asuntos;
- consultar finanzas, nómina o Junta salvo la información mínima incluida en su asignación.

No se crea un perfil intermedio de Analista de área en la primera etapa.

### 6. Junta

**Tipo:** solo lectura.

Puede consultar:

- Resumen Ejecutivo;
- indicadores institucionales autorizados;
- informes de Junta aprobados;
- histórico de informes aprobados.

No puede consultar:

- Seguimiento Gerencial;
- Fuentes e inteligencia;
- comentarios de trabajo;
- borradores de decisiones;
- evidencia interna;
- información todavía no aprobada.

No puede realizar escrituras ni acciones operativas.

### Perfil diferido: Auditor

No se implementa en la primera etapa. Queda previsto para una fase de Auditoría, Control Interno, Riesgos, Calidad o Cumplimiento.

## Identidad técnica de IA

Todos los agentes comparten una sola identidad técnica de IA, separada de las cuentas humanas.

Cada acción debe conservar obligatoriamente:

- código del agente, por ejemplo `AGT-001`;
- nombre del agente;
- acción ejecutada;
- fuente consultada;
- fecha y hora;
- resultado;
- persona que aprobó posteriormente, cuando aplique.

La identidad técnica de IA no puede recibir autoridad humana para:

- aprobar decisiones;
- cerrar asuntos;
- publicar informes;
- modificar permisos;
- contactar personas;
- ejecutar acciones sensibles sin aprobación.

## Permiso adicional: Licitaciones

Licitaciones no es un perfil exclusivo. Es un permiso adicional que puede combinarse con:

- Comercial;
- Director;
- Gerencia;
- Administrador.

Este permiso reemplazará las excepciones basadas directamente en correos electrónicos. La futura matriz técnica deberá separar las acciones de consulta, seguimiento, expediente y conversión.

## Modelo de clasificación institucional

Cada registro podrá utilizar:

- área principal obligatoria;
- subárea opcional;
- agencia o región cuando corresponda;
- permisos adicionales independientes.

Las agencias no se tratarán como áreas institucionales.

## Áreas iniciales aprobadas

### 1. Gerencia

Responsable de:

- estrategia;
- gobierno del SIIO;
- Junta;
- proyectos corporativos;
- decisiones interáreas.

Tendrá subáreas internas que se definirán en una fase posterior.

### 2. Comercial

Subáreas:

- Seguridad Física;
- Tecnología;
- Licitaciones.

Normalización prevista:

- `Comercial Vigilancia` → Comercial / Seguridad Física;
- `Comercial Electrónica` → Comercial / Tecnología;
- `Licitación Pública` → Comercial / Licitaciones.

Licitaciones sigue siendo además un permiso funcional independiente.

### 3. Operaciones

Subáreas:

- Vigilancia Física;
- Seguridad Electrónica;
- Sistemas Integrados.

Agencia o región se maneja como dimensión separada, por ejemplo:

- Bogotá;
- Cali;
- Manizales;
- Medellín.

Ejemplo de clasificación:

```text
Área: Operaciones
Subárea: Vigilancia Física
Agencia: Medellín
```

### 4. Financiera

Subáreas:

- Contabilidad;
- Tesorería;
- Cartera;
- Planeación y Presupuesto.

`Contabilidad` deja de representar por sí sola toda la función financiera.

### 5. Gestión Humana

Subáreas:

- Selección y Contratación;
- Nómina;
- Relaciones Laborales;
- Bienestar y Desarrollo;
- Seguridad y Salud en el Trabajo — SST.

La nómina visible en SIIO se mantiene exclusivamente agregada. Está prohibido exponer nombres, cédulas, salarios individuales, datos bancarios o expedientes personales.

### 6. Tecnología e Innovación

Subáreas:

- Infraestructura y Soporte;
- Aplicaciones, Datos e Integraciones;
- Inteligencia Artificial y Automatización;
- Innovación y Productos;
- Seguridad de la Información.

Diferencia funcional:

- Comercial / Tecnología vende soluciones tecnológicas.
- Tecnología e Innovación construye, opera, integra y gobierna tecnología y productos.

## Áreas diferidas

No se diseñan ni implementan en la primera etapa:

- Jurídica y Cumplimiento;
- Riesgos y Calidad;
- Compras, Dotación y Activos;
- Auditoría y Control Interno.

Se incorporarán cuando exista una necesidad operativa, fuente y responsable real.

## Brechas frente al sistema actual

El sistema actual solo maneja principalmente:

- `admin`;
- `director`;
- `comercial`;
- `gerencia` en código, sin usuarios activos al momento de esta definición.

Brechas conocidas:

1. `admin`, `gerencia` y `director` comparten hoy permisos amplios de lectura y escritura SIIO.
2. No existe alcance por área o subárea.
3. No existe perfil Colaborador.
4. No existe perfil Junta.
5. Comercial actualmente no implementa exactamente lectura de pipeline completo con escritura solo propia.
6. Licitaciones depende parcialmente de una excepción por correo.
7. No existe identidad técnica compartida de IA con `agent_id` obligatorio.
8. Los endpoints SIIO no separan todavía lectura, creación, aprobación, actualización y cierre.

## Próximo trabajo funcional

Convertir este modelo aprobado en una matriz exacta por módulo y acción:

- ver;
- crear;
- editar;
- asignar;
- aprobar;
- cerrar;
- exportar;
- administrar.

Después de aprobar esa matriz se podrá diseñar una migración, compatibilidad con usuarios actuales, pruebas, preview y plan de adopción. Ninguna de esas acciones está autorizada por este documento.