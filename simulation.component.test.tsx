// @vitest-environment jsdom
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { SimulationDashboard } from "./simulation";
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
});
