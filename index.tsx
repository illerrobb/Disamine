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
  EyeOff
} from "lucide-react";

// --- Types ---

interface Language {
  language: string;
  level: string;
}

interface Candidate {
  id: string; // Matricola
  firstName: string;
  lastName: string;
  rank: string;
  role: string;      // New field
  category: string;  // New field
  specialty: string; // New field
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
  entity: string; // Ente
  location: string;
  title: string;
  requirements: Requirement[];
  originalData: any;
  jobDescriptionFileName?: string;
}

interface Evaluation {
  candidateId: string;
  positionId: string;
  reqEvaluations: Record<string, 'yes' | 'no' | 'partial' | 'pending'>; // Key is requirement text/id
  notes: string;
  status: 'pending' | 'selected' | 'rejected' | 'reserve';
  manualOrder?: number;
}

interface AppData {
  candidates: Candidate[];
  positions: Position[];
  evaluations: Record<string, Evaluation>; // Key: `${positionId}_${candidateId}`
  lastUpdated: number;
}

// --- Helper: Excel Parsing Logic ---

const normalizeHeader = (h: string) => h?.toString().trim().toUpperCase() || "";

const parseCandidates = (data: any[]): Candidate[] => {
  const map = new Map<string, Candidate>();

  data.forEach((row) => {
    // Attempt to find keys with robust matching
    const keys = Object.keys(row);
    const matricolaKey = keys.find(k => normalizeHeader(k).includes("MATRICOLA"));
    const cognomeKey = keys.find(k => normalizeHeader(k).includes("COGNOME"));
    const nomeKey = keys.find(k => normalizeHeader(k).includes("NOME"));
    const gradoKey = keys.find(k => normalizeHeader(k).includes("GRADO"));
    
    // New Fields
    const ruoloKey = keys.find(k => normalizeHeader(k).includes("RUOLO"));
    const catKey = keys.find(k => normalizeHeader(k).includes("CATEGORIA") || normalizeHeader(k) === "CAT" || normalizeHeader(k).startsWith("CAT."));
    const specKey = keys.find(k => normalizeHeader(k).includes("SPECIALIT") || normalizeHeader(k).includes("SPEC"));

    const linguaKey = keys.find(k => normalizeHeader(k).includes("LINGUA"));
    const livelloKey = keys.find(k => normalizeHeader(k).includes("LIVELLO") || normalizeHeader(k).includes("ACCERT")); 
    const poSegnalateKey = keys.find(k => normalizeHeader(k).includes("SEGNALATE") || normalizeHeader(k).includes("POSIZIONI"));

    if (!matricolaKey || !row[matricolaKey]) return;

    const id = String(row[matricolaKey]).trim();
    
    if (!map.has(id)) {
      // Parse Applied Positions
      const rawApplied = String(row[poSegnalateKey] || "");
      // Strategy: Split by " - " then take the last word of each segment as the code
      const codes = rawApplied.split(" - ").map((segment: string) => {
        const parts = segment.trim().split(/\s+/);
        return parts[parts.length - 1]; // Assume code is last
      }).filter((c: string) => c.length > 3); // Basic filter

      map.set(id, {
        id,
        firstName: String(row[nomeKey] || "").trim(),
        lastName: String(row[cognomeKey] || "").trim(),
        rank: String(row[gradoKey] || "").trim(),
        role: String(row[ruoloKey] || "").trim(),
        category: String(row[catKey] || "").trim(),
        specialty: String(row[specKey] || "").trim(),
        languages: [],
        rawAppliedString: rawApplied,
        appliedPositionCodes: [...new Set(codes)] as string[], // Dedup
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
    const codeKey = keys.find(k => normalizeHeader(k).includes("CODICE") || normalizeHeader(k) === "POSIZIONE");
    
    // Improved Entity Detection
    const enteKey = keys.find(k => 
      normalizeHeader(k).includes("ENTE") || 
      normalizeHeader(k).includes("STRUTTURA") || 
      normalizeHeader(k).includes("COMANDO") || 
      normalizeHeader(k).includes("REPARTO")
    );

    const locationKey = keys.find(k => normalizeHeader(k).includes("LUOGO") || normalizeHeader(k).includes("LOCALITA") || normalizeHeader(k).includes("SEDE"));
    const reqKey = keys.find(k => normalizeHeader(k).includes("REQUISITI") || normalizeHeader(k).includes("CRITERIA"));

    if (!codeKey || !row[codeKey]) return null;

    // Parse Requirements
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
        
        const isHeader = isNumbered || isCapsHeader;

        requirements.push({
          id: `${type}-${Math.random().toString(36).substr(2,9)}`,
          text: content,
          type,
          hidden: isHeader
        });
      });
    };

    if (essentialText) processBlock(essentialText, 'essential');
    if (desirableText) processBlock(desirableText, 'desirable');

    const codeStr = String(row[codeKey]).trim();

    return {
      code: codeStr,
      entity: String(row[enteKey] || "Unknown Entity").trim(),
      location: String(row[locationKey] || "").trim(),
      title: codeStr, 
      requirements,
      originalData: row,
    };
  }).filter(Boolean) as Position[];
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
    slate: "bg-slate-100 text-slate-800"
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-semibold ${colors[color]}`}>{children}</span>;
};

// --- Main Views ---

const FileUploadView = ({ onDataLoaded }: { onDataLoaded: (c: Candidate[], p: Position[]) => void }) => {
  const [candidatesFile, setCandidatesFile] = useState<File | null>(null);
  const [positionsFile, setPositionsFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const processFiles = async () => {
    if (!candidatesFile || !positionsFile) return;
    setLoading(true);
    setError("");
    
    try {
      // @ts-ignore
      if (!window.XLSX) throw new Error("Excel library not loaded");
      const XLSX = (window as any).XLSX;

      const readExcel = (file: File) => new Promise<any[]>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(firstSheet);
            resolve(json);
          } catch (err) { reject(err); }
        };
        reader.readAsArrayBuffer(file);
      });

      const [candRaw, posRaw] = await Promise.all([
        readExcel(candidatesFile),
        readExcel(positionsFile)
      ]);

      const candidates = parseCandidates(candRaw);
      const positions = parsePositions(posRaw);

      if (candidates.length === 0 || positions.length === 0) {
        throw new Error("Found 0 records. Please check file formats.");
      }

      onDataLoaded(candidates, positions);

    } catch (e: any) {
      setError(e.message || "Failed to process files");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full p-8 max-w-2xl mx-auto text-center">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900 mb-2">Import Data</h1>
        <p className="text-slate-500">Upload your Excel files to start the automated matching process.</p>
        <div className="mt-2 text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200 inline-block">
          <AlertCircle className="w-3 h-3 inline mr-1"/>
          Privacy First: Data is processed locally in your browser.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 w-full mb-8">
        <div className={`border-2 border-dashed rounded-xl p-8 transition-colors ${candidatesFile ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400'}`}>
          <Users className={`w-10 h-10 mx-auto mb-4 ${candidatesFile ? 'text-blue-600' : 'text-slate-400'}`} />
          <h3 className="font-semibold text-slate-700">Personal Data</h3>
          <p className="text-xs text-slate-500 mb-4">Upload the candidates excel</p>
          <input 
            type="file" 
            accept=".xlsx, .xls"
            onChange={(e) => setCandidatesFile(e.target.files?.[0] || null)}
            className="hidden" 
            id="cand-upload"
          />
          <label htmlFor="cand-upload" className="cursor-pointer text-sm text-blue-600 font-medium hover:underline">
            {candidatesFile ? candidatesFile.name : "Choose File"}
          </label>
        </div>

        <div className={`border-2 border-dashed rounded-xl p-8 transition-colors ${positionsFile ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-slate-400'}`}>
          <Briefcase className={`w-10 h-10 mx-auto mb-4 ${positionsFile ? 'text-blue-600' : 'text-slate-400'}`} />
          <h3 className="font-semibold text-slate-700">Position Data</h3>
          <p className="text-xs text-slate-500 mb-4">Upload the positions excel</p>
          <input 
            type="file" 
            accept=".xlsx, .xls"
            onChange={(e) => setPositionsFile(e.target.files?.[0] || null)}
            className="hidden" 
            id="pos-upload"
          />
          <label htmlFor="pos-upload" className="cursor-pointer text-sm text-blue-600 font-medium hover:underline">
            {positionsFile ? positionsFile.name : "Choose File"}
          </label>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 text-red-600 p-4 rounded-md mb-6 flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}

      <Button onClick={processFiles} disabled={!candidatesFile || !positionsFile || loading} className="w-full justify-center py-3 text-lg">
        {loading ? "Processing..." : "Start System"}
      </Button>
    </div>
  );
};

