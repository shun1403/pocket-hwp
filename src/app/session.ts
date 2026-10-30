import { EditableDocument } from '../doc/editable';
import { hasMemos } from '../doc/ops/memos';
import { HwpDocument, initEngine } from '../engine/rhwp';
import { documentText, exportDocument, renderThumbnail } from '../export/exporters';
import { type DocFormat, baseName, detectFormat } from '../platform/bytes';
import { type FileSource, fileHandles, writeToSource } from '../platform/document-files';
import { type LibraryEntry, library, newId } from '../platform/library';
import { searchIndex } from '../platform/search-index';
import { VERSION_INTERVAL_MS, type DocVersion, versions } from '../platform/versions';
import { buildSample } from './sample';

const AUTOSAVE_DELAY_MS = 1500;

export interface OpenOptions {
  id?: string;
  password?: string;
  keepOriginal?: boolean;
  source?: FileSource;
  /** 컴퓨터 브라우저에서 연 파일 핸들 (source.kind === 'web') */
  handle?: FileSystemFileHandle;
}

/**
 * 열려 있는 문서 하나.
 *
 * 모바일 앱은 원본 파일 자리에 다시 쓸 수 없는 경우가 많아서(공유받은 파일, 클라우드 파일 등)
 * 문서를 앱 보관함(IndexedDB)에 두고 편집하는 즉시 자동 저장한다.
 * 다른 곳으로 내보낼 때는 공유/내보내기를 쓴다.
 */
export class DocumentSession {
  private saveTimer = 0;
  private saving: Promise<void> | null = null;
  dirty = false;
  /** 마지막 버전을 남긴 뒤 저장한 변경이 있다 */
  private unversioned = false;
  private lastVersionAt = 0;
  /** 이번에 연 파일 핸들 (다시 열었으면 저장할 때 보관함에서 꺼낸다) */
  private webHandle: FileSystemFileHandle | undefined;
  onSaved: (() => void) | null = null;

  private constructor(
    readonly doc: EditableDocument,
    private entry: Omit<LibraryEntry, 'bytes'>,
    /** 암호 문서면 보관본도 같은 암호로 저장한다 (메모리에만 둔다) */
    private readonly password?: string,
  ) {}

  get id(): string {
    return this.entry.id;
  }

  get name(): string {
    return this.entry.name;
  }

  get format(): DocFormat {
    return this.entry.format;
  }

  get edited(): boolean {
    return this.entry.edited;
  }

  get protected(): boolean {
    return !!this.password;
  }

  /** 원래 파일 이름 (그 자리에 다시 저장할 수 있을 때만) */
  get sourceName(): string | null {
    return this.entry.source?.name ?? null;
  }

  /**
   * 원래 파일 자리에 덮어쓴다. 형식은 원래 파일 확장자를 따르고, 암호 문서는 같은 암호로 저장한다.
   * 저장 전에 빠질 수 있는 내용(lossWarnings)을 confirm 으로 묻는다.
   */
  async saveToSource(confirm: (lossWarnings: string[], format: DocFormat) => Promise<boolean>): Promise<boolean> {
    const source = this.entry.source;
    if (!source) return false;
    const format: DocFormat = /\.hwpx$/i.test(source.name) ? 'hwpx' : 'hwp';
    const { bytes, lossWarnings } = exportDocument(this.doc.raw, format, this.password);
    if (lossWarnings.length > 0 && !(await confirm(lossWarnings, format))) return false;
    const handle = source.kind === 'web' ? (this.webHandle ??= await fileHandles.get(this.entry.id)) : undefined;
    const next = await writeToSource(source, bytes, handle);
    this.entry = { ...this.entry, source: next };
    const stored = await library.get(this.entry.id);
    if (stored) await library.put({ ...stored, source: next });
    await this.markExported();
    return true;
  }

  /**
   * - id: 보관함에 있는 문서를 다시 열 때
   * - keepOriginal: 처음 연 파일을 "처음 상태" 버전으로 남긴다 (빈 새 문서는 남길 필요가 없다)
   * - source: 원래 파일 자리 (거기에 다시 저장할 수 있다)
   */
  static async open(name: string, bytes: Uint8Array, opts: OpenOptions = {}): Promise<DocumentSession> {
    const { id, password, keepOriginal = true } = opts;
    await initEngine();
    const raw = password ? HwpDocument.openWithPassword(bytes, password) : new HwpDocument(bytes);
    const now = Date.now();
    const existing = id ? await library.get(id) : undefined;
    const session = new DocumentSession(
      new EditableDocument(raw),
      {
        id: id ?? newId(),
        name,
        format: existing?.format ?? detectFormat(name, bytes),
        size: bytes.length,
        pages: raw.pageCount(),
        openedAt: now,
        updatedAt: existing?.updatedAt ?? now,
        edited: existing?.edited ?? false,
        thumbnail: existing?.thumbnail,
        exportedAt: existing?.exportedAt,
        pinned: existing?.pinned,
        source: opts.source ?? existing?.source,
      },
      password,
    );
    // 암호 문서의 첫 쪽 그림을 목록에 남기지 않는다.
    if (!session.entry.thumbnail && !password) session.entry.thumbnail = renderThumbnail(raw);
    await library.put({ ...session.entry, bytes });
    await session.indexText();
    if (opts.handle) {
      session.webHandle = opts.handle;
      await fileHandles.put(session.id, opts.handle).catch(() => undefined);
    }
    try {
      session.lastVersionAt = await versions.latestAt(session.id);
      if (keepOriginal && !(await versions.hasOriginal(session.id))) {
        await versions.add({ docId: session.id, at: now, name, format: session.entry.format, size: bytes.length, bytes, reason: 'original' });
      }
    } catch {
      // 버전 기록은 보조 기능이라 실패해도 문서는 연다.
    }
    return session;
  }

