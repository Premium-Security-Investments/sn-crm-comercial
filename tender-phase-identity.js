function normalizeTenderStatusText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// SECOP II publica cada fase como otro proceso con la referencia original más uno o varios sufijos de fase,
// a veces anidados: "LP-004-2026 (Presentación de oferta)", "SA-006-2026 (Manifestación de interés (Menor
// Cuantía)) (Presentación de oferta)", "CAS-LP-001-2026 (Fase de Selección (Presentación de ofertas))".
const PHASE_SUFFIX_RE = /^(?:fase de |presentacion de |manifestacion de interes|evaluacion de |apertura de |seleccion)/;

function splitTrailingPhaseSuffixes(text) {
  let base = String(text || '').trim();
  const suffixes = [];
  while (base.endsWith(')')) {
    let depth = 0;
    let open = -1;
    for (let index = base.length - 1; index >= 0; index -= 1) {
      if (base[index] === ')') depth += 1;
      else if (base[index] === '(' && --depth === 0) { open = index; break; }
    }
    if (open < 0) break;
    const inner = normalizeTenderStatusText(base.slice(open + 1, -1));
    if (!PHASE_SUFFIX_RE.test(inner)) break;
    suffixes.unshift(inner);
    base = base.slice(0, open).trim();
  }
  return { base, suffixes };
}

// Referencia sin sufijos de fase, con mayúsculas y acentos originales: sirve para pedir a datos.gov.co todas
// las fases de un mismo proceso (`referencia_del_proceso like '<base>%'`).
export function tenderProcessBaseReference(ref) {
  return splitTrailingPhaseSuffixes(ref).base.replace(/[.\s]+$/g, '').trim();
}

function canonicalTenderProcessReference(tender) {
  const reference = normalizeTenderStatusText(tender?.ref || tender?.process_id || tender?.id || '');
  return splitTrailingPhaseSuffixes(reference).base.replace(/[.\s]+$/g, '').trim();
}

// SECOP escribe algunas entidades con caracteres invisibles o guiones raros ("Rama Judicial \u0096 Dirección…") que
// en el CRM quedan como espacios: el nombre se compara sólo por letras y números.
function canonicalTenderEntity(entity) {
  return normalizeTenderStatusText(entity).replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function canonicalTenderProcessKey(tender) {
  return [normalizeTenderStatusText(tender?.source), canonicalTenderEntity(tender?.entity), canonicalTenderProcessReference(tender)].join('|');
}

function deadlineValue(tender) {
  return tender?.deadline || tender?.deadline_at || '';
}

function deadlineMs(tender) {
  const parsed = Date.parse(deadlineValue(tender));
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusPhaseRank(status) {
  const text = normalizeTenderStatusText(status || '');
  if (text.includes('presentacion de oferta') || text.includes('evaluacion de ofertas') || text.includes('apertura de ofertas')) return 4;
  if (text.includes('presentacion de observaciones')) return 2;
  if (text.includes('manifestacion de interes')) return 1;
  return 0;
}

// El estado de un proceso adjudicado o cerrado ya no dice en qué fase está, pero su referencia sí:
// "… (Presentación de oferta)" con estado "Adjudicado" sigue siendo la fase de oferta.
function officialPhaseRank(tender) {
  const referenceRank = splitTrailingPhaseSuffixes(tender?.ref || '').suffixes
    .some(suffix => suffix.includes('presentacion de oferta')) ? 4 : 0;
  return Math.max(statusPhaseRank(tender?.status), referenceRank);
}

function preferOfficialIdentity(current, candidate, rankOf = officialPhaseRank) {
  if (!current) return candidate;
  if (!candidate) return current;
  const currentRank = rankOf(current);
  const candidateRank = rankOf(candidate);
  if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current;
  return deadlineMs(candidate) > deadlineMs(current) ? candidate : current;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean))];
}

// Two or more successor candidates tied on the same official phase rank with the same (or equally
// missing) deadline cannot be told apart deterministically. Silently picking one would risk merging
// the wrong process into the converted opportunity, so this is surfaced as ambiguous instead.
function hasAmbiguousSuccessors(successorCandidates) {
  if (successorCandidates.length < 2) return false;
  const maxRank = Math.max(...successorCandidates.map(officialPhaseRank));
  const topCandidates = successorCandidates.filter(row => officialPhaseRank(row) === maxRank);
  if (topCandidates.length < 2) return false;
  return new Set(topCandidates.map(deadlineMs)).size === 1;
}

function knownPhasesFor(rows) {
  return uniqueStrings(rows.map(row => String(row?.status || '').trim()))
    .sort((a, b) => statusPhaseRank(a) - statusPhaseRank(b));
}

function phaseHistoryLinePrefix(previousPhase, newPhase) {
  return `Fase detectada: ${previousPhase || 'sin fase registrada'} → ${newPhase}`;
}

