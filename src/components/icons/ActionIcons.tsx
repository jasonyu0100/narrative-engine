/** Action icons — edit, delete, close, send, refresh, fork, import/export, share, rename. */

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const defaults = (size = 12): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 },
});

export function IconEdit({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconTrash({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconClose({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconSend({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconRefresh({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M1 4v6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.51 15a9 9 0 102.13-9.36L1 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconFork({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="12" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="6" cy="6" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="18" cy="6" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M18 9v2c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V9M12 12v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconImport({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M16 16l-4-4-4 4M12 12v9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconDownload({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7 10l5 5 5-5M12 15V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconShare({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M6 3v12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="18" cy="6" r="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="6" cy="18" r="3" stroke="currentColor" strokeWidth="2" />
      <path d="M18 9a9 9 0 01-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function IconPlus({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function IconUndo({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M3 6h7a4 4 0 0 1 0 8H7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 3L3 6l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPencilDraw({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M12 20h9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
