'use client';

import { useState, useReducer, useRef, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useStore } from '@/lib/store';
import {
  generatePremiseQuestion,
  buildPremiseText,
  type PremiseEntity,
  type PremiseEdge,
  type PremiseDecision,
  type PremiseQuestion,
  type PremiseSystemSketch,
} from '@/lib/ai/premise';
import { CreationWizard } from '@/components/wizard/CreationWizard';
import { IconCheck, IconChevronRight, IconRefresh, IconUndo } from '@/components/icons';
import { saveDiscoveryInquiry, deleteDiscoveryInquiry, loadDiscoveryInquiries } from '@/lib/persistence';
import type { DiscoveryInquiry, DiscoveryInquiryState, DiscoveryPhase, DiscoverySnapshot } from '@/types/narrative';
import { setLoggerDiscoveryId } from '@/lib/api-logger';
import { setSystemLoggerDiscoveryId } from '@/lib/system-logger';
import * as d3 from 'd3';

// ── State ────────────────────────────────────────────────────────────────────

type Phase = 'seed' | DiscoveryPhase;

type PremiseState = {
  seed: string;
  decisions: PremiseDecision[];
  entities: PremiseEntity[];
  edges: PremiseEdge[];
  rules: string[];
  systems: PremiseSystemSketch[];
  title: string;
  worldSummary: string;
  currentQuestion: PremiseQuestion | null;
  phase: Phase;
  loading: boolean;
  error: string | null;
  /** Prefetched questions keyed by phase, invalidated each round */
  prefetched: Partial<Record<DiscoveryPhase, PremiseQuestion>>;
  /** Snapshots before each round, enabling undo */
  history: DiscoverySnapshot[];
};

type PremiseAction =
  | { type: 'SET_SEED'; seed: string }
  | { type: 'SET_PHASE'; phase: Phase }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_QUESTION'; question: PremiseQuestion }
  | { type: 'APPLY_ROUND'; decision: PremiseDecision; entities: PremiseEntity[]; edges: PremiseEdge[]; rules: string[]; newSystems: PremiseSystemSketch[]; systemUpdates: { name: string; addPrinciples?: string[]; addConstraints?: string[]; addInteractions?: string[] }[]; title: string; worldSummary: string; question: PremiseQuestion }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'RESTORE'; saved: DiscoveryInquiryState }
  | { type: 'SET_PREFETCHED'; phase: DiscoveryPhase; question: PremiseQuestion }
  | { type: 'UNDO_ROUND' };

const initialState: PremiseState = {
  seed: '',
  decisions: [],
  entities: [],
  edges: [],
  rules: [],
  systems: [],
  title: '',
  worldSummary: '',
  currentQuestion: null,
  phase: 'seed',
  loading: false,
  error: null,
  prefetched: {},
  history: [],
};

function applySysUpdates(existing: PremiseSystemSketch[], newSystems: PremiseSystemSketch[], updates: { name: string; addPrinciples?: string[]; addConstraints?: string[]; addInteractions?: string[] }[]): PremiseSystemSketch[] {
  const result = [...existing, ...newSystems];
  for (const u of updates) {
    const sys = result.find(s => s.name.toLowerCase() === u.name.toLowerCase());
    if (sys) {
      if (u.addPrinciples?.length) sys.principles = [...(sys.principles ?? []), ...u.addPrinciples];
      if (u.addConstraints?.length) sys.constraints = [...(sys.constraints ?? []), ...u.addConstraints];
      if (u.addInteractions?.length) sys.interactions = [...(sys.interactions ?? []), ...u.addInteractions];
    }
  }
  return result;
}

