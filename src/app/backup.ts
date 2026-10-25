import { buildZip, readZip } from '../export/zip';
import { baseName, detectFormat, safeFileName } from '../platform/bytes';
import { type LibraryEntry, library, newId } from '../platform/library';

/** 백업 파일 안의 목록. 문서 파일은 같은 ZIP에 따로 들어 있다. */
interface Manifest {
  app: 'pocket-hwp';
  version: 1;
  createdAt: number;
  documents: { id: string; file: string; name: string; format: LibraryEntry['format']; updatedAt: number; edited: boolean }[];
}

const MANIFEST = 'pocket-hwp-backup.json';

export function backupFileName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `Pocket HWP 백업 ${d}.zip`;
}

/** 보관함의 모든 문서를 ZIP 하나로 묶는다. 다른 앱에서도 풀어서 바로 열 수 있다. */
export async function createBackup(): Promise<{ zip: Uint8Array; count: number; ids: string[] }> {
  const entries = await library.all();
  const used = new Set<string>();
  const manifest: Manifest = { app: 'pocket-hwp', version: 1, createdAt: Date.now(), documents: [] };
  const files = entries.map((e) => {
    // 같은 이름이 있으면 (2), (3)… 을 붙인다.
    const base = safeFileName(baseName(e.name));
    let file = `${base}.${e.format}`;
    for (let n = 2; used.has(file); n += 1) file = `${base} (${n}).${e.format}`;
    used.add(file);
    manifest.documents.push({ id: e.id, file, name: e.name, format: e.format, updatedAt: e.updatedAt, edited: e.edited });
    return { name: file, bytes: e.bytes };
  });
  files.push({ name: MANIFEST, bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) });
  return { zip: buildZip(files), count: entries.length, ids: entries.map((e) => e.id) };
}

/**
 * 백업 ZIP을 보관함으로 되살린다. 이미 있는 문서는 백업이 더 새것일 때만 바꾼다.
 * Pocket HWP 백업이 아닌 ZIP이라도 안의 HWP/HWPX 파일은 모두 가져온다.
 */
export async function restoreBackup(zip: Uint8Array): Promise<{ added: number; updated: number; skipped: number }> {
  const files = await readZip(zip);
  const manifestFile = files.find((f) => f.name === MANIFEST);
  const manifest = manifestFile ? (JSON.parse(new TextDecoder().decode(manifestFile.bytes)) as Manifest) : null;
  const byFile = new Map(manifest?.documents.map((d) => [d.file, d]) ?? []);
  const now = Date.now();
  const result = { added: 0, updated: 0, skipped: 0 };
  for (const f of files) {
    if (f.name === MANIFEST || !/\.(hwpx?)$/i.test(f.name)) continue;
    const meta = byFile.get(f.name);
    const existing = meta ? await library.get(meta.id) : undefined;
    if (existing && existing.updatedAt >= (meta?.updatedAt ?? 0)) {
      result.skipped += 1;
      continue;
    }
    const name = meta?.name ?? f.name.split('/').pop()!;
    await library.put({
      id: meta?.id ?? newId(),
      name,
      format: meta?.format ?? detectFormat(name, f.bytes),
      bytes: f.bytes,
      size: f.bytes.length,
      pages: existing?.pages ?? 0,
      openedAt: existing?.openedAt ?? now,
      updatedAt: meta?.updatedAt ?? now,
      edited: meta?.edited ?? false,
      // 백업에서 되살린 문서는 이미 밖에 사본(백업 파일)이 있다.
      exportedAt: now,
      thumbnail: existing?.thumbnail,
    });
    if (existing) result.updated += 1;
    else result.added += 1;
  }
  return result;
}
