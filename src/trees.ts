import type { Env, TreeDiff, WireFile } from './types';

export const treeKey = (hash: string) => `trees/${hash}.json.gz`;

/**
 * Store a file list under its tree hash, gzipped. Called only when the hash is
 * new: the hash is derived from the list, so an existing key already holds
 * byte-identical content and rewriting it would be pure waste.
 */
export async function putTree(env: Env, hash: string, files: WireFile[]): Promise<string> {
  const key = treeKey(hash);
  const body = new Response(JSON.stringify(files)).body!.pipeThrough(new CompressionStream('gzip'));
  await env.TREES.put(key, body, {
    httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
  });
  return key;
}

/** Read a file list back. Returns null when the tree was never stored with files. */
export async function getTree(env: Env, hash: string): Promise<WireFile[] | null> {
  const obj = await env.TREES.get(treeKey(hash));
  if (!obj) return null;
  const text = await new Response(obj.body!.pipeThrough(new DecompressionStream('gzip'))).text();
  return JSON.parse(text) as WireFile[];
}

/**
 * Compare two file lists by path_hash. Runs once at ingest while both lists are
 * already in memory, so the dashboard reads nothing but D1.
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
