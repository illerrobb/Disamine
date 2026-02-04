import React, { useState, useEffect, useMemo, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import * as XLSX from "xlsx-js-style";
import {
  Upload,
  FileSpreadsheet,
  Users,
  Briefcase,
  Check,
  X,
  AlertCircle,
  Download,
  Save,
  Search,
  ChevronRight,
  ChevronDown,
  Trash2,
  Menu,
  Filter,
  ArrowUpDown,
  FileText,
  Eye,
  EyeOff,
  Globe,
  Shield,
  ChevronLeft,
  Building,
  LayoutList,
  Table as TableIcon,
  AlertTriangle,
  Ban,
  User,
  Star
} from "lucide-react";

// --- Types ---

interface Language {
  language: string;
  level: string;
}

interface Candidate {
  id: string; // Matricola
  nominativo: string; // Full Name from "NOMINATIVO" or constructed
  firstName: string;
  lastName: string;
  rank: string;
  role: string;
  category: string;
  specialty: string;
  serviceEntity: string; // ENTE DI SERVIZIO
  nosLevel: string; // LIVELLO NOS
  nosQual: string; // QUALIFICA NOS
  nosExpiry: string; // SCADENZA NOS
  internationalMandates: string; // MANDATI INTERNAZIONALI
  feoDate: string; // DT ENTE SVZ
  mixDescription: string; // DESCRIZIONE MIX
  languages: Language[];
  rawAppliedString: string;
  appliedPositionCodes: string[];
  commanderOpinion: "FAVOREVOLE" | "FAVOREVOLE CON SOSTITUZIONE CONTESTUALE" | "NON FAVOREVOLE" | "";
  specificAssignments: "SI" | "NO" | "";
  ofcnSuitability: "SI" | "NO" | "NO VISITA" | "";
  globalNotes: string;
  originalData: any;
}

interface Requirement {
  id: string;
  text: string;
  type: 'essential' | 'desirable';
  hidden: boolean;
}

interface Position {
  code: string;
  entity: string; // Comes from SEDE now
  location: string;
  title: string; // JOB TITLE
  requirements: Requirement[];
  
  // New specific fields
  englishReq: string;
  nosReq: string;
  rankReq: string;
  catSpecQualReq: string;
  ofcn: string;
  poInterest: string;
  incumbent: string; // TITOLARE

  originalData: any;
  jobDescriptionFileName?: string;
}

interface Evaluation {
  candidateId: string;
  positionId: string;
  reqEvaluations: Record<string, 'yes' | 'no' | 'partial' | 'pending'>; // Key is requirement text/id
  notes: string;
  status: 'pending' | 'selected' | 'rejected' | 'reserve' | 'non-compatible' | 'excluded';
  manualOrder?: number;
}

interface Cycle {
  name: string;
  startedAt: number;
  id: string;
}

interface AppData {
  candidates: Candidate[];
  positions: Position[];
  evaluations: Record<string, Evaluation>; // Key: `${positionId}_${candidateId}`
  favoritePositionIds: string[];
  lastUpdated: number;
  cycle: Cycle;
}

type PositionStatus = 'todo' | 'inprogress' | 'completed';
type ImportConflict =
  | { type: 'candidate'; existing: Candidate; incoming: Candidate }
  | { type: 'position'; existing: Position; incoming: Position };

type MultiSelectOption = {
  value: string;
  label: string;
  meta?: string;
};

// --- Helper: Excel Parsing Logic ---

const normalizeHeader = (h: string) => h?.toString().trim().toUpperCase().replace(/\s+/g, ' ') || "";

const findKey = (keys: string[], ...searchTerms: string[]) => {
  return keys.find(k => {
    const normalized = normalizeHeader(k);
    return searchTerms.some(term => normalized.includes(term));
  });
};

const formatExcelDate = (value: unknown) => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toLocaleDateString("it-IT");
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const numericString = trimmed.replace(",", ".");
    if (!Number.isNaN(Number(numericString))) {
      const excelEpoch = new Date(Date.UTC(1899, 11, 30));
      const date = new Date(excelEpoch.getTime() + Number(numericString) * 86400 * 1000);
      if (!Number.isNaN(date.getTime())) {
        return date.toLocaleDateString("it-IT");
      }
    }

    const match = trimmed.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
    if (match) {
      const [, day, month, yearRaw] = match;
      const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
      const parsed = new Date(Number(year), Number(month) - 1, Number(day));
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString("it-IT");
      }
    }

    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString("it-IT");
    }
    return trimmed;
  }

  const numericValue =
    typeof value === "number"
      ? value
      : null;

  if (numericValue !== null) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + numericValue * 86400 * 1000);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("it-IT");
  }

  return String(value).trim();
};

interface DedupResult<T> {
  items: T[];
  duplicateCount: number;
  totalRows: number;
}

interface ImportStats {
  candidates: { imported: number; duplicates: number; totalRows: number };
  positions: { imported: number; duplicates: number; totalRows: number };
}

const parseCandidates = (data: any[]): DedupResult<Candidate> => {
  const map = new Map<string, Candidate>();
  let duplicateCount = 0;

  data.forEach((row) => {
    const keys = Object.keys(row);
    const normalizedKeys = keys.map((k) => normalizeHeader(k));
    console.log("parseCandidates keys:", keys);
    console.log("parseCandidates normalized keys:", normalizedKeys);
    
    // Core Identity
    const matricolaKey = findKey(keys, "MATRICOLA", "EMPLOYEE ID", "ID");
    const nominativoKey = findKey(keys, "NOMINATIVO", "FULL NAME", "COGNOME E NOME");
    const cognomeKey = findKey(keys, "COGNOME", "SURNAME");
    const nomeKey = findKey(keys, "NOME", "NAME");
    const gradoKey = findKey(keys, "GRADO", "RANK");
    
    // Professional Details
    const ruoloKey = findKey(keys, "RUOLO", "ROLE");
    const catKey = keys.find(k => {
       const n = normalizeHeader(k);
       return n === "CATEGORIA" || n === "CAT" || n.startsWith("CAT.") || n === "CATEGORY";
    });
    const specKey = findKey(keys, "SPECIALIT", "SPEC");
    const enteServizioKey = findKey(keys, "ENTE DI SERVIZIO", "ENTE SERVIZIO", "REPARTO", "UNIT", "SEDE");
    
    // NOS Details
    const nosLivelloKey = findKey(keys, "LIVELLO NOS", "NOS LEVEL");
    const nosQualKey = findKey(keys, "QUALIFICA NOS", "NOS QUALIFICATION");
    const nosScadenzaKey = findKey(keys, "SCADENZA", "RILASCIO", "EXPIRY");
    const feoDateKey =
      findKey(
        keys,
        "DT ENTE SVZ",
        "DT. ENTE SVZ",
        "DATA ENTE SVZ",
        "DATA FEO",
        "DT FEO",
        "DT. FEO"
      ) ?? keys.find((k) => normalizeHeader(k) === "FEO");
    console.log("parseCandidates feoDateKey:", feoDateKey);

    // History
    const mandatiKey = findKey(keys, "MANDATI", "INTERNAZIONALI", "MANDATES");
    const mixKey = findKey(keys, "DESCRIZIONE MIX", "MIX", "IMPIEGO");

    // Language & Applications
    const linguaKey = findKey(keys, "LINGUA", "LANGUAGE");
    const livelloKey = findKey(keys, "LIVELLO", "ACCERT", "LEVEL");
    const poSegnalateKey = findKey(keys, "SEGNALATE", "POSIZIONI", "CANDIDATURE", "APPLIED", "PREFERENCES");

    if (!matricolaKey || !row[matricolaKey]) return;

    const id = String(row[matricolaKey]).trim();
    
    if (!map.has(id)) {
      // Name Logic: Prefer NOMINATIVO, fallback to Cognome + Nome
      const lastName = String(row[cognomeKey] || "").trim();
      const firstName = String(row[nomeKey] || "").trim();
      let nominativo = String(row[nominativoKey] || "").trim();
      if (!nominativo && (lastName || firstName)) {
        nominativo = `${lastName} ${firstName}`;
      }

      // Parse Applied Positions - SIMPLIFIED LOGIC
      // We do NOT split by separators here anymore because of complex separators (e.g. " - ").
      // We just store the raw string. The matching logic is now in handleDataLoaded using the known Position list (Reverse Lookup).
      const rawApplied = String(row[poSegnalateKey] || "");
      const feoRawValue = row[feoDateKey];
      console.log("parseCandidates feoDate raw:", feoRawValue, "type:", typeof feoRawValue);
      const formattedFeoDate = formatExcelDate(feoRawValue);
      console.log("parseCandidates feoDate formatted:", formattedFeoDate);
      
      map.set(id, {
        id,
        nominativo,
        firstName,
        lastName,
        rank: String(row[gradoKey] || "").trim(),
        role: String(row[ruoloKey] || "").trim(),
        category: String(row[catKey] || "").trim(),
        specialty: String(row[specKey] || "").trim(),
        serviceEntity: String(row[enteServizioKey] || "").trim(),
        nosLevel: String(row[nosLivelloKey] || "").trim(),
        nosQual: String(row[nosQualKey] || "").trim(),
        nosExpiry: formatExcelDate(row[nosScadenzaKey]),
        internationalMandates: String(row[mandatiKey] || "").trim(),
        feoDate: formattedFeoDate,
        mixDescription: String(row[mixKey] || "").trim(),
        languages: [],
        rawAppliedString: rawApplied,
        appliedPositionCodes: [], // Will be populated in handleDataLoaded via reverse matching
        commanderOpinion: "",
        specificAssignments: "",
        ofcnSuitability: "",
        globalNotes: "",
        originalData: row,
      });
    } else {
      duplicateCount += 1;
    }

    const candidate = map.get(id)!;
    if (linguaKey && row[linguaKey]) {
      const languageEntry = {
        language: String(row[linguaKey]).trim(),
        level: String(row[livelloKey] || "?").trim(),
      };
      const languageKey = `${languageEntry.language.toLowerCase()}|${languageEntry.level.toLowerCase()}`;
      const hasLanguage = candidate.languages.some(
        (lang) => `${lang.language.toLowerCase()}|${lang.level.toLowerCase()}` === languageKey
      );
      if (!hasLanguage) {
        candidate.languages.push(languageEntry);
      }
    }

    const rawApplied = String(row[poSegnalateKey] || "").trim();
    if (!candidate.rawAppliedString && rawApplied) {
      candidate.rawAppliedString = rawApplied;
    }
  });

  return {
    items: Array.from(map.values()),
    duplicateCount,
    totalRows: data.length
  };
};

const parsePositions = (data: any[]): DedupResult<Position> => {
  const map = new Map<string, Position>();
  let duplicateCount = 0;

  data.forEach((row) => {
    const keys = Object.keys(row);
    
    const codeKey = findKey(keys, "CODICE", "POSIZIONE", "JOB ID", "REF");
    // SEDE corresponds to Entity
    const sedeKey = findKey(keys, "SEDE", "ENTE", "STRUTTURA", "COMANDO", "DIVISION", "AREA");
    const jobTitleKey = findKey(keys, "JOB TITLE", "TITOLO", "DENOMINAZIONE");
    const locationKey = findKey(keys, "LUOGO", "LOCALITA", "NAZIONE", "LOCATION");
    const reqKey = findKey(keys, "REQUISITI", "CRITERIA", "COMPETENZE", "REQUIREMENTS");

    // Specific Fields
    const ingleseKey = findKey(keys, "INGLESE", "ENGLISH");
    const nosKey = keys.find(k => normalizeHeader(k) === "NOS" || normalizeHeader(k).includes("SECURITY CLEARANCE"));
    const gradoKey = findKey(keys, "GRADO", "RANK");
    const catSpecKey = findKey(keys, "CAT", "SPEC", "QUAL", "CATEGORIA");
    const ofcnKey = findKey(keys, "OFCN");
    const interesseKey = findKey(keys, "INTERESSE", "INTEREST");
    const titolareKey = findKey(keys, "TITOLARE", "INCUMBENT");

    if (!codeKey || !row[codeKey]) return;

    // Parse Requirements (Same logic as before)
    const rawReqs = String(row[reqKey] || "");
    const requirements: Requirement[] = [];
    
    const essentialIdx = rawReqs.search(/(?:ESSENTIAL|ESSENZIALE|ESSENZIALI)/i);
    const desirableIdx = rawReqs.search(/(?:DESIRABLE|AUSPICABILE|AUSPICABILI)/i);

    let essentialText = "";
    let desirableText = "";

    if (essentialIdx !== -1 && desirableIdx !== -1 && desirableIdx > essentialIdx) {
      essentialText = rawReqs.substring(essentialIdx, desirableIdx);
      desirableText = rawReqs.substring(desirableIdx);
    } else if (essentialIdx !== -1) {
      essentialText = rawReqs.substring(essentialIdx);
    } else if (desirableIdx !== -1) {
      desirableText = rawReqs.substring(desirableIdx);
    } else {
      essentialText = rawReqs;
    }

    const processBlock = (text: string, type: 'essential' | 'desirable') => {
      let cleanText = text.replace(/^(?:ESSENTIAL|ESSENZIALE|ESSENZIALI|DESIRABLE|AUSPICABILE|AUSPICABILI)(?:[\s\w]*)(?:[:\.-]?)/i, '');
      
      // OLD LOGIC (CAUSED ISSUE): cleanText = cleanText.replace(/([•\-➢])/g, '\n$1');
      
      // NEW LOGIC: Split by existing newlines. 
      // Excel often includes \r\n or \n for multi-line cells.
      const lines = cleanText.split(/\r?\n/);

      lines.forEach((line, i) => {
        let content = line.trim();
        
        // Remove leading bullet characters (hyphen, dot, square, arrow, asterisk) only at the start
        content = content.replace(/^[\s]*[-•➢*][\s]*/, ''); 
        
        if (content.length < 3) return;

        const isNumbered = /^(\d+\.|[A-Z]\.)\s/.test(content);
        const isCapsHeader = (content === content.toUpperCase()) && (content.length < 60) && /[A-Z]/.test(content);
        
        requirements.push({
          id: `${type}-${Math.random().toString(36).substr(2,9)}`,
          text: content,
          type,
          hidden: isNumbered || isCapsHeader
        });
      });
    };

    if (essentialText) processBlock(essentialText, 'essential');
    if (desirableText) processBlock(desirableText, 'desirable');

    const codeStr = String(row[codeKey]).trim();
    const titleStr = String(row[jobTitleKey] || codeStr).trim();

    const position: Position = {
      code: codeStr,
      entity: String(row[sedeKey] || "Unknown Entity").trim(),
      location: String(row[locationKey] || "").trim(),
      title: titleStr === codeStr ? `Position ${codeStr}` : titleStr,
      requirements,
      
      englishReq: String(row[ingleseKey] || "").trim(),
      nosReq: String(row[nosKey] || "").trim(),
      rankReq: String(row[gradoKey] || "").trim(),
      catSpecQualReq: String(row[catSpecKey] || "").trim(),
      ofcn: String(row[ofcnKey] || "").trim(),
      poInterest: String(row[interesseKey] || "").trim(),
      incumbent: String(row[titolareKey] || "").trim(),

      originalData: row,
    };

    if (!map.has(codeStr)) {
      map.set(codeStr, position);
      return;
    }

    duplicateCount += 1;
    const existing = map.get(codeStr)!;
    const isBlank = (value: string) => value.trim() === "";
    const isDefaultTitle = (value: string) => value.trim() === `Position ${codeStr}`;

    if ((isBlank(existing.entity) || existing.entity === "Unknown Entity") && !isBlank(position.entity)) {
      existing.entity = position.entity;
    }
    if (isBlank(existing.location) && !isBlank(position.location)) {
      existing.location = position.location;
    }
    if ((isBlank(existing.title) || isDefaultTitle(existing.title)) && !isBlank(position.title)) {
      existing.title = position.title;
    }
    if (isBlank(existing.englishReq) && !isBlank(position.englishReq)) {
      existing.englishReq = position.englishReq;
    }
    if (isBlank(existing.nosReq) && !isBlank(position.nosReq)) {
      existing.nosReq = position.nosReq;
    }
    if (isBlank(existing.rankReq) && !isBlank(position.rankReq)) {
      existing.rankReq = position.rankReq;
    }
    if (isBlank(existing.catSpecQualReq) && !isBlank(position.catSpecQualReq)) {
      existing.catSpecQualReq = position.catSpecQualReq;
    }
    if (isBlank(existing.ofcn) && !isBlank(position.ofcn)) {
      existing.ofcn = position.ofcn;
    }
    if (isBlank(existing.poInterest) && !isBlank(position.poInterest)) {
      existing.poInterest = position.poInterest;
    }
    if (isBlank(existing.incumbent) && !isBlank(position.incumbent)) {
      existing.incumbent = position.incumbent;
    }

    const requirementSet = new Set(
      existing.requirements.map((req) => req.text.trim().toLowerCase())
    );
    position.requirements.forEach((req) => {
      const key = req.text.trim().toLowerCase();
      if (!requirementSet.has(key)) {
        existing.requirements.push(req);
        requirementSet.add(key);
      }
    });
  });

  return {
    items: Array.from(map.values()),
    duplicateCount,
    totalRows: data.length
  };
};

const getPositionStatus = (position: Position, evaluations: Record<string, Evaluation>): PositionStatus => {
  const positionEvals = Object.values(evaluations).filter(ev => ev.positionId === position.code);
  
  if (positionEvals.some(ev => ev.status === 'selected')) {
    return 'completed';
  }

  const hasActivity = positionEvals.some(ev => {
    const statusChanged = ev.status !== 'pending';
    const reqsChecked = Object.keys(ev.reqEvaluations).length > 0;
    return statusChanged || reqsChecked;
  });

  if (hasActivity) {
    return 'inprogress';
  }

  return 'todo';
};

interface OverlapResult {
  position: Position;
  overlapCount: number;
  candidateIds: string[];
  sharedCandidateIds: string[];
}

const computeOverlaps = (positions: Position[], evaluations: Record<string, Evaluation>): OverlapResult[] => {
  const candidateIdsByPosition = new Map<string, Set<string>>();

  positions.forEach(position => {
    candidateIdsByPosition.set(position.code, new Set());
  });

  Object.values(evaluations).forEach(ev => {
    if (ev.status === "excluded") return;
    const candidateSet = candidateIdsByPosition.get(ev.positionId);
    if (!candidateSet) return;
    candidateSet.add(ev.candidateId);
  });

  const overlaps = positions.map(position => {
    const candidateIds = candidateIdsByPosition.get(position.code) ?? new Set<string>();
    const sharedCandidateIds = new Set<string>();

    candidateIdsByPosition.forEach((otherCandidates, otherCode) => {
      if (otherCode === position.code) return;
      otherCandidates.forEach(candidateId => {
        if (candidateIds.has(candidateId)) {
          sharedCandidateIds.add(candidateId);
        }
      });
    });

    return {
      position,
      overlapCount: sharedCandidateIds.size,
      candidateIds: Array.from(candidateIds),
      sharedCandidateIds: Array.from(sharedCandidateIds)
    };
  });

  return overlaps
    .filter(entry => entry.overlapCount > 0)
    .sort((a, b) => {
      if (b.overlapCount !== a.overlapCount) return b.overlapCount - a.overlapCount;
      return a.position.code.localeCompare(b.position.code);
    });
};

const getOtherSelectionInfo = (candidateId: string, currentPositionId: string, evaluations: Record<string, Evaluation>, positions: Position[]) => {
  const otherSelection = Object.values(evaluations).find(ev => 
    ev.candidateId === candidateId && 
    ev.status === 'selected' && 
    ev.positionId !== currentPositionId
  );

  if (otherSelection) {
    const pos = positions.find(p => p.code === otherSelection.positionId);
    return pos;
  }
  return null;
};

const FIT_WEIGHTS = {
  essential: 0.7,
  desirable: 0.3
};

const getRequirementScores = (evaluation: Evaluation, position: Position) => {
  const activeReqs = position.requirements.filter(req => !req.hidden);
  const essentialReqs = activeReqs.filter(req => req.type === 'essential');
  const desirableReqs = activeReqs.filter(req => req.type === 'desirable');

  const essentialYes = essentialReqs.filter(req => evaluation.reqEvaluations[req.id] === 'yes').length;
  const desirableYes = desirableReqs.filter(req => evaluation.reqEvaluations[req.id] === 'yes').length;
  const essentialTotal = essentialReqs.length;
  const desirableTotal = desirableReqs.length;

  const essentialScore = essentialTotal > 0 ? essentialYes / essentialTotal : 0;
  const desirableScore = desirableTotal > 0 ? desirableYes / desirableTotal : 0;

  return {
    essentialYes,
    essentialTotal,
    essentialScore,
    desirableYes,
    desirableTotal,
    desirableScore
  };
};

const getFitScore = (evaluation: Evaluation, position: Position) => {
  const {
    essentialScore,
    desirableScore,
    essentialTotal,
    desirableTotal
  } = getRequirementScores(evaluation, position);

  const essentialWeight = essentialTotal > 0 ? FIT_WEIGHTS.essential : 0;
  const desirableWeight = desirableTotal > 0 ? FIT_WEIGHTS.desirable : 0;
  const weightTotal = essentialWeight + desirableWeight;

  if (weightTotal === 0) return 0;

  return (
    essentialScore * essentialWeight +
    desirableScore * desirableWeight
  ) / weightTotal;
};

