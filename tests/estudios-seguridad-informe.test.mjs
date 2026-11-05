// Estudios de Seguridad Física, tramo 6 — el informe al nivel del real de HADA (Juan, 2026-11-05: "siga").
//
// El generador propio del informe (render-informe.js) recibe DATOS, nunca XML: imágenes ya verificadas, tablas con
// colores de una lista cerrada y saltos de página. Y el informe sigue la estructura del de HADA, con la evaluación
// general calculada (la del PDF quedó cortada) y una ficha por riesgo con foto y mapa de calor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AGT002_DOCUMENT_TEMPLATE_PATH } from '../verticales/licitaciones/agt002-document-render.js';
import { buildStudyReportFodt, imageSize } from '../verticales/estudios-seguridad/render-informe.js';
import { buildStudyReport, generalEvaluation, heatmapBlock } from '../verticales/estudios-seguridad/informe.js';
import { valorarRiesgo } from '../verticales/estudios-seguridad/metodologia.js';

const skeleton = readFileSync(AGT002_DOCUMENT_TEMPLATE_PATH, 'utf8');
// PNG de 2×1 píxeles y cabecera JPEG con SOF0 de 640×480.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGP4z8DAwMDAwAAAD/4B/0vZ8a8AAAAASUVORK5CYII=', 'base64');
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x03]);
const v = (p, i, ca, cp) => valorarRiesgo({ probabilidad: p, impactoEmpresa: i, impactoPersonas: i, controlActual: ca, controlPropuesto: cp });
const c = (a, b, d) => ({ calidad: a, eficacia: b, eficiencia: d });

function snapshot() {
  const risks = [
    { id: 'r1', numero: 1, zona: 'z1', proceso_cliente: 'Gestión Humana', factor: 'Humano', riesgo: 'Infiltración de personal', causas: 'Estudios débiles', control_existente: { descripcion: 'Estudios de confiabilidad', ...c(3, 3, 3) }, control_propuesto: { descripcion: 'Reevaluación anual', ...c(5, 5, 4) }, origen: 'agente', valoracion: v(3, 4, c(3, 3, 3), c(5, 5, 4)) },
    { id: 'r2', numero: 2, zona: 'z1', proceso_cliente: 'Logística', factor: 'Físico', riesgo: 'Contaminación de carga', causas: null, control_existente: {}, control_propuesto: {}, origen: 'manual', valoracion: v(5, 5, null, null) },
  ];
  return {
    estudio: { codigo: 'EST-2026-0009', plantilla: 'instalaciones-fisicas-v1', metodologia: 'instalaciones-fisicas-v1', cliente: { nombre: 'Cliente <de> Prueba & Cía', nit: '1' }, sede: { nombre: 'Planta', ciudad: 'Barranquilla' }, alcance: 'Planta y bodegas.', fecha_visita: '2026-10-25' },
    caracterizacion: { descripcion_cliente: 'Fabricante de jabones.', fuentes: [] },
    estadistica: [], contactos: [{ tipo: 'interventor', entidad: 'Coordinador', detalle: null, telefono: '1', correo: null }], dispositivo: [],
    zonas: [{ id: 'z1', nombre: 'Bodega 3' }], riesgos: risks,
    acciones: [{ riesgo: 'r1', accion: 'Reevaluación anual', responsable: 'Gestión Humana', fecha_compromiso: '2026-12-15', prioridad: 'alta', estado: 'pendiente' }],
    evidencias: [
      { id: 'logo', proposito: 'logo', tipo: 'foto', archivo: 'logo.png', sha256: 'a'.repeat(64) },
      { id: 'f1', riesgo: 'r1', proposito: 'evidencia', tipo: 'foto', archivo: 'malla.jpg', sha256: 'b'.repeat(64) },
      { id: 'f2', riesgo: 'r2', proposito: 'evidencia', tipo: 'foto', archivo: 'IMG_1.HEIC', sha256: 'c'.repeat(64) },
    ],
  };
}
const META = { version: 2, sha256: 'd'.repeat(64), approvedAt: '2026-10-30T15:00:00Z', approverName: 'Alba', preparerName: 'Álvaro Analista' };
const IMG = { base64: PNG.toString('base64'), mime: 'image/png', width: 2, height: 1 };

