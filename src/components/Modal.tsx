'use client';

import { useEffect, type ReactNode } from 'react';

type ModalSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | '6xl' | 'full';

const SIZE_CLASSES: Record<ModalSize, string> = {
  xs: 'max-w-xs w-full',
  sm: 'max-w-sm w-full',
  md: 'max-w-md w-full',
  lg: 'max-w-lg w-full',
  xl: 'max-w-xl w-full',
  '2xl': 'max-w-2xl w-full',
  '4xl': 'max-w-4xl w-full',
  '6xl': 'max-w-6xl w-full',
  full: 'w-full h-full',
};

type Props = {
  onClose: () => void;
  children: ReactNode;
  /** Modal width — defaults to 'md' */
  size?: ModalSize;
  /** Fills the entire viewport (no backdrop, no centering) */
  fullScreen?: boolean;
  /** Custom max-height, e.g. '85vh'. Defaults to 'calc(100vh - 4rem)'. Ignored when fullScreen. */
  maxHeight?: string;
  /** Additional className on the panel */
  panelClassName?: string;
};

export function Modal({ onClose, children, size = 'md', fullScreen, maxHeight, panelClassName }: Props) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  if (fullScreen) {
    return (
      <div className="fixed inset-0 bg-bg-base z-50 flex flex-col">
        {children}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={`bg-bg-base border border-white/10 rounded-2xl flex flex-col overflow-hidden ${SIZE_CLASSES[size]} ${panelClassName ?? ''}`}
        style={{ maxHeight: maxHeight ?? 'calc(100vh - 4rem)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalHeader({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-3 border-b border-white/6 shrink-0">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {children}
      </div>
      <button
        onClick={onClose}
        className="p-1.5 rounded hover:bg-white/5 transition-colors text-text-dim hover:text-text-primary shrink-0 ml-3"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export function ModalBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={`flex-1 overflow-y-auto min-h-0 ${className ?? 'p-5'}`}>
      {children}
    </div>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/6 shrink-0">
      {children}
    </div>
  );
}
