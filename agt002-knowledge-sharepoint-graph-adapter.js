// AGT-002 knowledge — Microsoft Graph adapter for `publishTenderKnowledgeVersion`
// (design §16, Fase 4 rollout). This module performs the actual HTTPS calls
// against a configured Graph endpoint; it is only ever constructed by the
// caller when every required credential/target is present (site, drive,
// access token). It never retries and never fabricates a result: any
// non-2xx/404 Graph response surfaces as an error, and an eTag mismatch on
// write surfaces as `{ code: 'etag_conflict' }` for the pure publication
// module to reconcile (§16.1, §16.4).

function graphPathSegment(relativePath) {
  return String(relativePath).split('/').map(encodeURIComponent).join('/');
}

export function createTenderKnowledgeSharePointGraphAdapter({ baseUrl, siteId, driveId, accessToken, fetchImpl = fetch }) {
  const root = `${String(baseUrl).replace(/\/+$/, '')}/sites/${encodeURIComponent(siteId)}/drives/${encodeURIComponent(driveId)}/root:/`;
  const authHeaders = { authorization: `Bearer ${accessToken}` };

  return Object.freeze({
    siteId,
    driveId,
    async get({ relativePath }) {
      const response = await fetchImpl(`${root}${graphPathSegment(relativePath)}`, { headers: authHeaders });
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(`sharepoint_publication_unavailable: Graph respondió ${response.status} al consultar ${relativePath}.`);
      }
      const record = await response.json();
      return {
        webUrl: record.webUrl,
        eTag: record.eTag,
        driveItemId: record.id,
        sharepointVersion: record.sharepointVersion,
        content: record.content,
      };
    },
    async createOrUpdate({ relativePath, content, expectedETag }) {
      const conditionalHeaders = expectedETag ? { 'if-match': expectedETag } : { 'if-none-match': '*' };
      const response = await fetchImpl(`${root}${graphPathSegment(relativePath)}:/content`, {
        method: 'PUT',
        headers: { ...authHeaders, ...conditionalHeaders, 'content-type': 'text/markdown; charset=utf-8' },
        body: content,
      });
      if (response.status === 409 || response.status === 412) {
        const conflict = new Error('etag_conflict');
        conflict.code = 'etag_conflict';
        throw conflict;
      }
      if (!response.ok) {
        throw new Error(`sharepoint_publication_unavailable: Graph respondió ${response.status} al publicar ${relativePath}.`);
      }
      const record = await response.json();
      return {
        webUrl: record.webUrl,
        eTag: record.eTag,
        driveItemId: record.id,
        sharepointVersion: record.sharepointVersion,
      };
    },
  });
}
