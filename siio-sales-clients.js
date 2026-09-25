export function normalizeClientName(name) {
  if (typeof name !== 'string') return '';
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function typeaheadMatches(clients, query) {
  const normalizedQuery = normalizeClientName(query);
  if (!normalizedQuery) return clients.slice();
  return clients.filter((client) => normalizeClientName(client.company_name).includes(normalizedQuery));
}

export function duplicateNameRequiresExistingSelection({ companyName, clientId, existingNormalizedNames }) {
  const normalized = normalizeClientName(companyName);
  if (!normalized || clientId) return false;
  return existingNormalizedNames.has(normalized);
}
