export function mergeCommercialOwnerOptions(owners = [], priorities = []) {
  const options = new Map();
  for (const row of priorities) {
    if (row?.owner_id) options.set(row.owner_id, row.owner_name || row.owner_id);
  }
  for (const owner of owners) {
    if (owner?.id) options.set(owner.id, owner.full_name || owner.id);
  }
  return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'));
}
