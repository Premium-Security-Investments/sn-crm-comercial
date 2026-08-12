import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  classifyRegistroDocumentProvenance,
  sectionizeVigentePliego,
  buildContractualRegistry,
  AGT002_CONTRACTUAL_REGISTRY_ARTIFACT_TYPE,
} from '../agt002-contractual-registry.js';
import { assertNoOpenPii } from '../agt002-contractual-registry-taxonomy.js';

// Orden canónico de un numeral de pliego: comparación componente a componente numérica
// (1.1 < 1.2 < 1.2.1 < 1.10 < 2.1 < ... < 6.16). Sirve para verificar que las secciones
// registradas salen en su posición corporal y no reordenadas por una ocurrencia del índice.
function numeralCompare(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x !== y) return x - y;
  }
  return 0;
}

// Synthetic pliego that reproduces the real document's quirks: a table of contents that
// repeats every numeral heading with no body, then the real body; a Capítulo VI whose roman
// rótulo is OCR-mislabeled "CAPITULO IV"; an indicator table; an enumerated document list;
// an embedded cédula that must be scrubbed. No real PII, no real values copied verbatim.
const VIGENTE_PLIEGO = `
                          PLIEGO DE CONDICIONES DEFINITIVO
                                PROCESO SA-24-2026

TABLA DE CONTENIDO
1.2. OBJETO
2.1. CAPACIDAD JURIDICA
2.2. CAPACIDAD FINANCIERA
2.4. EXPERIENCIA
3.6. FACTOR ECONOMICO
6.5. GARANTIAS CONTRACTUALES

CAPITULO I

1.2. OBJETO:
Contratar la prestacion del servicio de vigilancia y seguridad privada armada para los
despachos judiciales y sedes administrativas del distrito judicial de Manizales.

CAPITULO II

2.1. CAPACIDAD JURIDICA:
El proponente debera allegar los siguientes documentos habilitantes. Se incluye la Poliza
Permanente de Responsabilidad Civil Extracontractual (Articulo 11) como requisito.
1. Carta de presentacion de la propuesta:
El proponente diligenciara el Anexo 1, 2 o 3 segun corresponda.
2. Documento de identificacion:
Copia de la cedula de ciudadania 79.123.456 del representante legal.
3. Registro Unico de Proponentes:
Cada oferente debe aportar el RUP que se encuentre vigente a la fecha de cierre.

2.2. CAPACIDAD FINANCIERA:
Los oferentes deberan cumplir los siguientes indicadores calculados sobre el RUP.
Capital de Trabajo mayor o igual al 50% del Presupuesto Oficial Estimado.
Liquidez mayor o igual a 1.5.
Endeudamiento menor o igual al 60%.

2.4. EXPERIENCIA:
Se verificaran entre uno y tres contratos inscritos en el RUP cuya sumatoria sea igual o
mayor a 1000 SMMLV en los codigos UNSPSC del clasificador.

CAPITULO III

3.6. FACTOR ECONOMICO:
La oferta economica se presenta en el Anexo No. 9 y debe respetar la tarifa minima
reglamentada. El factor economico otorga puntaje.

CAPITULO IV

6.5. GARANTIAS CONTRACTUALES:
El proponente seleccionado debera constituir garantia de cumplimiento del 20% del contrato
y una poliza de responsabilidad civil extracontractual por 400 SMMLV.
`;

const PROYECTO_PLIEGO = `
                          PROYECTO DE PLIEGO DE CONDICIONES
2.2. CAPACIDAD FINANCIERA:
Version preliminar sujeta a observaciones. Capital de Trabajo mayor o igual al 40%.
`;

const RESPUESTA_OBS = `
RESPUESTAS A LAS OBSERVACIONES PRESENTADAS AL PROYECTO DEL PLIEGO DE CONDICIONES
Se responden las observaciones de los interesados.
`;

