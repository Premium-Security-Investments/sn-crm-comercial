// Nuestras observaciones al pliego, para el análisis (Juan, 2026-11-17).
//
// El 17-nov, TAC Seguridad pidió a la DEAJ que en una unión temporal baste un integrante con sede en Bogotá. Es lo mismo
// que pide nuestra observación 2, radicada ese día. Vig-IA no lo vio, porque el análisis no sabía qué habíamos pedido:
// recomendó «pedir la aclaración» cuando ya estaba pedida. El agente llegó a la conclusión correcta porque tenía nuestra
// carta al lado. Este módulo le da a la síntesis lo mismo: el texto de nuestras cartas de observaciones de este proceso.
//
// Las cartas son documentos del expediente con origen `propio` (llegan de la carpeta de radicación de SharePoint con el
// trabajo de borradores, o las carga una persona). No son reglas del proceso: sirven para no pedir dos veces lo mismo y
// para leer las respuestas de la entidad contra lo que preguntamos.
import { selectCanonicalExtractionsByDocumentVersion } from './tender-document-extraction-persistence.js';

const OUR_LETTER = /observaci/i;
const NOT_A_LETTER = /nota|leeme|l[eé]ame|constancia|respuesta|instructivo/i;
const MAX_LETTERS = 6;
const MAX_CHARS_PER_LETTER = 60_000;

// La constancia de radicación que deja quien radica (`CONSTANCIA_RADICACION_<fecha>.pdf`). Es la única prueba de que una
// carta se presentó: el 17-nov el reanálisis de la DEAJ dijo «ya están radicadas» sólo porque la carta estaba en el
// expediente, y Katherine todavía no la había radicado (Juan lo preguntó).
const RECEIPT = /constancia/i;
const MAX_CHARS_PER_RECEIPT = 5_000;

/** ¿Es una constancia de radicación nuestra? Por origen declarado y nombre. Pura. */
export function isAgt002OurRadicationReceipt(version) {
  return version?.origin === 'propio' && version?.current === true && RECEIPT.test(String(version?.name || ''));
}

// La otra prueba: quien radica marca «Hecho» en Mi día sobre el plazo de observaciones (Katherine, DEAJ, 17-nov 4:59 p. m.,
// sin constancia en la carpeta). Es su declaración: va con su nombre y su hora. La clave del ítem es
// `<oportunidad>|<tipo de plazo>|<fecha del plazo>` (mi día de licitaciones, #711).
const MI_DIA_TRAMITES = Object.freeze({
  OBSERVATIONS: 'Observaciones al pliego definitivo',
  PROJECT_OBSERVATIONS: 'Observaciones al proyecto de pliego',
});

