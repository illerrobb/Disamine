import React, { useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationNodeDatum } from "d3-force";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Check,
  ChevronDown,
  CircleDot,
  Copy,
  GitCompareArrows,
  Grid3X3,
  Info,
  LayoutList,
  Lock,
  Network,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  X
} from "lucide-react";
import type { Candidate, Evaluation, Position } from "./index";

type ScenarioKind = "preset" | "custom";
type DashboardView = "islands" | "coverage" | "heatmap" | "impact";
type PickerMode = "people" | "positions";
type GraphMode = "positions" | "entities";

export interface SimulationChoice {
  id: string;
  candidateId: string;
  positionId: string;
}

interface SimulationScenario {
  id: string;
  name: string;
  description: string;
  kind: ScenarioKind;
  choices: SimulationChoice[];
}

interface ScenarioMetrics {
  covered: number;
  uncovered: number;
  fragile: number;
  fullyCoveredEntities: number;
  highRisk: number;
  uncertain: number;
}

interface PositionSnapshot {
  position: Position;
  realCandidateId: string | null;
  simulatedCandidateId: string | null;
  availableCandidateIds: string[];
  baseAvailableCandidateIds: string[];
  isCovered: boolean;
  isRealCovered: boolean;
  isSimulatedCovered: boolean;
  isFragile: boolean;
  isInactive: boolean;
  incompleteCount: number;
}

interface ScenarioAnalysis {
  snapshots: Map<string, PositionSnapshot>;
  metrics: ScenarioMetrics;
  entityRows: Array<{
    entity: string;
    total: number;
    covered: number;
    realCovered: number;
    simulatedCovered: number;
    fragile: number;
    uncovered: number;
    inactive: number;
  }>;
}

const blockedStatuses = new Set<Evaluation["status"]>(["excluded", "withdrawn", "non-compatible", "rejected"]);

const storageKey = (researchId: string) => `disamine-simulation-scenarios-${researchId}`;
const choiceId = (candidateId: string, positionId: string) => `${candidateId}::${positionId}`;

const getEvaluation = (evaluations: Record<string, Evaluation>, positionId: string, candidateId: string) =>
  evaluations[`${positionId}_${candidateId}`];

const isEvaluationIncomplete = (position: Position, evaluation?: Evaluation) => {
  if (!evaluation) return true;
  const visible = position.requirements.filter(requirement => !requirement.hidden);
  return visible.some(requirement => !evaluation.reqEvaluations[requirement.id] || evaluation.reqEvaluations[requirement.id] === "pending");
};

const getFit = (position: Position, evaluation?: Evaluation) => {
  if (!evaluation) return 0;
  const visible = position.requirements.filter(requirement => !requirement.hidden);
  if (!visible.length) return 50;
  const points = visible.reduce((total, requirement) => {
    const status = evaluation.reqEvaluations[requirement.id] ?? "pending";
    return total + (status === "yes" ? 1 : status === "partial" ? .45 : 0);
  }, 0);
  return Math.round((points / visible.length) * 100);
};

const getBaseEligibleIds = (
  position: Position,
  candidates: Candidate[],
  evaluations: Record<string, Evaluation>,
  realSelections: Map<string, string>
) => candidates.flatMap(candidate => {
  const evaluation = getEvaluation(evaluations, position.code, candidate.id);
  if (!evaluation || blockedStatuses.has(evaluation.status)) return [];
  const selectedPosition = realSelections.get(candidate.id);
  if (selectedPosition && selectedPosition !== position.code) return [];
  return [candidate.id];
});

export const analyzeScenario = (
  choices: SimulationChoice[],
  candidates: Candidate[],
  positions: Position[],
  evaluations: Record<string, Evaluation>
): ScenarioAnalysis => {
  const realSelections = new Map<string, string>();
  Object.values(evaluations).forEach(evaluation => {
    if (evaluation.status === "selected") realSelections.set(evaluation.candidateId, evaluation.positionId);
  });
  const simulatedByPosition = new Map(choices.map(choice => [choice.positionId, choice.candidateId]));
  const simulatedByCandidate = new Map(choices.map(choice => [choice.candidateId, choice.positionId]));
  const snapshots = new Map<string, PositionSnapshot>();

  positions.forEach(position => {
    const isInactive = position.administrativeStatus === "non-alimentazione";
    const realCandidateId = Object.values(evaluations).find(evaluation =>
      evaluation.positionId === position.code && evaluation.status === "selected"
    )?.candidateId ?? null;
    const simulatedCandidateId = isInactive || realCandidateId ? null : simulatedByPosition.get(position.code) ?? null;
    const baseAvailableCandidateIds = getBaseEligibleIds(position, candidates, evaluations, realSelections);
    const availableCandidateIds = baseAvailableCandidateIds.filter(candidateId => {
      const simulatedPosition = simulatedByCandidate.get(candidateId);
      return !simulatedPosition || simulatedPosition === position.code;
    });
    const isRealCovered = !!realCandidateId;
    const isSimulatedCovered = !!simulatedCandidateId;
    const isCovered = isInactive || isRealCovered || isSimulatedCovered;
    const incompleteCount = availableCandidateIds.filter(candidateId =>
      isEvaluationIncomplete(position, getEvaluation(evaluations, position.code, candidateId))
    ).length;
    snapshots.set(position.code, {
      position,
      realCandidateId,
      simulatedCandidateId,
      availableCandidateIds,
      baseAvailableCandidateIds,
      isCovered,
      isRealCovered,
      isSimulatedCovered,
      isFragile: !isCovered && availableCandidateIds.length === 1,
      isInactive,
      incompleteCount
    });
  });

  const entityMap = new Map<string, ScenarioAnalysis["entityRows"][number]>();
  snapshots.forEach(snapshot => {
    const entity = snapshot.position.entity || "Ente non indicato";
    const row = entityMap.get(entity) ?? {
      entity, total: 0, covered: 0, realCovered: 0, simulatedCovered: 0, fragile: 0, uncovered: 0, inactive: 0
    };
    if (snapshot.isInactive) row.inactive += 1;
    else {
      row.total += 1;
      if (snapshot.isCovered) row.covered += 1;
      else row.uncovered += 1;
      if (snapshot.isRealCovered) row.realCovered += 1;
      if (snapshot.isSimulatedCovered) row.simulatedCovered += 1;
      if (snapshot.isFragile) row.fragile += 1;
    }
    entityMap.set(entity, row);
  });
  const entityRows = Array.from(entityMap.values()).sort((a, b) =>
    (b.total ? b.covered / b.total : 1) - (a.total ? a.covered / a.total : 1) || a.entity.localeCompare(b.entity, "it")
  );
  const active = Array.from(snapshots.values()).filter(snapshot => !snapshot.isInactive);
  const metrics: ScenarioMetrics = {
    covered: active.filter(snapshot => snapshot.isCovered).length,
    uncovered: active.filter(snapshot => !snapshot.isCovered).length,
    fragile: active.filter(snapshot => snapshot.isFragile).length,
    fullyCoveredEntities: entityRows.filter(row => row.total > 0 && row.covered === row.total).length,
    highRisk: active.filter(snapshot => !snapshot.isCovered && snapshot.availableCandidateIds.length === 0).length,
    uncertain: choices.filter(choice => {
      const position = positions.find(item => item.code === choice.positionId);
      return !!position && isEvaluationIncomplete(position, getEvaluation(evaluations, choice.positionId, choice.candidateId));
    }).length
  };
  return { snapshots, metrics, entityRows };
};

