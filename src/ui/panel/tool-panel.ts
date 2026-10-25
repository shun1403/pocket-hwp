import { backScope } from '../../app/back';
import { h, keepFocus } from '../dom';
import type { PanelContext, TabDef, TabView } from './context';
import { charTab } from './tabs/char';
import { insertTab } from './tabs/insert';
import { pageTab } from './tabs/page';
import { paraTab } from './tabs/para';
import { styleTab } from './tabs/style';
import { tableTab } from './tabs/table';
import { viewTab } from './tabs/view';

export const TABS: TabDef[] = [charTab, paraTab, styleTab, insertTab, tableTab, pageTab, viewTab];

/**
 * 키보드 자리에 올라오는 도구 패널 (한글 메뉴의 글자·문단·스타일·입력·표·쪽·보기).
 * 서식을 여러 번 바꿀 동안 열려 있고, 키보드 버튼이나 문서를 탭하면 닫힌다.
 */
export class ToolPanel {
  readonly el: HTMLElement;
  private readonly tabBar: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabButtons = new Map<string, HTMLButtonElement>();
  private view: TabView | null = null;
  private currentId: string | null = null;
  private back: { dismiss: () => void } | null = null;
  /** 열고 닫을 때 */
  onToggle: ((open: boolean) => void) | null = null;
  /** 탭이 바뀔 때 (열 때 포함) */
  onTabChange: (() => void) | null = null;

  constructor(private readonly ctx: PanelContext) {
    this.tabBar = h('div.panel-tabs', { role: 'tablist' });
    for (const tab of TABS) {
      const btn = h('button.panel-tab', { type: 'button', role: 'tab', 'aria-selected': 'false', onclick: () => this.open(tab.id) }, tab.label);
      keepFocus(btn);
      this.tabButtons.set(tab.id, btn);
      this.tabBar.append(btn);
    }
    this.body = h('div.panel-body', { role: 'tabpanel' });
    this.el = h('div.tool-panel', { 'aria-label': '편집 도구' }, h('div.panel-head', {}, this.tabBar), this.body);
  }

  get isOpen(): boolean {
    return this.currentId !== null;
  }

  get activeTab(): string | null {
    return this.currentId;
  }

  open(id: string): void {
    const tab = TABS.find((t) => t.id === id);
    if (!tab) return;
    const wasOpen = this.isOpen;
    this.currentId = id;
    this.view = tab.build(this.ctx);
    this.body.replaceChildren(this.view.el);
    this.body.scrollTop = 0;
    this.view.refresh();
    this.syncTabs();
    this.tabButtons.get(id)?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
    this.onTabChange?.();
    if (!wasOpen) {
      this.el.classList.add('open');
      this.back = backScope(() => {
        this.back = null;
        this.close();
      });
      this.onToggle?.(true);
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.currentId = null;
    this.view = null;
    this.body.replaceChildren();
    this.el.classList.remove('open');
    this.back?.dismiss();
    this.back = null;
    this.onToggle?.(false);
  }

  /** 편집기 상태가 바뀌었을 때 */
  refresh(): void {
    if (!this.isOpen) return;
    this.syncTabs();
    const current = TABS.find((t) => t.id === this.currentId);
    // 표 밖으로 나가면 표 탭은 글자 탭으로 바꾼다.
    if (current?.visible && !current.visible(this.ctx)) {
      this.open('char');
      return;
    }
    this.view?.refresh();
  }

  private syncTabs(): void {
    for (const tab of TABS) {
      const btn = this.tabButtons.get(tab.id)!;
      btn.hidden = !!tab.visible && !tab.visible(this.ctx);
      const on = tab.id === this.currentId;
      btn.classList.toggle('on', on);
      btn.setAttribute('aria-selected', String(on));
    }
  }
}
