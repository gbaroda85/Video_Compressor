import { useState, useRef, useEffect, createContext, useContext } from "react";

// ── API base URL (empty = same origin on Replit, full URL on Vercel) ──────────
const API = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

// ── Theme ─────────────────────────────────────────────────────────────────────
const ThemeCtx = createContext<{ dark: boolean; toggle: () => void }>({ dark: true, toggle: () => {} });

function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [dark, setDark] = useState<boolean>(() => {
    const s = localStorage.getItem("vt-theme");
    return s ? s === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    localStorage.setItem("vt-theme", dark ? "dark" : "light");
  }, [dark]);
  return <ThemeCtx.Provider value={{ dark, toggle: () => setDark(d => !d) }}>{children}</ThemeCtx.Provider>;
}

function ThemeToggle() {
  const { dark, toggle } = useContext(ThemeCtx);
  return (
    <button onClick={toggle} className="theme-toggle">
      {dark
        ? <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>Light</>
        : <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>Dark</>}
    </button>
  );
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmt(b: number) {
  if (!b) return "0 B";
  const u = ["B","KB","MB","GB"], i = Math.floor(Math.log(b)/Math.log(1024));
  return `${(b/1024**i).toFixed(2)} ${u[i]}`;
}
function toDisplay(s: number) {
  if (!isFinite(s)||s<0) s=0;
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
}
function parseTime(str: string): number|null {
  str=str.trim(); if(!str) return null;
  if(/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const p=str.split(":").map(Number); if(p.some(isNaN)) return null;
  if(p.length===2) return p[0]*60+p[1];
  if(p.length===3) return p[0]*3600+p[1]*60+p[2];
  return null;
}

type Quality = "high"|"medium"|"low";
type Tab = "compress"|"split"|"audio"|"mute"|"rotate"|"watermark";
type Stage = "idle"|"ready"|"uploading"|"processing"|"done";

const Q: Record<Quality,{label:string;tag:string}> = {
  high:   { label:"High",    tag:"~40–60% smaller" },
  medium: { label:"Balanced",tag:"~60–75% smaller" },
  low:    { label:"Max",     tag:"~80–90% smaller" },
};

interface VInfo { file:File; url:string; size:number; name:string; duration:number }
interface Result { url:string; size:number; originalSize:number; ext:string; mimeType:string }

const TOOLS: { id:Tab; icon:React.ReactNode; title:string; desc:string; color:string }[] = [
  { id:"compress",  color:"from-violet-600 to-purple-700", title:"Compress",      desc:"Shrink video size without visible quality loss",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 10l-5 5-5-5"/><line x1="12" y1="3" x2="12" y2="15"/></svg> },
  { id:"split",     color:"from-blue-600 to-indigo-700",   title:"Trim / Split",  desc:"Cut any segment from your video precisely",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> },
  { id:"audio",     color:"from-pink-600 to-rose-700",     title:"Extract Audio", desc:"Convert video to high-quality MP3",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg> },
  { id:"mute",      color:"from-orange-600 to-amber-700",  title:"Remove Audio",  desc:"Strip the audio track from any video",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg> },
  { id:"rotate",    color:"from-teal-600 to-cyan-700",     title:"Rotate Video",  desc:"Rotate your video 90° or 180° in any direction",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> },
  { id:"watermark", color:"from-emerald-600 to-green-700", title:"Add Watermark",  desc:"Add custom text watermark to any video",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> },
];

// ── XHR helpers ───────────────────────────────────────────────────────────────
function xhrPost(url:string, data:FormData, onP:(p:number)=>void, onDone:(ok:boolean,buf:ArrayBuffer,xhr:XMLHttpRequest)=>void, ref:React.MutableRefObject<XMLHttpRequest|null>) {
  const xhr=new XMLHttpRequest(); ref.current=xhr; xhr.responseType="arraybuffer";
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onP(Math.round(e.loaded/e.total*100));};
  xhr.onload=()=>onDone(xhr.status===200,xhr.response,xhr);
  xhr.onerror=()=>onDone(false,new ArrayBuffer(0),xhr);
  xhr.open("POST",url); xhr.send(data);
}

// Job-based upload: POST → jobId, poll /api/job/:id, download /api/job/:id/download
function useJobTool(endpoint:string, mime:string, ext:string) {
  const [info,setInfo]=useState<VInfo|null>(null);
  const [stage,setStage]=useState<Stage>("idle");
  const [progress,setProgress]=useState(0);
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const xhrRef=useRef<XMLHttpRequest|null>(null);
  const pollRef=useRef<ReturnType<typeof setInterval>|null>(null);
  const stopPoll=()=>{if(pollRef.current){clearInterval(pollRef.current);pollRef.current=null;}};

  const onFile=(f:File)=>{
    const url=URL.createObjectURL(f); const v=document.createElement("video"); v.src=url;
    v.onloadedmetadata=()=>setInfo({file:f,url,size:f.size,name:f.name,duration:v.duration});
    setStage("ready"); setResult(null); setError("");
  };
  const clear=()=>{xhrRef.current?.abort();stopPoll();setInfo(null);setStage("idle");setResult(null);setError("");};

  const run=(fd:FormData, savedInfo: VInfo)=>{
    setStage("uploading"); setProgress(0); setError("");
    const xhr=new XMLHttpRequest(); xhrRef.current=xhr;
    xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(Math.round(e.loaded/e.total*100));};
    xhr.responseType="json";
    xhr.onload=()=>{
      if(xhr.status===200&&xhr.response?.jobId){
        const jobId=xhr.response.jobId as string;
        setStage("processing");
        pollRef.current=setInterval(async()=>{
          try{
            const r=await fetch(`${API}/api/job/${jobId}`);
            const data=await r.json() as{status:string;originalSize:number;outputSize:number;error?:string};
            if(data.status==="done"){
              stopPoll();
              const dl=new XMLHttpRequest();
              dl.open("GET",`${API}/api/job/${jobId}/download`); dl.responseType="arraybuffer";
              dl.onload=()=>{
                if(dl.status===200){
                  const blob=new Blob([dl.response],{type:mime});
                  setResult({url:URL.createObjectURL(blob),size:Number(dl.getResponseHeader("X-Compressed-Size"))||blob.size,originalSize:Number(dl.getResponseHeader("X-Original-Size"))||savedInfo.size,ext,mimeType:mime});
                  setStage("done");
                } else {setError("Download failed. Please try again.");setStage("ready");}
              };
              dl.onerror=()=>{setError("Download failed. Please try again.");setStage("ready");};
              dl.send();
            } else if(data.status==="error"){
              stopPoll(); setError(data.error||"Something went wrong."); setStage("ready");
            }
          }catch{/* keep polling */}
        },2000);
      } else {setError("Something went wrong. Please try again.");setStage("ready");}
    };
    xhr.onerror=()=>{setError("Something went wrong. Please try again.");setStage("ready");};
    xhr.open("POST",endpoint); xhr.send(fd);
  };

  const cancel=()=>{xhrRef.current?.abort();stopPoll();setStage("ready");setProgress(0);};
  return{info,stage,progress,result,error,onFile,clear,run,cancel,setError};
}

// Simple direct upload (fast tools: audio, mute, split)
function useTool(endpoint:string, mime:string, ext:string) {
  const [info,setInfo]=useState<VInfo|null>(null);
  const [stage,setStage]=useState<Stage>("idle");
  const [progress,setProgress]=useState(0);
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const xhrRef=useRef<XMLHttpRequest|null>(null);

  const onFile=(f:File)=>{
    const url=URL.createObjectURL(f); const v=document.createElement("video"); v.src=url;
    v.onloadedmetadata=()=>setInfo({file:f,url,size:f.size,name:f.name,duration:v.duration});
    setStage("ready"); setResult(null); setError("");
  };
  const clear=()=>{xhrRef.current?.abort();setInfo(null);setStage("idle");setResult(null);setError("");};
  const run=(extra?:Record<string,string>)=>{
    if(!info)return;
    setStage("uploading"); setProgress(0); setError("");
    const fd=new FormData(); fd.append("video",info.file);
    if(extra)Object.entries(extra).forEach(([k,v])=>fd.append(k,v));
    xhrPost(endpoint,fd,p=>{setProgress(p);if(p===100)setStage("processing");},(ok,buf,xhr)=>{
      if(ok){
        const blob=new Blob([buf],{type:mime});
        setResult({url:URL.createObjectURL(blob),size:Number(xhr.getResponseHeader("X-Compressed-Size"))||blob.size,originalSize:Number(xhr.getResponseHeader("X-Original-Size"))||info.size,ext,mimeType:mime});
        setStage("done");
      } else {
        let msg="Something went wrong. Please try again.";
        try{const j=JSON.parse(new TextDecoder().decode(buf));if(j.error)msg=j.error;}catch{}
        setError(msg); setStage("ready");
      }
    },xhrRef);
  };
  const cancel=()=>{xhrRef.current?.abort();setStage("ready");setProgress(0);};
  return{info,stage,progress,result,error,onFile,clear,run,cancel,setError};
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
function DropZone({onFile}:{onFile:(f:File)=>void}) {
  const ref=useRef<HTMLInputElement>(null);
  const [drag,setDrag]=useState(false);
  return(
    <div onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f?.type.startsWith("video/"))onFile(f);}}
      onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
      onClick={()=>ref.current?.click()}
      className={`group cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center gap-4 py-16 px-6
        ${drag?"border-purple-500 bg-purple-500/8":"border-[var(--border-2)] hover:border-purple-400/50 hover:bg-purple-500/[0.03]"}`}>
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all ${drag?"bg-purple-500/20 scale-110":"bg-[var(--surface-2)] group-hover:bg-purple-500/10"}`}>
        <svg className={`w-7 h-7 transition-colors ${drag?"text-purple-500":"text-[var(--text-4)] group-hover:text-purple-500"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
      </div>
      <div className="text-center">
        <p className="font-semibold text-[var(--text-2)] text-[15px]">{drag?"Drop it here":"Drop your video here"}</p>
        <p className="text-[var(--text-3)] text-sm mt-1.5">or <span className="text-purple-500 underline underline-offset-2">browse files</span> · MP4, MOV, AVI, MKV, WebM</p>
      </div>
      <input ref={ref} type="file" accept="video/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f);}}/>
    </div>
  );
}

