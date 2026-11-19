import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { clientesMesVencido } from '../avancys-torre.js';
import { CLIENTES_MES_VENCIDO } from '../avancys-pyg.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('los clientes de mes vencido son los marcados en el CRM; la lista fija sólo si la base no responde', async () => {
  const db = resultado => ({ from: () => ({ select: () => ({ eq: () => Promise.resolve(resultado) }) }) });
  assert.deepEqual(await clientesMesVencido(db({ data: [{ avancys_ref_num: ' 900000001 ' }, { avancys_ref_num: '900000002' }, { avancys_ref_num: null }], error: null })), ['900000001', '900000002']);
  assert.equal(await clientesMesVencido(db({ data: null, error: { message: 'falla' } })), CLIENTES_MES_VENCIDO);
  assert.equal(await clientesMesVencido(null), CLIENTES_MES_VENCIDO);
  assert.match(read('server/index.js'), /torreAvancys\(\{ refrescar: req\.query\.refrescar === '1', db: requireDb\(\) \}\)/);
  assert.match(read('verticales/gerencial/siio-recommendations.js'), /torreAvancys\(\{ ahora: \(\) => now, db: database \}\)/);
});

test('la portada: lo de hoy en tarjetas, la proyección no se presenta como resultado y Clientes tiene su propio mes', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  // Portada de siete preguntas (contrato aprobado por Juan, 15-nov): cada renglón con su periodo y su comparación.
  assert.match(torre, /className="siio-panel siio-portada"/);
  assert.match(read('src/siio/SiioExecutiveView.tsx'), /\['portada', 'Portada'\], \['resultados', 'Resultados'\]/);
  // Resultados (PR 2 de la Fase 4): selector de mes del kit, estado de resultados por columnas con chip de estado y
  // el atraso contable con nombre; la franja vieja del mes desaparece.
  assert.doesNotMatch(torre, /SiioPulsoMes|siio-pulso/);
  assert.match(torre, /<EstadoDeResultados t=\{t\} lineas=\{torre\.lineas_pyg\} meses=\{torre\.pyg\} \/>/);
  assert.match(torre, /<strong>Contabilidad lleva \{diasDesdeFinDeMes\(fila\.mes, hoy\)\} días sin cerrar \{nombre\(fila\.mes\)\}\.<\/strong>/);
  assert.match(torre, /<details className="siio-plegado">/);
  assert.match(torre, /automatico: 'Cerrado'/);
  const presupuesto = read('src/siio/SiioPresupuesto.tsx');
  assert.match(presupuesto, /Rubro que se pasa/);
  assert.match(presupuesto, /className="siio-dos-col"/);
  assert.match(read('src/siio/SiioExecutiveView.tsx'), /className="siio-pantalla" role="tabpanel" aria-label="Resultados"/);
  assert.match(read('src/siio/SiioDashboard.tsx'), /<div className="siio-header-bar">\n      <SiioNavigation/);
  assert.match(torre, /cierre de Finanzas/);
  // Los que pierden: últimos tres meses cerrados y acumulado del año; el mes elegido sólo cambia el detalle.
  assert.match(torre, /const MESES_PIERDEN = 3;/);
  assert.match(torre, /<th className="num total">Acumulado \{anio\}<\/th>/);
  // Clientes (PR 3 de la Fase 4): tablas del kit, marcas con chip, concentración en vivo y ver todos.
  assert.match(torre, /<span className="siio-chip marca">pierde todos los meses<\/span>/);
  assert.match(torre, /Los 5 mayores concentran el/);
  assert.match(torre, /const CLIENTES_A_LA_VISTA = 12;/);
  const vista = read('src/siio/SiioExecutiveView.tsx');
  // El cumplimiento del servicio salió de Clientes a su pestaña Operación (17-nov).
  assert.doesNotMatch(vista, /aria-label="Cumplimiento del servicio"/);
  assert.match(vista, /<SiioPestanaOperacion notas=\{torre\.torre\?\.notas_credito\} ops=\{operations\} \/>/);
  assert.doesNotMatch(vista, /title="Operaciones · detalle"/);
  assert.match(torre, /aria-label="Cuánto deja cada cliente"[\s\S]*<select value=\{mesClientes\}/);
  // El selector general ya no pide clientes de un mes abierto.
  assert.doesNotMatch(torre, /clientesDelMes/);
});

