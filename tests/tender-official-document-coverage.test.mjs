// TDD (RED) — contrato del modulo que falta: cobertura COMPLETA de documentos
// oficiales SECOP II / ESU.
//
// Hoy `selectPriorityTenderDocuments` (duplicada en server/index.js y en
// api/[...path].js) filtra los documentos publicados del proceso contra un
// catalogo fijo de 16 palabras clave:
//
//   ['pliego','estudio','previo','especificacion','especificación','tecnico',
//    'técnico','anexo','formato','indicador','financier','experiencia',
//    'matriz','riesgo','convocatoria','minuta']
//
// y devuelve SOLO los que casan (hasta 40). El resto desaparece: no se importa,
// no se registra, no se enumera en ninguna parte. En el proceso real del
// fixture (7 documentos oficiales publicados) solo 3 nombres casan; los otros 4
// -- ANALISIS DEL SECTOR y las tres cotizaciones -- se omiten en silencio, y el
// expediente queda "completo" con el 43% del contenido.
//
// El contrato que fija este archivo:
//
//   * NO hay catalogo de palabras clave. Todo documento oficial publicado entra.
//   * El tope oficial (40) se conserva, pero dejar de traer algo deja de ser
//     silencioso: cada documento por encima del tope se ENUMERA como cobertura
//     parcial, con identidad y motivo cerrado.
//   * La enumeracion es la fuente de los gaps del inventario, de modo que una
//     cobertura parcial haga fallar cerrado a decision_ready por la maquinaria
//     que ya existe (tender-requirement-inventory.js).
//   * El modulo es puro: sin red, sin reloj, sin aleatoriedad, y su salida
//     nunca expone la URL de descarga (que en SECOP lleva token).
//
// Ejecutar: node tests/tender-official-document-coverage.test.mjs

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  TENDER_OFFICIAL_DOCUMENT_SELECTION_CAP,
  TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON,
  selectTenderOfficialDocuments,
  tenderOfficialCoverageGaps,
} from '../tender-official-document-coverage.js';
import { buildTenderRequirementInventory } from '../tender-requirement-inventory.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/secop-ii-process-official-documents.json', import.meta.url), 'utf8'));

const secopName = doc => doc.nombre_archivo;
const secopId = doc => doc.id_documento;

const selectSecop = (documents, options = {}) => selectTenderOfficialDocuments(documents, {
  nameGetter: secopName, idGetter: secopId, ...options,
});

// El catalogo de palabras clave que hoy decide la seleccion, reproducido aqui
// solo para PROBAR que el fixture separa de verdad lo que casa de lo que no.
const LEGACY_KEYWORDS = [
  'pliego', 'estudio', 'previo', 'especificacion', 'especificación', 'tecnico', 'técnico',
  'anexo', 'formato', 'indicador', 'financier', 'experiencia', 'matriz', 'riesgo',
  'convocatoria', 'minuta',
];
const matchesLegacyKeyword = name => LEGACY_KEYWORDS.some(term => String(name).toLowerCase().includes(term));

// ===========================================================================
// 0. El fixture es exactamente el caso de produccion descrito.
// ===========================================================================
{
  const names = fixture.documents.map(secopName);
  assert.equal(names.length, 7, 'el proceso publica exactamente 7 documentos oficiales');
  assert.deepEqual(
    names.filter(matchesLegacyKeyword),
    fixture.keyword_matching_names,
    'exactamente 3 nombres casan con el catalogo de palabras clave vigente',
  );
  assert.deepEqual(
    names.filter(name => !matchesLegacyKeyword(name)),
    fixture.non_keyword_names,
    'los otros 4 no casan con ninguna palabra clave',
  );
  assert.ok(fixture.non_keyword_names.includes('ANALISIS DEL SECTOR.pdf'));
  assert.equal(
    fixture.non_keyword_names.filter(name => name.startsWith('COTIZACION ')).length,
    3,
    'el proceso trae tres cotizaciones que hoy se pierden',
  );
}