function FileRow({info,onClear,busy}:{info:VInfo;onClear:()=>void;busy:boolean}) {
  return(
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
      <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex-shrink-0 flex items-center justify-center">
        <svg className="w-4 h-4 text-purple-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[var(--text)] truncate">{info.name}</p>
        <p className="text-xs text-[var(--text-3)] mt-0.5">{fmt(info.size)} · {toDisplay(info.duration)}</p>
      </div>
      {!busy&&<button onClick={onClear} className="text-[var(--text-4)] hover:text-[var(--text-2)] transition-colors p-1.5 rounded-lg hover:bg-[var(--surface-2)]">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>}
    </div>
  );
}

function Spinner() {
  return(
    <div className="flex flex-col items-center gap-4 py-10">
      <div className="relative w-14 h-14">
        <svg className="w-14 h-14 -rotate-90" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="22" fill="none" stroke="var(--border-2)" strokeWidth="4"/>
          <circle cx="28" cy="28" r="22" fill="none" stroke="url(#sg)" strokeWidth="4" strokeLinecap="round"
            strokeDasharray="138.2" strokeDashoffset="100" className="animate-[spin_1.4s_linear_infinite]" style={{transformOrigin:"28px 28px"}}/>
          <defs><linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stopColor="#7c3aed"/><stop offset="100%" stopColor="#db2777"/></linearGradient></defs>
        </svg>
      </div>
      <p className="text-sm font-medium text-[var(--text-3)]">Processing…</p>
    </div>
  );
}

