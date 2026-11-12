#!/usr/bin/env node
// Qué puede leer hoy nuestro usuario de Avancys, y qué no. Misma medición que el botón
// "Medir ahora" de la Torre (avancys-acceso.js).
//
// OJO: las credenciales de Avancys están marcadas como sensibles en Vercel y `vercel env pull`
// las entrega como "[SENSITIVE]". Desde una consola solo sirve si alguien tiene las llaves a
// mano. Lo normal es medir desde la Torre: Finanzas › Lo que falta › "Medir ahora".
//
// Uso:  node --env-file=<archivo> scripts/avancys-que-podemos-ver.mjs

import { configuracionDeAvancys } from '../avancys-odoo-lectura.js';
import { medirAccesoAvancys } from '../avancys-acceso.js';

let config;
try {
  config = configuracionDeAvancys();
} catch (error) {
  console.error(`La dirección de Avancys no es válida (${error.codigo || error.message}).`);
  console.error(`Valor recibido: ${JSON.stringify(process.env.AVANCYS_ODOO_URL)}`);
  if (process.env.AVANCYS_ODOO_URL === '[SENSITIVE]') console.error('Es una variable sensible de Vercel: no se puede descargar. Mida desde la Torre.');
  process.exit(2);
}

const r = await medirAccesoAvancys({ config });
if (!r.configurado) { console.error(r.motivo); process.exit(2); }
if (!r.autenticado) { console.error(`Avancys no aceptó la conexión: ${r.motivo}`); process.exit(1); }

const linea = f => console.log(`  ${f.permitido ? 'PERMITIDO' : 'DENEGADO '}  ${f.modelo.padEnd(30)} ${f.permitido ? String(f.filas).padStart(7) + ' filas' : '            '}  ${f.para}${f.motivo ? `\n             ↳ ${f.motivo}` : ''}`);
console.log(`Avancys ${r.origen} · medido ${r.medido_en}\n`);
console.log('Lo que la Torre ya usa:'); r.en_uso.forEach(linea);
console.log('\nPedidos el 2026-10-29:'); r.pedidos.forEach(linea);
const c = r.campo_clave;
console.log(`\nRentabilidad por cliente: ${r.rentabilidad_por_cliente.toUpperCase()}`);
console.log(`  ${c.modelo}.${c.campo}: ${c.permitido ? `diligenciado en ${c.diligenciados} de ${c.total}` : c.motivo}`);
console.log('\nNada se escribió en Avancys.');
