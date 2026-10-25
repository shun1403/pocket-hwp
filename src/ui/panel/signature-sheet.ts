import { insertPicture } from '../../doc/ops/inserts';
import type { Editor } from '../../editor/editor';
import { pickFile } from '../../platform/files';
import { type SavedSignature, inkBounds, removePaper, signatures } from '../../platform/signatures';
import { h } from '../dom';
import { icon } from '../icons';
import { Sheet } from '../sheet';
import { toast } from '../toast';

/** 문서에 넣을 너비 (96dpi px): 서명 약 40mm, 도장 약 24mm */
const SIGN_WIDTH = 150;
const STAMP_WIDTH = 90;
const PEN_COLORS = [
  { label: '검정', value: '#111111' },
  { label: '파랑', value: '#1d3fbf' },
];

interface Png {
  png: Uint8Array;
  width: number;
  height: number;
}

/** 캔버스의 잉크 부분만 잘라 PNG로 만든다. 그린 게 없으면 null */
async function cropToPng(canvas: HTMLCanvasElement, pad = 8): Promise<Png | null> {
  const ctx = canvas.getContext('2d')!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const box = inkBounds(img.data, canvas.width, canvas.height);
  if (!box) return null;
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  const w = Math.min(canvas.width - x, box.w + pad * 2);
  const hgt = Math.min(canvas.height - y, box.h + pad * 2);
  const out = document.createElement('canvas');
  out.width = w;
  out.height = hgt;
  out.getContext('2d')!.putImageData(ctx.getImageData(x, y, w, hgt), 0, 0);
  const blob = await new Promise<Blob | null>((r) => out.toBlob(r, 'image/png'));
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), width: w, height: hgt };
}

function insert(editor: Editor, sig: Png, kind: SavedSignature['kind']): void {
  const width = kind === 'stamp' ? STAMP_WIDTH : SIGN_WIDTH;
  editor.command((doc, caret) => insertPicture(doc, caret, sig.png, { width: sig.width, height: sig.height }, 'png', width));
}

/** 손가락으로 그리는 서명 칸 */
function signaturePad(): { el: HTMLElement; canvas: HTMLCanvasElement; clear(): void; setColor(c: string): void; isEmpty(): boolean } {
  const canvas = h('canvas.sign-canvas', { 'aria-label': '여기에 손가락으로 서명하세요' }) as HTMLCanvasElement;
  const hint = h('span.sign-hint', { 'aria-hidden': 'true' }, '여기에 서명하세요');
  const el = h('div.sign-pad', {}, canvas, hint);
  let color = PEN_COLORS[0].value;
  let drawn = false;
  let last: { x: number; y: number } | null = null;
  let mid: { x: number; y: number } | null = null;
  const size = () => {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== Math.round(rect.width * dpr)) {
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      drawn = false;
      hint.hidden = false;
    }
    return dpr;
  };
  const point = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const dpr = size();
    return { x: (e.clientX - rect.left) * dpr, y: (e.clientY - rect.top) * dpr };
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    last = point(e);
    mid = last;
    const ctx = canvas.getContext('2d')!;
    const dpr = size();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(last.x, last.y, 1.6 * dpr, 0, Math.PI * 2);
    ctx.fill();
    drawn = true;
    hint.hidden = true;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!last || !mid) return;
    const p = point(e);
    const ctx = canvas.getContext('2d')!;
    const dpr = size();
    const next = { x: (last.x + p.x) / 2, y: (last.y + p.y) / 2 };
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.2 * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(mid.x, mid.y);
    ctx.quadraticCurveTo(last.x, last.y, next.x, next.y);
    ctx.stroke();
    last = p;
    mid = next;
  });
  const end = () => {
    last = null;
    mid = null;
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  return {
    el,
    canvas,
    clear() {
      canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
      drawn = false;
      hint.hidden = false;
    },
    setColor(c: string) {
      color = c;
    },
    isEmpty: () => !drawn,
  };
}

