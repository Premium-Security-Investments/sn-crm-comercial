// Mapeo medido contra el Avancys real (Odoo 14, producción, solo lectura) el 2026-10-29.
// Es el mismo que escribe la migración 0029 en `programacion.integraciones` (fila 'avancys'); una
// prueba verifica que no se separen. La base es la que manda en ejecución: esto sirve para el script
// de verificación y para saber, leyendo el repositorio, qué campo de Avancys alimenta cada dato.
import type { ConfigEntidad, ConfigModalidades, ConfigPuestos, FiltroLugar } from './odoo.ts';

export interface MapeoAvancys {
  tipo: string;
  medido_en: string;
  empleados: ConfigEntidad;
  clientes: ConfigEntidad;
  patrones: ConfigModalidades;
  puestos_avancys: ConfigPuestos;
  ciudades: Record<string, FiltroLugar>;
}

export const MAPEO_AVANCYS: MapeoAvancys = {
  tipo: 'odoo_jsonrpc',
  medido_en: '2026-10-29',
  empleados: {
    modelo: 'hr.employee',
    dominio: [],
    // Ojo: no se filtra por dominio sobre `identification_id`. Medido el 2026-10-29: los 3.133
    // empleados tienen documento al leerlos, pero `search_count([('identification_id','!=',False)])`
    // devuelve 2.908. La búsqueda sobre ese campo miente en esta instancia; se filtra al leer.
    campos: {
      documento: 'identification_id',
      nombre: 'name',
      cargo: 'job_id',
      telefono: 'cellphone',       // "Celular" (3.033 de 3.133); mobile_phone es "Work Mobile" (2.665)
      activo: 'active',
      fecha_ingreso: 'first_contract_date',
    },
    lugar: {
      desde: 'hr.contract',
      campos: { registro: 'employee_id', ciudad: 'work_city_id', grupo: 'subzone_id', estado: 'state' },
      estadoVigente: 'open',
    },
  },
  clientes: {
    modelo: 'res.partner',
    dominio: [['customer_rank', '>', 0]],
    campos: {
      nit: 'ref_num',              // el NIT vive aquí (1.432 de 1.439); `vat` solo lo tiene 1
      razon_social: 'name',
      activo: 'active',
    },
    lugar: { desde: 'propio', campos: { ciudad: 'city_id', grupo: 'state_id' } },
  },
  // El catálogo de patrones de turno: 542 modalidades, de toda la empresa (541 no declaran regional),
  // con su ciclo en `hr.roster.sequence` y el horario de cada día en `hr.roster.horario`.
  patrones: {
    modelo: 'hr.roster.modalidad',
    secuencias: 'hr.roster.sequence',
    horarios: 'hr.roster.horario',
  },
  // Los puestos. La ciudad no está en el puesto: está en la orden de servicio, porque en Avancys el
  // puesto es un objeto comercial. El cliente sale por el contrato y el centro de costo de la cuenta.
  puestos_avancys: {
    modelo: 'hr.roster.puesto',
    ordenes: 'project.service.order.line',
    contratos: 'project.project',
    terceros: 'res.partner',
    cuentas: 'account.analytic.account',
  },
  // Una ciudad de Programación es una AGENCIA, que es la unidad operativa que declara Avancys en
  // `hr.contract.subzone` (3.141 de 3.144 contratos). No es el municipio ni el departamento: la
  // agencia de Medellín maneja también Barranquilla y Valledupar, y la de Pereira maneja Cartago.
  // Se deja el departamento como respaldo —3 contratos no traen agencia— y el departamento del
  // cliente, que es el vocabulario del cargue de clientes.
  ciudades: {
    pereira: { grupos: ['AGENCIA PEREIRA', 'RISARALDA', 'Risaralda (CO)'], ciudades: [] },
    medellin: { grupos: ['AGENCIA MEDELLIN', 'ANTIOQUIA', 'Antioquia (CO)'], ciudades: [] },
    bogota: { grupos: ['AGENCIA BOGOTA', 'CUNDINAMARCA', 'Cundinamarca (CO)'], ciudades: [] },
    // Cali y Manizales entraron el 2026-10-30: 339 y 83 personas con contrato vigente en Avancys.
    cali: { grupos: ['AGENCIA CALI', 'VALLE DEL CAUCA', 'Valle Del Cauca (CO)'], ciudades: [] },
    manizales: { grupos: ['AGENCIA MANIZALES', 'CALDAS', 'Caldas (CO)'], ciudades: [] },
  },
};
