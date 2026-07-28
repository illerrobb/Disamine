import React, { Fragment, useEffect, useMemo, useState } from "react";
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
  Plus,
  Search,
  Sparkles,
  Trash2,
  SlidersHorizontal,
  UserRound,
  Users,
  X
} from "lucide-react";
import type { Candidate, Evaluation, Position } from "./index";

type ScenarioKind = "preset" | "custom";
type DashboardView = "priorities" | "coverage" | "heatmap" | "impact";
type PickerMode = "people" | "positions";
type GraphMode = "positions" | "entities";
type ManualPositionStatus = "non-alimentazione" | "estensione-mandato-titolare";

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
  positionStatuses?: Record<string, ManualPositionStatus>;
  config?: ScenarioConfig;
}

export interface ScenarioConfig {
  preferNoForeignExperience: boolean;
  prioritizeEntityLevel: boolean;
  minimumEntityCoverage: number;
  positionQuery: string;
  entities: string[];
  roles: string[];
  proposeNoFeeding?: boolean;
}

const defaultScenarioConfig: ScenarioConfig = {
  preferNoForeignExperience: true,
  prioritizeEntityLevel: true,
  minimumEntityCoverage: 70,
  positionQuery: "",
  entities: [],
  roles: [],
  proposeNoFeeding: true
};

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
  manualStatus: ManualPositionStatus | null;
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
  evaluations: Record<string, Evaluation>,
  positionStatuses: Record<string, ManualPositionStatus> = {}
): ScenarioAnalysis => {
  const evaluationList = Object.values(evaluations);
  const realSelections = new Map<string, string>();
  const realByPosition = new Map<string, string>();
  evaluationList.forEach(evaluation => {
    if (evaluation.status === "selected") realSelections.set(evaluation.candidateId, evaluation.positionId);
    if (evaluation.status === "selected") realByPosition.set(evaluation.positionId, evaluation.candidateId);
  });
  const simulatedByPosition = new Map(choices.map(choice => [choice.positionId, choice.candidateId]));
  const simulatedByCandidate = new Map(choices.map(choice => [choice.candidateId, choice.positionId]));
  const snapshots = new Map<string, PositionSnapshot>();

  positions.forEach(position => {
    const manualStatus = positionStatuses[position.code] ?? (position.administrativeStatus === "non-alimentazione" || position.administrativeStatus === "estensione-mandato-titolare" ? position.administrativeStatus : null);
    const isInactive = manualStatus === "non-alimentazione" || manualStatus === "estensione-mandato-titolare";
    const realCandidateId = realByPosition.get(position.code) ?? null;
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
      manualStatus,
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

const entityLevel = (value: string) => {
  const normalized = value.toLocaleLowerCase("it");
  const tier = normalized.includes("elevatissimo") ? 300 : normalized.includes("elevato") ? 200 : normalized.includes("medio") ? 100 : 0;
  const number = Number(normalized.match(/\d+/)?.[0] ?? 0);
  return tier + number;
};

export const buildConfiguredChoices = (
  config: ScenarioConfig,
  candidates: Candidate[],
  positions: Position[],
  evaluations: Record<string, Evaluation>
) => {
  const query = config.positionQuery.trim().toLocaleLowerCase("it");
  const scoped = positions.filter(position =>
    (!config.entities.length || config.entities.includes(position.entity)) &&
    (!config.roles.length || config.roles.includes(position.role)) &&
    (!query || [position.code, position.title, position.entity, position.role, position.catSpecQualReq].join(" ").toLocaleLowerCase("it").includes(query))
  );
  const realSelections = new Map<string, string>();
  Object.values(evaluations).forEach(evaluation => { if (evaluation.status === "selected") realSelections.set(evaluation.candidateId, evaluation.positionId); });
  const used = new Set<string>();
  const assignedByEntity = new Map<string, number>();
  const totalsByEntity = new Map<string, number>();
  scoped.forEach(position => totalsByEntity.set(position.entity, (totalsByEntity.get(position.entity) ?? 0) + 1));
  const open = scoped.filter(position => position.administrativeStatus !== "non-alimentazione" && !Array.from(realSelections.values()).includes(position.code));
  const choices: SimulationChoice[] = [];

  while (open.length) {
    open.sort((a, b) => {
      const coverageA = (assignedByEntity.get(a.entity) ?? 0) / (totalsByEntity.get(a.entity) ?? 1) * 100;
      const coverageB = (assignedByEntity.get(b.entity) ?? 0) / (totalsByEntity.get(b.entity) ?? 1) * 100;
      const belowA = coverageA < config.minimumEntityCoverage ? 1 : 0;
      const belowB = coverageB < config.minimumEntityCoverage ? 1 : 0;
      const eligibleA = getBaseEligibleIds(a, candidates, evaluations, realSelections).filter(id => !used.has(id)).length;
      const eligibleB = getBaseEligibleIds(b, candidates, evaluations, realSelections).filter(id => !used.has(id)).length;
      return belowB - belowA || (config.prioritizeEntityLevel ? entityLevel(b.entity) - entityLevel(a.entity) : 0) || eligibleA - eligibleB || a.code.localeCompare(b.code, "it", { numeric: true });
    });
    const position = open.shift()!;
    const candidateId = getBaseEligibleIds(position, candidates, evaluations, realSelections).filter(id => !used.has(id)).sort((a, b) => {
      const candidateA = candidates.find(candidate => candidate.id === a)!;
      const candidateB = candidates.find(candidate => candidate.id === b)!;
      const foreignA = candidateA.internationalMandates.trim() ? 1 : 0;
      const foreignB = candidateB.internationalMandates.trim() ? 1 : 0;
      return (config.preferNoForeignExperience ? foreignA - foreignB : 0) || getFit(position, getEvaluation(evaluations, position.code, b)) - getFit(position, getEvaluation(evaluations, position.code, a)) || candidateA.appliedPositionCodes.length - candidateB.appliedPositionCodes.length;
    })[0];
    if (!candidateId) continue;
    used.add(candidateId);
    assignedByEntity.set(position.entity, (assignedByEntity.get(position.entity) ?? 0) + 1);
    choices.push({ id: choiceId(candidateId, position.code), candidateId, positionId: position.code });
  }
  return choices;
};

/** Positions for which non-alimentazione is worth an explicit human review.
 * The suggestion is deliberately conservative: it only includes active, uncovered
 * positions with no usable candidate, so it never frees a person by silently
 * changing an appointment decision. */
export const buildNoFeedingRecommendations = (
  choices: SimulationChoice[],
  candidates: Candidate[],
  positions: Position[],
  evaluations: Record<string, Evaluation>
) => Array.from(analyzeScenario(choices, candidates, positions, evaluations).snapshots.values())
  .filter(snapshot => !snapshot.isInactive && !snapshot.isCovered && snapshot.baseAvailableCandidateIds.length === 0)
  .map(snapshot => snapshot.position.code);

const createInitialScenarios = (candidates: Candidate[], positions: Position[], evaluations: Record<string, Evaluation>): SimulationScenario[] => [
  {
    id: "preset-balanced", name: "Equilibrio enti", description: "Distribuisce la copertura fra gli enti.", kind: "preset",
    choices: buildPresetChoices("balanced", candidates, positions, evaluations), positionStatuses: {}
  },
  {
    id: "preset-fragile", name: "Proteggi fragili", description: "Parte dalle posizioni con meno alternative.", kind: "preset",
    choices: buildPresetChoices("fragile", candidates, positions, evaluations), positionStatuses: {}
  },
  {
    id: "preset-coverage", name: "Copertura massima", description: "Ripiana il maggior numero di posizioni.", kind: "preset",
    choices: buildPresetChoices("coverage", candidates, positions, evaluations), positionStatuses: {}
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

export const getPositionPriority = (snapshot: PositionSnapshot) => {
  if (snapshot.isInactive) return 5;
  if (snapshot.isRealCovered) return 4;
  if (snapshot.isSimulatedCovered) return 3;
  if (snapshot.availableCandidateIds.length === 0) return 0;
  if (snapshot.availableCandidateIds.length === 1) return 1;
  return 2;
};

export const sortPositionSnapshots = (snapshots: PositionSnapshot[]) => [...snapshots].sort((left, right) =>
  getPositionPriority(left) - getPositionPriority(right) ||
  left.availableCandidateIds.length - right.availableCandidateIds.length ||
  (left.position.entity || "Ente non indicato").localeCompare(right.position.entity || "Ente non indicato", "it") ||
  left.position.code.localeCompare(right.position.code, "it", { numeric: true })
);

const priorityMeta = (snapshot: PositionSnapshot) => {
  if (snapshot.manualStatus === "non-alimentazione") return { label: "Non alimentazione", tone: "bg-rose-50 text-rose-700", dot: "bg-rose-500" };
  if (snapshot.manualStatus === "estensione-mandato-titolare") return { label: "Estensione mandato titolare", tone: "bg-amber-50 text-amber-700", dot: "bg-amber-500" };
  if (snapshot.isRealCovered) return { label: "Ripianata reale", tone: "bg-emerald-50 text-emerald-700", dot: "bg-emerald-500" };
  if (snapshot.isSimulatedCovered) return { label: "Ripianata scenario", tone: "bg-blue-50 text-blue-700", dot: "bg-blue-500" };
  if (snapshot.availableCandidateIds.length === 0) return { label: "Critica", tone: "bg-rose-50 text-rose-700", dot: "bg-rose-500" };
  if (snapshot.availableCandidateIds.length === 1) return { label: "Fragile", tone: "bg-amber-50 text-amber-700", dot: "bg-amber-500" };
  return { label: "Da ripianare", tone: "bg-violet-50 text-violet-700", dot: "bg-violet-500" };
};

const DeterministicMap = ({
  mode,
  analysis,
  selectedId,
  changedPositionIds,
  onSelect
}: {
  mode: GraphMode;
  analysis: ScenarioAnalysis;
  selectedId: string | null;
  changedPositionIds: Set<string>;
  onSelect: (id: string | null) => void;
}) => {
  const positions = useMemo(() => sortPositionSnapshots(Array.from(analysis.snapshots.values())), [analysis]);
  const entities = useMemo(() => [...analysis.entityRows].sort((left, right) =>
    (left.total ? left.covered / left.total : 1) - (right.total ? right.covered / right.total : 1) ||
    right.fragile - left.fragile ||
    left.entity.localeCompare(right.entity, "it")
  ), [analysis]);

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-start gap-3 border-b border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900">
        <LayoutList className="mt-0.5 h-4 w-4 shrink-0" />
        <div><strong>Mappa deterministica.</strong> Nessun elemento si muove: l’ordine è sempre rischio, numero di alternative, ente e codice. Le urgenze restano in cima anche con molte posizioni.</div>
      </div>
      {mode === "positions" ? (
        <div className="divide-y divide-slate-100">
          <div className="grid grid-cols-[42px_110px_minmax(180px,1fr)_minmax(140px,.7fr)_110px_120px] gap-3 bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-400">
            <span>#</span><span>Posizione</span><span>Incarico</span><span>Ente</span><span>Alternative</span><span>Priorità</span>
          </div>
          {positions.map((snapshot, index) => {
            const meta = priorityMeta(snapshot);
            const selected = selectedId === snapshot.position.code;
            return <button data-testid={`position-row-${snapshot.position.code}`} key={snapshot.position.code} onClick={() => onSelect(selected ? null : snapshot.position.code)} className={`grid w-full grid-cols-[42px_110px_minmax(180px,1fr)_minmax(140px,.7fr)_110px_120px] items-center gap-3 px-4 py-3 text-left text-xs transition-colors ${selected ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : "hover:bg-slate-50"}`}>
              <span className="font-mono text-slate-400">{String(index + 1).padStart(2, "0")}</span>
              <span className="flex items-center gap-2 font-mono font-bold text-blue-700"><span className={`h-2 w-2 rounded-full ${meta.dot}`} />{snapshot.position.code}{changedPositionIds.has(snapshot.position.code) && <span className="h-1.5 w-1.5 rounded-full bg-blue-500" title="Cambiata dallo scenario" />}</span>
              <span className="truncate font-semibold text-slate-700">{snapshot.position.title || "—"}</span>
              <span className="truncate text-slate-500">{snapshot.position.entity || "Ente non indicato"}</span>
              <span className="font-semibold text-slate-600">{snapshot.availableCandidateIds.length} utilizzabili</span>
              <span className={`justify-self-start rounded-full px-2.5 py-1 font-bold ${meta.tone}`}>{meta.label}</span>
            </button>;
          })}
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {entities.map((row, index) => {
            const ratio = row.total ? row.covered / row.total : 1;
            const selected = selectedId === row.entity;
            return <button key={row.entity} onClick={() => onSelect(selected ? null : row.entity)} className={`grid w-full grid-cols-[42px_minmax(180px,1fr)_100px_100px_100px_minmax(160px,.8fr)] items-center gap-4 px-4 py-3 text-left text-xs ${selected ? "bg-blue-50 ring-1 ring-inset ring-blue-200" : "hover:bg-slate-50"}`}>
              <span className="font-mono text-slate-400">{String(index + 1).padStart(2, "0")}</span>
              <span className="truncate font-bold text-slate-800">{row.entity}</span>
              <span><strong className="text-slate-800">{row.covered}/{row.total}</strong><span className="block text-[10px] text-slate-400">ripianate</span></span>
              <span><strong className="text-rose-700">{row.uncovered}</strong><span className="block text-[10px] text-slate-400">scoperte</span></span>
              <span><strong className="text-amber-700">{row.fragile}</strong><span className="block text-[10px] text-slate-400">fragili</span></span>
              <span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-600" style={{ width: `${ratio * 100}%` }} /></span>
            </button>;
          })}
        </div>
      )}
    </div>
  );
};

const CandidateChoice = ({ candidate, position, evaluation, selected, occupied, onPreview, onChoose }: {
  key?: React.Key;
  candidate: Candidate;
  position: Position;
  evaluation?: Evaluation;
  selected: boolean;
  occupied: boolean;
  onPreview: (active: boolean) => void;
  onChoose: () => void;
}) => {
  const visibleRequirements = position.requirements.filter(requirement => !requirement.hidden);
  const completed = visibleRequirements.filter(requirement => {
    const value = evaluation?.reqEvaluations[requirement.id];
    return value && value !== "pending";
  }).length;
  const fit = getFit(position, evaluation);
  const evaluationLabel = evaluation?.status === "reserve" ? "Riserva" : evaluation?.status === "selected" ? "Già selezionato" : completed === visibleRequirements.length ? "Valutazione completa" : `${completed}/${visibleRequirements.length} requisiti valutati`;
  return <button type="button" onPointerEnter={() => onPreview(true)} onPointerLeave={() => onPreview(false)} onFocus={() => onPreview(true)} onBlur={() => onPreview(false)} onClick={onChoose} className={`group relative min-w-[220px] max-w-[300px] rounded-xl border p-3 text-left transition-all ${selected ? "border-blue-600 bg-blue-600 text-white shadow-sm" : occupied ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white hover:border-blue-400 hover:shadow-sm"}`}>
    <span className="flex items-start justify-between gap-2"><span className="min-w-0"><span className={`block text-[9px] font-bold uppercase tracking-wide ${selected ? "text-blue-100" : "text-slate-400"}`}>Ente</span><span className="block truncate text-xs font-bold">{position.entity || "Ente n.d."}</span><span className={`mt-1 block text-[9px] font-bold uppercase tracking-wide ${selected ? "text-blue-100" : "text-slate-400"}`}>Posizione</span><span className="block truncate text-[11px]">{position.code} · {position.title}</span></span>{selected && <Check className="h-4 w-4 shrink-0" />}</span>
    <span className="mt-2 flex items-center gap-2"><span className={`h-1.5 flex-1 overflow-hidden rounded-full ${selected ? "bg-blue-400" : "bg-slate-100"}`}><span className={`block h-full rounded-full ${fit >= 75 ? "bg-emerald-500" : fit >= 45 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${fit}%` }} /></span><span className="text-[10px] font-bold">{fit}%</span></span>
    <span className={`mt-1 block text-[9px] ${selected ? "text-blue-100" : "text-slate-400"}`}><b>Disamina requisiti:</b> {selected ? "Clicca per togliere" : evaluationLabel}</span>
    <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 hidden w-64 -translate-x-1/2 rounded-xl bg-slate-950 p-3 text-left text-[11px] font-normal leading-relaxed text-white shadow-xl group-hover:block group-focus:block">
      <strong className="block text-xs">Perché {fit}%</strong><span className="mt-1 block text-slate-300">Compatibilità calcolata sui requisiti già valutati: sì = pieno, parziale = 45%, no o pendente = 0%.</span><span className="mt-2 block">{evaluationLabel} · Stato: {evaluation?.status ?? "non valutato"}</span><span className="mt-1 block">{candidate.rank || "Grado n.d."} · {candidate.serviceEntity || "Ente n.d."}</span>
    </span>
  </button>;
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

const ScenarioComparison = ({ scenarios, candidates, positions, evaluations, candidateById }: {
  scenarios: SimulationScenario[];
  candidates: Candidate[];
  positions: Position[];
  evaluations: Record<string, Evaluation>;
  candidateById: Map<string, Candidate>;
}) => {
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(() => new Set());
  const columns = scenarios.map(scenario => ({
    scenario,
    analysis: analyzeScenario(scenario.choices, candidates, positions, evaluations, scenario.positionStatuses)
  }));
  const entityNames = Array.from(new Set(positions.map(position => position.entity || "Ente non indicato"))).sort((a, b) => a.localeCompare(b, "it"));
  const maxActive = Math.max(1, ...columns.map(({ analysis }) => analysis.metrics.covered + analysis.metrics.uncovered));
  const assignmentLabel = (snapshot?: PositionSnapshot) => {
    if (!snapshot) return "—";
    if (snapshot.manualStatus === "non-alimentazione") return "Non alimentata";
    if (snapshot.manualStatus === "estensione-mandato-titolare") return "Mandato esteso";
    const candidate = candidateById.get(snapshot.realCandidateId ?? snapshot.simulatedCandidateId ?? "");
    return candidate?.nominativo ?? (snapshot.isFragile ? "Scoperta · fragile" : "Scoperta");
  };

  return <div className="space-y-5">
    <div className="grid gap-3 xl:grid-cols-3">{columns.map(({ scenario, analysis }) => {
      const total = analysis.metrics.covered + analysis.metrics.uncovered;
      const coverage = total ? Math.round(analysis.metrics.covered / total * 100) : 100;
      return <div key={scenario.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3"><div><div className="font-bold text-slate-900">{scenario.name}</div><div className="text-xs text-slate-400">{scenario.description}</div></div><span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{coverage}%</span></div>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-slate-100" title={`${analysis.metrics.covered} ripianate, ${analysis.metrics.uncovered} scoperte`}><span className="bg-emerald-500" style={{ width: `${analysis.metrics.covered / maxActive * 100}%` }} /><span className="bg-rose-300" style={{ width: `${analysis.metrics.uncovered / maxActive * 100}%` }} /></div>
        <div className="mt-3 grid grid-cols-4 gap-2 text-center"><div><b className="block text-emerald-700">{analysis.metrics.covered}</b><span className="text-[10px] text-slate-400">ripianate</span></div><div><b className="block text-rose-700">{analysis.metrics.uncovered}</b><span className="text-[10px] text-slate-400">scoperte</span></div><div><b className="block text-amber-700">{analysis.metrics.fragile}</b><span className="text-[10px] text-slate-400">fragili</span></div><div><b className="block text-slate-600">{Array.from(analysis.snapshots.values()).filter(item => item.isInactive).length}</b><span className="text-[10px] text-slate-400">non attive</span></div></div>
      </div>;
    })}</div>

    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-4"><h3 className="font-bold text-slate-900">Copertura per ente</h3><p className="text-xs text-slate-500">La barra confronta ripianate e posizioni attive; le non alimentate sono indicate a parte.</p></div>
      <div className="overflow-auto"><table className="min-w-full text-xs"><thead><tr className="bg-slate-50 text-left text-[10px] uppercase tracking-wide text-slate-400"><th className="sticky left-0 z-10 bg-slate-50 px-4 py-3">Ente / posizione</th>{columns.map(({ scenario }) => <th key={scenario.id} className="min-w-52 px-4 py-3">{scenario.name}</th>)}</tr></thead><tbody>{entityNames.map(entity => {
        const expanded = expandedEntities.has(entity);
        const entityPositions = positions.filter(position => (position.entity || "Ente non indicato") === entity);
        return <Fragment key={entity}><tr className="border-t border-slate-100"><th className="sticky left-0 z-10 bg-white px-4 py-3 text-left"><button type="button" aria-expanded={expanded} onClick={() => setExpandedEntities(current => { const next = new Set(current); if (next.has(entity)) next.delete(entity); else next.add(entity); return next; })} className="flex w-full items-center gap-2 font-semibold text-slate-700"><ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} /><span className="min-w-0 flex-1 truncate">{entity}</span><span className="text-[10px] font-normal text-slate-400">{entityPositions.length} posizioni</span></button></th>{columns.map(({ scenario, analysis }) => { const row = analysis.entityRows.find(item => item.entity === entity); const coverage = row?.total ? row.covered / row.total * 100 : 100; return <td key={scenario.id} className="px-4 py-3"><div className="flex items-center justify-between"><b className="text-slate-700">{row?.covered ?? 0}/{row?.total ?? 0}</b><span className="text-[10px] text-slate-400">{Math.round(coverage)}% · {row?.inactive ?? 0} non attive</span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-rose-100"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${coverage}%` }} /></div></td>; })}</tr>{expanded && entityPositions.map(position => {
          const labels = columns.map(({ analysis }) => assignmentLabel(analysis.snapshots.get(position.code)));
          const differs = new Set(labels).size > 1;
          return <tr key={position.code} className={`border-t border-slate-100 ${differs ? "bg-amber-50/40" : "bg-slate-50/40"}`}><td className="px-4 py-3 pl-10"><div className="font-mono font-bold text-blue-700">{position.code}</div><div className="max-w-64 truncate text-slate-500">{position.title}</div>{differs && <span className="mt-1 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">Cambia tra scenari</span>}</td>{columns.map(({ scenario, analysis }, index) => { const snapshot = analysis.snapshots.get(position.code); return <td key={scenario.id} className="px-4 py-3"><div className={`font-semibold ${snapshot?.isInactive ? "text-slate-500" : snapshot?.isCovered ? "text-emerald-700" : "text-rose-700"}`}>{labels[index]}</div><div className="mt-0.5 text-[10px] text-slate-400">{snapshot?.isRealCovered ? "Scelta reale" : snapshot?.isSimulatedCovered ? "Scelta scenario" : snapshot?.isInactive ? "Decisione amministrativa" : `${snapshot?.availableCandidateIds.length ?? 0} alternative disponibili`}</div></td>; })}</tr>;
        })}</Fragment>;
      })}</tbody></table></div>
    </div>
  </div>;
};

export const SimulationDashboard = ({ candidates, positions, evaluations, researchId }: {
  key?: React.Key;
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
  const [view, setView] = useState<DashboardView>("priorities");
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
  const [configOpen, setConfigOpen] = useState(false);
  const [draftConfig, setDraftConfig] = useState<ScenarioConfig>(defaultScenarioConfig);
  const [candidateEntityFilter, setCandidateEntityFilter] = useState("");
  const [candidateRoleFilter, setCandidateRoleFilter] = useState("");

  useEffect(() => {
    localStorage.setItem(storageKey(researchId), JSON.stringify(scenarios));
  }, [researchId, scenarios]);
  useEffect(() => {
    if (!allScenarios.some(scenario => scenario.id === activeId)) setActiveId(allScenarios[0]?.id ?? "");
  }, [activeId, allScenarios]);

  const activeScenario = allScenarios.find(scenario => scenario.id === activeId) ?? allScenarios[0];
  const activeChoices = activeScenario?.choices ?? [];
  const activePositionStatuses = activeScenario?.positionStatuses ?? {};
  const baseAnalysis = useMemo(() => analyzeScenario([], candidates, positions, evaluations), [candidates, positions, evaluations]);
  const committedAnalysis = useMemo(() => analyzeScenario(activeChoices, candidates, positions, evaluations, activePositionStatuses), [activeChoices, candidates, positions, evaluations, activePositionStatuses]);
  const previewAnalysis = useMemo(() => previewChoice
    ? analyzeScenario(applyChoice(activeChoices, previewChoice), candidates, positions, evaluations, activePositionStatuses)
    : null, [previewChoice, activeChoices, candidates, positions, evaluations, activePositionStatuses]);
  const selectedChoice = activeChoices.find(choice => choice.id === selectedChoiceId) ?? null;
  const selectedChoiceBase = useMemo(() => selectedChoice
    ? analyzeScenario(activeChoices.filter(choice => choice.id !== selectedChoice.id), candidates, positions, evaluations, activePositionStatuses)
    : baseAnalysis, [selectedChoice, activeChoices, candidates, positions, evaluations, activePositionStatuses, baseAnalysis]);
  const changedPositionIds = useMemo(() => {
    const set = new Set<string>();
    committedAnalysis.snapshots.forEach((snapshot, code) => {
      const before = baseAnalysis.snapshots.get(code);
      if (before && (before.isCovered !== snapshot.isCovered || before.availableCandidateIds.length !== snapshot.availableCandidateIds.length)) set.add(code);
    });
    return set;
  }, [baseAnalysis, committedAnalysis]);
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

  const updatePositionStatus = (positionId: string, status: ManualPositionStatus | "") => {
    if (!activeScenario) return;
    const nextStatuses = { ...activePositionStatuses };
    if (status) nextStatuses[positionId] = status; else delete nextStatuses[positionId];
    const nextChoices = status ? activeChoices.filter(choice => choice.positionId !== positionId) : activeChoices;
    if (activeScenario.kind === "preset") {
      const id = `scenario-${Date.now()}`;
      setScenarios(current => [...current, { ...activeScenario, id, name: `${activeScenario.name} · variante`, kind: "custom", choices: nextChoices, positionStatuses: nextStatuses }]);
      setActiveId(id);
    } else {
      setScenarios(current => current.map(scenario => scenario.id === activeScenario.id ? { ...scenario, choices: nextChoices, positionStatuses: nextStatuses } : scenario));
    }
  };

  const requestChoice = (candidateId: string, positionId: string) => {
    const snapshot = committedAnalysis.snapshots.get(positionId);
    const evaluation = getEvaluation(evaluations, positionId, candidateId);
    if (!snapshot || snapshot.isInactive || snapshot.isRealCovered || !evaluation || blockedStatuses.has(evaluation.status)) return;
    const next = { id: choiceId(candidateId, positionId), candidateId, positionId };
    if (activeChoices.some(choice => choice.id === next.id)) {
      updateActiveChoices(activeChoices.filter(choice => choice.id !== next.id));
      setPreviewChoice(null);
      return;
    }
    const conflict = activeChoices.some(choice => choice.candidateId === candidateId || choice.positionId === positionId);
    if (conflict) setPendingReplacement(next);
    else updateActiveChoices([...activeChoices, next]);
    setPreviewChoice(null);
  };

  const createCustom = () => {
    const id = `scenario-${Date.now()}`;
    setScenarios(current => [...current, { id, name: `Scenario ${current.length + 1}`, description: "Scenario manuale", kind: "custom", choices: [], positionStatuses: {} }]);
    setActiveId(id);
    setScenarioMenuOpen(false);
  };
  const duplicateActive = () => {
    if (!activeScenario) return;
    const id = `scenario-${Date.now()}`;
    setScenarios(current => [...current, { ...activeScenario, id, name: `${activeScenario.name} · copia`, kind: "custom", choices: activeChoices.map(choice => ({ ...choice })) }]);
    setActiveId(id);
  };
  const generateProposal = () => {
    const id = `scenario-${Date.now()}`;
    const choices = buildConfiguredChoices(draftConfig, candidates, positions, evaluations);
    const noFeeding = draftConfig.proposeNoFeeding ? buildNoFeedingRecommendations(choices, candidates, positions, evaluations) : [];
    const positionStatuses = Object.fromEntries(noFeeding.map(code => [code, "non-alimentazione" as const]));
    setScenarios(current => [...current, { id, name: `Proposta ${current.length + 1}`, description: `Proposta automatica: ${choices.length} ripianamenti${noFeeding.length ? ` · ${noFeeding.length} non alimentazioni da validare` : ""}`, kind: "custom", choices, positionStatuses, config: draftConfig }]);
    setActiveId(id);
    setConfigOpen(false);
  };
  const deleteScenario = (id: string) => {
    setScenarios(current => current.filter(scenario => scenario.id !== id));
    if (activeId === id) setActiveId("preset-balanced");
  };

  const normalizedSearch = search.trim().toLocaleLowerCase("it");
  const visibleCandidates = candidates.filter(candidate => {
    if (candidateEntityFilter && candidate.serviceEntity !== candidateEntityFilter) return false;
    if (candidateRoleFilter && candidate.role !== candidateRoleFilter) return false;
    if (!normalizedSearch) return true;
    return [candidate.nominativo, candidate.id, candidate.rank, candidate.serviceEntity, candidate.role, candidate.category, candidate.specialty, candidate.languages.map(item => item.language).join(" ")].join(" ").toLocaleLowerCase("it").includes(normalizedSearch);
  });
  const visiblePositions = positions.filter(position => {
    if (!normalizedSearch) return true;
    return [position.code, position.title, position.entity].join(" ").toLocaleLowerCase("it").includes(normalizedSearch);
  });

  useEffect(() => { setPreviewChoice(null); }, [activeId, view, graphMode, selectedGraphId, pickerMode, compareOpen, pickerOpen]);
  useEffect(() => {
    const closePreview = () => setPreviewChoice(null);
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") closePreview(); };
    const onVisibilityChange = () => { if (document.hidden) closePreview(); };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("blur", closePreview);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("blur", closePreview);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const selectedSnapshot = selectedGraphId && graphMode === "positions" ? committedAnalysis.snapshots.get(selectedGraphId) : null;
  const selectedEntity = selectedGraphId && graphMode === "entities" ? committedAnalysis.entityRows.find(row => row.entity === selectedGraphId) : null;
  const snapshotList = Array.from(committedAnalysis.snapshots.values()) as PositionSnapshot[];

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
            {scenarios.length > 0 && <><div className="mt-2 border-t border-slate-100 px-3 pb-2 pt-3 text-[10px] font-bold uppercase tracking-wider text-slate-400">Scenari personali</div>{scenarios.map(scenario => <div key={scenario.id} className={`group flex items-center rounded-xl ${scenario.id === activeId ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}><button onClick={() => { setActiveId(scenario.id); setScenarioMenuOpen(false); setSelectedChoiceId(null); }} className="min-w-0 flex-1 px-3 py-2 text-left text-sm font-semibold"><span className="block truncate">{scenario.name}</span></button><button aria-label={`Elimina ${scenario.name}`} title="Elimina scenario" onClick={() => deleteScenario(scenario.id)} className="mr-2 rounded-lg p-1 text-slate-400 hover:bg-rose-100 hover:text-rose-600"><X className="h-4 w-4" /></button></div>)}</>}
            <button onClick={createCustom} className="mt-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-300 px-3 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-50"><Plus className="h-4 w-4" /> Nuovo scenario vuoto</button>
          </div>}
        </div>
        <button onClick={duplicateActive} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"><Copy className="h-4 w-4" /> Duplica</button>
        <button onClick={() => setConfigOpen(value => !value)} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${configOpen ? "border-violet-300 bg-violet-50 text-violet-700" : "border-slate-200 text-slate-600"}`}><SlidersHorizontal className="h-4 w-4" /> Genera proposta</button>
        <button onClick={() => setCompareOpen(value => !value)} className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold ${compareOpen ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}><GitCompareArrows className="h-4 w-4" /> Confronta</button>
        <div className="ml-auto flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700"><Lock className="h-3.5 w-3.5" /> Dati reali protetti</div>
      </header>

      {configOpen && <div className="border-b border-violet-100 bg-white px-6 py-4"><div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_1fr_1fr_auto]"><label className="text-xs font-bold text-slate-600">Cluster posizioni<input value={draftConfig.positionQuery} onChange={event => setDraftConfig(config => ({ ...config, positionQuery: event.target.value }))} placeholder="es. Genio, pilota, OSC…" className="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 font-normal" /></label><label className="text-xs font-bold text-slate-600">Soglia minima enti ({draftConfig.minimumEntityCoverage}%)<input type="range" min="0" max="100" step="5" value={draftConfig.minimumEntityCoverage} onChange={event => setDraftConfig(config => ({ ...config, minimumEntityCoverage: Number(event.target.value) }))} className="mt-3 block w-full" /></label><div className="space-y-2 text-xs text-slate-700"><label className="flex gap-2"><input type="checkbox" checked={draftConfig.preferNoForeignExperience} onChange={event => setDraftConfig(config => ({ ...config, preferNoForeignExperience: event.target.checked }))} /> Priorità senza esperienze estere</label><label className="flex gap-2"><input type="checkbox" checked={draftConfig.prioritizeEntityLevel} onChange={event => setDraftConfig(config => ({ ...config, prioritizeEntityLevel: event.target.checked }))} /> Priorità livello ente (3 &gt; 2 &gt; 1)</label><label className="flex gap-2"><input type="checkbox" checked={draftConfig.proposeNoFeeding ?? true} onChange={event => setDraftConfig(config => ({ ...config, proposeNoFeeding: event.target.checked }))} /> Proponi non alimentazione se non esistono candidati utilizzabili</label><p className="text-slate-400">Le non alimentazioni restano visibili e devono essere validate: non vengono conteggiate come posizioni ripianate.</p></div><button onClick={generateProposal} className="self-end rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700"><Sparkles className="mr-2 inline h-4 w-4" />Crea proposta</button></div></div>}

      <div className={`min-h-0 flex-1 p-4 ${compareOpen ? "overflow-auto" : "flex gap-4"}`}>
        {compareOpen ? <ScenarioComparison scenarios={allScenarios} candidates={candidates} positions={positions} evaluations={evaluations} candidateById={candidateById} /> : <>
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
              ["priorities", LayoutList, "Priorità"], ["coverage", LayoutList, "Copertura"], ["heatmap", Grid3X3, "Sovrapposizioni"], ["impact", GitCompareArrows, "Impatto"]
            ] as const).map(([value, Icon, label]) => <button key={value} onClick={() => setView(value)} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold transition-all ${view === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}><Icon className="h-4 w-4" /> {label}</button>)}</div>
            {view === "priorities" && <div className="ml-auto flex rounded-xl border border-slate-200 p-1"><button onClick={() => { setGraphMode("positions"); setSelectedGraphId(null); }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${graphMode === "positions" ? "bg-slate-900 text-white" : "text-slate-500"}`}>Posizioni</button><button onClick={() => { setGraphMode("entities"); setSelectedGraphId(null); }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${graphMode === "entities" ? "bg-slate-900 text-white" : "text-slate-500"}`}>Enti</button></div>}
          </div>
          <div data-testid="scenario-main-scroll" className="min-h-0 flex-1 overflow-auto p-4">
            {view === "priorities" && <DeterministicMap mode={graphMode} analysis={committedAnalysis} selectedId={selectedGraphId} changedPositionIds={changedPositionIds} onSelect={setSelectedGraphId} />}
            {view === "coverage" && <div className="space-y-3">{committedAnalysis.entityRows.map(row => <div key={row.entity} className="overflow-hidden rounded-2xl border border-slate-200"><button onClick={() => { setView("priorities"); setGraphMode("entities"); setSelectedGraphId(row.entity); }} className="flex w-full items-center gap-4 bg-slate-50 px-4 py-3 text-left"><Building2 className="h-5 w-5 text-slate-400" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-slate-800">{row.entity}</div><div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-blue-600 transition-all duration-500" style={{ width: `${row.total ? row.covered / row.total * 100 : 100}%` }} /></div></div><div className="text-right"><div className="text-sm font-bold text-slate-800">{row.covered}/{row.total}</div><div className="text-[10px] text-slate-400">ripianate</div></div></button><div className="divide-y divide-slate-100">{snapshotList.filter(snapshot => (snapshot.position.entity || "Ente non indicato") === row.entity).map(snapshot => <button key={snapshot.position.code} onClick={() => { setView("priorities"); setGraphMode("positions"); setSelectedGraphId(snapshot.position.code); }} className="grid w-full grid-cols-[90px_1fr_160px_110px] items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-blue-50/40"><span className="font-mono font-bold text-blue-700">{snapshot.position.code}</span><span className="truncate font-medium text-slate-700">{snapshot.position.title}</span><span className="truncate text-slate-500">{candidateById.get(snapshot.realCandidateId ?? snapshot.simulatedCandidateId ?? "")?.nominativo ?? "—"}</span><span className={`justify-self-end rounded-full px-2 py-1 font-bold ${snapshot.isInactive ? "bg-slate-100 text-slate-500" : snapshot.isRealCovered ? "bg-emerald-50 text-emerald-700" : snapshot.isSimulatedCovered ? "bg-blue-50 text-blue-700" : snapshot.isFragile ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700"}`}>{snapshot.isInactive ? "Non alimentata" : snapshot.isRealCovered ? "Reale" : snapshot.isSimulatedCovered ? "Scenario" : snapshot.isFragile ? "Fragile" : "Scoperta"}</span></button>)}</div></div>)}</div>}
            {view === "heatmap" && (() => {
              const relevant = snapshotList.filter(snapshot => !snapshot.isInactive && snapshot.availableCandidateIds.length > 0).sort((a, b) => b.availableCandidateIds.length - a.availableCandidateIds.length).slice(0, 28);
              return <div><div className="mb-4 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Le celle più intense indicano posizioni che condividono più candidati utilizzabili. Sono mostrate le 28 posizioni più connesse.</div><div className="overflow-auto"><table className="border-separate border-spacing-1 text-[10px]"><thead><tr><th className="sticky left-0 bg-white p-2 text-left text-slate-400">Posizione</th>{relevant.map(snapshot => <th key={snapshot.position.code} className="h-24 w-8 align-bottom"><span className="inline-block -rotate-55 whitespace-nowrap font-mono text-slate-500">{snapshot.position.code}</span></th>)}</tr></thead><tbody>{relevant.map(left => <tr key={left.position.code}><th className="sticky left-0 z-10 whitespace-nowrap bg-white p-2 text-left font-mono text-blue-700">{left.position.code}</th>{relevant.map(right => { const shared = left.position.code === right.position.code ? -1 : left.availableCandidateIds.filter(id => right.availableCandidateIds.includes(id)).length; return <td key={right.position.code}><button disabled={shared <= 0} onClick={() => { setView("priorities"); setGraphMode("positions"); setSelectedGraphId(left.position.code); }} title={shared < 0 ? left.position.code : `${left.position.code} ↔ ${right.position.code}: ${shared} candidati condivisi`} className={`h-8 w-8 rounded-md border transition-transform hover:scale-110 ${shared < 0 ? "border-slate-200 bg-slate-100" : shared === 0 ? "border-slate-100 bg-white" : shared === 1 ? "border-blue-100 bg-blue-100 text-blue-700" : shared === 2 ? "border-blue-200 bg-blue-300 text-blue-900" : "border-blue-500 bg-blue-600 text-white"}`}>{shared > 0 ? shared : ""}</button></td>; })}</tr>)}</tbody></table></div></div>;
            })()}
            {view === "impact" && <div className="space-y-6"><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{metricCards(committedAnalysis.metrics).map(card => <div key={card.label} className={`rounded-2xl border p-4 ${card.tone}`}><div className="text-xs font-bold uppercase tracking-wide opacity-75">{card.label}</div><div className="mt-1 text-3xl font-bold">{card.value}</div><div className="mt-1 text-xs opacity-70">{card.detail}</div></div>)}</div><ImpactPanel before={selectedChoice ? selectedChoiceBase : baseAnalysis} after={committedAnalysis} title={selectedChoice ? `${candidateById.get(selectedChoice.candidateId)?.nominativo} → ${selectedChoice.positionId}` : "Scenario completo"} subtitle={selectedChoice ? "Effetto isolato della scelta selezionata." : "Confronto fra la situazione reale e tutte le scelte dello scenario."} /></div>}
          </div>
        </section>

        <aside className="hidden w-72 shrink-0 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm xl:block">
          {selectedChoice ? <ImpactPanel before={selectedChoiceBase} after={committedAnalysis} title={`${candidateById.get(selectedChoice.candidateId)?.nominativo} → ${selectedChoice.positionId}`} subtitle="Impatto isolato della scelta nello scenario." /> : selectedSnapshot ? <div><div className="text-xs font-bold uppercase tracking-wider text-blue-600">Posizione</div><h3 className="mt-1 text-xl font-bold text-slate-900">{selectedSnapshot.position.code}</h3><p className="text-sm text-slate-600">{selectedSnapshot.position.title}</p><p className="mt-1 text-xs text-slate-400">{selectedSnapshot.position.entity}</p><div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase text-slate-400">Utilizzabili</div><div className="text-xl font-bold text-slate-800">{selectedSnapshot.availableCandidateIds.length}</div></div><div className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase text-slate-400">Stato</div><div className="mt-1 text-xs font-bold text-slate-700">{selectedSnapshot.isRealCovered ? "Ripianata" : selectedSnapshot.isSimulatedCovered ? "Scenario" : selectedSnapshot.manualStatus === "estensione-mandato-titolare" ? "Estensione mandato" : selectedSnapshot.isInactive ? "Non alimentata" : "Scoperta"}</div></div></div><div className="mt-5 text-xs font-bold uppercase tracking-wider text-slate-400">Persone segnalate</div><div className="mt-2 space-y-2">{selectedSnapshot.baseAvailableCandidateIds.map(candidateId => { const candidate = candidateById.get(candidateId); const evalItem = getEvaluation(evaluations, selectedSnapshot.position.code, candidateId); return <button aria-label={`Anteprima ${candidate?.nominativo} per ${selectedSnapshot.position.code}`} key={candidateId} onPointerEnter={() => setPreviewChoice({ id: choiceId(candidateId, selectedSnapshot.position.code), candidateId, positionId: selectedSnapshot.position.code })} onPointerLeave={() => setPreviewChoice(null)} onFocus={() => setPreviewChoice({ id: choiceId(candidateId, selectedSnapshot.position.code), candidateId, positionId: selectedSnapshot.position.code })} onBlur={() => setPreviewChoice(null)} onClick={() => requestChoice(candidateId, selectedSnapshot.position.code)} className="flex w-full items-center gap-2 rounded-xl border border-slate-200 p-2 text-left hover:border-blue-300 hover:bg-blue-50"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100"><UserRound className="h-4 w-4 text-slate-500" /></div><div className="min-w-0 flex-1"><div className="truncate text-xs font-bold text-slate-800">{candidate?.nominativo}</div><div className="text-[10px] text-slate-400">Compatibilità {getFit(selectedSnapshot.position, evalItem)}%</div></div><Plus className="h-4 w-4 text-blue-600" /></button>; })}</div>{previewChoice && previewAnalysis && <div className="mt-5 border-t border-slate-200 pt-5" data-testid="position-preview-impact"><ImpactPanel before={committedAnalysis} after={previewAnalysis} title="Anteprima" subtitle={`${candidateById.get(previewChoice.candidateId)?.nominativo} → ${previewChoice.positionId}`} /></div>}</div> : selectedEntity ? <div><div className="text-xs font-bold uppercase tracking-wider text-blue-600">Ente</div><h3 className="mt-1 text-lg font-bold text-slate-900">{selectedEntity.entity}</h3><div className="mt-5 grid grid-cols-2 gap-2">{[["Ripianate", selectedEntity.covered], ["Da ripianare", selectedEntity.total], ["Fragili", selectedEntity.fragile], ["Non alimentate", selectedEntity.inactive]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><div className="text-[10px] uppercase text-slate-400">{label}</div><div className="text-xl font-bold text-slate-800">{value}</div></div>)}</div></div> : <ImpactPanel before={baseAnalysis} after={committedAnalysis} title="Scenario completo" subtitle="Clicca una scelta, un ente o una posizione per approfondire." />}
        </aside>
        </>}
      </div>

      {pickerOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-5 backdrop-blur-sm" onPointerDown={event => { if (event.target === event.currentTarget) { setPickerOpen(false); setPreviewChoice(null); } }}><div className="flex h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/40 bg-white shadow-2xl">
        <div className="flex items-center gap-4 border-b border-slate-200 px-6 py-4"><div><h2 className="text-lg font-bold text-slate-900">Aggiungi una scelta</h2><p className="text-xs text-slate-400">Compatibilità e valutazioni sono già incluse. Riclicca una scelta attiva per toglierla.</p></div><div className="ml-auto flex rounded-xl bg-slate-100 p-1"><button onClick={() => setPickerMode("people")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${pickerMode === "people" ? "bg-white shadow-sm" : "text-slate-500"}`}><Users className="h-4 w-4" /> Persone</button><button onClick={() => setPickerMode("positions")} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold ${pickerMode === "positions" ? "bg-white shadow-sm" : "text-slate-500"}`}><Building2 className="h-4 w-4" /> Posizioni</button></div><button onClick={() => { setPickerOpen(false); setPreviewChoice(null); }} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button></div>
        <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-0 min-w-0 flex-col border-r border-slate-200"><div className="space-y-2 p-4"><label className="relative block"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input autoFocus value={search} onChange={event => setSearch(event.target.value)} placeholder={pickerMode === "people" ? "Cerca persona, matricola o ente…" : "Cerca posizione o ente…"} className="w-full rounded-xl border border-slate-200 py-2.5 pl-10 pr-4 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" /></label>{pickerMode === "people" && <div className="flex gap-2"><select value={candidateEntityFilter} onChange={event => setCandidateEntityFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"><option value="">Tutti gli enti di provenienza</option>{Array.from(new Set(candidates.map(candidate => candidate.serviceEntity).filter(Boolean))).sort().map(value => <option key={value}>{value}</option>)}</select><select value={candidateRoleFilter} onChange={event => setCandidateRoleFilter(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-1.5 text-xs"><option value="">Tutti i ruoli</option>{Array.from(new Set(candidates.map(candidate => candidate.role).filter(Boolean))).sort().map(value => <option key={value}>{value}</option>)}</select></div>}</div><div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {pickerMode === "people" ? visibleCandidates.map(candidate => {
              const applicable = positions.filter(position => {
                const evaluation = getEvaluation(evaluations, position.code, candidate.id);
                const snapshot = committedAnalysis.snapshots.get(position.code);
                return evaluation && !blockedStatuses.has(evaluation.status) && snapshot && !snapshot.isInactive && !snapshot.isRealCovered;
              });
              if (!applicable.length) return null;
              return <div key={candidate.id} className="rounded-2xl border border-slate-200 p-3"><div className="flex items-start gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100"><UserRound className="h-4 w-4 text-slate-500" /></div><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold text-slate-800">{candidate.nominativo} <span className="font-mono text-[10px] font-normal text-slate-400">{candidate.id}</span></div><div className="mt-1 flex flex-wrap gap-1 text-[10px] text-slate-600">{[candidate.rank, candidate.role, [candidate.category, candidate.specialty].filter(Boolean).join("/"), candidate.serviceEntity, candidate.languages.map(language => `${language.language} ${language.level}`).join(", ")].filter(Boolean).map(value => <span key={value} className="rounded bg-slate-100 px-1.5 py-0.5">{value}</span>)}</div><div className="mt-1 text-[10px] text-slate-400">Esperienze estere: {candidate.internationalMandates || "nessuna"}</div></div></div><div className="mt-3 flex flex-wrap gap-2">{applicable.map(position => { const current = activeChoices.find(choice => choice.positionId === position.code); const evaluation = getEvaluation(evaluations, position.code, candidate.id); return <CandidateChoice key={position.code} candidate={candidate} position={position} evaluation={evaluation} selected={current?.candidateId === candidate.id} occupied={!!current && current.candidateId !== candidate.id} onPreview={active => setPreviewChoice(active ? { id: choiceId(candidate.id, position.code), candidateId: candidate.id, positionId: position.code } : null)} onChoose={() => requestChoice(candidate.id, position.code)} />; })}</div></div>;
            }) : visiblePositions.map(position => {
              const snapshot = committedAnalysis.snapshots.get(position.code);
              if (!snapshot || snapshot.isRealCovered || (snapshot.isInactive && !activePositionStatuses[position.code])) return null;
              return <div key={position.code} className="rounded-2xl border border-slate-200 p-3"><div className="flex items-start gap-3"><span className="rounded-lg bg-blue-50 px-2 py-1 font-mono text-xs font-bold text-blue-700">{position.code}</span><div className="min-w-0"><div className="truncate text-sm font-bold text-slate-800">{position.title}</div><div className="truncate text-xs text-slate-400">{position.entity} · {snapshot.baseAvailableCandidateIds.length} utilizzabili</div></div><label className="ml-auto shrink-0"><span className="sr-only">Stato manuale</span><select value={activePositionStatuses[position.code] ?? ""} onChange={event => updatePositionStatus(position.code, event.target.value as ManualPositionStatus | "")} className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-[11px] font-semibold text-slate-600 outline-none focus:border-blue-400"><option value="">Stato posizione…</option><option value="non-alimentazione">Non alimentazione</option><option value="estensione-mandato-titolare">Estensione mandato titolare</option></select></label></div><div className="mt-3 flex flex-wrap gap-2">{snapshot.baseAvailableCandidateIds.map(candidateId => { const candidate = candidateById.get(candidateId); const current = activeChoices.find(choice => choice.positionId === position.code); const evaluation = getEvaluation(evaluations, position.code, candidateId); if (!candidate) return null; return <CandidateChoice key={candidateId} candidate={candidate} position={position} evaluation={evaluation} selected={current?.candidateId === candidateId} occupied={!!current && current.candidateId !== candidateId} onPreview={active => setPreviewChoice(active ? { id: choiceId(candidateId, position.code), candidateId, positionId: position.code } : null)} onChoose={() => requestChoice(candidateId, position.code)} />; })}</div></div>;
            })}
          </div></div>
          <div className="overflow-y-auto bg-slate-50 p-5">{previewChoice ? <ImpactPanel before={committedAnalysis} after={previewAnalysis!} title={`${candidateById.get(previewChoice.candidateId)?.nominativo} → ${previewChoice.positionId}`} subtitle="Anteprima: nessuna modifica ancora applicata." /> : <div className="flex h-full flex-col items-center justify-center text-center"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm"><Sparkles className="h-5 w-5 text-blue-600" /></div><h3 className="mt-4 text-sm font-bold text-slate-700">Anteprima immediata</h3><p className="mt-1 max-w-52 text-xs leading-relaxed text-slate-400">Passa su una persona o posizione per vedere cosa cambia prima di scegliere.</p></div>}</div>
        </div>
      </div></div>}

      {pendingReplacement && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/40 p-4"><div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50"><AlertTriangle className="h-5 w-5 text-amber-600" /></div><h3 className="mt-4 text-lg font-bold text-slate-900">Sostituire la scelta esistente?</h3><p className="mt-2 text-sm text-slate-500">La persona o la posizione è già usata nello scenario. La nuova scelta sostituirà automaticamente quella precedente.</p><div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><strong>{candidateById.get(pendingReplacement.candidateId)?.nominativo}</strong><span className="mx-2 text-blue-500">→</span><strong className="font-mono text-blue-700">{pendingReplacement.positionId}</strong></div><div className="mt-6 flex justify-end gap-2"><button onClick={() => setPendingReplacement(null)} className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">Annulla</button><button onClick={() => { updateActiveChoices(applyChoice(activeChoices, pendingReplacement)); setPendingReplacement(null); }} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700">Sostituisci</button></div></div></div>}
    </div>
  );
};
