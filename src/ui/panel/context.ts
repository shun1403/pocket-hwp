import type { DocumentSession } from '../../app/session';
import type { Editor, EditorState } from '../../editor/editor';

export interface PanelContext {
  editor: Editor;
  session: DocumentSession;
  /** 가장 최근 편집기 상태 (캐럿 위치의 글자·문단 모양) */
  state(): EditorState;
  openSearch(): void;
  openReader(): void;
  openPages(): void;
  openInfo(): void;
}

export interface TabView {
  el: HTMLElement;
  /** 캐럿이 움직이거나 서식이 바뀌면 불린다 */
  refresh(): void;
}

export interface TabDef {
  id: string;
  label: string;
  /** 표 탭처럼 상황에 따라 보이는 탭 */
  visible?(ctx: PanelContext): boolean;
  build(ctx: PanelContext): TabView;
}