function reducer(state: PremiseState, action: PremiseAction): PremiseState {
  switch (action.type) {
    case 'SET_SEED': return { ...state, seed: action.seed };
    case 'SET_PHASE': return { ...state, phase: action.phase };
    case 'SET_LOADING': return { ...state, loading: action.loading };
    case 'SET_ERROR': return { ...state, error: action.error };
    case 'SET_QUESTION': return { ...state, currentQuestion: action.question };
    case 'SET_TITLE': return { ...state, title: action.title };
    case 'APPLY_ROUND': {
      const snapshot: DiscoverySnapshot = {
        decisions: state.decisions,
        entities: state.entities,
        edges: state.edges,
        rules: state.rules,
        systems: state.systems,
        title: state.title,
        worldSummary: state.worldSummary,
        currentQuestion: state.currentQuestion,
        phase: state.phase,
      };
      return {
        ...state,
        decisions: [...state.decisions, action.decision],
        entities: [...state.entities, ...action.entities],
        edges: [...state.edges, ...action.edges],
        rules: [...state.rules, ...action.rules],
        systems: applySysUpdates(state.systems, action.newSystems, action.systemUpdates),
        title: action.title || state.title,
        worldSummary: action.worldSummary || state.worldSummary,
        currentQuestion: action.question,
        loading: false,
        error: null,
        prefetched: {},  // invalidate — world state changed
        history: [...state.history, snapshot],
      };
    }
    case 'UNDO_ROUND': {
      if (state.history.length === 0) return state;
      const prev = state.history[state.history.length - 1];
      return {
        ...state,
        ...prev,
        loading: false,
        error: null,
        prefetched: {},
        history: state.history.slice(0, -1),
      };
    }
    case 'SET_PREFETCHED':
      return { ...state, prefetched: { ...state.prefetched, [action.phase]: action.question } };
    case 'RESTORE':
      return { ...state, ...action.saved, history: action.saved.history ?? [], loading: false, error: null, prefetched: {} };
    default: return state;
  }
}

// ── Colors ───────────────────────────────────────────────────────────────────

const TYPE_COLORS: Record<string, string> = {
  character: '#e2e8f0',
  location: '#f59e0b',
  thread: '#22d3ee',
};

const TYPE_LABELS: Record<string, string> = {
  character: 'Character',
  location: 'Location',
  thread: 'Thread',
};

// ── World Graph ──────────────────────────────────────────────────────────────

type GraphNode = d3.SimulationNodeDatum & { id: string; label: string; type: string };
type GraphLink = d3.SimulationLinkDatum<GraphNode> & { label: string };

function WorldGraph({ entities, edges }: { entities: PremiseEntity[]; edges: PremiseEdge[] }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const nodeMap = new Map<string, GraphNode>();
    entities.forEach(e => {
      nodeMap.set(e.id, { id: e.id, label: e.name, type: e.type });
    });

    const nodes = Array.from(nodeMap.values());
    const links: GraphLink[] = edges
      .filter(e => nodeMap.has(e.from) && nodeMap.has(e.to))
      .map(e => ({ source: e.from, target: e.to, label: e.label }));

    svg.selectAll('*').remove();

    if (nodes.length === 0) {
      svg.append('text')
        .attr('x', width / 2).attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#444')
        .attr('font-size', '11px')
        .text('Entities will appear as your world takes shape...');
      return;
    }

    const g = svg.append('g');

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on('zoom', (event) => g.attr('transform', event.transform))
    );

    const linkSel = g.selectAll<SVGLineElement, GraphLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', '#ffffff12')
      .attr('stroke-width', 1);

    const linkLabelSel = g.selectAll<SVGTextElement, GraphLink>('text.link-label')
      .data(links)
      .join('text')
      .attr('class', 'link-label')
      .attr('text-anchor', 'middle')
      .attr('fill', '#555')
      .attr('font-size', '8px')
      .text(d => d.label);

    const nodeSel = g.selectAll<SVGGElement, GraphNode>('g.node')
      .data(nodes, d => d.id)
      .join('g')
      .attr('class', 'node')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', (event, d) => {
          if (!event.active) simRef.current?.alphaTarget(0.3).restart();
          d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (event, d) => { d.fx = event.x; d.fy = event.y; })
        .on('end', (event, d) => {
          if (!event.active) simRef.current?.alphaTarget(0);
          d.fx = null; d.fy = null;
        })
      );

    nodeSel.each(function(d) {
      const el = d3.select(this);
      const color = TYPE_COLORS[d.type] ?? '#888';
      if (d.type === 'location') {
        el.append('rect')
          .attr('width', 16).attr('height', 16)
          .attr('x', -8).attr('y', -8)
          .attr('rx', 3)
          .attr('fill', color + '20')
          .attr('stroke', color)
          .attr('stroke-width', 1.5);
      } else if (d.type === 'thread') {
        el.append('polygon')
          .attr('points', '0,-10 8,0 0,10 -8,0')
          .attr('fill', color + '20')
          .attr('stroke', color)
          .attr('stroke-width', 1.5);
      } else {
        el.append('circle')
          .attr('r', 8)
          .attr('fill', color + '20')
          .attr('stroke', color)
          .attr('stroke-width', 1.5);
      }
      el.append('text')
        .attr('dy', 20)
        .attr('text-anchor', 'middle')
        .attr('fill', color)
        .attr('font-size', '10px')
        .attr('font-weight', '500')
        .text(d.label);
    });

    nodeSel.attr('opacity', 0).transition().duration(400).attr('opacity', 1);

    const pad = 40; // padding from edges for node labels

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links).id(d => d.id).distance(70))
      .force('charge', d3.forceManyBody().strength(-150))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide(35))
      .force('boundX', () => { for (const n of nodes) { n.x = Math.max(pad, Math.min(width - pad, n.x!)); } })
      .force('boundY', () => { for (const n of nodes) { n.y = Math.max(pad, Math.min(height - pad, n.y!)); } })
      .on('tick', () => {
        linkSel
          .attr('x1', d => (d.source as GraphNode).x!)
          .attr('y1', d => (d.source as GraphNode).y!)
          .attr('x2', d => (d.target as GraphNode).x!)
          .attr('y2', d => (d.target as GraphNode).y!);
        linkLabelSel
          .attr('x', d => ((d.source as GraphNode).x! + (d.target as GraphNode).x!) / 2)
          .attr('y', d => ((d.source as GraphNode).y! + (d.target as GraphNode).y!) / 2);
        nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
      });

    // Auto-fit: once simulation cools, zoom to fit all nodes within the viewport
    sim.on('end', () => {
      if (nodes.length < 2) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        if (n.x! < minX) minX = n.x!;
        if (n.y! < minY) minY = n.y!;
        if (n.x! > maxX) maxX = n.x!;
        if (n.y! > maxY) maxY = n.y!;
      }
      const bw = maxX - minX + pad * 2;
      const bh = maxY - minY + pad * 2;
      const scale = Math.min(1, Math.min(width / bw, height / bh) * 0.9);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      const tx = width / 2 - cx * scale;
      const ty = height / 2 - cy * scale;
      svg.transition().duration(400).call(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (d3.zoom<SVGSVGElement, unknown>() as any).transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale),
      );
    });

    simRef.current = sim;
    return () => { sim.stop(); };
  }, [entities, edges]);

  return <svg ref={svgRef} className="w-full h-full" style={{ minHeight: 300 }} />;
}

