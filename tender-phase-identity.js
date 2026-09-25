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
  const currentRank = officialPhaseRank(current);
  const candidateRank = officialPhaseRank(candidate);
  if (candidateRank !== currentRank) return candidateRank > currentRank ? candidate : current;
  return deadlineMs(candidate) > deadlineMs(current) ? candidate : current;
}

function uniqueStrings(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export function applyOfficialSourceLink(observaciones, { officialUrl, historicalUrl } = {}) {
  const text = String(observaciones || '');
  if (!officialUrl) return text;
  const linkRe = /^Link fuente:\s*(\S+)/m;
  const match = text.match(linkRe);
  if (!match) {
    return text ? `${text}\nLink fuente: ${officialUrl}` : `Link fuente: ${officialUrl}`;
  }
  const current = match[1];
  if (current === officialUrl) return text;
  let next = text.replace(linkRe, `Link fuente: ${officialUrl}`);
  const historical = historicalUrl || current;
  if (historical && historical !== officialUrl && !next.includes(historical)) {
    next += `\nLink fuente histórico: ${historical}`;
  }
  return next;
}

export function planRadarPhaseIdentitySync({ fetched = [], existing = [] } = {}) {
  const fetchedRows = Array.isArray(fetched) ? fetched : [];
  const existingRows = Array.isArray(existing) ? existing : [];
  const converted = existingRows.filter(row => row?.internal_status === 'convertida_oportunidad' || row?.converted_opportunity_id);
  const omitStableKeys = [];
  const discardStableKeys = [];
  const convertedOverrides = [];
  const opportunityPatches = [];
  const existingByKey = new Map(existingRows.filter(row => row?.stable_key).map(row => [row.stable_key, row]));

  for (const convertedRow of converted) {
    const canonicalKey = canonicalTenderProcessKey(convertedRow);
    if (!canonicalKey || canonicalKey.endsWith('|')) continue;
    const fetchedSame = fetchedRows.filter(row => canonicalTenderProcessKey(row) === canonicalKey);
    if (!fetchedSame.length) continue;

    const official = fetchedSame.reduce(preferOfficialIdentity, convertedRow);
    const successorKeys = uniqueStrings(
      fetchedSame
        .map(row => row?.stable_key)
        .filter(key => key && key !== convertedRow.stable_key),
    );
    omitStableKeys.push(...successorKeys);
    discardStableKeys.push(...successorKeys.filter(key => {
      const persisted = existingByKey.get(key);
      return persisted && persisted.internal_status !== 'convertida_oportunidad';
    }));

    convertedOverrides.push({
      stable_key: convertedRow.stable_key,
      url: official.url || convertedRow.url || null,
      process_id: official.process_id || convertedRow.process_id || null,
      status: official.status || convertedRow.status || null,
      deadline_at: deadlineValue(official) || deadlineValue(convertedRow) || null,
    });

    const officialUrl = official.url || null;
    if (convertedRow.converted_opportunity_id && officialUrl && officialUrl !== convertedRow.url) {
      opportunityPatches.push({
        converted_opportunity_id: convertedRow.converted_opportunity_id,
        officialUrl,
        historicalUrl: convertedRow.url || null,
        processId: official.process_id || convertedRow.process_id || null,
        deadline: deadlineValue(official) || deadlineValue(convertedRow) || null,
      });
    }
  }

  return {
    omitStableKeys: uniqueStrings(omitStableKeys),
    discardStableKeys: uniqueStrings(discardStableKeys),
    convertedOverrides,
    opportunityPatches,
  };
}
