import { compareTenderFamilyRecency, isTenderRepublicationPair, isTerminalTenderStatus, tenderProcessFamilyKey } from './tender-process-family.js';

function normalizeTenderStatusText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function canonicalTenderProcessReference(tender) {
  const reference = normalizeTenderStatusText(tender?.ref || tender?.process_id || tender?.id || '');
  return reference.replace(/\s*\((?:presentacion de oferta|manifestacion de interes|presentacion de observaciones|evaluacion de ofertas|apertura de ofertas)\)\s*$/i, '').replace(/[.\s]+$/g, '').trim();
}

function canonicalTenderProcessKey(tender) {
  return [tender?.source, tender?.entity, canonicalTenderProcessReference(tender)].map(normalizeTenderStatusText).join('|');
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

function officialPhaseRank(tender) {
  const status = normalizeTenderStatusText(tender?.status || '');
  if (status.includes('presentacion de oferta') || status.includes('evaluacion de ofertas') || status.includes('apertura de ofertas')) return 4;
  if (status.includes('presentacion de observaciones')) return 2;
  if (status.includes('manifestacion de interes')) return 1;
  return 0;
}

function preferOfficialIdentity(current, candidate) {
  if (!current) return candidate;
  if (!candidate) return current;
  // Una republicación en estado terminal (Adjudicado, Cancelado…) nunca pasa a ser la fuente. Los
  // sucesores de fase conservan la regla de siempre (así la oportunidad se entera de la adjudicación).
  if (candidate !== current && isTerminalTenderStatus(candidate.status) && !isTerminalTenderStatus(current.status)
    && isTenderRepublicationPair(current, candidate)) return current;
  const currentRank = officialPhaseRank(current);
  const candidateRank = officialPhaseRank(candidate);
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

function knownPhasesFor(rows) {
  return uniqueStrings(rows.map(row => String(row?.status || '').trim()))
    .sort((a, b) => officialPhaseRank({ status: a }) - officialPhaseRank({ status: b }));
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

    // Si la oportunidad ya adoptó una republicación (su proceso vigente es el de la versión nueva), la
    // versión anterior —aunque esté en una fase más avanzada— ya no puede devolverle el enlace.
    const adoptedRepublication = fetchedSame.some(row => row?.process_id && row.process_id === convertedRow.process_id && isTenderRepublicationPair(convertedRow, row));
    const officialPool = adoptedRepublication ? fetchedSame.filter(row => isTenderRepublicationPair(convertedRow, row)) : fetchedSame;
    const official = officialPool.reduce(preferOfficialIdentity, convertedRow);
    // Nunca dispara el seguimiento automático (documentos, reanálisis) hacia una fila terminal.
    const officialIsLiveRepublication = official !== convertedRow && isTenderRepublicationPair(convertedRow, official) && !isTerminalTenderStatus(official.status);
    const successorKeys = uniqueStrings(successorCandidates.map(row => row.stable_key));
    omitStableKeys.push(...successorKeys);
    discardStableKeys.push(...successorKeys.filter(key => {
      const persisted = existingByKey.get(key);
      return persisted && persisted.internal_status !== 'convertida_oportunidad';
    }));

    const knownPhases = knownPhasesFor([convertedRow, ...fetchedSame]);

    // Republicación vigente (referencia distinta por puntuación, no un paso de fase): se reporta en cada corrida para
    // que el seguimiento automático la registre de forma idempotente aunque una corrida anterior haya fallado.
    const currentRepublication = officialIsLiveRepublication && official.url
      ? { converted_opportunity_id: convertedRow.converted_opportunity_id || null, ref: official.ref || null, url: official.url, processId: official.process_id || null }
      : null;
    convertedOverrides.push({
      republication: currentRepublication,
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
    // SECOP publicó un proceso nuevo (otro id_del_proceso) para la misma referencia: la oportunidad
    // queda avisada y apuntando a la versión nueva, y el seguimiento importa sus documentos.
    // Sólo una republicación (referencia distinta por puntuación/espacios); el paso de fase de SECOP
    // (otro id_del_proceso con la misma referencia) conserva el comportamiento de siempre.
    const republished = urlChanged && official !== convertedRow && Boolean(official.process_id)
      && official.process_id !== convertedRow.process_id && officialIsLiveRepublication;
    if (convertedRow.converted_opportunity_id && (urlChanged || phaseChanged)) {
      opportunityPatches.push({
        converted_opportunity_id: convertedRow.converted_opportunity_id,
        officialUrl: officialUrl || convertedRow.url || null,
        historicalUrl: convertedRow.url || null,
        processId: official.process_id || convertedRow.process_id || null,
        deadline: deadlineValue(official) || deadlineValue(convertedRow) || null,
        phaseChange: phaseChanged ? { previousPhase: convertedRow.status || null, newPhase: officialStatus, detectedAt: nowIso } : null,
        republication: republished ? { ref: official.ref || convertedRow.ref || null, url: officialUrl, processId: official.process_id, detectedAt: nowIso } : null,
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
