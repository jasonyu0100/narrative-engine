'use client';

import React, { useMemo, useState, useCallback } from 'react';
import type { NarrativeState } from '@/types/narrative';
import { resolveEntry, isScene } from '@/types/narrative';
import { narrativeContext, sceneContext, outlineContext } from '@/lib/ai';
import { Modal, ModalHeader, ModalBody } from '@/components/Modal';

type ContextView = 'narrative' | 'scene' | 'outline';

type Props = {
  narrative: NarrativeState;
  resolvedKeys: string[];
  currentSceneIndex: number;
  onClose: () => void;
};

// ── XML tree parser ─────────────────────────────────────────────────────────

type XmlNode =
  | { type: 'element'; tag: string; attrs: Record<string, string>; children: XmlNode[] }
  | { type: 'text'; content: string };

function parseXml(raw: string): XmlNode[] {
  const nodes: XmlNode[] = [];
  let pos = 0;

  while (pos < raw.length) {
    const tagStart = raw.indexOf('<', pos);
    if (tagStart === -1) {
      const text = raw.slice(pos).trim();
      if (text) nodes.push({ type: 'text', content: text });
      break;
    }

    // Text before tag
    if (tagStart > pos) {
      const text = raw.slice(pos, tagStart).trim();
      if (text) nodes.push({ type: 'text', content: text });
    }

    // Skip closing tags at this level
    if (raw[tagStart + 1] === '/') {
      const closeEnd = raw.indexOf('>', tagStart);
      pos = closeEnd + 1;
      break;
    }

    // Self-closing or opening tag
    const tagEnd = raw.indexOf('>', tagStart);
    if (tagEnd === -1) { pos = raw.length; break; }

    const tagContent = raw.slice(tagStart + 1, tagEnd);
    const selfClosing = tagContent.endsWith('/');
    const cleanContent = selfClosing ? tagContent.slice(0, -1).trim() : tagContent.trim();

    // Parse tag name and attributes
    const spaceIdx = cleanContent.search(/\s/);
    const tag = spaceIdx === -1 ? cleanContent : cleanContent.slice(0, spaceIdx);
    const attrStr = spaceIdx === -1 ? '' : cleanContent.slice(spaceIdx);
    const attrs: Record<string, string> = {};
    const attrRegex = /(\w[\w-]*)="([^"]*)"/g;
    let m;
    while ((m = attrRegex.exec(attrStr)) !== null) {
      attrs[m[1]] = m[2];
    }

    if (selfClosing) {
      nodes.push({ type: 'element', tag, attrs, children: [] });
      pos = tagEnd + 1;
    } else {
      // Find matching close tag — parse children recursively
      pos = tagEnd + 1;
      const children: XmlNode[] = [];
      // Simple recursive descent: find </tag>
      const closeTag = `</${tag}>`;
      const closeIdx = findMatchingClose(raw, pos, tag);
      if (closeIdx !== -1) {
        const innerRaw = raw.slice(pos, closeIdx);
        children.push(...parseXml(innerRaw));
        pos = closeIdx + closeTag.length;
      } else {
        // No close tag found — treat rest as text
        const rest = raw.slice(pos).trim();
        if (rest) children.push({ type: 'text', content: rest });
        pos = raw.length;
      }
      nodes.push({ type: 'element', tag, attrs, children });
    }
  }

  return nodes;
}

function findMatchingClose(raw: string, start: number, tag: string): number {
  let depth = 1;
  let pos = start;
  const openPattern = `<${tag}`;
  const closePattern = `</${tag}>`;

  while (pos < raw.length && depth > 0) {
    const nextOpen = raw.indexOf(openPattern, pos);
    const nextClose = raw.indexOf(closePattern, pos);

    if (nextClose === -1) return -1;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Check it's actually an opening tag (not a prefix match)
      const afterTag = raw[nextOpen + openPattern.length];
      if (afterTag === '>' || afterTag === ' ' || afterTag === '/') {
        depth++;
      }
      pos = nextOpen + 1;
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + closePattern.length;
    }
  }
  return -1;
}

