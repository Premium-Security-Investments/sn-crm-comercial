// Corre las pruebas que no cubre ningún otro trabajo del CI.
//
// El 2026-10-22 se midió que de los 869 archivos de prueba el CI sólo ejecutaba 506: los de AGT-002
// (`test:agt002`) y los de AGT-003 (`test:agt003`). Los otros 363 existían, estaban escritos y pagados, pero no
// los corría nadie. Ese día dos de los cuatro despliegues rompieron pruebas de ese grupo y el CI no se enteró:
// `backend-module-guards` (al unificar la noción de "estancada") y `platform-agent-configuration` (cuando el
// brief de reunión convirtió las tres funciones con IA de AGT-003 en cuatro). Este trabajo cierra ese hueco.
//
// Dos archivos están rojos A PROPÓSITO: son contratos de producto escritos antes de construirlos, y lo declaran
// en su primera línea. No son fallas, así que no deben teñir el CI de rojo; pero tampoco pueden quedar escondidos.
// Se listan aquí con su motivo y se corren aparte: **si alguno pasa, este trabajo falla** y pide sacarlo de la
// lista. Así la lista no se convierte en un cajón donde la deuda se guarda y se olvida.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Vacía desde el 2026-10-22. Las dos que había se resolvieron el mismo día que se catalogaron:
//   · tender-opportunities-compact-redesign: de los doce puntos del contrato del 2026-09-29 faltaba uno, el
//     agrupado de "Todas" por bloques; se construyó.
//   · siio-client-master-sibling-race (P1-1): ya estaba arreglado en el servidor y en el RPC. La prueba no lo
//     podía demostrar porque a sus dobles les faltaba stage_code y la petición moría antes, en la regla de
//     próxima gestión obligatoria. Verificado aparte contra la función desplegada: recibe el conjunto
//     autorizado, bloquea las filas, compara los dos conjuntos ordenados y aborta la transacción si difieren.
// Si mañana hace falta volver a listar algo, cada entrada lleva file, motivo y desde.
const PENDIENTES_CONOCIDOS = [];

const LOTE = 25;
const cubiertoPorOtroTrabajo = file => file.includes('agt002') || file.includes('agt003') || file.startsWith('vigia-');

const todos = readdirSync('tests').filter(f => f.endsWith('.test.mjs')).sort();
const pendientes = new Set(PENDIENTES_CONOCIDOS.map(item => item.file));
const aCorrer = todos.map(f => `tests/${f}`).filter(f => !cubiertoPorOtroTrabajo(f.slice('tests/'.length)) && !pendientes.has(f));

const correr = archivos => spawnSync(process.execPath, ['--test', ...archivos], { stdio: 'inherit' }).status ?? 1;

console.log(`Pruebas sin otro trabajo que las cubra: ${aCorrer.length} archivos, en lotes de ${LOTE}.`);
console.log(`Pendientes conocidos, fuera del conteo: ${PENDIENTES_CONOCIDOS.length}.`);

let fallos = 0;
for (let i = 0; i < aCorrer.length; i += LOTE) {
  const lote = aCorrer.slice(i, i + LOTE);
  console.log(`\n--- lote ${Math.floor(i / LOTE) + 1}: ${lote.length} archivos ---`);
  if (correr(lote) !== 0) fallos += 1;
}

console.log('\n=== pendientes conocidos ===');
const yaNoFallan = [];
for (const item of PENDIENTES_CONOCIDOS) {
  const rojo = correr([item.file]) !== 0;
  console.log(`${rojo ? 'sigue roja' : 'YA PASA'}  ${item.file}\n  ${item.motivo}\n  desde: ${item.desde}`);
  if (!rojo) yaNoFallan.push(item.file);
}

if (yaNoFallan.length) {
  console.error(`\nEstos pendientes conocidos ya pasan: ${yaNoFallan.join(', ')}.`);
  console.error('Lo prometido se construyó: sáquelos de PENDIENTES_CONOCIDOS en scripts/run-rest-tests.mjs para que vuelvan a vigilar.');
  process.exit(1);
}

if (fallos) {
  console.error(`\n${fallos} lote(s) con pruebas en rojo.`);
  process.exit(1);
}

console.log('\nresto de pruebas OK');
