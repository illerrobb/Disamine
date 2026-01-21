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
  Ban
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

const normalizeHeader = (h: string) => h?.toString().trim().toUpperCase() || "";

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
    const matricolaKey = findKey(keys, "MATRICOLA");
    const nominativoKey = findKey(keys, "NOMINATIVO");
    const cognomeKey = findKey(keys, "COGNOME");
    const nomeKey = findKey(keys, "NOME");
    const gradoKey = findKey(keys, "GRADO");
    
    // Professional Details
    const ruoloKey = findKey(keys, "RUOLO");
    const catKey = keys.find(k => normalizeHeader(k) === "CATEGORIA" || normalizeHeader(k) === "CAT" || normalizeHeader(k).startsWith("CAT."));
    const specKey = findKey(keys, "SPECIALIT", "SPEC");
    const enteServizioKey = findKey(keys, "ENTE DI SERVIZIO", "ENTE SERVIZIO", "REPARTO");
    
    // NOS Details
    const nosLivelloKey = findKey(keys, "LIVELLO NOS");
    const nosQualKey = findKey(keys, "QUALIFICA NOS");
    const nosScadenzaKey = findKey(keys, "SCADENZA", "RILASCIO");

    // History
    const mandatiKey = findKey(keys, "MANDATI", "INTERNAZIONALI");
    const mixKey = findKey(keys, "DESCRIZIONE MIX", "MIX", "IMPIEGO");

    // Language & Applications
    const linguaKey = findKey(keys, "LINGUA");
    const livelloKey = findKey(keys, "LIVELLO", "ACCERT");
    const poSegnalateKey = findKey(keys, "SEGNALATE", "POSIZIONI", "CANDIDATURE");

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

      // Parse Applied Positions
      const rawApplied = String(row[poSegnalateKey] || "");
      const codes = rawApplied.split(/[\s\-]+/).filter(s => s.length > 3 && /[A-Z0-9]/.test(s));

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
        appliedPositionCodes: [...new Set(codes)] as string[],
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
    
    const codeKey = findKey(keys, "CODICE", "POSIZIONE");
    // SEDE corresponds to Entity
    const sedeKey = findKey(keys, "SEDE", "ENTE", "STRUTTURA", "COMANDO");
    const jobTitleKey = findKey(keys, "JOB TITLE", "TITOLO", "DENOMINAZIONE");
    const locationKey = findKey(keys, "LUOGO", "LOCALITA", "NAZIONE");
    const reqKey = findKey(keys, "REQUISITI", "CRITERIA", "COMPETENZE");

    // Specific Fields
    const ingleseKey = findKey(keys, "INGLESE", "ENGLISH");
    const nosKey = keys.find(k => normalizeHeader(k) === "NOS"); // Exact match preferred
    const gradoKey = findKey(keys, "GRADO", "RANK");
    const catSpecKey = findKey(keys, "CAT", "SPEC", "QUAL", "CATEGORIA");
    const ofcnKey = findKey(keys, "OFCN");
    const interesseKey = findKey(keys, "INTERESSE");
    const titolareKey = findKey(keys, "TITOLARE");

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
      cleanText = cleanText.replace(/([•\-➢])/g, '\n$1');
      const lines = cleanText.split('\n');

      lines.forEach((line, i) => {
        let content = line.trim();
        content = content.replace(/^[-•➢\s]+/, '');
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
            <th className="sticky left-0 bg-slate-50 border border-slate-200 p-2 z-20 w-80 text-left shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
              Candidate
            </th>
            <th className="bg-slate-50 border border-slate-200 p-2 min-w-[140px] z-10 sticky left-80 shadow-md">
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
                <td className={`sticky left-0 border border-slate-200 p-2 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] ${isNonCompatible ? 'bg-gray-100' : 'bg-white hover:bg-slate-50'}`}>
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
                <td className={`border border-slate-200 p-2 sticky left-80 shadow-md ${isNonCompatible ? 'bg-gray-100' : 'bg-white'}`}>
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
        
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${isNonCompatible ? 'bg-gray-200 text-gray-500' : 'bg-slate-200 text-slate-600'}`}>
          {candidate.firstName[0]}{candidate.lastName[0]}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`font-medium truncate ${isNonCompatible ? 'text-gray-500 line-through' : 'text-slate-900'}`}>{candidate.nominativo}</span>
            <span className="text-xs px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{candidate.rank}</span>
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

// --- New Position Detail View Component ---

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
  onExport: (pos: Position, cands: Candidate[], evals: Record<string, Evaluation>, allPos: Position[]) => void;
}) => {
  const [detailViewMode, setDetailViewMode] = useState<'list' | 'matrix'>('list');

  // Logic previously inside the if block in RecruitmentApp
  const relevantCandidates = useMemo(() => allCandidates.filter(c => {
       return !!evaluations[`${position.code}_${c.id}`];
  }), [allCandidates, evaluations, position.code]);

  const candidatesForView = useMemo(() => {
        if (detailViewMode === 'matrix') {
             // Stable sort for Matrix
             return [...relevantCandidates].sort((a, b) => a.nominativo.localeCompare(b.nominativo));
        } else {
             // Score/Status sort for List
             return [...relevantCandidates].sort((a, b) => {
                const evA = evaluations[`${position.code}_${a.id}`];
                const evB = evaluations[`${position.code}_${b.id}`];
                
                const scoreStatus = (s: string) => {
                    if (s === 'selected') return 3;
                    if (s === 'reserve') return 2;
                    if (s === 'pending') return 1;
                    return 0; // rejected, non-compatible
                };

                const statusA = scoreStatus(evA.status);
                const statusB = scoreStatus(evB.status);

                if (statusA !== statusB) {
                    return statusB - statusA;
                }

                // If status same, Sort by req match count
                const activeReqs = position.requirements.filter(r => !r.hidden);
                const scoreA = activeReqs.filter(r => evA.reqEvaluations[r.id] === 'yes').length;
                const scoreB = activeReqs.filter(r => evB.reqEvaluations[r.id] === 'yes').length;
                return scoreB - scoreA;
             });
        }
    }, [relevantCandidates, evaluations, detailViewMode, position]);

  return (
      <div className="flex flex-col h-screen bg-white">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-4">
              <Button variant="secondary" onClick={onBack}>
                <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back
              </Button>
              <div>
                <h1 className="text-xl font-bold text-slate-900">{position.title}</h1>
                <div className="text-sm text-slate-500 flex gap-2">
                  <span className="font-mono">{position.code}</span>
                  <span>•</span>
                  <span>{position.location}</span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center gap-4">
               {/* View Toggle */}
               <div className="flex bg-slate-100 p-1 rounded-lg">
                 <button 
                    onClick={() => setDetailViewMode('list')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${detailViewMode === 'list' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                 >
                   <LayoutList className="w-4 h-4" /> List
                 </button>
                 <button 
                    onClick={() => setDetailViewMode('matrix')}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${detailViewMode === 'matrix' ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
                 >
                   <TableIcon className="w-4 h-4" /> Matrix
                 </button>
               </div>

               <div className="flex gap-2">
                  <Button variant="secondary">
                    <Upload className="w-4 h-4 mr-2" /> Job Desc
                  </Button>
                  <Button variant="primary" onClick={() => onExport(position, candidatesForView, evaluations, allPositions)}>
                    <Download className="w-4 h-4 mr-2" /> Export
                  </Button>
               </div>
            </div>
          </div>
          
          {/* Position Metadata Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2 text-xs bg-slate-50 p-2 rounded border border-slate-200">
             {position.rankReq && <div><span className="text-slate-400 font-semibold block">Grade</span>{position.rankReq}</div>}
             {position.englishReq && <div><span className="text-slate-400 font-semibold block">English</span>{position.englishReq}</div>}
             {position.nosReq && <div><span className="text-slate-400 font-semibold block">NOS</span>{position.nosReq}</div>}
             {position.catSpecQualReq && <div><span className="text-slate-400 font-semibold block">Cat/Spec</span>{position.catSpecQualReq}</div>}
             {position.ofcn && <div><span className="text-slate-400 font-semibold block">OFCN</span>{position.ofcn}</div>}
             {position.poInterest && <div><span className="text-slate-400 font-semibold block">Interest</span>{position.poInterest}</div>}
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex">
           {/* Sidebar Info */}
           <div className="w-80 border-r border-slate-200 bg-slate-50 p-6 overflow-y-auto hidden lg:block shrink-0">
              <h3 className="font-bold text-slate-700 mb-4 uppercase text-xs tracking-wide">Requirements Manager</h3>
              <p className="text-[10px] text-slate-500 mb-4">Click the eye icon to hide headers or irrelevant lines from the evaluation worksheet.</p>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-blue-800 mb-2">Essential</h4>
                  <ul className="space-y-2">
                    {position.requirements.filter(r => r.type === 'essential').map(r => (
                      <li key={r.id} className={`flex items-start gap-2 group ${r.hidden ? 'opacity-50' : ''}`}>
                         <button 
                            onClick={() => onToggleReqVisibility(position.code, r.id)}
                            className="mt-0.5 text-slate-400 hover:text-blue-600 focus:outline-none"
                         >
                            {r.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                         </button>
                         <span className={`text-xs leading-relaxed ${r.hidden ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-600'}`}>
                           {r.text}
                         </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-slate-700 mb-2">Desirable</h4>
                   <ul className="space-y-2">
                    {position.requirements.filter(r => r.type === 'desirable').map(r => (
                       <li key={r.id} className={`flex items-start gap-2 group ${r.hidden ? 'opacity-50' : ''}`}>
                         <button 
                            onClick={() => onToggleReqVisibility(position.code, r.id)}
                            className="mt-0.5 text-slate-400 hover:text-blue-600 focus:outline-none"
                         >
                            {r.hidden ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                         </button>
                         <span className={`text-xs leading-relaxed ${r.hidden ? 'text-slate-400 line-through decoration-slate-300' : 'text-slate-500'}`}>
                           {r.text}
                         </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
           </div>

           {/* Main Work Area */}
           <div className="flex-1 bg-slate-100 p-6 overflow-y-auto overflow-x-auto">
              <div className={`${detailViewMode === 'list' ? 'max-w-4xl mx-auto' : 'min-w-[800px]'}`}>
                {candidatesForView.length === 0 ? (
                  <div className="text-center p-12 bg-white rounded-lg border border-slate-200 border-dashed text-slate-400">
                    No candidates found for this position code.
                  </div>
                ) : (
                  detailViewMode === 'list' ? (
                    // List View: Use Ranked Candidates
                    candidatesForView.map(c => (
                      <WorksheetRow 
                        key={c.id} 
                        candidate={c} 
                        position={position}
                        evaluation={evaluations[`${position.code}_${c.id}`]!}
                        otherSelection={getOtherSelectionInfo(c.id, position.code, evaluations, allPositions)}
                        onUpdate={onUpdate}
                      />
                    ))
                  ) : (
                    // Matrix View: Use Stable Sorted Candidates
                    <CandidatesMatrixView 
                      candidates={candidatesForView}
                      position={position}
                      evaluations={evaluations}
                      positions={allPositions}
                      onUpdate={onUpdate}
                    />
                  )
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
  onNavigateToPosition 
}: { 
  candidates: Candidate[], 
  positions: Position[], 
  evaluations: Record<string, Evaluation>,
  onNavigateToPosition: (posId: string) => void
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const filtered = candidates.filter(c => 
    c.nominativo.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.id.includes(searchTerm)
  );

  return (
    <div className="flex flex-col h-full bg-slate-50">
       <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-slate-800">Candidates Directory</h1>
          <div className="relative w-64">
             <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
             <input 
                type="text" 
                placeholder="Search candidates..." 
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
          </div>
       </header>
       <div className="p-8 overflow-y-auto">
         <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium">
                <tr>
                  <th className="px-6 py-3">Matricola</th>
                  <th className="px-6 py-3">Nominativo</th>
                  <th className="px-6 py-3">Ente / NOS</th>
                  <th className="px-6 py-3">Role Info</th>
                  <th className="px-6 py-3">Applications</th>
                  <th className="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map(c => (
                  <React.Fragment key={c.id}>
                    <tr 
                      onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                      className={`hover:bg-slate-50 cursor-pointer transition-colors ${expandedId === c.id ? 'bg-blue-50/50' : ''}`}
                    >
                      <td className="px-6 py-3 font-mono text-slate-500">{c.id}</td>
                      <td className="px-6 py-3">
                        <div className="font-medium text-slate-900">{c.nominativo}</div>
                        <div className="text-xs text-slate-500">{c.rank}</div>
                      </td>
                      <td className="px-6 py-3 text-xs">
                        <div className="font-semibold text-slate-700">{c.serviceEntity || '-'}</div>
                        {c.nosLevel && (
                          <div className="text-slate-500 flex items-center gap-1 mt-1">
                            <Shield className="w-3 h-3" /> {c.nosLevel} ({c.nosExpiry})
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-3 text-xs text-slate-600">
                        <div>{c.role}</div>
                        <div className="text-slate-400">{c.category} {c.specialty}</div>
                      </td>
                      <td className="px-6 py-3">
                         <Badge color="blue">{c.appliedPositionCodes.length} Positions</Badge>
                      </td>
                      <td className="px-6 py-3 text-right">
                        {expandedId === c.id ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}
                      </td>
                    </tr>
                    {expandedId === c.id && (
                      <tr className="bg-slate-50/50">
                        <td colSpan={6} className="px-6 py-4">
                           <div className="flex gap-4">
                              <div className="w-1/3 space-y-2 p-3 bg-white rounded border border-slate-200">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-2">Details</h4>
                                <div className="text-xs space-y-1">
                                  <p><span className="font-semibold">Mix:</span> {c.mixDescription}</p>
                                  <p><span className="font-semibold">Mandati:</span> {c.internationalMandates}</p>
                                  <p><span className="font-semibold">Languages:</span> {c.languages.map(l => `${l.language} (${l.level})`).join(', ')}</p>
                                </div>
                              </div>
                              <div className="flex-1 space-y-2 pl-4 border-l-2 border-blue-200">
                                  <h4 className="text-xs font-bold text-slate-500 uppercase">Applied Positions</h4>
                                  {c.appliedPositionCodes.map(code => {
                                    const pos = positions.find(p => p.code.includes(code) || code.includes(p.code));
                                    const ev = pos ? evaluations[`${pos.code}_${c.id}`] : null;
                                    return (
                                      <div key={code} className="flex items-center justify-between bg-white p-2 rounded border border-slate-200">
                                        <div className="flex items-center gap-3">
                                          <div className={`w-2 h-2 rounded-full ${pos ? 'bg-green-500' : 'bg-slate-300'}`}></div>
                                          <div>
                                            <p className="font-medium text-slate-700">{pos ? pos.title : `Unknown (${code})`}</p>
                                            <p className="text-xs text-slate-500">{pos?.entity}</p>
                                          </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {ev && <span className="text-xs font-bold">{ev.status.toUpperCase()}</span>}
                                          {pos && <Button variant="ghost" className="h-6 text-xs" onClick={(e: any) => { e.stopPropagation(); onNavigateToPosition(pos.code); }}>Go</Button>}
                                        </div>
                                      </div>
                                    )
                                  })}
                              </div>
                           </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
         </div>
       </div>
    </div>
  )
}

// --- Missing Components ---

const FileUploadView = ({ onDataLoaded }: { onDataLoaded: (candidates: Candidate[], positions: Position[]) => void }) => {
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
      if (!window.XLSX) {
        throw new Error("XLSX library not found. Please include it in your HTML.");
      }
      const XLSX = (window as any).XLSX;

      const readFile = (file: File) => new Promise<any[]>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.SheetNames[0];
            const jsonData = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);
            resolve(jsonData);
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = reject;
        reader.readAsArrayBuffer(file);
      });

      const [candData, posData] = await Promise.all([
        readFile(candidatesFile),
        readFile(positionsFile)
      ]);

      const candidates = parseCandidates(candData);
      const positions = parsePositions(posData);

      onDataLoaded(candidates, positions);

    } catch (err: any) {
      setError(err.message || "Failed to process files");
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-lg max-w-lg w-full border border-slate-200 text-center">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-6">
          <Upload className="w-8 h-8" />
        </div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Upload Data</h1>
        <p className="text-slate-500 mb-8">Please upload both the Candidates and Positions Excel files to begin.</p>
        
        <div className="space-y-4 mb-8">
           <div className={`border-2 border-dashed rounded-lg p-4 transition-colors ${candidatesFile ? 'border-green-500 bg-green-50' : 'border-slate-300 hover:border-blue-400'}`}>
             <label className="flex items-center gap-3 cursor-pointer">
               <FileSpreadsheet className={`w-6 h-6 ${candidatesFile ? 'text-green-600' : 'text-slate-400'}`} />
               <div className="flex-1 text-left">
                  <span className="block font-medium text-sm text-slate-700">{candidatesFile ? candidatesFile.name : "Select Candidates File"}</span>
                  <span className="text-xs text-slate-400">.xlsx, .xls</span>
               </div>
               <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => setCandidatesFile(e.target.files?.[0] || null)} />
               {candidatesFile && <Check className="w-5 h-5 text-green-600" />}
             </label>
           </div>

           <div className={`border-2 border-dashed rounded-lg p-4 transition-colors ${positionsFile ? 'border-green-500 bg-green-50' : 'border-slate-300 hover:border-blue-400'}`}>
             <label className="flex items-center gap-3 cursor-pointer">
               <Briefcase className={`w-6 h-6 ${positionsFile ? 'text-green-600' : 'text-slate-400'}`} />
               <div className="flex-1 text-left">
                  <span className="block font-medium text-sm text-slate-700">{positionsFile ? positionsFile.name : "Select Positions File"}</span>
                  <span className="text-xs text-slate-400">.xlsx, .xls</span>
               </div>
               <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => setPositionsFile(e.target.files?.[0] || null)} />
               {positionsFile && <Check className="w-5 h-5 text-green-600" />}
             </label>
           </div>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-50 text-red-600 text-sm rounded flex items-center gap-2 justify-center">
             <AlertCircle className="w-4 h-4" /> {error}
          </div>
        )}

        <Button 
          className="w-full justify-center py-3 text-base" 
          disabled={!candidatesFile || !positionsFile || isProcessing}
          onClick={processFiles}
        >
          {isProcessing ? "Processing..." : "Start Import"}
        </Button>
      </div>
    </div>
  );
};

const PositionCard = ({ 
  position, 
  status, 
  candidateCount,
  selectedCandidatesNames,
  onClick 
}: { 
  position: Position; 
  status: PositionStatus; 
  candidateCount: number; 
  selectedCandidatesNames: string[];
  onClick: () => void;
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
             <span className={`font-medium ${selectedCandidatesNames.length > 0 ? 'text-green-700' : 'text-slate-400 italic'}`}>
               {selectedCandidatesNames.length > 0 ? selectedCandidatesNames.join(', ') : 'None'}
             </span>
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
         <div className="flex items-center gap-2">
           <Users className="w-4 h-4 text-slate-400" />
           <span className="font-bold text-slate-700">{candidateCount}</span>
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

  const [currentView, setCurrentView] = useState<'upload' | 'dashboard' | 'position_detail' | 'candidates_list'>('upload');
  const [selectedPositionId, setSelectedPositionId] = useState<string | null>(null);
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
    
    candidates.forEach(cand => {
      // Find matches based on fuzzy code matching
      cand.appliedPositionCodes.forEach(code => {
        // Try to find the exact position code
        const pos = positions.find(p => p.code.includes(code) || code.includes(p.code));
        if (pos) {
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
    setAppData(prev => ({
      ...prev,
      evaluations: {
        ...prev.evaluations,
        [`${ev.positionId}_${ev.candidateId}`]: ev
      },
      lastUpdated: Date.now()
    }));
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
    return appData.positions.filter(p => {
      const matchesSearch = p.title.toLowerCase().includes(searchTerm.toLowerCase()) || p.code.toLowerCase().includes(searchTerm.toLowerCase());
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
    
    // We render the dedicated component for Position Detail to avoid hook rules violation
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
             className={`w-full flex items-center gap-3 px-4 py-3 rounded-md transition-colors ${currentView === 'candidates_list' ? 'bg-slate-800 text-white' : 'hover:bg-slate-800 text-slate-400'}`}
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
                  const count = appData.candidates.filter(c => 
                     !!appData.evaluations[`${pos.code}_${c.id}`]
                  ).length;
                  const status = getPositionStatus(pos, appData.evaluations);
                  
                  // Get selected candidates names
                  const selectedNames = appData.candidates
                    .filter(c => appData.evaluations[`${pos.code}_${c.id}`]?.status === 'selected')
                    .map(c => c.nominativo);

                  return (
                    <PositionCard 
                      key={pos.code} 
                      position={pos}
                      status={status}
                      candidateCount={count}
                      selectedCandidatesNames={selectedNames}
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
           />
        )}
      </main>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<RecruitmentApp />);