test('cartera: lo vencido con todos sus tramos y los meses de deuda comparados con IVA', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /const IVA = 1\.19;/);
  assert.match(torre, /meses: mensual \? fila\.vencido \/ \(mensual \* IVA\) : null/);
  assert.match(torre, /\(c\.tramos \|\| \[\]\)\.map\(tramo => <div key=\{tramo\.tramo\}>/);
  // Cartera (PR 4): el cruce por NIT no empareja nombres sin NIT entre sí, y la pestaña no es tarjeta dentro de tarjeta.
  assert.match(torre, /const nitDeudor = \(nombre: string\) => nitDe\(nombre\) \|\| `sin-nit:\$\{nombre\}`;/);
  assert.match(torre, /además pierde plata/);
  assert.match(read('src/siio/SiioExecutiveView.tsx'), /className="siio-pantalla" role="tabpanel" aria-label="Cartera"/);
  assert.match(torre, /Sin vencer: \{millones\(c\.total\.saldo - c\.vencido\.saldo\)\}/);
});

test('cartera con las reglas de la Portada (Juan, 16-nov): a hoy, contra hace un mes y el rojo solo con umbral', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /<h2>¿Nos están pagando\?<\/h2>/);
  assert.match(torre, /<h2>¿Quién debe más\?<\/h2>/);
  // La comparación contra hace un mes, en la pestaña y en la Portada, con la foto diaria.
  assert.equal((torre.match(/<ContraHaceUnMes c=\{c\} \/>/g) || []).length, 2);
  assert.match(torre, /tono=\{parteVencida >= CARTERA_VENCIDA_MAL \? 'mal' : undefined\}/);
  // Lo que puede mover la cifra va arriba en ámbar; los tramos ya no se pintan de rojo.
  assert.match(torre, /en consignaciones sin identificar\.<\/strong>/);
  assert.doesNotMatch(torre, /tono=\{viejos\.includes\(tramo\)/);
  assert.match(torre, /className="siio-tabla apilable">\s*<thead><tr><th>Cliente<\/th><th className="num">Vencido<\/th>/);
});

test('la foto diaria de la cartera: se guarda la de hoy y se compara con la de hace un mes; sin tabla, sigue', async () => {
  const { fotoDeCartera } = await import('../avancys-torre.js');
  const filas = [];
  const db = {
    from: () => ({
      upsert: async fila => { filas.push(fila); return { error: null }; },
      select: () => ({ lte: (_c, limite) => ({ order: () => ({ limit: async () => ({ data: limite >= '2026-10-16' ? [{ fecha: '2026-10-15', total: '100', vencido: '40', mas_30: '10' }] : [], error: null }) }) }) }),
    }),
  };
  const cartera = { total: { saldo: 120 }, vencido: { saldo: 50 }, tramos: [{ tramo: '1 a 30 días', saldo: 20 }, { tramo: '31 a 60 días', saldo: 30 }] };
  const foto = await fotoDeCartera(db, cartera, new Date('2026-11-16T15:00:00Z'));
  assert.deepEqual(foto, { fecha: '2026-10-15', total: 100, vencido: 40, mas_30: 10 });
  assert.equal(filas[0].fecha, '2026-11-16');
  assert.equal(filas[0].mas_30, 30);
  // La fecha es la de Bogotá: a las 2 a. m. UTC todavía es el día anterior.
  await fotoDeCartera(db, cartera, new Date('2026-11-17T02:00:00Z'));
  assert.equal(filas[1].fecha, '2026-11-16');
  // Sin base o con la tabla ausente, no tumba la Torre.
  assert.equal(await fotoDeCartera(null, cartera), null);
  assert.equal(await fotoDeCartera({ from: () => { throw new Error('relation does not exist'); } }, cartera), null);
  assert.match(read('supabase/migrations/226_cartera_foto_diaria.sql'), /revoke all on table public\.psi_siio_cartera_fotos from public, anon, authenticated, service_role;/);
});