/** 사진에서 도장·서명만 남긴 캔버스 */
async function stampFromPhoto(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 700 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  removePaper(img.data);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/**
 * 서명·도장 넣기. 손가락으로 서명하거나 도장 사진을 찍으면 바탕을 투명하게 만들어 캐럿 자리에 넣는다.
 * 저장해 두면 다음부터 한 번에 넣을 수 있다 (이 기기 안에만 저장).
 */
export async function openSignatureSheet(editor: Editor): Promise<void> {
  const urls: string[] = [];
  const sheet = new Sheet({ title: '서명·도장 넣기', onClose: () => urls.forEach((u) => URL.revokeObjectURL(u)) });
  const savedBox = h('div.saved-signs');
  const renderSaved = async () => {
    const list = await signatures.list().catch(() => [] as SavedSignature[]);
    urls.splice(0).forEach((u) => URL.revokeObjectURL(u));
    savedBox.replaceChildren(
      ...list.map((s) => {
        const url = URL.createObjectURL(new Blob([s.png as BlobPart], { type: 'image/png' }));
        urls.push(url);
        return h(
          'div.saved-sign',
          {},
          h(
            'button.saved-sign-btn',
            { type: 'button', 'aria-label': s.kind === 'stamp' ? '저장한 도장 넣기' : '저장한 서명 넣기', onclick: () => (sheet.close(), insert(editor, s, s.kind)) },
            h('img', { src: url, alt: '' }),
          ),
          h(
            'button.icon-btn.small.saved-sign-del',
            {
              type: 'button',
              'aria-label': '저장한 서명 지우기',
              onclick: async () => {
                await signatures.remove(s.id);
                void renderSaved();
              },
            },
            icon('close', 16),
          ),
        );
      }),
    );
    savedSection.hidden = list.length === 0;
  };
  const savedSection = h('section.sign-section', {}, h('h3.panel-label', {}, '저장한 서명·도장'), savedBox);

  const keep = h('input', { type: 'checkbox', checked: true }) as HTMLInputElement;
  const keepRow = h('label.check-row', {}, keep, '다음에도 쓰게 이 기기에 저장');

  // 손글씨 서명
  const pad = signaturePad();
  const colorBtns = PEN_COLORS.map((c, i) => {
    const b = h('button.chip-btn', { type: 'button', 'aria-pressed': String(i === 0) }, c.label);
    b.style.setProperty('color', c.value);
    b.addEventListener('click', () => {
      pad.setColor(c.value);
      colorBtns.forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      colorBtns.forEach((x) => x.classList.toggle('on', x === b));
    });
    if (i === 0) b.classList.add('on');
    return b;
  });
  const signPane = h(
    'div.sign-pane',
    {},
    pad.el,
    h('div.sign-tools', {}, ...colorBtns, h('button.chip-btn', { type: 'button', onclick: () => pad.clear() }, '지우기')),
  );

  // 도장 사진
  let stamp: HTMLCanvasElement | null = null;
  const stampPreview = h('div.stamp-preview', {}, h('span.muted', {}, '흰 종이에 찍은 도장을 사진으로 찍으면 바탕을 지워 줘요.'));
  const loadStamp = async (capture: boolean) => {
    const file = await pickFile('image/*', capture);
    if (!file) return;
    try {
      stamp = await stampFromPhoto(file);
      stampPreview.replaceChildren(stamp);
    } catch {
      toast('사진을 읽지 못했어요.');
    }
  };
  const stampPane = h(
    'div.sign-pane',
    {},
    stampPreview,
    h(
      'div.sign-tools',
      {},
      h('button.chip-btn', { type: 'button', onclick: () => void loadStamp(true) }, icon('camera', 18), '사진 찍기'),
      h('button.chip-btn', { type: 'button', onclick: () => void loadStamp(false) }, icon('image', 18), '사진 고르기'),
    ),
  );
  stampPane.hidden = true;

  let mode: 'sign' | 'stamp' = 'sign';
  const modeBtns = (['sign', 'stamp'] as const).map((m) =>
    h(
      'button.seg',
      {
        type: 'button',
        'aria-pressed': String(m === 'sign'),
        onclick: () => {
          mode = m;
          signPane.hidden = m !== 'sign';
          stampPane.hidden = m !== 'stamp';
          modeBtns.forEach((b, i) => {
            const on = (['sign', 'stamp'] as const)[i] === m;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', String(on));
          });
        },
      },
      m === 'sign' ? '손글씨 서명' : '도장 사진',
    ),
  );
  modeBtns[0].classList.add('on');

  const insertBtn = h(
    'button.primary-btn.full',
    {
      type: 'button',
      onclick: async () => {
        const source = mode === 'sign' ? (pad.isEmpty() ? null : pad.canvas) : stamp;
        const png = source ? await cropToPng(source) : null;
        if (!png) {
          toast(mode === 'sign' ? '먼저 서명해 주세요.' : '먼저 도장 사진을 골라 주세요.');
          return;
        }
        if (keep.checked) await signatures.add({ kind: mode, ...png }).catch(() => undefined);
        sheet.close();
        insert(editor, png, mode);
      },
    },
    '넣기',
  );

  sheet.body.append(savedSection, h('div.btn-row', {}, ...modeBtns), signPane, stampPane, keepRow, insertBtn);
  sheet.open();
  void renderSaved();
}
