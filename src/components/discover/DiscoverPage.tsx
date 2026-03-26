'use client';

import { useState, useReducer, useRef, useEffect, useCallback } from 'react';
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
import * as d3 from 'd3';

// ── State ────────────────────────────────────────────────────────────────────

type Phase = 'seed' | 'questioning';

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
};

type PremiseAction =
  | { type: 'SET_SEED'; seed: string }
  | { type: 'SET_PHASE'; phase: Phase }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_QUESTION'; question: PremiseQuestion }
  | { type: 'APPLY_ROUND'; decision: PremiseDecision; entities: PremiseEntity[]; edges: PremiseEdge[]; rules: string[]; newSystems: PremiseSystemSketch[]; systemUpdates: { name: string; addPrinciples?: string[]; addConstraints?: string[]; addInteractions?: string[] }[]; title: string; worldSummary: string; question: PremiseQuestion }
  | { type: 'SET_TITLE'; title: string };

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
};

function applySysUpdates(existing: PremiseSystemSketch[], newSystems: PremiseSystemSketch[], updates: { name: string; addPrinciples?: string[]; addConstraints?: string[]; addInteractions?: string[] }[]): PremiseSystemSketch[] {
  const result = [...existing, ...newSystems];
  for (const u of updates) {
    const sys = result.find(s => s.name.toLowerCase() === u.name.toLowerCase());
    if (sys) {
      if (u.addPrinciples?.length) sys.principles = [...sys.principles, ...u.addPrinciples];
      if (u.addConstraints?.length) sys.constraints = [...sys.constraints, ...u.addConstraints];
      if (u.addInteractions?.length) sys.interactions = [...sys.interactions, ...u.addInteractions];
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
    case 'APPLY_ROUND':
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
      };
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
      className={`w-full text-left rounded-xl border px-4 py-3 transition-all ${
        selected
          ? 'border-white/25 bg-white/8'
          : 'border-white/6 bg-white/2 hover:bg-white/5 hover:border-white/12'
      } disabled:opacity-40 disabled:pointer-events-none`}
    >
      <p className={`text-sm font-medium ${selected ? 'text-white/90' : 'text-white/70'}`}>{label}</p>
      <p className="text-[11px] text-white/35 mt-0.5 leading-snug">{description}</p>
    </button>
  );
}

// ── Decision History ─────────────────────────────────────────────────────────