test('cabecera y pestañas calcan la maqueta: botón primario, pestañas en fila y nombres de cliente sin códigos', () => {
  const kit = read('src/siio/siio-kit.css');
  assert.match(kit, /\.siio-dashboard \.siio-pestanas\.module-segmented-nav\{position:static;display:flex;flex-direction:row;flex-wrap:wrap;/);
  assert.match(kit, /\.siio-pestanas\.module-segmented-nav button\{flex:none;width:auto;/);
  assert.match(read('src/siio/SiioDashboard.tsx'), /className="siio-boton-primario"/);
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /replace\(\/\^\(\\s\*\\\[\[\^\\\]\]\*\\\]\\s\*\)\+\//);
  assert.doesNotMatch(torre, /<>pierden \{millones/);
});

test('comercial y licitaciones calcan la maqueta: plazo en ficha, forecast por comercial y nada del Excel', () => {
  const comercial = read('src/siio/SiioPestanaComercial.tsx');
  const vista = read('src/siio/SiioExecutiveView.tsx');
  assert.match(vista, /className="siio-pantalla" role="tabpanel" aria-label="Comercial y licitaciones"/);
  // La misma ventana que la Portada: 15 días (contrato del 15-nov).
  assert.match(comercial, /export const PLAZO_ALTO = 15;/);
  assert.match(read('verticales/gerencial/siio-commercial-summary.js'), /const DECISION_WINDOW_DAYS = 15;/);
  assert.match(comercial, /<FichaPlazo item=\{item\} \/>/);
  // ¿El forecast está al día? con nombre: la columna protagonista es lo que lleva más de 30 días sin gestión.
  assert.match(comercial, /¿El forecast está al día\?/);
  assert.match(comercial, /summary\.pipeline\.by_owner/);
  assert.match(comercial, /ningún lead al día/);
  // Los seguimientos con fecha no repiten las licitaciones, que ya están en su tabla.
  assert.match(comercial, /asunto\.tipo === 'seguimiento'/);
  // Lo de privados y licitaciones que estaba en Fuentes va plegado en su pestaña.
  assert.doesNotMatch(vista, /Comercial privado · detalle|Licitaciones públicas · detalle/);
  assert.match(comercial, /<SiioPrivateDetail summary=\{summary\} state="ready" \/>/);
  assert.match(read('src/siio/siio-kit.css'), /\.siio-magnitud\.neutra i\{background:var\(--accion\)\}/);
});

test('fuentes calca la maqueta: quién tiene atrasado qué, el Excel con su detalle plegado y la nómina una sola vez', () => {
  const vista = read('src/siio/SiioExecutiveView.tsx');
  assert.match(vista, /className="siio-pantalla" role="tabpanel" aria-label="Fuentes y detalle"/);
  assert.ok(vista.indexOf('<SiioFuentesAlDia') < vista.indexOf('aria-label="El Excel de Finanzas"'), 'primero el tablero de atrasos');
  // Poda de la Fase 1: fuera lo que duplicaba una pantalla en vivo.
  assert.doesNotMatch(vista, /SiioRevenueByClient|SiioConcentracionClientes|SiioDevengado|SiioHorasPorCliente|Acumulado del año según/);
  // Lo comercial y las licitaciones de la Portada salen del mismo resumen que su pestaña.
  assert.match(vista, /comercial=\{commercial\} \/>/);
  const fuentes = read('src/siio/SiioFuentesAlDia.tsx');
  assert.match(fuentes, /<th>Atraso<\/th><th>Qué falta<\/th><th>Responsable<\/th><th>Efecto en la Torre<\/th>/);
  assert.match(read('src/siio/siio-kit.css'), /\.siio-dashboard \.siio-tabla td:last-child:not\(\.num\)\{text-align:left;white-space:normal\}/);
});

test('parámetros calca la maqueta y los créditos salen de Avancys; a mano solo lo que no está', () => {
  const parametros = read('src/siio/SiioParametros.tsx');
  assert.match(parametros, /<thead><tr><th>Parámetro<\/th><th>Encargado<\/th><th>Estado<\/th>/);
  assert.match(parametros, /parametro\.clave === 'creditos' \? <CreditosDeAvancys creditos=\{creditos\} manuales=\{filas\} \/>/);
  assert.match(parametros, /Lo que no está en Avancys \(lo deja aquí Tesorería\)/);
  assert.doesNotMatch(parametros, /Badge/, 'estados con el chip del kit');
  assert.match(read('src/siio/SiioExecutiveView.tsx'), /<SiioPestanaParametros creditos=\{torre\.torre\?\.creditos \?\? null\} \/>/);
  assert.match(read('avancys-torre.js'), /creditos = await creditosAvancys\(ejecutar, \{ hoy: ahora\(\)\.toISOString\(\)\.slice\(0, 10\) \}\);/);
});

test('vig-ia calca la maqueta: ficha de prioridad, porqué, fuentes y lo que no pudo evaluar', () => {
  const reco = read('src/siio/SiioRecommendations.tsx');
  assert.match(read('src/siio/SiioExecutiveView.tsx'), /className="siio-pantalla" role="tabpanel" aria-label="Vig-IA"/);
  assert.match(reco, /<article key=\{item\.id\} className="siio-panel siio-reco"/);
  // Prioridad alta en rojo; media y baja sin color: el ámbar queda para lo que puede cambiar (17-nov).
  assert.match(reco, /className=\{`siio-plazo\$\{item\.priority === 'alta' \? ' alta' : ''\}`\}/);
  assert.match(reco, /<h2 className="siio-titulo-pantalla">¿Qué recomienda Vig-IA esta semana\?<\/h2>/);
  assert.match(reco, /export const DIAS_VIGENTES = 3;/);
  assert.match(reco, /Estas recomendaciones tienen \{edad\} días\./);
  assert.match(reco, /<strong>Por qué:<\/strong>/);
  assert.match(reco, /Lo que Vig-IA no pudo evaluar \(y quién lo destraba\)/);
  assert.match(reco, /className="siio-boton-primario"/);
  assert.doesNotMatch(read('src/siio/siio.css'), /siio-recommendation/, 'sin el CSS de la versión anterior');
});

test('portada opción A (Juan, 15-nov): el mes anterior con su cierre, cuatro cifras con referencia y decisiones cortas', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  // «Sin cierre formal · N días» en vez de «Cerrado» por la regla de los 30 días.
  assert.match(torre, /texto: `Sin cierre formal · \$\{dias\} \$\{dias === 1 \? 'día' : 'días'\}`/);
  assert.match(torre, /return t\.realDe\(anterior\) \? anterior : t\.torre\?\.mes_cerrado \|\| null;/);
  // Clientes del mes de la portada: con la Torre si es el último cerrado; si no, con la ruta de la pestaña Clientes.
  assert.match(torre, /api<Clientes>\(`\/api\/siio\/avancys\/rentabilidad-aproximada\?mes=\$\{encodeURIComponent\(mes\)\}`\)/);
  // Ninguna cifra real escrita en el código.
  assert.doesNotMatch(torre, /8,7 %|48 %/);
  assert.doesNotMatch(read('src/siio/SiioExecutiveView.tsx'), /SiioRequiereDecision|licitacionesPorDecidir/, 'la lista de decisiones se volvió renglones de la Portada');
});

test('portada de siete preguntas (contrato de Juan, 15-nov): periodo, respuesta y comparación en cada renglón', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  const preguntas = ['¿Ganamos plata el mes pasado?', '¿Cuánto llevamos facturado este mes?', '¿Nos están pagando?', '¿Qué clientes nos hacen perder?', '¿Cómo va lo comercial?', '¿Qué licitaciones hay que decidir?', '¿Las fuentes están al día?'];
  const posiciones = preguntas.map(pregunta => torre.indexOf(`pregunta="${pregunta}"`));
  assert.ok(posiciones.every((pos, i) => pos > 0 && (i === 0 || pos > posiciones[i - 1])), 'las siete, en el orden aprobado');
  // Cada renglón dice su periodo: el mes anterior con su cierre, o a hoy.
  assert.match(torre, /function Renglon\(\{ pregunta, periodo, tono, ir, respuesta, comparacion \}/);
  assert.match(torre, /className=\{`siio-periodo \$\{periodo\.tono\}`\}/);
  // Lo facturado se compara contra el mes anterior completo, no día contra día (la facturación llega en lotes).
  assert.match(torre, /completo: \{millones\(r\.ingresos\)\}/);
  // Licitaciones: las que cierran en 15 días sin GO ni NO-GO.
  assert.match(torre, /export const VENTANA_LICITACIONES = 15;/);
  assert.match(torre, /const porDecidir = enVentana\.filter\(item => item\.offer_status === 'pendiente_decision'\);/);
  // Los meses sin cerrar se cuentan con la misma regla de cierre que Resultados.
  assert.match(torre, /\.filter\(fila => fila\.cierre\.tono !== 'cerrado'\)/);
  // Los nombres largos no empujan la página: cada columna del renglón y la lista corta tienen una sola pista que no crece.
  const kit = read('src/siio/siio-kit.css');
  assert.match(kit, /\.siio-renglon \.c\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(kit, /\.siio-lista-corta\{display:grid;grid-template-columns:minmax\(0,1fr\);gap:3px;min-width:0\}/);
  // Las entidades con nombre corto, como en Mi día de Licitaciones.
  assert.match(torre, /'Rama Judicial · Seccional \$1'/);
  // Ningún botón dentro de otro: «Volver a leer» va fuera de los renglones.
  const portada = torre.slice(torre.indexOf('export function SiioPortada'), torre.indexOf('// Resultados (contrato de la maqueta'));
  assert.equal((portada.match(/<button/g) || []).length, 1);
  assert.equal((torre.slice(torre.indexOf('function Renglon'), torre.indexOf('function Lista')).match(/<button/g) || []).length, 1);
});

test('resultados revisado con Juan (15-nov): lo que Avancys tiene hoy, sin proyecciones, una cifra por mes', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  // Sin proyecciones en el estado de resultados: ni «≈» ni septiembre copiado en los meses abiertos.
  assert.doesNotMatch(torre, /fila\.proyeccion \? fila\.proyeccion\.lineas : fila\.lineas/);
  assert.doesNotMatch(torre, /siio-chip proyeccion">≈/);
  // Las líneas que parecen incompletas llevan su referencia del último mes cerrado, sin reemplazarla.
  assert.match(torre, /className="siio-incompleta"/);
  // El mes en curso: a hoy, con sus totales al cierre.
  assert.match(torre, /if \(enCurso\(fila\) && total !== 'ingresos'\) return <span className="siio-secondary">al cierre<\/span>;/);
  // Una cifra por mes (Avancys) y la diferencia con el cierre de Finanzas dicha, con responsable.
  assert.match(torre, /Avancys y el cierre de Finanzas \(Excel\) no coinciden/);
  assert.match(torre, /if \(f\) return \{ ingresos: f\.totales\.ingresos/);
  // La renta que no se registra no se presenta como cero.
  assert.match(torre, /if \(clave === 'renta' && sinRenta\(fila\)\) return <span className="siio-secondary">no registrado<\/span>;/);
  // Presupuesto: el mes elegido con su chip; tecnología por confirmar.
  const presupuesto = read('src/siio/SiioPresupuesto.tsx');
  assert.match(presupuesto, /fila\.mes <= mes && fila\.mes < enCurso/);
  assert.match(presupuesto, /<Unidad nombre="Tecnología" mes=\{fila\.mes\} u=\{fila\.tecnologia\} porConfirmar \/>/);
});

test('resultados con fuerza (Juan, 15-nov): cifras contra el mes anterior, cada $100, qué cambió y presupuesto corto', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /<HistoriaDelMes t=\{t\} lineas=\{torre\.lineas_pyg\} meses=\{torre\.pyg\} \/>/);
  assert.match(torre, /¿A dónde se va cada \$100 que facturamos\?/);
  // La frase del mes sale del tramo de costo que más se movió por cada $100, no de un texto escrito.
  assert.match(torre, /\.sort\(\(a, b\) => Math\.abs\(b\.dif\) - Math\.abs\(a\.dif\)\)\[0\]/);
  // Qué cambió: en costos y gastos, subir es malo; si sube menos que el ingreso, se dice.
  assert.match(torre, /subió menos que el ingreso/);
  // El mes en curso no cuenta historia: va a hoy.
  assert.match(torre, /va a hoy\.<\/strong>/);
  const presupuesto = read('src/siio/SiioPresupuesto.tsx');
  assert.match(presupuesto, /className="siio-barras-ppto"/);
  assert.match(presupuesto, /parece un problema de asignación de cuentas/);
  assert.doesNotMatch(torre, /8,7 %|48 %|70,6|67,6/, 'ninguna cifra real escrita en el código');
});

test('resultados con las reglas de la Portada (Juan, 16-nov): color por efecto, ámbar solo para lo que puede cambiar', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  const kit = read('src/siio/siio-kit.css');
  // Sin cierre va en ámbar por largo que sea: el rojo es para lo que está peor que su referencia.
  assert.doesNotMatch(torre, /'marca' : 'confirmar'|DIAS_SIN_CIERRE_MAL/);
  // Un costo que sube menos que el ingreso no se pinta: el ámbar ya significa «puede cambiar».
  assert.doesNotMatch(torre, /\? 'amb' :/);
  assert.match(kit, /\.siio-cambios \.valor\.igual\{color:var\(--tinta\)\}/);
  // Los puntos se pintan por efecto y con un umbral: subir en costos es malo; en la utilidad, bajar.
  assert.match(torre, /const tonoPuntos = \(puntos: number \| null, subirEsMalo: boolean\)/);
  assert.match(torre, /tonoPuntos\(ppCosto, true\)/);
  assert.match(torre, /tonoPuntos\(ppUtil, false\)/);
  // El chip de un mes que cerró Finanzas no esconde que las cifras son de Avancys.
  assert.match(torre, /Finanzas cerró · cifras de Avancys/);
  // Lo que hay que saber antes de creerle al mes va arriba, no en letra chica bajo la tabla.
  assert.ok(torre.indexOf('<AvisoDelMes') < torre.indexOf('<HistoriaDelMes t={t}'));
  // «Mes a mes» es el estado de resultados completo, abierto; las cuentas van en «Cómo se calculó».
  assert.match(torre, /className="siio-tabla siio-pyg"/);
  assert.match(torre, /<summary>Cómo se calculó: las cuentas de cada línea y el cierre oficial de Finanzas<\/summary>/);
});

test('la barra de cada $100 lleva sus cifras en la leyenda y nada sale como −$0 M (Juan, 16-nov)', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /<ul className="leyenda">\{actual\.map\(\(x, i\) =>/);
  assert.match(torre, /<strong>\{pesos100\(x\.valor\)\}<\/strong>/);
  assert.match(torre, /const millones = \(valor: number\) => `\$\{Math\.round\(valor \/ 1e6\) < 0 \? '−' : ''\}/);
});

test('el mes en curso tiene la misma forma que un mes terminado (Juan, 16-nov)', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /<span className="pregunta">Ingresos a hoy<\/span>/);
  assert.match(torre, /\{alCierre\('Utilidad operacional', p \? p\.utilidad_ordinaria : null\)\}/);
  assert.match(torre, /aria-label=\{`Resultados de \$\{nombre\(fila\.mes\)\} a hoy`\}/);
});

test('clientes con las reglas de la Portada (Juan, 16-nov): preguntas, periodo con su cierre, aviso y comparación', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /<h2>¿Qué clientes nos hacen perder\?<\/h2>/);
  assert.match(torre, /<h2>¿Cuánto deja cada cliente\?<\/h2>/);
  // Ningún mes se rotula «Cerrado» por la regla de la Torre: cada uno con su cierre real.
  assert.doesNotMatch(torre, /· Cerrado<\/option>|Mes cerrado\n/);
  assert.match(torre, /<option key=\{mes\} value=\{mes\}>\{nombreMes\(mes\)\} · \{cierreDe\(t, mes, hoy\)\.texto\}<\/option>/);
  // Lo aproximado va arriba en el aviso, no en letra chica.
  assert.match(torre, /<strong>Cifras aproximadas\.<\/strong>/);
  // Cada margen con el del mes anterior; el precio por hora con el costo de referencia: el promedio en el título y,
  // desde el 19-nov, el de la ciudad de cada cliente en su fila.
  assert.match(torre, /className="siio-antes"/);
  assert.match(torre, /<small>costo promedio: \{pesos\(costoHora\)\}<\/small>/);
  assert.match(torre, /<small>costo: \{pesos\(Math\.abs\(fila\.costo_hora\)\)\}<\/small>/);
});

test('comercial y licitaciones con las reglas de la Portada (Juan, 17-nov): su orden, preguntas y una lista por fecha', () => {
  const comercial = read('src/siio/SiioPestanaComercial.tsx');
  // El orden de la Portada: cómo va lo comercial, el forecast y las licitaciones.
  const orden = ['<ComercialPrivado', '<ForecastAlDia', '<Licitaciones', '<SeguimientosConFecha'].map(x => comercial.lastIndexOf(x));
  assert.ok(orden.every((pos, i) => pos > 0 && (i === 0 || pos > orden[i - 1])), 'en el orden de la Portada');
  assert.match(comercial, /<h2>¿Cómo va lo comercial\?<\/h2>/);
  assert.match(comercial, /Vendido en \$\{nombreDelMes\}, a hoy/);
  // Licitaciones: una sola lista por fecha de cierre y la decisión de cada una en su ficha.
  assert.match(comercial, /localeCompare\(String\(y\.deadline_at \|\| '9999'\)\)/);
  assert.match(comercial, /Por decidir GO \/ NO-GO/);
  assert.match(comercial, /GO · \{ESTADO_OFERTA/);
  assert.match(comercial, /<summary>Presentadas, esperando resultado/);
  // El ámbar no se usa para urgencia: la ficha de plazo es roja o neutra.
  assert.doesNotMatch(comercial, /'alta' : 'media'/);
});

test('operación (Juan, 17-nov): cinco preguntas; la 1 reservada sin inventar y las notas crédito separadas por motivo', async () => {
  const op = read('src/siio/SiioPestanaOperacion.tsx');
  const preguntas = ['¿Estamos prestando el servicio que cobramos?', '¿Cuánto nos descuentan por servicio no prestado?', '¿Qué falló?', '¿La atención técnica está al día?', '¿Dónde no estamos midiendo?'];
  const pos = preguntas.map(p => op.indexOf(`pregunta="${p}"`));
  assert.ok(pos.every((p, i) => p > 0 && (i === 0 || p > pos[i - 1])), 'las cinco, en orden');
  assert.match(op, /periodo="Sin fuente todavía"/);
  assert.doesNotMatch(op, /programacion_horas|siio_programacion/, 'la Programación del SIIO no se usa');
  assert.match(op, /export const DIAS_EXTRACCION_VIEJA = 2;/);
  const { motivoDeNotaCredito } = await import('../avancys-torre.js');
  assert.equal(motivoDeNotaCredito('Reversión de: SN386222 SERVICIO NO PRESTADO 16 AL 31/10'), 'no_prestado');
  assert.equal(motivoDeNotaCredito('Reversión de: SN387970 SE FACTURA NUEVAMENTE'), 'correccion');
  assert.equal(motivoDeNotaCredito('NOTA CREDITO 380514 / ERROR EN TARIFA'), 'correccion');
  assert.equal(motivoDeNotaCredito('Reversión de: SN382555'), 'sin_motivo');
  assert.equal(motivoDeNotaCredito('Reversión de: SN382555', true), 'correccion', 'anula la factura completa: se refactura');
  assert.equal(motivoDeNotaCredito('4400229224'), 'otro');
});

test('notas crédito por mes: clasifica, detecta la refacturación con redondeo y agrupa por cliente', async () => {
  const { notasCreditoPorMes } = await import('../avancys-torre.js');
  const ejecutar = async (modelo, metodo, args) => {
    if (metodo === 'read') return [{ id: 9, amount_untaxed_signed: 500 }];
    const tipo = args[0].find(f => f[0] === 'move_type')[2];
    if (tipo === 'out_invoice') return [{ invoice_date: '2026-10-02', amount_untaxed_signed: 1000000005, commercial_partner_id: [2, 'CLIENTE B'] }];
    return [
      { ref: 'SERVICIO NO PRESTADO', invoice_date: '2026-10-05', amount_untaxed_signed: -3000000, commercial_partner_id: [1, 'CLIENTE A'], reversed_entry_id: false },
      { ref: '', invoice_date: '2026-10-02', amount_untaxed_signed: -1000000000, commercial_partner_id: [2, 'CLIENTE B'], reversed_entry_id: false },
      { ref: 'Reversión de: SN1', invoice_date: '2026-10-06', amount_untaxed_signed: -500, commercial_partner_id: [1, 'CLIENTE A'], reversed_entry_id: [9, 'SN1'] },
      { ref: '', invoice_date: '2026-10-07', amount_untaxed_signed: -2000000, commercial_partner_id: [1, 'CLIENTE A'], reversed_entry_id: false },
    ];
  };
  const r = await notasCreditoPorMes(ejecutar, { desde: '2026-10-01' });
  const oct = r.meses['2026-10'];
  assert.deepEqual([oct.no_prestado.valor, oct.correccion.valor, oct.sin_motivo.valor], [3000000, 1000000500, 2000000]);
  assert.deepEqual(oct.clientes.map(c => [c.cliente, c.no_prestado, c.sin_motivo]), [['CLIENTE A', 3000000, 2000000]]);
});
