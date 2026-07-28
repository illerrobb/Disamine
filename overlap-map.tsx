import React, { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Building2, Info, X } from "lucide-react";
import type { Candidate, Evaluation, Position } from "./index";
import type { PositionSnapshot, SimulationChoice } from "./simulation";

export type OverlapMode = "positions" | "entities";

export interface OverlapItem {
  id: string;
  label: string;
  positionIds: string[];
  candidateIds: string[];
  risk: number;
}

export interface OverlapCell {
  left: OverlapItem;
  right: OverlapItem;
  sharedCandidateIds: string[];
  poolA: number;
  poolB: number;
  percentage: number;
}

export const calculateSharedUsableCandidates = (poolA: readonly string[], poolB: readonly string[]) => {
  const right = new Set(poolB);
  return Array.from(new Set(poolA)).filter(id => right.has(id));
};

export const calculatePoolSizes = (poolA: readonly string[], poolB: readonly string[]) => ({
  poolA: new Set(poolA).size,
  poolB: new Set(poolB).size
});

export const calculateContentionPercentage = (shared: number, poolA: number, poolB: number) => {
  const denominator = Math.min(poolA, poolB);
  return denominator ? Math.round(shared / denominator * 100) : 0;
};

export const calculateEngagedCandidateIds = (snapshots: readonly PositionSnapshot[]) => Array.from(new Set(snapshots.flatMap(snapshot =>
  [snapshot.realCandidateId, snapshot.simulatedCandidateId].filter((id): id is string => !!id)
)));

export const calculateAffectedPositions = (candidateId: string, left: OverlapItem, right: OverlapItem, snapshots: Map<string, PositionSnapshot>) => ({
  left: left.positionIds.filter(id => snapshots.get(id)?.availableCandidateIds.includes(candidateId)),
  right: right.positionIds.filter(id => snapshots.get(id)?.availableCandidateIds.includes(candidateId))
});

export const buildOverlapCell = (left: OverlapItem, right: OverlapItem): OverlapCell => {
  const sharedCandidateIds = calculateSharedUsableCandidates(left.candidateIds, right.candidateIds);
  const { poolA, poolB } = calculatePoolSizes(left.candidateIds, right.candidateIds);
  return { left, right, sharedCandidateIds, poolA, poolB, percentage: calculateContentionPercentage(sharedCandidateIds.length, poolA, poolB) };
};

export const buildOverlapItems = (snapshots: Map<string, PositionSnapshot>, mode: OverlapMode): OverlapItem[] => {
  const active = Array.from(snapshots.values()).filter(snapshot => !snapshot.isInactive && snapshot.availableCandidateIds.length > 0);
  const groups = new Map<string, PositionSnapshot[]>();
  active.forEach(snapshot => {
    const id = mode === "positions" ? snapshot.position.code : snapshot.position.entity || "Ente non indicato";
    groups.set(id, [...(groups.get(id) ?? []), snapshot]);
  });
  const items = Array.from(groups, ([id, values]) => ({
    id,
    label: id,
    positionIds: values.map(value => value.position.code),
    candidateIds: Array.from(new Set(values.flatMap(value => value.availableCandidateIds))),
    risk: 0
  }));
  items.forEach(item => {
    item.risk = Math.max(0, ...items.filter(other => other.id !== item.id).map(other => buildOverlapCell(item, other).percentage));
  });
  return items.sort((a, b) => b.risk - a.risk || a.label.localeCompare(b.label, "it"));
};

const risk = (percentage: number) => percentage >= 67
  ? { label: "Alto", color: "border-red-300 bg-red-100 text-red-900" }
  : percentage >= 34 ? { label: "Medio", color: "border-amber-300 bg-amber-100 text-amber-900" }
    : percentage > 0 ? { label: "Basso", color: "border-emerald-300 bg-emerald-100 text-emerald-900" }
      : { label: "Nessuno", color: "border-slate-200 bg-slate-50 text-slate-500" };

const evaluationFor = (evaluations: Record<string, Evaluation>, positionId: string, candidateId: string) => evaluations[`${positionId}_${candidateId}`];

const candidateState = (candidateId: string, positions: string[], snapshots: Map<string, PositionSnapshot>, evaluations: Record<string, Evaluation>) => {
  if (positions.some(id => snapshots.get(id)?.realCandidateId === candidateId)) return "scelta reale";
  if (positions.some(id => snapshots.get(id)?.simulatedCandidateId === candidateId)) return "scelta nello scenario";
  if (positions.some(id => evaluationFor(evaluations, id, candidateId)?.status === "reserve")) return "riserva";
  if (positions.some(id => ["excluded", "withdrawn", "non-compatible", "rejected"].includes(evaluationFor(evaluations, id, candidateId)?.status ?? ""))) return "non più utilizzabile";
  return "libera";
};

