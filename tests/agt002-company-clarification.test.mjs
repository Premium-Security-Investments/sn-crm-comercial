// Punto 4 de la definición de Juan (2026-10-21): si la aclaración es de la empresa, Vig-IA propone guardarla en la
// ficha. Los casos son las siete aclaraciones reales que Juan escribió el 2026-10-21 en ESU, Supersalud y Fiscalía.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AGT002_COMPANY_CLARIFICATION_LINE_MAX,
  agt002CompanyClarificationLine,
  agt002CompanyClarificationSuggestion,
} from '../agt002-company-clarification.js';

const juan = (content, target_label = null) => ({
  id: 'c1', content, target_kind: target_label ? 'requirement' : null, target_id: target_label ? 'CLM-X' : null,
  target_label, created_at: '2026-10-21T20:05:58.931Z', author_name: 'Juan Botero',
});

test('un dato de la empresa se propone para la ficha, con el tema donde queda', () => {
  const experiencia = agt002CompanyClarificationSuggestion(juan('El contrato 70 de Tiendas Ara (49.114 SMMLV) ya cubre el valor exigido; está en el RUP del 17-jun-2026.', 'Experiencia por demostrar'));
  assert.equal(experiencia.company, true);
  assert.equal(experiencia.topicLabel, 'RUP y códigos');
  const sede = agt002CompanyClarificationSuggestion(juan('Esto no deberia estar aca pues usted en la informacion de la empresa sabe que si tenemos sede en Medellin', 'El proponente debe tener sede'));
  assert.equal(sede.company, true);
  assert.equal(sede.topicLabel, 'sedes y agencias');
  const bogota = agt002CompanyClarificationSuggestion(juan('Pero usted tiene claro que tenemos agencia en Bogota no se por que no esta analizando esto con seriedad', 'Requisito habilitante'));
  assert.equal(bogota.company, true);
  assert.equal(bogota.topicLabel, 'sedes y agencias');
  const financiero = agt002CompanyClarificationSuggestion(juan('Usted al analizar nuestro RUP debio darse cuenta que esto no es una limitante', 'Indicadores financieros'));
  assert.equal(financiero.company, true);
});

test('lo que es de esta licitación no se propone para la ficha', () => {
  const observacion = agt002CompanyClarificationSuggestion(juan('Vamos a pasar este punto en observaciones: Consideración: El numeral 4.3.1 concentra en un solo contrato cinco capacidades técnicas.', 'Experiencia específica'));
  assert.equal(observacion.company, false);
  assert.match(observacion.reason, /este proceso/i);
  const codigos = agt002CompanyClarificationSuggestion(juan('Vamos a enviar unas observaciones: Consideración: El mínimo de quince (15) de treinta y tres (33) códigos puede limitar la participación.', 'Códigos UNSPSC'));
  assert.equal(codigos.company, false);
  // Un reclamo sobre cómo el pliego clasifica algo tampoco es un dato de la ficha.
  const rechazo = agt002CompanyClarificationSuggestion(juan('Pero y esto por que es una causal de rechazo, es decir el hecho de que solo se puedan presentar personas juridicas no es una causal de rechazo debido a que Seguridad nacional es una persona juridica', 'Solo personas jurídicas'));
  assert.equal(rechazo.company, false);
});

test('ante la duda no propone: sin tema de la ficha, o sin afirmar nada de la empresa', () => {
  assert.equal(agt002CompanyClarificationSuggestion(juan('Revisar esto con calma mañana.')).company, false);
  const sinVoz = agt002CompanyClarificationSuggestion(juan('La experiencia se acredita con hasta cinco contratos inscritos.'));
  assert.equal(sinVoz.company, false);
  assert.equal(sinVoz.topicLabel, 'experiencia acreditada', 'reconoce el tema aunque no proponga');
  assert.match(sinVoz.reason, /no afirma nada sobre la empresa/i);
  assert.equal(agt002CompanyClarificationSuggestion({ content: '   ' }).company, false);
  assert.equal(agt002CompanyClarificationSuggestion(null).company, false);
});

test('la línea de la ficha lleva el dato y de dónde salió, y se acota', () => {
  const line = agt002CompanyClarificationLine(juan('En Medellín tenemos agencia desde 2019.', 'Sede en Medellín'), { tenderLabel: 'ESU 2026-5' });
  assert.match(line, /^En Medellín tenemos agencia desde 2019\./);
  assert.match(line, /aclaración de Juan Botero del 21-10-2026 en ESU 2026-5 sobre «Sede en Medellín»/);
  // Sin autor conocido queda el rol, no un nombre inventado.
  assert.match(agt002CompanyClarificationLine({ content: 'Tenemos agencia en Cali.', created_at: '2026-10-21T00:00:00Z' }), /aclaración de Encargado de la licitación/);
  // La forma que usa el análisis incremental también sirve.
  assert.match(agt002CompanyClarificationLine({ aclaracion: 'Tenemos sede propia en Pereira.', autor: 'Juan Botero', fecha: '2026-10-20', punto: 'Domicilio' }), /^Tenemos sede propia en Pereira\. \(aclaración de Juan Botero del 20-10-2026 sobre «Domicilio»\)\.$/);
  const larga = agt002CompanyClarificationLine(juan(`Tenemos sede en Pereira. ${'dato '.repeat(200)}`));
  assert.ok(larga.length <= AGT002_COMPANY_CLARIFICATION_LINE_MAX, 'la línea no desborda la ficha');
});

test('la ruta que escribe la ficha existe en los dos backends, pide el permiso de la ficha y sólo agrega', () => {
  for (const file of ['../server/index.js', '../api/[...path].js']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    assert.match(source, /'POST \/api\/agt002-clarification-to-company-profile': \['tenders', ACTIONS\.LICITACIONES_COMPANY_PROFILE_UPDATE\]/, `${file}: la ruta pide el permiso de la ficha`);
    assert.match(source, /requireAction\(currentProfile, ACTIONS\.LICITACIONES_COMPANY_PROFILE_UPDATE\)/);
    assert.match(source, /useful_company_info: \[existing, line\]\.filter\(Boolean\)\.join\('\\n'\)/, `${file}: agrega, no reescribe`);
    assert.match(source, /company_profile_suggestion: suggestion/, `${file}: al registrar la aclaración se devuelve la propuesta`);
  }
});

test('la pantalla propone y no guarda sola', () => {
  const clarify = readFileSync(new URL('../src/tenders/workspace/TenderClarify.tsx', import.meta.url), 'utf8');
  assert.match(clarify, /Esto parece un dato de la empresa/);
  assert.match(clarify, /Guardar en la ficha de la empresa/);
  assert.match(clarify, /Solo para esta licitación/, 'se puede descartar la propuesta');
  assert.match(clarify, /Texto que queda en la ficha \(puede editarlo\)/, 'el texto es editable antes de guardar');
  const workspace = readFileSync(new URL('../src/tenders/workspace/TenderWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(workspace, /clarify\?\.canSaveToCompany/, 'la propuesta sólo aparece si la persona puede escribir la ficha');
});
