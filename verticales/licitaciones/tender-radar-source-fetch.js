export const TENDER_RADAR_SOURCE_PAGE_SIZE = 1000;

export async function fetchTenderRadarSourceRows(database, { cutoffIso = null, activeDeadlineIso = null } = {}) {
  const pageSize = TENDER_RADAR_SOURCE_PAGE_SIZE;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let query = database.from('psi_public_tenders').select('*')
      .order('last_seen_at', { ascending: false })
      .order('id', { ascending: true });
    if (cutoffIso) {
      query = query.or(`last_seen_at.gte.${cutoffIso},deadline_at.gte.${activeDeadlineIso}`);
    }
    const result = await query.range(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
