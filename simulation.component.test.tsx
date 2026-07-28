// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeScenario, PositionDetailPanel, SimulationDashboard, type SimulationChoice } from "./simulation";
import type { Candidate, Evaluation, Position } from "./index";

const makePosition = (code: string, entity: string): Position => ({
  code, entity, title: `Incarico ${code}`, requirements: [], englishReq: "", nosReq: "", rankReq: "",
  catSpecQualReq: "", ofcn: "", poInterest: "", incumbent: "", role: "", plannedPersonnel: "",
  turnoverDate: "", originalData: {}
});
const makeCandidate = (id: string, appliedPositionCodes: string[]): Candidate => ({
  id, nominativo: `Candidato ${id}`, firstName: id, lastName: "", rank: "", role: "", category: "",
  specialty: "", serviceEntity: "", nosLevel: "", nosQual: "", nosExpiry: "", internationalMandates: "",
  feoDate: "", mixDescription: "", languages: [], rawAppliedString: appliedPositionCodes.join(","),
  appliedPositionCodes, commanderOpinion: "", specificAssignments: "", ofcnSuitability: "", globalNotes: "", originalData: {}
});
const makeEvaluation = (candidateId: string, positionId: string): Evaluation => ({
  candidateId, positionId, status: "pending", reqEvaluations: {}, notes: ""
});

afterEach(cleanup);