function corpus() {
  return [
    { document_id: 'doc-def', name: '9. Pliego de Condiciones Definitivo SA-24-2026.pdf', document_type: 'pliego', content: VIGENTE_PLIEGO },
    { document_id: 'doc-proj', name: '3. Proyecto Pliego de Condiciones SA-24-2026.pdf', document_type: 'pliego', content: PROYECTO_PLIEGO },
    { document_id: 'doc-obs', name: '7. Respuesta observaciones al proyecto del pliego.pdf', document_type: 'pliego', content: RESPUESTA_OBS },
    { document_id: 'doc-est', name: '2. Estudios previos SA-24-2026.pdf', document_type: 'estudios_previos', content: 'Estudios previos. Presupuesto oficial estimado.' },
    { document_id: 'doc-sec', name: '1. Estudios Sector SA-24-2026.pdf', document_type: 'estudios_previos', content: 'Estudios del sector economico.' },
    { document_id: 'doc-of9', name: 'Anexo No. 9 Oferta economica SA-24-2026.xlsx', document_type: 'anexo_tecnico', content: 'oferta economica base' },
    { document_id: 'doc-of9a', name: 'Anexo No. 9 Oferta economica SA-24-2026 Ajustado.xlsx', document_type: 'anexo_tecnico', content: 'oferta economica ajustada' },
    { document_id: 'doc-a1', name: 'Anexo No. 1 Carta Presentacion Persona Natural.pdf', document_type: 'anexo_tecnico', content: 'carta persona natural' },
    { document_id: 'doc-a6', name: 'Anexo No. 6 Requisitos SGSST.pdf', document_type: 'anexo_tecnico', content: 'requisitos sgsst del contratista' },
  ];
}

test('provenance distinguishes vigente pliego from proyecto/observaciones/anexos', () => {
  const { documents, vigente_pliego } = classifyRegistroDocumentProvenance(corpus());
  const byId = Object.fromEntries(documents.map(d => [d.document_id, d]));
  assert.equal(byId['doc-def'].provenance_kind, 'pliego_definitivo');
  assert.equal(byId['doc-def'].vigencia, 'vigente');
  assert.equal(byId['doc-def'].is_vigente_pliego, true);
  assert.equal(byId['doc-proj'].provenance_kind, 'pliego_proyecto');
  assert.equal(byId['doc-proj'].vigencia, 'superseded');
  assert.equal(byId['doc-obs'].provenance_kind, 'respuesta_observaciones');
  assert.equal(byId['doc-obs'].vigencia, 'historico');
  assert.equal(byId['doc-sec'].provenance_kind, 'estudios_sector');
  // The "Ajustado" economic offer is vigente; the earlier one is superseded.
  assert.equal(byId['doc-of9a'].vigencia, 'vigente');
  assert.equal(byId['doc-of9'].vigencia, 'superseded');
  assert.equal(byId['doc-a1'].provenance_kind, 'anexo_formato');
  assert.equal(byId['doc-a6'].provenance_kind, 'anexo_requisito');
  assert.deepEqual(vigente_pliego, { resolved: true, document_id: 'doc-def', name: '9. Pliego de Condiciones Definitivo SA-24-2026.pdf' });
});

test('two definitivos fail closed: unresolved vigente pliego + data gap, no items', () => {
  const docs = corpus();
  docs.push({ document_id: 'doc-def2', name: 'Otro Pliego Definitivo.pdf', document_type: 'pliego', content: VIGENTE_PLIEGO });
  const provenance = classifyRegistroDocumentProvenance(docs);
  assert.equal(provenance.vigente_pliego.resolved, false);
  assert.equal(provenance.vigente_pliego.reason, 'multiple_definitivo_pliegos_found');
  const registry = buildContractualRegistry({ documents: docs });
  assert.equal(registry.items.length, 0);
  assert.ok(registry.data_gaps.some(g => g.gap_id === 'vigente-pliego-unresolved'));
});