  static async openEntry(id: string, password?: string): Promise<DocumentSession | null> {
    const entry = await library.get(id);
    if (!entry) return null;
    return DocumentSession.open(entry.name, entry.bytes, { id: entry.id, password });
  }

  static async createBlank(): Promise<DocumentSession> {
    await initEngine();
    const raw = HwpDocument.createEmpty();
    raw.createBlankDocument();
    const bytes = raw.exportHwp();
    raw.free();
    const stamp = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
    return DocumentSession.open(`새 문서 ${stamp}.hwp`, bytes, { keepOriginal: false });
  }

  /** 처음 쓰는 사람을 위한 안내 문서 */
  static async createSample(): Promise<DocumentSession> {
    await initEngine();
    const raw = HwpDocument.createEmpty();
    raw.createBlankDocument();
    buildSample(new EditableDocument(raw));
    const bytes = raw.exportHwp();
    raw.free();
    return DocumentSession.open('Pocket HWP 사용 안내.hwp', bytes, { keepOriginal: false });
  }

  /** 보관함 전체 검색에 쓸 본문 글을 남긴다. 암호 문서는 글을 남기지 않는다. */
  private async indexText(): Promise<void> {
    const skipped = !!this.password;
    await searchIndex
      .put({ id: this.entry.id, updatedAt: this.entry.updatedAt, text: skipped ? '' : documentText(this.doc.raw), skipped })
      .catch(() => undefined);
  }

  /** 편집이 일어날 때마다 호출: 잠시 뒤 보관함에 저장한다. */
  markDirty(): void {
    this.dirty = true;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
  }

  /** 지금 바로 보관함에 저장한다. */
  async save(): Promise<void> {
    window.clearTimeout(this.saveTimer);
    if (this.saving) await this.saving;
    if (!this.dirty) return;
    this.saving = (async () => {
      this.dirty = false;
      // 보관본은 rhwp가 가장 안정적으로 다루는 HWP 5.0으로 둔다.
      // 다만 엔진은 HWP로 저장할 때 메모를 지키지 못하므로 메모가 있으면 HWPX로 둔다.
      const format: DocFormat = hasMemos(this.doc.raw) ? 'hwpx' : 'hwp';
      const { bytes } = exportDocument(this.doc.raw, format, this.password);
      this.entry = {
        ...this.entry,
        format,
        name: `${baseName(this.entry.name)}.${format}`,
        size: bytes.length,
        pages: this.doc.pageCount(),
        updatedAt: Date.now(),
        edited: true,
        thumbnail: this.password ? undefined : (renderThumbnail(this.doc.raw) ?? this.entry.thumbnail),
      };
      await library.put({ ...this.entry, bytes });
      await this.indexText();
      this.unversioned = true;
      if (this.entry.updatedAt - this.lastVersionAt >= VERSION_INTERVAL_MS) await this.addVersion(bytes, 'auto');
      this.onSaved?.();
    })();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }

  private async addVersion(bytes: Uint8Array, reason: DocVersion['reason']): Promise<void> {
    try {
      const at = Date.now();
      await versions.add({ docId: this.entry.id, at, name: this.entry.name, format: this.entry.format, size: bytes.length, bytes, reason });
      this.lastVersionAt = at;
      this.unversioned = false;
    } catch {
      // 저장 공간이 모자라면 버전은 건너뛴다 (보관함 저장은 이미 끝났다).
    }
  }

  /** 다른 버전으로 되돌리기 전에 지금 내용을 버전으로 남긴다. */
  async keepCurrentVersion(): Promise<void> {
    await this.save();
    const stored = await library.get(this.entry.id);
    if (stored) await this.addVersion(stored.bytes, 'restore');
  }

  /** HWP/HWPX 사본을 앱 밖으로 내보냈다 (백업 알림에서 빠진다). */
  async markExported(): Promise<void> {
    await this.save();
    const at = Date.now();
    this.entry = { ...this.entry, exportedAt: at };
    await library.markExported([this.entry.id], at);
  }

  async rename(name: string): Promise<void> {
    // 보관본의 형식을 따른다 (고친 문서는 HWP, 메모가 있으면 HWPX).
    const ext = this.entry.format === 'hwpx' ? '.hwpx' : '.hwp';
    const clean = baseName(name.trim()) || baseName(this.entry.name);
    this.entry = { ...this.entry, name: `${clean}${ext}` };
    const stored = await library.get(this.entry.id);
    if (stored) await library.put({ ...stored, name: this.entry.name });
  }

  async close(): Promise<void> {
    await this.save();
    // 마지막 버전 뒤로 고친 내용이 있으면 닫을 때 한 번 남긴다.
    if (this.unversioned) {
      const stored = await library.get(this.entry.id).catch(() => undefined);
      if (stored) await this.addVersion(stored.bytes, 'auto');
    }
    this.doc.raw.free();
  }
}
