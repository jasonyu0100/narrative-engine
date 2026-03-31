/** Evaluation verdict & status icons — used in BranchEval, PlanEval, ProseEval. */

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const defaults = (size = 12): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 16 16',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  style: { display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 },
});

/** Checkmark — ok verdict, done status */
export function IconCheck({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M3 8.5L6.5 12L13 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Wrench — plan edit verdict (structural fix) */
export function IconTilde({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M9.5 2.5l4 4-6 6-4-4 6-6z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 12.5l-1 3.5 3.5-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Pencil — prose edit verdict (rewrite) */
export function IconPencil({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M11.5 2.5l2 2M4 10l-1 3 3-1 7.5-7.5-2-2L4 10z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Git merge — merge verdict (combine scenes) */
export function IconMerge({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="4" cy="4" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M4 6v4M12 10V6c0-1-1-2-2-2H6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Scissors — cut verdict (remove scene) */
export function IconCross({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="5" cy="4" r="2" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5" cy="12" r="2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6.5 5.5L13 12M6.5 10.5L13 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Plus in circle — insert verdict (add new scene) */
export function IconPlus({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Arrow right — move verdict */
export function IconArrowRight({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Slash circle — cut-done status */
export function IconSlashCircle({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 4L4 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Target — running/in-progress */
export function IconRunning({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="8" r="2.5" fill="currentColor" />
    </svg>
  );
}

/** Dot — pending */
export function IconDot({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <circle cx="8" cy="8" r="2" fill="currentColor" />
    </svg>
  );
}

/** Undo arrow — reset override */
export function IconReset({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M4.5 2v3.5H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 5.5A5 5 0 1 1 3 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** Four-pointed star — guided evaluation */
export function IconSparkle({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M8 1l1.8 4.2L14 8l-4.2 1.8L8 15l-1.8-5.2L2 8l4.2-1.8z" fill="currentColor" />
    </svg>
  );
}

/** Dash — skipped status */
export function IconDash({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <path d="M4 8h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