function UploadProgress({progress}:{progress:number}) {
  return(
    <div className="space-y-3 py-6">
      <div className="flex justify-between items-center">
        <span className="text-sm text-[var(--text-3)] font-medium">Uploading</span>
        <span className="text-sm font-bold text-purple-500 tabular-nums">{progress}%</span>
      </div>
      <div className="h-1.5 bg-[var(--surface-2)] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{background:"linear-gradient(90deg,#7c3aed,#db2777)",width:`${progress}%`}}/>
      </div>
    </div>
  );
}

function ResultPanel({result,onRedo,filename}:{result:Result;onRedo:()=>void;filename:string}) {
  const saved=Math.max(0,Math.round((1-result.size/result.originalSize)*100));
  const dl=()=>{const a=document.createElement("a");a.href=result.url;a.download=filename;a.click();};
  return(
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[{l:"Original",v:fmt(result.originalSize),hi:false},{l:"Saved",v:`${saved}%`,hi:true},{l:"New size",v:fmt(result.size),hi:false}].map(({l,v,hi})=>(
          <div key={l} className={`rounded-xl p-3 text-center ${hi?"bg-purple-500/10 border border-purple-500/20":"bg-[var(--surface)] border border-[var(--border)]"}`}>
            <p className="text-[10px] text-[var(--text-4)] uppercase tracking-widest font-semibold">{l}</p>
            <p className={`font-bold mt-1 ${hi?"text-purple-500 text-xl":"text-[var(--text-2)] text-sm"}`}>{v}</p>
          </div>
        ))}
      </div>
      {result.mimeType.startsWith("video")&&<video src={result.url} controls playsInline className="w-full rounded-xl max-h-52 bg-black object-contain"/>}
      {result.mimeType.startsWith("audio")&&<div className="bg-[var(--surface)] rounded-xl p-4 border border-[var(--border)]"><audio src={result.url} controls className="w-full"/></div>}
      <div className="flex gap-2.5">
        <button onClick={dl} className="btn-primary py-3.5 gap-2">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          Download {result.ext.toUpperCase()}
        </button>
        <button onClick={onRedo} className="px-5 py-3.5 rounded-xl border border-[var(--border-2)] text-sm font-semibold text-[var(--text-3)] hover:text-[var(--text)] transition-all">Try again</button>
      </div>
    </div>
  );
}

