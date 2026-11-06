function canonicalizeTenderRowValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeTenderRowValue);
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = canonicalizeTenderRowValue(value[key]);
      return acc;
    }, {});
  }
  return value;
}

export function canonicalizeTenderRowJson(row) {
  return JSON.stringify(canonicalizeTenderRowValue(row));
}

export function collapseDuplicateTenderRows(rows) {
  const seenCanonicalRows = new Set();
  const collapsedRows = [];
  let duplicatesCollapsed = 0;
  for (const row of rows) {
    const canonicalJson = canonicalizeTenderRowJson(row);
    if (seenCanonicalRows.has(canonicalJson)) {
      duplicatesCollapsed += 1;
      continue;
    }
    seenCanonicalRows.add(canonicalJson);
    collapsedRows.push(row);
  }
  return { rows: collapsedRows, duplicatesCollapsed };
}
