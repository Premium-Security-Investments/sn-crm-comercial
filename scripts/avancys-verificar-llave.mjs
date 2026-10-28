#!/usr/bin/env node
// Verifica la llave puesto↔cliente contra el Avancys real. No contra un doble: contra Odoo.
//
// El conector financiero del 2026-10-10 quedó en un cajón con 22 pruebas en verde porque nunca
// tocó un Odoo de verdad. Este script existe para que eso no se repita: imprime lo que midió, con
// fecha, para que quede en la evidencia.
//
// Credenciales por entorno, nunca por archivo ni por parámetro:
//   AVANCYS_ODOO_URL  AVANCYS_ODOO_DATABASE  AVANCYS_ODOO_USERNAME  AVANCYS_ODOO_API_KEY
//   AVANCYS_ODOO_COMPANY_ID
//
// Uso:  node scripts/avancys-verificar-llave.mjs <codigo-de-puesto> <nit-del-cliente>

import { crearLectorAvancys } from '../avancys-odoo-lectura.js';

const lector = crearLectorAvancys();
if (!lector) {
  console.error('Avancys no está configurado: faltan AVANCYS_ODOO_* en el entorno.');
  process.exit(2);
}

const [codigo, nit] = process.argv.slice(2);
if (!codigo || !nit) {
  console.error('Uso: node scripts/avancys-verificar-llave.mjs <codigo-de-puesto> <nit-del-cliente>');
  process.exit(2);
}

console.log(`Avancys: ${lector.origen} · base ${lector.database}`);
console.log(`Verificación UTC: ${new Date().toISOString()}`);

let fallos = 0;

try {
  console.log(`\n== del puesto al cliente · código "${codigo}" ==`);
  const puesto = await lector.clienteDelPuesto({ codigo });
  if (!puesto.encontrado) {
    console.log('  no encontrado');
    fallos += 1;
  } else {
    console.log(`  puestos con ese código: ${puesto.total} · corte ${puesto.as_of}`);
    for (const fila of puesto.puestos) {
      console.log(`  - puesto ${fila.puesto_id} · centro de costo ${fila.centro_de_costo}`);
      console.log(`    cliente:  ${fila.cliente?.nombre ?? '(sin cliente)'}`);
      console.log(`    identif.: ${fila.cliente?.identificacion?.numero ?? '-'}-${fila.cliente?.identificacion?.digito_de_verificacion ?? '-'} (${fila.cliente?.identificacion?.tipo ?? 'sin tipo'})`);
      console.log(`    contrato: ${fila.contrato?.nombre ?? '-'} · vence ${fila.contrato?.vence ?? '-'}`);
      console.log(`    rutas coinciden: ${fila.rutas.coinciden}`);
      if (fila.rutas.coinciden === false) {
        console.log(`      por contrato: ${fila.rutas.por_contrato?.nombre}`);
        console.log(`      por cuenta:   ${fila.rutas.por_cuenta_analitica?.nombre}`);
      }
    }
  }
} catch (error) {
  console.error(`  FALLO: ${error?.codigo || error?.message}`);
  fallos += 1;
}

try {
  console.log(`\n== del cliente a sus puestos · NIT ${nit} ==`);
  const cliente = await lector.puestosDelCliente({ identificacion: nit });
  if (!cliente.encontrado) {
    console.log('  no encontrado');
    fallos += 1;
  } else {
    console.log(`  cliente: ${cliente.cliente.nombre}`);
    console.log(`  identif.: ${cliente.cliente.identificacion?.numero}-${cliente.cliente.identificacion?.digito_de_verificacion} (${cliente.cliente.identificacion?.tipo})`);
    console.log(`  contratos: ${cliente.total_contratos} · puestos: ${cliente.total_puestos} · listados: ${cliente.puestos_listados} · corte ${cliente.as_of}`);
    for (const contrato of cliente.contratos.slice(0, 5)) {
      console.log(`  - ${contrato.nombre} · puestos ${contrato.total_puestos} · vence ${contrato.vence ?? '-'}`);
    }
    if (cliente.contratos.length > 5) console.log(`  … y ${cliente.contratos.length - 5} contratos más`);
  }
} catch (error) {
  console.error(`  FALLO: ${error?.codigo || error?.message}`);
  fallos += 1;
}

console.log(`\n${fallos === 0 ? 'OK: las dos direcciones de la llave respondieron.' : `FALLOS: ${fallos}`}`);
process.exit(fallos === 0 ? 0 : 1);