function ErrorMsg({msg,onDismiss}:{msg:string;onDismiss:()=>void}) {
  return(
    <div className="flex items-start gap-3 bg-red-500/6 border border-red-500/15 rounded-xl p-4">
      <svg className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <p className="text-[13px] text-red-500 flex-1 leading-relaxed">{msg}</p>
      <button onClick={onDismiss} className="text-red-400/50 hover:text-red-500"><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>
  );
}

function SectionLabel({children}:{children:React.ReactNode}) {
  return <p className="text-xs font-semibold text-[var(--text-4)] uppercase tracking-widest mb-3">{children}</p>;
}

function BusyControls({stage,progress,onCancel}:{stage:Stage;progress:number;onCancel:()=>void}) {
  return(
    <>
      {stage==="uploading"&&<UploadProgress progress={progress}/>}
      {stage==="processing"&&<Spinner/>}
      <button onClick={onCancel} className="w-full text-center text-xs text-[var(--text-4)] hover:text-[var(--text-3)] transition-colors underline underline-offset-2">Cancel</button>
    </>
  );
}

// ── COMPRESS ──────────────────────────────────────────────────────────────────
function CompressTool() {
  const [quality,setQuality]=useState<Quality>("medium");
  const t=useJobTool(`${API}/api/compress`,"video/mp4","mp4");
  const busy=t.stage==="uploading"||t.stage==="processing";
  return(
    <div className="space-y-5">
      {!t.info&&<DropZone onFile={t.onFile}/>}
      {t.info&&!busy&&t.stage!=="done"&&<>
        <FileRow info={t.info} onClear={t.clear} busy={false}/>
        <video src={t.info.url} controls playsInline className="w-full rounded-xl max-h-52 bg-black object-contain"/>
        <div>
          <SectionLabel>Compression Level</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(Q) as Quality[]).map(q=>(
              <button key={q} onClick={()=>setQuality(q)}
                className={`rounded-xl p-3.5 border text-left transition-all ${quality===q?"border-purple-500/40 bg-purple-500/8":"border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-2)]"}`}>
                <p className={`text-[13px] font-bold ${quality===q?"text-purple-500":"text-[var(--text-2)]"}`}>{Q[q].label}</p>
                <p className={`text-[11px] mt-0.5 ${quality===q?"text-purple-400/60":"text-[var(--text-4)]"}`}>{Q[q].tag}</p>
              </button>
            ))}
          </div>
        </div>
        <button onClick={()=>{if(t.info){const fd=new FormData();fd.append("video",t.info.file);fd.append("quality",quality);t.run(fd,t.info);}} } className="btn-primary py-3.5">Compress Video</button>
      </>}
      {busy&&<BusyControls stage={t.stage} progress={t.progress} onCancel={()=>{t.cancel();}}/>}
      {t.stage==="done"&&t.result&&t.info&&<ResultPanel result={t.result} onRedo={t.clear} filename={`${t.info.name.replace(/\.[^.]+$/,"")}_compressed.mp4`}/>}
      {t.error&&<ErrorMsg msg={t.error} onDismiss={()=>t.setError("")}/>}
    </div>
  );
}

