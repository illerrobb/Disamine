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
  User
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
  status: 'pending' | 'selected' | 'rejected' | 'reserve' | 'non-compatible';
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
  lastUpdated: number;
  cycle: Cycle;
}

type PositionStatus = 'todo' | 'inprogress' | 'completed';

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
    purple: "bg-purple-100 text-purple-800"
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colors[color]}`}>{children}</span>;
};

const ScoreBar = ({
  essentialScore,
  desirableScore,
  essentialTotal,
  desirableTotal,
  className = ''
}: {
  essentialScore: number;
  desirableScore: number;
  essentialTotal: number;
  desirableTotal: number;
  className?: string;
}) => {
  const essentialWeight = essentialTotal > 0 ? FIT_WEIGHTS.essential : 0;
  const desirableWeight = desirableTotal > 0 ? FIT_WEIGHTS.desirable : 0;
  const weightTotal = essentialWeight + desirableWeight || 1;
  const essentialWidth = (essentialWeight / weightTotal) * 100;
  const desirableWidth = (desirableWeight / weightTotal) * 100;

  const essentialColor =
    essentialTotal === 0 ? 'bg-slate-200' : essentialScore < 1 ? 'bg-red-500' : 'bg-green-500';
  const desirableColor =
    desirableTotal === 0
      ? 'bg-slate-200'
      : desirableScore === 1
      ? 'bg-green-400'
      : desirableScore > 0
      ? 'bg-amber-400'
      : 'bg-slate-300';

  return (
    <div className={`flex h-2 w-full overflow-hidden rounded-full bg-slate-100 ${className}`}>
      {essentialWidth > 0 && (
        <div className={essentialColor} style={{ width: `${essentialWidth}%` }} />
      )}
      {desirableWidth > 0 && (
        <div className={desirableColor} style={{ width: `${desirableWidth}%` }} />
      )}
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

  const getStatusColor = (s: string) => {
    switch(s) {
      case 'selected': return 'bg-green-100 text-green-800 border-green-200';
      case 'rejected': return 'bg-red-100 text-red-800 border-red-200';
      case 'reserve': return 'bg-amber-100 text-amber-800 border-amber-200';
      case 'non-compatible': return 'bg-gray-200 text-gray-800 border-gray-300';
      default: return 'bg-white text-slate-600 border-slate-200';
    }
  };

  const handleReqToggle = (ev: Evaluation, reqId: string) => {
    if (ev.status === 'non-compatible') return;
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
               const isNonCompatible = ev.status === 'non-compatible';
               const activeReqs = pos.requirements.filter(r => !r.hidden);
               const otherSelection = getOtherSelectionInfo(candidate.id, pos.code, evaluations, allPositions);
               
               // Calculate stats
               const reqScore = activeReqs.filter(r => ev.reqEvaluations[r.id] === 'yes').length;
               
               return (
                  <div key={pos.code} className={`bg-white rounded-lg border shadow-sm overflow-hidden ${isNonCompatible ? 'border-gray-200' : 'border-slate-200'}`}>
                     {/* Card Header */}
                     <div className={`px-6 py-4 border-b flex justify-between items-start ${isNonCompatible ? 'bg-gray-50' : 'bg-slate-50 border-slate-200'}`}>
                        <div>
                           <div className="flex items-center gap-2 mb-1">
                              <span className="font-mono text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">{pos.code}</span>
                              <h3 className={`font-bold text-lg ${isNonCompatible ? 'text-gray-500 line-through' : 'text-slate-800'}`}>{pos.title}</h3>
                           </div>
                           <div className="text-sm text-slate-500 flex gap-2">
                              <span>{pos.entity}</span>
                              <span>•</span>
                              <span>{pos.location}</span>
                           </div>
                           {otherSelection && (
                              <div className="mt-2 text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded border border-amber-200 inline-flex items-center gap-1">
                                 <AlertTriangle className="w-3 h-3" /> Warning: Selected for {otherSelection.code}
                              </div>
                           )}
                        </div>
                        
                        <div className="flex flex-col items-end gap-2">
                           <select 
                              value={ev.status}
                              onChange={(e) => onUpdate({...ev, status: e.target.value as any})}
                              className={`text-sm font-bold uppercase px-3 py-1.5 rounded border cursor-pointer focus:outline-none focus:ring-2 ${getStatusColor(ev.status)}`}
                           >
                              <option value="pending">PENDING</option>
                              <option value="selected" disabled={!!otherSelection && ev.status !== 'selected'}>
                                 {!!otherSelection && ev.status !== 'selected' ? 'GIÀ SELEZIONATO' : 'SELECTED'}
                              </option>
                              <option value="reserve">POSSIBILE MATCH</option>
                              <option value="rejected">REJECTED</option>
                              <option value="non-compatible">NON COMPATIBILE</option>
                           </select>
                           
                           {!isNonCompatible && (
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
                           {isNonCompatible ? (
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
                        <div>
                           <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Notes</h4>
                           <textarea
                              className="w-full h-40 border border-slate-300 rounded p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none bg-slate-50 focus:bg-white transition-colors"
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
      default: return 'bg-white text-slate-600 border-slate-200';
    }
  };

  const handleReqToggle = (evaluation: Evaluation, reqId: string) => {
    if (evaluation.status === 'non-compatible') return; // Read-only if non-compatible
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
            const isNonCompatible = ev.status === 'non-compatible';
            const otherSelection = getOtherSelectionInfo(c.id, position.code, evaluations, positions);

            return (
              <tr key={c.id} className={`hover:bg-slate-50 ${isNonCompatible ? 'bg-gray-100 opacity-60 grayscale' : ''}`}>
                <td className={`sticky left-0 border border-slate-200 p-2 w-80 min-w-[20rem] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] ${isNonCompatible ? 'bg-gray-100' : 'bg-white hover:bg-slate-50'}`}>
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
                </td>
                <td className={`border border-slate-200 p-2 w-[140px] sticky left-80 shadow-md ${isNonCompatible ? 'bg-gray-100' : 'bg-white'}`}>
                   <select 
                      value={ev.status}
                      onChange={(e) => onUpdate({...ev, status: e.target.value as any})}
                      className={`w-full text-[10px] font-bold uppercase px-1 py-1 rounded border appearance-none cursor-pointer focus:outline-none ${getStatusColor(ev.status)}`}
                     >
                       <option value="pending">PENDING</option>
                       <option value="selected" disabled={!!otherSelection && ev.status !== 'selected'}>
                          {!!otherSelection && ev.status !== 'selected' ? 'GIÀ SELEZIONATO' : 'SELECTED'}
                       </option>
                       <option value="reserve">POSSIBILE MATCH</option>
                       <option value="rejected">REJECTED</option>
                       <option value="non-compatible">NON COMPATIBILE</option>
                     </select>
                </td>
                {activeReqs.map(req => {
                  const status = ev.reqEvaluations[req.id] || 'pending';
                  return (
                    <td 
                      key={req.id} 
                      onClick={() => handleReqToggle(ev, req.id)}
                      className={`border border-slate-200 p-1 text-center select-none transition-colors ${!isNonCompatible && 'cursor-pointer hover:bg-slate-100'}`}
                    >
                      {!isNonCompatible && (
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
  onOpenRequirementsDrawer,
  isDragging,
  isDropTarget,
  onDragHandlePointerDown,
  isDragOverlay = false
}) => {
  const [expanded, setExpanded] = useState(false);
  const isNonCompatible = evaluation.status === 'non-compatible';

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
    if (isNonCompatible) return;
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
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <div
      {...(!isDragOverlay ? { "data-drag-row": true, "data-candidate-id": candidate.id } : {})}
      className={`border rounded-lg mb-2 shadow-sm overflow-hidden transition-all duration-200 ease-out transform-gpu ${isNonCompatible ? 'bg-gray-50 border-gray-200 opacity-75' : 'bg-white border-slate-200'} ${isDropTarget ? 'ring-2 ring-blue-300 bg-blue-50/40' : ''} ${isDragOverlay ? 'shadow-xl ring-2 ring-blue-200 pointer-events-none' : ''} ${isDragging && !isDragOverlay ? 'opacity-0 pointer-events-none' : ''}`}
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
            <span className={`font-medium truncate ${isNonCompatible ? 'text-gray-500 line-through' : 'text-slate-900'}`}>{candidate.nominativo}</span>
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
           {!isNonCompatible && (
             <div className="flex flex-col items-center px-3 border-l border-slate-100">
                <span className="text-[10px] text-slate-500 uppercase font-bold">E {essentialYes}/{essentialTotal}</span>
                <span className="text-[10px] text-slate-500 uppercase font-bold">D {desirableYes}/{desirableTotal}</span>
                <ScoreBar
                  essentialScore={essentialScore}
                  desirableScore={desirableScore}
                  essentialTotal={essentialTotal}
                  desirableTotal={desirableTotal}
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
             <option value="selected" disabled={!!otherSelection && evaluation.status !== 'selected'}>
               {!!otherSelection && evaluation.status !== 'selected' ? 'GIÀ SELEZIONATO' : 'SELECTED'}
             </option>
             <option value="reserve">POSSIBILE MATCH</option>
             <option value="rejected">REJECTED</option>
             <option value="non-compatible">NON COMPATIBILE</option>
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
            {isNonCompatible ? (
               <div className="p-4 bg-gray-100 rounded border border-gray-200 text-center text-gray-500 text-sm">
                  Evaluation disabled for non-compatible profiles.
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
            <textarea
              className="flex-1 w-full border border-slate-300 rounded p-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
              placeholder="Add evaluation notes here..."
              value={evaluation.notes}
              onChange={(e) => onUpdate({...evaluation, notes: e.target.value})}
              rows={5}
            />
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
  onClick: () => void;
}> = ({ 
  position, 
  status, 
  candidateCount, 
  selectedCandidatesNames, 
  selectedCandidatesDetails,
  candidatesList,
  onClick 
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

  return (
    <div 
      onClick={onClick}
      className="bg-white rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col h-full"
    >
      <div className="p-5 flex-1">
        <div className="flex justify-between items-start mb-2">
          <span className="font-mono text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded">{position.code}</span>
          <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full ${statusColors[status]}`}>
            {statusLabels[status]}
          </span>
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
    if (c.globalNotes) {
       noteParts.push(`NOTE GLOBALI: ${c.globalNotes}`);
    }
    if (ev.notes) {
       noteParts.push(ev.notes);
    }
    if (otherSel) {
       noteParts.push(`INDIVIDUATO PER LA POSIZIONE ${otherSel.code} ${otherSel.title} (${otherSel.entity})`);
    }
    const noteText = noteParts.join("\n");

    const mapStatusToText = (s: string) => {
       if (s === 'selected') return 'FAVOREVOLE';
       if (s === 'rejected') return 'NON FAVOREVOLE';
       if (s === 'reserve') return 'POSSIBILE MATCH';
       if (s === 'non-compatible') return 'NON COMPATIBILE';
       return '';
    };

    const englishLanguage = c.languages.find(l => l.language === "INGLESE");
    const englishLevelRaw = englishLanguage?.level ?? "";
    const englishLevelDigits = englishLevelRaw.replace(/\D/g, "");
    const englishLevel = englishLevelDigits.length >= 4 ? englishLevelDigits.slice(0, 4) : englishLevelDigits;
    const englishCell = englishLanguage ? `INGLESE\n${englishLevel || englishLevelRaw}` : "";

    const nominativoLabel = `${[c.rank, c.role, c.category, c.specialty].filter(Boolean).join(" ")}\n${c.nominativo}`.trim();

    const baseValues = [
       nominativoLabel, // Nominativo
       "SI", // Profilo richiesto match placeholder
       c.specificAssignments || "", // Attribuzioni specifiche/Corsi obbligatori
       ...(includeOfcn ? [c.ofcnSuitability || ""] : []), // Idoneità OFCN
       c.nosLevel, // NOS
       englishCell // Inglese
    ];

    const corsoGraduat = [c.category, c.specialty].filter(Boolean).join(" / ");
    const mandatesDetail = [c.internationalMandates, c.mixDescription].filter(Boolean).join("\n");

    return [
       ...baseValues,
       ...essentialReqs.map(r => ev.reqEvaluations[r.id] === 'yes' ? 'SI' : ev.reqEvaluations[r.id] === 'no' ? 'NO' : '-'),
       ...desirableReqs.map(r => ev.reqEvaluations[r.id] === 'yes' ? 'SI' : ev.reqEvaluations[r.id] === 'no' ? 'NO' : '-'),
       corsoGraduat, // Corso/Graduat.
       c.feoDate, // Data FEO
       c.serviceEntity, // Ente FEO
       mandatesDetail, // Mandati Estero / data ultimo rientro
       c.commanderOpinion || mapStatusToText(ev.status), // Parere
       noteText // Note
    ];
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
    ...dataRows
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
    wrap = true
  }: {
    bold?: boolean;
    size?: number;
    color?: string;
    fill?: string;
    align?: "center" | "left" | "right";
    valign?: "center" | "top" | "bottom";
    wrap?: boolean;
  }) => ({
    font: { name: "Calibri", sz: size, bold, color: { rgb: color } },
    alignment: { horizontal: align, vertical: valign, wrapText: wrap },
    fill: { patternType: "solid", fgColor: { rgb: fill } },
    border: baseBorder
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
    row.forEach((value, c) => {
      const cellAddr = XLSX.utils.encode_cell({ r, c });
      if (!worksheet[cellAddr]) return;
      let color = black;
      if (value === "SI") color = green;
      if (value === "NO") color = red;
      const fill = c === 0 ? nominativoFill : white;
      setCellStyle(cellAddr, makeStyle({ color, fill, align: c === 0 ? "center" : "center", valign: "center" }));
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
      const XLSX = getStyledXlsx();

      const readExcel = (file: File) => {
        return new Promise<any[]>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const data = e.target?.result;
              const workbook = XLSX.read(data, { type: 'binary', cellDates: true });
              const firstSheetName = workbook.SheetNames[0];
              console.log("[readExcel] Sheet names:", workbook.SheetNames);
              console.log("[readExcel] First sheet name:", firstSheetName);
              const worksheet = workbook.Sheets[firstSheetName];
              const json = XLSX.utils.sheet_to_json(worksheet, { raw: true });
              console.log("[readExcel] Sample keys:", Object.keys(json[0] || {}));
              resolve(json);
            } catch (err) {
              reject(err);
            }
          };
          reader.onerror = reject;
          reader.readAsBinaryString(file);
        });
      };

      const [cData, pData] = await Promise.all([
        Promise.all(candidatesFiles.map((file) => readExcel(file))),
        Promise.all(positionsFiles.map((file) => readExcel(file)))
      ]);

      const candidatesRows = cData.flat();
      const positionsRows = pData.flat();
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

   const filtered = candidates.filter(c => 
      c.nominativo.toLowerCase().includes(search.toLowerCase()) ||
      c.id.toLowerCase().includes(search.toLowerCase()) ||
      c.rank.toLowerCase().includes(search.toLowerCase())
   );

   return (
      <div className="flex flex-col h-full bg-slate-50">
         <header className="bg-white border-b border-slate-200 px-8 py-4">
            <h1 className="text-2xl font-bold text-slate-800 mb-4">Candidates Directory</h1>
            <div className="relative max-w-md">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
               <input 
                  type="text" 
                  placeholder="Search candidates by name, ID, or rank..." 
                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
               />
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
                                       const isSel = ev?.status === 'selected';
                                       return (
                                          <button 
                                             key={p.code}
                                             onClick={() => onNavigateToPosition(p.code)}
                                             className={`text-xs px-2 py-0.5 rounded border ${isSel ? 'bg-green-100 text-green-700 border-green-200' : 'bg-slate-100 text-slate-600 border-slate-200 hover:border-slate-300'}`}
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
  onUpdate,
  onUpdateRequirements
}: {
  candidates: Candidate[];
  positions: Position[];
  evaluations: Record<string, Evaluation>;
  selectedPositionIds: string[];
  onSelectedPositionsChange: (ids: string[]) => void;
  onUpdate: (ev: Evaluation) => void;
  onUpdateRequirements: (positionCode: string, requirements: Requirement[]) => void;
}) => {
  const [onlyPossibleMatch, setOnlyPossibleMatch] = useState(false);
  const [drawerPosition, setDrawerPosition] = useState<Position | null>(null);
  const [draggingCandidateId, setDraggingCandidateId] = useState<string | null>(null);

  const candidateIdsByPosition = useMemo(() => {
    const map = new Map<string, Set<string>>();
    positions.forEach(position => map.set(position.code, new Set()));
    Object.values(evaluations).forEach(ev => {
      const candidateSet = map.get(ev.positionId);
      if (candidateSet) {
        candidateSet.add(ev.candidateId);
      }
    });
    return map;
  }, [positions, evaluations]);

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
      .sort((a, b) => {
        if (b.sharedCount !== a.sharedCount) return b.sharedCount - a.sharedCount;
        return a.position.code.localeCompare(b.position.code);
      });
  }, [overlapData, selectedPositionIds, candidateIdsByPosition, selectedCandidateIds]);

  const sortedPositions = useMemo(
    () => [...positions].sort((a, b) => a.code.localeCompare(b.code)),
    [positions]
  );

  const selectedPositions = useMemo(
    () => sortedPositions.filter(pos => selectedPositionIds.includes(pos.code)),
    [sortedPositions, selectedPositionIds]
  );

  const handleTogglePosition = (code: string) => {
    if (selectedPositionIds.includes(code)) {
      onSelectedPositionsChange(selectedPositionIds.filter(id => id !== code));
    } else {
      onSelectedPositionsChange([...selectedPositionIds, code]);
    }
  };

  const handleSelectAll = () => {
    onSelectedPositionsChange(sortedPositions.map(pos => pos.code));
  };

  const handleClearAll = () => {
    onSelectedPositionsChange([]);
  };

  const matchesPossible = (status: Evaluation["status"]) =>
    status !== "rejected" && status !== "non-compatible";

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
      default:
        return { label: "Pending", color: "blue" };
    }
  };

  const handleDragStart = useCallback(
    (candidateId: string) => (event: React.DragEvent<HTMLDivElement>) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", candidateId);
      setDraggingCandidateId(candidateId);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDraggingCandidateId(null);
  }, []);

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

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-8 py-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Overlap Kanban</h1>
            <p className="text-sm text-slate-500">Visualizza candidature per posizione selezionata.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              checked={onlyPossibleMatch}
              onChange={(event) => setOnlyPossibleMatch(event.target.checked)}
            />
            Solo Possibile match
          </label>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex">
        <aside className="w-72 border-r border-slate-200 bg-white p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Posizioni selezionate</h3>
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
          <div className="space-y-2">
            {sortedPositions.map(pos => (
              <label key={pos.code} className="flex items-start gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  checked={selectedPositionIds.includes(pos.code)}
                  onChange={() => handleTogglePosition(pos.code)}
                />
                <span>
                  <span className="font-mono text-xs text-slate-500">{pos.code}</span>
                  <span className="block text-slate-700 font-medium leading-snug">{pos.title}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-6 pt-4 border-t border-slate-200">
            <h4 className="text-sm font-semibold text-slate-700 mb-2">Aggiungi posizione</h4>
            {selectedPositionIds.length === 0 && (
              <p className="text-xs text-slate-400 italic">
                Seleziona almeno una posizione per vedere i suggerimenti.
              </p>
            )}
            {selectedPositionIds.length > 0 && suggestedPositions.length === 0 && (
              <p className="text-xs text-slate-400 italic">
                Nessuna posizione suggerita con candidati in comune.
              </p>
            )}
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
                  <div className="text-xs text-slate-700 font-medium leading-snug mt-1">
                    {position.title}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="flex-1 overflow-x-auto p-6">
          {selectedPositions.length === 0 ? (
            <div className="h-full flex items-center justify-center text-slate-500 text-sm">
              Seleziona almeno una posizione per vedere le candidature.
            </div>
          ) : (
            <div className="flex gap-4">
              {selectedPositions.map(position => {
                const positionCandidates = candidates
                  .map(candidate => ({
                    candidate,
                    evaluation: evaluations[`${position.code}_${candidate.id}`]
                  }))
                  .filter(entry => entry.evaluation);

                const filteredCandidates = positionCandidates.filter(({ evaluation }) =>
                  onlyPossibleMatch ? matchesPossible(evaluation!.status) : true
                );

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

                return (
                  <div key={position.code} className={`w-72 shrink-0 ${isDropDisabled ? 'opacity-40' : ''}`}>
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm">
                      <div className="border-b border-slate-100 p-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-100">
                            {position.code}
                          </span>
                          <h3 className="font-semibold text-slate-800 text-sm line-clamp-2">{position.title}</h3>
                        </div>
                        <div className="text-xs text-slate-500 mt-2">
                          {position.entity} • {position.location}
                        </div>
                        <div className="text-xs text-slate-400 mt-2">
                          {orderedCandidates.length} candidature
                        </div>
                      </div>
                      <div className="p-3 space-y-3 max-h-[60vh] overflow-y-auto">
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
                            <div>
                              <div className="text-[10px] uppercase text-slate-400">Selected</div>
                              <div className="font-semibold text-slate-700">
                                {selectedEntry.candidate.nominativo}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                {selectedEntry.candidate.rank} • {selectedEntry.candidate.role} {selectedEntry.candidate.category}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="font-semibold">Slot selected</div>
                              <div>Trascina qui il candidato selezionato.</div>
                            </div>
                          )}
                        </div>
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

                          return (
                            <div
                              key={candidate.id}
                              draggable
                              onDragStart={handleDragStart(candidate.id)}
                              onDragEnd={handleDragEnd}
                              className="border border-slate-200 rounded-lg p-3 bg-white shadow-sm cursor-grab active:cursor-grabbing"
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="font-semibold text-slate-800 text-sm">{candidate.nominativo}</div>
                                  <div className="text-[10px] text-slate-500 mt-0.5">
                                    {candidate.rank} • {candidate.role} {candidate.category} {candidate.specialty}
                                  </div>
                                </div>
                                <Badge color={badge.color}>{badge.label}</Badge>
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
                                  essentialScore={essentialScore}
                                  desirableScore={desirableScore}
                                  essentialTotal={essentialTotal}
                                  desirableTotal={desirableTotal}
                                  className="mt-1"
                                />
                              </div>
                              <button
                                onClick={() => setDrawerPosition(position)}
                                className="mt-3 text-[11px] text-blue-600 hover:text-blue-700 font-semibold flex items-center gap-1"
                              >
                                <FileText className="w-3 h-3" /> Requisiti
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

      <RequirementsDrawer
        isOpen={!!drawerPosition}
        position={drawerPosition}
        onClose={() => setDrawerPosition(null)}
        onSave={onUpdateRequirements}
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
  onReorder,
  onBack,
  onToggleReqVisibility,
  onUpdateRequirements,
  onExport
}: {
  position: Position;
  allCandidates: Candidate[];
  evaluations: Record<string, Evaluation>;
  allPositions: Position[];
  onUpdate: (ev: Evaluation) => void;
  onReorder: (positionId: string, orderedCandidateIds: string[]) => void;
  onBack: () => void;
  onToggleReqVisibility: (posCode: string, reqId: string) => void;
  onUpdateRequirements: (positionCode: string, requirements: Requirement[]) => void;
  onExport: (p: Position, c: Candidate[], e: Record<string, Evaluation>, pos: Position[]) => void;
}) => {
  const [viewMode, setViewMode] = useState<'list' | 'matrix'>('list');
  const [filter, setFilter] = useState('all'); // all, selected, pending...
  const [isRequirementsOpen, setIsRequirementsOpen] = useState(true);
  const [isRequirementsDrawerOpen, setIsRequirementsDrawerOpen] = useState(false);
  const baseOrderMap = useMemo(() => new Map(allCandidates.map((c, index) => [c.id, index])), [allCandidates]);
  const previousRowPositionsRef = useRef<Map<string, DOMRect>>(new Map());

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
      if (filter === 'all') return true;
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
                 <h1 className="text-xl font-bold text-slate-900 truncate">{position.title}</h1>
               </div>
               <div className="text-sm text-slate-500 flex gap-4">
                 <span className="flex items-center gap-1"><Building className="w-3 h-3" /> {position.entity}</span>
                 <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> {position.location}</span>
               </div>
            </div>
            <div className="flex items-center gap-2">
               <div className="text-right mr-4 text-xs text-slate-500">
                  <div className="font-bold text-slate-700">{stats.total} Candidates</div>
                  <div>{stats.selected} Selected • {stats.pending} Pending</div>
               </div>
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
    lastUpdated: 0,
    cycle: createDefaultCycle()
  }));

  const [currentView, setCurrentView] = useState<'upload' | 'dashboard' | 'position_detail' | 'candidates_list' | 'candidate_detail' | 'overlap_kanban'>('upload');
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [overlapPositionIds, setOverlapPositionIds] = useState<string[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterEnte, setFilterEnte] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState<PositionStatus | 'all'>('all');
  const [isNewCycleModalOpen, setIsNewCycleModalOpen] = useState(false);
  const [newCycleName, setNewCycleName] = useState("");
  const [backupError, setBackupError] = useState("");
  const [backupSuccess, setBackupSuccess] = useState("");
  const [lastImportStats, setLastImportStats] = useState<ImportStats | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

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
            cycle: parsed.cycle ?? createDefaultCycle()
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
      lastUpdated: Date.now()
    });
    setLastImportStats(stats);
    setOverlapPositionIds(positions.slice(0, 3).map(pos => pos.code));
    setCurrentView('dashboard');
  };

  const updateEvaluation = (ev: Evaluation) => {
    setAppData(prev => {
      const newEvaluations = { ...prev.evaluations };

      // SINGLE SELECTION LOGIC:
      // If setting this candidate to SELECTED, find any other candidate for this position
      // who is currently SELECTED and set them to PENDING.
      if (ev.status === 'selected') {
         Object.values(newEvaluations).forEach((val) => {
            const existingEv = val as Evaluation;
            if (existingEv.positionId === ev.positionId && existingEv.candidateId !== ev.candidateId && existingEv.status === 'selected') {
               // Clone the object to ensure React state updates correctly, 
               // though strictly speaking we are already working on a shallow copy of the dictionary
               newEvaluations[`${existingEv.positionId}_${existingEv.candidateId}`] = {
                  ...existingEv,
                  status: 'pending' // Revert to pending
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
    const { candidates, positions, evaluations, lastUpdated, cycle } = payload.appData as AppData;
    if (!Array.isArray(candidates) || !Array.isArray(positions) || !isObject(evaluations)) {
      throw new Error("Formato backup non valido.");
    }
    if (!isObject(cycle) || typeof cycle.name !== "string" || typeof cycle.startedAt !== "number" || typeof cycle.id !== "string") {
      throw new Error("Formato backup non valido.");
    }
    if (typeof lastUpdated !== "number") {
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
          lastUpdated: nextAppData.lastUpdated,
          cycle: nextAppData.cycle
        });
        setSelectedCandidateId(null);
        setSelectedPositionId(null);
        setOverlapPositionIds([]);
        setFilterEnte("ALL");
        setFilterStatus('all');
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
      lastUpdated: Date.now(),
      cycle: nextCycle
    });
    setCurrentView('upload');
    setSelectedCandidateId(null);
    setSelectedPositionId(null);
    setOverlapPositionIds([]);
    setFilterEnte("ALL");
    setFilterStatus('all');
    setSearchTerm("");
    setIsNewCycleModalOpen(false);
  };

  // Derived state
  const distinctEntities = useMemo(() => {
    const entes = new Set(appData.positions.map(p => p.entity));
    return ['ALL', ...Array.from(entes).sort()];
  }, [appData.positions]);

  const lowerSearch = searchTerm.trim().toLowerCase();
  const filteredPositions = appData.positions.filter(p => {
    const matchesSearch = 
      p.title.toLowerCase().includes(lowerSearch) || 
      p.code.toLowerCase().includes(lowerSearch) ||
      p.entity.toLowerCase().includes(lowerSearch) ||
      p.location.toLowerCase().includes(lowerSearch);

    const matchesEnte = filterEnte === 'ALL' || p.entity === filterEnte;
    
    const status = getPositionStatus(p, appData.evaluations);
    const matchesStatus = filterStatus === 'all' || status === filterStatus;

    return matchesSearch && matchesEnte && matchesStatus;
  });

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
          onReorder={updateManualOrder}
          onBack={() => setCurrentView('dashboard')}
          onToggleReqVisibility={toggleRequirementVisibility}
          onUpdateRequirements={updatePositionRequirements}
          onExport={exportToExcel}
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
          <button onClick={resetData} className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm">
            <Trash2 className="w-4 h-4" /> Reset Data
          </button>
          <div className="mt-6">
            <p className="text-xs uppercase tracking-wide text-slate-500 mb-3">Impostazioni</p>
            <div className="space-y-2">
              <button
                onClick={exportBackup}
                className="w-full flex items-center gap-2 text-slate-200 hover:text-white text-sm px-3 py-2 rounded-md bg-slate-800/60 hover:bg-slate-800"
              >
                <Download className="w-4 h-4" /> Scarica backup
              </button>
              <button
                onClick={() => backupInputRef.current?.click()}
                className="w-full flex items-center gap-2 text-slate-200 hover:text-white text-sm px-3 py-2 rounded-md bg-slate-800/60 hover:bg-slate-800"
              >
                <Upload className="w-4 h-4" /> Carica backup
              </button>
              <input
                ref={backupInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={handleBackupUpload}
              />
              {backupError && (
                <div className="text-xs text-red-400 flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3" /> {backupError}
                </div>
              )}
              {backupSuccess && !backupError && (
                <div className="text-xs text-emerald-400 flex items-center gap-2">
                  <Check className="w-3 h-3" /> {backupSuccess}
                </div>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {currentView === 'dashboard' && (
          <>
            <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold text-slate-800">Dashboard Ricerca di personale</h1>
                <p className="text-sm text-slate-500">Ciclo di disamina: {appData.cycle.name}</p>
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
                  
                  <select 
                    className="px-4 py-2 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={filterEnte}
                    onChange={(e) => setFilterEnte(e.target.value)}
                  >
                    {distinctEntities.map(e => <option key={e} value={e}>{e === 'ALL' ? 'All Entities' : e}</option>)}
                  </select>
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
                {filteredPositions.map(pos => {
                  // Count candidates for this pos
                  const relevantCands = appData.candidates.filter(c => 
                     !!appData.evaluations[`${pos.code}_${c.id}`]
                  );
                  const count = relevantCands.length;
                  const status = getPositionStatus(pos, appData.evaluations);
                  
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
                      onClick={() => {
                        setSelectedPositionId(pos.code);
                        setCurrentView('position_detail');
                      }} 
                    />
                  );
                })}
              </div>
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
            onUpdateRequirements={updatePositionRequirements}
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
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<RecruitmentApp />);