test('sectionizer dedups TOC vs body by numeral and maps fases by numeral integer', () => {
  const sections = sectionizeVigentePliego(VIGENTE_PLIEGO);
  const numerals = sections.map(s => s.numeral);
  // Each numeral appears exactly once (TOC copies dropped).
  assert.deepEqual([...new Set(numerals)], numerals);
  assert.ok(numerals.includes('2.1') && numerals.includes('2.2') && numerals.includes('6.5'));
  const byNum = Object.fromEntries(sections.map(s => [s.numeral, s]));
  assert.equal(byNum['2.1'].fase, 'habilitante');
  assert.equal(byNum['3.6'].fase, 'puntuable');
  // 6.5 is postadjudicacion despite the OCR "CAPITULO IV" rótulo (mapped by integer 6).
  assert.equal(byNum['6.5'].fase, 'postadjudicacion');
});

test('registry is exhaustive, typed, abstains and never asserts compliance', () => {
  const registry = buildContractualRegistry({ documents: corpus(), opportunityId: 'opp-1', generatedAt: '2026-08-12T00:00:00.000Z' });
  assert.equal(registry.artifact_type, AGT002_CONTRACTUAL_REGISTRY_ARTIFACT_TYPE);
  assert.equal(registry.human_approval_required, true);
  assert.ok(registry.items.length >= 5);

  const byNum = Object.fromEntries(registry.items.map(i => [i.numeral, i]));
  // Categories inferred by closed rules.
  assert.equal(byNum['2.1'].categoria, 'juridico');
  assert.equal(byNum['2.2'].categoria, 'financiero');
  assert.equal(byNum['2.4'].categoria, 'experiencia');
  assert.equal(byNum['6.5'].categoria, 'seguros_garantias');

  // Every item keeps the four dimensions separate; compliance is never evaluated.
  for (const item of registry.items) {
    assert.equal(item.dimensiones.cumplimiento, 'no_evaluado');
    assert.equal(item.dimensiones.aplicabilidad, 'no_determinada');
    assert.equal(item.dimensiones.vigencia, 'vigente');
    assert.equal(item.evidencia_empresarial, 'not_assessed');
    assert.equal(item.estado_probatorio, 'requisito_pliego');
  }

  // Closed threshold extraction fired where expected.
  assert.equal(byNum['2.2'].umbral.detectado, true);
  const etiquetas = byNum['2.2'].umbral.senales.map(s => s.etiqueta);
  assert.ok(etiquetas.includes('capital_de_trabajo'));
  assert.ok(etiquetas.includes('liquidez'));
  assert.equal(byNum['2.4'].umbral.detectado, true);
  assert.ok(byNum['2.4'].umbral.senales.some(s => s.valores.join(' ').includes('1000')));

  // Sub-items enumerated (the 3 juridico documents).
  assert.equal(byNum['2.1'].sub_items.length, 3);
  assert.equal(byNum['2.1'].sub_items[0].ordinal, 1);

  // Superset of the closed governed extractor: RCE appears as governed requirement match.
  assert.ok(byNum['6.5'].governed_requirement_ids.includes('legal-rce-policy'));
});

test('registry surfaces coverage, abstentions and a controlled-vocabulary ledger', () => {
  const registry = buildContractualRegistry({ documents: corpus() });
  assert.equal(registry.coverage.total_items, registry.items.length);
  assert.ok(registry.coverage.por_fase.habilitante >= 2);
  assert.ok(registry.coverage.con_umbral >= 2);

  // Every item abstains on aplicabilidad; unknown-category / no-threshold abstentions exist.
  const axes = new Set(registry.abstentions.map(a => a.axis));
  assert.ok(axes.has('aplicabilidad'));

  // Ledger uses only the controlled vocabulary and always carries a limitation.
  const allowedTypes = new Set(['requisito_pliego', 'conteo_estructural', 'observado', 'contradiccion', 'limite_probatorio', 'privacidad', 'abstencion']);
  for (const claim of registry.ledger) {
    assert.ok(allowedTypes.has(claim.type), `unexpected ledger type ${claim.type}`);
    assert.ok(typeof claim.limitation === 'string' && claim.limitation.length > 0);
    assert.ok(Array.isArray(claim.evidence));
  }
  assert.ok(registry.ledger.some(c => c.type === 'limite_probatorio'));
  // RCE present as habilitante requirement AND postadjudicacion guarantee -> contradiccion.
  assert.ok(registry.ledger.some(c => c.type === 'contradiccion'));
});