const PositionCard: React.FC<{ position: Position; candidateCount: number; onClick: () => void }> = ({ position, candidateCount, onClick }) => {
  return (
    <div 
      onClick={onClick}
      className="bg-white border border-slate-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer flex flex-col justify-between h-full group"
    >
      <div>
        <div className="flex justify-between items-start mb-2">
          <Badge color="slate">{position.entity}</Badge>
          <span className="text-xs font-mono text-slate-400">{position.code}</span>
        </div>
        <h3 className="font-semibold text-slate-800 mb-1 group-hover:text-blue-600 transition-colors line-clamp-2">{position.title || position.code}</h3>
        <div className="text-xs text-slate-500 flex items-center gap-1 mb-3">
          <Briefcase className="w-3 h-3" />
          {position.location}
        </div>
      </div>
      <div className="flex justify-between items-center pt-3 border-t border-slate-100">
        <div className="text-xs text-slate-500">
          <span className="font-medium text-slate-900">{candidateCount}</span> candidates
        </div>
        <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500" />
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
    c.lastName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    c.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
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
                  <th className="px-6 py-3">Rank/Name</th>
                  <th className="px-6 py-3">Role Info</th>
                  <th className="px-6 py-3">Languages</th>
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
                        <div className="font-medium text-slate-900">{c.lastName} {c.firstName}</div>
                        <div className="text-xs text-slate-500">{c.rank}</div>
                      </td>
                      <td className="px-6 py-3 text-xs text-slate-600">
                        <div><span className="font-semibold text-slate-400">Role:</span> {c.role}</div>
                        <div><span className="font-semibold text-slate-400">Cat:</span> {c.category}</div>
                        <div><span className="font-semibold text-slate-400">Spec:</span> {c.specialty}</div>
                      </td>
                      <td className="px-6 py-3 text-slate-500">
                        {c.languages.map(l => `${l.language} (${l.level})`).join(', ')}
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
                           <div className="space-y-2 pl-4 border-l-2 border-blue-200">
                              <h4 className="text-xs font-bold text-slate-500 uppercase">Applied Positions</h4>
                              {c.appliedPositionCodes.length === 0 && <p className="text-slate-400 italic">No valid position codes found.</p>}
                              {c.appliedPositionCodes.map(code => {
                                const pos = positions.find(p => p.code.includes(code) || code.includes(p.code));
                                const ev = pos ? evaluations[`${pos.code}_${c.id}`] : null;
                                return (
                                  <div key={code} className="flex items-center justify-between bg-white p-2 rounded border border-slate-200">
                                    <div className="flex items-center gap-3">
                                       <div className={`w-2 h-2 rounded-full ${pos ? 'bg-green-500' : 'bg-slate-300'}`}></div>
                                       <div>
                                         <p className="font-medium text-slate-700">{pos ? pos.title : `Unknown Position (${code})`}</p>
                                         <p className="text-xs text-slate-500">{pos?.entity} {pos?.location && `• ${pos.location}`}</p>
                                       </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                       {ev && (
                                         <span className={`text-xs px-2 py-0.5 rounded font-bold uppercase
                                           ${ev.status === 'selected' ? 'bg-green-100 text-green-700' : 
                                             ev.status === 'rejected' ? 'bg-red-100 text-red-700' : 
                                             'bg-slate-100 text-slate-600'}`}>
                                           {ev.status}
                                         </span>
                                       )}
                                       {pos && (
                                         <Button variant="ghost" className="h-6 text-xs" onClick={(e: any) => {
                                           e.stopPropagation();
                                           onNavigateToPosition(pos.code);
                                         }}>
                                           Go to Worksheet
                                         </Button>
                                       )}
                                    </div>
                                  </div>
                                )
                              })}
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

const WorksheetRow: React.FC<{ 
  candidate: Candidate; 
  evaluation: Evaluation; 
  position: Position; 
  onUpdate: (e: Evaluation) => void; 
}> = ({ 
  candidate, 
  evaluation, 
  position, 
  onUpdate 
}) => {
  const [expanded, setExpanded] = useState(false);

  // Only count non-hidden requirements
  const activeReqs = position.requirements.filter(r => !r.hidden);
  const reqScore = activeReqs.filter(r => evaluation.reqEvaluations[r.id] === 'yes').length;
  const totalReqs = activeReqs.length;

  const handleReqToggle = (reqId: string) => {
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
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  return (
    <div className="border border-slate-200 rounded-lg mb-2 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center p-3 gap-4 hover:bg-slate-50 transition-colors">
        <button onClick={() => setExpanded(!expanded)} className="text-slate-400 hover:text-slate-600">
          {expanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
        </button>
        
        <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center text-xs font-bold text-slate-600">
          {candidate.firstName[0]}{candidate.lastName[0]}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 truncate">{candidate.lastName} {candidate.firstName}</span>
            <span className="text-xs px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{candidate.rank}</span>
          </div>
          <div className="text-xs text-slate-500 flex gap-2 mt-0.5">
            <span className="font-mono">{candidate.id}</span>
            <span className="text-slate-300">|</span>
            <span className="truncate max-w-[150px]" title={`${candidate.role} - ${candidate.category} - ${candidate.specialty}`}>
               {candidate.role} {candidate.category} {candidate.specialty}
            </span>
             <span className="text-slate-300">|</span>
            <span className="truncate">{candidate.languages.map(l => `${l.language} (${l.level})`).join(', ')}</span>
          </div>
        </div>

        {/* Mini Score Dashboard */}
        <div className="flex gap-2 mr-4">
           <div className="flex flex-col items-center px-3 border-l border-slate-100">
              <span className="text-xs text-slate-400 uppercase font-bold">Match</span>
              <span className={`font-bold text-sm ${reqScore === totalReqs && totalReqs > 0 ? 'text-green-600' : 'text-slate-700'}`}>
                {reqScore}/{totalReqs}
              </span>
           </div>
           
           <select 
            value={evaluation.status}
            onChange={(e) => onUpdate({...evaluation, status: e.target.value as any})}
            className={`text-xs font-semibold px-2 py-1 rounded border appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-1 ${getStatusColor(evaluation.status)}`}
           >
             <option value="pending">PENDING</option>
             <option value="selected">SELECTED</option>
             <option value="reserve">RESERVE</option>
             <option value="rejected">REJECTED</option>
           </select>
        </div>
      </div>

      {expanded && (
        <div className="bg-slate-50 p-4 border-t border-slate-200 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3 flex items-center gap-2">
              <Briefcase className="w-3 h-3"/> Requirements Evaluation
            </h4>
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
          </div>
          
          <div className="flex flex-col h-full">
             <div className="mb-4 text-xs text-slate-600 bg-white p-3 rounded border border-slate-200">
               <div className="grid grid-cols-2 gap-2">
                  <div><span className="font-semibold">Ruolo:</span> {candidate.role}</div>
                  <div><span className="font-semibold">Categoria:</span> {candidate.category}</div>
                  <div><span className="font-semibold">Specialità:</span> {candidate.specialty}</div>
               </div>
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
             <div className="mt-4 p-3 bg-blue-50 rounded border border-blue-100 text-xs text-blue-800">
               <strong>Tip:</strong> Click requirements on the left to toggle status (Pending → Yes → No → Partial).
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// --- Export Logic ---

const exportToExcel = (position: Position, candidates: Candidate[], evaluations: Record<string, Evaluation>) => {
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

    return {
      "Matricola": c.id,
      "Grado": c.rank,
      "Cognome": c.lastName,
      "Nome": c.firstName,
      "Ruolo": c.role,
      "Categoria": c.category,
      "Specialità": c.specialty,
      "Lingue": c.languages.map(l => `${l.language} ${l.level}`).join('; '),
      ...reqCols,
      "Valutazione Finale": ev.status.toUpperCase(),
      "Note": ev.notes
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
      return matchesSearch && matchesEnte;
    });
  }, [appData.positions, searchTerm, filterEnte]);

  // Views Logic
  if (currentView === 'upload') {
    return <FileUploadView onDataLoaded={handleDataLoaded} />;
  }

  if (currentView === 'position_detail' && selectedPositionId) {
    const position = appData.positions.find(p => p.code === selectedPositionId)!;
    
    // Get candidates applied to this position
    const relevantCandidates = appData.candidates.filter(c => {
       // Check if evaluation exists (created during import)
       return !!appData.evaluations[`${position.code}_${c.id}`];
    });

    // Sort by status (Pending first, then by match score)
    const sortedCandidates = [...relevantCandidates].sort((a, b) => {
      const evA = appData.evaluations[`${position.code}_${a.id}`];
      const evB = appData.evaluations[`${position.code}_${b.id}`];
      
      if (evA.status === evB.status) {
         // Sort by req match count
         const activeReqs = position.requirements.filter(r => !r.hidden);
         const scoreA = activeReqs.filter(r => evA.reqEvaluations[r.id] === 'yes').length;
         const scoreB = activeReqs.filter(r => evB.reqEvaluations[r.id] === 'yes').length;
         return scoreB - scoreA;
      }
      return evA.status === 'pending' ? -1 : 1;
    });

    return (
      <div className="flex flex-col h-screen bg-white">
        {/* Header */}
        <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shadow-sm z-10">
          <div className="flex items-center gap-4">
            <Button variant="secondary" onClick={() => setCurrentView('dashboard')}>
              <ChevronRight className="w-4 h-4 rotate-180 mr-1" /> Back
            </Button>
            <div>
              <h1 className="text-xl font-bold text-slate-900">{position.title}</h1>
              <div className="text-sm text-slate-500 flex gap-2">
                <span className="font-mono">{position.code}</span>
                <span>•</span>
                <span>{position.entity}</span>
                <span>•</span>
                <span>{position.location}</span>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary">
              <Upload className="w-4 h-4 mr-2" /> Upload Job Desc
            </Button>
            <Button variant="primary" onClick={() => exportToExcel(position, sortedCandidates, appData.evaluations)}>
              <Download className="w-4 h-4 mr-2" /> Export Excel
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-hidden flex">
           {/* Sidebar Info - UPDATED with Visibility Controls */}
           <div className="w-80 border-r border-slate-200 bg-slate-50 p-6 overflow-y-auto hidden lg:block">
              <h3 className="font-bold text-slate-700 mb-4 uppercase text-xs tracking-wide">Requirements Manager</h3>
              <p className="text-[10px] text-slate-500 mb-4">Click the eye icon to hide headers or irrelevant lines from the evaluation worksheet.</p>
              
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-blue-800 mb-2">Essential</h4>
                  <ul className="space-y-2">
                    {position.requirements.filter(r => r.type === 'essential').map(r => (
                      <li key={r.id} className={`flex items-start gap-2 group ${r.hidden ? 'opacity-50' : ''}`}>
                         <button 
                            onClick={() => toggleRequirementVisibility(position.code, r.id)}
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
                            onClick={() => toggleRequirementVisibility(position.code, r.id)}
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
           <div className="flex-1 bg-slate-100 p-6 overflow-y-auto">
              <div className="max-w-4xl mx-auto">
                <div className="flex justify-between items-center mb-4">
                  <h2 className="text-lg font-bold text-slate-800">Candidates ({sortedCandidates.length})</h2>
                  <div className="flex gap-2 text-sm text-slate-500">
                    <span className="flex items-center"><div className="w-3 h-3 bg-green-500 rounded mr-1"></div> Yes</span>
                    <span className="flex items-center"><div className="w-3 h-3 bg-red-500 rounded mr-1"></div> No</span>
                    <span className="flex items-center"><div className="w-3 h-3 bg-amber-400 rounded mr-1"></div> Partial</span>
                  </div>
                </div>

                {sortedCandidates.length === 0 ? (
                  <div className="text-center p-12 bg-white rounded-lg border border-slate-200 border-dashed text-slate-400">
                    No candidates found for this position code.
                  </div>
                ) : (
                  sortedCandidates.map(c => (
                    <WorksheetRow 
                      key={c.id} 
                      candidate={c} 
                      position={position}
                      evaluation={appData.evaluations[`${position.code}_${c.id}`]!} 
                      onUpdate={updateEvaluation}
                    />
                  ))
                )}
              </div>
           </div>
        </div>
      </div>
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
              <div className="flex gap-4 mb-6">
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

              {/* Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {filteredPositions.map(pos => {
                  // Count candidates for this pos
                  const count = appData.candidates.filter(c => 
                     !!appData.evaluations[`${pos.code}_${c.id}`]
                  ).length;
                  
                  return (
                    <PositionCard 
                      key={pos.code} 
                      position={pos} 
                      candidateCount={count}
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