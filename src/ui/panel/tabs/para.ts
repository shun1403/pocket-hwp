import type { ParaProps } from '../../../doc/editable';
import { BULLETS, NUMBERING_PRESETS, bulletId, numberingId } from '../../../doc/ops/lists';
import { h } from '../../dom';
import { Bindings, buttonRow, chips, section, stepper } from '../controls';
import type { TabDef } from '../context';

const LINE_SPACINGS = [100, 130, 160, 180, 200, 250];
/** 들여쓰기 한 걸음: 약 2글자(10pt 기준) */
const INDENT_STEP = 26.7;
const GAP_STEP = 4;

export const paraTab: TabDef = {
  id: 'para',
  label: '문단',
  build(ctx) {
    const b = new Bindings();
    const ed = ctx.editor;
    const para = () => ctx.state().para;
    const apply = (p: ParaProps) => ed.applyPara(p);
    const align = (alignment: NonNullable<ParaProps['alignment']>, label: string, icon: 'alignLeft' | 'alignCenter' | 'alignRight' | 'alignJustify' | 'alignDistribute') => ({
      label,
      icon,
      onClick: () => apply({ alignment }),
      active: () => (para().alignment ?? 'justify') === alignment,
    });
    const round = (v: number) => Math.round(v * 10) / 10;
    const listKind = () => para().headType ?? 'None';

    const el = h(
      'div.tab-body',
      {},
      section(
        '정렬',
        buttonRow(b, [
          align('left', '왼쪽 정렬', 'alignLeft'),
          align('center', '가운데 정렬', 'alignCenter'),
          align('right', '오른쪽 정렬', 'alignRight'),
          align('justify', '양쪽 정렬', 'alignJustify'),
          align('distribute', '배분 정렬', 'alignDistribute'),
        ]),
      ),
      section(
        '줄 간격',
        chips(
          b,
          LINE_SPACINGS.map((v) => ({
            label: `${v}%`,
            onClick: () => apply({ lineSpacing: v, lineSpacingType: 'Percent' }),
            active: () => para().lineSpacingType === 'Percent' && para().lineSpacing === v,
          })),
        ),
      ),
      section(
        '글머리표',
        chips(b, [
          ...BULLETS.map((ch) => ({
            label: `글머리표 ${ch}`,
            content: ch,
            onClick: () => {
              const id = bulletId(ed.document!, ch);
              apply({ headType: 'Bullet', numberingId: id, paraLevel: para().paraLevel ?? 0 });
            },
          })),
        ]),
      ),
      section(
        '문단 번호',
        chips(
          b,
          NUMBERING_PRESETS.map((preset) => ({
            label: preset.label,
            onClick: () => {
              const id = numberingId(ed.document!, preset);
              apply({ headType: 'Number', numberingId: id, paraLevel: para().paraLevel ?? 0 });
            },
          })),
        ),
        buttonRow(b, [
          {
            label: '한 수준 위로',
            content: '◀ 수준 올리기',
            disabled: () => listKind() === 'None' || (para().paraLevel ?? 0) === 0,
            onClick: () => apply({ paraLevel: Math.max(0, (para().paraLevel ?? 0) - 1) }),
          },
          {
            label: '한 수준 아래로',
            content: '수준 내리기 ▶',
            disabled: () => listKind() === 'None' || (para().paraLevel ?? 0) >= 6,
            onClick: () => apply({ paraLevel: Math.min(6, (para().paraLevel ?? 0) + 1) }),
          },
          {
            label: '번호·글머리표 없애기',
            content: '없애기',
            disabled: () => listKind() === 'None',
            onClick: () => apply({ headType: 'None' }),
          },
        ]),
      ),
      section(
        '여백·들여쓰기',
        stepper(b, '왼쪽 여백', () => `${Math.round((para().marginLeft ?? 0) / INDENT_STEP)}칸`, () => apply({ marginLeft: Math.max(0, round((para().marginLeft ?? 0) - INDENT_STEP)) }), () => apply({ marginLeft: round((para().marginLeft ?? 0) + INDENT_STEP) })),
        stepper(b, '첫 줄', () => {
          const v = Math.round((para().indent ?? 0) / INDENT_STEP);
          return v === 0 ? '보통' : v > 0 ? `들여 ${v}칸` : `내어 ${-v}칸`;
        }, () => apply({ indent: round((para().indent ?? 0) - INDENT_STEP) }), () => apply({ indent: round((para().indent ?? 0) + INDENT_STEP) })),
      ),
      section(
        '문단 간격',
        stepper(b, '위', () => `${Math.round((para().spacingBefore ?? 0) * 0.75)}pt`, () => apply({ spacingBefore: Math.max(0, round((para().spacingBefore ?? 0) - GAP_STEP)) }), () => apply({ spacingBefore: round((para().spacingBefore ?? 0) + GAP_STEP) })),
        stepper(b, '아래', () => `${Math.round((para().spacingAfter ?? 0) * 0.75)}pt`, () => apply({ spacingAfter: Math.max(0, round((para().spacingAfter ?? 0) - GAP_STEP)) }), () => apply({ spacingAfter: round((para().spacingAfter ?? 0) + GAP_STEP) })),
      ),
    );
    return { el, refresh: () => b.refresh() };
  },
};
