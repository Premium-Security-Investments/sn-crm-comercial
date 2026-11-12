#!/usr/bin/env node
// Qué puede leer hoy nuestro usuario de Avancys, y qué no.
//
// El 2026-10-29 se midió que cinco modelos estaban denegados y se pidió el permiso. Nadie volvió
// a medir. Este script responde esa pregunta preguntándole a Odoo, no suponiendo.
//
// Solo lectura: search_count y fields_get. No escribe ni modifica nada en Avancys.
// Nunca imprime la clave ni el usuario.
//
// Credenciales por entorno:
//   AVANCYS_ODOO_URL  AVANCYS_ODOO_DATABASE  AVANCYS_ODOO_USERNAME  AVANCYS_ODOO_API_KEY
//
// Uso:  node --env-file=<archivo> scripts/avancys-que-podemos-ver.mjs
//
// Con --env-file lo lee Node con su propio lector de .env. No cargar el archivo con `. archivo`
// en bash: deja comillas y escapes como texto y la dirección deja de ser válida.

import { configuracionDeAvancys } from '../avancys-odoo-lectura.js';

let config;
try {
  config = configuracionDeAvancys();
} catch (error) {
  // La dirección de Odoo no es secreta (está en los handoffs); se muestra entera para ver qué
  // carácter sobra: un salto de línea, una comilla o un espacio que dejó el archivo .env.
  console.error(`La dirección de Avancys no es válida (${error.codigo || error.message}).`);
  console.error(`Valor recibido: ${JSON.stringify(process.env.AVANCYS_ODOO_URL)}`);
  process.exit(2);
}
if (!config) {
  console.error('Avancys no está configurado: faltan AVANCYS_ODOO_* en el entorno.');
  process.exit(2);
}

// Lo que la Torre ya usa: confirmar que sigue abierto.
const EN_USO = [
  ['res.partner', 'clientes'],
  ['hr.employee', 'empleados'],
  ['hr.contract', 'contratos laborales'],
  ['project.service.order.line', 'líneas de orden de servicio (devengado)'],
  ['account.move', 'facturas (facturación y cartera)'],
  ['hr.roster.puesto', 'puestos'],
  ['account.analytic.account', 'cuentas analíticas (centro de costo)'],
  ['project.project', 'contratos de proyecto'],
];

// Los modelos pedidos el 2026-10-29 además del campo clave.
const PEDIDOS = [
  ['hr.tarifario', 'tarifas'],
  ['project.profitability.report', 'rentabilidad que calcula Odoo'],
  ['hr.contract.risk', 'riesgo del contrato'],
  ['hr.roster.modalidad', 'modalidades de turno'],
];

// El que de verdad desbloquea rentabilidad por cliente.
const CLAVE = { modelo: 'hr.contract', campo: 'analytic_distribution', para: 'cómo se reparte el costo de cada empleado entre las cuentas analíticas' };

let serie = 0;
async function rpc(service, method, args) {
  const respuesta = await fetch(`${config.origen}/jsonrpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++serie, params: { service, method, args } }),
  });
  if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
  const cuerpo = await respuesta.json();
  if (cuerpo.error) {
    const dato = cuerpo.error.data || {};
    throw new Error(`${dato.name || cuerpo.error.message}: ${String(dato.message || '').split('\n')[0].slice(0, 160)}`);
  }
  return cuerpo.result;
}

const uid = await rpc('common', 'login', [config.database, config.username, config.clave]);
if (!uid) {
  console.error('No autenticó: revise el usuario y la clave de API.');
  process.exit(1);
}
const ejecutar = (modelo, metodo, args, kwargs = {}) =>
  rpc('object', 'execute_kw', [config.database, uid, config.clave, modelo, metodo, args, kwargs]);

console.log(`Avancys ${config.origen} · base ${config.database}`);
console.log(`Medido el ${new Date().toISOString().slice(0, 16)}Z\n`);

async function probar(modelo, para) {
  try {
    const n = await ejecutar(modelo, 'search_count', [[]]);
    console.log(`  PERMITIDO  ${modelo.padEnd(30)} ${String(n).padStart(7)} filas  ${para}`);
  } catch (error) {
    console.log(`  DENEGADO   ${modelo.padEnd(30)}                ${para}`);
    console.log(`             ↳ ${error.message}`);
  }
}

console.log('Lo que la Torre ya usa:');
for (const [modelo, para] of EN_USO) await probar(modelo, para);

console.log('\nPedidos el 2026-10-29:');
for (const [modelo, para] of PEDIDOS) await probar(modelo, para);

console.log('\nEl que desbloquea rentabilidad por cliente:');
try {
  const campos = await ejecutar(CLAVE.modelo, 'fields_get', [[CLAVE.campo]], { attributes: ['string', 'type'] });
  if (!campos?.[CLAVE.campo]) {
    console.log(`  DENEGADO   ${CLAVE.modelo}.${CLAVE.campo}`);
    console.log('             ↳ el campo no aparece para este usuario; lo abre el grupo Human Resources / Jefe de Nómina.');
  } else {
    const total = await ejecutar(CLAVE.modelo, 'search_count', [[]]);
    const llenos = await ejecutar(CLAVE.modelo, 'search_count', [[[CLAVE.campo, '!=', false]]]);
    console.log(`  PERMITIDO  ${CLAVE.modelo}.${CLAVE.campo}`);
    console.log(`             ↳ diligenciado en ${llenos} de ${total} contratos. Ya se puede calcular rentabilidad por cliente.`);
  }
} catch (error) {
  console.log(`  DENEGADO   ${CLAVE.modelo}.${CLAVE.campo}`);
  console.log(`             ↳ ${error.message}`);
}
console.log(`             ↳ ${CLAVE.para}`);
console.log('\nNada se escribió en Avancys.');
