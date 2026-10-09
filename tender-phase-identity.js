import { compareTenderFamilyRecency, isTenderRepublicationPair, isTerminalTenderStatus, splitTrailingPhaseSuffixes, tenderProcessFamilyKey } from './tender-process-family.js';

function normalizeTenderStatusText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Referencia sin sufijos de fase, con mayúsculas y acentos originales: sirve para pedir a datos.gov.co todas
// las fases de un mismo proceso (`referencia_del_proceso like '<base>%'`).
export function tenderProcessBaseReference(ref) {
  return splitTrailingPhaseSuffixes(ref).base.replace(/[.\s]+$/g, '').trim();
}

// datos.gov.co publica la fecha de cierre sin zona ("2026-10-19T00:00:00.000") y el CRM la guarda como medianoche UTC
// ("2026-10-19T00:00:00+00:00"): las dos son una fecha de Colombia. Se leen en hora Bogotá (UTC-5); una fecha con hora
// y zona explícitas se respeta.
export function tenderDeadlineBogotaMs(deadline) {
  const text = String(deadline || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?(Z|[+-]00:?00|[+-]\d{2}:?\d{2})?$/);
  if (!match) return Date.parse(text);
  const [, day, time = '00:00:00', zone] = match;
  const isUtcMidnight = (!zone || /^(Z|[+-]00:?00)$/.test(zone)) && /^00:00(:00(\.0+)?)?$/.test(time);
  if (!zone || isUtcMidnight) return Date.parse(`${day}T${time.length === 5 ? `${time}:00` : time}-05:00`);
  return Date.parse(text);
}

/**
 * Por qué un cambio de fuente (fase nueva o republicación) NO debe disparar el seguimiento automático de documentos y
 * reanálisis, o `null` si puede. Fail-closed: proceso terminal (Adjudicado, Seleccionado, Celebrado, Cancelado…), sin
 * fecha de cierre o con el cierre ya pasado.
 */
export function tenderSourceChangeFollowUpBlocker({ status, deadline } = {}, now = new Date()) {
  if (isTerminalTenderStatus(status)) return 'terminal_status';
  const deadlineAt = tenderDeadlineBogotaMs(deadline);
  if (!Number.isFinite(deadlineAt)) return 'no_deadline';
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  if (deadlineAt <= nowMs) return 'deadline_passed';
  return null;
}

function canonicalTenderProcessReference(tender) {
  const reference = normalizeTenderStatusText(tender?.ref || tender?.process_id || tender?.id || '');
  return splitTrailingPhaseSuffixes(reference).base.replace(/[.\s]+$/g, '').trim();
}

// SECOP escribe algunas entidades con caracteres de control ("Rama Judicial \u0096 Dirección…") que en el CRM
// quedan como espacios: se quitan esos caracteres y se juntan los espacios. La puntuación se conserva porque
// SECOP distingue entidades homónimas con ella ("HOSPITAL SAN RAFAEL +" y "HOSPITAL SAN RAFAEL.*").
function canonicalTenderEntity(entity) {
  return normalizeTenderStatusText(entity).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
}

function canonicalTenderProcessKey(tender) {
  return [normalizeTenderStatusText(tender?.source), canonicalTenderEntity(tender?.entity), canonicalTenderProcessReference(tender)].join('|');
}