test('artifact keeps PII out of the open registry (embedded cedula scrubbed)', () => {
  const registry = buildContractualRegistry({ documents: corpus() });
  const serialized = JSON.stringify(registry);
  assert.ok(!serialized.includes('79.123.456'), 'cedula must be scrubbed from excerpts');
  assert.doesNotThrow(() => assertNoOpenPii(registry));
});

// --- Regresión del defecto de e22c7cf -------------------------------------------------
//
// Fixture realista que reproduce EXACTAMENTE el quirk del pliego real que engañó al
// deduplicador: (1) un bloque completo de TABLA DE CONTENIDO que lista todos los numerales
// seguidos; (2) en el cuerpo, la sección 5.4 va seguida INMEDIATAMENTE por su sub-numeral
// 5.4.1 — de modo que el "cuerpo directo" de la 5.4 corporal es diminuto, mientras que su
// ocurrencia del índice (cuyo cuerpo aparente llega hasta el título del CAPITULO VI y el 6.1)
// supera el umbral MIN_BODY_CHARS. Con el bug, el dedup por bodyLen conserva la 5.4 del ÍNDICE
// (char_start pequeño, excerpt = índice) y descarta la 5.4 corporal. Separado por un pie de
// página realista (como el pliego escaneado) entre el fin del índice y el cuerpo.
const PLIEGO_CON_TOC = `
                              PLIEGO DE CONDICIONES DEFINITIVO
                                     PROCESO SA-24-2026

CONTENIDO


                                     CAPITULO I
                            DESCRIPCION GENERAL DEL PROCESO
1.1. IDENTIFICACION EN EL CLASIFICADOR
1.2. OBJETO

                                     CAPITULO II
                                REQUISITOS HABILITANTES
2.1. CAPACIDAD JURIDICA
2.2. CAPACIDAD FINANCIERA
2.4. EXPERIENCIA

                                     CAPITULO III
                          FACTORES DE ESCOGENCIA Y PONDERACION
3.6. FACTOR ECONOMICO

                                     CAPITULO V
                       ESPECIFICACIONES DE LOS SERVICIOS A CONTRATAR
5.1. UBICACION DE LOS SERVICIOS
5.2. OBLIGACIONES DEL CONTRATISTA
5.3. JEFE O COORDINADOR DE SEGURIDAD
5.4. PERSONAL QUE PRESTARA EL SERVICIO DE VIGILANCIA

                                     CAPITULO VI
                          CONDICIONES GENERALES DEL CONTRATO
6.1. REGIMEN LEGAL
6.5. GARANTIAS CONTRACTUALES


Calle 27 No 17 - 19 Tel (076) 8848353 - fax 8844827
www.ramajudicial.gov.co
Hoja No. 5


                                     CAPITULO I
                            DESCRIPCION GENERAL DEL PROCESO

1.1. IDENTIFICACION EN EL CLASIFICADOR:
El objeto se identifica con los codigos UNSPSC del clasificador de bienes y servicios que
correspondan al servicio de vigilancia y seguridad privada armada requerido por la entidad.

1.2. OBJETO:
Contratar la prestacion del servicio de vigilancia y seguridad privada armada para los
despachos judiciales y sedes administrativas del distrito judicial de Manizales.

                                     CAPITULO II
                                REQUISITOS HABILITANTES

2.1. CAPACIDAD JURIDICA:
El proponente debera allegar los siguientes documentos habilitantes para acreditar su
capacidad juridica ante la entidad contratante en debida forma.
1. Carta de presentacion de la propuesta:
El proponente diligenciara el Anexo 1, 2 o 3 segun corresponda a su naturaleza juridica.
2. Documento de identificacion:
Copia de la cedula de ciudadania 79.123.456 del representante legal de la firma proponente.
3. Registro Unico de Proponentes:
Cada oferente debe aportar el RUP que se encuentre vigente a la fecha de cierre del proceso.

2.2. CAPACIDAD FINANCIERA:
Los oferentes deberan cumplir los siguientes indicadores calculados sobre el RUP vigente.
Capital de Trabajo mayor o igual al 50% del Presupuesto Oficial Estimado del proceso.
Liquidez mayor o igual a 1.5 conforme al registro unico de proponentes aportado.
Endeudamiento menor o igual al 60% segun la informacion financiera registrada.

2.4. EXPERIENCIA:
Se verificaran entre uno y tres contratos inscritos en el RUP cuya sumatoria sea igual o
mayor a 1000 SMMLV en los codigos UNSPSC del clasificador aplicables al objeto contractual.

                                     CAPITULO III
                          FACTORES DE ESCOGENCIA Y PONDERACION

3.6. FACTOR ECONOMICO:
La oferta economica se presenta en el Anexo No. 9 y debe respetar la tarifa minima
reglamentada por la Superintendencia. El factor economico otorga puntaje a la propuesta.

                                     CAPITULO V
                       ESPECIFICACIONES DE LOS SERVICIOS A CONTRATAR

5.1. UBICACION DE LOS SERVICIOS:
Los servicios se prestaran en las sedes judiciales relacionadas en el anexo tecnico del
presente pliego de condiciones definitivo, segun la distribucion alli detallada.

5.2. OBLIGACIONES DEL CONTRATISTA:
El contratista asumira las obligaciones de prestacion continua del servicio conforme a las
especificaciones tecnicas y a la normatividad de vigilancia y seguridad privada vigente.

5.3. JEFE O COORDINADOR DE SEGURIDAD:
El contratista designara un jefe o coordinador de seguridad con la experiencia y la
formacion que exige la reglamentacion de la Superintendencia de Vigilancia y Seguridad.

5.4. PERSONAL QUE PRESTARA EL SERVICIO DE VIGILANCIA:
5.4.1. Requisitos Minimos:
El personal de vigilantes que el contratista asigne al servicio debera acreditar el curso
de formacion y la credencial vigente expedida conforme a la reglamentacion aplicable.
5.4.2. Funciones Minimas:
El personal cumplira las funciones de control de acceso, rondas y reporte de novedades en
los puestos asignados dentro de las sedes judiciales del distrito de Manizales.

                                     CAPITULO VI
                          CONDICIONES GENERALES DEL CONTRATO

6.1. REGIMEN LEGAL:
El contrato se regira por el Estatuto General de Contratacion de la Administracion Publica
y por las normas civiles y comerciales pertinentes en lo no regulado por aquel estatuto.

6.5. GARANTIAS CONTRACTUALES:
El proponente seleccionado debera constituir garantia de cumplimiento del 20% del contrato
y una poliza de responsabilidad civil extracontractual por 400 SMMLV a favor de la entidad.
`;