// ── Collapsible XML renderer ────────────────────────────────────────────────

function XmlElement({ node, depth }: { node: XmlNode & { type: 'element' }; depth: number }) {
  const hasChildren = node.children.length > 0;
  const isLeaf = node.children.every((c) => c.type === 'text');
  const [open, setOpen] = useState(depth < 2);

  const attrStr = Object.entries(node.attrs)
    .map(([k, v]) => (
      <span key={k}>
        {' '}<span className="text-blue-400/60">{k}</span>
        <span className="text-text-dim">=</span>
        <span className="text-amber-400/70">&quot;{v}&quot;</span>
      </span>
    ));

  if (!hasChildren) {
    return (
      <div className="flex items-center gap-1 py-0.5" style={{ paddingLeft: depth * 16 }}>
        <span className="text-text-dim">&lt;</span>
        <span className="text-emerald-400/80">{node.tag}</span>
        {attrStr}
        <span className="text-text-dim"> /&gt;</span>
      </div>
    );
  }

  if (isLeaf) {
    const text = node.children.map((c) => c.type === 'text' ? c.content : '').join(' ');
    const truncated = text.length > 120;
    return (
      <div className="py-0.5" style={{ paddingLeft: depth * 16 }}>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex items-start gap-1 text-left w-full hover:bg-white/2 rounded px-1 -ml-1"
        >
          <span className="text-text-dim shrink-0 w-3 text-center">{open ? '▾' : '▸'}</span>
          <span>
            <span className="text-text-dim">&lt;</span>
            <span className="text-emerald-400/80">{node.tag}</span>
            {attrStr}
            <span className="text-text-dim">&gt;</span>
            {!open && <span className="text-text-secondary ml-1">{truncated ? text.slice(0, 120) + '…' : text}</span>}
          </span>
        </button>
        {open && (
          <div className="text-text-secondary leading-relaxed" style={{ paddingLeft: 16 + 4 }}>
            {text}
          </div>
        )}
      </div>
    );
  }

  // Element with child elements
  const childCount = node.children.filter((c) => c.type === 'element').length;
  const textChildren = node.children.filter((c) => c.type === 'text' && c.content.trim());

  return (
    <div className="py-0.5" style={{ paddingLeft: depth * 16 }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-left w-full hover:bg-white/2 rounded px-1 -ml-1"
      >
        <span className="text-text-dim shrink-0 w-3 text-center">{open ? '▾' : '▸'}</span>
        <span>
          <span className="text-text-dim">&lt;</span>
          <span className="text-emerald-400/80">{node.tag}</span>
          {attrStr}
          <span className="text-text-dim">&gt;</span>
          {!open && (
            <span className="text-text-dim ml-1">
              {childCount > 0 ? `(${childCount})` : ''}
            </span>
          )}
        </span>
      </button>
      {open && (
        <div>
          {textChildren.map((c, i) => (
            <div key={`text-${i}`} className="text-text-secondary leading-relaxed" style={{ paddingLeft: (depth + 1) * 16 }}>
              {c.type === 'text' ? c.content : ''}
            </div>
          ))}
          {node.children
            .filter((c): c is XmlNode & { type: 'element' } => c.type === 'element')
            .map((child, i) => (
              <XmlElement key={`${child.tag}-${i}`} node={child} depth={depth + 1} />
            ))}
        </div>
      )}
    </div>
  );
}

function XmlTreeView({ xml }: { xml: string }) {
  const nodes = useMemo(() => parseXml(xml), [xml]);

  return (
    <div className="text-[11px] font-mono leading-relaxed">
      {nodes.map((node, i) =>
        node.type === 'element' ? (
          <XmlElement key={`${node.tag}-${i}`} node={node} depth={0} />
        ) : (
          <div key={`text-${i}`} className="text-text-secondary py-0.5 whitespace-pre-wrap">
            {node.content}
          </div>
        ),
      )}
    </div>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────────

export function BranchContextModal({ narrative, resolvedKeys, currentSceneIndex, onClose }: Props) {
  const [copied, setCopied] = useState(false);
  const [view, setView] = useState<ContextView>('narrative');
  const [rawMode, setRawMode] = useState(false);

  const narrativeCtx = useMemo(
    () => narrativeContext(narrative, resolvedKeys, currentSceneIndex),
    [narrative, resolvedKeys, currentSceneIndex],
  );

  const currentKey = resolvedKeys[currentSceneIndex];
  const currentEntry = currentKey ? resolveEntry(narrative, currentKey) : null;
  const currentScene = currentEntry && isScene(currentEntry) ? currentEntry : null;

  const sceneCtx = useMemo(
    () => currentScene ? sceneContext(narrative, currentScene, resolvedKeys, currentSceneIndex) : null,
    [narrative, currentScene, resolvedKeys, currentSceneIndex],
  );

  const outlineCtx = useMemo(
    () => outlineContext(narrative, resolvedKeys, currentSceneIndex),
    [narrative, resolvedKeys, currentSceneIndex],
  );

  const context = view === 'scene' && sceneCtx ? sceneCtx : view === 'outline' ? outlineCtx : narrativeCtx;

  const wordCount = useMemo(() => context.split(/\s+/).length, [context]);
  const estimatedTokens = Math.round(context.length / 4);
  const tokenLabel = estimatedTokens >= 1000
    ? `~${(estimatedTokens / 1000).toFixed(1)}k`
    : `~${estimatedTokens}`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(context);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [context]);

  return (
    <Modal onClose={onClose} size="4xl">
      <ModalHeader onClose={onClose}>
        {/* View toggle */}
        <div className="flex items-center rounded bg-bg-elevated text-[11px] leading-none">
          <button
            className={`px-2.5 py-1.5 rounded-l transition-colors ${
              view === 'scene' ? 'text-accent-cta' : 'text-text-dim hover:text-text-default'
            } ${!sceneCtx ? 'opacity-30 pointer-events-none' : ''}`}
            onClick={() => setView('scene')}
            disabled={!sceneCtx}
          >
            Scene
          </button>
          <div className="w-px h-3.5 bg-border" />
          <button
            className={`px-2.5 py-1.5 transition-colors ${
              view === 'outline' ? 'text-accent-cta' : 'text-text-dim hover:text-text-default'
            }`}
            onClick={() => setView('outline')}
          >
            Outline
          </button>
          <div className="w-px h-3.5 bg-border" />
          <button
            className={`px-2.5 py-1.5 rounded-r transition-colors ${
              view === 'narrative' ? 'text-accent-cta' : 'text-text-dim hover:text-text-default'
            }`}
            onClick={() => setView('narrative')}
          >
            Narrative
          </button>
        </div>
        <span className="text-[11px] text-text-dim px-2 py-0.5 rounded bg-bg-elevated">
          {wordCount.toLocaleString()} words
        </span>
        <span className="text-[11px] text-text-dim px-2 py-0.5 rounded bg-bg-elevated">
          {tokenLabel} tokens
        </span>
        <button
          onClick={() => setRawMode(!rawMode)}
          className={`px-3 py-1 rounded text-[11px] font-medium transition-colors ${
            rawMode ? 'bg-accent/20 text-accent-cta' : 'bg-bg-elevated hover:bg-accent/20 text-text-dim hover:text-text-primary'
          }`}
        >
          {rawMode ? 'Tree' : 'Raw'}
        </button>
        <button
          onClick={handleCopy}
          className="px-3 py-1 rounded text-[11px] font-medium transition-colors bg-bg-elevated hover:bg-accent/20 text-text-dim hover:text-text-primary"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </ModalHeader>
      <ModalBody>
        {rawMode ? (
          <pre className="text-[11px] leading-relaxed text-text-dim whitespace-pre-wrap font-mono">
            {context}
          </pre>
        ) : (
          <XmlTreeView xml={context} />
        )}
      </ModalBody>
    </Modal>
  );
}