// --- Components ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false }: any) => {
  const base = "px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2";
  const variants: any = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-300",
    secondary: "bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:bg-slate-100",
    danger: "bg-red-50 text-red-600 hover:bg-red-100",
    ghost: "text-slate-600 hover:bg-slate-100"
  };
  return (
    <button onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

const Badge = ({ children, color = 'blue' }: any) => {
  const colors: any = {
    blue: "bg-blue-100 text-blue-800",
    green: "bg-green-100 text-green-800",
    amber: "bg-amber-100 text-amber-800",
    slate: "bg-slate-100 text-slate-800",
    purple: "bg-purple-100 text-purple-800",
    red: "bg-red-100 text-red-800"
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-semibold whitespace-nowrap ${colors[color]}`}
    >
      {children}
    </span>
  );
};

const ScoreBar = ({
  evaluation,
  position,
  className = ''
}: {
  evaluation: Evaluation;
  position: Position;
  className?: string;
}) => {
  const activeReqs = position.requirements.filter(req => !req.hidden);
  const counts = activeReqs.reduce(
    (acc, req) => {
      const status = evaluation.reqEvaluations[req.id] || "pending";
      if (status === "yes") {
        if (req.type === "essential") {
          acc.essentialYes += 1;
        } else {
          acc.desirableYes += 1;
        }
      } else if (status === "partial") {
        acc.partial += 1;
      } else if (status === "no") {
        acc.no += 1;
      } else {
        acc.pending += 1;
      }
      return acc;
    },
    {
      essentialYes: 0,
      desirableYes: 0,
      partial: 0,
      no: 0,
      pending: 0
    }
  );

  if (activeReqs.length === 0) {
    return <div className={`h-2 w-full rounded-full bg-slate-200 ${className}`} />;
  }

  const segments = activeReqs.map((req) => {
    const status = evaluation.reqEvaluations[req.id] || "pending";
    if (status === "yes") {
      return {
        color: req.type === "essential" ? "bg-blue-500" : "bg-purple-400",
        label: req.text
      };
    }

    if (status === "partial") {
      return { color: "bg-amber-400", label: req.text };
    }

    if (status === "no") {
      return { color: "bg-red-500", label: req.text };
    }

    return { color: "bg-slate-300", label: req.text };
  });

  return (
    <div className={`flex h-2 w-full gap-0.5 overflow-visible ${className}`}>
      {segments.map((segment, index) => (
        <div key={`${segment.color}-${index}`} className="relative flex-1 group">
          <div className={`h-2 w-full rounded-sm ${segment.color}`} title={segment.label} />
          <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-1 w-max max-w-[220px] -translate-x-1/2 rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] text-slate-700 opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 whitespace-normal break-words">
            {segment.label}
          </div>
        </div>
      ))}
    </div>
  );
};

const RequirementsDrawer = ({
  isOpen,
  position,
  onClose,
  onSave
}: {
  isOpen: boolean;
  position: Position | null;
  onClose: () => void;
  onSave: (positionCode: string, requirements: Requirement[]) => void;
}) => {
  const [draftRequirements, setDraftRequirements] = useState<Requirement[]>([]);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!position || !isOpen) return;
    setDraftRequirements(position.requirements.map(req => ({ ...req })));
    setHasChanges(false);
  }, [position, isOpen]);

  const updateRequirement = (id: string, changes: Partial<Requirement>) => {
    setDraftRequirements(prev => {
      const next = prev.map(req => (req.id === id ? { ...req, ...changes } : req));
      return next;
    });
    setHasChanges(true);
  };

  const handleSave = () => {
    if (!position) return;
    onSave(position.code, draftRequirements);
    setHasChanges(false);
    onClose();
  };

  if (!isOpen || !position) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <button
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Chiudi drawer requisiti"
      />
      <aside className="ml-auto w-full max-w-xl h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col relative">
        <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase text-slate-400 font-semibold">Requisiti posizione</p>
            <h3 className="text-lg font-bold text-slate-800">
              {position.code} • {position.title}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Modifica i requisiti E/D. Salva per aggiornare il fit score.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Chiudi"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {draftRequirements.length === 0 && (
            <div className="text-sm text-slate-400 italic">Nessun requisito presente.</div>
          )}
          {["essential", "desirable"].map(type => (
            <div key={type} className="space-y-3">
              <h4 className="text-xs font-bold text-slate-500 uppercase">
                {type === "essential" ? "Essential (E)" : "Desirable (D)"}
              </h4>
              {draftRequirements
                .filter(req => req.type === type)
                .map(req => (
                  <div key={req.id} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <select
                        value={req.type}
                        onChange={(event) =>
                          updateRequirement(req.id, { type: event.target.value as Requirement["type"] })
                        }
                        className="text-xs font-semibold uppercase text-slate-600 border border-slate-200 rounded px-2 py-1 bg-slate-50"
                      >
                        <option value="essential">Essential</option>
                        <option value="desirable">Desirable</option>
                      </select>
                      {req.hidden && (
                        <span className="text-[10px] uppercase text-slate-400">Hidden</span>
                      )}
                    </div>
                    <textarea
                      value={req.text}
                      onChange={(event) => updateRequirement(req.id, { text: event.target.value })}
                      className="w-full text-sm text-slate-700 border border-slate-200 rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      rows={3}
                    />
                  </div>
                ))}
            </div>
          ))}
        </div>

        <div className="p-6 border-t border-slate-200 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-400">
            {hasChanges ? "Modifiche non salvate" : "Nessuna modifica da salvare"}
          </span>
          <div className="flex items-center gap-3">
            <Button variant="secondary" onClick={onClose}>
              Annulla
            </Button>
            <Button variant="primary" onClick={handleSave} disabled={!hasChanges}>
              <Save className="w-4 h-4" /> Salva
            </Button>
          </div>
        </div>
      </aside>
    </div>,
    document.body
  );
};

const CandidateMatchDrawer = ({
  isOpen,
  candidate,
  position,
  evaluation,
  onClose,
  onUpdate
}: {
  isOpen: boolean;
  candidate: Candidate | null;
  position: Position | null;
  evaluation: Evaluation | null;
  onClose: () => void;
  onUpdate: (ev: Evaluation) => void;
}) => {
  if (!isOpen || !candidate || !position || !evaluation) return null;

  const activeReqs = position.requirements.filter(req => !req.hidden);
  const {
    essentialYes,
    essentialTotal,
    essentialScore,
    desirableYes,
    desirableTotal,
    desirableScore
  } = getRequirementScores(evaluation, position);
  const fitPercent = Math.round(getFitScore(evaluation, position) * 100);

  const statusLabel = {
    pending: "Pending",
    selected: "Selected",
    reserve: "Possibile match",
    rejected: "Rejected",
    "non-compatible": "Non compatibile",
    excluded: "Escluso"
  }[evaluation.status];

  const renderRequirementRow = (req: Requirement) => {
    const status = evaluation.reqEvaluations[req.id] || "pending";
    const isDisabled = evaluation.status === "non-compatible" || evaluation.status === "excluded";
    return (
      <button
        key={req.id}
        type="button"
        onClick={() => {
          if (isDisabled) return;
          const current = evaluation.reqEvaluations[req.id] || "pending";
          const next =
            current === "pending"
              ? "yes"
              : current === "yes"
              ? "no"
              : current === "no"
              ? "partial"
              : "pending";
          onUpdate({
            ...evaluation,
            reqEvaluations: {
              ...evaluation.reqEvaluations,
              [req.id]: next
            }
          });
        }}
        className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-start gap-3 p-2 rounded border transition-colors ${
          isDisabled
            ? "border-slate-200 bg-slate-100 cursor-not-allowed"
            : "border-slate-200 bg-white hover:bg-slate-50"
        }`}
        aria-disabled={isDisabled}
      >
        <div
          className={`mt-0.5 shrink-0 w-6 h-6 rounded flex items-center justify-center border
            ${
              status === "yes"
                ? "bg-green-500 border-green-600 text-white"
                : status === "no"
                ? "bg-red-500 border-red-600 text-white"
                : status === "partial"
                ? "bg-amber-400 border-amber-500 text-white"
                : "bg-white border-slate-300 text-slate-400"
            }`}
        >
          {status === "yes" && <Check className="w-4 h-4" />}
          {status === "no" && <X className="w-4 h-4" />}
          {status === "partial" && <div className="w-2 h-2 rounded-full bg-white opacity-70" />}
        </div>
        <div className="min-w-0 text-left">
          <p
            className={`text-sm break-words ${
              status === "no" ? "text-slate-400 line-through" : "text-slate-700"
            }`}
          >
            {req.text}
          </p>
          <span
            className={`text-[10px] font-bold uppercase ${
              req.type === "essential" ? "text-red-500" : "text-amber-600"
            }`}
          >
            {req.type === "essential" ? "Essential" : "Desirable"}
          </span>
        </div>
      </button>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex">
      <button
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
        aria-label="Chiudi dettaglio match"
      />
      <aside className="ml-auto w-full max-w-2xl h-full bg-white shadow-2xl border-l border-slate-200 flex flex-col relative">
        <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs uppercase text-slate-400 font-semibold">Disamina requisiti</p>
            <h3 className="text-lg font-bold text-slate-800">
              {candidate.nominativo} • {position.code}
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              {position.title} • {position.entity}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Chiudi"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-6 space-y-6">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-500">Status posizione</span>
                <span className="font-semibold text-slate-700 text-right break-words">{statusLabel}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-500">Fit complessivo</span>
                <span className="font-semibold text-slate-700 text-right break-words">{fitPercent}%</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3 text-xs text-slate-500">
                <span className="font-medium">Essential {essentialYes}/{essentialTotal}</span>
                <span className="font-medium text-right">Desirable {desirableYes}/{desirableTotal}</span>
              </div>
            </div>
            <ScoreBar evaluation={evaluation} position={position} />
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase">
              <span>Dettagli candidato</span>
              <span className="font-mono text-[10px] text-slate-400">{candidate.id}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-slate-600">
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-400">Grado</span>
                <span className="font-semibold text-slate-700 text-right break-words">{candidate.rank || "-"}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-400">Ruolo/Cat.</span>
                <span className="font-semibold text-slate-700 text-right break-words">
                  {[candidate.role, candidate.category, candidate.specialty].filter(Boolean).join(" ") || "-"}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-400">Ente di servizio</span>
                <span className="font-semibold text-slate-700 text-right break-words">
                  {candidate.serviceEntity || "-"}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-400">NOS</span>
                <span className="font-semibold text-slate-700 text-right break-words">
                  {[candidate.nosLevel, candidate.nosQual].filter(Boolean).join(" ") || "-"}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-400">Scadenza NOS</span>
                <span className="font-semibold text-slate-700 text-right break-words">
                  {candidate.nosExpiry || "-"}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-400">Mandati estero</span>
                <span className="font-semibold text-slate-700 text-right break-words">
                  {candidate.internationalMandates || "-"}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-400">Data FEO</span>
                <span className="font-semibold text-slate-700 text-right break-words">{candidate.feoDate || "-"}</span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                <span className="text-slate-400">Mix</span>
                <span className="font-semibold text-slate-700 text-right break-words">
                  {candidate.mixDescription || "-"}
                </span>
              </div>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-3 sm:col-span-2">
                <span className="text-slate-400">Lingue</span>
                <span className="font-semibold text-slate-700 text-right break-words">
                  {candidate.languages.length > 0
                    ? candidate.languages.map(lang => `${lang.language} (${lang.level})`).join(", ")
                    : "-"}
                </span>
              </div>
            </div>
            {(candidate.commanderOpinion || candidate.specificAssignments || candidate.ofcnSuitability) && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-600">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                  <span className="text-slate-400">Parere Com.</span>
                  <span className="font-semibold text-slate-700 text-right break-words">
                    {candidate.commanderOpinion || "-"}
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                  <span className="text-slate-400">Attribuzioni</span>
                  <span className="font-semibold text-slate-700 text-right break-words">
                    {candidate.specificAssignments || "-"}
                  </span>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-start gap-3">
                  <span className="text-slate-400">Idoneità OFCN</span>
                  <span className="font-semibold text-slate-700 text-right break-words">
                    {candidate.ofcnSuitability || "-"}
                  </span>
                </div>
              </div>
            )}
            {candidate.globalNotes && (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span className="block text-[10px] uppercase text-slate-400 font-semibold mb-1">Note</span>
                {candidate.globalNotes}
              </div>
            )}
          </div>

          {activeReqs.length === 0 ? (
            <div className="text-sm text-slate-400 italic">Nessun requisito visibile.</div>
          ) : (
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Essential</h4>
                <div className="space-y-2">
                  {activeReqs.filter(req => req.type === "essential").map(renderRequirementRow)}
                </div>
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Desirable</h4>
                <div className="space-y-2">
                  {activeReqs.filter(req => req.type === "desirable").map(renderRequirementRow)}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-slate-200 flex items-center justify-end">
          <Button variant="secondary" onClick={onClose}>
            Chiudi
          </Button>
        </div>
      </aside>
    </div>,
    document.body
  );
};

const StatusPicker = ({
  status,
  otherSelection,
  onChange
}: {
  status: Evaluation["status"];
  otherSelection: Position | null;
  onChange: (status: Evaluation["status"]) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const getStatusColor = (value: Evaluation["status"]) => {
    switch (value) {
      case "selected":
        return "bg-green-100 text-green-800 border-green-200";
      case "rejected":
        return "bg-red-100 text-red-800 border-red-200";
      case "reserve":
        return "bg-amber-100 text-amber-800 border-amber-200";
      case "non-compatible":
        return "bg-gray-200 text-gray-800 border-gray-300";
      case "excluded":
        return "bg-red-200 text-red-900 border-red-300";
      default:
        return "bg-white text-slate-600 border-slate-200";
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (value: Evaluation["status"]) => {
    setIsOpen(false);
    onChange(value);
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`text-sm font-bold uppercase px-3 py-1.5 rounded border cursor-pointer focus:outline-none focus:ring-2 ${getStatusColor(status)}`}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        {status === "pending"
          ? "PENDING"
          : status === "selected"
          ? "SELECTED"
          : status === "reserve"
          ? "POSSIBILE MATCH"
          : status === "rejected"
          ? "REJECTED"
          : status === "excluded"
          ? "ESCLUSO"
          : "NON COMPATIBILE"}
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white border border-slate-200 rounded shadow-lg z-20 p-2 space-y-1">
          <button
            type="button"
            onClick={() => handleSelect("pending")}
            className="w-full text-left text-xs px-2 py-1 rounded hover:bg-slate-50"
          >
            PENDING
          </button>
          <button
            type="button"
            onClick={() => handleSelect("selected")}
            className="w-full text-left text-xs px-2 py-1 rounded hover:bg-slate-50"
          >
            SELECTED
          </button>
          <button
            type="button"
            onClick={() => handleSelect("reserve")}
            className="w-full text-left text-xs px-2 py-1 rounded hover:bg-slate-50"
          >
            POSSIBILE MATCH
          </button>
          <button
            type="button"
            onClick={() => handleSelect("rejected")}
            className="w-full text-left text-xs px-2 py-1 rounded hover:bg-slate-50"
          >
            REJECTED
          </button>
          <button
            type="button"
            onClick={() => handleSelect("non-compatible")}
            className="w-full text-left text-xs px-2 py-1 rounded hover:bg-slate-50"
          >
            NON COMPATIBILE
          </button>
          <button
            type="button"
            onClick={() => handleSelect("excluded")}
            className="w-full text-left text-xs px-2 py-1 rounded hover:bg-slate-50 text-red-600"
          >
            ESCLUSO
          </button>
        </div>
      )}
    </div>
  );
};

// --- New Component: Candidate Detail View (Multi-Position Evaluation) ---

const CandidateDetailView = ({
  candidate,
  evaluations,
  allPositions,
  onUpdate,
  onUpdateCandidate,
  onBack
}: {
  candidate: Candidate;
  evaluations: Record<string, Evaluation>;
  allPositions: Position[];
  onUpdate: (ev: Evaluation) => void;
  onUpdateCandidate: (candidate: Candidate) => void;
  onBack: () => void;
}) => {
  // Find all positions this candidate applied to
  const relevantPositions = useMemo(() => {
    return allPositions.filter(p => {
       // Check if there is an evaluation for this pair
       return !!evaluations[`${p.code}_${candidate.id}`];
    });
  }, [allPositions, evaluations, candidate.id]);

  const handleReqToggle = (ev: Evaluation, reqId: string) => {
    if (ev.status === "non-compatible" || ev.status === "excluded") return;
    const current = ev.reqEvaluations[reqId] || 'pending';
    const next = current === 'pending' ? 'yes' : current === 'yes' ? 'no' : current === 'no' ? 'partial' : 'pending';
    
    onUpdate({
      ...ev,
      reqEvaluations: {
        ...ev.reqEvaluations,
        [reqId]: next
      }
    });
  };

  const formatPositionProfile = useCallback((pos: Position) => {
    const profileParts = [pos.rankReq, pos.catSpecQualReq].filter(Boolean);
    return profileParts.length > 0 ? profileParts.join(" • ") : "-";
  }, []);

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm z-10 sticky top-0">
         <div className="flex items-center gap-4 mb-4">
            <Button variant="secondary" onClick={onBack}>
              <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back
            </Button>
            <div>
               <h1 className="text-xl font-bold text-slate-900">{candidate.nominativo}</h1>
               <div className="text-sm text-slate-500 flex gap-2 items-center">
                 <span className="bg-slate-100 px-2 py-0.5 rounded text-slate-600 font-mono">{candidate.id}</span>
                 <span>•</span>
                 <span>{candidate.rank}</span>
                 <span>•</span>
                 <span>{candidate.serviceEntity}</span>
               </div>
            </div>
         </div>
         
         <div className="grid grid-cols-3 gap-4 text-xs bg-slate-50 p-3 rounded border border-slate-200">
             <div><span className="font-semibold text-slate-400">Role:</span> {candidate.role} {candidate.category} {candidate.specialty}</div>
             <div><span className="font-semibold text-slate-400">NOS:</span> {candidate.nosLevel} {candidate.nosQual}</div>
             <div><span className="font-semibold text-slate-400">Languages:</span> {candidate.languages.map(l => `${l.language} (${l.level})`).join(', ')}</div>
             <div className="col-span-3 border-t border-slate-200 pt-2 mt-1">
                <span className="font-semibold text-slate-400">Mix:</span> {candidate.mixDescription}
             </div>
         </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
         <div className="max-w-5xl mx-auto space-y-8">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
               <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2 mb-4">
                  <User className="w-5 h-5" /> Profilo candidato
               </h2>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="text-sm text-slate-600 flex flex-col gap-1">
                     <span className="font-semibold text-slate-500">Parere Comandante</span>
                     <select
                        className="border border-slate-300 rounded px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                        value={candidate.commanderOpinion ?? ""}
                        onChange={(e) => onUpdateCandidate({ ...candidate, commanderOpinion: e.target.value as Candidate["commanderOpinion"] })}
                     >
                        <option value="">-</option>
                        <option value="FAVOREVOLE">FAVOREVOLE</option>
                        <option value="FAVOREVOLE CON SOSTITUZIONE CONTESTUALE">FAVOREVOLE CON SOSTITUZIONE CONTESTUALE</option>
                        <option value="NON FAVOREVOLE">NON FAVOREVOLE</option>
                     </select>
                  </label>

                  <label className="text-sm text-slate-600 flex flex-col gap-1">
                     <span className="font-semibold text-slate-500">Attribuzioni specifiche/Corsi obbligatori</span>
                     <select
                        className="border border-slate-300 rounded px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                        value={candidate.specificAssignments ?? ""}
                        onChange={(e) => onUpdateCandidate({ ...candidate, specificAssignments: e.target.value as Candidate["specificAssignments"] })}
                     >
                        <option value="">-</option>
                        <option value="SI">SI</option>
                        <option value="NO">NO</option>
                     </select>
                  </label>

                  <label className="text-sm text-slate-600 flex flex-col gap-1">
                     <span className="font-semibold text-slate-500">Idoneità OFCN</span>
                     <select
                        className="border border-slate-300 rounded px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
                        value={candidate.ofcnSuitability ?? ""}
                        onChange={(e) => onUpdateCandidate({ ...candidate, ofcnSuitability: e.target.value as Candidate["ofcnSuitability"] })}
                     >
                        <option value="">-</option>
                        <option value="SI">SI</option>
                        <option value="NO">NO</option>
                        <option value="NO VISITA">NO VISITA</option>
                     </select>
                  </label>

                  <label className="text-sm text-slate-600 flex flex-col gap-1 md:col-span-2">
                     <span className="font-semibold text-slate-500">Note globali</span>
                     <textarea
                        className="w-full h-24 border border-slate-300 rounded p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none bg-slate-50 focus:bg-white transition-colors"
                        placeholder="Note generali sul candidato..."
                        value={candidate.globalNotes ?? ""}
                        onChange={(e) => onUpdateCandidate({ ...candidate, globalNotes: e.target.value })}
                     />
                  </label>
               </div>
            </div>

            <h2 className="text-lg font-bold text-slate-700 flex items-center gap-2">
               <Briefcase className="w-5 h-5" /> Applications Evaluation ({relevantPositions.length})
            </h2>

            {relevantPositions.length === 0 && (
               <div className="p-8 text-center bg-white rounded border border-slate-200 text-slate-500">
                  No active applications found for this candidate.
               </div>
            )}

            {relevantPositions.map(pos => {
               const ev = evaluations[`${pos.code}_${candidate.id}`];
               const isNonCompatible = ev.status === "non-compatible";
               const isExcluded = ev.status === "excluded";
               const isLocked = isNonCompatible || isExcluded;
               const activeReqs = pos.requirements.filter(r => !r.hidden);
               const otherSelection = getOtherSelectionInfo(candidate.id, pos.code, evaluations, allPositions);
               const profileSummary = formatPositionProfile(pos);
               const level = getPositionLevel(pos);
               
               // Calculate stats
               const reqScore = activeReqs.filter(r => ev.reqEvaluations[r.id] === 'yes').length;
               
               return (
                  <div key={pos.code} className={`bg-white rounded-lg border shadow-sm overflow-hidden ${isNonCompatible ? 'border-gray-200' : isExcluded ? 'border-red-200' : 'border-slate-200'}`}>
                     {/* Card Header */}
                     <div className={`px-6 py-4 border-b flex justify-between items-start ${isNonCompatible ? 'bg-gray-50' : isExcluded ? 'bg-red-50 border-red-200' : 'bg-slate-50 border-slate-200'}`}>
                        <div>
                           <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{pos.code}</span>
                              <PositionLevelBadge level={level} />
                              <h3 className={`font-bold text-lg ${isLocked ? 'text-gray-500 line-through' : 'text-slate-800'}`}>{pos.title}</h3>
                           </div>
                           <div className="text-sm text-slate-500 flex gap-2">
                              <span>{pos.entity}</span>
                              <span>•</span>
                              <span>{pos.location}</span>
                           </div>
                           <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
                              <span className="uppercase text-slate-400">Profilo previsto</span>
                              <span className="font-semibold text-slate-600">{profileSummary}</span>
                           </div>
                           {otherSelection && (
                              <div className="mt-2 text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200 inline-flex items-center gap-1">
                                 <AlertTriangle className="w-3 h-3" /> Warning: Selected for {otherSelection.code}
                              </div>
                           )}
                           {isExcluded && (
                              <div className="mt-2 text-xs bg-red-100 text-red-800 px-2 py-1 rounded border border-red-200 inline-flex items-center gap-1 font-semibold">
                                 <Ban className="w-3 h-3" /> CANDIDATO ESCLUSO
                              </div>
                           )}
                        </div>
                        
                        <div className="flex flex-col items-end gap-2">
                           <StatusPicker
                              status={ev.status}
                              otherSelection={otherSelection}
                              onChange={(status) => onUpdate({ ...ev, status })}
                           />
                           
                           {!isLocked && (
                              <div className="text-xs font-medium text-slate-500">
                                 Match: <span className={reqScore === activeReqs.length ? 'text-green-600' : 'text-slate-700'}>{reqScore}/{activeReqs.length}</span>
                              </div>
                           )}
                        </div>
                     </div>

                     {/* Card Body */}
                     <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Requirements */}
                        <div className="lg:col-span-2 space-y-3">
                           <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Requirements</h4>
                           {isLocked ? (
                              <div className="p-4 bg-gray-50 text-gray-400 text-sm text-center italic rounded border border-gray-100">
                                 Evaluation disabled.
                              </div>
                           ) : (
                              <div className="space-y-2">
                                 {activeReqs.map(req => {
                                    const status = ev.reqEvaluations[req.id] || 'pending';
                                    return (
                                       <div 
                                          key={req.id}
                                          onClick={() => handleReqToggle(ev, req.id)}
                                          className="flex items-start gap-3 p-2 rounded hover:bg-slate-50 cursor-pointer border border-transparent hover:border-slate-100 transition-colors group"
                                       >
                                          <div className={`mt-0.5 shrink-0 w-6 h-6 rounded flex items-center justify-center border transition-colors
                                             ${status === 'yes' ? 'bg-green-500 border-green-600 text-white' : 
                                               status === 'no' ? 'bg-red-500 border-red-600 text-white' : 
                                               status === 'partial' ? 'bg-amber-400 border-amber-500 text-white' : 'bg-white border-slate-300 text-transparent group-hover:border-slate-400'}`}
                                          >
                                             {status === 'yes' && <Check className="w-4 h-4" />}
                                             {status === 'no' && <X className="w-4 h-4" />}
                                             {status === 'partial' && <div className="w-2 h-2 rounded-full bg-white opacity-50" />}
                                          </div>
                                          <div>
                                             <p className={`text-sm ${status === 'no' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{req.text}</p>
                                             {req.type === 'essential' && <span className="text-[10px] text-red-500 font-bold uppercase">Essential</span>}
                                          </div>
                                       </div>
                                    )
                                 })}
                              </div>
                           )}
                        </div>

                        {/* Notes */}
                        <div className="space-y-3">
                           <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Notes</h4>
                           {otherSelection && (
                              <div className="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200">
                                 <strong>Individuato per altra posizione:</strong> {otherSelection.code} - {otherSelection.title} ({otherSelection.entity})
                              </div>
                           )}
                           <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Note globali</label>
                           <textarea
                              className="w-full h-24 border border-slate-300 rounded p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none bg-slate-50 focus:bg-white transition-colors"
                              placeholder="Note globali per il candidato..."
                              value={candidate.globalNotes ?? ""}
                              onChange={(e) => onUpdateCandidate({ ...candidate, globalNotes: e.target.value })}
                           />
                           <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Note posizione</label>
                           <textarea
                              className="w-full h-32 border border-slate-300 rounded p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none bg-slate-50 focus:bg-white transition-colors"
                              placeholder="Add notes specifically for this position..."
                              value={ev.notes}
                              onChange={(e) => onUpdate({...ev, notes: e.target.value})}
                           />
                        </div>
                     </div>
                  </div>
               )
            })}
         </div>
      </div>
    </div>
  );
};

// --- Matrix View Component ---
const CandidatesMatrixView = ({
  candidates,
  position,
  evaluations,
  positions, // Need full list for checking other selections
  onUpdate
}: {
  candidates: Candidate[];
  position: Position;
  evaluations: Record<string, Evaluation>;
  positions: Position[];
  onUpdate: (e: Evaluation) => void;
}) => {
  const activeReqs = position.requirements.filter(r => !r.hidden);

  const getStatusColor = (s: string) => {
    switch(s) {
      case 'selected': return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
      case 'reserve': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'non-compatible': return 'bg-gray-200 text-gray-800 border-gray-300';
      case 'excluded': return 'bg-red-200 text-red-900 border-red-300';
      default: return 'bg-white text-slate-600 border-slate-200';
    }
  };

  const handleReqToggle = (evaluation: Evaluation, reqId: string) => {
    if (evaluation.status === "non-compatible" || evaluation.status === "excluded") return; // Read-only if blocked
    const current = evaluation.reqEvaluations[reqId] || 'pending';
    const next = current === 'pending' ? 'yes' : current === 'yes' ? 'no' : current === 'no' ? 'partial' : 'pending';
    
    onUpdate({
      ...evaluation,
      reqEvaluations: {
        ...evaluation.reqEvaluations,
        [reqId]: next
      }
    });
  };

  return (
    <div className="overflow-x-auto pb-4">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky left-0 bg-slate-50 border border-slate-200 p-2 z-20 w-80 min-w-[20rem] text-left shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
              Candidate
            </th>
            <th className="bg-slate-50 border border-slate-200 p-2 w-[140px] z-10 sticky left-80 shadow-md">
              Status
            </th>
            {activeReqs.map((req, i) => (
              <th key={req.id} className="bg-slate-50 border border-slate-200 p-2 min-w-[120px] font-medium text-slate-600 relative group">
                <div className="line-clamp-3" title={req.text}>
                  {req.type === 'essential' && <span className="text-red-500 font-bold mr-1">*</span>}
                  {req.text}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {candidates.map(c => {
            const ev = evaluations[`${position.code}_${c.id}`];
            if (!ev) return null;
            const isNonCompatible = ev.status === "non-compatible";
            const isExcluded = ev.status === "excluded";
            const isLocked = isNonCompatible || isExcluded;
            const otherSelection = getOtherSelectionInfo(c.id, position.code, evaluations, positions);

            return (
              <tr key={c.id} className={`hover:bg-slate-50 ${isNonCompatible ? 'bg-gray-100 opacity-60 grayscale' : ''} ${isExcluded ? 'bg-red-50 opacity-80' : ''}`}>
                <td className={`sticky left-0 border border-slate-200 p-2 w-80 min-w-[20rem] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] ${isNonCompatible ? 'bg-gray-100' : isExcluded ? 'bg-red-50' : 'bg-white hover:bg-slate-50'}`}>
                  <div className="text-[10px] text-slate-500 font-mono uppercase truncate mb-1" title={`${c.rank} ${c.role} ${c.category} ${c.specialty}`}>
                     {c.rank} {c.role} {c.category} {c.specialty}
                  </div>
                  <div className="font-bold text-slate-800 flex items-center gap-2">
                    {c.nominativo}
                    {otherSelection && (
                      <div className="text-amber-500" title={`Selected for: ${otherSelection.code}`}>
                        <AlertTriangle className="w-3 h-3" />
                      </div>
                    )}
                  </div>
                  {isNonCompatible && <div className="text-[10px] text-red-600 font-bold mt-1">PROFILO NON COMPATIBILE</div>}
                  {isExcluded && <div className="text-[10px] text-red-700 font-bold mt-1">CANDIDATO ESCLUSO</div>}
                </td>
                <td className={`border border-slate-200 p-2 w-[140px] sticky left-80 shadow-md ${isNonCompatible ? 'bg-gray-100' : isExcluded ? 'bg-red-50' : 'bg-white'}`}>
                   <select 
                      value={ev.status}
                      onChange={(e) => onUpdate({...ev, status: e.target.value as any})}
                      className={`w-full text-[10px] font-bold uppercase px-1 py-1 rounded border appearance-none cursor-pointer focus:outline-none ${getStatusColor(ev.status)}`}
                     >
                       <option value="pending">PENDING</option>
                       <option value="selected">SELECTED</option>
                       <option value="reserve">POSSIBILE MATCH</option>
                       <option value="rejected">REJECTED</option>
                       <option value="non-compatible">NON COMPATIBILE</option>
                       <option value="excluded">ESCLUSO</option>
                     </select>
                </td>
                {activeReqs.map(req => {
                  const status = ev.reqEvaluations[req.id] || 'pending';
                  return (
                    <td 
                      key={req.id} 
                      onClick={() => handleReqToggle(ev, req.id)}
                      className={`border border-slate-200 p-1 text-center select-none transition-colors ${!isLocked && 'cursor-pointer hover:bg-slate-100'}`}
                    >
                      {!isLocked && (
                        <div className={`w-full h-8 rounded flex items-center justify-center
                          ${status === 'yes' ? 'bg-green-100 text-green-700' : 
                            status === 'no' ? 'bg-red-50 text-red-300' : 
                            status === 'partial' ? 'bg-amber-100 text-amber-600' : ''}`}
                        >
                           {status === 'yes' && <Check className="w-4 h-4" />}
                           {status === 'no' && <X className="w-4 h-4" />}
                           {status === 'partial' && <div className="w-2 h-2 bg-amber-400 rounded-full" />}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  );
};


// --- Candidates List View ---

const WorksheetRow: React.FC<{ 
  candidate: Candidate; 
  evaluation: Evaluation; 
  position: Position; 
  otherSelection: Position | null;
  onUpdate: (e: Evaluation) => void;
  onUpdateCandidate: (c: Candidate) => void;
  onOpenRequirementsDrawer: () => void;
  isDragging: boolean;
  isDropTarget: boolean;
  onDragHandlePointerDown: (candidateId: string, event: React.PointerEvent<HTMLButtonElement>) => void;
  isDragOverlay?: boolean;
}> = ({ 
  candidate, 
  evaluation, 
  position, 
  otherSelection,
  onUpdate,
  onUpdateCandidate,
  onOpenRequirementsDrawer,
  isDragging,
  isDropTarget,
  onDragHandlePointerDown,
  isDragOverlay = false
}) => {
  const [expanded, setExpanded] = useState(false);
  const isNonCompatible = evaluation.status === "non-compatible";
  const isExcluded = evaluation.status === "excluded";
  const isLocked = isNonCompatible || isExcluded;

  // Only count non-hidden requirements
  const activeReqs = position.requirements.filter(r => !r.hidden);
  const {
    essentialYes,
    essentialTotal,
    essentialScore,
    desirableYes,
    desirableTotal,
    desirableScore
  } = getRequirementScores(evaluation, position);

  const handleReqToggle = (reqId: string) => {
    if (isLocked) return;
    const current = evaluation.reqEvaluations[reqId] || 'pending';
    const next = current === 'pending' ? 'yes' : current === 'yes' ? 'no' : current === 'no' ? 'partial' : 'pending';
    
    onUpdate({
      ...evaluation,
      reqEvaluations: {
        ...evaluation.reqEvaluations,
        [reqId]: next
      }
    });
  };

  const getStatusColor = (s: string) => {
    switch(s) {
      case 'selected': return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
      case 'reserve': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'non-compatible': return 'bg-gray-200 text-gray-800 border-gray-300';
      case 'excluded': return 'bg-red-200 text-red-900 border-red-300';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <div
      {...(!isDragOverlay ? { "data-drag-row": true, "data-candidate-id": candidate.id } : {})}
      className={`border rounded-lg mb-2 shadow-sm overflow-hidden transition-all duration-200 ease-out transform-gpu ${isNonCompatible ? 'bg-gray-50 border-gray-200 opacity-75' : isExcluded ? 'bg-red-50 border-red-200' : 'bg-white border-slate-200'} ${isDropTarget ? 'ring-2 ring-blue-300 bg-blue-50/40' : ''} ${isDragOverlay ? 'shadow-xl ring-2 ring-blue-200 pointer-events-none' : ''} ${isDragging && !isDragOverlay ? 'opacity-0 pointer-events-none' : ''}`}
    >
      <div className={`flex items-center p-3 gap-4 hover:bg-slate-50 transition-colors ${isDragging && !isDragOverlay ? 'opacity-70' : ''}`}>
        <button
          onPointerDown={(event) => {
            event.preventDefault();
            onDragHandlePointerDown(candidate.id, event);
          }}
          className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 transition-transform duration-200 hover:scale-110 active:scale-95 touch-none"
          aria-label="Drag to reorder"
        >
          <Menu className="w-4 h-4" />
        </button>
        <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-slate-600">
          {expanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium truncate ${isLocked ? 'text-gray-500 line-through' : 'text-slate-900'}`}>{candidate.nominativo}</span>
            <span className="text-xs px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{candidate.rank}</span>
            
            {/* Added Role/Cat/Spec Details inline */}
            <span className="text-[10px] text-slate-500 font-mono uppercase bg-slate-50 px-1.5 py-0.5 rounded border border-slate-100 truncate max-w-[300px]">
               {candidate.role} {candidate.category} {candidate.specialty}
            </span>

            {otherSelection && (
              <span className="text-xs px-1.5 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 rounded flex items-center gap-1">
                 <AlertTriangle className="w-3 h-3" /> Selected Elsewhere
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 flex gap-2 mt-0.5 items-center">
             {isNonCompatible ? (
                <span className="font-bold text-red-600 flex items-center gap-1"><Ban className="w-3 h-3" /> PROFILO NON COMPATIBILE CON LA PERSONA</span>
             ) : isExcluded ? (
                <span className="font-bold text-red-700 flex items-center gap-1"><Ban className="w-3 h-3" /> CANDIDATO ESCLUSO</span>
             ) : (
               <>
                <span className="font-mono">{candidate.id}</span>
                <span className="text-slate-300">|</span>
                <span className="truncate max-w-[200px]">{candidate.serviceEntity}</span>
                 <span className="text-slate-300">|</span>
                 <span>{candidate.languages.map(l => `${l.language} (${l.level})`).join(', ')}</span>
               </>
             )}
          </div>
        </div>

        {/* Mini Score Dashboard */}
        <div className="flex gap-2 mr-4">
           {!isLocked && (
             <div className="flex flex-col items-center px-3 border-l border-slate-100">
                <span className="text-[10px] text-slate-500 uppercase font-bold">E {essentialYes}/{essentialTotal}</span>
                <span className="text-[10px] text-slate-500 uppercase font-bold">D {desirableYes}/{desirableTotal}</span>
                <ScoreBar
                  evaluation={evaluation}
                  position={position}
                  className="mt-1 w-20"
                />
             </div>
           )}
           
           <select 
            value={evaluation.status}
            onChange={(e) => onUpdate({...evaluation, status: e.target.value as any})}
            className={`text-xs font-semibold px-2 py-1 rounded border appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 ${getStatusColor(evaluation.status)}`}
           >
             <option value="pending">PENDING</option>
             <option value="selected">SELECTED</option>
             <option value="reserve">POSSIBILE MATCH</option>
             <option value="rejected">REJECTED</option>
             <option value="non-compatible">NON COMPATIBILE</option>
             <option value="excluded">ESCLUSO</option>
           </select>
        </div>
        <button
          onClick={onOpenRequirementsDrawer}
          className="text-xs text-blue-600 hover:text-blue-700 font-semibold border border-blue-100 bg-blue-50 px-2 py-1 rounded"
        >
          <FileText className="w-3 h-3 inline-block mr-1" />
          Requisiti
        </button>
      </div>

      {expanded && (
        <div className="bg-slate-50 p-4 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
              <Briefcase className="w-3 h-3"/> Requirements Evaluation
            </h4>
            {isLocked ? (
               <div className="p-4 bg-gray-100 rounded border border-gray-200 text-center text-gray-500 text-sm">
                  Evaluation disabled for non-compatible or excluded profiles.
               </div>
            ) : (
              <div className="space-y-2">
                {activeReqs.length === 0 && <p className="text-xs text-slate-400 italic">No visible requirements.</p>}
                {activeReqs.map(req => {
                  const status = evaluation.reqEvaluations[req.id] || 'pending';
                  return (
                    <div key={req.id} 
                      onClick={() => handleReqToggle(req.id)}
                      className="flex items-start gap-3 p-2 rounded cursor-pointer hover:bg-white border border-transparent hover:border-slate-200 transition-all select-none group"
                    >
                      <div className={`mt-0.5 w-5 h-5 rounded flex items-center justify-center border transition-colors
                        ${status === 'yes' ? 'bg-green-500 border-green-600 text-white' : 
                          status === 'no' ? 'bg-red-500 border-red-600 text-white' : 
                          status === 'partial' ? 'bg-amber-400 border-amber-500 text-white' : 'bg-white border-slate-300 text-transparent group-hover:border-slate-400'}`}
                      >
                        {status === 'yes' && <Check className="w-3.5 h-3.5" />}
                        {status === 'no' && <X className="w-3.5 h-3.5" />}
                        {status === 'partial' && <div className="w-2 h-2 rounded-full bg-white opacity-50" />}
                      </div>
                      <div className="flex-1">
                        <p className={`text-sm ${status === 'no' ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                          {req.text}
                        </p>
                        {req.type === 'essential' && <span className="text-[10px] font-bold text-red-500 uppercase">Essential</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          
          <div className="flex flex-col h-full">
             <div className="mb-4 text-xs text-slate-600 bg-white p-3 rounded border border-slate-200 space-y-2">
               {otherSelection && (
                 <div className="p-2 bg-amber-50 text-amber-800 border border-amber-200 rounded mb-2">
                    <strong>Individuato per altra posizione:</strong><br/>
                    {otherSelection.code} - {otherSelection.title} ({otherSelection.entity})
                 </div>
               )}
               <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <div><span className="font-semibold text-slate-400">Ruolo:</span> {candidate.role}</div>
                  <div><span className="font-semibold text-slate-400">Cat/Spec:</span> {candidate.category} {candidate.specialty}</div>
                  <div><span className="font-semibold text-slate-400">NOS:</span> {candidate.nosLevel} {candidate.nosQual && `(${candidate.nosQual})`}</div>
                  <div><span className="font-semibold text-slate-400">Scadenza:</span> {candidate.nosExpiry}</div>
               </div>
               {candidate.mixDescription && (
                 <div className="border-t border-slate-100 pt-2 mt-2">
                    <span className="font-semibold text-slate-400 block mb-1">MIX Description:</span>
                    <p className="text-slate-500 leading-relaxed">{candidate.mixDescription}</p>
                 </div>
               )}
               {candidate.internationalMandates && (
                 <div className="border-t border-slate-100 pt-2">
                    <span className="font-semibold text-slate-400 block mb-1">Mandati Internazionali:</span>
                    <p className="text-slate-500">{candidate.internationalMandates}</p>
                 </div>
               )}
             </div>

            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
              <FileText className="w-3 h-3"/> Notes
            </h4>
            <div className="space-y-3 flex-1 flex flex-col">
              {otherSelection && (
                <div className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded px-2 py-1">
                  <strong>Individuato per altra posizione:</strong> {otherSelection.code} - {otherSelection.title} ({otherSelection.entity})
                </div>
              )}
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Note globali</label>
              <textarea
                className="w-full border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none bg-white"
                placeholder="Note globali per il candidato..."
                value={candidate.globalNotes ?? ""}
                onChange={(e) => onUpdateCandidate({ ...candidate, globalNotes: e.target.value })}
                rows={3}
              />
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Note posizione</label>
              <textarea
                className="flex-1 w-full border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                placeholder="Add evaluation notes here..."
                value={evaluation.notes}
                onChange={(e) => onUpdate({...evaluation, notes: e.target.value})}
                rows={5}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const useCandidateReorder = ({
  positionCode,
  baseOrderedIds,
  onReorder,
  viewMode
}: {
  positionCode: string;
  baseOrderedIds: string[];
  onReorder: (positionId: string, orderedCandidateIds: string[]) => void;
  viewMode: 'list' | 'matrix';
}) => {
  const [draggedCandidateId, setDraggedCandidateId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dragOrderIds, setDragOrderIds] = useState<string[] | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [dragStartRect, setDragStartRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const dragGrabRef = useRef<{ x: number; y: number } | null>(null);
  const dragStartRectRef = useRef<{ left: number; top: number } | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);

  const moveCandidateToIndex = useCallback((order: string[], activeId: string, targetIndex: number) => {
    const next = order.filter(id => id !== activeId);
    const clampedIndex = Math.max(0, Math.min(targetIndex, next.length));
    next.splice(clampedIndex, 0, activeId);
    return next;
  }, []);

  const resetDragState = useCallback(() => {
    setDraggedCandidateId(null);
    setDropTargetId(null);
    setDragOrderIds(null);
    setDragOffset(null);
    setDragStartRect(null);
    dragGrabRef.current = null;
    dragStartRectRef.current = null;
    dragOrderRef.current = null;
  }, []);

  useEffect(() => {
    dragOrderRef.current = dragOrderIds;
  }, [dragOrderIds]);

  useEffect(() => {
    if (!draggedCandidateId) return;

    const handlePointerMove = (event: PointerEvent) => {
      const dragGrab = dragGrabRef.current;
      const dragStartRectValue = dragStartRectRef.current;
      const rectLeft = dragStartRectValue?.left;
      const rectTop = dragStartRectValue?.top;
      if (dragGrab && rectLeft !== undefined && rectTop !== undefined) {
        setDragOffset({
          x: event.clientX - dragGrab.x - rectLeft,
          y: event.clientY - dragGrab.y - rectTop
        });
      }

      const rows = Array.from(document.querySelectorAll('[data-drag-row]')) as HTMLElement[];
      const activeRows = rows.filter(row => row.dataset.candidateId !== draggedCandidateId);
      if (activeRows.length === 0) {
        setDropTargetId(null);
        return;
      }

      const orderedRows = activeRows
        .map(row => ({
          row,
          rect: row.getBoundingClientRect(),
          id: row.dataset.candidateId || ""
        }))
        .filter(entry => entry.id);

      const pointerY = event.clientY;
      let targetId: string | null = null;
      for (const entry of orderedRows) {
        if (pointerY < entry.rect.top + entry.rect.height / 2) {
          targetId = entry.id;
          break;
        }
      }

      const orderBase = dragOrderRef.current ?? baseOrderedIds;
      const orderWithoutActive = orderBase.filter(id => id !== draggedCandidateId);
      const indexMap = new Map(orderWithoutActive.map((id, index) => [id, index]));
      const targetIndex = targetId ? indexMap.get(targetId) ?? orderWithoutActive.length : orderWithoutActive.length;
      const finalTargetId = targetId ?? orderWithoutActive[orderWithoutActive.length - 1] ?? null;

      setDropTargetId(finalTargetId);

      setDragOrderIds((prev) => {
        const currentOrder = prev ?? baseOrderedIds;
        const nextOrder = moveCandidateToIndex(currentOrder, draggedCandidateId, targetIndex);
        if (nextOrder.join("|") === currentOrder.join("|")) {
          return prev;
        }
        dragOrderRef.current = nextOrder;
        return nextOrder;
      });
    };

    const handlePointerUp = () => {
      const finalOrder = dragOrderRef.current ?? baseOrderedIds;
      onReorder(positionCode, finalOrder);
      resetDragState();
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [draggedCandidateId, baseOrderedIds, moveCandidateToIndex, onReorder, positionCode, resetDragState]);

  useEffect(() => {
    if (viewMode !== 'list' && draggedCandidateId) {
      resetDragState();
    }
  }, [draggedCandidateId, resetDragState, viewMode]);

  const handleDragHandlePointerDown = useCallback(
    (candidateId: string, event: React.PointerEvent<HTMLButtonElement>) => {
      const row = (event.currentTarget as HTMLElement).closest('[data-drag-row]') as HTMLElement | null;
      if (row) {
        const rect = row.getBoundingClientRect();
        dragGrabRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        dragStartRectRef.current = { left: rect.left, top: rect.top };
        setDragStartRect({ left: rect.left, top: rect.top, width: rect.width });
      } else {
        dragGrabRef.current = { x: 0, y: 0 };
        dragStartRectRef.current = { left: event.clientX, top: event.clientY };
        setDragStartRect({ left: event.clientX, top: event.clientY, width: 0 });
      }
      setDraggedCandidateId(candidateId);
      setDropTargetId(candidateId);
      dragOrderRef.current = baseOrderedIds;
      setDragOffset({ x: 0, y: 0 });
    },
    [baseOrderedIds]
  );

  return {
    draggedCandidateId,
    dropTargetId,
    dragOrderIds,
    dragOffset,
    dragStartRect,
    handleDragHandlePointerDown
  };
};

const PositionCard: React.FC<{ 
  position: Position; 
  status: PositionStatus; 
  candidateCount: number; 
  selectedCandidatesNames: string[];
  selectedCandidatesDetails: Candidate[]; // Added for detailed view
  candidatesList: Candidate[]; // Added for tooltip
  isFavorite: boolean;
  onClick: () => void;
  onToggleFavorite: (positionCode: string) => void;
}> = ({ 
  position, 
  status, 
  candidateCount, 
  selectedCandidatesNames, 
  selectedCandidatesDetails,
  candidatesList,
  isFavorite,
  onClick,
  onToggleFavorite
}) => {
  const statusColors = {
    todo: "bg-slate-100 text-slate-600",
    inprogress: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700"
  };

  const statusLabels = {
    todo: "To Do",
    inprogress: "In Progress",
    completed: "Completed"
  };
  const level = getPositionLevel(position);

  return (
    <div 
      onClick={onClick}
      className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col h-full"
    >
      <div className="p-5 flex-1">
        <div className="flex justify-between items-start mb-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded">{position.code}</span>
            <PositionLevelBadge level={level} />
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${statusColors[status]}`}>
              {statusLabels[status]}
            </span>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onToggleFavorite(position.code);
              }}
              className={`p-1 rounded-full border transition-colors ${
                isFavorite ? "text-amber-500 border-amber-200 bg-amber-50" : "text-slate-400 border-slate-200 hover:text-slate-500"
              }`}
              aria-label={isFavorite ? "Rimuovi dalla shortlist" : "Aggiungi alla shortlist"}
              title={isFavorite ? "In shortlist" : "Salva in shortlist"}
            >
              <Star className="w-3.5 h-3.5" fill={isFavorite ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
        <h3 className="font-bold text-slate-800 mb-1 line-clamp-2" title={position.title}>{position.title}</h3>
        <p className="text-sm text-slate-500 flex items-center gap-1 mb-4">
          <Building className="w-3 h-3" /> {position.entity}
        </p>
        
        <div className="space-y-2 text-xs text-slate-600">
           <div className="flex justify-between border-b border-slate-100 pb-1">
             <span className="text-slate-400">Selected</span>
             <div className="text-right">
                {selectedCandidatesDetails.length > 0 ? (
                   selectedCandidatesDetails.map(c => (
                      <div key={c.id}>
                         <div className="font-bold text-green-700">{c.nominativo}</div>
                         <div className="text-[10px] text-green-600 font-mono">
                            {c.rank} • {c.role} • {c.category} • {c.specialty}
                         </div>
                      </div>
                   ))
                ) : (
                   <span className="text-slate-400 italic">None</span>
                )}
             </div>
           </div>
           <div className="flex justify-between border-b border-slate-100 pb-1">
             <span className="text-slate-400">Grade</span>
             <span className="font-medium">{position.rankReq || '-'}</span>
           </div>
           <div className="flex justify-between pb-1">
             <span className="text-slate-400">Role</span>
             <span className="font-medium truncate max-w-[120px]">{position.catSpecQualReq || '-'}</span>
           </div>
        </div>
      </div>
      <div className="bg-slate-50 px-5 py-3 border-t border-slate-100 flex items-center justify-between text-sm">
         <span className="text-slate-500">Candidates</span>
         <div 
            className="flex items-center gap-2 group relative" 
            title={candidatesList.map(c => `${c.rank} ${c.role} ${c.category} ${c.specialty} - ${c.nominativo}`).join('\n')}
         >
           <Users className="w-4 h-4 text-slate-400" />
           <span className="font-bold text-slate-700">{candidateCount}</span>
           
           {/* Custom Tooltip via CSS */}
           <div className="hidden group-hover:block absolute bottom-full right-0 mb-2 w-72 bg-slate-800 text-white text-[10px] p-2 rounded shadow-lg z-50 whitespace-pre-wrap max-h-64 overflow-y-auto">
              <div className="font-bold border-b border-slate-600 pb-1 mb-1 text-slate-300">Papabili ({candidateCount})</div>
              {candidatesList.map(c => (
                 <div key={c.id} className="mb-1 border-b border-slate-700 pb-1 last:border-0">
                    <span className="text-slate-400">{c.rank}</span> <span className="font-semibold">{c.nominativo}</span><br/>
                    <span className="text-slate-500 italic">{c.role} {c.category} {c.specialty}</span>
                 </div>
              ))}
           </div>
         </div>
      </div>
    </div>
  );
};

// --- Export Logic ---

const getStyledXlsx = () => {
  const hasCoreApi =
    XLSX?.utils?.aoa_to_sheet &&
    XLSX?.utils?.book_new &&
    XLSX?.utils?.book_append_sheet &&
    XLSX?.utils?.sheet_to_json &&
    XLSX?.writeFile;

  if (!hasCoreApi) {
    throw new Error(
      "XLSX styling build not available. Please load xlsx-js-style (with writeFile + style support) before importing or exporting."
    );
  }

  return XLSX;
};

const readExcelFiles = async (files: File[], label: string) => {
  const XLSX = getStyledXlsx();
  const readExcel = (file: File) => {
    return new Promise<any[]>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: "binary", cellDates: true });
          const firstSheetName = workbook.SheetNames[0];
          console.log(`[readExcel:${label}] Sheet names:`, workbook.SheetNames);
          console.log(`[readExcel:${label}] First sheet name:`, firstSheetName);
          const worksheet = workbook.Sheets[firstSheetName];
          const json = XLSX.utils.sheet_to_json(worksheet, { raw: true });
          console.log(`[readExcel:${label}] Sample keys:`, Object.keys(json[0] || {}));
          resolve(json);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsBinaryString(file);
    });
  };

  const data = await Promise.all(files.map((file) => readExcel(file)));
  return data.flat();
};

const PROFILE_CODE_GROUPS: Record<string, string[]> = {
  AA: ["AARAN", "AARAS", "AARNN", "AARNS"],
  AARA: ["AARAN", "AARAS"],
  AARN: ["AARNN", "AARNS"],
  GA: ["GARN", "GARS"]
};

const ROLE_FILTER_OPTIONS = [
  { value: "ALL", label: "Tutti i ruoli" },
  { value: "NAVIGANTI", label: "Naviganti (AArnn/AArns, posizioni AA/AArn)" },
  { value: "ARMI", label: "Armi (AAran/AAras, posizioni AAra)" },
  { value: "GENIO", label: "Genio (G.A...)" },
  { value: "COMMISSARI", label: "Commissari (CC...)" },
  { value: "SANITARI", label: "Sanitari (CSA...)" }
] as const;

type RoleFilterValue = (typeof ROLE_FILTER_OPTIONS)[number]["value"];

const RANK_ORDER = ["TCOL", "MAGG", "CAP", "TEN", "STEN"];

const POSITION_LEVEL_ORDER = ["BASSO", "MEDIO", "ELEVATO", "ELEVATISSIMO", "N.D."] as const;
type PositionLevelType = (typeof POSITION_LEVEL_ORDER)[number];

const getPositionLevel = (position: Position) => {
  const raw = position.poInterest?.trim();
  if (!raw) {
    return {
      code: "N.D.",
      description: "N.D.",
      colorClass: "bg-slate-100 text-slate-600 border-slate-200",
      type: "N.D." as PositionLevelType,
      number: null as number | null
    };
  }
  const normalized = raw.toUpperCase().replace(/\s+/g, " ").trim();
  if (normalized === "N.D." || normalized === "ND" || normalized.includes("N.D")) {
    return {
      code: "N.D.",
      description: "N.D.",
      colorClass: "bg-slate-100 text-slate-600 border-slate-200",
      type: "N.D." as PositionLevelType,
      number: null as number | null
    };
  }

  const colorByType = (type: PositionLevelType) => {
    switch (type) {
      case "ELEVATISSIMO":
        return "bg-rose-100 text-rose-700 border-rose-200";
      case "ELEVATO":
        return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "MEDIO":
        return "bg-emerald-100 text-emerald-700 border-emerald-200";
      case "BASSO":
        return "bg-slate-100 text-slate-600 border-slate-200";
      default:
        return "bg-slate-100 text-slate-600 border-slate-200";
    }
  };

  const buildLevel = (type: PositionLevelType, number?: number | null) => {
    const prefix = type === "ELEVATISSIMO"
      ? "EE"
      : type === "ELEVATO"
        ? "E"
        : type === "MEDIO"
          ? "M"
          : type === "BASSO"
            ? "B"
            : "N.D.";
    const numericSuffix = number ? `-${number}` : "";
    const description = number ? `${type}-${number}` : type;
    return {
      code: `${prefix}${numericSuffix}`,
      description,
      colorClass: colorByType(type),
      type,
      number: number ?? null
    };
  };

  const codeMatch = normalized.match(/\b(EE|E|M|B)\s*-?\s*(\d+)?\b/);
  if (codeMatch) {
    const code = codeMatch[1];
    const number = codeMatch[2] ? Number(codeMatch[2]) : null;
    const type =
      code === "EE"
        ? "ELEVATISSIMO"
        : code === "E"
          ? "ELEVATO"
          : code === "M"
            ? "MEDIO"
            : "BASSO";
    return buildLevel(type as PositionLevelType, number);
  }

  const textMatch = normalized.match(/\b(BASSO|MEDIO|ELEVATO|ELEVATISSIMO)\b\s*-?\s*(\d+)?/);
  if (textMatch) {
    const type = textMatch[1] as PositionLevelType;
    const number = textMatch[2] ? Number(textMatch[2]) : null;
    return buildLevel(type, number);
  }

  return {
    code: normalized,
    description: normalized,
    colorClass: "bg-slate-100 text-slate-600 border-slate-200",
    type: "N.D." as PositionLevelType,
    number: null as number | null
  };
};

const PositionLevelBadge: React.FC<{ level: ReturnType<typeof getPositionLevel> }> = ({ level }) => {
  if (!level) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border ${level.colorClass}`}
      title={level.description}
    >
      {level.code}
    </span>
  );
};

const getDistinctPositionLevels = (positions: Position[]) => {
  const map = new Map<string, ReturnType<typeof getPositionLevel>>();
  positions.forEach(position => {
    const level = getPositionLevel(position);
    if (!level) return;
    if (!map.has(level.code)) {
      map.set(level.code, level);
    }
  });
  if (!map.has("N.D.")) {
    map.set("N.D.", {
      code: "N.D.",
      description: "N.D.",
      colorClass: "bg-slate-100 text-slate-600 border-slate-200",
      type: "N.D.",
      number: null
    });
  }
  return Array.from(map.values()).sort((a, b) => {
    const orderA = POSITION_LEVEL_ORDER.indexOf(a.type);
    const orderB = POSITION_LEVEL_ORDER.indexOf(b.type);
    if (orderA !== orderB) return orderA - orderB;
    const numberA = a.number ?? 0;
    const numberB = b.number ?? 0;
    return numberA - numberB;
  });
};

const normalizeProfileCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/[\s.]/g, "")
    .replace(/[^A-Z0-9]/g, "");

const splitRoleOptions = (value: string) =>
  value
    .split(/[\/\n,]+/)
    .map(part => part.trim())
    .filter(Boolean);

const isArmiCode = (code: string) =>
  code.startsWith("AARA") || code.startsWith("AARAN") || code.startsWith("AARAS");

const isNavigantiCode = (code: string) =>
  !isArmiCode(code) &&
  (code.startsWith("AARN") || code.startsWith("AARNN") || code.startsWith("AARNS") || code.startsWith("AA"));

const getRoleFilterValueFromCode = (rawCode: string): RoleFilterValue | null => {
  const code = normalizeProfileCode(rawCode);
  if (!code) return null;
  if (code.startsWith("CSA")) return "SANITARI";
  if (code.startsWith("CC")) return "COMMISSARI";
  if (code.startsWith("GA")) return "GENIO";
  if (isArmiCode(code)) return "ARMI";
  if (isNavigantiCode(code)) return "NAVIGANTI";
  return null;
};

const matchesRoleFilter = (role: RoleFilterValue | null, filter: RoleFilterValue) =>
  filter === "ALL" || role === filter;

const getPositionRoleFilters = (position: Position) => {
  const sources = [position.catSpecQualReq, position.title, position.code].filter(Boolean);
  const roles = new Set<RoleFilterValue>();

  sources.forEach(source => {
    splitRoleOptions(source)
      .map(option => normalizeProfileCode(option))
      .forEach(option => {
        const roleValue = getRoleFilterValueFromCode(option);
        if (roleValue) {
          roles.add(roleValue);
        }
      });
  });

  return roles;
};

const matchesPositionRoleFilter = (position: Position, filter: RoleFilterValue) => {
  if (filter === "ALL") return true;
  const roles = getPositionRoleFilters(position);
  return roles.has(filter);
};

const parseProfileOption = (option: string) => {
  const tokens = option.split(/\s+/).filter(Boolean);
  const role = tokens[0] ?? "";
  const category = tokens[1] ?? "";
  const specialty = tokens.slice(2).join(" ");

  const roleCode = normalizeProfileCode(role);
  const categoryCode = normalizeProfileCode(category);
  const specialtyCode = normalizeProfileCode(specialty);

  return {
    roleCode,
    categoryCode,
    specialtyCode,
    profileCode: `${roleCode}${categoryCode}`,
    fullCode: `${roleCode}${categoryCode}${specialtyCode}`,
    hasCategory: Boolean(categoryCode),
    hasSpecialty: Boolean(specialtyCode)
  };
};

const buildCandidateProfile = (candidate: Candidate) => {
  const roleCode = normalizeProfileCode(candidate.role || "");
  const categoryCode = normalizeProfileCode(candidate.category || "");
  const specialtyCode = normalizeProfileCode(candidate.specialty || "");
  const categorySpecialtyCode = `${categoryCode}${specialtyCode}`;
  const profileCodes = new Set<string>();

  if (roleCode) {
    profileCodes.add(roleCode);
    if (roleCode.length >= 4) {
      profileCodes.add(`${roleCode.slice(0, 2)}${roleCode.slice(2, 4)}`);
    }
  }

  if (roleCode.length >= 4) {
    const rolePrefix = roleCode.slice(0, 2);
    profileCodes.add(rolePrefix);
    if (categoryCode) {
      profileCodes.add(`${rolePrefix}${categoryCode}`);
    }
  }

  if (roleCode.length === 2 && categoryCode) {
    profileCodes.add(`${roleCode}${categoryCode}`);
  }

  return {
    roleCode,
    categoryCode,
    specialtyCode,
    categorySpecialtyCode,
    profileCodes: Array.from(profileCodes),
    fullCode: `${roleCode}${categoryCode}${specialtyCode}`
  };
};

const matchesProfileCode = (requiredCode: string, candidateCode: string) => {
  if (!requiredCode) return true;
  if (!candidateCode) return false;
  if (requiredCode === candidateCode) return true;

  const requiredGroup = PROFILE_CODE_GROUPS[requiredCode];
  const candidateGroup = PROFILE_CODE_GROUPS[candidateCode];

  if (requiredGroup?.includes(candidateCode)) return true;
  if (candidateGroup?.includes(requiredCode)) return true;

  if (requiredCode.length <= 2 && candidateCode.startsWith(requiredCode)) return true;
  if (requiredCode.length <= 4 && candidateCode.startsWith(requiredCode)) return true;

  return false;
};

const profileMatchesRequirement = (candidate: Candidate, requirementRaw: string) => {
  if (!requirementRaw.trim()) return true;

  const candidateProfile = buildCandidateProfile(candidate);
  const options = requirementRaw
    .replace(/\r?\n/g, "/")
    .split("/")
    .map(opt => opt.trim())
    .filter(Boolean);

  return options.some(option => {
    const parsed = parseProfileOption(option);

    if (parsed.hasSpecialty) {
      const specialtyMatches =
        parsed.specialtyCode === candidateProfile.specialtyCode ||
        parsed.specialtyCode === candidateProfile.categorySpecialtyCode;
      if (!specialtyMatches) return false;
    }

    if (parsed.hasCategory) {
      return candidateProfile.profileCodes.some(code => matchesProfileCode(parsed.profileCode, code));
    }

    return candidateProfile.profileCodes.some(code => matchesProfileCode(parsed.roleCode, code));
  });
};

const normalizeRankCode = (value: string) =>
  value
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z]/g, "");

const parseRankRequirements = (rankReq: string) =>
  rankReq
    .split(/[\/,;]|(?:\s+-\s+)/)
    .map(part => normalizeRankCode(part))
    .filter(Boolean);

const rankMatchesRequirement = (candidateRank: string, rankReq: string) => {
  if (!rankReq.trim()) return true;
  const candidateCode = normalizeRankCode(candidateRank);
  const requiredCodes = parseRankRequirements(rankReq).filter(code => RANK_ORDER.includes(code));

  if (!candidateCode || !RANK_ORDER.includes(candidateCode)) return false;
  if (requiredCodes.length === 0) return false;

  if (requiredCodes.length >= 2) {
    return requiredCodes.includes(candidateCode);
  }

  const requiredIndex = RANK_ORDER.indexOf(requiredCodes[0]);
  const candidateIndex = RANK_ORDER.indexOf(candidateCode);
  return Math.abs(candidateIndex - requiredIndex) <= 1;
};

const isCandidateProfileCompatible = (candidate: Candidate, position: Position) => {
  const profileOk = profileMatchesRequirement(candidate, position.catSpecQualReq || "");
  const rankOk = rankMatchesRequirement(candidate.rank || "", position.rankReq || "");
  return profileOk && rankOk;
};

const exportToExcel = (position: Position, candidates: Candidate[], evaluations: Record<string, Evaluation>, positions: Position[]) => {
  const XLSX = getStyledXlsx();
  const baseOrderMap = new Map(candidates.map((c, index) => [c.id, index]));
  const orderedCandidates = [...candidates].sort((a, b) => {
    const evA = evaluations[`${position.code}_${a.id}`];
    const evB = evaluations[`${position.code}_${b.id}`];
    const orderA = evA?.manualOrder ?? baseOrderMap.get(a.id) ?? 0;
    const orderB = evB?.manualOrder ?? baseOrderMap.get(b.id) ?? 0;
    return orderA - orderB;
  });

  // Filter out hidden requirements and split into Essential/Desirable
  const activeReqs = position.requirements.filter(r => !r.hidden);
  const essentialReqs = activeReqs.filter(r => r.type === 'essential');
  const desirableReqs = activeReqs.filter(r => r.type === 'desirable');

  const essentialCount = essentialReqs.length;
  const desirableCount = desirableReqs.length;
  const totalReqsCount = essentialCount + desirableCount;

  const includeOfcn = position.ofcn === "SI";

  const baseHeaders = [
    "Nominativo",
    `Profilo richiesto\n${position.rankReq} \\${position.catSpecQualReq}`,
    "Attribuzioni specifiche/Corsi obbligatori",
    ...(includeOfcn ? ["Idoneità OFCN"] : []),
    `NOS\n${position.nosReq}`,
    `Livello inglese\n${position.englishReq}`
  ];

  // Total columns calculation
  // Fixed Left: baseHeaders
  // Requirements: totalReqsCount
  // Fixed Right: Corso, Data FEO, Ente, Mandati Estero, Parere, Note (6 cols)
  const totalCols = baseHeaders.length + totalReqsCount + 6;

  // --- Build Header Rows ---

  // Row 1: Title
  const titleText = `SCHEDA DISAMINA P.O. ${position.code} ${position.location} ${position.title} (${position.entity})`;
  const row1 = Array(totalCols).fill("");
  row1[0] = titleText;

  // Row 2: Dedalus Index
  const dedalusText = `Indice di funzionalità Dedalus: ${position.poInterest || 'N/A'}`;
  const row2 = Array(totalCols).fill("");
  row2[0] = dedalusText;

  // Row 3: Legend
  const legendText = "in ROSSO la mancanza (o parziale possesso) di quanto previsto per essere eleggibile per la posizione in titolo\nin VERDE l'attinenza dei requisiti degli Ufficiali segnalati a quanto previsto dalla Job description";
  const row3 = Array(totalCols).fill("");
  row3[0] = legendText;

  const requisitiStartCol = baseHeaders.length;

  // Row 5: Group Headers (BASICI | JOB DESCRIPTION | ELEMENTI D'IMPIEGO)
  // NOMINATIVI starts at col 0, spans 1 col, 2 rows (handled by merges)
  const row5 = Array(totalCols).fill("");
  row5[0] = "NOMINATIVI SEGNALATI CON RICERCA PERSONALE"; // Will span A5:A6
  row5[1] = "BASICI"; // Spans base headers (excluding nominativo)
  if (totalReqsCount > 0) {
    row5[requisitiStartCol] = "JOB DESCRIPTION"; // Spans over essential + desirable
  }
  row5[requisitiStartCol + totalReqsCount] = "ELEMENTI D'IMPIEGO"; // Spans rest

  // Row 6: Specific Headers & Essential/Desirable Labels
  const row6 = Array(totalCols).fill("");
  
  // Basici Sub-headers (technically part of the Basici block, but let's put them here for simplicity in this structure)
  // Or rather, Row 6 should contain "ESSENTIAL" and "DESIRABLE" under JOB DESCRIPTION
  // Let's shift content to match image:
  // Image Row 5: BASICI | JOB DESCRIPTION | ELEMENTI
  // Image Row 6: Specific headers for Basici | ESSENTIAL | DESIRABLE | Specific headers for Elementi
  // Image Row 7: Specific Req Text under Essential/Desirable
  
  // Let's adjust to 7 header rows to perfectly match the complexity if needed, 
  // but let's try to fit into the structure provided in the prompt's text which implied row 1-2 merged etc.
  // The prompt says "Row 1... Row 2... then see photo".
  // The photo shows specific columns.
  
  // Let's implement Row 6 as the "ESSENTIAL" / "DESIRABLE" split row.
  if (totalReqsCount > 0) {
    row6[requisitiStartCol] = "ESSENTIAL";
    if (desirableCount > 0) {
      row6[requisitiStartCol + essentialCount] = "DESIRABLE";
    }
  }

  // Row 7: The actual column headers
  const row7 = [
     ...baseHeaders,
     ...essentialReqs.map(r => r.text),
     ...desirableReqs.map(r => r.text),
     "CORSO\nGRADUAT.",
     "Data FEO",
     "Ente FEO",
     "Nr. mandati estero / data ultimo rientro",
     "Parere Com.te",
     "Note"
  ];

  const headerFillBlue = "D9E2F3";
  const nominativoFill = "BFBFBF";
  const white = "FFFFFF";
  const black = "000000";
  const green = "008000";
  const red = "C00000";

  // --- Data Rows ---
  const dataRows = orderedCandidates.map(c => {
    const ev = evaluations[`${position.code}_${c.id}`];
    if (!ev) return null;

    const otherSel = getOtherSelectionInfo(c.id, position.code, evaluations, positions);
    const noteParts = [];
    const isSelected = ev.status === "selected";
    if (isSelected) {
       noteParts.push("INDIVIDUATO");
    }
    if (otherSel) {
       noteParts.push(`INDIVIDUATO PER LA POSIZIONE ${otherSel.code} ${otherSel.title} (${otherSel.entity})`);
    }
    if (c.globalNotes) {
       noteParts.push(c.globalNotes);
    }
    if (ev.notes) {
       noteParts.push(ev.notes);
    }
    const noteText = noteParts.join("\n");

    const mapStatusToText = (s: string) => {
       if (s === 'selected') return 'FAVOREVOLE';
       if (s === 'rejected') return 'NON FAVOREVOLE';
       if (s === 'reserve') return 'POSSIBILE MATCH';
       if (s === 'non-compatible') return 'NON COMPATIBILE';
       if (s === 'excluded') return 'ESCLUSO';
       return '';
    };

    const englishLanguage = c.languages.find(l => l.language === "INGLESE");
    const englishLevelRaw = englishLanguage?.level ?? "";
    const englishLevelDigits = englishLevelRaw.replace(/\D/g, "");
    const englishLevel = englishLevelDigits.length >= 4 ? englishLevelDigits.slice(0, 4) : englishLevelDigits;
    const englishCell = englishLanguage ? `INGLESE\n${englishLevel || englishLevelRaw}` : "";

    const nominativoLabel = `${[c.rank, c.role, c.category, c.specialty].filter(Boolean).join(" ")}\n${c.nominativo}`.trim();
    const profileMatch = isCandidateProfileCompatible(c, position);

    const baseValues = [
       nominativoLabel, // Nominativo
       profileMatch ? "SI" : "NO", // Profilo richiesto match
       c.specificAssignments || "", // Attribuzioni specifiche/Corsi obbligatori
       ...(includeOfcn ? [c.ofcnSuitability || ""] : []), // Idoneità OFCN
       c.nosLevel, // NOS
       englishCell // Inglese
    ];

    const corsoGraduat = [c.category, c.specialty].filter(Boolean).join(" / ");
    const mandatesDetail = [c.internationalMandates, c.mixDescription].filter(Boolean).join("\n");

    return {
      values: [
       ...baseValues,
       ...essentialReqs.map(r => ev.reqEvaluations[r.id] === 'yes' ? 'SI' : ev.reqEvaluations[r.id] === 'no' ? 'NO' : '-'),
       ...desirableReqs.map(r => ev.reqEvaluations[r.id] === 'yes' ? 'SI' : ev.reqEvaluations[r.id] === 'no' ? 'NO' : '-'),
       corsoGraduat, // Corso/Graduat.
       c.feoDate, // Data FEO
       c.serviceEntity, // Ente FEO
       mandatesDetail, // Mandati Estero / data ultimo rientro
       c.commanderOpinion || mapStatusToText(ev.status), // Parere
       noteText // Note
      ],
      isSelected
    };
  }).filter(Boolean);

  // --- Merges ---
  const merges = [
    // Row 1 Title
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    // Row 2 Dedalus
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    // Row 3 Legend
    { s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 1 } },

    // Row 5 Group Headers
    // Nominativi (Rowspan 3: A5-A7)
    { s: { r: 3, c: 0 }, e: { r: 5, c: 0 } },
    // Basici (Colspan base headers excluding nominativo, spanning 2 rows)
    { s: { r: 3, c: 1 }, e: { r: 4, c: baseHeaders.length - 1 } },
    // Job Description (Colspan Total Reqs)
    (totalReqsCount > 0 ? { s: { r: 3, c: requisitiStartCol }, e: { r: 3, c: requisitiStartCol + totalReqsCount - 1 } } : null),
    // Elementi d'Impiego (Colspan 6, spanning 2 rows)
    { s: { r: 3, c: requisitiStartCol + totalReqsCount }, e: { r: 4, c: totalCols - 1 } },

    // Row 6 Sub-headers
    // Essential
    (essentialCount > 0 ? { s: { r: 4, c: requisitiStartCol }, e: { r: 4, c: requisitiStartCol + essentialCount - 1 } } : null),
    // Desirable
    (desirableCount > 0 ? { s: { r: 4, c: requisitiStartCol + essentialCount }, e: { r: 4, c: requisitiStartCol + totalReqsCount - 1 } } : null)
  ].filter(Boolean);

  const candidatesWithoutFeoDate = candidates.filter(candidate => !candidate.feoDate);
  const sampleCandidates = (candidatesWithoutFeoDate.length > 0 ? candidatesWithoutFeoDate : candidates).slice(0, 5);
  console.log("[exportToExcel] candidates sample", sampleCandidates);

  // Combine all rows
  const wsData = [
    row1,
    row2,
    row3,
    row5,
    row6,
    row7,
    ...dataRows.map(row => row.values)
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(wsData);
  if (worksheet["A3"]) {
    worksheet["A3"].t = "s";
    worksheet["A3"].v = legendText;
  }
  worksheet['!merges'] = merges;

  const baseBorder = {
    top: { style: "thin", color: { rgb: black } },
    bottom: { style: "thin", color: { rgb: black } },
    left: { style: "thin", color: { rgb: black } },
    right: { style: "thin", color: { rgb: black } }
  };

  const setCellStyle = (cellAddr: string, style: any) => {
    if (!worksheet[cellAddr]) return;
    worksheet[cellAddr].s = style;
  };

  const makeStyle = ({
    bold = false,
    size = 10,
    color = black,
    fill = white,
    align = "center",
    valign = "center",
    wrap = true,
    border = baseBorder
  }: {
    bold?: boolean;
    size?: number;
    color?: string;
    fill?: string;
    align?: "center" | "left" | "right";
    valign?: "center" | "top" | "bottom";
    wrap?: boolean;
    border?: typeof baseBorder;
  }) => ({
    font: { name: "Calibri", sz: size, bold, color: { rgb: color } },
    alignment: { horizontal: align, vertical: valign, wrapText: wrap },
    fill: { patternType: "solid", fgColor: { rgb: fill } },
    border
  });

  const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      if (!worksheet[cellAddr]) {
        worksheet[cellAddr] = { t: "s", v: "" };
      }
      setCellStyle(cellAddr, makeStyle({}));
    }
  }

  // Title row
  for (let c = 0; c < totalCols; c += 1) {
    setCellStyle(XLSX.utils.encode_cell({ r: 0, c }), makeStyle({ bold: true, size: 12 }));
  }
  // Dedalus row
  for (let c = 0; c < totalCols; c += 1) {
    setCellStyle(XLSX.utils.encode_cell({ r: 1, c }), makeStyle({ bold: true, size: 10 }));
  }
  // Legend row
  for (let c = 0; c < totalCols; c += 1) {
    setCellStyle(XLSX.utils.encode_cell({ r: 2, c }), makeStyle({ size: 9 }));
  }
  // Group header row
  for (let c = 0; c < totalCols; c += 1) {
    setCellStyle(XLSX.utils.encode_cell({ r: 3, c }), makeStyle({ bold: true, fill: headerFillBlue }));
  }
  // Essential/Desirable row
  for (let c = 0; c < totalCols; c += 1) {
    setCellStyle(XLSX.utils.encode_cell({ r: 4, c }), makeStyle({ bold: true, fill: headerFillBlue }));
  }
  // Column headers row
  for (let c = 0; c < totalCols; c += 1) {
    setCellStyle(XLSX.utils.encode_cell({ r: 5, c }), makeStyle({ bold: true, fill: headerFillBlue, size: 9, align: "center" }));
  }

  // Nominativo header cell (white background)
  [3, 4, 5].forEach((r) => {
    setCellStyle(XLSX.utils.encode_cell({ r, c: 0 }), makeStyle({ bold: true, fill: white, size: 9 }));
  });

  // Data rows
  dataRows.forEach((row, idx) => {
    const r = 6 + idx;
    row.values.forEach((value, c) => {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      if (!worksheet[cellAddr]) return;
      let color = black;
      let bold = false;
      if (value === "SI") color = green;
      if (value === "NO") color = red;
      const fill = c === 0 ? nominativoFill : white;
      if (row.isSelected && c === totalCols - 1) {
        color = green;
        bold = true;
      }
      const borderStyle = row.isSelected ? "thick" : "thin";
      const borderColor = row.isSelected ? green : black;
      const outerBorder = row.isSelected
        ? {
            top: { style: borderStyle, color: { rgb: borderColor } },
            bottom: { style: borderStyle, color: { rgb: borderColor } },
            left: {
              style: c === 0 ? borderStyle : "thin",
              color: { rgb: c === 0 ? borderColor : black }
            },
            right: {
              style: c === totalCols - 1 ? borderStyle : "thin",
              color: { rgb: c === totalCols - 1 ? borderColor : black }
            }
          }
        : {
            top: { style: "thin", color: { rgb: black } },
            bottom: { style: "thin", color: { rgb: black } },
            left: { style: "thin", color: { rgb: black } },
            right: { style: "thin", color: { rgb: black } }
          };
      setCellStyle(
        cellAddr,
        makeStyle({
          color,
          bold,
          fill,
          align: c === 0 ? "center" : "center",
          valign: "center",
          border: outerBorder
        })
      );
    });
  });

  const baseColumnWidths = [
    { wch: 28 }, // Nominativo
    { wch: 16 }, // Profilo richiesto
    { wch: 24 }, // Attribuzioni specifiche/Corsi obbligatori
    ...(includeOfcn ? [{ wch: 12 }] : []), // Idoneità OFCN
    { wch: 12 }, // NOS
    { wch: 16 } // Inglese
  ];

  worksheet["!cols"] = [
    ...baseColumnWidths,
    ...essentialReqs.map(() => ({ wch: 18 })),
    ...desirableReqs.map(() => ({ wch: 18 })),
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 14 },
    { wch: 26 }
  ];

  worksheet["!rows"] = [
    { hpt: 20 },
    { hpt: 18 },
    { hpt: 30 },
    { hpt: 22 },
    { hpt: 18 },
    { hpt: 44 },
    ...dataRows.map(() => ({ hpt: 36 }))
  ];
  
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Scheda Disamina");
  
  // Save file
  XLSX.writeFile(workbook, `Scheda_Disamina_${position.code}.xlsx`, { cellStyles: true });
};

// --- New View Components ---

const FileUploadView = ({ onDataLoaded }: { onDataLoaded: (c: Candidate[], p: Position[], stats: ImportStats) => void }) => {
  const [candidatesFiles, setCandidatesFiles] = useState<File[]>([]);
  const [positionsFiles, setPositionsFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>, type: 'c' | 'p') => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (type === 'c') setCandidatesFiles(files);
    else setPositionsFiles(files);
    setError("");
  };

  const processFiles = async () => {
    if (candidatesFiles.length === 0 || positionsFiles.length === 0) {
      setError("Please select both files.");
      return;
    }
    setLoading(true);
    setError("");

    try {
      const [candidatesRows, positionsRows] = await Promise.all([
        readExcelFiles(candidatesFiles, "candidati"),
        readExcelFiles(positionsFiles, "posizioni")
      ]);
      const candidatesResult = parseCandidates(candidatesRows);
      const positionsResult = parsePositions(positionsRows);

      const candidates = candidatesResult.items;
      const positions = positionsResult.items;

      if (candidates.length === 0 || positions.length === 0) {
        throw new Error("No valid data found in one or both files.");
      }

      const stats: ImportStats = {
        candidates: {
          imported: candidatesResult.items.length,
          duplicates: candidatesResult.duplicateCount,
          totalRows: candidatesResult.totalRows
        },
        positions: {
          imported: positionsResult.items.length,
          duplicates: positionsResult.duplicateCount,
          totalRows: positionsResult.totalRows
        }
      };
      onDataLoaded(candidates, positions, stats);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Error processing files");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full border border-slate-200">
        <div className="flex justify-center mb-6">
           <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center text-blue-600">
             <Upload className="w-8 h-8" />
           </div>
        </div>
        <h1 className="text-2xl font-bold text-center text-slate-800 mb-2">Import Data</h1>
        <p className="text-center text-slate-500 mb-8">Upload the Excel files to begin.</p>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Candidates List (Excel)</label>
            <input type="file" accept=".xlsx, .xls" multiple onChange={(e) => handleFileChange(e, 'c')} 
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
            {candidatesFiles.length > 0 && (
              <ul className="mt-2 text-xs text-slate-500 list-disc list-inside space-y-1">
                {candidatesFiles.map((file) => (
                  <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Positions List (Excel)</label>
            <input type="file" accept=".xlsx, .xls" multiple onChange={(e) => handleFileChange(e, 'p')}
              className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"/>
            {positionsFiles.length > 0 && (
              <ul className="mt-2 text-xs text-slate-500 list-disc list-inside space-y-1">
                {positionsFiles.map((file) => (
                  <li key={`${file.name}-${file.lastModified}`}>{file.name}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 bg-red-50 text-red-600 text-sm rounded flex items-center gap-2">
            <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        <Button onClick={processFiles} disabled={loading} className="w-full mt-6 justify-center">
          {loading ? 'Processing...' : 'Start Import'}
        </Button>
      </div>
    </div>
  );
};

const SettingsPanel = ({
  isOpen,
  onClose,
  candidatesCount,
  positionsCount,
  onSelectCandidatesFiles,
  onSelectPositionsFiles,
  onClearCandidates,
  onClearPositions,
  onExportBackup,
  onBackupUpload,
  backupError,
  backupSuccess,
  fileError,
  fileSuccess,
  isProcessing,
  onResetData
}: {
  isOpen: boolean;
  onClose: () => void;
  candidatesCount: number;
  positionsCount: number;
  onSelectCandidatesFiles: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectPositionsFiles: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onClearCandidates: () => void;
  onClearPositions: () => void;
  onExportBackup: () => void;
  onBackupUpload: (event: React.ChangeEvent<HTMLInputElement>) => void;
  backupError: string;
  backupSuccess: string;
  fileError: string;
  fileSuccess: string;
  isProcessing: boolean;
  onResetData: () => void;
}) => {
  const candidatesInputRef = useRef<HTMLInputElement | null>(null);
  const positionsInputRef = useRef<HTMLInputElement | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />
      <div
        className="absolute right-0 top-0 h-full w-full max-w-xl bg-white shadow-xl flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Impostazioni</h2>
            <p className="text-xs text-slate-500">Gestisci file utilizzati, backup e reset.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Chiudi impostazioni"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">File utilizzati</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Gestisci i file di persone e posizioni caricati nel ciclo corrente.
                </p>
              </div>
              <span className="text-xs text-slate-400">Dati correnti</span>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-700">File persone</div>
                  <span className="text-xs text-slate-500">{candidatesCount} profili</span>
                </div>
                <div className="text-xs text-slate-500">
                  Aggiungi nuovi file Excel per integrare o aggiornare i candidati presenti.
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="secondary"
                    className="justify-center"
                    disabled={isProcessing}
                    onClick={() => candidatesInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4" /> Aggiungi file persone
                  </Button>
                  <button
                    type="button"
                    onClick={onClearCandidates}
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    Elimina tutti i dati persone
                  </button>
                  <input
                    ref={candidatesInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    multiple
                    className="hidden"
                    onChange={onSelectCandidatesFiles}
                  />
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-700">File posizioni</div>
                  <span className="text-xs text-slate-500">{positionsCount} posizioni</span>
                </div>
                <div className="text-xs text-slate-500">
                  Aggiungi nuovi file Excel per integrare o aggiornare le posizioni.
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="secondary"
                    className="justify-center"
                    disabled={isProcessing}
                    onClick={() => positionsInputRef.current?.click()}
                  >
                    <Upload className="w-4 h-4" /> Aggiungi file posizioni
                  </Button>
                  <button
                    type="button"
                    onClick={onClearPositions}
                    className="text-xs text-red-500 hover:text-red-600"
                  >
                    Elimina tutti i dati posizioni
                  </button>
                  <input
                    ref={positionsInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    multiple
                    className="hidden"
                    onChange={onSelectPositionsFiles}
                  />
                </div>
              </div>
            </div>
            {(fileError || fileSuccess) && (
              <div
                className={`text-xs rounded-md px-3 py-2 flex items-center gap-2 border ${
                  fileError ? "text-red-600 bg-red-50 border-red-200" : "text-emerald-600 bg-emerald-50 border-emerald-200"
                }`}
              >
                {fileError ? <AlertTriangle className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                {fileError || fileSuccess}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Gestione backup</h3>
              <p className="text-xs text-slate-500 mt-1">
                Scarica o carica un backup completo delle impostazioni correnti.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Button variant="secondary" className="justify-center" onClick={onExportBackup}>
                <Download className="w-4 h-4" /> Scarica backup
              </Button>
              <Button
                variant="secondary"
                className="justify-center"
                onClick={() => backupInputRef.current?.click()}
              >
                <Upload className="w-4 h-4" /> Carica backup
              </Button>
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={onBackupUpload}
              />
              {backupError && (
                <div className="text-xs text-red-600 flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3" /> {backupError}
                </div>
              )}
              {backupSuccess && !backupError && (
                <div className="text-xs text-emerald-600 flex items-center gap-2">
                  <Check className="w-3 h-3" /> {backupSuccess}
                </div>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Reset data</h3>
              <p className="text-xs text-slate-500 mt-1">
                Cancella tutte le valutazioni e ripristina lo stato iniziale del ciclo.
              </p>
            </div>
            <button
              type="button"
              onClick={onResetData}
              className="inline-flex items-center gap-2 text-red-500 hover:text-red-600 text-sm font-semibold"
            >
              <Trash2 className="w-4 h-4" /> Reset data
            </button>
          </section>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Chiudi
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
};

const CandidatesListView = ({
   candidates,
   positions,
   evaluations,
   onNavigateToPosition,
   onOpenCandidateDetail
}: {
   candidates: Candidate[];
   positions: Position[];
   evaluations: Record<string, Evaluation>;
   onNavigateToPosition: (code: string) => void;
   onOpenCandidateDetail: (id: string) => void;
}) => {
   const [search, setSearch] = useState("");
   const [roleFilter, setRoleFilter] = useState<RoleFilterValue>("ALL");
   const getApplicationStatusClass = (status?: Evaluation["status"]) => {
      switch (status) {
         case "selected":
            return "bg-green-100 text-green-700 border-green-200";
         case "reserve":
            return "bg-amber-100 text-amber-800 border-amber-200";
         case "rejected":
            return "bg-red-100 text-red-700 border-red-200";
         case "non-compatible":
            return "bg-gray-200 text-gray-700 border-gray-300";
         case "excluded":
            return "bg-red-200 text-red-900 border-red-300";
         case "pending":
         default:
            return "bg-slate-100 text-slate-600 border-slate-200 hover:border-slate-300";
      }
   };

   const filtered = candidates.filter(c => 
      c.nominativo.toLowerCase().includes(search.toLowerCase()) ||
      c.id.toLowerCase().includes(search.toLowerCase()) ||
      c.rank.toLowerCase().includes(search.toLowerCase())
   ).filter(candidate => {
      const roleValue = getRoleFilterValueFromCode(candidate.role || "");
      return matchesRoleFilter(roleValue, roleFilter);
   });

   return (
      <div className="flex flex-col h-full bg-slate-50">
         <header className="bg-white border-b border-slate-200 px-8 py-4">
            <h1 className="text-2xl font-bold text-slate-800 mb-4">Candidates Directory</h1>
            <div className="flex flex-wrap items-center gap-3">
               <div className="relative max-w-md flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                     type="text"
                     placeholder="Search candidates by name, ID, or rank..."
                     className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                     value={search}
                     onChange={(e) => setSearch(e.target.value)}
                  />
               </div>
               <select
                  className="px-4 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  value={roleFilter}
                  onChange={(event) => setRoleFilter(event.target.value as RoleFilterValue)}
               >
                  {ROLE_FILTER_OPTIONS.map(option => (
                     <option key={option.value} value={option.value}>
                        {option.label}
                     </option>
                  ))}
               </select>
            </div>
         </header>
         <div className="flex-1 overflow-y-auto p-8">
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
               <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                     <tr>
                        <th className="px-6 py-3 font-semibold text-slate-600">Candidate</th>
                        <th className="px-6 py-3 font-semibold text-slate-600">Rank & Role</th>
                        <th className="px-6 py-3 font-semibold text-slate-600">Applications</th>
                        <th className="px-6 py-3 font-semibold text-slate-600">Actions</th>
                     </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                     {filtered.map(c => {
                        const apps = positions.filter(p => !!evaluations[`${p.code}_${c.id}`]);
                        return (
                           <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-6 py-4">
                                 <div className="font-bold text-slate-900">{c.nominativo}</div>
                                 <div className="text-xs text-slate-500 font-mono">{c.id}</div>
                              </td>
                              <td className="px-6 py-4">
                                 <div className="text-slate-700">{c.rank}</div>
                                 <div className="text-xs text-slate-500">{c.role} {c.category} {c.specialty}</div>
                              </td>
                              <td className="px-6 py-4">
                                 <div className="flex flex-wrap gap-1">
                                    {apps.map(p => {
                                       const ev = evaluations[`${p.code}_${c.id}`];
                                       return (
                                          <button 
                                             key={p.code}
                                             onClick={() => onNavigateToPosition(p.code)}
                                             className={`text-xs px-2 py-0.5 rounded border ${getApplicationStatusClass(ev?.status)}`}
                                          >
                                             {p.code}
                                          </button>
                                       )
                                    })}
                                    {apps.length === 0 && <span className="text-slate-400 text-xs italic">No active applications</span>}
                                 </div>
                              </td>
                              <td className="px-6 py-4">
                                 <Button variant="secondary" className="h-8 px-3 text-xs" onClick={() => onOpenCandidateDetail(c.id)}>
                                    View Profile
                                 </Button>
                              </td>
                           </tr>
                        );
                     })}
                  </tbody>
               </table>
               {filtered.length === 0 && <div className="p-8 text-center text-slate-500">No candidates found.</div>}
            </div>
         </div>
      </div>
   );
};

const OverlapKanbanView = ({
  candidates,
  positions,
  evaluations,
  selectedPositionIds,
  onSelectedPositionsChange,
  onUpdate
}: {
  candidates: Candidate[];
  positions: Position[];
  evaluations: Record<string, Evaluation>;
  selectedPositionIds: string[];
  onSelectedPositionsChange: (ids: string[]) => void;
  onUpdate: (ev: Evaluation) => void;
}) => {
  const [onlyPossibleMatch, setOnlyPossibleMatch] = useState(false);
  const [positionSearch, setPositionSearch] = useState("");
  const [positionLevelFilter, setPositionLevelFilter] = useState("ALL");
  const [positionRoleFilter, setPositionRoleFilter] = useState<RoleFilterValue>("ALL");
  const [candidateRoleFilter, setCandidateRoleFilter] = useState<RoleFilterValue>("ALL");
  const [matchDrawerData, setMatchDrawerData] = useState<{
    candidateId: string;
    positionId: string;
  } | null>(null);
  const [draggingCandidateId, setDraggingCandidateId] = useState<string | null>(null);
  const [isPositionsOpen, setIsPositionsOpen] = useState(true);
  const [focusedCandidateId, setFocusedCandidateId] = useState<string | null>(null);
  const [openStatusEvaluationId, setOpenStatusEvaluationId] = useState<string | null>(null);
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(true);
  const dragPreviewRef = useRef<HTMLElement | null>(null);
  const kanbanScrollRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const registerKanbanScrollRef = useCallback(
    (positionCode: string) => (node: HTMLDivElement | null) => {
      if (!node) {
        kanbanScrollRefs.current.delete(positionCode);
        return;
      }
      kanbanScrollRefs.current.set(positionCode, node);
    },
    []
  );

  const focusCandidateAcrossKanbans = useCallback(
    (candidateId: string, sourcePositionCode?: string) => {
      setFocusedCandidateId(candidateId);
      requestAnimationFrame(() => {
        kanbanScrollRefs.current.forEach((container, positionCode) => {
          if (positionCode === sourcePositionCode) return;
          const target = container.querySelector(
            `[data-candidate-id="${candidateId}"]`
          ) as HTMLElement | null;
          if (!target) return;
          target.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      });
    },
    []
  );

  const clearDragPreview = useCallback(() => {
    if (dragPreviewRef.current) {
      dragPreviewRef.current.remove();
      dragPreviewRef.current = null;
    }
  }, []);

  const candidateIdsByPosition = useMemo(() => {
    const map = new Map<string, Set<string>>();
    positions.forEach(position => map.set(position.code, new Set()));
    Object.values(evaluations).forEach(ev => {
      if (ev.status === "excluded") return;
      const candidateSet = map.get(ev.positionId);
      if (candidateSet) {
        candidateSet.add(ev.candidateId);
      }
    });
    return map;
  }, [positions, evaluations]);

  const candidateById = useMemo(() => {
    return new Map(candidates.map(candidate => [candidate.id, candidate]));
  }, [candidates]);

  const positionById = useMemo(() => {
    return new Map(positions.map(position => [position.code, position]));
  }, [positions]);

  const overlapData = useMemo(() => computeOverlaps(positions, evaluations), [positions, evaluations]);

  const selectedCandidateIds = useMemo(() => {
    const ids = new Set<string>();
    selectedPositionIds.forEach(code => {
      candidateIdsByPosition.get(code)?.forEach(candidateId => ids.add(candidateId));
    });
    return ids;
  }, [selectedPositionIds, candidateIdsByPosition]);

  const suggestedPositions = useMemo(() => {
    if (selectedPositionIds.length === 0) return [];

    return overlapData
      .filter(({ position }) => !selectedPositionIds.includes(position.code))
      .map(({ position }) => {
        const candidateIds = candidateIdsByPosition.get(position.code) ?? new Set<string>();
        let sharedCount = 0;
        candidateIds.forEach(candidateId => {
          if (selectedCandidateIds.has(candidateId)) {
            sharedCount += 1;
          }
        });
        return { position, sharedCount };
      })
      .filter(entry => entry.sharedCount > 0)
      .filter(entry => matchesPositionRoleFilter(entry.position, positionRoleFilter))
      .sort((a, b) => {
        if (b.sharedCount !== a.sharedCount) return b.sharedCount - a.sharedCount;
        return a.position.code.localeCompare(b.position.code);
      });
  }, [overlapData, selectedPositionIds, candidateIdsByPosition, selectedCandidateIds, positionRoleFilter]);

  const sortedPositions = useMemo(
    () => [...positions].sort((a, b) => a.code.localeCompare(b.code)),
    [positions]
  );

  const distinctLevels = useMemo(() => getDistinctPositionLevels(positions), [positions]);

  const filteredPositions = useMemo(() => {
    const term = positionSearch.trim().toLowerCase();
    return sortedPositions.filter(pos => {
      const haystack = `${pos.code} ${pos.title} ${pos.entity} ${pos.location}`.toLowerCase();
      const matchesSearch = !term || haystack.includes(term);
      const level = getPositionLevel(pos);
      const matchesLevel = positionLevelFilter === "ALL" || level?.code === positionLevelFilter;
      const matchesRole = matchesPositionRoleFilter(pos, positionRoleFilter);
      return matchesSearch && matchesLevel && matchesRole;
    });
  }, [positionSearch, sortedPositions, positionLevelFilter, positionRoleFilter]);

  const selectedPositions = useMemo(
    () =>
      sortedPositions.filter(pos => {
        if (!selectedPositionIds.includes(pos.code)) return false;
        return matchesPositionRoleFilter(pos, positionRoleFilter);
      }),
    [sortedPositions, selectedPositionIds, positionRoleFilter]
  );

  const handleTogglePosition = (code: string) => {
    if (selectedPositionIds.includes(code)) {
      onSelectedPositionsChange(selectedPositionIds.filter(id => id !== code));
    } else {
      onSelectedPositionsChange([...selectedPositionIds, code]);
    }
  };

  const handleSelectAll = () => {
    onSelectedPositionsChange(filteredPositions.map(pos => pos.code));
  };

  const handleClearAll = () => {
    onSelectedPositionsChange([]);
  };

  const matchesPossible = (status: Evaluation["status"]) =>
    status !== "rejected" && status !== "non-compatible" && status !== "excluded";

  const getStatusBadge = (status: Evaluation["status"]) => {
    switch (status) {
      case "selected":
        return { label: "Selected", color: "green" };
      case "reserve":
        return { label: "POSSIBILE MATCH", color: "amber" };
      case "rejected":
        return { label: "Rejected", color: "slate" };
      case "non-compatible":
        return { label: "Non compatibile", color: "slate" };
      case "excluded":
        return { label: "Escluso", color: "red" };
      default:
        return { label: "Pending", color: "blue" };
    }
  };

  const statusOptions: { value: Evaluation["status"]; label: string }[] = [
    { value: "pending", label: "Pending" },
    { value: "selected", label: "Selected" },
    { value: "reserve", label: "Possibile match" },
    { value: "rejected", label: "Rejected" },
    { value: "non-compatible", label: "Non compatibile" },
    { value: "excluded", label: "Escluso" }
  ];

  const handleDragStart = useCallback(
    (candidateId: string) => (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", candidateId);
      const target = event.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      clearDragPreview();
      const dragPreview = target.cloneNode(true) as HTMLElement;
      dragPreview.style.position = "fixed";
      dragPreview.style.top = `${rect.top}px`;
      dragPreview.style.left = `${rect.left}px`;
      dragPreview.style.width = `${rect.width}px`;
      dragPreview.style.margin = "0";
      dragPreview.style.pointerEvents = "none";
      dragPreview.style.zIndex = "9999";
      dragPreview.style.boxShadow = "0 16px 30px rgba(15, 23, 42, 0.2)";
      dragPreview.style.transform = "translateZ(0)";
      dragPreview.style.opacity = "0.95";
      document.body.appendChild(dragPreview);
      event.dataTransfer.setDragImage(
        dragPreview,
        event.clientX - rect.left,
        event.clientY - rect.top
      );
      dragPreviewRef.current = dragPreview;
      setDraggingCandidateId(candidateId);
    },
    [clearDragPreview]
  );

  const handleDragEnd = useCallback(() => {
    setDraggingCandidateId(null);
    clearDragPreview();
  }, [clearDragPreview]);

  useEffect(() => {
    if (!draggingCandidateId) {
      clearDragPreview();
    }
  }, [draggingCandidateId, clearDragPreview]);

  const handleDragOverSlot = useCallback(
    (positionCode: string) => (event: React.DragEvent<HTMLDivElement>) => {
      if (!draggingCandidateId) return;
      if (!evaluations[`${positionCode}_${draggingCandidateId}`]) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    },
    [draggingCandidateId, evaluations]
  );

  const handleDropSlot = useCallback(
    (positionCode: string) => (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const candidateId = draggingCandidateId || event.dataTransfer.getData("text/plain");
      if (!candidateId) return;
      const evaluation = evaluations[`${positionCode}_${candidateId}`];
      if (!evaluation) {
        setDraggingCandidateId(null);
        return;
      }
      onUpdate({ ...evaluation, status: "selected" });
      setDraggingCandidateId(null);
    },
    [draggingCandidateId, evaluations, onUpdate]
  );

  const getOverlapMetric = useCallback(
    (positionCode: string) => {
      const candidateIds = candidateIdsByPosition.get(positionCode) ?? new Set<string>();
      if (candidateIds.size === 0) return { sharedCount: 0, overlapPercent: 0 };
      const otherSelectedIds = new Set<string>();
      selectedPositionIds.forEach(code => {
        if (code === positionCode) return;
        candidateIdsByPosition.get(code)?.forEach(candidateId => otherSelectedIds.add(candidateId));
      });
      let sharedCount = 0;
      candidateIds.forEach(candidateId => {
        if (otherSelectedIds.has(candidateId)) sharedCount += 1;
      });
      const overlapPercent = Math.round((sharedCount / candidateIds.size) * 100);
      return { sharedCount, overlapPercent };
    },
    [candidateIdsByPosition, selectedPositionIds]
  );

  const getOverlapCountForPosition = useCallback(
    (positionCode: string) => {
      if (selectedPositionIds.length === 0) return 0;
      const candidateIds = candidateIdsByPosition.get(positionCode) ?? new Set<string>();
      const otherSelectedIds = new Set<string>();
      selectedPositionIds.forEach(code => {
        if (code === positionCode) return;
        candidateIdsByPosition.get(code)?.forEach(candidateId => otherSelectedIds.add(candidateId));
      });
      let sharedCount = 0;
      candidateIds.forEach(candidateId => {
        if (otherSelectedIds.has(candidateId)) sharedCount += 1;
      });
      return sharedCount;
    },
    [candidateIdsByPosition, selectedPositionIds]
  );

  const candidateOverlapSuggestions = useMemo(() => {
    if (!focusedCandidateId) return [];
    return positions
      .filter(position => !!evaluations[`${position.code}_${focusedCandidateId}`])
      .filter(position => !selectedPositionIds.includes(position.code))
      .filter(position => matchesPositionRoleFilter(position, positionRoleFilter))
      .map(position => ({
        position,
        overlapCount: getOverlapCountForPosition(position.code)
      }))
      .sort((a, b) => {
        if (b.overlapCount !== a.overlapCount) return b.overlapCount - a.overlapCount;
        return a.position.code.localeCompare(b.position.code);
      });
  }, [
    focusedCandidateId,
    positions,
    evaluations,
    selectedPositionIds,
    getOverlapCountForPosition,
    positionRoleFilter
  ]);

  const matchDrawerCandidate = matchDrawerData
    ? candidateById.get(matchDrawerData.candidateId) ?? null
    : null;
  const matchDrawerPosition = matchDrawerData
    ? positionById.get(matchDrawerData.positionId) ?? null
    : null;
  const matchDrawerEvaluation = matchDrawerData
    ? evaluations[`${matchDrawerData.positionId}_${matchDrawerData.candidateId}`] ?? null
    : null;

  useEffect(() => {
    if (matchDrawerData && (!matchDrawerCandidate || !matchDrawerPosition || !matchDrawerEvaluation)) {
      setMatchDrawerData(null);
    }
  }, [matchDrawerData, matchDrawerCandidate, matchDrawerPosition, matchDrawerEvaluation]);

  return (
    <div className="flex flex-col h-full bg-slate-50 relative overflow-x-hidden">
      <div className="absolute right-4 top-4 z-20">
        <div className="bg-white border border-slate-200 shadow-lg rounded-lg overflow-hidden w-72 flex flex-col">
          <div className="px-3 py-2 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-semibold text-slate-700">Posizioni suggerite</div>
              {focusedCandidateId && (
                <div className="text-[10px] text-slate-500">
                  per {candidateById.get(focusedCandidateId)?.nominativo}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {focusedCandidateId && (
                <button
                  type="button"
                  onClick={() => setFocusedCandidateId(null)}
                  className="text-[10px] text-slate-400 hover:text-slate-600"
                >
                  Rimuovi candidato
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsSuggestionsOpen((prev) => !prev)}
                className="text-slate-400 hover:text-slate-600"
                aria-label={isSuggestionsOpen ? "Comprimi suggerimenti" : "Espandi suggerimenti"}
              >
                <ChevronRight className={`w-4 h-4 transition-transform ${isSuggestionsOpen ? "rotate-90" : ""}`} />
              </button>
            </div>
          </div>
          {isSuggestionsOpen && (
            <div className="px-3 pb-3 space-y-2 max-h-64 overflow-y-auto">
              {focusedCandidateId && candidateOverlapSuggestions.length === 0 && (
                <p className="text-xs text-slate-400 italic">
                  Nessuna posizione suggerita per il candidato selezionato.
                </p>
              )}
              {focusedCandidateId && candidateOverlapSuggestions.length > 0 && (
                <div className="space-y-2">
                  {candidateOverlapSuggestions.map(({ position, overlapCount }) => (
                    <button
                      key={position.code}
                      onClick={() => onSelectedPositionsChange([...selectedPositionIds, position.code])}
                      className="w-full text-left border border-slate-200 rounded-md px-3 py-2 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-slate-500">{position.code}</span>
                        <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                          {overlapCount} in overlap
                        </span>
                      </div>
                      <div className="mt-1">
                        <PositionLevelBadge level={getPositionLevel(position)} />
                      </div>
                      <div className="text-xs text-slate-700 font-medium leading-snug mt-1">
                        {position.title}
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!focusedCandidateId && selectedPositionIds.length === 0 && (
                <p className="text-xs text-slate-400 italic">
                  Seleziona una posizione o un candidato per vedere i suggerimenti.
                </p>
              )}
              {!focusedCandidateId && selectedPositionIds.length > 0 && suggestedPositions.length === 0 && (
                <p className="text-xs text-slate-400 italic">
                  Nessuna posizione suggerita con candidati in comune.
                </p>
              )}
              {!focusedCandidateId && selectedPositionIds.length > 0 && suggestedPositions.length > 0 && (
                <div className="space-y-2">
                  {suggestedPositions.map(({ position, sharedCount }) => (
                    <button
                      key={position.code}
                      onClick={() => onSelectedPositionsChange([...selectedPositionIds, position.code])}
                      className="w-full text-left border border-slate-200 rounded-md px-3 py-2 hover:border-blue-300 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs text-slate-500">{position.code}</span>
                        <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
                          {sharedCount} in comune
                        </span>
                      </div>
                      <div className="mt-1">
                        <PositionLevelBadge level={getPositionLevel(position)} />
                      </div>
                      <div className="text-xs text-slate-700 font-medium leading-snug mt-1">
                        {position.title}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex min-w-0">
        <aside
          className={`border-r border-slate-200 bg-white overflow-y-auto transition-all duration-300 ${
            isPositionsOpen ? "w-80" : "w-12"
          }`}
        >
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            {isPositionsOpen ? (
              <div>
                <h3 className="text-sm font-semibold text-slate-700">Posizioni selezionate</h3>
                <p className="text-xs text-slate-400">Filtra e suggerimenti overlap.</p>
              </div>
            ) : (
              <div className="w-full flex items-center justify-center">
                <Briefcase className="w-4 h-4 text-slate-400" />
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsPositionsOpen((prev) => !prev)}
              className="text-slate-400 hover:text-slate-600"
              aria-label={isPositionsOpen ? "Comprimi pannello posizioni" : "Espandi pannello posizioni"}
            >
              {isPositionsOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            </button>
          </div>
          {isPositionsOpen && (
            <div className="p-4 space-y-4">
              <label className="flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={onlyPossibleMatch}
                  onChange={(event) => setOnlyPossibleMatch(event.target.checked)}
                />
                Solo Possibile match
              </label>
              <div className="flex items-center justify-between mb-1">
                <div className="text-xs text-slate-500">Gestione selezioni</div>
                <div className="flex items-center gap-2 text-xs">
                  <button onClick={handleSelectAll} className="text-blue-600 hover:underline">
                    Seleziona tutte
                  </button>
                  <span className="text-slate-300">|</span>
                  <button onClick={handleClearAll} className="text-slate-500 hover:underline">
                    Pulisci
                  </button>
                </div>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={positionSearch}
                  onChange={(event) => setPositionSearch(event.target.value)}
                  placeholder="Cerca posizione..."
                  className="w-full border border-slate-200 rounded-md py-2 pl-9 pr-3 text-xs text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none"
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  className="w-full border border-slate-200 rounded-md py-2 px-2 text-xs text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={positionLevelFilter}
                  onChange={(event) => setPositionLevelFilter(event.target.value)}
                >
                  <option value="ALL">Tutti i livelli</option>
                  {distinctLevels.map(level => (
                    <option key={level.code} value={level.code}>
                      {level.code} • {level.description}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-600">
                <User className="w-3.5 h-3.5 text-slate-400" />
                <select
                  className="w-full border border-slate-200 rounded-md py-2 px-2 text-xs text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                  value={positionRoleFilter}
                  onChange={(event) => setPositionRoleFilter(event.target.value as RoleFilterValue)}
                >
                  {ROLE_FILTER_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                {filteredPositions.map(pos => {
                  const totalCandidates = candidateIdsByPosition.get(pos.code)?.size ?? 0;
                  const overlapCount = getOverlapCountForPosition(pos.code);
                  const level = getPositionLevel(pos);
                  return (
                    <label key={pos.code} className="flex items-start gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        checked={selectedPositionIds.includes(pos.code)}
                        onChange={() => handleTogglePosition(pos.code)}
                      />
                      <span className="flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-slate-500">{pos.code}</span>
                          <PositionLevelBadge level={level} />
                        </span>
                        <span className="block text-slate-700 font-medium leading-snug">{pos.title}</span>
                        <span className="mt-1 text-[10px] text-slate-400 flex gap-2">
                          <span>Segnalati: {totalCandidates}</span>
                          <span>Overlap: {overlapCount}</span>
                        </span>
                      </span>
                    </label>
                  );
                })}
                {filteredPositions.length === 0 && (
                  <div className="text-xs text-slate-400 italic">Nessuna posizione trovata.</div>
                )}
              </div>

            </div>
          )}
        </aside>

        <div className="flex-1 overflow-x-hidden p-6 pt-20 min-w-0">
          <div className="flex items-center gap-2 text-xs text-slate-600 mb-4">
            <User className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-slate-500">Filtro candidati</span>
            <select
              className="border border-slate-200 rounded-md py-2 px-2 text-xs text-slate-600 focus:ring-2 focus:ring-blue-500 outline-none bg-white"
              value={candidateRoleFilter}
              onChange={(event) => setCandidateRoleFilter(event.target.value as RoleFilterValue)}
            >
              {ROLE_FILTER_OPTIONS.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {selectedPositions.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              Seleziona almeno una posizione per vedere le candidature.
            </div>
          ) : (
            <div className="flex flex-wrap gap-4 items-start overflow-x-hidden">
              {selectedPositions.map(position => {
                const positionCandidates = candidates
                  .map(candidate => ({
                    candidate,
                    evaluation: evaluations[`${position.code}_${candidate.id}`]
                  }))
                  .filter(entry => entry.evaluation && entry.evaluation.status !== "excluded");

                const filteredCandidates = positionCandidates.filter(({ candidate, evaluation }) => {
                  const matchesStatus = onlyPossibleMatch ? matchesPossible(evaluation!.status) : true;
                  const roleValue = getRoleFilterValueFromCode(candidate.role || "");
                  const matchesRole = matchesRoleFilter(roleValue, candidateRoleFilter);
                  return matchesStatus && matchesRole;
                });

                const selectedEntry = positionCandidates.find(({ evaluation }) => evaluation?.status === "selected");
                const isDropDisabled =
                  draggingCandidateId && !evaluations[`${position.code}_${draggingCandidateId}`];
                const canDrop =
                  !!draggingCandidateId && !!evaluations[`${position.code}_${draggingCandidateId}`];

                const orderedCandidates = filteredCandidates
                  .map(({ candidate, evaluation }) => ({
                    candidate,
                    evaluation: evaluation as Evaluation,
                    fitScore: getFitScore(evaluation as Evaluation, position)
                  }))
                  .sort((a, b) => {
                    if (b.fitScore !== a.fitScore) return b.fitScore - a.fitScore;
                    return a.candidate.nominativo.localeCompare(b.candidate.nominativo);
                  });
                const overlapMetric = getOverlapMetric(position.code);

                return (
                  <div key={position.code} className={`w-72 shrink-0 ${isDropDisabled ? 'opacity-40' : ''}`}>
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
                    <div className="border-b border-slate-100 p-4">
                        <div className="flex items-start justify-between gap-2 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                              {position.code}
                            </span>
                            <PositionLevelBadge level={getPositionLevel(position)} />
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              onSelectedPositionsChange(
                                selectedPositionIds.filter((id) => id !== position.code)
                              )
                            }
                            className="text-slate-300 hover:text-slate-500 transition-colors"
                            aria-label={`Rimuovi ${position.code} dal kanban`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                        <h3 className="mt-2 font-semibold text-slate-800 leading-snug break-words text-[clamp(0.75rem,1.2vw,0.9rem)]">
                          {position.title}
                        </h3>
                        <div className="text-xs text-slate-500 mt-2">
                          {position.entity} • {position.location}
                        </div>
                        <div className="mt-2 text-[10px] text-slate-500 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="uppercase text-slate-400">Profilo richiesto</span>
                            <span className="font-medium text-slate-600">{position.rankReq || "-"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-400">Cat/Spec</span>
                            <span className="font-medium text-slate-600 truncate max-w-[140px]">
                              {position.catSpecQualReq || "-"}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-400">NOS</span>
                            <span className="font-medium text-slate-600">{position.nosReq || "-"}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-slate-400">Inglese</span>
                            <span className="font-medium text-slate-600">{position.englishReq || "-"}</span>
                          </div>
                          {position.ofcn && (
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-slate-400">OFCN</span>
                              <span className="font-medium text-slate-600">{position.ofcn}</span>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-slate-400 mt-2 flex items-center justify-between">
                          <span>{orderedCandidates.length} candidature</span>
                          <span className="text-[10px] text-slate-500 font-semibold">
                            Overlap: {overlapMetric.sharedCount} ({overlapMetric.overlapPercent}%)
                          </span>
                        </div>
                      </div>
                      <div className="px-3 pt-3">
                        <div
                          onDragOver={handleDragOverSlot(position.code)}
                          onDrop={handleDropSlot(position.code)}
                          className={`rounded-md border-2 border-dashed px-3 py-2 text-[11px] transition-colors ${
                            canDrop
                              ? "border-blue-400 bg-blue-50 text-blue-700"
                              : isDropDisabled
                                ? "border-slate-200 bg-slate-50 text-slate-400"
                                : "border-slate-200 bg-slate-50 text-slate-500"
                          }`}
                        >
                          {selectedEntry ? (
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() =>
                                  focusCandidateAcrossKanbans(selectedEntry.candidate.id, position.code)
                                }
                                className="text-left w-full"
                              >
                                <div className="text-[10px] uppercase text-slate-400">Selected</div>
                                <div className="font-semibold text-slate-700">
                                  {selectedEntry.candidate.nominativo}
                                </div>
                                <div className="text-[10px] text-slate-500">
                                  {selectedEntry.candidate.rank} • {selectedEntry.candidate.role}{" "}
                                  {selectedEntry.candidate.category}
                                </div>
                              </button>
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onUpdate({ ...selectedEntry.evaluation, status: "pending" });
                                  if (focusedCandidateId === selectedEntry.candidate.id) {
                                    setFocusedCandidateId(null);
                                  }
                                }}
                                className="absolute top-1 right-1 text-slate-300 hover:text-slate-500"
                                aria-label={`Rimuovi ${selectedEntry.candidate.nominativo} dalla selezione`}
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : (
                            <div>
                              <div className="font-semibold">Slot selected</div>
                              <div>Trascina qui il candidato selezionato.</div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div
                        className="p-3 space-y-3 max-h-[50vh] overflow-y-auto overflow-x-hidden"
                        ref={registerKanbanScrollRef(position.code)}
                      >
                        {orderedCandidates.length === 0 && (
                          <div className="text-xs text-slate-400 italic text-center py-6">
                            Nessuna candidatura disponibile.
                          </div>
                        )}
                        {orderedCandidates.map(({ candidate, evaluation, fitScore }) => {
                          const badge = getStatusBadge(evaluation.status);
                          const fitPercent = Math.round(fitScore * 100);
                          const {
                            essentialYes,
                            essentialTotal,
                            essentialScore,
                            desirableYes,
                            desirableTotal,
                            desirableScore
                          } = getRequirementScores(evaluation, position);
                          const otherSelection = getOtherSelectionInfo(
                            candidate.id,
                            position.code,
                            evaluations,
                            positions
                          );

                          return (
                            <div
                              key={candidate.id}
                              draggable
                              onDragStart={handleDragStart(candidate.id)}
                              onDragEnd={handleDragEnd}
                              data-candidate-id={candidate.id}
                              onClick={() => focusCandidateAcrossKanbans(candidate.id, position.code)}
                              className={`border rounded-lg p-3 bg-white shadow-sm cursor-grab active:cursor-grabbing transition-colors ${
                                focusedCandidateId === candidate.id
                                  ? "border-blue-400 bg-blue-50/40"
                                  : "border-slate-200"
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2 min-w-0">
                                <div className="min-w-0">
                                  <div className="flex items-start gap-2">
                                    <div className="font-semibold text-slate-800 text-sm break-words">
                                      {candidate.nominativo}
                                    </div>
                                    {otherSelection && (
                                      <div className="relative group">
                                        <button
                                          type="button"
                                          onClick={(event) => event.stopPropagation()}
                                          onPointerDown={(event) => event.stopPropagation()}
                                          className="text-amber-500 hover:text-amber-600 focus:outline-none"
                                          aria-label={`Selezionato per ${otherSelection.code}`}
                                        >
                                          <AlertTriangle className="w-4 h-4" />
                                        </button>
                                        <div className="absolute right-0 mt-2 w-56 rounded-md border border-amber-200 bg-white shadow-lg p-2 text-[11px] text-amber-700 opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto z-30">
                                          <div className="font-semibold text-amber-800">
                                            Già selezionato altrove
                                          </div>
                                          <div className="mt-1">
                                            <span className="font-mono">{otherSelection.code}</span>{" "}
                                            <span className="text-amber-600">• {otherSelection.title}</span>
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500 mt-0.5 break-words">
                                    {candidate.rank} • {candidate.role} {candidate.category} {candidate.specialty}
                                  </div>
                                </div>
                                <div className="relative">
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      const evaluationId = `${position.code}_${candidate.id}`;
                                      setOpenStatusEvaluationId((prev) =>
                                        prev === evaluationId ? null : evaluationId
                                      );
                                    }}
                                    className="focus:outline-none"
                                  >
                                    <Badge color={badge.color}>{badge.label}</Badge>
                                  </button>
                                  {openStatusEvaluationId === `${position.code}_${candidate.id}` && (
                                    <div className="absolute right-0 mt-2 w-40 rounded-md border border-slate-200 bg-white shadow-lg z-10">
                                      {statusOptions.map((option) => (
                                        <button
                                          key={option.value}
                                          type="button"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            onUpdate({ ...evaluation, status: option.value });
                                            setOpenStatusEvaluationId(null);
                                          }}
                                          className={`w-full text-left px-3 py-2 text-xs hover:bg-slate-50 ${
                                            option.value === evaluation.status
                                              ? "text-slate-800 font-semibold"
                                              : "text-slate-600"
                                          }`}
                                        >
                                          {option.label}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="mt-3 flex items-center justify-between text-xs">
                                <span className="text-slate-500">Fit</span>
                                <span className="font-semibold text-slate-700">{fitPercent}%</span>
                              </div>
                              <div className="mt-2">
                                <div className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span className="font-medium">E {essentialYes}/{essentialTotal}</span>
                                  <span className="font-medium">D {desirableYes}/{desirableTotal}</span>
                                </div>
                                <ScoreBar
                                  evaluation={evaluation}
                                  position={position}
                                  className="mt-1"
                                />
                              </div>
                              <button
                                onClick={() =>
                                  setMatchDrawerData({
                                    candidateId: candidate.id,
                                    positionId: position.code
                                  })
                                }
                                className="mt-3 text-[11px] text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                              >
                                <Eye className="w-3 h-3" /> Disamina requisiti
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <CandidateMatchDrawer
        isOpen={!!matchDrawerData}
        candidate={matchDrawerCandidate}
        position={matchDrawerPosition}
        evaluation={matchDrawerEvaluation}
        onClose={() => setMatchDrawerData(null)}
        onUpdate={onUpdate}
      />
    </div>
  );
};

const PositionDetailView = ({
  position,
  allCandidates,
  evaluations,
  allPositions,
  onUpdate,
  onUpdateCandidate,
  onReorder,
  onBack,
  onToggleReqVisibility,
  onUpdateRequirements,
  onExport,
  isFavorite,
  onToggleFavorite
}: {
  position: Position;
  allCandidates: Candidate[];
  evaluations: Record<string, Evaluation>;
  allPositions: Position[];
  onUpdate: (ev: Evaluation) => void;
  onUpdateCandidate: (candidate: Candidate) => void;
  onReorder: (positionId: string, orderedCandidateIds: string[]) => void;
  onBack: () => void;
  onToggleReqVisibility: (posCode: string, reqId: string) => void;
  onUpdateRequirements: (positionCode: string, requirements: Requirement[]) => void;
  onExport: (p: Position, c: Candidate[], e: Record<string, Evaluation>, pos: Position[]) => void;
  isFavorite: boolean;
  onToggleFavorite: (positionCode: string) => void;
}) => {
  const [viewMode, setViewMode] = useState<'list' | 'matrix'>('list');
  const [filter, setFilter] = useState('all'); // all, selected, pending...
  const [isRequirementsOpen, setIsRequirementsOpen] = useState(true);
  const [isRequirementsDrawerOpen, setIsRequirementsDrawerOpen] = useState(false);
  const baseOrderMap = useMemo(() => new Map(allCandidates.map((c, index) => [c.id, index])), [allCandidates]);
  const previousRowPositionsRef = useRef<Map<string, DOMRect>>(new Map());
  const positionLevel = useMemo(() => getPositionLevel(position), [position]);
  const profileSummary = useMemo(() => {
    const profileParts = [position.rankReq, position.catSpecQualReq].filter(Boolean);
    return profileParts.length > 0 ? profileParts.join(" • ") : "-";
  }, [position.rankReq, position.catSpecQualReq]);

  const positionCandidates = useMemo(() => {
    return allCandidates.filter(c => !!evaluations[`${position.code}_${c.id}`]);
  }, [allCandidates, evaluations, position.code]);

  const baseOrderedIds = useMemo(() => {
    return [...positionCandidates]
      .sort((a, b) => {
        const evA = evaluations[`${position.code}_${a.id}`];
        const evB = evaluations[`${position.code}_${b.id}`];
        const orderA = evA?.manualOrder ?? baseOrderMap.get(a.id) ?? 0;
        const orderB = evB?.manualOrder ?? baseOrderMap.get(b.id) ?? 0;
        return orderA - orderB;
      })
      .map(c => c.id);
  }, [positionCandidates, evaluations, position.code, baseOrderMap]);

  const {
    draggedCandidateId,
    dropTargetId,
    dragOrderIds,
    dragOffset,
    dragStartRect,
    handleDragHandlePointerDown
  } = useCandidateReorder({
    positionCode: position.code,
    baseOrderedIds,
    onReorder,
    viewMode
  });

  const orderedCandidates = useMemo(() => {
    const candidateMap = new Map(positionCandidates.map(c => [c.id, c]));
    const orderedIds = dragOrderIds ?? baseOrderedIds;
    return orderedIds.map(id => candidateMap.get(id)).filter(Boolean) as Candidate[];
  }, [positionCandidates, baseOrderedIds, dragOrderIds]);

  const candidates = useMemo(() => {
    return orderedCandidates.filter(c => {
      const ev = evaluations[`${position.code}_${c.id}`];
      if (!ev) return false;
      if (filter === "all") return true;
      return ev.status === filter;
    });
  }, [orderedCandidates, evaluations, position.code, filter]);

  const stats = useMemo(() => {
     const selected = positionCandidates.filter(c => evaluations[`${position.code}_${c.id}`]?.status === 'selected').length;
     const pending = positionCandidates.filter(c => evaluations[`${position.code}_${c.id}`]?.status === 'pending').length;
     return { total: positionCandidates.length, selected, pending };
  }, [positionCandidates, evaluations, position.code]);

  useLayoutEffect(() => {
    if (viewMode !== 'list') {
      previousRowPositionsRef.current.clear();
      return;
    }

    const rows = Array.from(document.querySelectorAll('[data-drag-row]')) as HTMLElement[];
    const nextPositions = new Map<string, DOMRect>();
    const rowElements = new Map<string, HTMLElement>();

    rows.forEach(row => {
      const id = row.dataset.candidateId;
      if (!id) return;
      nextPositions.set(id, row.getBoundingClientRect());
      rowElements.set(id, row);
    });

    if (previousRowPositionsRef.current.size > 0) {
      nextPositions.forEach((rect, id) => {
        if (id === draggedCandidateId) return;
        const prevRect = previousRowPositionsRef.current.get(id);
        const el = rowElements.get(id);
        if (!prevRect || !el) return;
        const deltaY = prevRect.top - rect.top;
        if (Math.abs(deltaY) < 1) return;
        el.animate(
          [
            { transform: `translateY(${deltaY}px)` },
            { transform: 'translateY(0)' }
          ],
          {
            duration: 180,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
          }
        );
      });
    }

    previousRowPositionsRef.current = nextPositions;
  }, [dragOrderIds, filter, viewMode, draggedCandidateId, candidates.length]);

  const dragOverlayCandidate = useMemo(() => {
    if (!draggedCandidateId) return null;
    return positionCandidates.find(candidate => candidate.id === draggedCandidateId) ?? null;
  }, [draggedCandidateId, positionCandidates]);

  const dragOverlayEvaluation = useMemo(() => {
    if (!dragOverlayCandidate) return null;
    return evaluations[`${position.code}_${dragOverlayCandidate.id}`] ?? null;
  }, [dragOverlayCandidate, evaluations, position.code]);

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 shadow-sm z-20">
        <div className="px-6 py-4">
          <div className="flex items-center gap-4 mb-4">
            <Button variant="secondary" onClick={onBack}>
               <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back
            </Button>
            <div className="flex-1">
               <div className="flex items-center gap-2 mb-1">
                 <span className="font-mono text-sm font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{position.code}</span>
                 <PositionLevelBadge level={positionLevel} />
                 <h1 className="text-xl font-bold text-slate-900 truncate">{position.title}</h1>
               </div>
               <div className="text-sm text-slate-500 flex gap-4">
                 <span className="flex items-center gap-1"><Building className="w-3 h-3" /> {position.entity}</span>
                 <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {position.location}</span>
               </div>
               <div className="mt-2 text-xs text-slate-500 flex items-center gap-2">
                 <span className="uppercase text-slate-400">Profilo previsto</span>
                 <span className="font-semibold text-slate-600">{profileSummary}</span>
               </div>
            </div>
            <div className="flex items-center gap-2">
               <div className="text-right mr-4 text-xs text-slate-500">
                  <div className="font-bold text-slate-700">{stats.total} Candidates</div>
                  <div>{stats.selected} Selected • {stats.pending} Pending</div>
               </div>
               <Button
                 variant="secondary"
                 onClick={() => onToggleFavorite(position.code)}
                 className={isFavorite ? "border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100" : ""}
               >
                  <Star className="w-4 h-4 mr-2" fill={isFavorite ? "currentColor" : "none"} />
                  {isFavorite ? "In shortlist" : "Salva in shortlist"}
               </Button>
               <Button variant="secondary" onClick={() => onExport(position, candidates, evaluations, allPositions)}>
                  <Download className="w-4 h-4 mr-2" /> Export Excel
               </Button>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between gap-4 mt-6">
             <div className="flex bg-slate-100 p-1 rounded-lg">
                <button 
                  onClick={() => setViewMode('list')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                   <LayoutList className="w-4 h-4" /> List
                </button>
                <button 
                  onClick={() => setViewMode('matrix')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all flex items-center gap-2 ${viewMode === 'matrix' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                   <TableIcon className="w-4 h-4" /> Matrix
                </button>
             </div>
             
             <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-slate-400" />
                <select 
                  className="text-sm border-none bg-transparent focus:ring-0 font-medium text-slate-600 cursor-pointer"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                   <option value="all">All Candidates</option>
                   <option value="pending">Pending Only</option>
                   <option value="selected">Selected Only</option>
                   <option value="reserve">Solo Possibile match</option>
                   <option value="rejected">Rejected Only</option>
                   <option value="excluded">Solo Esclusi</option>
                </select>
             </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex flex-row">
         {/* Main Content */}
         <div className="flex-1 overflow-y-auto p-6">
            {viewMode === 'list' ? (
               <>
                  <div className="max-w-4xl mx-auto">
                     {candidates.map(c => {
                        const ev = evaluations[`${position.code}_${c.id}`];
                        const other = getOtherSelectionInfo(c.id, position.code, evaluations, allPositions);
                        if (!ev) return null;
                        return (
                           <WorksheetRow 
                              key={c.id}
                              candidate={c}
                              evaluation={ev}
                             position={position}
                             otherSelection={other}
                             onUpdate={onUpdate}
                             onUpdateCandidate={onUpdateCandidate}
                              onOpenRequirementsDrawer={() => setIsRequirementsDrawerOpen(true)}
                              isDragging={draggedCandidateId === c.id}
                              isDropTarget={dropTargetId === c.id}
                              onDragHandlePointerDown={handleDragHandlePointerDown}
                           />
                        );
                     })}
                  </div>
                  {dragOverlayCandidate &&
                    dragOverlayEvaluation &&
                    dragOffset &&
                    dragStartRect && (
                      <div
                        style={{
                          position: 'fixed',
                          top: dragStartRect.top,
                          left: dragStartRect.left,
                          width: dragStartRect.width,
                          transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
                          pointerEvents: 'none',
                          zIndex: 60
                        }}
                      >
                        <WorksheetRow
                          candidate={dragOverlayCandidate}
                          evaluation={dragOverlayEvaluation}
                          position={position}
                          otherSelection={getOtherSelectionInfo(
                            dragOverlayCandidate.id,
                            position.code,
                            evaluations,
                            allPositions
                          )}
                          onUpdate={() => {}}
                          onUpdateCandidate={() => {}}
                          onOpenRequirementsDrawer={() => {}}
                          isDragging={false}
                          isDropTarget={false}
                          onDragHandlePointerDown={() => {}}
                          isDragOverlay
                        />
                      </div>
                    )}
               </>
            ) : (
               <CandidatesMatrixView 
                  candidates={candidates}
                  position={position}
                  evaluations={evaluations}
                  positions={allPositions}
                  onUpdate={onUpdate}
               />
            )}
         </div>

         {/* Requirements Sidebar (Right) */}
         <div className={`bg-white border-l border-slate-200 flex flex-col overflow-hidden shadow-lg transition-all duration-300 ${isRequirementsOpen ? 'w-80' : 'w-12'}`}>
            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-start justify-between gap-2">
               {isRequirementsOpen ? (
                  <div>
                     <h3 className="font-bold text-slate-700 text-sm uppercase flex items-center gap-2">
                        <Shield className="w-4 h-4" /> Requirements Config
                     </h3>
                     <p className="text-xs text-slate-500 mt-1">Toggle requirements visibility for the matrix.</p>
                  </div>
               ) : (
                  <div className="flex items-center justify-center w-full">
                     <Shield className="w-4 h-4 text-slate-500" />
                  </div>
               )}
               <button
                  onClick={() => setIsRequirementsOpen((prev) => !prev)}
                  className="text-slate-400 hover:text-slate-600 transition-colors"
                  aria-label={isRequirementsOpen ? "Collapse requirements config" : "Expand requirements config"}
               >
                  {isRequirementsOpen ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
               </button>
            </div>
            {isRequirementsOpen && (
               <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div>
                     <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Essential</h4>
                     {position.requirements.filter(r => r.type === 'essential').map(r => (
                        <div key={r.id} className="flex items-start gap-2 mb-2 group">
                           <button 
                              onClick={() => onToggleReqVisibility(position.code, r.id)}
                              className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${!r.hidden ? 'bg-blue-500 border-blue-600 text-white' : 'bg-slate-100 border-slate-300 text-slate-300'}`}
                           >
                              {!r.hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                           </button>
                           <span className={`text-xs ${r.hidden ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{r.text}</span>
                        </div>
                     ))}
                  </div>
                  <div>
                     <h4 className="text-xs font-bold text-slate-400 uppercase mb-2">Desirable</h4>
                     {position.requirements.filter(r => r.type === 'desirable').map(r => (
                        <div key={r.id} className="flex items-start gap-2 mb-2 group">
                           <button 
                              onClick={() => onToggleReqVisibility(position.code, r.id)}
                              className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-colors ${!r.hidden ? 'bg-blue-500 border-blue-600 text-white' : 'bg-slate-100 border-slate-300 text-slate-300'}`}
                           >
                              {!r.hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                           </button>
                           <span className={`text-xs ${r.hidden ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{r.text}</span>
                        </div>
                     ))}
                  </div>
               </div>
            )}
         </div>
      </div>

      <RequirementsDrawer
        isOpen={isRequirementsDrawerOpen}
        position={position}
        onClose={() => setIsRequirementsDrawerOpen(false)}
        onSave={onUpdateRequirements}
      />
    </div>
  );
};

const MultiSelect = ({
  label,
  options,
  selected,
  onChange,
  placeholder
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOptions = options.filter(option => selected.includes(option.value));
  const displayValue = (() => {
    if (selectedOptions.length === 0) return placeholder;
    if (selectedOptions.length <= 2) return selectedOptions.map(option => option.label).join(", ");
    const [first, second, ...rest] = selectedOptions;
    return `${first.label}, ${second.label} +${rest.length}`;
  })();

  const toggleValue = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter(item => item !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const clearSelection = () => {
    onChange([]);
  };

  return (
    <div className="relative min-w-[220px]" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full px-3 py-2 rounded-lg border text-left shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
          isOpen ? "border-blue-400" : "border-slate-200"
        } bg-white`}
        aria-expanded={isOpen}
      >
        <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
        <div className="mt-1 flex items-center justify-between gap-2 text-sm text-slate-700">
          <span className="truncate">{displayValue}</span>
          <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </div>
      </button>
      {isOpen && (
        <div className="absolute z-20 mt-2 w-full rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 text-xs text-slate-500 border-b border-slate-100">
            <span>Seleziona uno o più</span>
            <button
              type="button"
              className="text-blue-600 hover:text-blue-700 font-medium"
              onClick={clearSelection}
            >
              Tutti
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {options.map(option => {
              const isSelected = selected.includes(option.value);
              return (
                <label
                  key={option.value}
                  className="flex items-start gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={isSelected}
                    onChange={() => toggleValue(option.value)}
                  />
                  <span className="flex flex-col text-slate-700">
                    <span>{option.label}</span>
                    {option.meta && <span className="text-xs text-slate-400">{option.meta}</span>}
                  </span>
                </label>
              );
            })}
            {options.length === 0 && (
              <div className="px-3 py-3 text-sm text-slate-400">Nessuna opzione disponibile.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Main App ---

const RecruitmentApp = () => {
  const backupVersion = 1;
  const createDefaultCycle = (): Cycle => ({
    name: "Ciclo disamine 2026/2027",
    startedAt: Date.now(),
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now())
  });

  const [appData, setAppData] = useState<AppData>(() => ({
    candidates: [],
    positions: [],
    evaluations: {},
    favoritePositionIds: [],
    lastUpdated: 0,
    cycle: createDefaultCycle()
  }));

  const [currentView, setCurrentView] = useState<'upload' | 'dashboard' | 'favorites' | 'position_detail' | 'candidates_list' | 'candidate_detail' | 'overlap_kanban'>('upload');
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [overlapPositionIds, setOverlapPositionIds] = useState<string[]>([]);
  const [positionsReturnView, setPositionsReturnView] = useState<'dashboard' | 'favorites'>('dashboard');
  const [searchTerm, setSearchTerm] = useState("");
  const [filterEnte, setFilterEnte] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState<PositionStatus | 'all'>('all');
  const [filterLevel, setFilterLevel] = useState<string[]>([]);
  const [filterRole, setFilterRole] = useState<RoleFilterValue[]>([]);
  const [isNewCycleModalOpen, setIsNewCycleModalOpen] = useState(false);
  const [newCycleName, setNewCycleName] = useState("");
  const [backupError, setBackupError] = useState("");
  const [backupSuccess, setBackupSuccess] = useState("");
  const [lastImportStats, setLastImportStats] = useState<ImportStats | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsFileError, setSettingsFileError] = useState("");
  const [settingsFileSuccess, setSettingsFileSuccess] = useState("");
  const [isSettingsProcessing, setIsSettingsProcessing] = useState(false);
  const [importConflicts, setImportConflicts] = useState<ImportConflict[]>([]);
  const [importConflictsTotal, setImportConflictsTotal] = useState(0);

  // Load from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('recruitment_db');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.candidates && parsed.positions) {
          setAppData({
            ...parsed,
            candidates: (parsed.candidates as Candidate[]).map(candidate => ({
              ...candidate,
              commanderOpinion: candidate.commanderOpinion ?? "",
              specificAssignments: candidate.specificAssignments ?? "",
              ofcnSuitability: candidate.ofcnSuitability ?? "",
              globalNotes: candidate.globalNotes ?? ""
            })),
            cycle: parsed.cycle ?? createDefaultCycle(),
            favoritePositionIds: parsed.favoritePositionIds ?? []
          });
          setCurrentView('dashboard');
        }
      } catch (e) { console.error("Failed to load DB", e); }
    }
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    localStorage.setItem('recruitment_db', JSON.stringify(appData));
  }, [appData]);

  const handleDataLoaded = (candidates: Candidate[], positions: Position[], stats: ImportStats) => {
    // Initialize empty evaluations for all matches
    const evaluations: Record<string, Evaluation> = { ...appData.evaluations };
    
    // REVERSE LOOKUP LOGIC
    // Instead of trusting the messy split string from candidates,
    // we iterate through all known VALID positions and check if they exist 
    // in the candidate's raw application string.
    
    // First, clear any previously parsed codes to be safe
    candidates.forEach(c => c.appliedPositionCodes = []);

    positions.forEach(pos => {
       const cleanPosCode = pos.code.trim().toUpperCase();
       if (cleanPosCode.length < 2) return; // Skip tiny invalid codes

       candidates.forEach(cand => {
          const rawApp = cand.rawAppliedString.toUpperCase();
          
          // Check if the valid position code exists in the candidate's messy string
          if (rawApp.includes(cleanPosCode)) {
             // Link them (deduped)
             if (!cand.appliedPositionCodes.includes(pos.code)) {
               cand.appliedPositionCodes.push(pos.code);
             }

             // Create evaluation entry if missing
             const key = `${pos.code}_${cand.id}`;
             if (!evaluations[key]) {
               evaluations[key] = {
                 candidateId: cand.id,
                 positionId: pos.code,
                 reqEvaluations: {},
                 notes: "",
                 status: 'pending'
               };
             }
          }
       });
    });

    setAppData({
      cycle: appData.cycle,
      candidates,
      positions,
      evaluations,
      favoritePositionIds: appData.favoritePositionIds.filter((id) => positions.some(pos => pos.code === id)),
      lastUpdated: Date.now()
    });
    setLastImportStats(stats);
    setOverlapPositionIds(positions.slice(0, 3).map(pos => pos.code));
    setCurrentView('dashboard');
  };

  const updateEvaluation = (ev: Evaluation) => {
    setAppData(prev => {
      const newEvaluations = { ...prev.evaluations };
      const candidateEvaluations = Object.values(newEvaluations).filter(
        existingEv => existingEv.candidateId === ev.candidateId
      );
      const candidateIsExcluded = candidateEvaluations.some(existingEv => existingEv.status === "excluded");

      if (ev.status === "excluded") {
        candidateEvaluations.forEach(existingEv => {
          newEvaluations[`${existingEv.positionId}_${existingEv.candidateId}`] = {
            ...existingEv,
            status: "excluded"
          };
        });
      } else if (candidateIsExcluded) {
        candidateEvaluations.forEach(existingEv => {
          newEvaluations[`${existingEv.positionId}_${existingEv.candidateId}`] = {
            ...existingEv,
            status: "pending"
          };
        });
      }

      // SINGLE SELECTION LOGIC:
      // If setting this candidate to SELECTED, find any other candidate for this position
      // who is currently SELECTED and set them to PENDING.
      if (ev.status === 'selected') {
         Object.values(newEvaluations).forEach((val) => {
            const existingEv = val as Evaluation;
            if (existingEv.status !== 'selected') return;
            if (existingEv.positionId === ev.positionId && existingEv.candidateId !== ev.candidateId) {
               // Clone the object to ensure React state updates correctly, 
               // though strictly speaking we are already working on a shallow copy of the dictionary
               newEvaluations[`${existingEv.positionId}_${existingEv.candidateId}`] = {
                  ...existingEv,
                  status: 'pending' // Revert to pending
               };
            }
            if (existingEv.candidateId === ev.candidateId && existingEv.positionId !== ev.positionId) {
              newEvaluations[`${existingEv.positionId}_${existingEv.candidateId}`] = {
                ...existingEv,
                status: 'pending'
              };
            }
         });
      }

      // Update the target evaluation
      newEvaluations[`${ev.positionId}_${ev.candidateId}`] = ev;

      return {
        ...prev,
        evaluations: newEvaluations,
        lastUpdated: Date.now()
      };
    });
  };

  const updateCandidate = (candidate: Candidate) => {
    setAppData(prev => {
      const updatedCandidates = prev.candidates.map(existing =>
        existing.id === candidate.id ? candidate : existing
      );
      return {
        ...prev,
        candidates: updatedCandidates,
        lastUpdated: Date.now()
      };
    });
  };

  const updateManualOrder = (positionId: string, orderedCandidateIds: string[]) => {
    setAppData(prev => {
      const newEvaluations = { ...prev.evaluations };
      orderedCandidateIds.forEach((candidateId, index) => {
        const key = `${positionId}_${candidateId}`;
        const existing = newEvaluations[key];
        if (existing) {
          newEvaluations[key] = {
            ...existing,
            manualOrder: index
          };
        }
      });
      return {
        ...prev,
        evaluations: newEvaluations,
        lastUpdated: Date.now()
      };
    });
  };

  const toggleRequirementVisibility = (positionCode: string, reqId: string) => {
    setAppData(prev => {
      const posIndex = prev.positions.findIndex(p => p.code === positionCode);
      if (posIndex === -1) return prev;

      const newPositions = [...prev.positions];
      const newReqs = newPositions[posIndex].requirements.map(req => {
        if (req.id === reqId) {
          return { ...req, hidden: !req.hidden };
        }
        return req;
      });

      newPositions[posIndex] = { ...newPositions[posIndex], requirements: newReqs };

      return {
        ...prev,
        positions: newPositions,
        lastUpdated: Date.now()
      };
    });
  };

  const updatePositionRequirements = (positionCode: string, requirements: Requirement[]) => {
    setAppData(prev => {
      const positionIndex = prev.positions.findIndex(p => p.code === positionCode);
      if (positionIndex === -1) return prev;
      const newPositions = [...prev.positions];
      newPositions[positionIndex] = {
        ...newPositions[positionIndex],
        requirements
      };
      return {
        ...prev,
        positions: newPositions,
        lastUpdated: Date.now()
      };
    });
  };

  const toggleFavoritePosition = (positionCode: string) => {
    setAppData(prev => {
      const isFavorite = prev.favoritePositionIds.includes(positionCode);
      const nextFavorites = isFavorite
        ? prev.favoritePositionIds.filter(id => id !== positionCode)
        : [...prev.favoritePositionIds, positionCode];
      return {
        ...prev,
        favoritePositionIds: nextFavorites,
        lastUpdated: Date.now()
      };
    });
  };

  const resetData = () => {
    if (confirm("Are you sure? This will delete all evaluations.")) {
      localStorage.removeItem('recruitment_db');
      window.location.reload();
    }
  };

  const exportBackup = () => {
    setBackupError("");
    setBackupSuccess("");
    const payload = {
      version: backupVersion,
      exportedAt: Date.now(),
      appData
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const safeCycleName = appData.cycle.name.replace(/[^a-z0-9-_]+/gi, "_").slice(0, 40);
    const link = document.createElement("a");
    link.href = url;
    link.download = `scheda_disamina_backup_${safeCycleName || "ciclo"}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setBackupSuccess("Backup scaricato correttamente.");
  };

  const validateBackupPayload = (payload: any): AppData => {
    const isObject = (value: any) => typeof value === "object" && value !== null && !Array.isArray(value);
    if (!isObject(payload)) {
      throw new Error("Formato backup non valido.");
    }
    if (payload.version !== backupVersion) {
      throw new Error("Versione backup incompatibile.");
    }
    if (!isObject(payload.appData)) {
      throw new Error("Formato backup non valido.");
    }
    const { candidates, positions, evaluations, lastUpdated, cycle, favoritePositionIds } = payload.appData as AppData;
    if (!Array.isArray(candidates) || !Array.isArray(positions) || !isObject(evaluations)) {
      throw new Error("Formato backup non valido.");
    }
    if (!isObject(cycle) || typeof cycle.name !== "string" || typeof cycle.startedAt !== "number" || typeof cycle.id !== "string") {
      throw new Error("Formato backup non valido.");
    }
    if (typeof lastUpdated !== "number") {
      throw new Error("Formato backup non valido.");
    }
    if (favoritePositionIds !== undefined && !Array.isArray(favoritePositionIds)) {
      throw new Error("Formato backup non valido.");
    }
    return payload.appData as AppData;
  };

  const importBackup = (file: File) => {
    setBackupError("");
    setBackupSuccess("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || "");
        const parsed = JSON.parse(text);
        const nextAppData = validateBackupPayload(parsed);
        setAppData({
          candidates: nextAppData.candidates,
          positions: nextAppData.positions,
          evaluations: nextAppData.evaluations,
          favoritePositionIds: nextAppData.favoritePositionIds ?? [],
          lastUpdated: nextAppData.lastUpdated,
          cycle: nextAppData.cycle
        });
        setSelectedCandidateId(null);
        setSelectedPositionId(null);
        setOverlapPositionIds([]);
        setFilterEnte([]);
        setFilterStatus('all');
        setFilterLevel([]);
        setFilterRole([]);
        setSearchTerm("");
        setCurrentView(nextAppData.candidates.length && nextAppData.positions.length ? 'dashboard' : 'upload');
        setBackupSuccess("Backup caricato correttamente.");
      } catch (error: any) {
        console.error(error);
        setBackupError(error.message || "Errore durante il caricamento del backup.");
      }
    };
    reader.onerror = () => {
      setBackupError("Errore durante il caricamento del backup.");
    };
    reader.readAsText(file);
  };

  const handleBackupUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    importBackup(file);
    event.target.value = "";
  };

  const prepareCandidateForInsert = (
    candidate: Candidate,
    positions: Position[],
    evaluations: Record<string, Evaluation>
  ) => {
    const candidateWithApplications: Candidate = {
      ...candidate,
      appliedPositionCodes: []
    };
    const nextEvaluations: Record<string, Evaluation> = { ...evaluations };
    const rawApp = candidateWithApplications.rawAppliedString.toUpperCase();

    positions.forEach((pos) => {
      const cleanPosCode = pos.code.trim().toUpperCase();
      if (cleanPosCode.length < 2) return;
      if (rawApp.includes(cleanPosCode)) {
        candidateWithApplications.appliedPositionCodes.push(pos.code);
        const key = `${pos.code}_${candidateWithApplications.id}`;
        if (!nextEvaluations[key]) {
          nextEvaluations[key] = {
            candidateId: candidateWithApplications.id,
            positionId: pos.code,
            reqEvaluations: {},
            notes: "",
            status: "pending"
          };
        }
      }
    });

    return { candidate: candidateWithApplications, evaluations: nextEvaluations };
  };

  const integrateCandidate = (
    prev: AppData,
    candidate: Candidate,
    mode: "add" | "replace"
  ) => {
    const { candidate: prepared, evaluations } = prepareCandidateForInsert(
      candidate,
      prev.positions,
      prev.evaluations
    );

    const candidates =
      mode === "replace"
        ? prev.candidates.map((existing) =>
            existing.id === prepared.id ? prepared : existing
          )
        : [...prev.candidates, prepared];

    return {
      ...prev,
      candidates,
      evaluations,
      lastUpdated: Date.now()
    };
  };

  const integratePosition = (
    prev: AppData,
    position: Position,
    mode: "add" | "replace"
  ) => {
    const nextEvaluations: Record<string, Evaluation> = { ...prev.evaluations };
    const updatedCandidates = prev.candidates.map((candidate) => ({
      ...candidate,
      appliedPositionCodes: [...candidate.appliedPositionCodes]
    }));

    const cleanPosCode = position.code.trim().toUpperCase();
    if (cleanPosCode.length >= 2) {
      updatedCandidates.forEach((candidate) => {
        const rawApp = candidate.rawAppliedString.toUpperCase();
        if (rawApp.includes(cleanPosCode)) {
          if (!candidate.appliedPositionCodes.includes(position.code)) {
            candidate.appliedPositionCodes.push(position.code);
          }
          const key = `${position.code}_${candidate.id}`;
          if (!nextEvaluations[key]) {
            nextEvaluations[key] = {
              candidateId: candidate.id,
              positionId: position.code,
              reqEvaluations: {},
              notes: "",
              status: "pending"
            };
          }
        }
      });
    }

    const positions =
      mode === "replace"
        ? prev.positions.map((existing) =>
            existing.code === position.code ? position : existing
          )
        : [...prev.positions, position];

    return {
      ...prev,
      positions,
      candidates: updatedCandidates,
      evaluations: nextEvaluations,
      favoritePositionIds: prev.favoritePositionIds.filter((id) =>
        positions.some((pos) => pos.code === id)
      ),
      lastUpdated: Date.now()
    };
  };

  const resolveImportConflict = (action: "keep" | "replace") => {
    setImportConflicts((prev) => {
      if (prev.length === 0) return prev;
      const [current, ...rest] = prev;

      if (action === "replace") {
        setAppData((state) => {
          if (current.type === "candidate") {
            return integrateCandidate(state, current.incoming, "replace");
          }
          return integratePosition(state, current.incoming, "replace");
        });
      }

      if (rest.length === 0) {
        setSettingsFileSuccess("Conflitti risolti. Import completato.");
        setImportConflictsTotal(0);
      }

      return rest;
    });
  };

  const appendCandidatesFromFiles = async (files: File[]) => {
    setSettingsFileError("");
    setSettingsFileSuccess("");
    setImportConflicts([]);
    setImportConflictsTotal(0);
    setIsSettingsProcessing(true);
    try {
      const candidatesRows = await readExcelFiles(files, "candidati-aggiunta");
      const candidatesResult = parseCandidates(candidatesRows);
      if (candidatesResult.items.length === 0) {
        throw new Error("Nessun candidato valido nei file selezionati.");
      }

      let addedCount = 0;
      const conflicts: ImportConflict[] = [];

      setAppData((prev) => {
        let nextState = prev;
        const existingById = new Map(prev.candidates.map((candidate) => [candidate.id, candidate]));

        candidatesResult.items.forEach((candidate) => {
          const existing = existingById.get(candidate.id);
          if (existing) {
            conflicts.push({ type: "candidate", existing, incoming: candidate });
            return;
          }
          nextState = integrateCandidate(nextState, candidate, "add");
          existingById.set(candidate.id, candidate);
          addedCount += 1;
        });

        return nextState;
      });

      setLastImportStats({
        candidates: {
          imported: candidatesResult.items.length,
          duplicates: candidatesResult.duplicateCount,
          totalRows: candidatesResult.totalRows
        },
        positions: { imported: 0, duplicates: 0, totalRows: 0 }
      });

      if (conflicts.length > 0) {
        setImportConflicts(conflicts);
        setImportConflictsTotal(conflicts.length);
        setSettingsFileSuccess(
          `Importati ${addedCount} nuovi candidati. Risolvi ${conflicts.length} conflitti.`
        );
      } else {
        setSettingsFileSuccess(
          addedCount > 0
            ? `Aggiunti ${addedCount} nuovi candidati.`
            : "Nessun nuovo candidato da aggiungere."
        );
      }
    } catch (error: any) {
      console.error(error);
      setSettingsFileError(error.message || "Errore durante l'aggiunta dei candidati.");
    } finally {
      setIsSettingsProcessing(false);
    }
  };

  const appendPositionsFromFiles = async (files: File[]) => {
    setSettingsFileError("");
    setSettingsFileSuccess("");
    setImportConflicts([]);
    setImportConflictsTotal(0);
    setIsSettingsProcessing(true);
    try {
      const positionsRows = await readExcelFiles(files, "posizioni-aggiunta");
      const positionsResult = parsePositions(positionsRows);
      if (positionsResult.items.length === 0) {
        throw new Error("Nessuna posizione valida nei file selezionati.");
      }

      let addedCount = 0;
      const conflicts: ImportConflict[] = [];
      setAppData((prev) => {
        let nextState = prev;
        const positionsByCode = new Map(prev.positions.map((pos) => [pos.code, pos]));

        positionsResult.items.forEach((position) => {
          const existing = positionsByCode.get(position.code);
          if (existing) {
            conflicts.push({ type: "position", existing, incoming: position });
            return;
          }
          nextState = integratePosition(nextState, position, "add");
          positionsByCode.set(position.code, position);
          addedCount += 1;
        });

        return nextState;
      });

      setLastImportStats({
        candidates: { imported: 0, duplicates: 0, totalRows: 0 },
        positions: {
          imported: positionsResult.items.length,
          duplicates: positionsResult.duplicateCount,
          totalRows: positionsResult.totalRows
        }
      });

      if (conflicts.length > 0) {
        setImportConflicts(conflicts);
        setImportConflictsTotal(conflicts.length);
        setSettingsFileSuccess(
          `Importate ${addedCount} nuove posizioni. Risolvi ${conflicts.length} conflitti.`
        );
      } else {
        setSettingsFileSuccess(
          addedCount > 0
            ? `Aggiunte ${addedCount} nuove posizioni.`
            : "Nessuna nuova posizione da aggiungere."
        );
      }
    } catch (error: any) {
      console.error(error);
      setSettingsFileError(error.message || "Errore durante l'aggiunta delle posizioni.");
    } finally {
      setIsSettingsProcessing(false);
    }
  };

  const handleSettingsCandidatesUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = "";
    if (files.length === 0) return;
    await appendCandidatesFromFiles(files);
  };

  const handleSettingsPositionsUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = "";
    if (files.length === 0) return;
    await appendPositionsFromFiles(files);
  };

  const clearCandidatesData = () => {
    const confirmed = confirm("Eliminare tutti i dati delle persone caricate? Questa operazione non può essere annullata.");
    if (!confirmed) return;
    setAppData((prev) => ({
      ...prev,
      candidates: [],
      evaluations: {},
      lastUpdated: Date.now()
    }));
    setSelectedCandidateId(null);
    setSettingsFileError("");
    setSettingsFileSuccess("Tutti i dati persone sono stati eliminati.");
  };

  const clearPositionsData = () => {
    const confirmed = confirm("Eliminare tutte le posizioni caricate? Questa operazione non può essere annullata.");
    if (!confirmed) return;
    setAppData((prev) => ({
      ...prev,
      positions: [],
      evaluations: {},
      favoritePositionIds: [],
      lastUpdated: Date.now()
    }));
    setSelectedPositionId(null);
    setOverlapPositionIds([]);
    setSettingsFileError("");
    setSettingsFileSuccess("Tutte le posizioni sono state eliminate.");
  };

  const startNewSearch = () => {
    const confirmed = confirm("Vuoi avviare una nuova ricerca di personale? I dati attuali verranno svuotati.");
    if (!confirmed) return;
    setNewCycleName("");
    setIsNewCycleModalOpen(true);
  };

  const applyNewCycle = () => {
    const trimmedName = newCycleName.trim();
    if (!trimmedName) return;
    const nextCycle = {
      ...createDefaultCycle(),
      name: trimmedName
    };
    setAppData({
      candidates: [],
      positions: [],
      evaluations: {},
      favoritePositionIds: [],
      lastUpdated: Date.now(),
      cycle: nextCycle
    });
    setCurrentView('upload');
    setSelectedCandidateId(null);
    setSelectedPositionId(null);
    setOverlapPositionIds([]);
    setFilterEnte([]);
    setFilterStatus('all');
    setFilterLevel([]);
    setFilterRole([]);
    setSearchTerm("");
    setIsNewCycleModalOpen(false);
  };

  // Derived state
  const distinctEntities = useMemo(() => {
    const entes = new Set(appData.positions.map(p => p.entity));
    return Array.from(entes).sort();
  }, [appData.positions]);

  const distinctLevels = useMemo(() => getDistinctPositionLevels(appData.positions), [appData.positions]);
  const entityOptions = useMemo(
    () => distinctEntities.map(entity => ({ value: entity, label: entity })),
    [distinctEntities]
  );
  const levelOptions = useMemo(
    () =>
      distinctLevels.map(level => ({
        value: level.code,
        label: level.code,
        meta: level.description
      })),
    [distinctLevels]
  );
  const roleOptions = useMemo(
    () =>
      ROLE_FILTER_OPTIONS.filter(option => option.value !== "ALL").map(option => ({
        value: option.value,
        label: option.label
      })),
    []
  );
  const currentConflict = importConflicts[0];
  const conflictStep =
    importConflictsTotal > 0 ? importConflictsTotal - importConflicts.length + 1 : 0;

  const lowerSearch = searchTerm.trim().toLowerCase();
  const positionMatchesFilters = useCallback(
    (position: Position) => {
      const matchesSearch =
        position.title.toLowerCase().includes(lowerSearch) ||
        position.code.toLowerCase().includes(lowerSearch) ||
        position.entity.toLowerCase().includes(lowerSearch) ||
        position.location.toLowerCase().includes(lowerSearch);

      const matchesEnte = filterEnte.length === 0 || filterEnte.includes(position.entity);

      const status = getPositionStatus(position, appData.evaluations);
      const matchesStatus = filterStatus === 'all' || status === filterStatus;

      const level = getPositionLevel(position);
      const matchesLevel = filterLevel.length === 0 || (level?.code ? filterLevel.includes(level.code) : false);

      const matchesRole =
        filterRole.length === 0 || filterRole.some(role => matchesPositionRoleFilter(position, role));

      return matchesSearch && matchesEnte && matchesStatus && matchesLevel && matchesRole;
    },
    [lowerSearch, filterEnte, filterStatus, filterLevel, filterRole, appData.evaluations]
  );

  const filteredPositions = useMemo(
    () => appData.positions.filter(positionMatchesFilters),
    [appData.positions, positionMatchesFilters]
  );

  const filteredFavoritePositions = useMemo(
    () => appData.positions.filter(p => appData.favoritePositionIds.includes(p.code)).filter(positionMatchesFilters),
    [appData.positions, appData.favoritePositionIds, positionMatchesFilters]
  );

  // Views Logic
  if (currentView === 'upload') {
    return <FileUploadView onDataLoaded={handleDataLoaded} />;
  }

  if (currentView === 'position_detail' && selectedPositionId) {
    const position = appData.positions.find(p => p.code === selectedPositionId)!;
    
    return (
       <PositionDetailView 
          position={position}
          allCandidates={appData.candidates}
          evaluations={appData.evaluations}
          allPositions={appData.positions}
          onUpdate={updateEvaluation}
          onUpdateCandidate={updateCandidate}
          onReorder={updateManualOrder}
          onBack={() => setCurrentView(positionsReturnView)}
          onToggleReqVisibility={toggleRequirementVisibility}
          onUpdateRequirements={updatePositionRequirements}
          onExport={exportToExcel}
          isFavorite={appData.favoritePositionIds.includes(position.code)}
          onToggleFavorite={toggleFavoritePosition}
       />
    );
  }

  if (currentView === 'candidate_detail' && selectedCandidateId) {
    const candidate = appData.candidates.find(c => c.id === selectedCandidateId)!;
    return (
      <CandidateDetailView 
         candidate={candidate}
         allPositions={appData.positions}
         evaluations={appData.evaluations}
         onUpdate={updateEvaluation}
         onUpdateCandidate={updateCandidate}
         onBack={() => setCurrentView('candidates_list')}
      />
    )
  }

  // Dashboard View (Shared Layout)
  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col flex-shrink-0">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-white font-bold text-xl flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-600 rounded flex items-center justify-center">SD</div>
            SchedaDisamina
          </h2>
          <p className="mt-2 text-xs text-slate-400">
            Ciclo di disamina: <span className="text-slate-200">{appData.cycle.name}</span>
          </p>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <button 
             onClick={() => setCurrentView('dashboard')}
             className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${currentView === 'dashboard' ? 'bg-slate-800 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <Briefcase className="w-5 h-5" />
            Positions
          </button>
          <button
            onClick={() => setCurrentView('favorites')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${currentView === 'favorites' ? 'bg-slate-800 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <Star className="w-5 h-5" />
            Posizioni salvate
            <span className="text-xs ml-auto bg-slate-700 px-2 py-0.5 rounded">
              {appData.favoritePositionIds.length}
            </span>
          </button>
          <button 
             onClick={() => setCurrentView('candidates_list')}
             className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${currentView === 'candidates_list' || currentView === 'candidate_detail' ? 'bg-slate-800 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <Users className="w-5 h-5" />
            Candidates <span className="text-xs ml-auto bg-slate-700 px-2 py-0.5 rounded">{appData.candidates.length}</span>
          </button>
          <button 
             onClick={() => setCurrentView('overlap_kanban')}
             className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${currentView === 'overlap_kanban' ? 'bg-slate-800 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
          >
            <TableIcon className="w-5 h-5" />
            Overlap Kanban
          </button>
        </nav>
        <div className="p-4 border-t border-slate-800">
          <button onClick={startNewSearch} className="flex items-center gap-2 text-slate-200 hover:text-white text-sm mb-3">
            <FileText className="w-4 h-4" /> Avvia nuova ricerca di personale
          </button>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="w-full flex items-center gap-2 text-slate-200 hover:text-white text-sm px-3 py-2 rounded-md bg-slate-800/60 hover:bg-slate-800"
          >
            <Menu className="w-4 h-4" /> Impostazioni
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {(currentView === 'dashboard' || currentView === 'favorites') && (
          <>
            <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">
                  {currentView === 'favorites' ? "Posizioni salvate" : "Dashboard Ricerca di personale"}
                </h1>
                <p className="text-sm text-slate-500">
                  {currentView === 'favorites'
                    ? "Le posizioni in shortlist del ciclo corrente."
                    : `Ciclo di disamina: ${appData.cycle.name}`}
                </p>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-200">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                Last saved: {new Date(appData.lastUpdated).toLocaleTimeString()}
              </div>
            </header>

            <div className="p-8 flex-1 overflow-y-auto">
              {/* Controls */}
              <div className="flex flex-col gap-4 mb-6">
                {lastImportStats && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    <div className="font-semibold text-slate-700 mb-2">Import summary</div>
                    <div className="flex flex-col gap-1">
                      <span>Candidates: {lastImportStats.candidates.imported} imported, {lastImportStats.candidates.duplicates} duplicates (rows: {lastImportStats.candidates.totalRows})</span>
                      <span>Positions: {lastImportStats.positions.imported} imported, {lastImportStats.positions.duplicates} duplicates (rows: {lastImportStats.positions.totalRows})</span>
                    </div>
                  </div>
                )}
                <div className="flex gap-4">
                  <div className="relative flex-1 max-w-md">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search positions..." 
                      className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                    />
                  </div>
                  
                  <MultiSelect
                    label="Entità"
                    options={entityOptions}
                    selected={filterEnte}
                    onChange={setFilterEnte}
                    placeholder="Tutte le entità"
                  />
                  <MultiSelect
                    label="Livello"
                    options={levelOptions}
                    selected={filterLevel}
                    onChange={setFilterLevel}
                    placeholder="Tutti i livelli"
                  />
                  <MultiSelect
                    label="Ruolo"
                    options={roleOptions}
                    selected={filterRole}
                    onChange={(next) => setFilterRole(next as RoleFilterValue[])}
                    placeholder="Tutti i ruoli"
                  />
                </div>

                {/* Status Tabs */}
                <div className="flex gap-2 border-b border-slate-200">
                  {(['all', 'todo', 'inprogress', 'completed'] as const).map(status => (
                    <button
                      key={status}
                      onClick={() => setFilterStatus(status)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-[1px]
                        ${filterStatus === status 
                          ? 'border-blue-600 text-blue-600' 
                          : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'}`}
                    >
                      {status === 'all' ? 'All Positions' : 
                       status === 'todo' ? 'To Do' :
                       status === 'inprogress' ? 'In Progress' : 'Completed'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {(currentView === 'favorites' ? filteredFavoritePositions : filteredPositions).map(pos => {
                  // Count candidates for this pos
                  const relevantCands = appData.candidates.filter(c => 
                     !!appData.evaluations[`${pos.code}_${c.id}`]
                  );
                  const count = relevantCands.length;
                  const status = getPositionStatus(pos, appData.evaluations);
                  const isFavorite = appData.favoritePositionIds.includes(pos.code);
                  
                  // Get selected candidates names
                  const selectedCands = appData.candidates
                    .filter(c => appData.evaluations[`${pos.code}_${c.id}`]?.status === 'selected');
                  
                  const selectedNames = selectedCands.map(c => c.nominativo);

                  return (
                    <PositionCard 
                      key={pos.code} 
                      position={pos}
                      status={status}
                      candidateCount={count}
                      selectedCandidatesNames={selectedNames}
                      selectedCandidatesDetails={selectedCands}
                      candidatesList={relevantCands}
                      isFavorite={isFavorite}
                      onToggleFavorite={toggleFavoritePosition}
                      onClick={() => {
                        setSelectedPositionId(pos.code);
                        setPositionsReturnView(currentView === 'favorites' ? 'favorites' : 'dashboard');
                        setCurrentView('position_detail');
                      }} 
                    />
                  );
                })}
              </div>
              {currentView === 'favorites' && filteredFavoritePositions.length === 0 && (
                <div className="mt-8 text-center text-sm text-slate-500">
                  Nessuna posizione in shortlist. Aggiungile dalla dashboard per ritrovarle qui.
                </div>
              )}
            </div>
          </>
        )}

        {currentView === 'candidates_list' && (
           <CandidatesListView 
              candidates={appData.candidates} 
              positions={appData.positions}
              evaluations={appData.evaluations}
              onNavigateToPosition={(posCode) => {
                 setSelectedPositionId(posCode);
                 setCurrentView('position_detail');
              }}
              onOpenCandidateDetail={(candId) => {
                 setSelectedCandidateId(candId);
                 setCurrentView('candidate_detail');
              }}
           />
        )}

        {currentView === 'overlap_kanban' && (
          <OverlapKanbanView
            candidates={appData.candidates}
            positions={appData.positions}
            evaluations={appData.evaluations}
            selectedPositionIds={overlapPositionIds}
            onSelectedPositionsChange={setOverlapPositionIds}
            onUpdate={updateEvaluation}
          />
        )}
      </main>

      {isNewCycleModalOpen && (
        <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-800">Avvia nuova ricerca di personale</h3>
            <p className="text-sm text-slate-500 mt-1">
              Inserisci il nome del ciclo per la nuova ricerca.
            </p>
            <div className="mt-4">
              <label className="text-xs font-medium text-slate-500">Nome ciclo</label>
              <input
                type="text"
                className="mt-2 w-full px-3 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Es. Ciclo disamine 2026/2027"
                value={newCycleName}
                onChange={(e) => setNewCycleName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    applyNewCycle();
                  }
                }}
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setIsNewCycleModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-800"
              >
                Annulla
              </button>
              <button
                onClick={applyNewCycle}
                disabled={!newCycleName.trim()}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:bg-slate-300 disabled:text-slate-500"
              >
                Avvia
              </button>
            </div>
          </div>
        </div>
      )}
      {currentConflict && (
        <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-[60]">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">
                  Conflitto import {currentConflict.type === "candidate" ? "candidato" : "posizione"}
                </h3>
                <p className="text-sm text-slate-500">
                  Conflitto {conflictStep} di {importConflictsTotal}
                </p>
              </div>
              <span className="text-xs uppercase font-semibold text-slate-400">
                Risoluzione manuale
              </span>
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="border border-slate-200 rounded-lg p-4 bg-slate-50">
                <div className="text-xs uppercase text-slate-400 font-semibold mb-3">Esistente</div>
                {currentConflict.type === "candidate" ? (
                  <dl className="space-y-2">
                    <div><dt className="text-slate-400 text-xs">Matricola</dt><dd className="text-slate-700 font-semibold">{currentConflict.existing.id}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Nominativo</dt><dd className="text-slate-700">{currentConflict.existing.nominativo}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Ruolo</dt><dd className="text-slate-700">{currentConflict.existing.rank} {currentConflict.existing.role}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Categoria/Specialità</dt><dd className="text-slate-700">{currentConflict.existing.category} {currentConflict.existing.specialty}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Ente</dt><dd className="text-slate-700">{currentConflict.existing.serviceEntity}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Applicazioni</dt><dd className="text-slate-700 line-clamp-2">{currentConflict.existing.rawAppliedString}</dd></div>
                  </dl>
                ) : (
                  <dl className="space-y-2">
                    <div><dt className="text-slate-400 text-xs">Codice</dt><dd className="text-slate-700 font-semibold">{currentConflict.existing.code}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Titolo</dt><dd className="text-slate-700">{currentConflict.existing.title}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Ente</dt><dd className="text-slate-700">{currentConflict.existing.entity}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Sede</dt><dd className="text-slate-700">{currentConflict.existing.location}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Requisiti</dt><dd className="text-slate-700">{currentConflict.existing.requirements.length}</dd></div>
                    <div><dt className="text-slate-400 text-xs">Profilo richiesto</dt><dd className="text-slate-700">{[currentConflict.existing.rankReq, currentConflict.existing.catSpecQualReq].filter(Boolean).join(" • ") || "-"}</dd></div>
                  </dl>
                )}
              </div>
              <div className="border border-blue-200 rounded-lg p-4 bg-blue-50">
                <div className="text-xs uppercase text-blue-500 font-semibold mb-3">Nuovo</div>
                {currentConflict.type === "candidate" ? (
                  <dl className="space-y-2">
                    <div><dt className="text-blue-400 text-xs">Matricola</dt><dd className="text-slate-700 font-semibold">{currentConflict.incoming.id}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Nominativo</dt><dd className="text-slate-700">{currentConflict.incoming.nominativo}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Ruolo</dt><dd className="text-slate-700">{currentConflict.incoming.rank} {currentConflict.incoming.role}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Categoria/Specialità</dt><dd className="text-slate-700">{currentConflict.incoming.category} {currentConflict.incoming.specialty}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Ente</dt><dd className="text-slate-700">{currentConflict.incoming.serviceEntity}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Applicazioni</dt><dd className="text-slate-700 line-clamp-2">{currentConflict.incoming.rawAppliedString}</dd></div>
                  </dl>
                ) : (
                  <dl className="space-y-2">
                    <div><dt className="text-blue-400 text-xs">Codice</dt><dd className="text-slate-700 font-semibold">{currentConflict.incoming.code}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Titolo</dt><dd className="text-slate-700">{currentConflict.incoming.title}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Ente</dt><dd className="text-slate-700">{currentConflict.incoming.entity}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Sede</dt><dd className="text-slate-700">{currentConflict.incoming.location}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Requisiti</dt><dd className="text-slate-700">{currentConflict.incoming.requirements.length}</dd></div>
                    <div><dt className="text-blue-400 text-xs">Profilo richiesto</dt><dd className="text-slate-700">{[currentConflict.incoming.rankReq, currentConflict.incoming.catSpecQualReq].filter(Boolean).join(" • ") || "-"}</dd></div>
                  </dl>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => resolveImportConflict("keep")}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:text-slate-800"
              >
                Mantieni esistente
              </button>
              <button
                onClick={() => resolveImportConflict("replace")}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                Sostituisci con nuovo
              </button>
            </div>
          </div>
        </div>
      )}
      <SettingsPanel
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        candidatesCount={appData.candidates.length}
        positionsCount={appData.positions.length}
        onSelectCandidatesFiles={handleSettingsCandidatesUpload}
        onSelectPositionsFiles={handleSettingsPositionsUpload}
        onClearCandidates={clearCandidatesData}
        onClearPositions={clearPositionsData}
        onExportBackup={exportBackup}
        onBackupUpload={handleBackupUpload}
        backupError={backupError}
        backupSuccess={backupSuccess}
        fileError={settingsFileError}
        fileSuccess={settingsFileSuccess}
        isProcessing={isSettingsProcessing}
        onResetData={resetData}
      />
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<RecruitmentApp />);