export function applyOfficialSourceLink(observaciones, { officialUrl, historicalUrl, phaseChange } = {}) {
  const text = String(observaciones || '');
  let next = text;
  if (officialUrl) {
    const linkRe = /^Link fuente:\s*(\S+)/m;
    const match = next.match(linkRe);
    if (!match) {
      next = next ? `${next}\nLink fuente: ${officialUrl}` : `Link fuente: ${officialUrl}`;
    } else if (match[1] !== officialUrl) {
      const current = match[1];
      next = next.replace(linkRe, `Link fuente: ${officialUrl}`);
      const historical = historicalUrl || current;
      if (historical && historical !== officialUrl && !next.includes(historical)) {
        next += `\nLink fuente histórico: ${historical}`;
      }
    }
  }
  if (phaseChange?.newPhase && phaseChange.newPhase !== phaseChange.previousPhase) {
    const prefix = phaseHistoryLinePrefix(phaseChange.previousPhase, phaseChange.newPhase);
    const alreadyRecorded = next.split('\n').some(line => line.startsWith(prefix));
    if (!alreadyRecorded) {
      const detectedAt = phaseChange.detectedAt ? ` (${phaseChange.detectedAt})` : '';
      next += `\n${prefix}${detectedAt}`;
    }
  }
  return next;
}

export function planRadarPhaseIdentitySync({ fetched = [], existing = [], now } = {}) {
  const nowIso = now || new Date().toISOString();
  const fetchedRows = Array.isArray(fetched) ? fetched : [];
  const existingRows = Array.isArray(existing) ? existing : [];
  const converted = existingRows.filter(row => row?.internal_status === 'convertida_oportunidad' || row?.converted_opportunity_id);
  const omitStableKeys = [];
  const discardStableKeys = [];
  const convertedOverrides = [];
  const opportunityPatches = [];
  const identityReviewStableKeys = [];
  const existingByKey = new Map(existingRows.filter(row => row?.stable_key).map(row => [row.stable_key, row]));

  for (const convertedRow of converted) {
    const canonicalKey = canonicalTenderProcessKey(convertedRow);
    if (!canonicalKey || canonicalKey.endsWith('|')) continue;
    const fetchedSame = fetchedRows.filter(row => canonicalTenderProcessKey(row) === canonicalKey);
    if (!fetchedSame.length) continue;

    const successorCandidates = fetchedSame.filter(row => row?.stable_key && row.stable_key !== convertedRow.stable_key);
    if (hasAmbiguousSuccessors(successorCandidates)) {
      // Fail closed: do not merge, discard or patch anything for this process while two or more
      // successor candidates are tied. Route them outside the normal conversion flow instead.
      identityReviewStableKeys.push(...successorCandidates.map(row => row.stable_key));
      continue;
    }

    // La convertida puede apuntar ya a una fase posterior (su estado puede decir sólo "Adjudicado"): su fase
    // real es la de la fila oficial con su mismo enlace, para no devolverla nunca a una fase anterior.
    const currentRank = Math.max(officialPhaseRank(convertedRow),
      ...fetchedSame.filter(row => row?.url && row.url === convertedRow.url).map(officialPhaseRank));
    const rankOf = row => (row === convertedRow ? currentRank : officialPhaseRank(row));
    const official = fetchedSame.reduce((current, candidate) => preferOfficialIdentity(current, candidate, rankOf), convertedRow);
    const successorKeys = uniqueStrings(successorCandidates.map(row => row.stable_key));
    omitStableKeys.push(...successorKeys);
    discardStableKeys.push(...successorKeys.filter(key => {
      const persisted = existingByKey.get(key);
      return persisted && persisted.internal_status !== 'convertida_oportunidad';
    }));

    const knownPhases = knownPhasesFor([convertedRow, ...fetchedSame]);

    convertedOverrides.push({
      stable_key: convertedRow.stable_key,
      url: official.url || convertedRow.url || null,
      process_id: official.process_id || convertedRow.process_id || null,
      status: official.status || convertedRow.status || null,
      deadline_at: deadlineValue(official) || deadlineValue(convertedRow) || null,
      known_phases: knownPhases,
    });

    const officialUrl = official.url || null;
    const officialStatus = official.status || convertedRow.status || null;
    const urlChanged = Boolean(officialUrl) && officialUrl !== convertedRow.url;
    const phaseChanged = Boolean(officialStatus) && officialStatus !== convertedRow.status;
    if (convertedRow.converted_opportunity_id && (urlChanged || phaseChanged)) {
      opportunityPatches.push({
        converted_opportunity_id: convertedRow.converted_opportunity_id,
        officialUrl: officialUrl || convertedRow.url || null,
        historicalUrl: convertedRow.url || null,
        processId: official.process_id || convertedRow.process_id || null,
        deadline: deadlineValue(official) || deadlineValue(convertedRow) || null,
        phaseChange: phaseChanged ? { previousPhase: convertedRow.status || null, newPhase: officialStatus, detectedAt: nowIso } : null,
      });
    }
  }

  return {
    omitStableKeys: uniqueStrings(omitStableKeys),
    discardStableKeys: uniqueStrings(discardStableKeys),
    convertedOverrides,
    opportunityPatches,
    identityReviewStableKeys: uniqueStrings(identityReviewStableKeys),
  };
}
