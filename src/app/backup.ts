import { PROFILE_FIELDS, type Profile } from '../doc/ops/autofill';
import { buildZip, readZip } from '../export/zip';
import { base64ToBytes, baseName, bytesToBase64, detectFormat, safeFileName } from '../platform/bytes';
import { type LibraryEntry, library, newId } from '../platform/library';
import { profiles } from '../platform/profiles';
import { type SavedSignature, signatures } from '../platform/signatures';

/** 백업 파일 안의 목록. 문서 파일은 같은 ZIP에 따로 들어 있다. */
interface Manifest {
  app: 'pocket-hwp';
  version: 1;
  createdAt: number;
  documents: { id: string; file: string; name: string; format: LibraryEntry['format']; updatedAt: number; edited: boolean }[];
}

const MANIFEST = 'pocket-hwp-backup.json';
/** 내 정보·서명 (백업할 때 넣겠다고 한 경우만) */
const PERSONAL = 'pocket-hwp-personal.json';

export interface PersonalData {
  profiles: Profile[];
  signatures: SavedSignature[];
}

export function backupFileName(now = new Date()): string {
  const d = now.toISOString().slice(0, 10);
  return `Pocket HWP 백업 ${d}.zip`;
}

/** 보관함의 모든 문서를 ZIP 하나로 묶는다. 다른 앱에서도 풀어서 바로 열 수 있다. personal 을 주면 내 정보·서명도 넣는다. */
export async function createBackup(personal?: PersonalData): Promise<{ zip: Uint8Array; count: number; ids: string[] }> {
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
  if (personal && (personal.profiles.length || personal.signatures.length)) {
    const data = { profiles: personal.profiles, signatures: personal.signatures.map((x) => ({ ...x, png: bytesToBase64(x.png) })) };
    files.push({ name: PERSONAL, bytes: new TextEncoder().encode(JSON.stringify(data)) });
  }
  return { zip: buildZip(files), count: entries.length, ids: entries.map((e) => e.id) };
}

const isDocFile = (name: string) => /\.hwpx?$/i.test(name);

const KEYS = new Set<string>(PROFILE_FIELDS.map((f) => f.key));
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** 백업 안의 내 정보·서명을 읽는다. 모양이 맞지 않는 항목은 버린다. */
export function readPersonal(bytes: Uint8Array | undefined, now: number): PersonalData {
  const out: PersonalData = { profiles: [], signatures: [] };
  if (!bytes) return out;
  let parsed: { profiles?: unknown; signatures?: unknown };
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes)) ?? {};
  } catch {
    return out;
  }
  const okId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v);
  for (const p of (Array.isArray(parsed.profiles) ? parsed.profiles : []).slice(0, 20) as Record<string, unknown>[]) {
    if (!p || !okId(p.id)) continue;
    const kind = p.kind === 'child' || p.kind === 'family' ? p.kind : 'self';
    const raw = (p.values && typeof p.values === 'object' ? p.values : {}) as Record<string, unknown>;
    const values = Object.fromEntries(Object.entries(raw).filter(([k, v]) => KEYS.has(k) && typeof v === 'string').map(([k, v]) => [k, str(v, 200)]));
    out.profiles.push({ id: p.id, label: str(p.label, 40) || '이름 없음', kind, values, updatedAt: typeof p.updatedAt === 'number' ? Math.min(p.updatedAt, now) : now });
  }
  for (const x of (Array.isArray(parsed.signatures) ? parsed.signatures : []).slice(0, 12) as Record<string, unknown>[]) {
    if (!x || !okId(x.id) || typeof x.png !== 'string') continue;
    const w = Number(x.width);
    const hgt = Number(x.height);
    if (!(w > 0 && w <= 4000 && hgt > 0 && hgt <= 4000)) continue;
    let png: Uint8Array;
    try {
      png = base64ToBytes(x.png);
    } catch {
      continue;
    }
    // PNG 머리말이 아니면 버린다.
    if (png[0] !== 0x89 || png[1] !== 0x50) continue;
    out.signatures.push({ id: x.id, kind: x.kind === 'stamp' ? 'stamp' : 'sign', png, width: w, height: hgt, createdAt: typeof x.createdAt === 'number' ? Math.min(x.createdAt, now) : now });
  }
  return out;
}

/**
 * 백업 목록은 다른 사람이 만든 파일일 수도 있으니 모양을 확인하고, 맞지 않는 항목은 버린다.
 * (형식이 hwp/hwpx가 아니면 다음 백업 때 파일 이름에 경로가 섞일 수 있다.)
 */
export function readManifest(bytes: Uint8Array | undefined, now: number): Map<string, Manifest['documents'][number]> {
  const out = new Map<string, Manifest['documents'][number]>();
  if (!bytes) return out;
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return out;
  }
  const docs = (parsed as Partial<Manifest> | null)?.documents;
  if (!Array.isArray(docs)) return out;
  for (const d of docs as Record<string, unknown>[]) {
    if (!d || typeof d.file !== 'string' || typeof d.id !== 'string' || !/^[\w-]{1,64}$/.test(d.id)) continue;
    if (d.format !== 'hwp' && d.format !== 'hwpx') continue;
    const updatedAt = typeof d.updatedAt === 'number' && Number.isFinite(d.updatedAt) ? Math.min(d.updatedAt, now) : now;
    const name = typeof d.name === 'string' && d.name.trim() ? safeFileName(d.name).slice(0, 200) : d.file;
    out.set(d.file, { id: d.id, file: d.file, name, format: d.format, updatedAt, edited: d.edited === true });
  }
  return out;
}

/**
 * 백업 ZIP을 보관함으로 되살린다. 이미 있는 문서는 백업이 더 새것일 때만 바꾼다.
 * Pocket HWP 백업이 아닌 ZIP이라도 안의 HWP/HWPX 파일은 모두 가져온다.
 */
export async function restoreBackup(zip: Uint8Array): Promise<{ added: number; updated: number; skipped: number; personal: number }> {
  const files = await readZip(zip, { accept: (name) => name === MANIFEST || name === PERSONAL || isDocFile(name) });
  const now = Date.now();
  const byFile = readManifest(files.find((f) => f.name === MANIFEST)?.bytes, now);
  const result = { added: 0, updated: 0, skipped: 0, personal: 0 };
  // 내 정보·서명: 이 기기에 없거나 백업이 더 새것일 때만 넣는다.
  const personal = readPersonal(files.find((f) => f.name === PERSONAL)?.bytes, now);
  if (personal.profiles.length || personal.signatures.length) {
    const mine = new Map((await profiles.list()).map((p) => [p.id, p]));
    for (const p of personal.profiles) {
      if ((mine.get(p.id)?.updatedAt ?? -1) >= p.updatedAt) continue;
      await profiles.put(p);
      result.personal += 1;
    }
    const signs = new Set((await signatures.list()).map((x) => x.id));
    for (const x of personal.signatures) {
      if (signs.has(x.id)) continue;
      await signatures.put(x);
      result.personal += 1;
    }
  }
  for (const f of files) {
    if (f.name === MANIFEST || f.name === PERSONAL || !isDocFile(f.name)) continue;
    const meta = byFile.get(f.name);
    const existing = meta ? await library.get(meta.id) : undefined;
    if (existing && existing.updatedAt >= (meta?.updatedAt ?? 0)) {
      result.skipped += 1;
      continue;
    }
    const name = meta?.name ?? safeFileName(f.name.split('/').pop()!);
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
