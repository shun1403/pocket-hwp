/** 24×24 선 아이콘 (직접 그린 단순 도형, MIT) */
const PATHS = {
  back: 'M15 18l-6-6 6-6',
  close: 'M6 6l12 12M18 6L6 18',
  check: 'M5 12l5 5L20 7',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  undo: 'M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  share: 'M12 3v12M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  filePlus: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M12 11v7M8.5 14.5h7',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  book: 'M2 5h6a4 4 0 0 1 4 4v11a3 3 0 0 0-3-3H2zM22 5h-6a4 4 0 0 0-4 4v11a3 3 0 0 1 3-3h7z',
  pages: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  keyboard: 'M3 5h18v10H3zM7 9h.01M11 9h.01M15 9h.01M8 12h8M9 19l3 3 3-3',
  alignLeft: 'M4 6h16M4 10h10M4 14h16M4 18h10',
  alignCenter: 'M4 6h16M7 10h10M4 14h16M7 18h10',
  alignRight: 'M4 6h16M10 10h10M4 14h16M10 18h10',
  alignJustify: 'M4 6h16M4 10h16M4 14h16M4 18h16',
  table: 'M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14',
  image: 'M3 5h18v14H3zM8.5 8.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM21 15l-5-5-10 9',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  plusSquare: 'M4 4h16v16H4zM12 8v8M8 12h8',
  zoomFit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  github: 'M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-1-2.5c3 0 6-1.5 6-6.5a5 5 0 0 0-1.4-3.5 4.5 4.5 0 0 0-.1-3.5s-1.1-.3-3.6 1.4a12 12 0 0 0-6.4 0C6 1.3 4.9 1.6 4.9 1.6a4.5 4.5 0 0 0-.1 3.5A5 5 0 0 0 3.4 8.6c0 5 3 6.5 6 6.5a3 3 0 0 0-1 2.5V21',
} as const;

export type IconName = keyof typeof PATHS;

export function icon(name: IconName, size = 24): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
