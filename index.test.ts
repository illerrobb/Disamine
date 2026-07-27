import { describe, expect, it } from "vitest";
import {
  getImportDiffs,
  integrateImportedEntity,
  mergeCandidateForImport,
  type AppData,
  type Candidate,
  type Position
} from "./index";

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "C1", nominativo: "Rossi Mario", firstName: "Mario", lastName: "Rossi",
  rank: "Cap.", role: "Ruolo", category: "Cat", specialty: "Spec", serviceEntity: "Ente",
  nosLevel: "N", nosQual: "Q", nosExpiry: "01/01/2030", internationalMandates: "",
  feoDate: "02/02/2020", mixDescription: "Mix", languages: [], rawAppliedString: "P1",
  appliedPositionCodes: ["P1"], commanderOpinion: "FAVOREVOLE", specificAssignments: "SI",
  ofcnSuitability: "SI", globalNotes: "nota manuale", originalData: { source: true }, ...overrides
});
const position = (overrides: Partial<Position> = {}): Position => ({
  code: "P1", entity: "Roma", title: "Titolo", requirements: [], englishReq: "B2", nosReq: "",
  rankReq: "", catSpecQualReq: "", ofcn: "", poInterest: "", incumbent: "",
  originalData: { source: true }, ...overrides
});
const state = (candidates: Candidate[], positions: Position[]): AppData => ({
  candidates, positions, evaluations: {}, favoritePositionIds: [], lastUpdated: 1,
  cycle: { id: "cycle", name: "Cycle", startedAt: 1 }
});

describe("conservative import/update", () => {
  it("does not report a conflict for an identical reimport or changed originalData", () => {
    const existing = candidate();
    const incoming = candidate({ originalData: { differentlyFormatted: true } });
    expect(getImportDiffs(existing, incoming).filter(diff => diff.changed)).toEqual([]);
  });

  it("reports only the single changed source field", () => {
    const changed = getImportDiffs(candidate(), candidate({ rank: "Magg." })).filter(diff => diff.changed);
    expect(changed.map(diff => diff.label)).toEqual(["Grado"]);
  });

  it("preserves opinions, notes and arbitrary local metadata", () => {
    const existing = { ...candidate(), localFlag: "keep" } as Candidate & { localFlag: string };
    const merged = mergeCandidateForImport(existing, candidate({ rank: "Magg.", commanderOpinion: "", globalNotes: "" }));
    expect(merged).toMatchObject({ rank: "Magg.", commanderOpinion: "FAVOREVOLE", globalNotes: "nota manuale", localFlag: "keep" });
  });

  it("reuses unchanged requirement IDs and keeps its completed evaluation", () => {
    const current = position({ requirements: [{ id: "stable", text: "Esperienza NATO", type: "essential", hidden: false }] });
    const initial = state([candidate()], [current]);
    initial.evaluations.P1_C1 = { candidateId: "C1", positionId: "P1", reqEvaluations: { stable: "yes" }, notes: "done", status: "pending" };
    const incoming = position({ requirements: [{ id: "random", text: "  esperienza   NATO ", type: "essential", hidden: true }] });
    const result = integrateImportedEntity(initial, { type: "position", value: incoming });
    expect(result.positions[0].requirements[0].id).toBe("stable");
    expect(result.evaluations.P1_C1.reqEvaluations.stable).toBe("yes");
  });

  it("adds/removes requirements without deleting old requirement evaluations", () => {
    const current = position({ requirements: [{ id: "old", text: "Vecchio", type: "essential", hidden: false }] });
    const initial = state([candidate()], [current]);
    initial.evaluations.P1_C1 = { candidateId: "C1", positionId: "P1", reqEvaluations: { old: "partial" }, notes: "", status: "pending" };
    const added = { id: "new", text: "Nuovo", type: "desirable" as const, hidden: false };
    const result = integrateImportedEntity(initial, { type: "position", value: position({ requirements: [added] }) });
    expect(result.positions[0].requirements).toEqual([added]);
    expect(result.evaluations.P1_C1.reqEvaluations.old).toBe("partial");
  });

  it("parses multiple language rows as one person", async () => {
    // The integration assertion models parseCandidates' one-ID output and protects it during import.
    const incoming = candidate({ languages: [{ language: "EN", level: "B2", expiry: "" }, { language: "FR", level: "B1", expiry: "" }] });
    const result = integrateImportedEntity(state([], [position()]), { type: "candidate", value: incoming });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].languages).toHaveLength(2);
  });

  it("adds a language without duplicating the person or an existing language", () => {
    const english = { language: "English", level: "B2", expiry: "2030" };
    const incoming = candidate({ languages: [{ ...english, language: " english " }, { language: "French", level: "B1", expiry: "" }] });
    const result = integrateImportedEntity(state([candidate({ languages: [english] })], [position()]), { type: "candidate", value: incoming });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].languages).toHaveLength(2);
  });
});
