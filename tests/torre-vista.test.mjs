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
  // v3 (contrato de la maqueta): ficha de plazo con valor y unidad, frase y responsable.
  assert.match(torre, /ficha: \{ valor: string; unidad: string \};/);
  assert.match(torre, /prioridad: 'alta' \| 'media' \| 'baja';/);
  assert.match(torre, /<h2>Lo que hay que decidir<\/h2>/);
  assert.match(torre, /className=\{`siio-plazo /);
  // Portada (opción A, Juan 15-nov): de qué mes se habla y su cierre, cuatro cifras con referencia y lo que hay que decidir.
  assert.match(torre, /className="siio-panel siio-cifras-portada"/);
  assert.match(torre, /<strong>Cerrar \{nombreMes\(torre\.mes_cerrado\)\.split\(' '\)\[0\]\} en Avancys\.<\/strong> Ningún mes está bloqueado/);
  assert.match(read('src/siio/SiioExecutiveView.tsx'), /\['portada', 'Portada'\], \['resultados', 'Resultados'\]/);
  for (const pregunta of ['¿Ganamos plata?', '¿Nos están pagando?', '¿Quién nos hace perder?', '¿El forecast está al día?']) assert.ok(torre.includes(pregunta), pregunta);
  // Resultados (PR 2 de la Fase 4): selector de mes del kit, estado de resultados por columnas con chip de estado y
  // el atraso contable con nombre; la franja vieja del mes desaparece.
  assert.doesNotMatch(torre, /SiioPulsoMes|siio-pulso/);
  assert.match(torre, /<EstadoDeResultados t=\{t\} lineas=\{torre\.lineas_pyg\} meses=\{torre\.pyg\} \/>/);
  assert.match(torre, /Contabilidad lleva \{a\.dias\} días sin cerrar/);
  assert.match(torre, /<details className="siio-plegado">/);
  assert.match(torre, /automatico: 'Cerrado'/);
  const presupuesto = read('src/siio/SiioPresupuesto.tsx');
  assert.match(presupuesto, /Rubro que se pasa/);
  assert.match(presupuesto, /className="siio-dos-col"/);
  assert.match(read('src/siio/SiioExecutiveView.tsx'), /className="siio-pantalla" role="tabpanel" aria-label="Resultados"/);
  assert.match(read('src/siio/SiioDashboard.tsx'), /<div className="siio-header-bar">\n      <SiioNavigation/);
  assert.match(torre, /Lo que hay que decidir/);
  assert.match(torre, /cierre de Finanzas/);
  // Los que pierden: últimos tres meses cerrados y acumulado del año; el mes elegido sólo cambia el detalle.
  assert.match(torre, /const MESES_PIERDEN = 3;/);
  assert.match(torre, /<th className="num total">Acumulado \{anio\}<\/th>/);
  // Clientes (PR 3 de la Fase 4): tablas del kit, marcas con chip, concentración en vivo y ver todos.
  assert.match(torre, /<span className="siio-chip marca">pierde todos los meses<\/span>/);
  assert.match(torre, /Los 5 mayores concentran el/);
  assert.match(torre, /const CLIENTES_A_LA_VISTA = 12;/);
  const vista = read('src/siio/SiioExecutiveView.tsx');
  assert.match(vista, /aria-label="Cumplimiento del servicio"[\s\S]*<SiioOperationsDetail summary=\{operations\} \/>/);
  assert.doesNotMatch(vista, /title="Operaciones · detalle"/);
  assert.match(torre, /aria-label="Cliente por cliente"[\s\S]*<select value=\{mesClientes\}/);
  // El selector general ya no pide clientes de un mes abierto.
  assert.doesNotMatch(torre, /clientesDelMes/);
});

test('cartera: lo vencido con todos sus tramos y los meses de deuda comparados con IVA', () => {
  const torre = read('src/siio/SiioTorreAvancys.tsx');
  assert.match(torre, /const IVA = 1\.19;/);
  assert.match(torre, /meses: mensual \? fila\.vencido \/ \(mensual \* IVA\) : null/);
  assert.match(torre, /\(c\.tramos \|\| \[\]\)\.map\(tramo => <CifraKit/);
  // Cartera (PR 4): el cruce por NIT no empareja nombres sin NIT entre sí, y la pestaña no es tarjeta dentro de tarjeta.
  assert.match(torre, /const nitDeudor = \(nombre: string\) => nitDe\(nombre\) \|\| `sin-nit:\$\{nombre\}`;/);
  assert.match(torre, /además pierde plata/);
  assert.match(read('src/siio/SiioExecutiveView.tsx'), /className="siio-pantalla" role="tabpanel" aria-label="Cartera"/);
  assert.match(torre, /etiqueta="Sin vencer"/);
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
  // El mismo umbral de rojo para la licitación en la Portada y en su tabla.
  assert.match(comercial, /export const PLAZO_ALTO = 12;/);
  assert.match(vista, /minimo <= PLAZO_ALTO \? 'alta'/);
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
  // El forecast atrasado sube a la Portada con su responsable.
  // El forecast es una de las cuatro cifras de la Portada, con los nombres de quien no tiene ningún lead al día.
  assert.match(vista, /forecast=\{forecastPortada\}/);
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
  assert.match(reco, /className=\{`siio-plazo \$\{item\.priority === 'baja' \? '' : item\.priority\}`\}/);
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
  // El mes en curso solo con lo facturado (la nómina se causa al cierre).
  assert.match(torre, /a hoy: <strong>\{millones\(enCurso\.totales\.ingresos\)\}<\/strong> facturados/);
  // Cada cifra con su referencia: la utilidad contra el mes anterior en puntos; los clientes contra el mes anterior.
  assert.match(torre, /pts frente a \{nombre\(previo\)\}/);
  assert.match(torre, /<i> · \{nombre\(previo\)\.slice\(0, 3\)\}: \{antes\.pierden\.length\} · \{millones\(antes\.suma\)\}<\/i>/);
  // La tendencia dice algo: cifra de cada mes, el mes de la portada resaltado y la línea del presupuesto.
  assert.match(torre, /function TendenciaMargen/);
  assert.match(torre, /className="ppto"/);
  // Clientes del mes de la portada: con la Torre si es el último cerrado; si no, con la ruta de la pestaña Clientes.
  assert.match(torre, /api<Clientes>\(`\/api\/siio\/avancys\/rentabilidad-aproximada\?mes=\$\{encodeURIComponent\(mes\)\}`\)/);
  // Ninguna cifra real escrita en el código.
  assert.doesNotMatch(torre, /8,7 %|48 %/);
  const vista = read('src/siio/SiioExecutiveView.tsx');
  assert.match(vista, /\.\.\.licitacionesPorDecidir\(porDecidir\)/);
  assert.match(vista, /`¿Nos presentamos a \$\{enumerar\(nombres\)\}\?`/);
  assert.match(vista, /export function nombreCorto/);
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
