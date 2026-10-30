// AGT-002 — el paquete de la oferta: lo que el encargado del proceso baja para radicar (punto 3 del encargo del
// 2026-10-30; Juan: "los documentos la idea es que estén en una carpeta que el encargado del proceso pueda descargar
// para presentar").
//
// Este módulo decide **qué va, dónde va y qué falta**; no baja bytes ni arma el ZIP. El servidor resuelve la lista
// con la autorización de siempre y el navegador baja cada archivo por su propia ruta y los junta con `zip-store.js`.
// Esa división existe por una razón concreta: una función sin servidor no puede devolver 30 MB, y los documentos de
// una licitación los pasan fácil.
//
// Las doce carpetas son las que ya estaban declaradas en `tender-offer-preparation.js` desde el principio. Van
// SIEMPRE las doce, aunque queden vacías: un paquete que esconde lo que falta es peor que uno que lo muestra.
//
// Dos reglas que no se negocian:
//
//   1. **Nada se presenta como aprobado si no lo está.** Cada documento viaja con el estado de su bloque —confirmado
//      por una persona, o pendiente de confirmación— y el índice lo dice archivo por archivo. El paquete es material
//      de preparación, y el índice lo declara en su primera línea.
//   2. **Lo que falta se escribe.** Los requisitos sin soporte y los bloques sin archivo quedan listados en el
//      índice con su dueño. Es la misma información del puente y de la matriz, puesta donde la va a leer quien arma
//      la oferta.
//
// Módulo puro: sin red, sin base de datos, sin express.

export const TENDER_OFFER_PACKAGE_FOLDERS = Object.freeze([
  '00_Control', '01_Documentos_Oficiales', '02_Juridico', '03_Financiero', '04_Tecnico', '05_Experiencia',
  '06_Economico', '07_Polizas', '08_Formatos_Entidad', '09_Borradores_IA', '10_Final_Para_Revision', '11_Presentado',
]);

const CONTROL_FOLDER = '00_Control';
const OFFICIAL_FOLDER = '01_Documentos_Oficiales';
export const TENDER_OFFER_PACKAGE_INDEX_NAME = `${CONTROL_FOLDER}/00_INDICE.md`;
export const TENDER_OFFER_PACKAGE_MATRIX_NAME = `${CONTROL_FOLDER}/01_MATRIZ_DE_CUMPLIMIENTO.csv`;

