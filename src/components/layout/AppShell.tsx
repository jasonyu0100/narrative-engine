'use client';

import { type ReactNode, useState, useCallback, useRef } from 'react';
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
    <div className="h-screen bg-bg-base flex flex-col overflow-hidden relative">
      {/* Ambient aurora background — subtle version for workspace */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden aurora-container aurora-workspace">
        <div className="aurora-curtain aurora-curtain-1" />
        <div className="aurora-curtain aurora-curtain-3" />
        <div className="aurora-curtain aurora-curtain-5" />
        <div className="aurora-wisp aurora-wisp-2" />
        <div className="aurora-wisp aurora-wisp-4" />
      </div>

      {/* TopBar */}
      <div className="h-11 shrink-0 relative z-20">
        <TopBar />
      </div>

      {/* Main row */}
      <div className="flex-1 flex min-h-0 relative z-10">
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

        {/* Main content */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {children}
        </div>

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

        {/* Left toggle — pointer-events-none container (resize handle still works),
            pill is pointer-events-auto with low resting opacity so it's always findable */}
        <div
          className="absolute top-0 bottom-0 z-30 w-4 flex items-center justify-center pointer-events-none"
          style={{ left: left.collapsed ? 0 : left.width - 8 }}
        >
          <button
            onClick={left.toggle}
            title={left.collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="pointer-events-auto flex items-center justify-center w-5 h-9 rounded-full bg-bg-panel border border-border text-text-dim shadow-md opacity-25 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <svg width="6" height="10" viewBox="0 0 6 10">
              {left.collapsed ? (
                <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
              ) : (
                <path d="M5 1l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
              )}
            </svg>
          </button>
        </div>

        {/* Right toggle — same pattern */}
        <div
          className="absolute top-0 bottom-0 z-30 w-4 flex items-center justify-center pointer-events-none"
          style={{ right: right.collapsed ? 0 : right.width - 8 }}
        >
          <button
            onClick={right.toggle}
            title={right.collapsed ? 'Expand inspector' : 'Collapse inspector'}
            className="pointer-events-auto flex items-center justify-center w-5 h-9 rounded-full bg-bg-panel border border-border text-text-dim shadow-md opacity-25 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <svg width="6" height="10" viewBox="0 0 6 10">
              {right.collapsed ? (
                <path d="M5 1l-4 4 4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
              ) : (
                <path d="M1 1l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
              )}
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
