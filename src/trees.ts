import type { Env, TreeDiff, WireFile } from './types';

/**
 * Gzip a file list for storage in the trees row.
 *
 * Called only for a hash we have not stored: the hash is derived from the list,
 * so an existing row already holds byte-identical content and rewriting it
 * would be pure waste.
 *
 * Returns the bytes rather than writing them, so the caller can bind them into
 * the same INSERT that creates the tree row -- one D1 write instead of two.
 */
export async function packTree(files: WireFile[]): Promise<ArrayBuffer> {
  const gzip = new Response(JSON.stringify(files)).body!.pipeThrough(new CompressionStream('gzip'));
  // A compression stream has no known length, and D1 needs a sized value to
  // bind, so buffer it. File lists are hundreds of KB at worst.
  return new Response(gzip).arrayBuffer();
}

/** Read a file list back. Returns null when the tree was never stored with files. */
export async function getTree(env: Env, hash: string): Promise<WireFile[] | null> {
  const row = await env.DB.prepare(`SELECT files_blob FROM trees WHERE tree_hash = ?1`)
    .bind(hash)
    .first<{ files_blob: ArrayBuffer | number[] | null }>();
  if (!row?.files_blob) return null;

  // D1 hands a BLOB back as ArrayBuffer on current versions and as a byte array
  // on older ones. Normalise before decompressing.
  const bytes =
    row.files_blob instanceof ArrayBuffer ? row.files_blob : new Uint8Array(row.files_blob).buffer;

  const text = await new Response(
    new Response(bytes).body!.pipeThrough(new DecompressionStream('gzip')),
  ).text();
  return JSON.parse(text) as WireFile[];
}

/**
 * Compare two file lists by path_hash. Runs once at ingest while both lists are
 * already in memory, so the dashboard reads a summary rather than recomputing.
 */
export function diffTrees(prev: WireFile[], next: WireFile[]): Omit<TreeDiff, 'lines_delta'> {
  const before = new Map(prev.map((f) => [f.path_hash, f.content_hash]));
  let added = 0;
  let modified = 0;

  for (const f of next) {
    const had = before.get(f.path_hash);
    if (had === undefined) added++;
    else if (had !== f.content_hash) modified++;
    before.delete(f.path_hash);
  }

  // Whatever is left in `before` was not in `next`.
  return { files_added: added, files_modified: modified, files_removed: before.size };
}
