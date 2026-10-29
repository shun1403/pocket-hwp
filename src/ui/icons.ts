/** 24×24 선 아이콘 (직접 그린 단순 도형, MIT) */
const PATHS = {
  back: 'M15 18l-6-6 6-6',
  forward: 'M9 6l6 6-6 6',
  play: 'M7 4v16l13-8z',
  pin: 'M9 3h6l-1 6 4 4H6l4-4zM12 13v8',
  list: 'M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01',
  shapes: 'M4 4h8v8H4zM17 12a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  ellipse: 'M12 6c5 0 9 2.7 9 6s-4 6-9 6-9-2.7-9-6 4-6 9-6z',
  line: 'M4 20L20 4',
  calc: 'M5 3h14v18H5zM8 7h8M8 12h2M14 12h2M8 16h2M14 16h2',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  border: 'M4 4h16v16H4z',
  save: 'M5 3h11l3 3v15H5zM8 3v5h7V3M8 21v-7h8v7',
  pen: 'M3 21c3-1 5-3 7-6l8-8a2 2 0 0 0-3-3l-8 8c-3 2-5 4-6 7zM14 6l4 4',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  form: 'M5 3h14v18H5zM8 8h8M8 12h8M8 16h5',
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
  copy: 'M9 9h11v12H9zM5 15H4V3h12v1',
  cut: 'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.2 7.8 20 20M8.2 16.2 20 4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  text: 'M5 6V4h14v2M12 4v16M9 20h6',
  plusSquare: 'M4 4h16v16H4zM12 8v8M8 12h8',
  zoomFit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  alignDistribute: 'M4 6h16M4 10h16M4 14h16M4 18h16M2 4v16M22 4v16',
  rowAbove: 'M3 12h18v8H3zM12 3v6M9 6h6',
  rowBelow: 'M3 4h18v8H3zM12 15v6M9 18h6',
  colLeft: 'M12 3h8v18h-8zM3 12h6M6 9v6',
  colRight: 'M4 3h8v18H4zM15 12h6M18 9v6',
  mergeRight: 'M3 5h18v14H3zM8 12h8M13 9l3 3-3 3',
  mergeDown: 'M3 3h18v18H3zM12 7v9M9 13l3 3 3-3',
  split: 'M3 5h18v14H3zM12 5v14M9 9l-3 3 3 3M15 9l3 3-3 3',
  portrait: 'M7 3h10v18H7z',
  landscape: 'M3 7h18v10H3z',
  pilcrow: 'M13 4v16M17 4v16M19 4H9.5a4.5 4.5 0 0 0 0 9H13',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 10.5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  sigma: 'M18 5H6l6 7-6 7h12',
  textbox: 'M3 5h18v14H3zM7 9h10M12 9v6',
  footnote: 'M4 6h12M4 10h12M4 14h7M15 17h5M17 13.5v2.5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  memo: 'M4 4h16v12H9l-5 4zM8 8h8M8 12h5',
  pageBreak: 'M5 3v5h14V3M5 21v-5h14v5M3 12h3M9 12h2M13 12h2M18 12h3',
  columns: 'M4 4h7v16H4zM13 4h7v16h-7z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v5M16 3v5',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  format: 'M4 20l6-16h1l6 16M6.5 14h9',
  lock: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  upload: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  homeAdd: 'M3 11l9-7 9 7v9H3zM12 11v6M9 14h6',
  symbol: 'M12 4v16M4 8l16 8M20 8L4 16',
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
