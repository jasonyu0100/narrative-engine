'use client';

import { type ReactNode, useState, useCallback, useRef, useEffect } from 'react';
import TopBar from '@/components/topbar/TopBar';

type AppShellProps = {
  children: ReactNode;
  sidebar: ReactNode;
  sidepanel: ReactNode;
};

function useResize(
  initialWidth: number,
  minWidth: number,
  maxWidth: number,
  side: 'left' | 'right',
) {
  const [width, setWidth] = useState(initialWidth);
  const [collapsed, setCollapsed] = useState(false);
  const dragging = useRef(false);
  const startX = useRef(0);
  const startW = useRef(0);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startX.current = e.clientX;
      startW.current = width;

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return;
        const delta = side === 'left'
          ? ev.clientX - startX.current
          : startX.current - ev.clientX;
        const next = Math.max(minWidth, Math.min(maxWidth, startW.current + delta));
        setWidth(next);
      };

      const onMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [width, minWidth, maxWidth, side],
  );

  const toggle = useCallback(() => setCollapsed((c) => !c), []);

  return { width: collapsed ? 0 : width, collapsed, onMouseDown, toggle };
}

export default function AppShell({ children, sidebar, sidepanel }: AppShellProps) {
  const left = useResize(240, 160, 400, 'left');
  const right = useResize(280, 180, 480, 'right');

  return (
    <div className="h-screen bg-bg-base flex flex-col overflow-hidden">
      {/* TopBar */}
      <div className="h-11 shrink-0">
        <TopBar />
      </div>

      {/* Main row */}
      <div className="flex-1 flex min-h-0">
        {/* Left sidebar */}
        {!left.collapsed && (
          <div
            className="relative shrink-0 overflow-hidden"
            style={{ width: left.width }}
          >
            {sidebar}
            {/* Resize handle */}
            <div
              className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-white/10 active:bg-white/15 z-10"
              onMouseDown={left.onMouseDown}
            />
          </div>
        )}

        {/* Left collapse toggle */}
        <button
          onClick={left.toggle}
          className="shrink-0 w-4 flex items-center justify-center text-text-dim hover:text-text-secondary hover:bg-white/5 transition-colors"
          title={left.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
            {left.collapsed ? (
              <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            ) : (
              <path d="M5 1l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            )}
          </svg>
        </button>

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-auto">
          {children}
        </div>

        {/* Right collapse toggle */}
        <button
          onClick={right.toggle}
          className="shrink-0 w-4 flex items-center justify-center text-text-dim hover:text-text-secondary hover:bg-white/5 transition-colors"
          title={right.collapsed ? 'Expand inspector' : 'Collapse inspector'}
        >
          <svg width="6" height="10" viewBox="0 0 6 10" fill="currentColor">
            {right.collapsed ? (
              <path d="M5 1l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            ) : (
              <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
            )}
          </svg>
        </button>

        {/* Right side panel */}
        {!right.collapsed && (
          <div
            className="relative shrink-0 overflow-hidden"
            style={{ width: right.width }}
          >
            {/* Resize handle */}
            <div
              className="absolute top-0 left-0 w-1 h-full cursor-col-resize hover:bg-white/10 active:bg-white/15 z-10"
              onMouseDown={right.onMouseDown}
            />
            {sidepanel}
          </div>
        )}
      </div>
    </div>
  );
}