// ── SPLIT ─────────────────────────────────────────────────────────────────────
function SplitTool() {
  const [info,setInfo]=useState<VInfo|null>(null);
  const [startT,setStartT]=useState(0); const [endT,setEndT]=useState(0);
  const [startStr,setStartStr]=useState("0:00"); const [endStr,setEndStr]=useState("0:30");
  const [curT,setCurT]=useState(0);
  const [stage,setStage]=useState<Stage>("idle"); const [progress,setProgress]=useState(0);
  const [result,setResult]=useState<Result|null>(null); const [error,setError]=useState("");
  const xhrRef=useRef<XMLHttpRequest|null>(null); const vidRef=useRef<HTMLVideoElement>(null);

  const onFile=(f:File)=>{
    const url=URL.createObjectURL(f); const v=document.createElement("video"); v.src=url;
    v.onloadedmetadata=()=>{const dur=v.duration;setInfo({file:f,url,size:f.size,name:f.name,duration:dur});const de=Math.min(dur,30);setStartT(0);setEndT(de);setStartStr("0:00");setEndStr(toDisplay(de));setStage("ready");setResult(null);setError("");};
  };
  const clear=()=>{xhrRef.current?.abort();setInfo(null);setStage("idle");setResult(null);setError("");};
  const ms=(v:number)=>{setStartT(v);setStartStr(toDisplay(v));};
  const me=(v:number)=>{setEndT(v);setEndStr(toDisplay(v));};
  const as=(s:string)=>{const v=parseTime(s);if(v!==null&&info){const c=Math.min(Math.max(0,v),endT-0.1);setStartT(c);setStartStr(toDisplay(c));}};
  const ae=(s:string)=>{const v=parseTime(s);if(v!==null&&info){const c=Math.min(Math.max(startT+0.1,v),info.duration);setEndT(c);setEndStr(toDisplay(c));}};
  const setFrom=(w:"start"|"end")=>{if(!info)return;const t=vidRef.current?.currentTime??0;if(w==="start"){const v=Math.min(t,endT-0.1);setStartT(v);setStartStr(toDisplay(v));}else{const c=Math.min(Math.max(t,startT+0.1),info.duration);setEndT(c);setEndStr(toDisplay(c));}};
  const busy=stage==="uploading"||stage==="processing";

  const run=()=>{
    if(!info||startT>=endT){setError("Start time must be before end time.");return;}
    setStage("uploading");setProgress(0);setError("");
    const fd=new FormData();fd.append("video",info.file);fd.append("startTime",String(startT));fd.append("endTime",String(endT));
    xhrPost(`${API}/api/split`,fd,p=>{setProgress(p);if(p===100)setStage("processing");},(ok,buf,xhr)=>{
      if(ok){const blob=new Blob([buf],{type:"video/mp4"});setResult({url:URL.createObjectURL(blob),size:Number(xhr.getResponseHeader("X-Compressed-Size"))||blob.size,originalSize:Number(xhr.getResponseHeader("X-Original-Size"))||info.size,ext:"mp4",mimeType:"video/mp4"});setStage("done");}
      else{let msg="Something went wrong.";try{const j=JSON.parse(new TextDecoder().decode(buf));if(j.error)msg=j.error;}catch{}setError(msg);setStage("ready");}
    },xhrRef);
  };

  return(
    <div className="space-y-5">
      {!info&&<DropZone onFile={onFile}/>}
      {info&&!busy&&stage!=="done"&&<>
        <FileRow info={info} onClear={clear} busy={false}/>
        <div className="space-y-2">
          <video ref={vidRef} src={info.url} controls playsInline onTimeUpdate={()=>setCurT(vidRef.current?.currentTime??0)} className="w-full rounded-xl max-h-52 bg-black object-contain"/>
          <div className="flex items-center justify-between">
            <span className="text-xs text-[var(--text-4)] tabular-nums">Current: <span className="text-purple-500 font-semibold">{toDisplay(curT)}</span></span>
            <div className="flex gap-2">
              <button onClick={()=>setFrom("start")} className="tag-btn">↳ Set Start</button>
              <button onClick={()=>setFrom("end")} className="tag-btn">↳ Set End</button>
            </div>
          </div>
        </div>
        <div className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between"><SectionLabel>Start Time</SectionLabel><input type="text" value={startStr} onChange={e=>setStartStr(e.target.value)} onBlur={e=>as(e.target.value)} onKeyDown={e=>e.key==="Enter"&&as((e.target as HTMLInputElement).value)} className="time-input" placeholder="0:00"/></div>
            <input type="range" min={0} max={Math.max(0,info.duration-0.1)} step={0.1} value={startT} onChange={e=>ms(Number(e.target.value))} className="w-full"/>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><SectionLabel>End Time</SectionLabel><input type="text" value={endStr} onChange={e=>setEndStr(e.target.value)} onBlur={e=>ae(e.target.value)} onKeyDown={e=>e.key==="Enter"&&ae((e.target as HTMLInputElement).value)} className="time-input" placeholder="0:30"/></div>
            <input type="range" min={0.1} max={info.duration} step={0.1} value={endT} onChange={e=>me(Number(e.target.value))} className="w-full"/>
          </div>
          <div className="relative h-8 rounded-lg overflow-hidden bg-[var(--surface)] border border-[var(--border)]">
            <div className="absolute inset-y-0 bg-purple-500/20 border-x-2 border-purple-500/40 transition-all duration-100" style={{left:`${(startT/info.duration)*100}%`,right:`${(1-endT/info.duration)*100}%`}}/>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[11px] font-semibold text-purple-500/80">{toDisplay(Math.max(0,endT-startT))} clip</span>
            </div>
          </div>
        </div>
        <button onClick={run} className="btn-primary py-3.5">Extract Clip</button>
      </>}
      {busy&&<BusyControls stage={stage} progress={progress} onCancel={()=>{xhrRef.current?.abort();setStage("ready");}}/>}
      {stage==="done"&&result&&info&&<ResultPanel result={result} onRedo={()=>{setResult(null);setStage("ready");}} filename={`${info.name.replace(/\.[^.]+$/,"")}_clip.mp4`}/>}
      {error&&<ErrorMsg msg={error} onDismiss={()=>setError("")}/>}
    </div>
  );
}

