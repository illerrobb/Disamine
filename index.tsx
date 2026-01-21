import React, { useState, useEffect, useMemo, useRef } from "react";
import { createRoot } from "react-dom/client";
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
  mixDescription: string; // DESCRIZIONE MIX
  languages: Language[];
  rawAppliedString: string;
  appliedPositionCodes: string[];
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

interface AppData {
  candidates: Candidate[];
  positions: Position[];
  evaluations: Record<string, Evaluation>; // Key: `${positionId}_${candidateId}`
  lastUpdated: number;
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

const parseCandidates = (data: any[]): Candidate[] => {
  const map = new Map<string, Candidate>();

  data.forEach((row) => {
    const keys = Object.keys(row);
    
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
        nosExpiry: String(row[nosScadenzaKey] || "").trim(),
        internationalMandates: String(row[mandatiKey] || "").trim(),
        mixDescription: String(row[mixKey] || "").trim(),
        languages: [],
        rawAppliedString: rawApplied,
        appliedPositionCodes: [], // Will be populated in handleDataLoaded via reverse matching
        originalData: row,
      });
    }

    const candidate = map.get(id)!;
    if (linguaKey && row[linguaKey]) {
      candidate.languages.push({
        language: String(row[linguaKey]).trim(),
        level: String(row[livelloKey] || "?").trim(),
      });
    }
  });

  return Array.from(map.values());
};