// Mismo proceso: la clave canónica de siempre o, para SECOP II, la misma familia de proceso
// (referencia que sólo difiere en puntuación/espacios: una republicación por modificación).
function isSameTenderProcess(reference, candidate) {
  const canonicalKey = canonicalTenderProcessKey(reference);
  if (canonicalKey && !canonicalKey.endsWith('|') && canonicalTenderProcessKey(candidate) === canonicalKey) return true;
  const familyKey = tenderProcessFamilyKey(reference);
  return Boolean(familyKey) && tenderProcessFamilyKey(candidate) === familyKey;
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
  // Una republicación en estado terminal (Adjudicado, Cancelado…) nunca pasa a ser la fuente. Los
  // sucesores de fase conservan la regla de siempre (así la oportunidad se entera de la adjudicación).
  if (candidate !== current && isTerminalTenderStatus(candidate.status) && !isTerminalTenderStatus(current.status)
    && isTenderRepublicationPair(current, candidate)) return current;
  const currentRank = rankOf(current);
  const candidateRank = rankOf(candidate);
  if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current;
  // Sólo dentro de una republicación SECOP II (misma familia, referencia distinta por puntuación) y
  // a igual fase: la publicación más reciente es la vigente. Nunca pesa más que la fase.
  if (isTenderRepublicationPair(current, candidate)) {
    const recency = compareTenderFamilyRecency(candidate, current);
    if (recency) return recency > 0 ? candidate : current;
  }
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

// Fases conocidas: las ya registradas en la fila convertida (raw.phase_continuity) más las de sus versiones vistas; nunca
// se pierde una fase porque la convertida ya haya pasado a la siguiente (idempotente entre revisiones).
function knownPhasesFor(rows, previous = []) {
  return uniqueStrings([...(Array.isArray(previous) ? previous : []), ...rows.map(row => String(row?.status || '').trim())].map(value => String(value || '').trim()))
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
    if ((!canonicalKey || canonicalKey.endsWith('|')) && !tenderProcessFamilyKey(convertedRow)) continue;
    const fetchedSame = fetchedRows.filter(row => isSameTenderProcess(convertedRow, row));
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
    // Si la oportunidad ya adoptó una republicación (su proceso vigente es el de la versión nueva), la
    // versión anterior —aunque esté en una fase más avanzada— ya no puede devolverle el enlace.
    const adoptedRepublication = fetchedSame.some(row => row?.process_id && row.process_id === convertedRow.process_id && isTenderRepublicationPair(convertedRow, row));
    const officialPool = adoptedRepublication ? fetchedSame.filter(row => isTenderRepublicationPair(convertedRow, row)) : fetchedSame;
    const official = officialPool.reduce((current, candidate) => preferOfficialIdentity(current, candidate, rankOf), convertedRow);
    const successorKeys = uniqueStrings(successorCandidates.map(row => row.stable_key));
    omitStableKeys.push(...successorKeys);
    discardStableKeys.push(...successorKeys.filter(key => {
      const persisted = existingByKey.get(key);
      return persisted && persisted.internal_status !== 'convertida_oportunidad';
    }));

    const knownPhases = knownPhasesFor([convertedRow, ...fetchedSame], convertedRow.raw?.phase_continuity?.known_phases);

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
    // Cambio de fuente que pide seguimiento automático (documentos + reanálisis, agt002-phase-change-followup.js):
    // SÓLO en la corrida que cambia el enlace, y sólo hacia una fase posterior o una republicación (referencia distinta
    // por puntuación) de la misma fase; nunca porque el enlace "vuelva" a una fase anterior. `blocker` dice por qué el
    // proceso nuevo no se sigue (terminal, sin cierre o cierre pasado). Un cambio ya aplicado antes de instalar no
    // vuelve a pasar por aquí: su enlace ya no cambia.
    const liveRepublication = official !== convertedRow && isTenderRepublicationPair(convertedRow, official) && rankOf(official) >= currentRank;
    const advancesPhase = official !== convertedRow && rankOf(official) > currentRank;
    const sourceChange = urlChanged && (advancesPhase || liveRepublication) ? {
      change: liveRepublication ? 'republication' : 'phase',
      ref: official.ref || convertedRow.ref || null,
      url: officialUrl,
      processId: official.process_id || null,
      previousUrl: convertedRow.url || null,
      previousPhase: convertedRow.status || null,
      newPhase: officialStatus,
      deadline: deadlineValue(official) || null,
      detectedAt: nowIso,
      blocker: tenderSourceChangeFollowUpBlocker({ status: official.status, deadline: deadlineValue(official) }, nowIso),
    } : null;
    if (convertedRow.converted_opportunity_id && (urlChanged || phaseChanged)) {
      opportunityPatches.push({
        converted_opportunity_id: convertedRow.converted_opportunity_id,
        tender_id: convertedRow.id || null,
        officialUrl: officialUrl || convertedRow.url || null,
        historicalUrl: convertedRow.url || null,
        processId: official.process_id || convertedRow.process_id || null,
        deadline: deadlineValue(official) || deadlineValue(convertedRow) || null,
        phaseChange: phaseChanged ? { previousPhase: convertedRow.status || null, newPhase: officialStatus, detectedAt: nowIso } : null,
        sourceChange,
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