describe("SimulationDashboard preview isolation", () => {
  beforeEach(() => localStorage.clear());

  it("keeps position order, scroll, selection and main content stable while previewing a candidate", () => {
    const positions = [makePosition("P1", "Ente A"), makePosition("P2", "Ente B")];
    const candidates = [makeCandidate("C1", ["P1", "P2"]), makeCandidate("C2", ["P1"])];
    const evaluations = {
      P1_C1: makeEvaluation("C1", "P1"), P2_C1: makeEvaluation("C1", "P2"), P1_C2: makeEvaluation("C2", "P1")
    };
    render(<SimulationDashboard candidates={candidates} positions={positions} evaluations={evaluations} researchId="preview-test" />);

    const main = screen.getByTestId("scenario-main-scroll");
    const orderBefore = Array.from(main.querySelectorAll('[data-testid^="position-row-"]')).map(row => row.getAttribute("data-testid"));
    fireEvent.click(screen.getByTestId("position-row-P1"));
    Object.defineProperty(main, "scrollTop", { value: 137, writable: true });
    const contentBefore = main.textContent;
    const sourceButton = screen.getByRole("button", { name: /Anteprima Candidato C1 per P1/ });

    fireEvent.pointerEnter(sourceButton);
    expect(screen.getByTestId("position-preview-impact")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "P1" })).toBeTruthy();
    expect(main.textContent).toBe(contentBefore);
    expect(main.scrollTop).toBe(137);
    expect(Array.from(main.querySelectorAll('[data-testid^="position-row-"]')).map(row => row.getAttribute("data-testid"))).toEqual(orderBefore);
    expect(screen.getByTestId("position-row-P1").className).toContain("bg-blue-50");

    fireEvent.pointerLeave(sourceButton);
    expect(screen.queryByTestId("position-preview-impact")).toBeNull();
    expect(screen.getByRole("heading", { name: "P1" })).toBeTruthy();
    expect(main.textContent).toBe(contentBefore);
    expect(main.scrollTop).toBe(137);
  });

  it("separa l'approfondimento dall'azione che modifica lo scenario", () => {
    const positions = [makePosition("P1", "Ente A")];
    const candidates = [makeCandidate("C1", ["P1"])];
    const evaluations = { P1_C1: makeEvaluation("C1", "P1") };
    render(<SimulationDashboard candidates={candidates} positions={positions} evaluations={evaluations} researchId="inspect-test" />);

    fireEvent.click(screen.getByTestId("position-row-P1"));
    expect(screen.getByText("1 scelte · Predefinito")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Anteprima Candidato C1 per P1" }));

    expect(screen.getByTestId("candidate-detail-panel")).toBeTruthy();
    expect(screen.getByText("Candidato selezionato")).toBeTruthy();
    expect(screen.getByText("1 scelte · Predefinito")).toBeTruthy();
    fireEvent.click(screen.getByTestId("candidate-detail-panel").querySelector('[aria-label="Rimuovi Candidato C1 dallo scenario per P1"]')!);
    expect(screen.getByText("0 scelte · Personale")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Assegna Candidato C1 allo scenario per P1" })).toBeTruthy();
  });

  it("applica più ruoli all'intero Lab e alle statistiche senza creare una proposta", () => {
    const naviganti = makePosition("NAV-1", "Ente A");
    naviganti.role = "Naviganti";
    const genio = makePosition("GEN-1", "Ente B");
    genio.role = "Genio";
    const commissari = makePosition("COM-1", "Ente C");
    commissari.role = "Commissari";
    render(<SimulationDashboard candidates={[]} positions={[naviganti, genio, commissari]} evaluations={{}} researchId="role-scope-test" />);

    fireEvent.click(screen.getByRole("button", { name: "Genera proposta" }));
    fireEvent.click(screen.getByRole("button", { name: "Tutti i ruoli" }));
    fireEvent.click(screen.getByLabelText(/Genio/));
    fireEvent.click(screen.getByLabelText(/Commissari/));

    expect(screen.queryByTestId("position-row-NAV-1")).toBeNull();
    expect(screen.getByTestId("position-row-GEN-1")).toBeTruthy();
    expect(screen.getByTestId("position-row-COM-1")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Genera proposta · 2 ruoli/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Impatto" }));
    const uncoveredCard = screen.getByText("Scoperte").parentElement!;
    expect(uncoveredCard.textContent).toContain("2");
    expect(uncoveredCard.textContent).toContain("posizioni attive");
  });
});

describe("PositionDetailPanel", () => {
  const renderPanel = ({ position = makePosition("P1", "Ente elevato 2"), candidates = [makeCandidate("C1", ["P1"])], evaluations = { P1_C1: makeEvaluation("C1", "P1") } as Record<string, Evaluation>, choices = [] as SimulationChoice[], scenario = { id: "manual", name: "Manuale", description: "Scenario manuale", kind: "custom", choices: [] } }: any = {}) => {
    position.role = "Direttivo";
    position.rankReq = "Grado OF-3";
    const analysis = analyzeScenario(choices, candidates, [position], evaluations);
    render(<PositionDetailPanel snapshot={analysis.snapshots.get(position.code)!} candidates={candidates} positions={[position]} evaluations={evaluations} activeChoices={choices} scenario={{ ...scenario, choices }} previewChoice={null} previewAnalysis={null} committedAnalysis={analysis} onPreview={() => undefined} onChoose={() => undefined} />);
  };

  it("mostra identità e candidato per una posizione reale", () => {
    const evaluation = { ...makeEvaluation("C1", "P1"), status: "selected" as const };
    renderPanel({ evaluations: { P1_C1: evaluation } });
    expect(screen.getByText("Scelta reale")).toBeTruthy();
    expect(screen.getAllByText("Candidato C1").length).toBeGreaterThan(0);
    expect(screen.getByText("Direttivo")).toBeTruthy();
    expect(screen.getByText("Grado OF-3")).toBeTruthy();
  });

  it("indica una scelta generata da preset e i criteri deterministici", () => {
    const choices = [{ id: "C1::P1", candidateId: "C1", positionId: "P1" }];
    renderPanel({ choices, scenario: { id: "preset-balanced", name: "Equilibrio", description: "Preset", kind: "preset" } });
    expect(screen.getByText("Scelta scenario")).toBeTruthy();
    expect(screen.getByText(/Origine: Preset \/ proposta automatica/)).toBeTruthy();
    expect(screen.getByText(/compatibilità requisiti/)).toBeTruthy();
    expect(screen.getByText(/posizioni contendibili/)).toBeTruthy();
  });

  it("distingue una scelta manuale", () => {
    const choices = [{ id: "C1::P1", candidateId: "C1", positionId: "P1" }];
    renderPanel({ choices });
    expect(screen.getByText("Origine: Scenario manuale")).toBeTruthy();
  });

  it("descrive una posizione scoperta e classifica i candidati esclusi", () => {
    const evaluation = { ...makeEvaluation("C1", "P1"), status: "non-compatible" as const };
    renderPanel({ evaluations: { P1_C1: evaluation } });
    expect(screen.getByText("Attiva · scoperta")).toBeTruthy();
    expect(screen.getByText("Escluso / non compatibile")).toBeTruthy();
    expect(screen.getByText(/Nessuna assegnazione/)).toBeTruthy();
  });

  it("gestisce una posizione senza candidati", () => {
    renderPanel({ candidates: [], evaluations: {} });
    expect(screen.getByText("Nessun candidato disponibile o valutato per questa posizione.")).toBeTruthy();
    expect(screen.getByText(/bacino utilizzabile di base/)).toBeTruthy();
  });
});
