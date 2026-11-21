// Aliados: la ficha del RUP de cada empresa (Juan, 2026-11-21: «defina qué información va a ser valiosa y a los aliados
// importantes les empezamos a cargar este documento para que se actualice la información»; propuesta aprobada el mismo
// día, handoff 2026-11-21-AGT-002-aliados-ficha-rup-propuesta.md).
//
// Lee dos documentos que cualquiera consigue:
//   1. la consulta gratuita de ruppro.colombiacompra.gov.co («CONSULTA DE INFORMACIÓN DEL PROPONENTE - (RUP)»): trae
//      activo y pasivo totales, utilidad, rentabilidades, multas, sanciones y toda la experiencia, pero NO el activo ni
//      el pasivo corrientes, así que la liquidez queda sin dato;
//   2. el certificado del RUP de una Cámara de Comercio (el que se compra, o el que la empresa presentó en otra oferta):
//      trae todo lo financiero.
// Lo que el documento no trae queda en null («sin dato»), nunca en cero. Módulo puro: sólo texto.

const PROPOSAL_CODES = Object.freeze({ guards: '92121500', systems: '92121700' });

/** «$ 22.553.291.933,0000», «$11.697.601.426,00», «18,29», «3.556,84» → número; «N/D» o vacío → null. */
export function parseColombianNumber(value) {
  const text = String(value ?? '').replace(/[$\s]/g, '');
  if (!text || /^n\/?d$/i.test(text)) return null;
  if (!/^-?[\d.,]+$/.test(text)) return null;
  const normalized = text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : (/^\d{1,3}(\.\d{3})+$/.test(text) ? text.replace(/\./g, '') : text);
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

/** «31/12/2025» o «2025/12/31» → «2025-12-31». */
function isoDate(value) {
  const text = String(value || '').trim();
  let match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
  return null;
}

const fold = value => String(value || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

/** El valor que sigue a una etiqueta en la misma línea («ACTIVO CORRIENTE:   $11.697.601.426,00»). */
function labeled(text, labels) {
  for (const label of labels) {
    // El OCR de algunos certificados mete una letra suelta entre la etiqueta y el valor («PASIVO TOTAL E $11.643…»).
    const pattern = new RegExp(`${label}[^\\d$\\n]{0,4}([$\\d.,\\- \\t]+|N\\/D)`, 'i');
    const match = pattern.exec(text);
    if (match) {
      const value = parseColombianNumber(match[1].trim().split(/\s{2,}/)[0]);
      if (value !== null) return value;
    }
  }
  return null;
}

/** ¿Qué documento es? */
export function detectRupKind(text) {
  const plain = fold(text);
  if (plain.includes('CONSULTA DE INFORMACION DEL PROPONENTE')) return 'consulta_ruppro';
  if (/CERTIFICADO\s+DE\s+INSCRIPCION\s+Y\s+CLASIFICACION/.test(plain) && plain.includes('PROPONENTES')) return 'certificado_camara';
  return null;
}

/** Códigos UNSPSC de un bloque: «92121500», «92 12 15 00» y la tabla «| 92 | 12 | 15 | 00 |» de la Cámara de Bogotá. */
export function codesIn(block) {
  const codes = new Set();
  for (const match of String(block).matchAll(/\b(\d{8})\b/g)) codes.add(match[1]);
  for (const match of String(block).matchAll(/\b(\d{2})\s+(\d{2})\s+(\d{2})\s+(\d{2})\b/g)) codes.add(match.slice(1).join(''));
  for (const match of String(block).matchAll(/\|\s*(\d{2})\s*\|\s*(\d{2})\s*\|\s*(\d{2})\s*\|\s*(\d{2})\s*\|/g)) codes.add(match.slice(1).join(''));
  return [...codes].filter(code => /^[1-9]\d{7}$/.test(code)).sort();
}

const ownContract = celebradoPor => /proponente/i.test(celebradoPor) && !/consorcio|uni[oó]n temporal|sociedad en las cuales/i.test(celebradoPor);

/** Los contratos de la consulta de ruppro: «Secuencia del contrato: 001», «CELEBRADO POR … El proponente …». */
function contractsFromRuppro(text) {
  return String(text).split(/Secuencia del contrato:\s*/).slice(1).map(block => {
    const sequence = (/^(\d+)/.exec(block) || [])[1] || null;
    const header = /CELEBRADO POR[^\n]*\n\s*(\S.*?)\s{2,}(\S.*?)\s{2,}(\S.*?)\s*\n/.exec(block);
    const value = /EJECUCI[ÓO]N\)\s*\n(?:[^\n]*\n)*?\s*([\d.]+(?:,\d+)?)\s*\n/.exec(block);
    const celebrado = header ? header[1].trim() : '';
    return {
      sequence, own: ownContract(celebrado), contractor: header ? header[2].trim() : null,
      client: header ? header[3].trim() : null, smmlv: value ? parseColombianNumber(value[1]) : null,
      codes: codesIn(block.split(/C[ÓO]DIGOS UNSPSC/i)[1] || ''),
    };
  });
}

/** Los contratos del certificado de la Cámara: «NUMERO CONSECUTIVO DEL (REPORTE DEL) CONTRATO (EJECUTADO): 1». */
function contractsFromCertificate(text) {
  const experience = String(text).split(/REPORTE DE LA INFORMACI[ÓO]N POR PARTE DE LAS ENTIDADES/i)[0];
  return experience.split(/N[ÚU]MERO\s+CONSECUTIVO\s+DEL\s+(?:REPORTE\s+DEL\s+)?CONTRATO(?:\s+EJECUTADO)?\s*:\s*/i).slice(1).map(block => {
    const sequence = (/^(\d+)/.exec(block) || [])[1] || null;
    const celebrado = (/CONTRATO CELEBRADO POR\s*:?\s*([^\n]*(?:\n(?!NOMBRE)[^\n]*)?)/i.exec(block) || [])[1] || '';
    const contractor = (/NOMBRE DEL CONTRATISTA\s*[:¡¿]?\s*([^\n]+)/i.exec(block) || [])[1] || null;
    const client = (/NOMBRE DEL CONTRATANTE\s*[:¡¿]?\s*([^\n]+)/i.exec(block) || [])[1] || null;
    const value = /(?:VALOR DEL CONTRATO EJECUTADO EXPRESADO EN SMMLV|VALOR CONTRATADO EN SMMLV)\s*:\s*(\d[\d.]*(?:,\s?\d+)?)/i.exec(block);
    const own = /\b1\s*-\s*EL PROPONENTE\b/i.test(celebrado) || (ownContract(celebrado) && !/\b3\s*-/.test(celebrado));
    return {
      sequence, own, contractor: contractor ? contractor.trim() : null, client: client ? client.trim() : null,
      smmlv: value ? parseColombianNumber(value[1].replace(/\s/g, '')) : null, codes: codesIn(block),
    };
  });
}

/** Multas y sanciones: la consulta de ruppro lo dice explícito; el certificado, sólo si trae la frase. Si no, null. */
function finesAndSanctions(text, kind) {
  const plain = fold(text);
  if (kind === 'consulta_ruppro') {
    return {
      has_fines: plain.includes('NO TIENE MULTAS REGISTRADAS') ? false : (/\bMULTAS\b[\s\S]{0,400}\bVALOR\b/.test(plain) ? true : null),
      has_sanctions: plain.includes('NO TIENE SANCIONES REGISTRADAS') ? false : null,
      has_disqualification: /INHABILIDAD\s*\n\s*NO\b/.test(plain) ? false : (/INHABILIDAD\s*\n\s*SI\b/.test(plain) ? true : null),
    };
  }
  return {
    has_fines: /NO\s+(?:REPORTA|REGISTRA)\s+MULTAS/.test(plain) ? false : null,
    has_sanctions: /NO\s+(?:REPORTA|REGISTRA)\s+SANCIONES/.test(plain) ? false : null,
    has_disqualification: null,
  };
}

/**
 * Lee el texto de un PDF del RUP. Devuelve {kind, nit, name, cut_date, financieros…, contratos, resumen} o lanza un error
 * con un mensaje para la persona si el documento no es un RUP.
 */
export function parseRupText(text) {
  const kind = detectRupKind(text);
  if (!kind) throw Object.assign(new Error('El PDF no es una consulta de ruppro ni un certificado del RUP de una Cámara de Comercio.'), { status: 400 });
  const source = String(text);
  const nitMatch = kind === 'consulta_ruppro' ? /NIT del proveedor\s+(\d{6,12})/i.exec(source) : /\bNIT\s*:\s*(\d{6,12})/i.exec(source);
  const nameMatch = kind === 'consulta_ruppro' ? /Nombre del proveedor\s+(.+?)\s{2,}/i.exec(source) : /\bQUE\s*:\s*([^\n]+)/i.exec(source);
  const cutMatch = /Fecha (?:de )?Corte(?: de la)? Informaci[óo]n(?: financiera)?\s*:?\s*(\d{1,4}\/\d{1,2}\/\d{1,4})/i.exec(source);
  const totalAssets = labeled(source, ['ACTIVO TOTAL']) ?? (kind === 'consulta_ruppro' ? parseColombianNumber((/ACTIVO TOTAL[^\n]*\n\s*(\$\s*[\d.,]+)/i.exec(source) || [])[1]) : null);
  const totalLiabilities = labeled(source, ['PASIVO TOTAL']) ?? (kind === 'consulta_ruppro' ? parseColombianNumber((/ACTIVO TOTAL[^\n]*\n\s*\$\s*[\d.,]+\s+(\$\s*[\d.,]+)/i.exec(source) || [])[1]) : null);
  const currentAssets = labeled(source, ['ACTIVO CORRIENTE']);
  const currentLiabilities = labeled(source, ['PASIVO CORRIENTE']);
  const equityLabeled = labeled(source, ['PATRIMONIO']);
  const operatingIncome = labeled(source, ['UTILIDAD\\/?\\s*P[EÉ]RDIDA OPERACIONAL', 'Utilidad perdida operacional']);
  const interest = labeled(source, ['GASTOS DE INTERESES']);
  const pct = value => (value === null ? null : value > 1.5 ? value / 100 : value);
  const roe = kind === 'consulta_ruppro' ? pct(parseColombianNumber((/Patrimonio\s+([\d.,]+)%/i.exec(source) || [])[1])) : labeled(source, ['RENTABILIDAD DEL PATRIMONIO']);
  const roa = kind === 'consulta_ruppro' ? pct(parseColombianNumber((/Activo\s+([\d.,]+)%/i.exec(source) || [])[1])) : labeled(source, ['RENTABILIDAD DEL ACTIVO']);
  const contracts = kind === 'consulta_ruppro' ? contractsFromRuppro(source) : contractsFromCertificate(source);
  const equity = equityLabeled && equityLabeled > 0 ? equityLabeled : (totalAssets !== null && totalLiabilities !== null ? totalAssets - totalLiabilities : null);
  return {
    kind,
    nit: nitMatch ? nitMatch[1] : null,
    name: nameMatch ? nameMatch[1].trim() : null,
    cut_date: cutMatch ? isoDate(cutMatch[1]) : null,
    total_assets: totalAssets, total_liabilities: totalLiabilities,
    current_assets: currentAssets, current_liabilities: currentLiabilities,
    equity, operating_income: operatingIncome, interest_expense: interest,
    roe, roa,
    ...finesAndSanctions(source, kind),
    contracts,
  };
}

const round = (value, digits = 2) => (value === null || !Number.isFinite(value) ? null : Math.round(value * 10 ** digits) / 10 ** digits);

/** Los indicadores y el resumen de experiencia que se guardan y se filtran. Lo que no se puede calcular queda null. */
export function summarizeRup(parsed) {
  const { current_assets: ca, current_liabilities: cl, total_assets: ta, total_liabilities: tl, operating_income: oi, interest_expense: ie } = parsed;
  const own = parsed.contracts.filter(item => item.own);
  const largest = own.reduce((best, item) => ((item.smmlv || 0) > (best?.smmlv || 0) ? item : best), null);
  const withCode = code => parsed.contracts.some(item => item.codes.includes(code));
  return {
    liquidity: ca !== null && cl ? round(ca / cl) : null,
    working_capital: ca !== null && cl !== null ? Math.round(ca - cl) : null,
    debt_ratio: ta && tl !== null ? round(tl / ta, 3) : null,
    interest_coverage: oi !== null && ie ? round(oi / ie) : null,
    contracts_total: parsed.contracts.length,
    contracts_own: own.length,
    smmlv_total: round(parsed.contracts.reduce((sum, item) => sum + (item.smmlv || 0), 0)),
    smmlv_own: round(own.reduce((sum, item) => sum + (item.smmlv || 0), 0)),
    largest_own_smmlv: largest ? largest.smmlv : null,
    largest_own_client: largest ? largest.client : null,
    has_guard_code: parsed.contracts.length ? withCode(PROPOSAL_CODES.guards) : null,
    has_systems_code: parsed.contracts.length ? withCode(PROPOSAL_CODES.systems) : null,
  };
}

/** Lo que se le manda a la base (psi_save_vigilance_rup). */
export function rupPayload(parsed, { fileName = null, sha256 = null, storagePath = null } = {}) {
  const summary = summarizeRup(parsed);
  const { contracts, kind, nit, name, ...financial } = parsed;
  return {
    source_kind: kind, document_name: fileName, document_sha256: sha256, storage_path: storagePath, reported_name: name,
    ...financial, ...summary,
    contracts: contracts.map(item => ({ sequence: item.sequence, own: item.own, client: item.client, smmlv: item.smmlv, codes: item.codes })),
  };
}

/** «Sin dato» en vez de cero, para la pantalla y para Vig-IA. */
export const RUP_FIELDS_WITHOUT_LIQUIDITY_NOTE = 'La consulta gratuita de ruppro no trae el activo ni el pasivo corrientes: la liquidez y el capital de trabajo quedan sin dato hasta cargar el certificado del RUP de la Cámara.';