/** Los «Hecho» de Mi día sobre los plazos de observaciones, para el modelo. Pura. */
export function agt002RadicacionesMarcadasForModel(hechos, nombres = new Map()) {
  return (hechos || [])
    .map(hecho => {
      const [, kind, plazo] = String(hecho?.item_key || '').split('|');
      if (!MI_DIA_TRAMITES[kind]) return null;
      return {
        tipo: 'radicacion_marcada_en_mi_dia',
        tramite: MI_DIA_TRAMITES[kind],
        plazo: plazo || null,
        marcada_por: nombres.get(hecho.done_by) || null,
        marcada_el: hecho.done_at ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.marcada_el || '').localeCompare(String(a.marcada_el || '')));
}

/** ¿Es una carta de observaciones nuestra? Por origen declarado y nombre. Pura. */
export function isAgt002OurObservationLetter(version) {
  const name = String(version?.name || '');
  return version?.origin === 'propio' && version?.current === true && OUR_LETTER.test(name) && !NOT_A_LETTER.test(name);
}

/**
 * Las cartas vigentes, de la más reciente a la más vieja, con su texto canónico, y después las constancias de
 * radicación. Cada elemento dice su `tipo`. Lo que pasa del tope de caracteres se recorta y se dice. Pura.
 */
export function agt002NuestrasObservacionesForModel(versions, extractionRows) {
  const canonical = selectCanonicalExtractionsByDocumentVersion(extractionRows);
  const textOf = version => {
    const row = canonical.get(version.id);
    return row?.status === 'ok' ? String(row.extracted_text || '') : '';
  };
  const receipts = (versions || [])
    .filter(isAgt002OurRadicationReceipt)
    .map(version => ({ version, text: textOf(version) }))
    .sort((a, b) => String(b.version.created_at || '').localeCompare(String(a.version.created_at || '')))
    .map(({ version, text }) => ({
      tipo: 'constancia_de_radicacion',
      nombre: version.name,
      cargada_el: version.created_at ?? null,
      texto: text.length > MAX_CHARS_PER_RECEIPT ? `${text.slice(0, MAX_CHARS_PER_RECEIPT)}\n[… recortada]` : text,
    }));
  const letters = (versions || [])
    .filter(isAgt002OurObservationLetter)
    .map(version => {
      const row = canonical.get(version.id);
      const text = row?.status === 'ok' ? String(row.extracted_text || '') : '';
      return { version, text };
    })
    .filter(item => item.text.trim())
    .sort((a, b) => String(b.version.created_at || '').localeCompare(String(a.version.created_at || '')))
    .slice(0, MAX_LETTERS)
    .map(({ version, text }) => ({
      tipo: 'carta',
      nombre: version.name,
      cargada_el: version.created_at ?? null,
      texto: text.length > MAX_CHARS_PER_LETTER ? `${text.slice(0, MAX_CHARS_PER_LETTER)}\n[… carta recortada: sigue en el expediente]` : text,
    }));
  return letters.length ? [...letters, ...receipts] : [];
}

async function loadRadicacionesMarcadas(database, opportunityId) {
  try {
    const { data: hechos, error } = await database.from('psi_tender_mi_dia_hechos').select('item_key,done_by,done_at').eq('opportunity_id', opportunityId);
    if (error || !hechos?.length) return [];
    const ids = [...new Set(hechos.map(hecho => hecho.done_by).filter(Boolean))];
    const { data: perfiles } = ids.length ? await database.from('psi_sales_profiles').select('id,full_name').in('id', ids) : { data: [] };
    return agt002RadicacionesMarcadasForModel(hechos, new Map((perfiles || []).map(perfil => [perfil.id, perfil.full_name])));
  } catch {
    return [];
  }
}

/** Lee las cartas, las constancias y los «Hecho» de Mi día de la oportunidad. Si algo falla, el análisis sigue sin eso. */
export async function loadAgt002NuestrasObservaciones(database, { opportunityId }) {
  const marcadas = await loadRadicacionesMarcadas(database, opportunityId);
  return [...(await loadLettersAndReceipts(database, opportunityId)), ...marcadas];
}

async function loadLettersAndReceipts(database, opportunityId) {
  try {
    const { data: versions, error } = await database.from('psi_tender_document_versions')
      .select('id,name,origin,current,created_at').eq('opportunity_id', opportunityId).eq('current', true).eq('origin', 'propio');
    if (error) return [];
    const letters = (versions || []).filter(version => isAgt002OurObservationLetter(version) || isAgt002OurRadicationReceipt(version));
    if (!letters.length) return [];
    const { data: extractions, error: extractionError } = await database.from('psi_tender_document_extractions')
      .select('id,document_version_id,extractor_version,status,extracted_text,text_hash,char_count,created_at')
      .in('document_version_id', letters.map(version => version.id));
    if (extractionError) return [];
    return agt002NuestrasObservacionesForModel(letters, extractions || []);
  } catch {
    return [];
  }
}

export const AGT002_NUESTRAS_OBSERVACIONES_POLICY = ' NUESTRAS OBSERVACIONES. nuestras_observaciones trae, con tipo "carta", el texto de las cartas de observaciones que la empresa redactó para este proceso (nombre del archivo y fecha de carga al expediente); con tipo "constancia_de_radicacion", las constancias de radicación que haya; y con tipo "radicacion_marcada_en_mi_dia", los trámites de observaciones (tramite y plazo) que la persona que radica marcó como hechos en Mi día (marcada_por, marcada_el). No son reglas del proceso. Que una carta esté aquí NO prueba que se haya presentado a la entidad. Una carta cuenta como radicada si hay una constancia cuya fecha y proceso le correspondan, o si su trámite está marcado en Mi día: en ese caso dígalo con nombre y hora ("radicada según <marcada_por>, Mi día, <marcada_el en hora de Colombia>"). Si no hay ni constancia ni marca, diga "nuestra carta del <fecha> (radicación por confirmar)" y ponga como pendiente confirmar la radicación antes del plazo; nunca escriba que ya se radicó. Úselas así: (1) cuando la carta de un tercero pida algo que ya pide una carta nuestra, dígalo en el hallazgo ("lo mismo pide nuestra observación N de <carta>"), porque dos solicitudes iguales pesan más ante la entidad, y no recomiende redactarlo de nuevo; (2) en un pendiente, no proponga observar algo que ya está en nuestras cartas: el pendiente es asegurar su radicación (si no hay constancia) y leer la respuesta de la entidad; (3) cuando la entidad responda, compare su respuesta con lo que pedimos y diga si lo aceptó, lo negó o no lo contestó.';
