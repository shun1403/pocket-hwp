import { type Profile, type Slot, PROFILE_FIELDS, SLOT_NAMES, applyFill, findSlots, slotValue } from '../doc/ops/autofill';
import type { Editor } from '../editor/editor';
import { profiles } from '../platform/profiles';
import { signatures } from '../platform/signatures';
import { askConfirm } from './dialog';
import { h } from './dom';
import { icon } from './icons';
import { Sheet } from './sheet';
import { toast } from './toast';

const KINDS: { value: Profile['kind']; label: string }[] = [
  { value: 'self', label: '나' },
  { value: 'child', label: '자녀·학생' },
  { value: 'family', label: '가족·기타' },
];

/** 서명 그림 너비 (96dpi px): 약 30mm. 도장은 약 20mm */
const SIGN_WIDTH = 110;
const STAMP_WIDTH = 75;

function chipGroup<T extends string>(label: string, items: { value: T; label: string }[], current: T, onPick: (v: T) => void): HTMLElement {
  const buttons = items.map((it) =>
    h(
      `button.chip-btn${it.value === current ? '.on' : ''}` as 'button',
      {
        type: 'button',
        'aria-pressed': String(it.value === current),
        onclick: () => {
          buttons.forEach((b, i) => {
            const on = items[i].value === it.value;
            b.classList.toggle('on', on);
            b.setAttribute('aria-pressed', String(on));
          });
          onPick(it.value);
        },
      },
      it.label,
    ),
  );
  return h('div.chips', { role: 'group', 'aria-label': label }, ...buttons);
}

/** 사람 한 명의 정보를 쓰는 시트. 저장하면 저장한 정보를, 취소하면 null */
function editProfile(base: Profile | null, defaultKind: Profile['kind']): Promise<Profile | null> {
  return new Promise((resolve) => {
    let done = false;
    let kind = base?.kind ?? defaultKind;
    const finish = (p: Profile | null) => {
      if (done) return;
      done = true;
      resolve(p);
      sheet.close();
    };
    const sheet = new Sheet({ title: base ? `${base.label} 정보 고치기` : '사람 추가', onClose: () => finish(null) });
    const labelInput = h('input.text-field', { value: base?.label ?? (defaultKind === 'self' ? '나' : ''), placeholder: '예) 나, 첫째, 어머니', 'aria-label': '이름표' });
    const inputs = PROFILE_FIELDS.map((f) => {
      const input = h('input.text-field', {
        type: f.type ?? 'text',
        value: base?.values[f.key] ?? '',
        placeholder: f.placeholder ?? '',
        autocomplete: 'off',
        'aria-label': f.label,
      });
      return { key: f.key, el: h('label.profile-field', {}, h('span', {}, f.label), input), input };
    });
    const form = h(
      'form.dialog-form.profile-form',
      {},
      h('p.sheet-note', {}, '이 기기 안에만 저장돼요. 주민등록번호는 저장하지 않아요.'),
      h('label.profile-field', {}, h('span', {}, '이름표'), labelInput),
      chipGroup('누구인가요', KINDS, kind, (v) => (kind = v)),
      ...inputs.map((i) => i.el),
      h(
        'div.dialog-actions',
        {},
        base
          ? h(
              'button.secondary-btn.danger-text',
              {
                type: 'button',
                onclick: async () => {
                  if (!(await askConfirm({ title: '정보 지우기', message: `${base.label}의 정보를 이 기기에서 지울까요?`, confirmLabel: '지우기', danger: true }))) return;
                  await profiles.remove(base.id);
                  finish(null);
                },
              },
              '지우기',
            )
          : h('button.secondary-btn', { type: 'button', onclick: () => finish(null) }, '취소'),
        h('button.primary-btn', { type: 'submit' }, '저장'),
      ),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(inputs.map((i) => [i.key, i.input.value.trim()]));
      const label = labelInput.value.trim() || (kind === 'self' ? '나' : '이름 없음');
      finish(await profiles.save({ id: base?.id, label, kind, values }));
    });
    sheet.body.append(form);
    sheet.open();
  });
}

/** 저장한 사람 목록 (고치기·추가) */
export async function openProfilesSheet(): Promise<void> {
  const list = await profiles.list().catch(() => [] as Profile[]);
  const sheet = new Sheet({ title: '내 정보' });
  const rows = list.map((p) =>
    h(
      'button.sheet-row',
      {
        onclick: async () => {
          sheet.close();
          await editProfile(p, p.kind);
          void openProfilesSheet();
        },
      },
      icon('person'),
      h('span.row-text', {}, h('span', {}, p.label), h('span.row-sub', {}, [p.values.name, p.values.mobile].filter(Boolean).join(' · ') || '정보 없음')),
    ),
  );
  sheet.body.append(
    h('p.sheet-note', {}, '서류의 이름·연락처·주소 칸을 한 번에 채울 때 써요. 이 기기 안에만 저장돼요.'),
    ...rows,
    h(
      'button.sheet-row',
      {
        onclick: async () => {
          sheet.close();
          await editProfile(null, list.some((p) => p.kind === 'self') ? 'child' : 'self');
          void openProfilesSheet();
        },
      },
      icon('plus'),
      h('span', {}, list.length ? '사람 추가 (자녀·가족)' : '내 정보 쓰기'),
    ),
  );
  sheet.open();
}