const parsePositions = (data: any[]): Position[] => {
  return data.map((row) => {
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

    if (!codeKey || !row[codeKey]) return null;

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

    return {
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
  }).filter(Boolean) as Position[];
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

// --- New Component: Candidate Detail View (Multi-Position Evaluation) ---

const CandidateDetailView = ({
  candidate,
  evaluations,
  allPositions,
  onUpdate,
  onBack
}: {
  candidate: Candidate;
  evaluations: Record<string, Evaluation>;
  allPositions: Position[];
  onUpdate: (ev: Evaluation) => void;
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
                              <option value="reserve">RESERVE</option>
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
                       <option value="reserve">RESERVE</option>
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
}> = ({ 
  candidate, 
  evaluation, 
  position, 
  otherSelection,
  onUpdate 
}) => {
  const [expanded, setExpanded] = useState(false);
  const isNonCompatible = evaluation.status === 'non-compatible';

  // Only count non-hidden requirements
  const activeReqs = position.requirements.filter(r => !r.hidden);
  const reqScore = activeReqs.filter(r => evaluation.reqEvaluations[r.id] === 'yes').length;
  const totalReqs = activeReqs.length;

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
    <div className={`border rounded-lg mb-2 shadow-sm overflow-hidden transition-all ${isNonCompatible ? 'bg-gray-50 border-gray-200 opacity-75' : 'bg-white border-slate-200'}`}>
      <div className="flex items-center p-3 gap-4 hover:bg-slate-50 transition-colors">
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
                <span className="text-xs text-slate-400 uppercase font-bold">Match</span>
                <span className={`font-bold text-sm ${reqScore === totalReqs && totalReqs > 0 ? 'text-green-600' : 'text-slate-700'}`}>
                  {reqScore}/{totalReqs}
                </span>
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
             <option value="reserve">RESERVE</option>
             <option value="rejected">REJECTED</option>
             <option value="non-compatible">NON COMPATIBILE</option>
           </select>
        </div>
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

// --- New Components ---

const FileUploadView = ({ onDataLoaded }: { onDataLoaded: (c: Candidate[], p: Position[]) => void }) => {
  const [candidatesFile, setCandidatesFile] = useState<File | null>(null);
  const [positionsFile, setPositionsFile] = useState<File | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const processFiles = async () => {
    if (!candidatesFile || !positionsFile) return;
    setIsProcessing(true);
    setError(null);

    try {
      // @ts-ignore
      if (!(window as any).XLSX) {
        throw new Error("XLSX library not loaded. Please ensure script is included.");
      }
      const XLSX = (window as any).XLSX;

      const readExcel = (file: File) => {
        return new Promise<any[]>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              const data = new Uint8Array(e.target?.result as ArrayBuffer);
              const workbook = XLSX.read(data, { type: 'array' });
              const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
              const jsonData = XLSX.utils.sheet_to_json(firstSheet);
              resolve(jsonData);
            } catch (err) {
              reject(err);
            }
          };
          reader.readAsArrayBuffer(file);
        });
      };

      const [candData, posData] = await Promise.all([
        readExcel(candidatesFile),
        readExcel(positionsFile)
      ]);

      const parsedCandidates = parseCandidates(candData);
      const parsedPositions = parsePositions(posData);

      onDataLoaded(parsedCandidates, parsedPositions);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to process files");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-lg shadow-md max-w-md w-full text-center">
        <h1 className="text-2xl font-bold text-slate-800 mb-6">Setup Recruitment Data</h1>
        
        <div className="space-y-4 mb-6">
          <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 hover:bg-slate-50 transition-colors relative">
            <input 
              type="file" 
              accept=".xlsx,.xls" 
              onChange={(e) => setPositionsFile(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <FileSpreadsheet className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-600">
              {positionsFile ? positionsFile.name : "Upload Positions Excel"}
            </p>
          </div>

          <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 hover:bg-slate-50 transition-colors relative">
             <input 
              type="file" 
              accept=".xlsx,.xls" 
              onChange={(e) => setCandidatesFile(e.target.files?.[0] || null)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <Users className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-sm font-medium text-slate-600">
              {candidatesFile ? candidatesFile.name : "Upload Candidates Excel"}
            </p>
          </div>
        </div>

        {error && <div className="text-red-500 text-sm mb-4">{error}</div>}

        <Button 
          onClick={processFiles} 
          disabled={!candidatesFile || !positionsFile || isProcessing}
          className="w-full justify-center"
        >
          {isProcessing ? "Processing..." : "Start Evaluation"}
        </Button>
      </div>
    </div>
  );
};

const PositionDetailView = ({
  position,
  allCandidates,
  evaluations,
  allPositions,
  onUpdate,
  onBack,
  onToggleReqVisibility,
  onExport
}: {
  position: Position;
  allCandidates: Candidate[];
  evaluations: Record<string, Evaluation>;
  allPositions: Position[];
  onUpdate: (ev: Evaluation) => void;
  onBack: () => void;
  onToggleReqVisibility: (posCode: string, reqId: string) => void;
  onExport: (p: Position, c: Candidate[], e: Record<string, Evaluation>, all: Position[]) => void;
}) => {
  const [viewMode, setViewMode] = useState<'list' | 'matrix'>('list');
  const [filter, setFilter] = useState<'all' | 'pending' | 'selected'>('all');

  const candidates = useMemo(() => {
    return allCandidates.filter(c => !!evaluations[`${position.code}_${c.id}`]);
  }, [allCandidates, evaluations, position.code]);

  const filteredCandidates = candidates.filter(c => {
    if (filter === 'all') return true;
    const status = evaluations[`${position.code}_${c.id}`]?.status;
    if (filter === 'pending') return status === 'pending';
    if (filter === 'selected') return status === 'selected';
    return true;
  });

  return (
    <div className="flex flex-col h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={onBack}>
             <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
               <span className="font-mono text-sm bg-slate-100 px-2 py-1 rounded text-slate-500">{position.code}</span>
               {position.title}
            </h1>
            <p className="text-sm text-slate-500">{position.entity} • {position.location}</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
           <div className="flex bg-slate-100 rounded p-1">
              <button 
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <LayoutList className="w-4 h-4" />
              </button>
              <button 
                onClick={() => setViewMode('matrix')}
                className={`p-1.5 rounded ${viewMode === 'matrix' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:text-slate-700'}`}
              >
                <TableIcon className="w-4 h-4" />
              </button>
           </div>
           
           <div className="h-6 w-px bg-slate-200 mx-2"></div>

           <Button variant="secondary" onClick={() => onExport(position, candidates, evaluations, allPositions)}>
             <Download className="w-4 h-4 mr-2" /> Export
           </Button>
        </div>
      </header>
      
      <div className="flex-1 overflow-hidden flex">
         {/* Sidebar for Requirements (Restored) */}
         <div className="w-80 flex-shrink-0 bg-slate-50 border-r border-slate-200 p-6 overflow-y-auto hidden lg:block">
            <h3 className="text-xs font-bold text-slate-500 uppercase mb-4 flex items-center gap-2">
               <Filter className="w-3 h-3" /> Manage Visibility
            </h3>
            <div className="space-y-4">
               <div>
                  <div className="text-xs font-semibold text-blue-700 mb-2">Essential</div>
                  <div className="space-y-2">
                     {position.requirements.filter(r => r.type === 'essential').map(req => (
                        <button
                           key={req.id}
                           onClick={() => onToggleReqVisibility(position.code, req.id)}
                           className={`w-full flex items-start gap-2 text-left p-2 rounded text-xs transition-colors ${!req.hidden ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:bg-slate-100'}`}
                        >
                           {req.hidden ? <EyeOff className="w-3 h-3 mt-0.5 shrink-0" /> : <Eye className="w-3 h-3 mt-0.5 shrink-0" />}
                           <span className={req.hidden ? 'line-through' : ''}>{req.text}</span>
                        </button>
                     ))}
                  </div>
               </div>
               <div>
                  <div className="text-xs font-semibold text-slate-600 mb-2">Desirable</div>
                  <div className="space-y-2">
                     {position.requirements.filter(r => r.type === 'desirable').map(req => (
                        <button
                           key={req.id}
                           onClick={() => onToggleReqVisibility(position.code, req.id)}
                           className={`w-full flex items-start gap-2 text-left p-2 rounded text-xs transition-colors ${!req.hidden ? 'bg-white shadow-sm text-slate-700' : 'text-slate-400 hover:bg-slate-100'}`}
                        >
                           {req.hidden ? <EyeOff className="w-3 h-3 mt-0.5 shrink-0" /> : <Eye className="w-3 h-3 mt-0.5 shrink-0" />}
                           <span className={req.hidden ? 'line-through' : ''}>{req.text}</span>
                        </button>
                     ))}
                  </div>
               </div>
            </div>
         </div>

         {/* Main Content */}
         <div className="flex-1 flex flex-col overflow-hidden bg-slate-100">
            {/* Toolbar */}
            <div className="px-6 py-3 bg-white border-b border-slate-200 flex items-center justify-between shrink-0">
               <div className="flex gap-2">
                  {['all', 'pending', 'selected'].map(f => (
                    <button
                      key={f}
                      onClick={() => setFilter(f as any)}
                      className={`px-3 py-1 text-xs font-medium rounded-full border ${filter === f ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-white text-slate-600 border-slate-200'}`}
                    >
                      {f.charAt(0).toUpperCase() + f.slice(1)}
                    </button>
                  ))}
               </div>
               <div className="text-xs text-slate-500">
                  {filteredCandidates.length} Candidates
               </div>
            </div>

            {/* List/Matrix Area */}
            <div className="flex-1 overflow-auto p-6">
               {viewMode === 'list' ? (
                 <div className="max-w-4xl mx-auto">
                    {filteredCandidates.map(c => (
                       <WorksheetRow 
                          key={c.id} 
                          candidate={c}
                          position={position}
                          evaluation={evaluations[`${position.code}_${c.id}`]}
                          otherSelection={getOtherSelectionInfo(c.id, position.code, evaluations, allPositions)}
                          onUpdate={onUpdate}
                       />
                    ))}
                 </div>
               ) : (
                  <CandidatesMatrixView 
                     candidates={filteredCandidates}
                     position={position}
                     evaluations={evaluations}
                     positions={allPositions}
                     onUpdate={onUpdate}
                  />
               )}
            </div>
         </div>
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

  const filtered = useMemo(() => {
    const s = search.toLowerCase();
    return candidates.filter(c => 
       c.nominativo.toLowerCase().includes(s) ||
       c.id.includes(s) ||
       c.rank.toLowerCase().includes(s)
    );
  }, [candidates, search]);

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-8 py-4">
        <h1 className="text-2xl font-bold text-slate-800 mb-4">Candidates Directory</h1>
        <div className="relative max-w-md">
           <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
           <input 
              type="text" 
              placeholder="Search candidates..." 
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
           />
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
         <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
               <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase text-xs">
                  <tr>
                     <th className="px-6 py-3">Candidate</th>
                     <th className="px-6 py-3">Rank / Role</th>
                     <th className="px-6 py-3">Entity</th>
                     <th className="px-6 py-3">Applications</th>
                     <th className="px-6 py-3 text-right">Action</th>
                  </tr>
               </thead>
               <tbody className="divide-y divide-slate-100">
                  {filtered.map(c => {
                     // Find applications
                     const apps = positions.filter(p => !!evaluations[`${p.code}_${c.id}`]);
                     
                     return (
                        <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                           <td className="px-6 py-4">
                              <div className="font-bold text-slate-800">{c.nominativo}</div>
                              <div className="text-xs text-slate-500 font-mono">{c.id}</div>
                           </td>
                           <td className="px-6 py-4">
                              <div className="text-slate-700">{c.rank}</div>
                              <div className="text-xs text-slate-500">{c.role} {c.category}</div>
                           </td>
                           <td className="px-6 py-4 text-slate-600">
                              {c.serviceEntity}
                           </td>
                           <td className="px-6 py-4">
                              <div className="flex flex-wrap gap-1">
                                 {apps.map(p => {
                                    const ev = evaluations[`${p.code}_${c.id}`];
                                    const statusColor = ev.status === 'selected' ? 'bg-green-100 text-green-700 border-green-200' :
                                                      ev.status === 'rejected' ? 'bg-red-50 text-red-700 border-red-100' :
                                                      'bg-slate-100 text-slate-600 border-slate-200';
                                    return (
                                       <button 
                                          key={p.code}
                                          onClick={() => onNavigateToPosition(p.code)}
                                          className={`text-[10px] px-1.5 py-0.5 rounded border ${statusColor} hover:opacity-80`}
                                       >
                                          {p.code}
                                       </button>
                                    )
                                 })}
                                 {apps.length === 0 && <span className="text-slate-400 italic text-xs">No applications</span>}
                              </div>
                           </td>
                           <td className="px-6 py-4 text-right">
                              <Button variant="secondary" className="text-xs py-1 h-8" onClick={() => onOpenCandidateDetail(c.id)}>
                                 View Profile
                              </Button>
                           </td>
                        </tr>
                     )
                  })}
               </tbody>
            </table>
            {filtered.length === 0 && (
               <div className="p-8 text-center text-slate-500">
                  No candidates found matching your search.
               </div>
            )}
         </div>
      </div>
    </div>
  );
};

// --- Export Logic ---

const exportToExcel = (position: Position, candidates: Candidate[], evaluations: Record<string, Evaluation>, positions: Position[]) => {
  // @ts-ignore
  if (!window.XLSX) return;
  const XLSX = (window as any).XLSX;

  // 1. Prepare Data Matrix
  // Filter out hidden requirements
  const activeReqs = position.requirements.filter(r => !r.hidden);

  const rows = candidates.map(c => {
    const ev = evaluations[`${position.code}_${c.id}`];
    if (!ev) return null;

    // Build requirement columns
    const reqCols: any = {};
    activeReqs.forEach((req, idx) => {
      const val = ev.reqEvaluations[req.id];
      const label = val === 'yes' ? 'YES' : val === 'no' ? 'NO' : val === 'partial' ? 'PARTIAL' : '-';
      reqCols[`Req ${idx + 1} (${req.type})`] = label;
    });

    // Check if selected elsewhere to append to notes
    let notes = ev.notes || "";
    const otherSel = getOtherSelectionInfo(c.id, position.code, evaluations, positions);
    if (otherSel) {
      const autoText = `Individuato per la posizione ${otherSel.code} ${otherSel.title} - ${otherSel.entity}`;
      notes = notes ? `${autoText}\n${notes}` : autoText;
    }

    return {
      "Matricola": c.id,
      "Grado": c.rank,
      "Nominativo": c.nominativo,
      "Ente Servizio": c.serviceEntity,
      "Ruolo": c.role,
      "Categoria": c.category,
      "Specialità": c.specialty,
      "NOS": `${c.nosLevel} ${c.nosQual}`,
      "Mandati": c.internationalMandates,
      "Mix": c.mixDescription,
      "Lingue": c.languages.map(l => `${l.language} ${l.level}`).join('; '),
      ...reqCols,
      "Valutazione Finale": ev.status.toUpperCase(),
      "Note": notes
    };
  }).filter(Boolean);

  if (rows.length === 0) return;

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Scheda Disamina");
  
  // Save file
  XLSX.writeFile(workbook, `Scheda_Disamina_${position.code}.xlsx`);
};

// --- Main App ---

const RecruitmentApp = () => {
  const [appData, setAppData] = useState<AppData>({
    candidates: [],
    positions: [],
    evaluations: {},
    lastUpdated: 0
  });

  const [currentView, setCurrentView] = useState<'upload' | 'dashboard' | 'position_detail' | 'candidates_list' | 'candidate_detail'>('upload');
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterEnte, setFilterEnte] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState<PositionStatus | 'all'>('all');

  // Load from LocalStorage
  useEffect(() => {
    const saved = localStorage.getItem('recruitment_db');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.candidates && parsed.positions) {
          setAppData(parsed);
          setCurrentView('dashboard');
        }
      } catch (e) { console.error("Failed to load DB", e); }
    }
  }, []);

  // Save to LocalStorage
  useEffect(() => {
    if (appData.lastUpdated > 0) {
      localStorage.setItem('recruitment_db', JSON.stringify(appData));
    }
  }, [appData]);

  const handleDataLoaded = (candidates: Candidate[], positions: Position[]) => {
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
             // Link them
             cand.appliedPositionCodes.push(pos.code);

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
      candidates,
      positions,
      evaluations,
      lastUpdated: Date.now()
    });
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

  const resetData = () => {
    if (confirm("Are you sure? This will delete all evaluations.")) {
      localStorage.removeItem('recruitment_db');
      window.location.reload();
    }
  };

  // Derived state
  const distinctEntities = useMemo(() => {
    const entes = new Set(appData.positions.map(p => p.entity));
    return ['ALL', ...Array.from(entes).sort()];
  }, [appData.positions]);

  const filteredPositions = useMemo(() => {
    const lowerSearch = searchTerm.toLowerCase();
    return appData.positions.filter(p => {
      const matchesSearch = 
         p.title.toLowerCase().includes(lowerSearch) || 
         p.code.toLowerCase().includes(lowerSearch) ||
         p.entity.toLowerCase().includes(lowerSearch) || // Added entity search
         p.location.toLowerCase().includes(lowerSearch); // Added location search

      const matchesEnte = filterEnte === 'ALL' || p.entity === filterEnte;
      
      const status = getPositionStatus(p, appData.evaluations);
      const matchesStatus = filterStatus === 'all' || status === filterStatus;

      return matchesSearch && matchesEnte && matchesStatus;
    });
  }, [appData.positions, appData.evaluations, searchTerm, filterEnte, filterStatus]);

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
          onBack={() => setCurrentView('dashboard')}
          onToggleReqVisibility={toggleRequirementVisibility}
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
        </nav>
        <div className="p-4 border-t border-slate-800">
          <button onClick={resetData} className="flex items-center gap-2 text-red-400 hover:text-red-300 text-sm">
            <Trash2 className="w-4 h-4" /> Reset Data
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden flex flex-col">
        {currentView === 'dashboard' && (
          <>
            <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
              <h1 className="text-2xl font-bold text-slate-800">Recruitment Dashboard</h1>
              <div className="flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-200">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                Last saved: {new Date(appData.lastUpdated).toLocaleTimeString()}
              </div>
            </header>

            <div className="p-8 flex-1 overflow-y-auto">
              {/* Controls */}
              <div className="flex flex-col gap-4 mb-6">
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
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<RecruitmentApp />);