const buildPresetChoices = (
  mode: "coverage" | "fragile" | "balanced",
  candidates: Candidate[],
  positions: Position[],
  evaluations: Record<string, Evaluation>
) => {
  const realSelections = new Map<string, string>();
  Object.values(evaluations).forEach(evaluation => {
    if (evaluation.status === "selected") realSelections.set(evaluation.candidateId, evaluation.positionId);
  });
  const openPositions = positions.filter(position =>
    position.administrativeStatus !== "non-alimentazione" &&
    !Object.values(evaluations).some(evaluation => evaluation.positionId === position.code && evaluation.status === "selected")
  );
  const eligible = new Map(openPositions.map(position => [
    position.code,
    getBaseEligibleIds(position, candidates, evaluations, realSelections)
  ]));
  const entityCoverage = new Map<string, number>();
  const used = new Set<string>();
  const choices: SimulationChoice[] = [];
  const pending = [...openPositions];

  while (pending.length) {
    pending.sort((a, b) => {
      const availableA = (eligible.get(a.code) ?? []).filter(id => !used.has(id)).length;
      const availableB = (eligible.get(b.code) ?? []).filter(id => !used.has(id)).length;
      if (mode === "balanced") {
        const balance = (entityCoverage.get(a.entity) ?? 0) - (entityCoverage.get(b.entity) ?? 0);
        if (balance) return balance;
      }
      if (mode === "fragile" && availableA !== availableB) return availableA - availableB;
      return availableA - availableB || a.code.localeCompare(b.code, "it", { numeric: true });
    });
    const position = pending.shift()!;
    const candidateId = (eligible.get(position.code) ?? [])
      .filter(id => !used.has(id))
      .sort((a, b) => {
        const evalA = getEvaluation(evaluations, position.code, a);
        const evalB = getEvaluation(evaluations, position.code, b);
        const candidateA = candidates.find(candidate => candidate.id === a);
        const candidateB = candidates.find(candidate => candidate.id === b);
        const flexibilityA = candidateA?.appliedPositionCodes.length ?? 0;
        const flexibilityB = candidateB?.appliedPositionCodes.length ?? 0;
        return getFit(position, evalB) - getFit(position, evalA) || flexibilityA - flexibilityB;
      })[0];
    if (!candidateId) continue;
    used.add(candidateId);
    entityCoverage.set(position.entity, (entityCoverage.get(position.entity) ?? 0) + 1);
    choices.push({ id: choiceId(candidateId, position.code), candidateId, positionId: position.code });
  }
  return choices;
};

const createInitialScenarios = (candidates: Candidate[], positions: Position[], evaluations: Record<string, Evaluation>): SimulationScenario[] => [
  {
    id: "preset-balanced", name: "Equilibrio enti", description: "Distribuisce la copertura fra gli enti.", kind: "preset",
    choices: buildPresetChoices("balanced", candidates, positions, evaluations)
  },
  {
    id: "preset-fragile", name: "Proteggi fragili", description: "Parte dalle posizioni con meno alternative.", kind: "preset",
    choices: buildPresetChoices("fragile", candidates, positions, evaluations)
  },
  {
    id: "preset-coverage", name: "Copertura massima", description: "Ripiana il maggior numero di posizioni.", kind: "preset",
    choices: buildPresetChoices("coverage", candidates, positions, evaluations)
  }
];

const metricCards = (metrics: ScenarioMetrics) => [
  { label: "Ripianate", value: metrics.covered, detail: "reali + scenario", tone: "text-emerald-700 bg-emerald-50 border-emerald-100" },
  { label: "Scoperte", value: metrics.uncovered, detail: "posizioni attive", tone: "text-rose-700 bg-rose-50 border-rose-100" },
  { label: "Enti completi", value: metrics.fullyCoveredEntities, detail: "copertura 100%", tone: "text-blue-700 bg-blue-50 border-blue-100" },
  { label: "Fragili", value: metrics.fragile, detail: "una sola alternativa", tone: "text-amber-700 bg-amber-50 border-amber-100" }
];

const applyChoice = (choices: SimulationChoice[], next: SimulationChoice) => [
  ...choices.filter(choice => choice.candidateId !== next.candidateId && choice.positionId !== next.positionId),
  next
];

const describeDelta = (before: ScenarioMetrics, after: ScenarioMetrics) => {
  const rows = [
    { label: "Posizioni ripianate", delta: after.covered - before.covered, positive: true },
    { label: "Posizioni scoperte", delta: after.uncovered - before.uncovered, positive: false },
    { label: "Enti completamente ripianati", delta: after.fullyCoveredEntities - before.fullyCoveredEntities, positive: true },
    { label: "Posizioni fragili", delta: after.fragile - before.fragile, positive: false }
  ];
  return rows.filter(row => row.delta !== 0);
};

type GraphNode = SimulationNodeDatum & {
  id: string;
  label: string;
  subtitle: string;
  radius: number;
  coverage: number;
  covered: boolean;
  simulated: boolean;
  fragile: boolean;
  inactive: boolean;
};