test('la estructura del informe de HADA, con fotos y mapas, sobre la plantilla corporativa', () => {
  const report = buildStudyReport(snapshot(), META, { logo: IMG, f1: IMG });
  const fodt = buildStudyReportFodt(skeleton, report);
  const order = ['ESTUDIO DE SEGURIDAD FÍSICA', 'Contenido', 'Introducción', 'Marco legal', 'Decreto 356 de 1994', 'Metodología', 'Contexto externo e interno', 'Diagnóstico y evaluación de riesgos', 'Evaluación general', 'Medición comparativa del riesgo', 'R1 · Infiltración de personal', 'Recomendaciones de seguridad', 'R2 · Contaminación de carga', 'Diseño del plan estratégico de seguridad', 'Mapa de criticidad general', 'Escalonamiento o cadena de mando', 'Informes, registro y seguimiento', 'Álvaro Analista'];
  let at = 0;
  for (const piece of order) {
    const found = fodt.indexOf(piece, at);
    assert.ok(found > at - 1 && found !== -1, `falta o está fuera de orden: ${piece}`);
    at = found;
  }
  assert.equal((fodt.match(/<draw:image draw:mime-type="image\/png">/g) || []).length, 2 + 2, 'logo y foto de R1, más las dos del membrete');
  assert.ok(fodt.includes('Cliente &lt;de&gt; Prueba &amp; Cía'), 'el texto se escapa');
  assert.ok(fodt.includes('Registrado a partir de la nota de campo'), 'el origen agente se dice en la ficha');
  assert.ok(fodt.includes('EsCelda_critico'), 'R2 actual 25 crítico pinta su celda en rojo');
  assert.ok(fodt.includes('Medianamente confiable · Medianamente eficaz · Medianamente eficiente'));
});

test('el generador sólo acepta datos: imágenes JPG/PNG en base64, colores de la lista y tipos conocidos', () => {
  const ok = { blocks: [{ kind: 'paragraph', text: 'x' }] };
  assert.doesNotThrow(() => buildStudyReportFodt(skeleton, ok));
  assert.throws(() => buildStudyReportFodt(skeleton, { blocks: [{ kind: 'xml', text: '<script/>' }] }), /no admitido/);
  assert.throws(() => buildStudyReportFodt(skeleton, { blocks: [{ kind: 'image', ...IMG, mime: 'image/svg+xml' }] }), /JPG o PNG/);
  assert.throws(() => buildStudyReportFodt(skeleton, { blocks: [{ kind: 'image', ...IMG, base64: '"><x/>' }] }), /imagen inválida/);
  assert.throws(() => buildStudyReportFodt(skeleton, { blocks: [{ kind: 'table', header: ['a'], rows: [[{ text: 'x', level: 'morado' }]] }] }), /nivel de color/);
  assert.throws(() => buildStudyReportFodt('<plantilla sin puntos/>', ok), /puntos de inserción/);
  const fodt = buildStudyReportFodt(skeleton, { blocks: [{ kind: 'paragraph', text: '<text:p>inyección</text:p>' }] });
  assert.ok(fodt.includes('&lt;text:p&gt;inyección'));
});

test('tamaño de imagen por la cabecera, y mapas de calor con el color de la v1', () => {
  assert.deepEqual(imageSize(PNG), { width: 2, height: 1 });
  assert.deepEqual(imageSize(JPEG_HEAD), { width: 640, height: 480 });
  assert.equal(imageSize(Buffer.from('GIF89a')), null);
  const map = heatmapBlock([{ probabilidad: 4, impacto: 4, code: 'R1' }]);
  assert.equal(map.rows.length, 5);
  assert.deepEqual(map.rows[0][0], { text: 'Muy alta', axis: true }, 'la primera fila es Muy alta');
  assert.deepEqual(map.rows[1][4], { text: 'R1', level: 'critico', bold: true, center: true }, 'P4 × I4 = 16 crítico');
  assert.equal(map.rows[4][1].level, 'bajo', 'P1 × I1 = 1 bajo');
});

test('la evaluación general se calcula entera, y no queda cortada como la del PDF', () => {
  const text = generalEvaluation(snapshot().riesgos);
  assert.match(text, /de los 2 riesgos identificados 1 en nivel crítico, 1 en nivel alto/);
  assert.match(text, /la magnitud total baja de 37 a 29 puntos/);
  assert.match(text, /el nivel residual más alto es crítico\.$/);
  assert.equal(generalEvaluation([]), 'El estudio no tiene riesgos valorados.');
});
