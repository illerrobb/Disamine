import { describe, expect, it } from "vitest";
import { analyzeScenario, buildConfiguredChoices, buildNoFeedingRecommendations, sortPositionSnapshots, type SimulationChoice } from "./simulation";
import type { Candidate, Evaluation, Position } from "./index";

const position = (code: string, entity: string, overrides: Partial<Position> = {}): Position => ({
  code, entity, title: code, requirements: [], englishReq: "", nosReq: "", rankReq: "",
  catSpecQualReq: "", ofcn: "", poInterest: "", incumbent: "", role: "",
  plannedPersonnel: "", turnoverDate: "", originalData: {}, ...overrides
});

const candidate = (id: string, appliedPositionCodes: string[]): Candidate => ({
  id, nominativo: id, firstName: id, lastName: "", rank: "", role: "", category: "",
  specialty: "", serviceEntity: "", nosLevel: "", nosQual: "", nosExpiry: "",
  internationalMandates: "", feoDate: "", mixDescription: "", languages: [],
  rawAppliedString: appliedPositionCodes.join(","), appliedPositionCodes, commanderOpinion: "",
  specificAssignments: "", ofcnSuitability: "", globalNotes: "", originalData: {}
});

const evaluation = (candidateId: string, positionId: string, status: Evaluation["status"] = "pending"): Evaluation => ({
  candidateId, positionId, status, reqEvaluations: {}, notes: ""
});

describe("scenario simulation", () => {
  it("uses scenario choices without mutating the completed evaluations", () => {
    const positions = [position("P1", "Ente A"), position("P2", "Ente B")];
    const candidates = [candidate("C1", ["P1", "P2"]), candidate("C2", ["P1"])];
    const evaluations = {
      P1_C1: evaluation("C1", "P1"), P2_C1: evaluation("C1", "P2"), P1_C2: evaluation("C2", "P1")
    };
    const original = JSON.stringify(evaluations);
    const choices: SimulationChoice[] = [{ id: "C1::P1", candidateId: "C1", positionId: "P1" }];
    const analysis = analyzeScenario(choices, candidates, positions, evaluations);

    expect(analysis.snapshots.get("P1")?.isSimulatedCovered).toBe(true);
    expect(analysis.snapshots.get("P2")?.availableCandidateIds).toEqual([]);
    expect(JSON.stringify(evaluations)).toBe(original);
  });

  it("orders positions deterministically by operational priority", () => {
    const positions = [
      position("P10", "Ente B"),
      position("P2", "Ente A"),
      position("P1", "Ente A"),
      position("P3", "Ente C", { administrativeStatus: "non-alimentazione" })
    ];
    const candidates = [candidate("C1", ["P2", "P10"]), candidate("C2", ["P10"])];
    const evaluations = {
      P2_C1: evaluation("C1", "P2"),
      P10_C1: evaluation("C1", "P10"),
      P10_C2: evaluation("C2", "P10")
    };

    const analysis = analyzeScenario([], candidates, positions, evaluations);
    const firstPass = sortPositionSnapshots(Array.from(analysis.snapshots.values())).map(snapshot => snapshot.position.code);
    const secondPass = sortPositionSnapshots(Array.from(analysis.snapshots.values()).reverse()).map(snapshot => snapshot.position.code);

    expect(firstPass).toEqual(["P1", "P2", "P10", "P3"]);
    expect(secondPass).toEqual(firstPass);
  });

  it("applies only final-choice administrative statuses to a scenario", () => {
    const positions = [position("P1", "Ente A"), position("P2", "Ente A")];
    const candidates = [candidate("C1", ["P1"]), candidate("C2", ["P2"])];
    const evaluations = { P1_C1: evaluation("C1", "P1"), P2_C2: evaluation("C2", "P2") };
    const choices: SimulationChoice[] = [
      { id: "C1::P1", candidateId: "C1", positionId: "P1" },
      { id: "C2::P2", candidateId: "C2", positionId: "P2" }
    ];

    const analysis = analyzeScenario(choices, candidates, positions, evaluations, {
      P1: "non-alimentazione",
      P2: "estensione-mandato-titolare"
    });

    expect(analysis.snapshots.get("P1")?.isInactive).toBe(true);
    expect(analysis.snapshots.get("P2")?.manualStatus).toBe("estensione-mandato-titolare");
    expect(analysis.snapshots.get("P1")?.simulatedCandidateId).toBeNull();
    expect(analysis.snapshots.get("P2")?.simulatedCandidateId).toBeNull();
    expect(analysis.metrics.covered).toBe(0);
    expect(analysis.metrics.uncovered).toBe(0);
  });

  it("keeps real selections locked and excludes unavailable work states", () => {
    const positions = [
      position("P1", "Ente A"),
      position("P2", "Ente A", { administrativeStatus: "non-alimentazione" })
    ];
    const candidates = [candidate("C1", ["P1"]), candidate("C2", ["P1"]), candidate("C3", ["P1"])];
    const evaluations = {
      P1_C1: evaluation("C1", "P1", "selected"),
      P1_C2: evaluation("C2", "P1", "excluded"),
      P1_C3: evaluation("C3", "P1", "withdrawn")
    };
    const analysis = analyzeScenario([], candidates, positions, evaluations);

    expect(analysis.snapshots.get("P1")?.realCandidateId).toBe("C1");
    expect(analysis.snapshots.get("P1")?.baseAvailableCandidateIds).toEqual(["C1"]);
    expect(analysis.snapshots.get("P2")?.isInactive).toBe(true);
    expect(analysis.metrics.uncovered).toBe(0);
  });

  it("generates proposals only inside the selected position cluster", () => {
    const positions = [position("GEN-1", "Elevatissimo 3", { title: "Genio" }), position("OPS-1", "Elevatissimo 2", { title: "Operazioni" })];
    const candidates = [candidate("C1", ["GEN-1", "OPS-1"]), candidate("C2", ["OPS-1"])];
    const evaluations = { "GEN-1_C1": evaluation("C1", "GEN-1"), "OPS-1_C1": evaluation("C1", "OPS-1"), "OPS-1_C2": evaluation("C2", "OPS-1") };
    const choices = buildConfiguredChoices({ preferNoForeignExperience: true, prioritizeEntityLevel: true, minimumEntityCoverage: 70, positionQuery: "Genio", entities: [], roles: [] }, candidates, positions, evaluations);

    expect(choices).toHaveLength(1);
    expect(choices[0].positionId).toBe("GEN-1");
  });

  it("suggests non-alimentazione only for uncovered positions without usable candidates", () => {
    const positions = [position("P1", "Ente A"), position("P2", "Ente A"), position("P3", "Ente B")];
    const candidates = [candidate("C1", ["P1"]), candidate("C2", ["P2"])];
    const evaluations = {
      P1_C1: evaluation("C1", "P1", "excluded"),
      P2_C2: evaluation("C2", "P2")
    };
    const choices: SimulationChoice[] = [{ id: "C2::P2", candidateId: "C2", positionId: "P2" }];

    expect(buildNoFeedingRecommendations(choices, candidates, positions, evaluations)).toEqual(["P1", "P3"]);
  });
});