function tocCorpus() {
  return [
    { document_id: 'doc-def', name: '9. Pliego de Condiciones Definitivo SA-24-2026.pdf', document_type: 'pliego', content: PLIEGO_CON_TOC },
  ];
}

test('(a) sectionizer selecciona NINGUNA seccion de la tabla de contenido', () => {
  const sections = sectionizeVigentePliego(PLIEGO_CON_TOC);
  // El bloque de tabla de contenido va desde "CONTENIDO" hasta el pie de página "Hoja No. 5"
  // que separa el índice del cuerpo. Ninguna sección puede originarse dentro de ese rango.
  const tocStart = PLIEGO_CON_TOC.indexOf('CONTENIDO');
  const tocEnd = PLIEGO_CON_TOC.indexOf('Hoja No. 5');
  assert.ok(tocStart > 0 && tocEnd > tocStart);
  for (const s of sections) {
    assert.ok(
      s.char_start < tocStart || s.char_start > tocEnd,
      `la seccion ${s.numeral} (char_start=${s.char_start}) proviene de la tabla de contenido`,
    );
  }
  // Cada numeral aparece exactamente una vez.
  const numerals = sections.map(s => s.numeral);
  assert.equal(new Set(numerals).size, numerals.length);
});

test('(b) orden canonico 1.1->...->6.5 con 5.4 en su posicion corporal y excerpt del cuerpo', () => {
  const registry = buildContractualRegistry({ documents: tocCorpus(), generatedAt: '2026-08-12T00:00:00.000Z' });
  const numerals = registry.items.map(i => i.numeral);
  // El artefacto sale ya ordenado por char_start; debe coincidir con el orden canónico.
  assert.deepEqual(numerals, [...numerals].sort(numeralCompare), `orden no canonico: ${numerals.join(', ')}`);

  const byNum = Object.fromEntries(registry.items.map(i => [i.numeral, i]));
  assert.ok(byNum['5.4'], '5.4 debe estar registrada');
  // 5.4 en su posición corporal: después de 5.3 y antes de 6.1.
  assert.ok(numerals.indexOf('5.4') > numerals.indexOf('5.3'));
  assert.ok(numerals.indexOf('5.4') < numerals.indexOf('6.1'));
  // Excerpt del CUERPO, no del índice: no debe arrastrar los encabezados vecinos del índice.
  const ex = byNum['5.4'].cite.excerpt;
  assert.ok(!ex.includes('GARANTIAS'), `excerpt de 5.4 proviene del indice: ${ex}`);
  assert.ok(!/6\.1\.\s+REGIMEN/.test(ex), `excerpt de 5.4 proviene del indice: ${ex}`);
});

