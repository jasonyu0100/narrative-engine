/** Media control icons — play, pause, stop. */

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

export function IconPlay({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <polygon points="5,3 19,12 5,21" fill="currentColor" />
    </svg>
  );
}

export function IconPause({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <rect x="6" y="4" width="4" height="16" rx="1" fill="currentColor" />
      <rect x="14" y="4" width="4" height="16" rx="1" fill="currentColor" />
    </svg>
  );
}

export function IconStop({ size, ...rest }: P) {
  return (
    <svg {...defaults(size)} {...rest}>
      <rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor" />
    </svg>
  );
}