// ===========================================================================
// 1. Los 7 documentos oficiales se importan, pese a que solo 3 casen.
// ===========================================================================
const complete = selectSecop(fixture.documents);
{
  assert.equal(complete.selected.length, 7, 'los 7 documentos oficiales publicados deben seleccionarse');
  assert.deepEqual(
    complete.selected.map(secopName),
    fixture.documents.map(secopName),
    'la seleccion conserva el orden de publicacion del proceso, sin reordenar ni filtrar',
  );
  for (const [index, doc] of complete.selected.entries()) {
    assert.equal(doc, fixture.documents[index], 'la seleccion devuelve el documento original, sin copiarlo ni recortarlo');
  }
  assert.deepEqual(complete.omitted, [], 'sin tope excedido no hay nada omitido');

  assert.deepEqual(
    Object.keys(complete.coverage).sort(),
    ['omitted_count', 'omitted_documents', 'selected_count', 'status', 'total_official_documents'],
    'la cobertura tiene una forma cerrada y auditable',
  );
  assert.deepEqual(complete.coverage, {
    status: 'complete',
    total_official_documents: 7,
    selected_count: 7,
    omitted_count: 0,
    omitted_documents: [],
  });

  // La prueba de que el catalogo de palabras clave desaparecio: los documentos
  // que NO casan siguen presentes, uno por uno.
  const selectedNames = complete.selected.map(secopName);
  for (const name of fixture.non_keyword_names) {
    assert.ok(selectedNames.includes(name), `${name} debe importarse aunque no case con ninguna palabra clave`);
  }
}