function DecisionHistory({ decisions }: { decisions: PremiseDecision[] }) {
  if (decisions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 mb-6">
      {decisions.map((d, i) => (
        <div key={i} className="rounded-lg px-3 py-2 border border-white/5 bg-white/[0.02]">
          <p className="text-[10px] text-white/25">{d.question}</p>
          <p className="text-xs text-white/50 mt-0.5">{d.answer}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function DiscoverPage() {
  const { state: storeState, dispatch: storeDispatch } = useStore();
  const [state, dispatch] = useReducer(reducer, initialState);
  const [selectedChoice, setSelectedChoice] = useState<string | null>(null);
  const [customAnswer, setCustomAnswer] = useState('');
  const [useCustom, setUseCustom] = useState(false);
  const questionRef = useRef<HTMLDivElement>(null);

  const handleBegin = useCallback(async () => {
    dispatch({ type: 'SET_PHASE', phase: 'questioning' });
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });
    try {
      const result = await generatePremiseQuestion(state.seed, [], [], [], [], '', []);
      dispatch({ type: 'SET_QUESTION', question: result.question });
      if (result.title) dispatch({ type: 'SET_TITLE', title: result.title });
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: String(err) });
    } finally {
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state.seed]);

  const handleSubmitAnswer = useCallback(async () => {
    if (!state.currentQuestion) return;
    const answer = useCustom
      ? customAnswer.trim()
      : state.currentQuestion.choices.find(c => c.id === selectedChoice)?.label ?? '';
    if (!answer) return;

    const decision: PremiseDecision = { question: state.currentQuestion.text, answer };
    dispatch({ type: 'SET_LOADING', loading: true });
    dispatch({ type: 'SET_ERROR', error: null });

    try {
      const result = await generatePremiseQuestion(
        state.seed, [...state.decisions, decision],
        state.entities, state.edges, state.rules, state.title, state.systems,
      );
      dispatch({
        type: 'APPLY_ROUND', decision,
        entities: result.newEntities, edges: result.newEdges,
        rules: result.newRules, newSystems: result.newSystems,
        systemUpdates: result.systemUpdates,
        title: result.title,
        worldSummary: result.worldSummary, question: result.question,
      });
      setSelectedChoice(null);
      setCustomAnswer('');
      setUseCustom(false);
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: String(err) });
      dispatch({ type: 'SET_LOADING', loading: false });
    }
  }, [state, selectedChoice, customAnswer, useCustom]);

  useEffect(() => {
    if (state.currentQuestion && questionRef.current) {
      questionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [state.currentQuestion]);

  const handleCreate = useCallback(() => {
    const { premise, characters, locations, threads, rules, worldSystems } = buildPremiseText(
      state.entities, state.rules, state.worldSummary, state.systems,
    );
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

  const chars = state.entities.filter(e => e.type === 'character');
  const locs = state.entities.filter(e => e.type === 'location');
  const threads = state.entities.filter(e => e.type === 'thread');
  const canCreate = state.decisions.length >= 3;

  // ── Seed Phase ───────────────────────────────────────────────────────
  if (state.phase === 'seed') {
    return (
      <div className="relative min-h-[calc(100vh-60px)] flex flex-col items-center justify-center px-4">
        {/* Aurora background */}
        <div className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="aurora-container absolute bottom-0 left-0 right-0 h-[75%]">
            <div className="aurora-curtain aurora-curtain-1" />
            <div className="aurora-curtain aurora-curtain-3" />
            <div className="aurora-curtain aurora-curtain-5" />
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
    <div className="relative flex flex-col lg:flex-row min-h-[calc(100vh-60px)]">
      {/* Left: Q&A Flow */}
      <div className="flex-1 min-w-0 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 60px)' }}>
        <div className="max-w-xl mx-auto px-6 py-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-xl font-semibold text-white/90 tracking-tight">
              {state.title || 'Discover'}
            </h1>
            {state.worldSummary && (
              <p className="text-[12px] text-white/35 mt-1.5 leading-relaxed">{state.worldSummary}</p>
            )}
          </div>

          {/* Decision history */}
          <DecisionHistory decisions={state.decisions} />

          {/* Current question */}
          {state.currentQuestion && (
            <div ref={questionRef}>
              <div className="mb-3">
                <p className="text-[10px] text-white/20 uppercase tracking-[0.15em] font-mono mb-1">
                  Round {state.decisions.length + 1}
                </p>
                <h2 className="text-[15px] font-semibold text-white/85 leading-snug">{state.currentQuestion.text}</h2>
                <p className="text-[11px] text-white/30 mt-1">{state.currentQuestion.context}</p>
              </div>

              <div className="flex flex-col gap-2 mt-4">
                {state.currentQuestion.choices.map((choice) => (
                  <ChoiceCard
                    key={choice.id}
                    label={choice.label}
                    description={choice.description}
                    selected={!useCustom && selectedChoice === choice.id}
                    onClick={() => { setSelectedChoice(choice.id); setUseCustom(false); }}
                    disabled={state.loading}
                  />
                ))}

                {/* Custom answer */}
                <div
                  className={`rounded-xl border px-4 py-3 transition-all ${
                    useCustom ? 'border-white/25 bg-white/8' : 'border-white/6 bg-white/2'
                  }`}
                >
                  {!useCustom ? (
                    <button
                      onClick={() => { setUseCustom(true); setSelectedChoice(null); }}
                      disabled={state.loading}
                      className="text-[12px] text-white/25 hover:text-white/50 transition w-full text-left"
                    >
                      Write your own...
                    </button>
                  ) : (
                    <input
                      autoFocus
                      type="text"
                      value={customAnswer}
                      onChange={(e) => setCustomAnswer(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && customAnswer.trim()) handleSubmitAnswer(); }}
                      placeholder="Type your own direction..."
                      className="bg-transparent text-sm text-white/80 w-full outline-none placeholder:text-white/25"
                    />
                  )}
                </div>
              </div>

              {/* Submit */}
              <div className="flex items-center gap-2 mt-5">
                <button
                  onClick={handleSubmitAnswer}
                  disabled={state.loading || (!selectedChoice && !(useCustom && customAnswer.trim()))}
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
            <div className="flex items-center gap-2 py-8">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs text-white/35">Preparing first question...</span>
            </div>
          )}

          {state.error && (
            <div className="bg-payoff/10 border border-payoff/30 rounded-lg px-3 py-2 mt-4">
              <p className="text-xs text-payoff/80">{state.error}</p>
            </div>
          )}
        </div>
      </div>

      {/* Right: World Graph */}
      <div className="lg:w-[420px] shrink-0 border-l border-white/6 flex flex-col" style={{ maxHeight: 'calc(100vh - 60px)' }}>
        {/* Entity counts */}
        <div className="flex items-center gap-4 px-4 py-3 border-b border-white/6">
          {(['character', 'location', 'thread'] as const).map(type => {
            const count = type === 'character' ? chars.length : type === 'location' ? locs.length : threads.length;
            return (
              <div key={type} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: TYPE_COLORS[type] }} />
                <span className="text-[10px] text-white/30">
                  {count} {TYPE_LABELS[type]}{count !== 1 ? 's' : ''}
                </span>
              </div>
            );
          })}
          {state.rules.length > 0 && (
            <span className="text-[10px] text-white/30">{state.rules.length} Rule{state.rules.length !== 1 ? 's' : ''}</span>
          )}
          {state.systems.length > 0 && (
            <span className="text-[10px] text-white/30">{state.systems.length} System{state.systems.length !== 1 ? 's' : ''}</span>
          )}
        </div>

        {/* Graph */}
        <div className="flex-1 min-h-[300px]">
          <WorldGraph entities={state.entities} edges={state.edges} />
        </div>

        {/* Rules */}
        {state.rules.length > 0 && (
          <div className="border-t border-white/6 px-4 py-3 max-h-36 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-mono mb-1.5">Rules</p>
            <div className="flex flex-col gap-1">
              {state.rules.map((rule, i) => (
                <p key={i} className="text-[11px] text-white/45 leading-snug">
                  <span className="text-white/20 mr-1.5">{i + 1}.</span>{rule}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* World Systems */}
        {state.systems.length > 0 && (
          <div className="border-t border-white/6 px-4 py-3 max-h-52 overflow-y-auto">
            <p className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-mono mb-1.5">Systems</p>
            <div className="flex flex-col gap-2">
              {state.systems.map((sys, i) => (
                <div key={i}>
                  <p className="text-[11px] text-white/60 font-medium">{sys.name}</p>
                  <p className="text-[10px] text-white/30 leading-snug">{sys.description}</p>
                  {sys.principles.length > 0 && (
                    <div className="mt-0.5">
                      {sys.principles.map((p, j) => (
                        <p key={j} className="text-[10px] text-white/35 leading-snug pl-2">• {p}</p>
                      ))}
                    </div>
                  )}
                  {sys.constraints.length > 0 && (
                    <div className="mt-0.5">
                      {sys.constraints.map((c, j) => (
                        <p key={j} className="text-[10px] text-amber-400/40 leading-snug pl-2">⚠ {c}</p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Title */}
        {state.title && (
          <div className="border-t border-white/6 px-4 py-3">
            <label className="text-[10px] uppercase tracking-[0.15em] text-white/20 font-mono block mb-1">Title</label>
            <input
              type="text"
              value={state.title}
              onChange={(e) => dispatch({ type: 'SET_TITLE', title: e.target.value })}
              className="bg-transparent border-b border-white/8 text-sm text-white/80 w-full outline-none focus:border-white/20 transition pb-0.5"
            />
          </div>
        )}
      </div>
    </div>
    {storeState.wizardOpen && <CreationWizard />}
    </>
  );
}