test('(c) cada item tiene item_id determinista y unico, y cada sub_item un sub_item_id estable', () => {
  const registry = buildContractualRegistry({ documents: tocCorpus(), proceso: 'SA-24-2026', generatedAt: '2026-08-12T00:00:00.000Z' });
  const ids = registry.items.map(i => i.item_id);
  assert.ok(ids.every(id => typeof id === 'string' && id.length > 0), 'todo item requiere item_id');
  assert.equal(new Set(ids).size, ids.length, 'los item_id deben ser unicos');

  // Determinista: misma entrada ⇒ mismos ids.
  const again = buildContractualRegistry({ documents: tocCorpus(), proceso: 'SA-24-2026', generatedAt: '2026-08-12T00:00:00.000Z' });
  assert.deepEqual(again.items.map(i => i.item_id), ids);

  const withSubs = registry.items.filter(i => i.sub_items.length > 0);
  assert.ok(withSubs.length > 0, 'el fixture tiene sub-items enumerados');
  const subIds = withSubs.flatMap(i => i.sub_items.map(s => s.sub_item_id));
  assert.ok(subIds.every(id => typeof id === 'string' && id.length > 0), 'todo sub_item requiere sub_item_id');
  assert.equal(new Set(subIds).size, subIds.length, 'los sub_item_id deben ser unicos');
  for (const item of withSubs) {
    for (const sub of item.sub_items) {
      assert.ok(sub.sub_item_id.startsWith(item.item_id), 'el sub_item_id deriva del item_id padre');
    }
  }
});