export const OverlapDetailModal = ({ cell, mode, candidates, positions, snapshots, evaluations, onClose, onNavigate }: {
  cell: OverlapCell;
  mode: OverlapMode;
  candidates: Candidate[];
  positions: Position[];
  snapshots: Map<string, PositionSnapshot>;
  evaluations: Record<string, Evaluation>;
  onClose: () => void;
  onNavigate: (mode: OverlapMode, id: string) => void;
}) => {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = previous; };
  }, [onClose]);
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const title = `${mode === "positions" ? "Posizione" : "Ente"} ${cell.left.label} ↔ ${mode === "positions" ? "Posizione" : "Ente"} ${cell.right.label}`;
  const directionalA = cell.poolA ? Math.round(cell.sharedCandidateIds.length / cell.poolA * 100) : 0;
  const directionalB = cell.poolB ? Math.round(cell.sharedCandidateIds.length / cell.poolB * 100) : 0;
  const fragileA = Math.max(0, cell.poolA - 1);
  const fragileB = Math.max(0, cell.poolB - 1);
  const critical = cell.sharedCandidateIds.length && (fragileA === 0 || fragileB === 0);
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 p-4" onMouseDown={event => event.target === event.currentTarget && onClose()}>
    <div role="dialog" aria-modal="true" aria-labelledby="overlap-detail-title" className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl">
      <header className="flex items-start gap-4 border-b border-slate-200 p-5"><div className="min-w-0 flex-1"><div className="text-xs font-bold uppercase tracking-wide text-blue-600">Analisi della contesa</div><h2 id="overlap-detail-title" className="mt-1 text-xl font-bold text-slate-900">{title}</h2></div><button ref={closeRef} aria-label="Chiudi" onClick={onClose} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        <section className={`rounded-2xl border p-4 ${risk(cell.percentage).color}`}><div className="text-xs font-bold uppercase">Rischio {risk(cell.percentage).label}</div><div className="mt-1 text-3xl font-bold">{cell.percentage}%</div><p className="mt-1 text-sm">{cell.sharedCandidateIds.length} candidati condivisi su {cell.poolA}/{cell.poolB} disponibili.</p></section>
        <p className="text-sm text-slate-600">{cell.left.label} dipende per il {directionalA}% da persone disponibili anche per {cell.right.label}. L'impatto inverso è del {directionalB}%.</p>
        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-500">Condivisi / bacino A</div><b className="text-2xl text-slate-900">{directionalA}%</b></div><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs font-bold text-slate-500">Condivisi / bacino B</div><b className="text-2xl text-slate-900">{directionalB}%</b></div></div>
        {(fragileA === 0 || fragileB === 0) && <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800"><AlertTriangle className="h-5 w-5 shrink-0" /> Una scelta su un lato rischia di lasciare l'altro senza alternative.</div>}
        <section><h3 className="font-bold text-slate-900">Candidati condivisi</h3><div className="mt-2 space-y-3">{cell.sharedCandidateIds.map(id => {
          const person = byId.get(id);
          const affected = calculateAffectedPositions(id, cell.left, cell.right, snapshots);
          const relevantPositions = [...affected.left, ...affected.right];
          const reasons = relevantPositions.flatMap(positionId => {
            const position = snapshots.get(positionId)?.position;
            const evaluation = evaluationFor(evaluations, positionId, id);
            const yes = position?.requirements.filter(req => evaluation?.reqEvaluations[req.id] === "yes").map(req => req.text) ?? [];
            return yes.length ? yes.map(text => `${positionId}: ${text}`) : [`${positionId}: valutazione ${evaluation?.status ?? "disponibile"}`];
          });
          return <article key={id} className={`rounded-2xl border p-4 ${critical ? "border-red-200" : "border-slate-200"}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-bold text-slate-900">{person?.nominativo ?? id} <span className="font-mono text-xs font-normal text-slate-400">{id}</span></div><div className="text-xs text-slate-500">{[person?.rank, person?.role, person?.serviceEntity].filter(Boolean).join(" · ") || "Grado, ruolo ed ente non indicati"}</div></div><span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-bold">{candidateState(id, relevantPositions, snapshots, evaluations)}</span></div><div className="mt-2 text-xs text-slate-600"><b>Compatibilità A:</b> {affected.left.join(", ")} · <b>Compatibilità B:</b> {affected.right.join(", ")}</div><div className="mt-1 text-xs text-slate-500"><b>Requisiti / valutazioni:</b> {reasons.join("; ")}</div>{mode === "entities" && <div className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-800"><b>Posizioni interessate:</b> {affected.left.join(", ")} ↔ {affected.right.join(", ")}</div>}{critical && <div className="mt-2 text-xs font-bold text-red-700">Candidato critico: non risultano sostituti equivalenti su almeno un lato.</div>}</article>;
        })}</div></section>
        <section className="rounded-2xl border border-slate-200 p-4"><h3 className="font-bold text-slate-900">Impatto potenziale</h3><p className="mt-2 text-sm text-slate-600">Assegnando un candidato condiviso resterebbero {fragileA} alternative per {cell.left.label} e {fragileB} per {cell.right.label}.</p>{critical ? <p className="mt-2 text-sm font-semibold text-red-700">Le posizioni con un solo candidato diventerebbero fragili o scoperte.</p> : <p className="mt-2 text-sm text-slate-500">La sovrapposizione è numerosa, ma restano alternative: non rappresenta necessariamente un rischio reale.</p>}</section>
      </div>
      <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 p-4"><button onClick={() => onNavigate(mode, cell.left.id)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold">{mode === "positions" ? "Apri posizione A" : "Esamina ente A"}</button><button onClick={() => onNavigate(mode, cell.right.id)} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold">{mode === "positions" ? "Apri posizione B" : "Esamina ente B"}</button><button onClick={onClose} className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-bold text-white">Chiudi</button></footer>
    </div>
  </div>;
};

export const OverlapMap = ({ snapshots, candidates, positions, evaluations, choices: _choices, onNavigate }: {
  snapshots: Map<string, PositionSnapshot>;
  candidates: Candidate[];
  positions: Position[];
  evaluations: Record<string, Evaluation>;
  choices: SimulationChoice[];
  onNavigate: (mode: OverlapMode, id: string) => void;
}) => {
  const [mode, setMode] = useState<OverlapMode>("positions");
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<OverlapCell | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const items = useMemo(() => buildOverlapItems(snapshots, mode), [snapshots, mode]);
  const visible = (showAll ? items : items.filter(item => item.risk > 0)).slice(0, 28);
  const close = () => { setSelected(null); requestAnimationFrame(() => triggerRef.current?.focus()); };
  return <div>
    <div className="mb-4 flex flex-wrap items-center gap-3"><div className="flex rounded-xl border border-slate-200 p-1"><button aria-pressed={mode === "positions"} onClick={() => { setMode("positions"); setSelected(null); }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${mode === "positions" ? "bg-slate-900 text-white" : "text-slate-500"}`}>Posizioni</button><button aria-pressed={mode === "entities"} onClick={() => { setMode("entities"); setSelected(null); }} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${mode === "entities" ? "bg-slate-900 text-white" : "text-slate-500"}`}>Enti</button></div><label className="flex items-center gap-2 text-xs font-semibold text-slate-600"><input type="checkbox" checked={showAll} onChange={event => setShowAll(event.target.checked)} /> Mostra anche senza contese</label></div>
    <div className="mb-4 flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><Info className="mt-0.5 h-4 w-4 shrink-0" /> Percentuale di candidati condivisi rispetto al bacino più piccolo. Elementi ordinati per rischio massimo.</div>
    <div aria-label="Legenda rischio" className="mb-4 flex flex-wrap gap-3 text-xs">{[["Nessuna", "0%", "bg-slate-100"], ["Bassa", "1–33%", "bg-emerald-300"], ["Media", "34–66%", "bg-amber-300"], ["Alta", "67–100%", "bg-red-300"]].map(([label, threshold, color]) => <span key={label} className="flex items-center gap-1.5"><i className={`h-3 w-3 rounded ${color}`} /> {label}: {threshold}</span>)}</div>
    {!visible.length ? <div className="rounded-2xl border border-dashed border-slate-200 p-10 text-center"><Building2 className="mx-auto h-8 w-8 text-slate-300" /><h3 className="mt-3 font-bold text-slate-700">Nessuna contesa</h3><p className="mt-1 text-sm text-slate-500">Non esistono candidati utilizzabili condivisi tra {mode === "positions" ? "le posizioni" : "gli enti"}.</p></div> : <div className="overflow-auto"><table className="border-separate border-spacing-1 text-[10px]"><thead><tr><th className="sticky left-0 bg-white p-2 text-left text-slate-400">{mode === "positions" ? "Posizione" : "Ente"}</th>{visible.map(item => <th key={item.id} className="h-24 w-12 align-bottom"><span className="inline-block -rotate-55 whitespace-nowrap text-slate-500">{item.label}</span></th>)}</tr></thead><tbody>{visible.map(left => <tr key={left.id}><th className="sticky left-0 z-10 whitespace-nowrap bg-white p-2 text-left font-semibold text-blue-700">{left.label}</th>{visible.map(right => { const cell = buildOverlapCell(left, right); const diagonal = left.id === right.id; return <td key={right.id}><button disabled={diagonal || !cell.sharedCandidateIds.length} aria-label={diagonal ? left.label : `${left.label} ↔ ${right.label}: ${cell.percentage}% (${cell.sharedCandidateIds.length} condivisi)`} onClick={event => { triggerRef.current = event.currentTarget; setSelected(cell); }} className={`h-10 w-11 rounded-md border leading-tight ${diagonal ? "border-slate-200 bg-slate-100" : risk(cell.percentage).color}`}><b className="block text-xs">{!diagonal ? `${cell.percentage}%` : ""}</b>{!diagonal && <small>{cell.sharedCandidateIds.length}</small>}</button></td>; })}</tr>)}</tbody></table></div>}
    {selected && <OverlapDetailModal cell={selected} mode={mode} candidates={candidates} positions={positions} snapshots={snapshots} evaluations={evaluations} onClose={close} onNavigate={(nextMode, id) => { setSelected(null); onNavigate(nextMode, id); }} />}
  </div>;
};
