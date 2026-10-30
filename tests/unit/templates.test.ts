import { describe, expect, it } from 'vitest';
import { TEMPLATES, buildTemplate } from '../../src/app/templates';
import { findSlots } from '../../src/doc/ops/autofill';
import { emptyCells } from '../../src/doc/ops/fields';
import { blankDocument } from './engine';

describe('자주 쓰는 양식', () => {
  for (const t of TEMPLATES) {
    it(`${t.name}: 만들어지고 빈칸을 서식 채우기·내 정보로 채우기가 찾는다`, async () => {
      const doc = await blankDocument();
      buildTemplate(doc, t);
      expect(doc.paraText({ sec: 0, para: 0, offset: 0 }).replace(/\s/g, '')).toBe(t.blocks[0].kind === 'title' ? t.blocks[0].text.replace(/\s/g, '') : '');
      expect(emptyCells(doc).length).toBeGreaterThan(0);
      const keys = findSlots(doc).map((s) => s.key);
      if (t.blocks.some((b) => b.kind === 'sign')) expect(keys).toContain('signature');
      if (t.blocks.some((b) => b.kind === 'fields' && b.labels.includes('성명'))) expect(keys).toContain('name');
    });
  }
});
