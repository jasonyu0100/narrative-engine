'use client';

import { useState } from 'react';
import { INSPECTOR_PAGE_SIZE } from '@/lib/constants';

/** Slice the tail of an array into a page (oldest-last) and reverse so the
 *  most recent items render first. `page` is zero-based, counted from the end. */
export function paginateRecent<T>(
  items: T[],
  page: number,
): { pageItems: T[]; totalPages: number; safePage: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / INSPECTOR_PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const startFromEnd = safePage * INSPECTOR_PAGE_SIZE;
  const pageItems = items
    .slice(
      Math.max(0, items.length - startFromEnd - INSPECTOR_PAGE_SIZE),
      items.length - startFromEnd,
    )
    .reverse();
  return { pageItems, totalPages, safePage };
}

export function Paginator({
  page,
  totalPages,
  onPage,
}: {
  page: number;
  totalPages: number;
  onPage: (p: number) => void;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-2">
      <button
        type="button"
        disabled={page >= totalPages - 1}
        onClick={() => onPage(page + 1)}
        className="text-[9px] text-text-dim hover:text-text-secondary disabled:opacity-20 transition-colors"
      >
        &lsaquo; Older
      </button>
      <span className="text-[9px] text-text-dim font-mono">
        {page + 1} / {totalPages}
      </span>
      <button
        type="button"
        disabled={page <= 0}
        onClick={() => onPage(page - 1)}
        className="text-[9px] text-text-dim hover:text-text-secondary disabled:opacity-20 transition-colors"
      >
        Newer &rsaquo;
      </button>
    </div>
  );
}

export function CollapsibleSection({ title, count, defaultOpen = false, children }: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 group"
      >
        <svg
          className={`w-2.5 h-2.5 text-text-dim transition-transform ${open ? 'rotate-90' : ''}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M8 5l10 7-10 7z" />
        </svg>
        <h3 className="text-[10px] uppercase tracking-widest text-text-dim group-hover:text-text-secondary transition-colors">
          {title}
        </h3>
        <span className="text-[9px] text-text-dim/50 font-mono">{count}</span>
      </button>
      {open && children}
    </div>
  );
}