// ── Choice Card ──────────────────────────────────────────────────────────────

function ChoiceCard({ label, description, selected, onClick, disabled }: {
  label: string; description: string; selected: boolean; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`w-full text-left rounded-xl border px-4 py-3 transition-all flex items-start gap-3 ${
        selected
          ? 'border-white/25 bg-white/8'
          : 'border-white/6 bg-white/2 hover:bg-white/5 hover:border-white/12'
      } disabled:opacity-40 disabled:pointer-events-none`}
    >
      <div className={`mt-0.5 w-3.5 h-3.5 rounded shrink-0 border transition-colors flex items-center justify-center ${
        selected ? 'border-white/40 bg-white/15' : 'border-white/15 bg-white/3'
      }`}>
        {selected && (
          <IconCheck size={10} className="text-white/80" />
        )}
      </div>
      <div className="min-w-0">
        <p className={`text-sm font-medium ${selected ? 'text-white/90' : 'text-white/70'}`}>{label}</p>
        <p className="text-[11px] text-white/35 mt-0.5 leading-snug">{description}</p>
      </div>
    </button>
  );
}

// ── Decision Sidebar ─────────────────────────────────────────────────────────

function DecisionSidebar({ decisions, worldSummary }: { decisions: PremiseDecision[]; worldSummary: string }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [decisions.length]);

  return (
    <div className="w-[240px] shrink-0 border-r border-white/6 flex flex-col" style={{ maxHeight: 'calc(100vh - 60px)' }}>
      <div className="px-3 py-3 border-b border-white/6">
        <p className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-mono">History</p>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2" style={{ scrollbarWidth: 'none' }}>
        {decisions.length === 0 ? (
          <p className="text-[10px] text-white/15 italic mt-2">Decisions will appear here...</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {decisions.map((d, i) => (
              <div key={i} className="rounded-lg px-2.5 py-2 border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors">
                <p className="text-[9px] text-white/20 font-mono mb-0.5">Round {i + 1}</p>
                <p className="text-[10px] text-white/30 leading-snug line-clamp-2">{d.question}</p>
                <p className="text-[11px] text-white/60 mt-1 font-medium">{d.answer}</p>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
      {worldSummary && (
        <div className="border-t border-white/6 px-3 py-2">
          <p className="text-[10px] text-white/25 leading-snug">{worldSummary}</p>
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

function DiscoverInner({ inquiryId: initialInquiryId }: { inquiryId?: string } = {}) {
  const { state: storeState, dispatch: storeDispatch } = useStore();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [selectedChoices, setSelectedChoices] = useState<Set<string>>(new Set());
  const [customAnswer, setCustomAnswer] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const questionRef = useRef<HTMLDivElement>(null);
  const inquiryIdRef = useRef<string>(initialInquiryId ?? `inquiry-${Date.now()}`);
  const prefetchGenRef = useRef(0);  // generation counter to discard stale prefetches

  const ALL_PHASES: DiscoveryPhase[] = ['systems', 'rules', 'cast', 'threads'];

  /** Fire-and-forget prefetch for phases other than the current one */
  const prefetchOtherPhases = useCallback((
    currentPhase: DiscoveryPhase,
    seed: string, decisions: PremiseDecision[], entities: PremiseEntity[],
    edges: PremiseEdge[], rules: string[], title: string, systems: PremiseSystemSketch[],
  ) => {
    const gen = ++prefetchGenRef.current;
    for (const p of ALL_PHASES) {
      if (p === currentPhase) continue;
      generatePremiseQuestion(seed, decisions, entities, edges, rules, title, systems, p)
        .then(result => {
          if (prefetchGenRef.current === gen) {
            dispatch({ type: 'SET_PREFETCHED', phase: p, question: result.question });
          }
        })
        .catch(() => {});  // prefetch failures are silent — user can still switch manually
    }
  }, []);

  // Restore saved inquiry on mount
  useEffect(() => {
    if (!initialInquiryId) return;
    loadDiscoveryInquiries().then((all) => {
      const found = all.find((i) => i.id === initialInquiryId);
      if (found) {
        dispatch({ type: 'RESTORE', saved: found.state });
        const s = found.state;
        if (s.phase !== 'seed') {
          prefetchOtherPhases(s.phase as DiscoveryPhase, s.seed, s.decisions, s.entities, s.edges, s.rules, s.title, s.systems);
        }
      }
    });
  }, [initialInquiryId, prefetchOtherPhases]);

  // Clear discovery ID from loggers on unmount
  useEffect(() => {
    return () => {
      setLoggerDiscoveryId(null);
      setSystemLoggerDiscoveryId(null);
    };
  }, []);

  const handleBegin = useCallback(async () => {
    // Set discovery ID for API and system logging
    setLoggerDiscoveryId(inquiryIdRef.current);
    setSystemLoggerDiscoveryId(inquiryIdRef.current);

    dispatch({ type: 'SET_PHASE', phase: 'systems' });
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      const result = await generatePremiseQuestion(state.seed, [], [], [], [], '', [], 'systems');
      dispatch({ type: 'SET_QUESTION', question: result.question });
      if (result.title) dispatch({ type: 'SET_TITLE', title: result.title });
      // Prefetch other phases in background
      prefetchOtherPhases('systems', state.seed, [], [], [], [], '', []);
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: String(err) });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state.seed, prefetchOtherPhases]);

  const handleSubmitAnswer = useCallback(async () => {
    if (!state.currentQuestion) return;
    const choiceLabels = state.currentQuestion.choices
      .filter(c => selectedChoices.has(c.id))
      .map(c => c.label);
    const parts = [...choiceLabels];
    if (useCustom && customAnswer.trim()) parts.push(customAnswer.trim());
    const answer = parts.join('; ');
    if (!answer) return;

    const decision: PremiseDecision = { question: state.currentQuestion.text, answer };
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      const phase = state.phase === 'seed' ? 'systems' : state.phase;
      const result = await generatePremiseQuestion(
        state.seed, [...state.decisions, decision],
        state.entities, state.edges, state.rules, state.title, state.systems, phase,
      );
      const newDecisions = [...state.decisions, decision];
      const newEntities = [...state.entities, ...result.newEntities];
      const newEdges = [...state.edges, ...result.newEdges];
      const newRules = [...state.rules, ...result.newRules];
      const newSystems = applySysUpdates(state.systems, result.newSystems, result.systemUpdates);
      const newTitle = result.title || state.title;
      dispatch({
        type: 'APPLY_ROUND', decision,
        entities: result.newEntities, edges: result.newEdges,
        rules: result.newRules, newSystems: result.newSystems,
        systemUpdates: result.systemUpdates,
        title: result.title,
        worldSummary: result.worldSummary, question: result.question,
      });
      setSelectedChoices(new Set());
      setCustomAnswer('');
      setUseCustom(false);
      // Prefetch other phases with updated world state
      prefetchOtherPhases(phase, state.seed, newDecisions, newEntities, newEdges, newRules, newTitle, newSystems);
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: String(err) });
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state, selectedChoices, customAnswer, useCustom, prefetchOtherPhases]);

  // Auto-save inquiry after each round (when decisions change)
  const prevDecisionCount = useRef(state.decisions.length);
  useEffect(() => {
    if (state.decisions.length === 0 && state.phase === 'seed') return;
    if (state.decisions.length === prevDecisionCount.current && state.phase === 'seed') return;
    prevDecisionCount.current = state.decisions.length;
    const { loading, error, prefetched, ...saved } = state;
    const inquiry: DiscoveryInquiry = {
      id: inquiryIdRef.current,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      state: saved,
    };
    saveDiscoveryInquiry(inquiry);
  }, [state.decisions.length, state.phase, state]);

  useEffect(() => {
    if (state.currentQuestion && questionRef.current) {
      questionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [state.currentQuestion]);

  const handleCreate = useCallback(() => {
    const { premise, characters, locations, threads, rules, worldSystems } = buildPremiseText(
      state.entities, state.rules, state.worldSummary, state.systems,
    );
    // Delete saved inquiry since it's being converted to a story
    deleteDiscoveryInquiry(inquiryIdRef.current);
    storeDispatch({
      type: 'OPEN_WIZARD',
      prefillData: {
        title: state.title || '',
        premise,
        characters: characters.map(c => ({ name: c.name, role: c.role as 'anchor' | 'recurring' | 'transient', description: c.description })),
        locations: locations.map(l => ({ name: l.name, description: l.description })),
        threads: threads.map(t => ({ description: t.description, participantNames: t.participantNames })),
        rules,
        worldSystems,
      },
    });
  }, [state, storeDispatch]);

  const handleRefreshQuestion = useCallback(async () => {
    if (state.loading || state.phase === 'seed') return;
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });
    setSelectedChoices(new Set());
    setCustomAnswer('');
    setUseCustom(false);
    try {
      const result = await generatePremiseQuestion(
        state.seed, state.decisions, state.entities, state.edges, state.rules, state.title, state.systems, state.phase as DiscoveryPhase,
      );
      dispatch({ type: 'SET_QUESTION', question: result.question });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: String(err) });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state]);

  const handleSwitchPhase = useCallback(async (newPhase: DiscoveryPhase) => {
    if (newPhase === state.phase) return;

    // Use prefetched question if available — instant switch
    const cached = state.prefetched[newPhase];
    if (cached) {
      dispatch({ type: 'SET_PHASE', phase: newPhase });
      dispatch({ type: 'SET_QUESTION', question: cached });
      dispatch({ type: 'SET_LOADING', loading: false });
      dispatch({ type: 'SET_ERROR', error: null });
      return;
    }

    // Block if already loading and no cache
    if (state.loading) return;

    // Fallback to live generation
    dispatch({ type: 'SET_PHASE', phase: newPhase });
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      const result = await generatePremiseQuestion(
        state.seed, state.decisions, state.entities, state.edges, state.rules, state.title, state.systems, newPhase,
      );
      dispatch({ type: 'SET_QUESTION', question: result.question });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: String(err) });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state]);

  const chars = state.entities.filter(e => e.type === 'character');
  const locs = state.entities.filter(e => e.type === 'location');
  const threads = state.entities.filter(e => e.type === 'thread');
  const canCreate = state.decisions.length >= 1;

  // ── Seed Phase ───────────────────────────────────────────────────────
  if (state.phase === 'seed') {
    return (
      <div className="relative min-h-[calc(100vh-60px)] flex flex-col items-center justify-center px-4">
        {/* Aurora background */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="aurora-container absolute bottom-0 left-0 right-0 h-full">
            <div className="aurora-curtain aurora-curtain-1" />
            <div className="aurora-curtain aurora-curtain-2" />
            <div className="aurora-curtain aurora-curtain-3" />
            <div className="aurora-glow" />
          </div>
        </div>

        <div className="relative z-10 max-w-lg w-full">
          <h1 className="text-3xl font-bold text-white/90 mb-2 tracking-tight">Discover your world.</h1>
          <p className="text-[13px] text-white/35 mb-8 leading-relaxed">
            Answer questions to shape what your story is about. Each choice refines
            characters, locations, threads, and rules until the concept is ready to write.
          </p>

          <div className="prompt-glow relative rounded-xl border border-white/8 focus-within:border-white/15 transition-colors duration-200">
            <textarea
              value={state.seed}
              onChange={(e) => dispatch({ type: 'SET_SEED', seed: e.target.value })}
              rows={3}
              placeholder="Optional: a seed idea, genre, or theme..."
              className="w-full bg-transparent text-white text-sm px-4 pt-4 pb-2 resize-none focus:outline-none placeholder:text-white/25"
            />
            <div className="flex items-center justify-end px-3 pb-3">
              <button
                onClick={handleBegin}
                className="text-white/70 hover:text-white border border-white/10 hover:border-white/20 text-xs font-medium px-5 py-1.5 rounded-md transition"
              >
                Begin
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Questioning Phase ────────────────────────────────────────────────
  return (
    <>
    <div className="relative flex min-h-[calc(100vh-60px)]">
      {/* Left: Decision history sidebar */}
      <DecisionSidebar decisions={state.decisions} worldSummary={state.worldSummary} />

      {/* Center: Current question — focal point */}
      <div className="flex-1 min-w-0 overflow-y-auto flex flex-col" style={{ maxHeight: 'calc(100vh - 60px)', scrollbarWidth: 'none' }}>
        <div className="flex-1 flex flex-col justify-center max-w-2xl mx-auto w-full px-8 py-8">
          {/* Phase stepper */}
          <div className="flex items-center justify-center gap-1 mb-8">
            {([
              { key: 'systems' as const, label: 'Systems', count: state.systems.length },
              { key: 'rules' as const, label: 'Rules', count: state.rules.length },
              { key: 'cast' as const, label: 'Cast', count: chars.length + locs.length },
              { key: 'threads' as const, label: 'Threads', count: threads.length },
            ]).map(({ key, label, count }, idx) => {
              const isActive = state.phase === key;
              const hasContent = count > 0;
              return (
                <div key={key} className="flex items-center">
                  {idx > 0 && (
                    <IconChevronRight size={16} className="mx-0.5 text-white/10" />
                  )}
                  <button
                    onClick={() => handleSwitchPhase(key)}
                    disabled={state.loading && !state.prefetched[key]}
                    className={`flex items-center gap-2 px-2.5 py-1 rounded-full transition disabled:opacity-40 ${
                      isActive
                        ? 'bg-white/10 border border-white/20'
                        : hasContent
                        ? 'border border-emerald-400/15 hover:border-emerald-400/30'
                        : 'border border-white/6 hover:border-white/15'
                    }`}
                  >
                    <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold ${
                      isActive
                        ? 'bg-white/20 text-white'
                        : hasContent
                        ? 'bg-emerald-400/15 text-emerald-400'
                        : 'bg-white/5 text-white/25'
                    }`}>
                      {hasContent && !isActive ? '✓' : idx + 1}
                    </div>
                    <span className={`text-[10px] font-medium ${
                      isActive ? 'text-white/90' : hasContent ? 'text-emerald-400/50' : 'text-white/30'
                    }`}>
                      {label}
                    </span>
                    {count > 0 && (
                      <span className={`text-[8px] font-mono ${hasContent ? 'text-emerald-400/25' : 'text-white/20'}`}>{count}</span>
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Current question */}
          {state.currentQuestion && (
            <div ref={questionRef}>
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-2">
                  <p className="text-[10px] text-white/20 uppercase tracking-[0.15em] font-mono">
                    Round {state.decisions.length + 1}
                  </p>
                  <button
                    onClick={handleRefreshQuestion}
                    disabled={state.loading}
                    title="Get a different question"
                    className="text-white/20 hover:text-white/50 transition disabled:opacity-30"
                  >
                    <IconRefresh size={12} />
                  </button>
                  {state.history.length > 0 && (
                    <button
                      onClick={() => { dispatch({ type: 'UNDO_ROUND' }); setSelectedChoices(new Set()); setCustomAnswer(''); setUseCustom(false); }}
                      disabled={state.loading}
                      title="Undo last round"
                      className="text-white/20 hover:text-white/50 transition disabled:opacity-30"
                    >
                      <IconUndo size={12} />
                    </button>
                  )}
                </div>
                <h2 className="text-xl font-semibold text-white/90 leading-snug">{state.currentQuestion.text}</h2>
                <p className="text-[12px] text-white/35 mt-2 leading-relaxed">{state.currentQuestion.context}</p>
              </div>

              <div className="flex flex-col gap-2.5 mt-6">
                {state.currentQuestion.choices.map((choice) => (
                  <ChoiceCard
                    key={choice.id}
                    label={choice.label}
                    description={choice.description}
                    selected={selectedChoices.has(choice.id)}
                    onClick={() => {
                      setSelectedChoices(prev => {
                        const next = new Set(prev);
                        if (next.has(choice.id)) next.delete(choice.id);
                        else next.add(choice.id);
                        return next;
                      });
                    }}
                    disabled={state.loading}
                  />
                ))}

                {/* Custom answer — additive alongside checkbox selections */}
                <div
                  className={`rounded-xl border px-4 py-3 transition-all ${
                    useCustom ? 'border-white/25 bg-white/8' : 'border-white/6 bg-white/2'
                  }`}
                >
                  {!useCustom ? (
                    <button
                      onClick={() => setUseCustom(true)}
                      disabled={state.loading}
                      className="text-[12px] text-white/25 hover:text-white/50 transition w-full text-left"
                    >
                      Add your own...
                    </button>
                  ) : (
                    <input
                      autoFocus
                      type="text"
                      value={customAnswer}
                      onChange={(e) => setCustomAnswer(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitAnswer(); }}
                      placeholder="Type your own direction..."
                      className="bg-transparent text-sm text-white/80 w-full outline-none placeholder:text-white/25"
                    />
                  )}
                </div>
              </div>

              {/* Submit */}
              <div className="flex items-center gap-2 mt-6">
                <button
                  onClick={handleSubmitAnswer}
                  disabled={state.loading || (selectedChoices.size === 0 && !(useCustom && customAnswer.trim()))}
                  className="flex-1 py-2.5 rounded-lg bg-white/8 hover:bg-white/12 border border-white/10 hover:border-white/20 text-white/80 font-medium transition disabled:opacity-30 text-[12px]"
                >
                  {state.loading ? 'Thinking...' : 'Continue'}
                </button>
                {canCreate && (
                  <button
                    onClick={handleCreate}
                    disabled={state.loading}
                    className="py-2.5 px-5 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/25 text-emerald-400 text-[12px] font-medium transition disabled:opacity-30"
                  >
                    Create Story
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Loading state for first question */}
          {state.loading && !state.currentQuestion && (
            <div className="flex items-center justify-center gap-2 py-8">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-white/35">Preparing first question...</span>
            </div>
          )}

          {state.error && (
            <div className="bg-drive/10 border border-drive/30 rounded-lg px-3 py-2 mt-4">
              <p className="text-xs text-drive/80">{state.error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Right: Phase-aware sidebar */}
      <div className="w-[380px] shrink-0 border-l border-white/6 flex flex-col" style={{ maxHeight: 'calc(100vh - 60px)', scrollbarWidth: 'none' }}>
        {/* Title + entity counts */}
        <div className="px-4 py-3 border-b border-white/6">
          {state.title && (
            <input
              type="text"
              value={state.title}
              onChange={(e) => dispatch({ type: 'SET_TITLE', title: e.target.value })}
              className="bg-transparent text-sm text-white/80 font-medium w-full outline-none focus:text-white transition mb-2"
            />
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] text-white/30">{state.systems.length} System{state.systems.length !== 1 ? 's' : ''}</span>
            <span className="text-[10px] text-white/30">{state.rules.length} Rule{state.rules.length !== 1 ? 's' : ''}</span>
            <span className="text-[10px] text-white/30">{chars.length} Char{chars.length !== 1 ? 's' : ''}</span>
            <span className="text-[10px] text-white/30">{locs.length} Loc{locs.length !== 1 ? 's' : ''}</span>
            <span className="text-[10px] text-white/30">{threads.length} Thread{threads.length !== 1 ? 's' : ''}</span>
          </div>
        </div>

        {/* Phase-specific content */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'none' }}>
          {(state.phase === 'systems') && (
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-mono mb-2">World Systems</p>
              {state.systems.length === 0 ? (
                <p className="text-[11px] text-white/20 italic">No systems yet — answer questions to define how your world works.</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {state.systems.map((sys, i) => (
                    <div key={i} className="border border-white/6 rounded-lg px-3 py-2.5">
                      <p className="text-[12px] text-white/70 font-medium">{sys.name}</p>
                      <p className="text-[10px] text-white/30 leading-snug mt-0.5">{sys.description}</p>
                      {sys.principles?.length > 0 && (
                        <div className="mt-1.5">
                          {sys.principles.map((p, j) => (
                            <p key={j} className="text-[10px] text-white/40 leading-snug pl-2">• {p}</p>
                          ))}
                        </div>
                      )}
                      {sys.constraints?.length > 0 && (
                        <div className="mt-1">
                          {sys.constraints.map((c, j) => (
                            <p key={j} className="text-[10px] text-amber-400/40 leading-snug pl-2">⚠ {c}</p>
                          ))}
                        </div>
                      )}
                      {sys.interactions?.length > 0 && (
                        <div className="mt-1">
                          {sys.interactions.map((ix, j) => (
                            <p key={j} className="text-[10px] text-cyan-400/30 leading-snug pl-2">↔ {ix}</p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(state.phase === 'rules') && (
            <div className="px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-mono mb-2">World Rules</p>
              {state.rules.length === 0 ? (
                <p className="text-[11px] text-white/20 italic">No rules yet — answer questions to define the commandments of your world.</p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {state.rules.map((rule, i) => (
                    <div key={i} className="border border-white/6 rounded-lg px-3 py-2">
                      <p className="text-[11px] text-white/50 leading-snug">
                        <span className="text-white/20 mr-1.5 font-mono text-[10px]">{i + 1}.</span>{rule}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(state.phase === 'cast') && (
            <div>
              <div className="h-[280px]">
                <WorldGraph entities={state.entities.filter(e => e.type !== 'thread')} edges={state.edges} />
              </div>
              {(chars.length > 0 || locs.length > 0) && (
                <div className="border-t border-white/6 px-4 py-3">
                  {chars.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 mb-1.5">
                      <div className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: TYPE_COLORS.character }} />
                      <div>
                        <span className="text-[11px] text-white/60 font-medium">{c.name}</span>
                        {c.role && <span className="text-[9px] text-white/20 ml-1.5">{c.role}</span>}
                        <p className="text-[10px] text-white/30 leading-snug">{c.description}</p>
                      </div>
                    </div>
                  ))}
                  {locs.map((l, i) => (
                    <div key={i} className="flex items-start gap-2 mb-1.5">
                      <div className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: TYPE_COLORS.location }} />
                      <div>
                        <span className="text-[11px] text-white/60 font-medium">{l.name}</span>
                        <p className="text-[10px] text-white/30 leading-snug">{l.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {(state.phase === 'threads') && (
            <div>
              <div className="h-[280px]">
                <WorldGraph entities={state.entities} edges={state.edges} />
              </div>
              {threads.length > 0 && (
                <div className="border-t border-white/6 px-4 py-3">
                  {threads.map((t, i) => (
                    <div key={i} className="flex items-start gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full mt-1 shrink-0" style={{ backgroundColor: TYPE_COLORS.thread }} />
                      <div>
                        <span className="text-[11px] text-white/60 font-medium">{t.name}</span>
                        <p className="text-[10px] text-white/30 leading-snug">{t.description}</p>
                        {t.participantNames?.length && (
                          <p className="text-[9px] text-white/20 mt-0.5">{t.participantNames.join(', ')}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
    {storeState.wizardOpen && <CreationWizard />}
    </>
  );
}

// ── Page wrapper ────────────────────────────────────────────────────────────

function DiscoverWithParams() {
  const params = useSearchParams();
  const inquiryId = params.get('id') ?? undefined;
  return <DiscoverInner inquiryId={inquiryId} />;
}

export default function Page() {
  return (
    <Suspense>
      <DiscoverWithParams />
    </Suspense>
  );
}
