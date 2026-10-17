// Oversized snapshots (nhl_projections ~3.8 MB, WNBA ~3.2 MB, NFL ~1.5 MB)
// are stored as several rows that share one version. id=1 names the chunk
// ids. Readers join a complete set back into the single payload a one-row
// publish used to store. A missing chunk or a different version is rejected
// so a reader never mixes two publishes.

export function snapshotChunkManifest(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const marker = data.snapshotChunks;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return null;
  return marker;
}

function chunkVersion(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const version = payload.version;
  if (typeof version !== 'string' || !version) return null;
  if (payload.generated_at != null && payload.generated_at !== version) return null;
  return version;
}

export function assembleSnapshotRows(head, extraRows) {
  if (!head) return null;
  const manifest = snapshotChunkManifest(head.data);
  if (!manifest) return head;
  const version = chunkVersion(manifest);
  const kind = manifest.kind;
  const ids = manifest.ids;
  if (
    !version
    || (kind !== 'list' && kind !== 'object')
    || !Array.isArray(ids)
    || ids.length === 0
    || ids.some((id) => !Number.isInteger(id))
    || new Set(ids).size !== ids.length
  ) {
    throw new Error('snapshot chunk manifest is invalid');
  }
  const byId = new Map((extraRows || []).filter(Boolean).map((row) => [Number(row.id), row]));
  const parts = [];
  let updated = head.updated_at || null;
  for (let index = 0; index < ids.length; index += 1) {
    const row = byId.get(ids[index]);
    const chunk = row?.data;
    if (!row || chunkVersion(chunk) !== version) {
      throw new Error(row
        ? 'snapshot chunk set is mixed'
        : `snapshot is missing chunk ${index + 1} of ${ids.length}`);
    }
    if (chunk.kind !== kind || !Number.isInteger(chunk.index) || chunk.index !== index) {
      throw new Error('snapshot chunk set is mixed');
    }
    if (kind === 'list') {
      if (!Array.isArray(chunk.rows)) {
        throw new Error(`snapshot is missing chunk ${index + 1} of ${ids.length}`);
      }
      parts.push(chunk.rows);
    } else if (!chunk.object || typeof chunk.object !== 'object' || Array.isArray(chunk.object)) {
      throw new Error(`snapshot is missing chunk ${index + 1} of ${ids.length}`);
    } else {
      parts.push(chunk.object);
    }
    if (row.updated_at && (!updated || row.updated_at > updated)) updated = row.updated_at;
  }
  if (kind === 'list') return { data: parts.flat(), updated_at: updated };
  const data = {};
  for (const part of parts) {
    for (const key of Object.keys(part)) {
      if (Object.hasOwn(data, key)) throw new Error('snapshot chunk set is mixed');
      data[key] = part[key];
    }
  }
  return { data, updated_at: updated };
}