interface GraphLink { source: string | GraphNode; target: string | GraphNode; weight: number; }

const IslandsGraph = ({
  mode,
  analysis,
  candidates,
  evaluations,
  selectedId,
  changedPositionIds,
  onSelect
}: {
  mode: GraphMode;
  analysis: ScenarioAnalysis;
  candidates: Candidate[];
  evaluations: Record<string, Evaluation>;
  selectedId: string | null;
  changedPositionIds: Set<string>;
  onSelect: (id: string | null) => void;
}) => {
  const [layout, setLayout] = useState<{ nodes: GraphNode[]; links: GraphLink[] }>({ nodes: [], links: [] });
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | null>(null);

  const graph = useMemo(() => {
    const candidateSets = new Map<string, Set<string>>();
    analysis.snapshots.forEach((snapshot, code) => candidateSets.set(code, new Set(snapshot.availableCandidateIds)));
    if (mode === "positions") {
      const nodes: GraphNode[] = Array.from(analysis.snapshots.values()).map(snapshot => ({
        id: snapshot.position.code,
        label: snapshot.position.code,
        subtitle: snapshot.position.entity || "Ente non indicato",
        radius: 18 + Math.min(20, snapshot.baseAvailableCandidateIds.length * 2.4),
        coverage: snapshot.isCovered ? 1 : 0,
        covered: snapshot.isCovered,
        simulated: snapshot.isSimulatedCovered,
        fragile: snapshot.isFragile,
        inactive: snapshot.isInactive
      }));
      const links: GraphLink[] = [];
      const values = Array.from(analysis.snapshots.values());
      values.forEach((left, index) => values.slice(index + 1).forEach(right => {
        const leftSet = candidateSets.get(left.position.code) ?? new Set<string>();
        const shared = right.availableCandidateIds.filter(id => leftSet.has(id)).length;
        if (shared) links.push({ source: left.position.code, target: right.position.code, weight: shared });
      }));
      return { nodes, links };
    }
    const entityNodes: GraphNode[] = analysis.entityRows.map(row => ({
      id: row.entity,
      label: row.entity,
      subtitle: `${row.covered}/${row.total} ripianate`,
      radius: 25 + Math.min(24, row.total * 3),
      coverage: row.total ? row.covered / row.total : 1,
      covered: row.total > 0 && row.covered === row.total,
      simulated: row.simulatedCovered > 0,
      fragile: row.fragile > 0,
      inactive: row.total === 0
    }));
    const entityCandidates = new Map<string, Set<string>>();
    analysis.snapshots.forEach(snapshot => {
      const entity = snapshot.position.entity || "Ente non indicato";
      const set = entityCandidates.get(entity) ?? new Set<string>();
      snapshot.availableCandidateIds.forEach(id => set.add(id));
      entityCandidates.set(entity, set);
    });
    const links: GraphLink[] = [];
    entityNodes.forEach((left, index) => entityNodes.slice(index + 1).forEach(right => {
      const leftSet = entityCandidates.get(left.id) ?? new Set<string>();
      const shared = Array.from(entityCandidates.get(right.id) ?? []).filter(id => leftSet.has(id)).length;
      if (shared) links.push({ source: left.id, target: right.id, weight: shared });
    }));
    return { nodes: entityNodes, links };
  }, [analysis, candidates, evaluations, mode]);

  useEffect(() => {
    simulationRef.current?.stop();
    const nodes = graph.nodes.map(node => ({ ...node }));
    const links = graph.links.map(link => ({ ...link }));
    const simulation = forceSimulation(nodes)
      .force("link", forceLink<GraphNode, GraphLink>(links).id(node => node.id).distance(link => Math.max(72, 150 - link.weight * 12)).strength(link => Math.min(.95, .24 + link.weight * .13)))
      .force("charge", forceManyBody<GraphNode>().strength(node => -250 - node.radius * 15).distanceMax(550))
      .force("collision", forceCollide<GraphNode>().radius(node => node.radius + 22).strength(1))
      .force("center", forceCenter<GraphNode>(500, 310).strength(.035))
      .force("x", forceX<GraphNode>(500).strength(.015))
      .force("y", forceY<GraphNode>(310).strength(.015))
      .alpha(1)
      .alphaDecay(.028)
      .on("tick", () => setLayout({ nodes: [...nodes], links: [...links] }));
    simulationRef.current = simulation;
    return () => simulation.stop();
  }, [graph]);

  const nodeById = new Map<string, GraphNode>(layout.nodes.map(node => [node.id, node]));
  const getNode = (value: unknown): GraphNode | undefined => {
    if (typeof value === "string") return nodeById.get(value);
    if (value && typeof value === "object" && "id" in value) return value as GraphNode;
    return undefined;
  };
  return (
    <div className="relative h-full min-h-[520px] overflow-hidden rounded-2xl border border-slate-200 bg-[radial-gradient(circle_at_center,_#ffffff_0%,_#f8fafc_58%,_#eef2f7_100%)]">
      <div className="pointer-events-none absolute left-4 top-4 z-10 rounded-xl border border-white/80 bg-white/85 px-3 py-2 text-xs text-slate-500 shadow-sm backdrop-blur">
        <strong className="text-slate-700">Arcipelaghi naturali</strong><br />Più vicini = più candidati condivisi
      </div>
      <svg viewBox="0 0 1000 620" className="h-full w-full" onClick={() => onSelect(null)} role="img" aria-label={`Mappa a isole per ${mode === "positions" ? "posizioni" : "enti"}`}>
        <g>
          {layout.links.map((link, index) => {
            const source = getNode(link.source);
            const target = getNode(link.target);
            if (!source || !target) return null;
            const active = selectedId && (source.id === selectedId || target.id === selectedId);
            return <line key={`${source.id}-${target.id}-${index}`} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={active ? "#2563eb" : "#cbd5e1"} strokeWidth={active ? Math.min(7, 1.8 + link.weight) : Math.min(5, .8 + link.weight * .65)} opacity={selectedId ? active ? .9 : .12 : .45} className="transition-all duration-300" />;
          })}
        </g>
        <g>
          {layout.nodes.map(node => {
            const selected = selectedId === node.id;
            const changed = mode === "positions" ? changedPositionIds.has(node.id) : false;
            const circumference = 2 * Math.PI * (node.radius + 5);
            return (
              <g key={node.id} transform={`translate(${node.x ?? 500}, ${node.y ?? 310})`} onClick={event => { event.stopPropagation(); onSelect(node.id); }} className="cursor-pointer">
                {(selected || changed) && <circle r={node.radius + 13} fill="none" stroke={changed ? "#60a5fa" : "#93c5fd"} strokeWidth="3" opacity=".45" className={changed ? "animate-pulse" : ""} />}
                <circle r={node.radius + 5} fill="none" stroke="#e2e8f0" strokeWidth="5" />
                <circle
                  r={node.radius + 5}
                  fill="none"
                  stroke={node.inactive ? "#94a3b8" : node.simulated ? "#2563eb" : node.covered ? "#10b981" : "#f59e0b"}
                  strokeWidth="5"
                  strokeDasharray={node.inactive ? "5 5" : `${circumference * node.coverage} ${circumference}`}
                  strokeLinecap="round"
                  transform="rotate(-90)"
                />
                <circle r={node.radius} fill="#ffffff" stroke={selected ? "#2563eb" : "#dbe3ee"} strokeWidth={selected ? 2.5 : 1.5} className="drop-shadow-sm" />
                {node.fragile && <circle cx={node.radius * .65} cy={-node.radius * .65} r="5" fill="#f59e0b" stroke="white" strokeWidth="2" />}
                <text textAnchor="middle" y="-2" className="select-none fill-slate-800 text-[12px] font-bold">{node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}</text>
                <text textAnchor="middle" y="14" className="select-none fill-slate-400 text-[9px]">{node.subtitle.length > 22 ? `${node.subtitle.slice(0, 21)}…` : node.subtitle}</text>
                <title>{node.label} · {node.subtitle}</title>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
};

const ImpactPanel = ({ before, after, title, subtitle }: { before: ScenarioAnalysis; after: ScenarioAnalysis; title: string; subtitle: string }) => {
  const delta = describeDelta(before.metrics, after.metrics);
  const changedEntities = after.entityRows.map(row => {
    const previous = before.entityRows.find(item => item.entity === row.entity);
    return { ...row, delta: row.covered - (previous?.covered ?? 0) };
  }).filter(row => row.delta !== 0).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return (
    <div className="space-y-4">
      <div><div className="text-xs font-bold uppercase tracking-[.14em] text-blue-600">Impatto</div><h3 className="mt-1 text-lg font-bold text-slate-900">{title}</h3><p className="mt-1 text-sm text-slate-500">{subtitle}</p></div>
      {!delta.length ? <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">Nessuna variazione di copertura. La scelta può comunque cambiare la robustezza del bacino.</div> : <div className="space-y-2">{delta.map(row => {
        const good = row.positive ? row.delta > 0 : row.delta < 0;
        return <div key={row.label} className={`flex items-center justify-between rounded-xl border px-3 py-2.5 ${good ? "border-emerald-100 bg-emerald-50" : "border-amber-100 bg-amber-50"}`}><span className="text-sm font-medium text-slate-700">{row.label}</span><span className={`text-sm font-bold ${good ? "text-emerald-700" : "text-amber-700"}`}>{row.delta > 0 ? "+" : ""}{row.delta}</span></div>;
      })}</div>}
      {changedEntities.length > 0 && <div><div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">Enti coinvolti</div><div className="space-y-2">{changedEntities.slice(0, 5).map(row => <div key={row.entity} className="flex items-center gap-3 text-sm"><div className={`h-2 w-2 rounded-full ${row.delta > 0 ? "bg-emerald-500" : "bg-rose-500"}`} /><span className="min-w-0 flex-1 truncate text-slate-700">{row.entity}</span><span className="font-semibold text-slate-500">{row.covered}/{row.total}</span></div>)}</div></div>}
    </div>
  );
};

export const SimulationDashboard = ({ candidates, positions, evaluations, researchId }: {
  candidates: Candidate[];
  positions: Position[];
  evaluations: Record<string, Evaluation>;
  researchId: string;
}) => {
  const presets = useMemo(() => createInitialScenarios(candidates, positions, evaluations), [candidates, positions, evaluations]);
  const [scenarios, setScenarios] = useState<SimulationScenario[]>(() => {
    try {
      const stored = localStorage.getItem(storageKey(researchId));
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const allScenarios = useMemo(() => [...presets, ...scenarios], [presets, scenarios]);
  const [activeId, setActiveId] = useState("preset-balanced");
  const [view, setView] = useState<DashboardView>("islands");
  const [graphMode, setGraphMode] = useState<GraphMode>("positions");
  const [pickerMode, setPickerMode] = useState<PickerMode>("people");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scenarioMenuOpen, setScenarioMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedChoiceId, setSelectedChoiceId] = useState<string | null>(null);
  const [selectedGraphId, setSelectedGraphId] = useState<string | null>(null);
  const [previewChoice, setPreviewChoice] = useState<SimulationChoice | null>(null);
  const [compareOpen, setCompareOpen] = useState(false);
  const [pendingReplacement, setPendingReplacement] = useState<SimulationChoice | null>(null);

  useEffect(() => {
    localStorage.setItem(storageKey(researchId), JSON.stringify(scenarios));
  }, [researchId, scenarios]);
  useEffect(() => {
    if (!allScenarios.some(scenario => scenario.id === activeId)) setActiveId(allScenarios[0]?.id ?? "");
  }, [activeId, allScenarios]);

  const activeScenario = allScenarios.find(scenario => scenario.id === activeId) ?? allScenarios[0];
  const activeChoices = activeScenario?.choices ?? [];
  const displayedChoices = previewChoice ? applyChoice(activeChoices, previewChoice) : activeChoices;
  const baseAnalysis = useMemo(() => analyzeScenario([], candidates, positions, evaluations), [candidates, positions, evaluations]);
  const analysis = useMemo(() => analyzeScenario(displayedChoices, candidates, positions, evaluations), [displayedChoices, candidates, positions, evaluations]);
  const committedAnalysis = useMemo(() => analyzeScenario(activeChoices, candidates, positions, evaluations), [activeChoices, candidates, positions, evaluations]);
  const selectedChoice = activeChoices.find(choice => choice.id === selectedChoiceId) ?? null;
  const selectedChoiceBase = useMemo(() => selectedChoice
    ? analyzeScenario(activeChoices.filter(choice => choice.id !== selectedChoice.id), candidates, positions, evaluations)
    : baseAnalysis, [selectedChoice, activeChoices, candidates, positions, evaluations, baseAnalysis]);
  const changedPositionIds = useMemo(() => {
    const set = new Set<string>();
    const comparison = previewChoice ? committedAnalysis : baseAnalysis;
    analysis.snapshots.forEach((snapshot, code) => {
      const before = comparison.snapshots.get(code);
      if (before && (before.isCovered !== snapshot.isCovered || before.availableCandidateIds.length !== snapshot.availableCandidateIds.length)) set.add(code);
    });
    return set;
  }, [analysis, baseAnalysis, committedAnalysis, previewChoice]);
  const candidateById = useMemo(() => new Map(candidates.map(candidate => [candidate.id, candidate])), [candidates]);
  const positionById = useMemo(() => new Map(positions.map(position => [position.code, position])), [positions]);

  const updateActiveChoices = (nextChoices: SimulationChoice[]) => {
    if (!activeScenario) return;
    if (activeScenario.kind === "preset") {
      const id = `scenario-${Date.now()}`;
      const custom: SimulationScenario = { ...activeScenario, id, name: `${activeScenario.name} · variante`, kind: "custom", choices: nextChoices };
      setScenarios(current => [...current, custom]);
      setActiveId(id);
      return;
    }
    setScenarios(current => current.map(scenario => scenario.id === activeScenario.id ? { ...scenario, choices: nextChoices } : scenario));
  };

  const requestChoice = (candidateId: string, positionId: string) => {
    const snapshot = baseAnalysis.snapshots.get(positionId);
    const evaluation = getEvaluation(evaluations, positionId, candidateId);
    if (!snapshot || snapshot.isInactive || snapshot.isRealCovered || !evaluation || blockedStatuses.has(evaluation.status)) return;
    const next = { id: choiceId(candidateId, positionId), candidateId, positionId };
    const conflict = activeChoices.some(choice => choice.candidateId === candidateId || choice.positionId === positionId);
    if (conflict) setPendingReplacement(next);
    else updateActiveChoices([...activeChoices, next]);
    setPreviewChoice(null);
  };

  const createCustom = () => {
    const id = `scenario-${Date.now()}`;
    setScenarios(current => [...current, { id, name: `Scenario ${current.length + 1}`, description: "Scenario manuale", kind: "custom", choices: [] }]);
    setActiveId(id);
    setScenarioMenuOpen(false);
  };
  const duplicateActive = () => {
    if (!activeScenario) return;
    const id = `scenario-${Date.now()}`;
    setScenarios(current => [...current, { ...activeScenario, id, name: `${activeScenario.name} · copia`, kind: "custom", choices: activeChoices.map(choice => ({ ...choice })) }]);
    setActiveId(id);
  };

  const normalizedSearch = search.trim().toLocaleLowerCase("it");
  const visibleCandidates = candidates.filter(candidate => {
    if (!normalizedSearch) return true;
    return [candidate.nominativo, candidate.id, candidate.rank, candidate.serviceEntity].join(" ").toLocaleLowerCase("it").includes(normalizedSearch);
  });
  const visiblePositions = positions.filter(position => {
    if (!normalizedSearch) return true;
    return [position.code, position.title, position.entity].join(" ").toLocaleLowerCase("it").includes(normalizedSearch);
  });

  const selectedSnapshot = selectedGraphId && graphMode === "positions" ? analysis.snapshots.get(selectedGraphId) : null;
  const selectedEntity = selectedGraphId && graphMode === "entities" ? analysis.entityRows.find(row => row.entity === selectedGraphId) : null;
  const snapshotList = Array.from(analysis.snapshots.values()) as PositionSnapshot[];

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">
      <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-6 py-3">
        <div className="mr-3"><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[.14em] text-blue-600"><Sparkles className="h-4 w-4" /> Scenario Lab</div><div className="text-xs text-slate-400">Simulazione non distruttiva</div></div>
        <div className="relative">
          <button onClick={() => setScenarioMenuOpen(value => !value)} className="flex min-w-64 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2 text-left hover:border-blue-300">
            <span><span className="block text-sm font-bold text-slate-800">{activeScenario?.name ?? "Scenario"}</span><span className="block text-[11px] text-slate-500">{activeChoices.length} scelte · {activeScenario?.kind === "preset" ? "Predefinito" : "Personale"}</span></span><ChevronDown className="h-4 w-4 text-slate-400" />
          </button>
          {scenarioMenuOpen && <div className="absolute left-0 top-full z-40 mt-2 w-80 rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
            <div className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Scenari predefiniti</div>
            {presets.map(scenario => <button key={scenario.id} onClick={() => { setActiveId(scenario.id); setScenarioMenuOpen(false); setSelectedChoiceId(null); }} className={`w-full rounded-xl px-3 py-2.5 text-left ${scenario.id === activeId ? "bg-blue-50" : "hover:bg-slate-50"}`}><div className="flex items-center justify-between"><span className="text-sm font-semibold text-slate-800">{scenario.name}</span>{scenario.id === activeId && <Check className="h-4 w-4 text-blue-600" />}</div><p className="mt-0.5 text-xs text-slate-500">{scenario.description}</p></button>)}
            {scenarios.length > 0 && <><div className="mt-2 border-t border-slate-100 px-3 pb-2 pt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Scenari personali</div>{scenarios.map(scenario => <button key={scenario.id} onClick={() => { setActiveId(scenario.id); setScenarioMenuOpen(false); setSelectedChoiceId(null); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-semibold ${scenario.id === activeId ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}><span className="truncate">{scenario.name}</span>{scenario.id === activeId && <Check className="h-4 w-4 text-blue-600" />}</button>)}</>}
            <button onClick={createCustom} className="mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Plus className="h-4 w-4" /> Nuovo scenario vuoto</button>
          </div>}
        </div>
        <button onClick={duplicateActive} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Copy className="h-4 w-4" /> Duplica</button>
        <button onClick={() => setCompareOpen(value => !value)} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${compareOpen ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}><GitCompareArrows className="h-4 w-4" /> Confronta</button>
        <div className="ml-auto flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><Lock className="h-3.5 w-3.5" /> Dati reali protetti</div>
      </header>

      {compareOpen && <div className="border-b border-slate-200 bg-white px-6 py-4"><div className="flex gap-3 overflow-x-auto pb-1">{allScenarios.map(scenario => {
        const metrics = analyzeScenario(scenario.choices, candidates, positions, evaluations).metrics;
        return <button key={scenario.id} onClick={() => setActiveId(scenario.id)} className={`min-w-52 rounded-xl border p-3 text-left ${scenario.id === activeId ? "border-blue-300 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-slate-300"}`}><div className="text-sm font-bold text-slate-800">{scenario.name}</div><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><span className="text-slate-500">Ripianate <b className="text-emerald-700">{metrics.covered}</b></span><span className="text-slate-500">Scoperte <b className="text-rose-700">{metrics.uncovered}</b></span><span className="text-slate-500">Enti <b className="text-blue-700">{metrics.fullyCoveredEntities}</b></span><span className="text-slate-500">Fragili <b className="text-amber-700">{metrics.fragile}</b></span></div></button>;
      })}</div></div>}

      <div className="flex min-h-0 flex-1 gap-4 p-4">
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4"><div className="flex items-center justify-between"><div><h2 className="text-sm font-bold text-slate-900">Scelte dello scenario</h2><p className="mt-0.5 text-xs text-slate-400">Clicca per isolare l’impatto</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{activeChoices.length}</span></div></div>
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3" onClick={event => { if (event.target === event.currentTarget) setSelectedChoiceId(null); }}>
            {activeChoices.map((choice, index) => {
              const candidate = candidateById.get(choice.candidateId);
              const position = positionById.get(choice.positionId);
              const selected = selectedChoiceId === choice.id;
              return <button key={choice.id} onClick={() => setSelectedChoiceId(selected ? null : choice.id)} className={`group w-full rounded-xl border p-3 text-left transition-all ${selected ? "border-blue-300 bg-blue-50 shadow-sm" : "border-slate-150 bg-white hover:border-slate-300 hover:shadow-sm"}`}>
                <div className="flex items-start gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-[10px] font-bold text-slate-500">{index + 1}</span><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-slate-800">{candidate?.nominativo ?? choice.candidateId}</div><div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500"><ArrowRight className="h-3 w-3 text-blue-500" /><span className="font-mono font-bold text-blue-700">{position?.code}</span><span className="truncate">{position?.entity}</span></div></div><span role="button" tabIndex={0} aria-label="Elimina scelta" onClick={event => { event.stopPropagation(); updateActiveChoices(activeChoices.filter(item => item.id !== choice.id)); if (selected) setSelectedChoiceId(null); }} className="rounded-md p-1 text-slate-300 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"><X className="h-4 w-4" /></span></div>
              </button>;
            })}
            {!activeChoices.length && <div className="rounded-xl border border-dashed border-slate-200 p-5 text-center"><CircleDot className="mx-auto h-7 w-7 text-slate-300" /><p className="mt-2 text-sm font-semibold text-slate-600">Scenario vuoto</p><p className="mt-1 text-xs text-slate-400">Aggiungi una persona a una posizione.</p></div>}
          </div>
          <div className="border-t border-slate-100 p-3"><button onClick={() => setPickerOpen(true)} className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700"><Plus className="h-4 w-4" /> Aggiungi scelta</button></div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
            <div className="flex rounded-xl bg-slate-100 p-1">{([
              ["islands", Network, "Isole"], ["coverage", LayoutList, "Copertura"], ["heatmap", Grid3X3, "Sovrapposizioni"], ["impact", GitCompareArrows, "Impatto"]
            ] as const).map(([value, Icon, label]) => <button key={value} onClick={() => setView(value)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all ${view === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}><Icon className="h-4 w-4" /> {label}</button>)}</div>
            {view === "islands" && <div className="ml-auto flex rounded-xl border border-slate-200 p-1"><button onClick={() => { setGraphMode("positions"); setSelectedGraphId(null); }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${graphMode === "positions" ? "bg-slate-900 text-white" : "text-slate-500"}`}>Posizioni</button><button onClick={() => { setGraphMode("entities"); setSelectedGraphId(null); }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${graphMode === "entities" ? "bg-slate-900 text-white" : "text-slate-500"}`}>Enti</button></div>}
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            {view === "islands" && <IslandsGraph mode={graphMode} analysis={analysis} candidates={candidates} evaluations={evaluations} selectedId={selectedGraphId} changedPositionIds={changedPositionIds} onSelect={setSelectedGraphId} />}
            {view === "coverage" && <div className="space-y-3">{analysis.entityRows.map(row => <div key={row.entity} className="overflow-hidden rounded-2xl border border-slate-200"><button onClick={() => { setView("islands"); setGraphMode("entities"); setSelectedGraphId(row.entity); }} className="flex w-full items-center gap-4 bg-slate-50 px-4 py-3 text-left"><Building2 className="h-5 w-5 text-slate-400" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-slate-800">{row.entity}</div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${row.total ? row.covered / row.total * 100 : 100}%` }} /></div></div><div className="text-right"><div className="text-sm font-bold text-slate-800">{row.covered}/{row.total}</div><div className="text-[10px] text-slate-400">ripianate</div></div></button><div className="divide-y divide-slate-100">{snapshotList.filter(snapshot => (snapshot.position.entity || "Ente non indicato") === row.entity).map(snapshot => <button key={snapshot.position.code} onClick={() => { setView("islands"); setGraphMode("positions"); setSelectedGraphId(snapshot.position.code); }} className="grid w-full grid-cols-[90px_1fr_160px_110px] items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-blue-50/40"><span className="font-mono font-bold text-blue-700">{snapshot.position.code}</span><span className="truncate font-medium text-slate-700">{snapshot.position.title}</span><span className="truncate text-slate-500">{candidateById.get(snapshot.realCandidateId ?? snapshot.simulatedCandidateId ?? "")?.nominativo ?? "—"}</span><span className={`justify-self-end rounded-full px-2 py-1 font-bold ${snapshot.isInactive ? "bg-slate-100 text-slate-500" : snapshot.isRealCovered ? "bg-emerald-50 text-emerald-700" : snapshot.isSimulatedCovered ? "bg-blue-50 text-blue-700" : snapshot.isFragile ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{snapshot.isInactive ? "Non alimentata" : snapshot.isRealCovered ? "Reale" : snapshot.isSimulatedCovered ? "Scenario" : snapshot.isFragile ? "Fragile" : "Scoperta"}</span></button>)}</div></div>)}</div>}
            {view === "heatmap" && (() => {
              const relevant = snapshotList.filter(snapshot => !snapshot.isInactive && snapshot.availableCandidateIds.length > 0).sort((a, b) => b.availableCandidateIds.length - a.availableCandidateIds.length).slice(0, 28);
              return <div><div className="mb-4 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Le celle più intense indicano posizioni che condividono più candidati utilizzabili. Sono mostrate le 28 posizioni più connesse.</div><div className="overflow-auto"><table className="border-separate border-spacing-1 text-[10px]"><thead><tr><th className="sticky left-0 bg-white p-2 text-left text-slate-400">Posizione</th>{relevant.map(snapshot => <th key={snapshot.position.code} className="h-24 w-8 align-bottom"><span className="inline-block -rotate-55 whitespace-nowrap font-mono text-slate-500">{snapshot.position.code}</span></th>)}</tr></thead><tbody>{relevant.map(left => <tr key={left.position.code}><th className="sticky left-0 z-10 whitespace-nowrap bg-white p-2 text-left font-mono text-blue-700">{left.position.code}</th>{relevant.map(right => { const shared = left.position.code === right.position.code ? -1 : left.availableCandidateIds.filter(id => right.availableCandidateIds.includes(id)).length; return <td key={right.position.code}><button disabled={shared <= 0} onClick={() => { setView("islands"); setGraphMode("positions"); setSelectedGraphId(left.position.code); }} title={shared < 0 ? left.position.code : `${left.position.code} ↔ ${right.position.code}: ${shared} candidati condivisi`} className={`h-8 w-8 rounded-md border transition-transform hover:scale-110 ${shared < 0 ? "border-slate-200 bg-slate-100" : shared === 0 ? "border-slate-100 bg-white" : shared === 1 ? "border-blue-100 bg-blue-100 text-blue-700" : shared === 2 ? "border-blue-200 bg-blue-300 text-blue-900" : "border-blue-500 bg-blue-600 text-white"}`}>{shared > 0 ? shared : ""}</button></td>; })}</tr>)}</tbody></table></div></div>;
            })()}
            {view === "impact" && <div className="space-y-6"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{metricCards(analysis.metrics).map(card => <div key={card.label} className={`rounded-2xl border p-4 ${card.tone}`}><div className="text-xs font-bold uppercase tracking-wide opacity-75">{card.label}</div><div className="mt-1 text-3xl font-bold">{card.value}</div><div className="mt-1 text-xs opacity-70">{card.detail}</div></div>)}</div><ImpactPanel before={selectedChoice ? selectedChoiceBase : baseAnalysis} after={selectedChoice ? committedAnalysis : analysis} title={selectedChoice ? `${candidateById.get(selectedChoice.candidateId)?.nominativo} → ${selectedChoice.positionId}` : "Scenario completo"} subtitle={selectedChoice ? "Effetto isolato della scelta selezionata." : "Confronto fra la situazione reale e tutte le scelte dello scenario."} /></div>}
          </div>
        </section>

        <aside className="hidden w-72 shrink-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:block">
          {previewChoice ? <ImpactPanel before={committedAnalysis} after={analysis} title="Anteprima" subtitle={`${candidateById.get(previewChoice.candidateId)?.nominativo} → ${previewChoice.positionId}`} /> : selectedChoice ? <ImpactPanel before={selectedChoiceBase} after={committedAnalysis} title={`${candidateById.get(selectedChoice.candidateId)?.nominativo} → ${selectedChoice.positionId}`} subtitle="Impatto isolato della scelta nello scenario." /> : selectedSnapshot ? <div><div className="text-xs font-bold uppercase tracking-wider text-blue-600">Posizione</div><h3 className="mt-1 text-xl font-bold text-slate-900">{selectedSnapshot.position.code}</h3><p className="text-sm text-slate-600">{selectedSnapshot.position.title}</p><p className="mt-1 text-xs text-slate-400">{selectedSnapshot.position.entity}</p><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase text-slate-400">Utilizzabili</div><div className="text-xl font-bold text-slate-800">{selectedSnapshot.availableCandidateIds.length}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase text-slate-400">Stato</div><div className="mt-1 text-xs font-bold text-slate-700">{selectedSnapshot.isRealCovered ? "Ripianata" : selectedSnapshot.isSimulatedCovered ? "Scenario" : selectedSnapshot.isInactive ? "Non alimentata" : "Scoperta"}</div></div></div><div className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">Persone segnalate</div><div className="mt-2 space-y-2">{selectedSnapshot.baseAvailableCandidateIds.map(candidateId => { const candidate = candidateById.get(candidateId); const evalItem = getEvaluation(evaluations, selectedSnapshot.position.code, candidateId); return <button key={candidateId} onMouseEnter={() => setPreviewChoice({ id: choiceId(candidateId, selectedSnapshot.position.code), candidateId, positionId: selectedSnapshot.position.code })} onMouseLeave={() => setPreviewChoice(null)} onClick={() => requestChoice(candidateId, selectedSnapshot.position.code)} className="flex w-full items-center gap-2 rounded-xl border border-slate-200 p-2 text-left hover:border-blue-300 hover:bg-blue-50"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100"><UserRound className="h-4 w-4 text-slate-500" /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-slate-800">{candidate?.nominativo}</div><div className="text-[10px] text-slate-400">Compatibilità {getFit(selectedSnapshot.position, evalItem)}%</div></div><Plus className="h-4 w-4 text-blue-600" /></button>; })}</div></div> : selectedEntity ? <div><div className="text-xs font-bold uppercase tracking-wider text-blue-600">Ente</div><h3 className="mt-1 text-lg font-bold text-slate-900">{selectedEntity.entity}</h3><div className="mt-5 grid grid-cols-2 gap-2">{[["Ripianate", selectedEntity.covered], ["Da ripianare", selectedEntity.total], ["Fragili", selectedEntity.fragile], ["Non alimentate", selectedEntity.inactive]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase text-slate-400">{label}</div><div className="text-xl font-bold text-slate-800">{value}</div></div>)}</div></div> : <ImpactPanel before={baseAnalysis} after={analysis} title="Scenario completo" subtitle="Clicca una scelta, un ente o una posizione per approfondire." />}
        </aside>
      </div>

      {pickerOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-5 backdrop-blur-sm" onMouseDown={event => { if (event.target === event.currentTarget) { setPickerOpen(false); setPreviewChoice(null); } }}><div className="flex h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-white/40 bg-white shadow-2xl">
        <div className="flex items-center gap-4 border-b border-slate-200 px-6 py-4"><div><h2 className="text-lg font-bold text-slate-900">Aggiungi una scelta</h2><p className="text-xs text-slate-400">Passa su un’opzione per vedere l’impatto, clicca per inserirla.</p></div><div className="ml-auto flex rounded-xl bg-slate-100 p-1"><button onClick={() => setPickerMode("people")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${pickerMode === "people" ? "bg-white shadow-sm" : "text-slate-500"}`}><Users className="h-4 w-4" /> Persone</button><button onClick={() => setPickerMode("positions")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${pickerMode === "positions" ? "bg-white shadow-sm" : "text-slate-500"}`}><Building2 className="h-4 w-4" /> Posizioni</button></div><button onClick={() => { setPickerOpen(false); setPreviewChoice(null); }} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_300px]">
          <div className="flex min-h-0 flex-col border-r border-slate-200"><div className="p-4"><label className="relative block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder={pickerMode === "people" ? "Cerca persona, matricola o ente…" : "Cerca posizione o ente…"} className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label></div><div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {pickerMode === "people" ? visibleCandidates.map(candidate => {
              const applicable = positions.filter(position => {
                const evaluation = getEvaluation(evaluations, position.code, candidate.id);
                const snapshot = baseAnalysis.snapshots.get(position.code);
                return evaluation && !blockedStatuses.has(evaluation.status) && snapshot && !snapshot.isInactive && !snapshot.isRealCovered;
              });
              if (!applicable.length) return null;
              return <div key={candidate.id} className="rounded-2xl border border-slate-200 p-3"><div className="flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100"><UserRound className="h-4 w-4 text-slate-500" /></div><div className="min-w-0"><div className="truncate text-sm font-bold text-slate-800">{candidate.nominativo}</div><div className="truncate text-xs text-slate-400">{candidate.rank} · {candidate.serviceEntity}</div></div></div><div className="mt-3 flex flex-wrap gap-2">{applicable.map(position => { const current = activeChoices.find(choice => choice.positionId === position.code); return <button key={position.code} onMouseEnter={() => setPreviewChoice({ id: choiceId(candidate.id, position.code), candidateId: candidate.id, positionId: position.code })} onMouseLeave={() => setPreviewChoice(null)} onClick={() => requestChoice(candidate.id, position.code)} className={`group relative rounded-lg border px-2.5 py-1.5 font-mono text-xs font-bold transition-all ${current?.candidateId === candidate.id ? "border-blue-300 bg-blue-600 text-white" : current ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-blue-700 hover:-translate-y-0.5 hover:border-blue-400 hover:shadow"}`} title={`${position.code} · ${position.title}`}>{position.code}{current && current.candidateId !== candidate.id && <span className="ml-1 text-[9px]">↻</span>}</button>; })}</div></div>;
            }) : visiblePositions.map(position => {
              const snapshot = baseAnalysis.snapshots.get(position.code);
              if (!snapshot || snapshot.isInactive || snapshot.isRealCovered) return null;
              return <div key={position.code} className="rounded-2xl border border-slate-200 p-3"><div className="flex items-start gap-3"><span className="rounded-lg bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700">{position.code}</span><div className="min-w-0"><div className="truncate text-sm font-bold text-slate-800">{position.title}</div><div className="truncate text-xs text-slate-400">{position.entity} · {snapshot.baseAvailableCandidateIds.length} utilizzabili</div></div></div><div className="mt-3 flex flex-wrap gap-2">{snapshot.baseAvailableCandidateIds.map(candidateId => { const candidate = candidateById.get(candidateId); const current = activeChoices.find(choice => choice.positionId === position.code); return <button key={candidateId} onMouseEnter={() => setPreviewChoice({ id: choiceId(candidateId, position.code), candidateId, positionId: position.code })} onMouseLeave={() => setPreviewChoice(null)} onClick={() => requestChoice(candidateId, position.code)} className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-all ${current?.candidateId === candidateId ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 text-slate-700 hover:-translate-y-0.5 hover:border-blue-400 hover:bg-blue-50 hover:shadow"}`}>{candidate?.nominativo}</button>; })}</div></div>;
            })}
          </div></div>
          <div className="overflow-y-auto bg-slate-50 p-5">{previewChoice ? <ImpactPanel before={committedAnalysis} after={analysis} title={`${candidateById.get(previewChoice.candidateId)?.nominativo} → ${previewChoice.positionId}`} subtitle="Anteprima: nessuna modifica ancora applicata." /> : <div className="flex h-full flex-col items-center justify-center text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm"><Sparkles className="h-5 w-5 text-blue-600" /></div><h3 className="mt-4 text-sm font-bold text-slate-700">Anteprima immediata</h3><p className="mt-1 max-w-52 text-xs leading-relaxed text-slate-400">Passa su una persona o posizione per vedere cosa cambia prima di scegliere.</p></div>}</div>
        </div>
      </div></div>}

      {pendingReplacement && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50"><AlertTriangle className="h-5 w-5 text-amber-600" /></div><h3 className="mt-4 text-lg font-bold text-slate-900">Sostituire la scelta esistente?</h3><p className="mt-2 text-sm text-slate-500">La persona o la posizione è già usata nello scenario. La nuova scelta sostituirà automaticamente quella precedente.</p><div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><strong>{candidateById.get(pendingReplacement.candidateId)?.nominativo}</strong><span className="mx-2 text-blue-500">→</span><strong className="font-mono text-blue-700">{pendingReplacement.positionId}</strong></div><div className="mt-6 flex justify-end gap-2"><button onClick={() => setPendingReplacement(null)} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Annulla</button><button onClick={() => { updateActiveChoices(applyChoice(activeChoices, pendingReplacement)); setPendingReplacement(null); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Sostituisci</button></div></div></div>}
    </div>
  );
};