/** Nombre de archivo seguro para cualquier sistema, conservando tildes y ñ. */
export function tenderOfferPackageFileName(name, fallback = 'documento') {
  const clean = String(name ?? '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return clean || fallback;
}

function uniqueName(used, folder, name) {
  const base = `${folder}/${tenderOfferPackageFileName(name)}`;
  if (!used.has(base)) { used.add(base); return base; }
  const dot = base.lastIndexOf('.');
  const stem = dot > base.lastIndexOf('/') ? base.slice(0, dot) : base;
  const extension = dot > base.lastIndexOf('/') ? base.slice(dot) : '';
  for (let copy = 2; copy < 100; copy += 1) {
    const candidate = `${stem} (${copy})${extension}`;
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
  throw new Error('Demasiados documentos con el mismo nombre en la misma carpeta.');
}

const CONFIRMED = new Set(['approved']);

/**
 * El manifiesto del paquete.
 *
 * - `bridge`: la salida de `buildTenderCompanyDocumentBridge` — de ahí sale la carpeta de cada documento
 *   corporativo, su estado al cierre y lo que falta con su dueño.
 * - `dossierDocuments`: los documentos del expediente (`psi_tender_document_versions` vigentes), que son los del
 *   proceso y van todos a `01_Documentos_Oficiales`.
 * - `matrix`: la salida de `buildTenderComplianceMatrix`, para el conteo del índice.
 */
export function buildTenderOfferPackageManifest({
  opportunity = null,
  tenderRef = null,
  closeDate = null,
  bridge = null,
  dossierDocuments = [],
  matrix = null,
  now = new Date(),
} = {}) {
  const used = new Set();
  const files = [];

  for (const document of dossierDocuments || []) {
    if (!document?.id) continue;
    files.push({
      kind: 'expediente',
      path: uniqueName(used, OFFICIAL_FOLDER, document.name || document.display_name),
      document_id: document.id,
      source_name: document.name || document.display_name || null,
      // Lo que el expediente sabe del documento: quién lo produjo y de qué tipo es.
      origin: document.origin || null,
      document_type: document.document_type || null,
      confirmed: null,
    });
  }

  for (const row of bridge?.rows || []) {
    for (const document of row.supporting_documents || []) {
      files.push({
        kind: 'empresa',
        path: uniqueName(used, row.folder, document.display_name),
        document_id: document.id,
        source_name: document.display_name || null,
        block: row.key,
        block_label: row.label,
        document_type: document.document_type || null,
        state: row.state,
        expires_at: row.expires_at,
        age_at_close_days: row.age_at_close_days,
        // `null` no es `false`: significa que el bloque no se ha mirado, no que lo hayan rechazado.
        confirmed: row.human_review_status ? CONFIRMED.has(row.human_review_status) : null,
      });
    }
  }

  const missingBlocks = (bridge?.rows || [])
    .filter(row => row.state === 'sin_archivo')
    .map(row => ({ block: row.key, label: row.label, owner: row.owner, kind: row.kind, folder: row.folder }));
  const unconfirmed = files.filter(file => file.kind === 'empresa' && file.confirmed !== true);

  return {
    opportunity_id: opportunity?.id || null,
    entity: opportunity?.company_name || null,
    tender_ref: tenderRef,
    close_date: closeDate,
    generated_at: new Date(now).toISOString(),
    folders: [...TENDER_OFFER_PACKAGE_FOLDERS],
    files,
    // Los dos archivos que el paquete produce por sí mismo; el servidor manda su contenido aparte.
    generated: [TENDER_OFFER_PACKAGE_INDEX_NAME, TENDER_OFFER_PACKAGE_MATRIX_NAME],
    missing_blocks: missingBlocks,
    summary: {
      total_files: files.length,
      del_expediente: files.filter(file => file.kind === 'expediente').length,
      de_empresa: files.filter(file => file.kind === 'empresa').length,
      sin_confirmar: unconfirmed.length,
      bloques_sin_archivo: missingBlocks.length,
      requisitos: matrix?.summary?.total ?? null,
      requisitos_abiertos: matrix?.summary?.requisitos_abiertos ?? null,
      causas_de_rechazo: matrix?.summary?.causas_de_rechazo ?? null,
    },
  };
}

const fecha = value => (value ? String(value).slice(0, 10) : 'sin fecha');

/** El índice que va dentro del paquete. Lo lee una persona, así que dice lo que falta antes de lo que hay. */
export function tenderOfferPackageIndex(manifest) {
  const lines = [
    `# Paquete de la oferta — ${manifest.entity || 'licitación'}`,
    '',
    '**Este paquete es material de preparación, no una oferta radicada.** Cada documento de empresa indica si una',
    'persona confirmó su bloque o si está pendiente de confirmación. Revise esta lista antes de radicar.',
    '',
    `- Referencia: ${manifest.tender_ref || 'sin referencia'}`,
    `- Cierre: ${fecha(manifest.close_date)}`,
    `- Armado: ${manifest.generated_at}`,
    `- Archivos: ${manifest.summary.total_files} (${manifest.summary.del_expediente} del proceso, ${manifest.summary.de_empresa} de la empresa)`,
  ];
  if (manifest.summary.requisitos !== null) {
    lines.push(`- Requisitos del pliego: ${manifest.summary.requisitos}, de los cuales ${manifest.summary.requisitos_abiertos} siguen abiertos y ${manifest.summary.causas_de_rechazo} causan rechazo`);
  }

  lines.push('', '## Lo que falta');
  if (!manifest.missing_blocks.length) {
    lines.push('', 'Ningún bloque de la ficha de empresa está sin soporte.');
  } else {
    lines.push('', `${manifest.missing_blocks.length} bloques de la ficha de empresa no tienen soporte cargado:`, '');
    for (const block of manifest.missing_blocks) {
      lines.push(`- **${block.label}** → ${block.folder} · responsable: ${block.owner}${block.kind === 'tramite' ? ' · trámite' : ' · hecho inscrito'}`);
    }
  }

  const sinConfirmar = manifest.files.filter(file => file.kind === 'empresa' && file.confirmed !== true);
  if (sinConfirmar.length) {
    lines.push('', '## Documentos de empresa pendientes de confirmación humana', '');
    for (const file of sinConfirmar) lines.push(`- ${file.path} — ${file.block_label}`);
  }

  lines.push('', '## Contenido', '');
  for (const folder of manifest.folders) {
    const inFolder = manifest.files.filter(file => file.path.startsWith(`${folder}/`));
    const generated = manifest.generated.filter(name => name.startsWith(`${folder}/`));
    lines.push(`### ${folder}`, '');
    if (!inFolder.length && !generated.length) {
      lines.push('_Vacía._', '');
      continue;
    }
    for (const name of generated) lines.push(`- ${name.slice(folder.length + 1)} — generado por el CRM`);
    for (const file of inFolder) {
      const detalle = file.kind === 'empresa'
        ? [
          file.block_label,
          file.expires_at ? `vence ${fecha(file.expires_at)}` : 'sin vencimiento declarado',
          file.age_at_close_days === null || file.age_at_close_days === undefined ? null : `${file.age_at_close_days} días de expedido al cierre`,
          file.confirmed === true ? 'bloque confirmado' : 'bloque pendiente de confirmación',
        ].filter(Boolean).join(' · ')
        : [file.document_type || 'documento del proceso', file.origin ? `origen: ${file.origin}` : null].filter(Boolean).join(' · ');
      lines.push(`- ${file.path.slice(folder.length + 1)} — ${detalle}`);
    }
    lines.push('');
  }

  lines.push('---', '', 'Armado por Vig-IA Licitaciones desde el CRM. Las fechas y los estados son los registrados en', 'el CRM al momento de armarlo; verifique contra el pliego antes de radicar.');
  return `${lines.join('\n')}\n`;
}