test('(d) metricas separadas y honestas: secciones vs subitems, sin suma enganosa', () => {
  const registry = buildContractualRegistry({ documents: tocCorpus(), generatedAt: '2026-08-12T00:00:00.000Z' });
  const c = registry.coverage;
  assert.equal(c.secciones_registradas, registry.items.length);
  assert.equal(c.subitems_detectados, registry.items.reduce((acc, i) => acc + i.sub_items.length, 0));
  // Debe declararse una definición explícita que aclare que un subítem NO es, por sí solo,
  // un requisito independiente.
  assert.ok(c.metrica_definiciones && typeof c.metrica_definiciones === 'object');
  assert.match(
    c.metrica_definiciones.subitem_detectado,
    /no .*requisito|componente/i,
    'la definicion de subitem debe aclarar que no es un requisito independiente',
  );
  // No debe existir una suma engañosa secciones+subítems presentada como "requisitos".
  assert.ok(!('requisitos_atomizados' in c), 'no debe afirmarse una suma seccion+subitem como requisitos');
  assert.ok(!('total_requisitos' in c));
});

// Prueba contra el ARCHIVO REAL (los 17 documentos exportados localmente). Se salta si la
// exportación offline no está presente (CI sin /tmp), para no acoplar el test al entorno.
test('(real) pliego definitivo real: sin secciones del indice, orden canonico, 5.4 corporal, 17/17', (t) => {
  const inputDir = '/tmp/agt002-rama-originals';
  if (!existsSync(resolve(inputDir, 'manifest.json')) || !existsSync(resolve(inputDir, 'extraction-manifest.json'))) {
    t.skip('exportacion offline real no presente');
    return;
  }
  const manifest = JSON.parse(readFileSync(resolve(inputDir, 'manifest.json'), 'utf8'));
  const extraction = JSON.parse(readFileSync(resolve(inputDir, 'extraction-manifest.json'), 'utf8'));
  const extById = new Map((extraction.documents || []).map(d => [d.id, d]));
  const documents = manifest.documents.map(doc => {
    const ex = extById.get(doc.id);
    let content = '';
    if (ex?.full_text_path) {
      try { content = readFileSync(ex.full_text_path, 'utf8'); } catch { content = ''; }
    }
    return { document_id: doc.id, name: doc.name, document_type: doc.document_type, content };
  });
  const registry = buildContractualRegistry({ documents, opportunityId: manifest.opportunity_id, generatedAt: '2026-08-12T00:00:00.000Z' });

  // 17/17 documentos clasificados.
  assert.equal(registry.provenance.length, 17);

  const byNum = Object.fromEntries(registry.items.map(i => [i.numeral, i]));
  // 5.4 corporal (no del índice): en el pliego real el cuerpo de 5.4 vive pasado el char 100k.
  assert.ok(byNum['5.4'], '5.4 debe estar registrada');
  assert.ok(byNum['5.4'].cite.char_start > 100000, `5.4 debe ser corporal, char_start=${byNum['5.4'].cite.char_start}`);
  assert.ok(!/6\.1\.\s+R[ÉE]GIMEN/.test(byNum['5.4'].cite.excerpt), 'excerpt de 5.4 no debe ser del indice');

  // Orden canónico completo 1.1 -> ... -> 6.16.
  const numerals = registry.items.map(i => i.numeral);
  assert.deepEqual(numerals, [...numerals].sort(numeralCompare), 'las secciones reales deben salir en orden canonico');
  assert.equal(numerals[0], '1.1');
  assert.equal(numerals[numerals.length - 1], '6.16');

  // item_id únicos y sub_item_id únicos sobre el artefacto real.
  const ids = registry.items.map(i => i.item_id);
  assert.equal(new Set(ids).size, ids.length);
  const subIds = registry.items.flatMap(i => i.sub_items.map(s => s.sub_item_id));
  assert.equal(new Set(subIds).size, subIds.length);

  // Métricas honestas.
  assert.equal(registry.coverage.secciones_registradas, registry.items.length);
  assert.doesNotThrow(() => assertNoOpenPii(registry));
});
