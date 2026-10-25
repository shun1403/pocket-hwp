import { EditableDocument } from '../doc/editable';
import { HwpDocument, initEngine } from '../engine/rhwp';
import { exportDocument, renderThumbnail } from '../export/exporters';
import { type DocFormat, baseName, detectFormat } from '../platform/bytes';
import { type LibraryEntry, library, newId } from '../platform/library';

const AUTOSAVE_DELAY_MS = 1500;

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
  onSaved: (() => void) | null = null;

  private constructor(
    readonly doc: EditableDocument,
    private entry: Omit<LibraryEntry, 'bytes'>,
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

  static async open(name: string, bytes: Uint8Array, id?: string): Promise<DocumentSession> {
    await initEngine();
    const raw = new HwpDocument(bytes);
    const now = Date.now();
    const existing = id ? await library.get(id) : undefined;
    const session = new DocumentSession(new EditableDocument(raw), {
      id: id ?? newId(),
      name,
      format: existing?.format ?? detectFormat(name, bytes),
      size: bytes.length,
      pages: raw.pageCount(),
      openedAt: now,
      updatedAt: existing?.updatedAt ?? now,
      edited: existing?.edited ?? false,
      thumbnail: existing?.thumbnail,
    });
    if (!session.entry.thumbnail) session.entry.thumbnail = renderThumbnail(raw);
    await library.put({ ...session.entry, bytes });
    return session;
  }

  static async openEntry(id: string): Promise<DocumentSession | null> {
    const entry = await library.get(id);
    if (!entry) return null;
    return DocumentSession.open(entry.name, entry.bytes, entry.id);
  }

  static async createBlank(): Promise<DocumentSession> {
    await initEngine();
    const raw = HwpDocument.createEmpty();
    raw.createBlankDocument();
    const bytes = raw.exportHwp();
    raw.free();
    const stamp = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
    return DocumentSession.open(`새 문서 ${stamp}.hwp`, bytes);
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
      const { bytes } = exportDocument(this.doc.raw, 'hwp');
      this.entry = {
        ...this.entry,
        format: 'hwp',
        name: `${baseName(this.entry.name)}.hwp`,
        size: bytes.length,
        pages: this.doc.pageCount(),
        updatedAt: Date.now(),
        edited: true,
        thumbnail: renderThumbnail(this.doc.raw) ?? this.entry.thumbnail,
      };
      await library.put({ ...this.entry, bytes });
      this.onSaved?.();
    })();
    try {
      await this.saving;
    } finally {
      this.saving = null;
    }
  }

  async rename(name: string): Promise<void> {
    const ext = this.entry.format === 'hwpx' && !this.entry.edited ? '.hwpx' : '.hwp';
    const clean = baseName(name.trim()) || baseName(this.entry.name);
    this.entry = { ...this.entry, name: `${clean}${ext}` };
    const stored = await library.get(this.entry.id);
    if (stored) await library.put({ ...stored, name: this.entry.name });
  }

  async close(): Promise<void> {
    await this.save();
    this.doc.raw.free();
  }
}