// ── ROTATE ────────────────────────────────────────────────────────────────────
function RotateTool() {
  const [direction,setDirection]=useState<"cw90"|"ccw90"|"180">("cw90");
  const t=useJobTool(`${API}/api/rotate-video`,"video/mp4","mp4");
  const busy=t.stage==="uploading"||t.stage==="processing";

  const DIRS: {id:"cw90"|"ccw90"|"180"; label:string; icon:string}[] = [
    { id:"cw90",  label:"90° Clockwise",     icon:"M23 4v6h-6 M20.49 15a9 9 0 1 1-2.12-9.36L23 10" },
    { id:"ccw90", label:"90° Counter-CW",    icon:"M1 4v6h6 M3.51 15a9 9 0 1 0 2.13-9.36L1 10" },
    { id:"180",   label:"Flip 180°",         icon:"M12 2v20M2 12h20" },
  ];

  return(
    <div className="space-y-5">
      {!t.info&&<DropZone onFile={t.onFile}/>}
      {t.info&&!busy&&t.stage!=="done"&&<>
        <FileRow info={t.info} onClear={t.clear} busy={false}/>
        <video src={t.info.url} controls playsInline className="w-full rounded-xl max-h-52 bg-black object-contain"/>
        <div>
          <SectionLabel>Rotation</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {DIRS.map(d=>(
              <button key={d.id} onClick={()=>setDirection(d.id)}
                className={`rounded-xl p-3 border text-center transition-all flex flex-col items-center gap-1.5 ${direction===d.id?"border-teal-500/40 bg-teal-500/8":"border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-2)]"}`}>
                <svg className={`w-5 h-5 ${direction===d.id?"text-teal-500":"text-[var(--text-3)]"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d={d.icon}/>
                </svg>
                <p className={`text-[11px] font-semibold leading-tight ${direction===d.id?"text-teal-500":"text-[var(--text-3)]"}`}>{d.label}</p>
              </button>
            ))}
          </div>
        </div>
        <button onClick={()=>{if(t.info){const fd=new FormData();fd.append("video",t.info.file);fd.append("direction",direction);t.run(fd,t.info);}}} className="btn-primary py-3.5" style={{background:"linear-gradient(135deg,#0d9488,#0891b2)"}}>Rotate Video</button>
      </>}
      {busy&&<BusyControls stage={t.stage} progress={t.progress} onCancel={t.cancel}/>}
      {t.stage==="done"&&t.result&&t.info&&<ResultPanel result={t.result} onRedo={t.clear} filename={`${t.info.name.replace(/\.[^.]+$/,"")}_rotated.mp4`}/>}
      {t.error&&<ErrorMsg msg={t.error} onDismiss={()=>t.setError("")}/>}
    </div>
  );
}

// ── WATERMARK ─────────────────────────────────────────────────────────────────
const WM_POSITIONS = [
  { id:"top-left",     label:"Top Left"     },
  { id:"top-right",    label:"Top Right"    },
  { id:"center",       label:"Center"       },
  { id:"bottom-left",  label:"Bottom Left"  },
  { id:"bottom-right", label:"Bottom Right" },
];
const WM_SIZES = [
  { id:"small",  label:"Small"  },
  { id:"medium", label:"Medium" },
  { id:"large",  label:"Large"  },
];

function WatermarkTool() {
  const [wmText,setWmText]=useState("© My Video");
  const [position,setPosition]=useState("bottom-right");
  const [size,setSize]=useState("medium");
  const [opacity,setOpacity]=useState(0.7);
  const t=useJobTool(`${API}/api/watermark-video`,"video/mp4","mp4");
  const busy=t.stage==="uploading"||t.stage==="processing";

  return(
    <div className="space-y-5">
      {!t.info&&<DropZone onFile={t.onFile}/>}
      {t.info&&!busy&&t.stage!=="done"&&<>
        <FileRow info={t.info} onClear={t.clear} busy={false}/>
        <video src={t.info.url} controls playsInline className="w-full rounded-xl max-h-52 bg-black object-contain"/>

        {/* Watermark text */}
        <div>
          <SectionLabel>Watermark Text</SectionLabel>
          <input type="text" value={wmText} onChange={e=>setWmText(e.target.value)} maxLength={60}
            placeholder="Enter your watermark text…"
            className="w-full px-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] text-sm font-medium outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/10 transition-all placeholder:text-[var(--text-4)]"/>
        </div>

        {/* Position */}
        <div>
          <SectionLabel>Position</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {WM_POSITIONS.map(p=>(
              <button key={p.id} onClick={()=>setPosition(p.id)}
                className={`rounded-xl px-3 py-2.5 border text-xs font-semibold transition-all ${position===p.id?"border-emerald-500/40 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400":"border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:border-[var(--border-2)]"}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Size */}
        <div>
          <SectionLabel>Text Size</SectionLabel>
          <div className="grid grid-cols-3 gap-2">
            {WM_SIZES.map(s=>(
              <button key={s.id} onClick={()=>setSize(s.id)}
                className={`rounded-xl px-3 py-2.5 border text-xs font-semibold transition-all ${size===s.id?"border-emerald-500/40 bg-emerald-500/8 text-emerald-600 dark:text-emerald-400":"border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:border-[var(--border-2)]"}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Opacity */}
        <div>
          <div className="flex justify-between items-center mb-2">
            <SectionLabel>Opacity</SectionLabel>
            <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">{Math.round(opacity*100)}%</span>
          </div>
          <input type="range" min={0.2} max={1} step={0.05} value={opacity} onChange={e=>setOpacity(Number(e.target.value))} className="w-full"/>
        </div>

        <button onClick={()=>{if(t.info){const fd=new FormData();fd.append("video",t.info.file);fd.append("text",wmText||"VideoTools");fd.append("position",position);fd.append("size",size);fd.append("opacity",String(opacity));t.run(fd,t.info);}}} className="btn-primary py-3.5" style={{background:"linear-gradient(135deg,#059669,#0d9488)"}}>Add Watermark</button>
      </>}
      {busy&&<BusyControls stage={t.stage} progress={t.progress} onCancel={t.cancel}/>}
      {t.stage==="done"&&t.result&&t.info&&<ResultPanel result={t.result} onRedo={t.clear} filename={`${t.info.name.replace(/\.[^.]+$/,"")}_watermarked.mp4`}/>}
      {t.error&&<ErrorMsg msg={t.error} onDismiss={()=>t.setError("")}/>}
    </div>
  );
}

// ── Simple tools (audio, mute) ────────────────────────────────────────────────
function SimpleToolUI({endpoint,mime,ext,buttonLabel,outSuffix}:{endpoint:string;mime:string;ext:string;buttonLabel:string;outSuffix:string}) {
  const t=useTool(endpoint,mime,ext); const busy=t.stage==="uploading"||t.stage==="processing";
  return(
    <div className="space-y-5">
      {!t.info&&<DropZone onFile={t.onFile}/>}
      {t.info&&!busy&&t.stage!=="done"&&<>
        <FileRow info={t.info} onClear={t.clear} busy={false}/>
        <video src={t.info.url} controls playsInline className="w-full rounded-xl max-h-52 bg-black object-contain"/>
        <button onClick={()=>t.run()} className="btn-primary py-3.5">{buttonLabel}</button>
      </>}
      {busy&&<BusyControls stage={t.stage} progress={t.progress} onCancel={t.cancel}/>}
      {t.stage==="done"&&t.result&&t.info&&<ResultPanel result={t.result} onRedo={t.clear} filename={`${t.info.name.replace(/\.[^.]+$/,"")}_${outSuffix}.${ext}`}/>}
      {t.error&&<ErrorMsg msg={t.error} onDismiss={()=>t.setError("")}/>}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
function AppInner() {
  const [active,setActive]=useState<Tab|null>(null);

  if(active){
    const tool=TOOLS.find(t=>t.id===active)!;
    return(
      <div className="min-h-screen" style={{background:"var(--bg)"}}>
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-60 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[130px]" style={{background:"var(--glow-1)"}}/>
        </div>
        <header className="sticky top-0 z-50 border-b border-[var(--border)] backdrop-blur-md" style={{background:"color-mix(in srgb,var(--bg) 90%,transparent)"}}>
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button onClick={()=>setActive(null)} className="flex items-center gap-2 text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
                <span className="text-sm font-medium hidden sm:block">All Tools</span>
              </button>
              <div className="w-px h-4 bg-[var(--border-2)]"/>
              <div className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${tool.color} flex items-center justify-center`}>{tool.icon}</div>
                <span className="text-sm font-semibold text-[var(--text)]">{tool.title}</span>
              </div>
            </div>
            <ThemeToggle/>
          </div>
        </header>
        <main className="max-w-xl mx-auto px-4 sm:px-6 py-8">
          {active==="compress"  &&<CompressTool/>}
          {active==="split"     &&<SplitTool/>}
          {active==="audio"     &&<SimpleToolUI endpoint={`${API}/api/extract-audio`} mime="audio/mpeg" ext="mp3" buttonLabel="Extract Audio" outSuffix="audio"/>}
          {active==="mute"      &&<SimpleToolUI endpoint={`${API}/api/mute-video`}    mime="video/mp4"  ext="mp4" buttonLabel="Remove Audio"  outSuffix="muted"/>}
          {active==="rotate"    &&<RotateTool/>}
          {active==="watermark" &&<WatermarkTool/>}
        </main>
      </div>
    );
  }

  return(
    <div className="min-h-screen flex flex-col" style={{background:"var(--bg)"}}>
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] rounded-full blur-[130px]" style={{background:"var(--glow-1)"}}/>
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px] rounded-full blur-[100px]" style={{background:"var(--glow-2)"}}/>
      </div>
      <header className="relative z-10 border-b border-[var(--border)]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:"linear-gradient(135deg,#7c3aed,#db2777)"}}>
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
            </div>
            <span className="font-bold text-[15px] text-[var(--text)] tracking-tight">VideoTools</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--text-4)] font-medium hidden sm:block">Free · Fast · No account needed</span>
            <ThemeToggle/>
          </div>
        </div>
      </header>

      <section className="relative z-10 pt-14 pb-10 text-center px-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-500/20 bg-purple-500/6 text-purple-500 text-xs font-medium mb-5">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"/>
          6 Free Video Tools
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.1] mb-4" style={{color:"var(--text)"}}>
          Video tools that<br/>
          <span style={{background:"linear-gradient(90deg,#7c3aed,#db2777)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>actually work</span>
        </h1>
        <p className="text-[var(--text-3)] text-base sm:text-lg max-w-md mx-auto leading-relaxed">
          Compress, trim, rotate, watermark — all processed instantly.<br className="hidden sm:block"/> No sign-up, no limits.
        </p>
      </section>

      <section className="relative z-10 flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {TOOLS.map(tool=>(
            <button key={tool.id} onClick={()=>setActive(tool.id)}
              className="group text-left p-5 rounded-2xl border border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-2)] hover:border-[var(--border-2)] transition-all duration-200 cursor-pointer">
              <div className="flex items-start gap-4">
                <div className={`w-10 h-10 rounded-xl flex-shrink-0 flex items-center justify-center bg-gradient-to-br ${tool.color} shadow-md`}>{tool.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-bold text-[14px] text-[var(--text)] group-hover:text-purple-500 transition-colors">{tool.title}</h2>
                    <svg className="w-3.5 h-3.5 text-[var(--text-4)] group-hover:text-purple-400 group-hover:translate-x-0.5 transition-all flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </div>
                  <p className="text-[12px] text-[var(--text-3)] mt-0.5 leading-relaxed">{tool.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-x-8 gap-y-2.5">
          {[{icon:"⚡",text:"Server-side processing"},{icon:"🔒",text:"Files deleted after download"},{icon:"∞",text:"No file size limits"}].map(({icon,text})=>(
            <div key={text} className="flex items-center gap-2 text-[var(--text-4)] text-xs font-medium">
              <span>{icon}</span><span>{text}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-[var(--border)] py-5">
        <p className="text-center text-xs text-[var(--text-4)]">© 2025 VideoTools · Free to use</p>
      </footer>
    </div>
  );
}

export default function App() {
  return <ThemeProvider><AppInner/></ThemeProvider>;
}