// ===========================================================================
// 2. Determinismo y pureza: misma entrada, misma salida.
// ===========================================================================
{
  assert.deepEqual(selectSecop(fixture.documents).coverage, complete.coverage);
  assert.deepEqual(
    selectSecop(fixture.documents).selected.map(secopName),
    complete.selected.map(secopName),
  );

  const source = readFileSync(new URL('../tender-official-document-coverage.js', import.meta.url), 'utf8');
  assert.equal(/\bfetch\s*\(/.test(source), false, 'el modulo de cobertura es puro: nunca hace red');
  assert.equal(/Date\.now\(|Math\.random\(/.test(source), false, 'la cobertura no puede depender de reloj ni de aleatoriedad');
  assert.equal(/node:fs|node:child_process/.test(source), false, 'el modulo de cobertura no toca disco ni procesos');
}

// ===========================================================================
// 3. El tope oficial se conserva, pero lo que queda fuera se ENUMERA.
// ===========================================================================
{
  assert.equal(TENDER_OFFICIAL_DOCUMENT_SELECTION_CAP, 40, 'el tope oficial de 40 documentos se preserva');
  assert.equal(TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON, 'official_document_omitted_by_selection_cap');

  // Proceso determinista de 43 documentos: los 7 reales + 36 sinteticos.
  const overflow = [
    ...fixture.documents,
    ...Array.from({ length: 36 }, (_, index) => {
      const ordinal = String(index + 8).padStart(4, '0');
      return {
        id_documento: `SECOP-DOC-${ordinal}`,
        nombre_archivo: `COTIZACION ADICIONAL ${ordinal}.pdf`,
        extensi_n: 'pdf',
        url_descarga_documento: {
          url: `https://community.secop.gov.co/Public/Tendering/Attachment/Download?docUniqueIdentifier=SECOP-DOC-${ordinal}&token=t0ken-secreto-${ordinal}`,
        },
      };
    }),
  ];
  assert.equal(overflow.length, 43);

  const partial = selectSecop(overflow);
  assert.equal(partial.selected.length, TENDER_OFFICIAL_DOCUMENT_SELECTION_CAP, 'el tope se respeta');
  assert.deepEqual(
    partial.selected.map(secopId),
    overflow.slice(0, 40).map(secopId),
    'el tope corta por orden de publicacion, de forma deterministica',
  );
  assert.equal(partial.coverage.status, 'partial', 'dejar documentos fuera nunca puede reportarse como cobertura completa');
  assert.equal(partial.coverage.total_official_documents, 43);
  assert.equal(partial.coverage.selected_count, 40);
  assert.equal(partial.coverage.omitted_count, 3);

  assert.deepEqual(
    partial.coverage.omitted_documents,
    [
      { document_id: 'SECOP-DOC-0041', name: 'COTIZACION ADICIONAL 0041.pdf', reason: TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON },
      { document_id: 'SECOP-DOC-0042', name: 'COTIZACION ADICIONAL 0042.pdf', reason: TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON },
      { document_id: 'SECOP-DOC-0043', name: 'COTIZACION ADICIONAL 0043.pdf', reason: TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON },
    ],
    'todo documento por encima del tope se enumera con identidad y motivo, nunca se omite en silencio',
  );
  assert.deepEqual(partial.omitted, partial.coverage.omitted_documents);

  // La enumeracion no puede convertirse en un canal de fuga: la URL de descarga
  // de SECOP lleva token y jamas debe viajar en la cobertura.
  const serialized = JSON.stringify(partial.coverage);
  assert.equal(serialized.includes('token='), false, 'la cobertura nunca expone la URL firmada de descarga');
  assert.equal(serialized.includes('community.secop.gov.co'), false, 'la cobertura enumera identidad y nombre, no endpoints');

  // Determinismo del recorte.
  assert.deepEqual(selectSecop(overflow).coverage, partial.coverage);

  // El tope es inyectable para pruebas, pero por defecto es el oficial.
  const tiny = selectSecop(fixture.documents, { cap: 2 });
  assert.equal(tiny.selected.length, 2);
  assert.equal(tiny.coverage.status, 'partial');
  assert.equal(tiny.coverage.omitted_count, 5);
  assert.deepEqual(
    tiny.coverage.omitted_documents.map(item => item.name),
    fixture.documents.slice(2).map(secopName),
  );
}

// ===========================================================================
// 4. La cobertura parcial se traduce en gaps del inventario -> falla cerrado.
// ===========================================================================
{
  const tiny = selectSecop(fixture.documents, { cap: 2 });
  const gaps = tenderOfficialCoverageGaps(tiny.coverage);
  assert.deepEqual(
    gaps,
    tiny.coverage.omitted_documents.map(item => ({ document_id: item.document_id, reason: item.reason })),
    'los gaps del inventario se derivan exactamente de la enumeracion de omitidos',
  );
  assert.deepEqual(tenderOfficialCoverageGaps(complete.coverage), [], 'una cobertura completa no inventa gaps');

  // La forma es exactamente la que consume buildTenderRequirementInventory.
  const snapshotId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const inventory = buildTenderRequirementInventory({ snapshotId, documents: [], documentGaps: gaps });
  assert.equal(inventory.expedient_coverage.status, 'partial', 'un documento oficial omitido impide declarar cobertura integral');
  assert.equal(inventory.coverage_ledger.unresolved_visible_count, 5);
  assert.deepEqual(
    inventory.source_units.map(unit => unit.reason).sort(),
    Array.from({ length: 5 }, () => TENDER_OFFICIAL_DOCUMENT_OMITTED_REASON),
    'cada documento omitido queda visible con su propio motivo, no agregado',
  );
  assert.equal(inventory.decision_ready, false);
  assert.equal(inventory.human_review_required, true);
}

// ===========================================================================
// 5. Fail-closed sobre identidad: nada entra ni se omite sin identidad estable.
// ===========================================================================
{
  assert.throws(
    () => selectSecop([{ nombre_archivo: 'SIN IDENTIDAD.pdf', url_descarga_documento: { url: 'https://community.secop.gov.co/x' } }]),
    /identidad/i,
    'un documento oficial sin identidad estable no puede seleccionarse ni omitirse anonimamente',
  );
  assert.throws(
    () => selectSecop([{ id_documento: 'SECOP-DOC-0001' }]),
    /nombre|name/i,
    'un documento oficial sin nombre no puede enumerarse',
  );
  assert.deepEqual(selectSecop([]).coverage, {
    status: 'complete',
    total_official_documents: 0,
    selected_count: 0,
    omitted_count: 0,
    omitted_documents: [],
  }, 'un proceso sin documentos publicados no es una cobertura parcial: no hay nada omitido');
}

// ===========================================================================
// 6. La misma funcion sirve a ESU (nombre/identidad distintos), sin duplicar.
// ===========================================================================
{
  const esuDocuments = [
    { name: 'ANALISIS DEL SECTOR.pdf', url: 'https://esucontratacion.com/procesos/descargar/9001' },
    { name: 'COTIZACION 1 SEGURIDAD ATLAS.pdf', url: 'https://esucontratacion.com/procesos/descargar/9002' },
  ];
  const result = selectTenderOfficialDocuments(esuDocuments, {
    nameGetter: doc => doc.name,
    idGetter: doc => `esu-${String(doc.url).match(/\/procesos\/descargar\/(\d+)/)[1]}`,
  });
  assert.equal(result.selected.length, 2, 'ESU tambien importa documentos sin palabra clave');
  assert.equal(result.coverage.status, 'complete');
}

console.log('tender-official-document-coverage.test.mjs OK');