/** 칸마다 기본으로 쓸 사람: 학생·자녀 칸은 자녀, 아니면 고른 사람 */
function personFor(slot: Slot, list: Profile[], main: Profile): Profile {
  return (slot.child && list.find((p) => p.kind === 'child')) || main;
}

/**
 * 문서에서 이름·연락처·주소·날짜·서명 칸을 찾아 내 정보로 한 번에 채운다.
 * 찾은 칸을 먼저 보여 주고, 고른 칸만 실행 취소 한 번으로 되돌릴 수 있게 채운다.
 */
export async function openAutofill(editor: Editor): Promise<void> {
  const doc = editor.document;
  if (!doc) return;
  let list = await profiles.list().catch(() => [] as Profile[]);
  if (list.length === 0) {
    const made = await editProfile(null, 'self');
    if (!made) return;
    list = [made];
  }
  const slots = findSlots(doc);
  if (slots.length === 0) {
    toast('채울 칸을 찾지 못했어요. 서식 채우기로 하나씩 채워 보세요.', 3500);
    return;
  }
  const savedSigns = await signatures.list().catch(() => []);
  const sign = savedSigns.find((s) => s.kind === 'sign') ?? savedSigns[0] ?? null;

  let main = list[0];
  const sheet = new Sheet({ title: '내 정보로 채우기' });
  const state = slots.map((slot) => ({ slot, person: personFor(slot, list, main), on: true, value: '' }));
  const listEl = h('div.autofill-list');
  const submit = h('button.primary-btn', { type: 'button' });

  const render = () => {
    for (const s of state) {
      s.value = slotValue(s.slot, s.person);
      if (s.slot.key === 'signature' ? !sign : !s.value) s.on = false;
    }
    listEl.replaceChildren(
      ...state.map((s) => {
        const missing = s.slot.key === 'signature' ? !sign : !s.value;
        const box = h('input', { type: 'checkbox', checked: s.on && !missing, disabled: missing, 'aria-label': `${s.slot.label} 채우기` });
        box.addEventListener('change', () => {
          s.on = box.checked;
          sync();
        });
        const value =
          s.slot.key === 'signature'
            ? sign
              ? '저장한 서명'
              : '저장한 서명이 없어요 (입력 → 서명·도장)'
            : s.value || `내 정보에 없어요 (${SLOT_NAMES[s.slot.key]})`;
        const pick =
          list.length > 1 && s.slot.key !== 'signature' && s.slot.key !== 'today'
            ? (() => {
                const sel = h('select.autofill-person', { 'aria-label': `${s.slot.label}에 쓸 사람` }, ...list.map((p) => h('option', { value: p.id, selected: p.id === s.person.id }, p.label)));
                sel.addEventListener('change', () => {
                  s.person = list.find((p) => p.id === sel.value) ?? s.person;
                  s.on = true;
                  render();
                });
                return sel;
              })()
            : null;
        return h(
          'label.autofill-row',
          { 'data-missing': String(missing) },
          box,
          h('span.autofill-text', {}, h('span.autofill-label', {}, s.slot.label), h('span.autofill-value', {}, value)),
          ...(pick ? [pick] : []),
        );
      }),
    );
    sync();
  };
  const sync = () => {
    const n = state.filter((s) => s.on).length;
    submit.textContent = n ? `${n}칸 채우기` : '고른 칸이 없어요';
    submit.toggleAttribute('disabled', n === 0);
  };
  submit.addEventListener('click', () => {
    const items = state.filter((s) => s.on).map((s) => ({ slot: s.slot, value: s.value }));
    const image = sign ? { png: sign.png, width: sign.width, height: sign.height } : null;
    const ok = editor.command((d) => applyFill(d, items, image, sign?.kind === 'stamp' ? STAMP_WIDTH : SIGN_WIDTH));
    sheet.close();
    toast(ok ? `${items.length}칸을 채웠어요. 마음에 안 들면 실행 취소를 누르세요.` : '채우지 못했어요. 서식 채우기로 하나씩 채워 보세요.', 3500);
  });

  sheet.body.append(
    list.length > 1
      ? chipGroup(
          '누구 정보로 채울까요',
          list.map((p) => ({ value: p.id, label: p.label })),
          main.id,
          (id) => {
            main = list.find((p) => p.id === id) ?? main;
            for (const s of state) {
              s.person = personFor(s.slot, list, main);
              s.on = true;
            }
            render();
          },
        )
      : h('p.sheet-note', {}, `'${main.label}' 정보로 채워요.`),
    listEl,
    h('p.sheet-note', {}, '찾은 칸이 맞는지 보고 채우세요. 채운 뒤에도 실행 취소로 되돌릴 수 있어요.'),
    h(
      'div.dialog-actions',
      {},
      h(
        'button.secondary-btn',
        {
          type: 'button',
          onclick: () => {
            sheet.close();
            void openProfilesSheet();
          },
        },
        '내 정보 고치기',
      ),
      submit,
    ),
  );
  render();
  sheet.open();
}
