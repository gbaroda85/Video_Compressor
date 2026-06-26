import { useState, useRef } from "react";

// ── utils ─────────────────────────────────────────────────────────────────────
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

type Quality="high"|"medium"|"low";
type Tab="compress"|"split"|"audio"|"mute";
type Stage="idle"|"ready"|"uploading"|"processing"|"done";

const Q:Record<Quality,{label:string;tag:string}>={
  high:  {label:"High",   tag:"~60% smaller"},
  medium:{label:"Balanced",tag:"~80% smaller"},
  low:   {label:"Max",    tag:"~92% smaller"},
};

interface VInfo{file:File;url:string;size:number;name:string;duration:number}
interface Result{url:string;size:number;originalSize:number;ext:string;mimeType:string}

const TOOLS:{id:Tab;icon:JSX.Element;title:string;desc:string;color:string}[]=[
  {
    id:"compress",
    color:"from-violet-600 to-purple-700",
    title:"Compress",
    desc:"Shrink video size without visible quality loss",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M17 10l-5 5-5-5"/><line x1="12" y1="3" x2="12" y2="15"/></svg>,
  },
  {
    id:"split",
    color:"from-blue-600 to-indigo-700",
    title:"Trim / Split",
    desc:"Cut any segment from your video precisely",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>,
  },
  {
    id:"audio",
    color:"from-pink-600 to-rose-700",
    title:"Extract Audio",
    desc:"Convert video to high-quality MP3",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>,
  },
  {
    id:"mute",
    color:"from-orange-600 to-amber-700",
    title:"Remove Audio",
    desc:"Strip the audio track from any video",
    icon:<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>,
  },
];

function xhrPost(url:string,data:FormData,onP:(p:number)=>void,onDone:(ok:boolean,buf:ArrayBuffer,xhr:XMLHttpRequest)=>void,ref:React.MutableRefObject<XMLHttpRequest|null>){
  const xhr=new XMLHttpRequest(); ref.current=xhr; xhr.responseType="arraybuffer";
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onP(Math.round(e.loaded/e.total*100));};
  xhr.onload=()=>onDone(xhr.status===200,xhr.response,xhr);
  xhr.onerror=()=>onDone(false,new ArrayBuffer(0),xhr);
  xhr.open("POST",url); xhr.send(data);
}

// ── shared UI ─────────────────────────────────────────────────────────────────
function DropZone({onFile}:{onFile:(f:File)=>void}){
  const ref=useRef<HTMLInputElement>(null);
  const [drag,setDrag]=useState(false);
  return(
    <div onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f?.type.startsWith("video/"))onFile(f);}}
      onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
      onClick={()=>ref.current?.click()}
      className={`group cursor-pointer rounded-2xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center gap-4 py-16 px-6
        ${drag?"border-purple-500 bg-purple-500/8":"border-white/8 hover:border-purple-500/40 hover:bg-white/[0.012]"}`}>
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all ${drag?"bg-purple-500/25 scale-110":"bg-white/4 group-hover:bg-purple-500/12"}`}>
        <svg className={`w-7 h-7 ${drag?"text-purple-300":"text-white/25 group-hover:text-purple-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
        </svg>
      </div>
      <div className="text-center">
        <p className="font-semibold text-white/75 text-[15px]">{drag?"Drop it here":"Drop your video here"}</p>
        <p className="text-white/30 text-sm mt-1.5">or <span className="text-purple-400/80 underline underline-offset-2">browse files</span> · MP4, MOV, AVI, MKV, WebM</p>
      </div>
      <input ref={ref} type="file" accept="video/*" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)onFile(f);}}/>
    </div>
  );
}

function FileRow({info,onClear,busy}:{info:VInfo;onClear:()=>void;busy:boolean}){
  return(
    <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.025] border border-white/5">
      <div className="w-9 h-9 rounded-lg bg-purple-500/15 flex-shrink-0 flex items-center justify-center">
        <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white/85 truncate">{info.name}</p>
        <p className="text-xs text-white/30 mt-0.5">{fmt(info.size)} · {toDisplay(info.duration)}</p>
      </div>
      {!busy&&<button onClick={onClear} className="text-white/20 hover:text-white/60 transition-colors p-1.5 rounded-lg hover:bg-white/6">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>}
    </div>
  );
}

function Spinner(){
  return(
    <div className="flex flex-col items-center gap-5 py-10">
      <div className="relative w-16 h-16">
        <svg className="w-16 h-16 -rotate-90 animate-[spin_2s_linear_infinite]" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="5"/>
          <circle cx="32" cy="32" r="26" fill="none" stroke="url(#sg)" strokeWidth="5" strokeLinecap="round"
            strokeDasharray="163.4" strokeDashoffset="122"/>
          <defs>
            <linearGradient id="sg" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#7c3aed"/><stop offset="100%" stopColor="#db2777"/>
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse"/>
        </div>
      </div>
      <p className="text-white/40 text-sm font-medium">Processing…</p>
    </div>
  );
}

function UploadProgress({progress}:{progress:number}){
  return(
    <div className="space-y-3 py-6">
      <div className="flex justify-between items-center">
        <span className="text-sm text-white/50 font-medium">Uploading</span>
        <span className="text-sm font-bold text-purple-300 tabular-nums">{progress}%</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-300" style={{background:"linear-gradient(90deg,#7c3aed,#db2777)",width:`${progress}%`}}/>
      </div>
    </div>
  );
}

function ResultPanel({result,onRedo,filename}:{result:Result;onRedo:()=>void;filename:string}){
  const saved=Math.max(0,Math.round((1-result.size/result.originalSize)*100));
  const dl=()=>{const a=document.createElement("a");a.href=result.url;a.download=filename;a.click();};
  return(
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[{l:"Original",v:fmt(result.originalSize),hi:false},{l:"Reduced",v:`${saved}%`,hi:true},{l:"New size",v:fmt(result.size),hi:false}].map(({l,v,hi})=>(
          <div key={l} className={`rounded-xl p-3 text-center ${hi?"bg-purple-500/10 border border-purple-500/15":"bg-white/[0.025] border border-white/5"}`}>
            <p className="text-[10px] text-white/25 uppercase tracking-widest font-semibold">{l}</p>
            <p className={`font-bold mt-1 ${hi?"text-purple-300 text-xl":"text-white/65 text-sm"}`}>{v}</p>
          </div>
        ))}
      </div>
      {result.mimeType.startsWith("video")&&<video src={result.url} controls playsInline className="w-full rounded-xl max-h-52 bg-black object-contain"/>}
      {result.mimeType.startsWith("audio")&&<div className="bg-white/[0.02] rounded-xl p-4 border border-white/5"><audio src={result.url} controls className="w-full"/></div>}
      <div className="flex gap-2.5">
        <button onClick={dl} className="btn-primary py-3.5 gap-2 flex-1">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          Download {result.ext.toUpperCase()}
        </button>
        <button onClick={onRedo} className="px-5 py-3.5 rounded-xl border border-white/8 text-sm font-semibold text-white/40 hover:text-white/70 hover:border-white/14 transition-all">Try again</button>
      </div>
    </div>
  );
}

function ErrorMsg({msg,onDismiss}:{msg:string;onDismiss:()=>void}){
  return(
    <div className="flex items-start gap-3 bg-red-500/6 border border-red-500/12 rounded-xl p-4">
      <svg className="w-4 h-4 text-red-400/80 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <p className="text-[13px] text-red-300/80 flex-1 leading-relaxed">{msg}</p>
      <button onClick={onDismiss} className="text-red-400/40 hover:text-red-300/70"><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>
  );
}

// ── reusable hook ─────────────────────────────────────────────────────────────
function useTool(endpoint:string,mime:string,ext:string){
  const [info,setInfo]=useState<VInfo|null>(null);
  const [stage,setStage]=useState<Stage>("idle");
  const [progress,setProgress]=useState(0);
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const xhrRef=useRef<XMLHttpRequest|null>(null);

  const onFile=(f:File)=>{
    const url=URL.createObjectURL(f);
    const v=document.createElement("video");v.src=url;
    v.onloadedmetadata=()=>setInfo({file:f,url,size:f.size,name:f.name,duration:v.duration});
    setStage("ready");setResult(null);setError("");
  };
  const clear=()=>{xhrRef.current?.abort();setInfo(null);setStage("idle");setResult(null);setError("");};
  const run=(extra?:Record<string,string>)=>{
    if(!info)return;
    setStage("uploading");setProgress(0);setError("");
    const fd=new FormData();fd.append("video",info.file);
    if(extra)Object.entries(extra).forEach(([k,v])=>fd.append(k,v));
    xhrPost(endpoint,fd,p=>{setProgress(p);if(p===100)setStage("processing");},(ok,buf,xhr)=>{
      if(ok){
        const blob=new Blob([buf],{type:mime});
        setResult({url:URL.createObjectURL(blob),size:Number(xhr.getResponseHeader("X-Compressed-Size"))||blob.size,originalSize:Number(xhr.getResponseHeader("X-Original-Size"))||info.size,ext,mimeType:mime});
        setStage("done");
      } else {
        let msg="Something went wrong. Please try again.";
        try{const j=JSON.parse(new TextDecoder().decode(buf));if(j.error)msg=j.error;}catch{}
        setError(msg);setStage("ready");
      }
    },xhrRef);
  };
  const cancel=()=>{xhrRef.current?.abort();setStage("ready");setProgress(0);};
  return{info,stage,progress,result,error,onFile,clear,run,cancel,setError};
}

// ── COMPRESS (job-based polling to avoid proxy timeouts) ─────────────────────
function CompressTool(){
  const [quality,setQuality]=useState<Quality>("medium");
  const [info,setInfo]=useState<VInfo|null>(null);
  const [stage,setStage]=useState<Stage>("idle");
  const [progress,setProgress]=useState(0);
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const xhrRef=useRef<XMLHttpRequest|null>(null);
  const pollRef=useRef<ReturnType<typeof setInterval>|null>(null);

  const stopPoll=()=>{if(pollRef.current){clearInterval(pollRef.current);pollRef.current=null;}};

  const onFile=(f:File)=>{
    const url=URL.createObjectURL(f);const v=document.createElement("video");v.src=url;
    v.onloadedmetadata=()=>setInfo({file:f,url,size:f.size,name:f.name,duration:v.duration});
    setStage("ready");setResult(null);setError("");
  };
  const clear=()=>{xhrRef.current?.abort();stopPoll();setInfo(null);setStage("idle");setResult(null);setError("");};

  const run=()=>{
    if(!info)return;
    setStage("uploading");setProgress(0);setError("");
    const fd=new FormData();fd.append("video",info.file);fd.append("quality",quality);
    const xhr=new XMLHttpRequest();xhrRef.current=xhr;
    xhr.upload.onprogress=e=>{if(e.lengthComputable)setProgress(Math.round(e.loaded/e.total*100));};
    xhr.responseType="json";
    xhr.onload=()=>{
      if(xhr.status===200&&xhr.response?.jobId){
        const jobId=xhr.response.jobId as string;
        setStage("processing");
        // Poll until done
        pollRef.current=setInterval(async()=>{
          try{
            const r=await fetch(`/api/job/${jobId}`);
            const data=await r.json() as{status:string;originalSize:number;outputSize:number;error?:string};
            if(data.status==="done"){
              stopPoll();
              // Download the result
              const dlXhr=new XMLHttpRequest();
              dlXhr.open("GET",`/api/job/${jobId}/download`);
              dlXhr.responseType="arraybuffer";
              dlXhr.onload=()=>{
                if(dlXhr.status===200){
                  const blob=new Blob([dlXhr.response],{type:"video/mp4"});
                  setResult({url:URL.createObjectURL(blob),size:Number(dlXhr.getResponseHeader("X-Compressed-Size"))||blob.size,originalSize:Number(dlXhr.getResponseHeader("X-Original-Size"))||info.size,ext:"mp4",mimeType:"video/mp4"});
                  setStage("done");
                } else {setError("Download failed. Please try again.");setStage("ready");}
              };
              dlXhr.onerror=()=>{setError("Download failed. Please try again.");setStage("ready");};
              dlXhr.send();
            } else if(data.status==="error"){
              stopPoll();setError(data.error||"Something went wrong.");setStage("ready");
            }
          }catch{/* keep polling */}
        },2000);
      } else {
        setError("Something went wrong. Please try again.");setStage("ready");
      }
    };
    xhr.onerror=()=>{setError("Something went wrong. Please try again.");setStage("ready");};
    xhr.open("POST","/api/compress");xhr.send(fd);
  };

  const busy=stage==="uploading"||stage==="processing";
  return(
    <div className="space-y-5">
      {!info&&<DropZone onFile={onFile}/>}
      {info&&!busy&&stage!=="done"&&<>
        <FileRow info={info} onClear={clear} busy={false}/>
        <video src={info.url} controls playsInline className="w-full rounded-xl max-h-52 bg-black object-contain"/>
        <div>
          <p className="text-xs font-semibold text-white/25 uppercase tracking-widest mb-3">Compression Level</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(Q) as Quality[]).map(q=>(
              <button key={q} onClick={()=>setQuality(q)}
                className={`rounded-xl p-3.5 border text-left transition-all ${quality===q?"border-purple-500/35 bg-purple-500/8":"border-white/5 bg-white/[0.018] hover:border-white/10"}`}>
                <p className={`text-[13px] font-bold ${quality===q?"text-purple-300":"text-white/50"}`}>{Q[q].label}</p>
                <p className={`text-[11px] mt-0.5 ${quality===q?"text-purple-400/50":"text-white/18"}`}>{Q[q].tag}</p>
              </button>
            ))}
          </div>
        </div>
        <button onClick={run} className="btn-primary py-3.5">Compress Video</button>
      </>}
      {busy&&<>
        {stage==="uploading"&&<UploadProgress progress={progress}/>}
        {stage==="processing"&&<Spinner/>}
        <button onClick={()=>{xhrRef.current?.abort();stopPoll();setStage("ready");}} className="w-full text-center text-xs text-white/20 hover:text-white/45 transition-colors underline">Cancel</button>
      </>}
      {stage==="done"&&result&&info&&<ResultPanel result={result} onRedo={clear} filename={`${info.name.replace(/\.[^.]+$/,"")}_compressed.mp4`}/>}
      {error&&<ErrorMsg msg={error} onDismiss={()=>setError("")}/>}
    </div>
  );
}

// ── SPLIT ─────────────────────────────────────────────────────────────────────
function SplitTool(){
  const [info,setInfo]=useState<VInfo|null>(null);
  const [startT,setStartT]=useState(0);const[endT,setEndT]=useState(0);
  const [startStr,setStartStr]=useState("0:00");const[endStr,setEndStr]=useState("0:30");
  const [curT,setCurT]=useState(0);
  const [stage,setStage]=useState<Stage>("idle");
  const [progress,setProgress]=useState(0);
  const [result,setResult]=useState<Result|null>(null);
  const [error,setError]=useState("");
  const xhrRef=useRef<XMLHttpRequest|null>(null);
  const vidRef=useRef<HTMLVideoElement>(null);

  const onFile=(f:File)=>{
    const url=URL.createObjectURL(f);const v=document.createElement("video");v.src=url;
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
    xhrPost("/api/split",fd,p=>{setProgress(p);if(p===100)setStage("processing");},(ok,buf,xhr)=>{
      if(ok){const blob=new Blob([buf],{type:"video/mp4"});setResult({url:URL.createObjectURL(blob),size:Number(xhr.getResponseHeader("X-Compressed-Size"))||blob.size,originalSize:Number(xhr.getResponseHeader("X-Original-Size"))||info.size,ext:"mp4",mimeType:"video/mp4"});setStage("done");}
      else{let msg="Something went wrong.";try{const j=JSON.parse(new TextDecoder().decode(buf));if(j.error)msg=j.error;}catch{}setError(msg);setStage("ready");}
    },xhrRef);
  };

  return(
    <div className="space-y-5">
      {!info&&<DropZone onFile={onFile}/>}
      {info&&!busy&&stage!=="done"&&<>
        <FileRow info={info} onClear={clear} busy={false}/>
        <div className="space-y-3">
          <video ref={vidRef} src={info.url} controls playsInline onTimeUpdate={()=>setCurT(vidRef.current?.currentTime??0)} className="w-full rounded-xl max-h-52 bg-black object-contain"/>
          <div className="flex items-center justify-between">
            <span className="text-xs text-white/25 tabular-nums">Current: <span className="text-purple-300/70 font-semibold">{toDisplay(curT)}</span></span>
            <div className="flex gap-2">
              <button onClick={()=>setFrom("start")} className="tag-btn">↳ Set Start</button>
              <button onClick={()=>setFrom("end")} className="tag-btn">↳ Set End</button>
            </div>
          </div>
        </div>
        <div className="space-y-5 pt-1">
          <div className="space-y-2">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-white/25 uppercase tracking-widest">Start Time</span><input type="text" value={startStr} onChange={e=>setStartStr(e.target.value)} onBlur={e=>as(e.target.value)} onKeyDown={e=>e.key==="Enter"&&as((e.target as HTMLInputElement).value)} className="time-input" placeholder="0:00"/></div>
            <input type="range" min={0} max={Math.max(0,info.duration-0.1)} step={0.1} value={startT} onChange={e=>ms(Number(e.target.value))} className="w-full"/>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-white/25 uppercase tracking-widest">End Time</span><input type="text" value={endStr} onChange={e=>setEndStr(e.target.value)} onBlur={e=>ae(e.target.value)} onKeyDown={e=>e.key==="Enter"&&ae((e.target as HTMLInputElement).value)} className="time-input" placeholder="0:30"/></div>
            <input type="range" min={0.1} max={info.duration} step={0.1} value={endT} onChange={e=>me(Number(e.target.value))} className="w-full"/>
          </div>
          <div className="relative h-8 rounded-lg overflow-hidden bg-white/[0.02] border border-white/5">
            <div className="absolute inset-y-0 bg-purple-500/20 border-x-2 border-purple-500/40 transition-all duration-100" style={{left:`${(startT/info.duration)*100}%`,right:`${(1-endT/info.duration)*100}%`}}/>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="text-[11px] font-semibold text-purple-300/70">{toDisplay(Math.max(0,endT-startT))} clip</span>
            </div>
          </div>
        </div>
        <button onClick={run} className="btn-primary py-3.5">Extract Clip</button>
      </>}
      {busy&&<>{stage==="uploading"&&<UploadProgress progress={progress}/>}{stage==="processing"&&<Spinner/>}<button onClick={()=>{xhrRef.current?.abort();setStage("ready");}} className="w-full text-center text-xs text-white/20 hover:text-white/45 transition-colors underline">Cancel</button></>}
      {stage==="done"&&result&&info&&<ResultPanel result={result} onRedo={()=>{setResult(null);setStage("ready");}} filename={`${info.name.replace(/\.[^.]+$/,"")}_clip.mp4`}/>}
      {error&&<ErrorMsg msg={error} onDismiss={()=>setError("")}/>}
    </div>
  );
}

// ── AUDIO EXTRACT ─────────────────────────────────────────────────────────────
function AudioTool(){
  const t=useTool("/api/extract-audio","audio/mpeg","mp3");
  const busy=t.stage==="uploading"||t.stage==="processing";
  return(
    <div className="space-y-5">
      {!t.info&&<DropZone onFile={t.onFile}/>}
      {t.info&&!busy&&t.stage!=="done"&&<>
        <FileRow info={t.info} onClear={t.clear} busy={false}/>
        <video src={t.info.url} controls playsInline className="w-full rounded-xl max-h-52 bg-black object-contain"/>
        <button onClick={()=>t.run()} className="btn-primary py-3.5">Extract Audio</button>
      </>}
      {busy&&<>{t.stage==="uploading"&&<UploadProgress progress={t.progress}/>}{t.stage==="processing"&&<Spinner/>}<button onClick={t.cancel} className="w-full text-center text-xs text-white/20 hover:text-white/45 transition-colors underline">Cancel</button></>}
      {t.stage==="done"&&t.result&&t.info&&<ResultPanel result={t.result} onRedo={t.clear} filename={`${t.info.name.replace(/\.[^.]+$/,"")}_audio.mp3`}/>}
      {t.error&&<ErrorMsg msg={t.error} onDismiss={()=>t.setError("")}/>}
    </div>
  );
}

// ── MUTE VIDEO ────────────────────────────────────────────────────────────────
function MuteTool(){
  const t=useTool("/api/mute-video","video/mp4","mp4");
  const busy=t.stage==="uploading"||t.stage==="processing";
  return(
    <div className="space-y-5">
      {!t.info&&<DropZone onFile={t.onFile}/>}
      {t.info&&!busy&&t.stage!=="done"&&<>
        <FileRow info={t.info} onClear={t.clear} busy={false}/>
        <video src={t.info.url} controls playsInline className="w-full rounded-xl max-h-52 bg-black object-contain"/>
        <button onClick={()=>t.run()} className="btn-primary py-3.5">Remove Audio</button>
      </>}
      {busy&&<>{t.stage==="uploading"&&<UploadProgress progress={t.progress}/>}{t.stage==="processing"&&<Spinner/>}<button onClick={t.cancel} className="w-full text-center text-xs text-white/20 hover:text-white/45 transition-colors underline">Cancel</button></>}
      {t.stage==="done"&&t.result&&t.info&&<ResultPanel result={t.result} onRedo={t.clear} filename={`${t.info.name.replace(/\.[^.]+$/,"")}_muted.mp4`}/>}
      {t.error&&<ErrorMsg msg={t.error} onDismiss={()=>t.setError("")}/>}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [active,setActive]=useState<Tab|null>(null);

  if(active){
    const tool=TOOLS.find(t=>t.id===active)!;
    return(
      <div className="min-h-screen bg-[#07070f]">
        {/* Subtle bg glow */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-60 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full blur-[130px]" style={{background:"radial-gradient(ellipse,rgba(124,58,237,0.07) 0%,transparent 70%)"}}/>
        </div>

        {/* Top nav */}
        <header className="sticky top-0 z-50 border-b border-white/[0.05] bg-[#07070f]/90 backdrop-blur-md">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-4">
            <button onClick={()=>setActive(null)} className="flex items-center gap-2 text-white/40 hover:text-white/70 transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              <span className="text-sm font-medium">All Tools</span>
            </button>
            <div className="w-px h-4 bg-white/10"/>
            <div className="flex items-center gap-2">
              <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${tool.color} flex items-center justify-center`}>{tool.icon}</div>
              <span className="text-sm font-semibold text-white/80">{tool.title}</span>
            </div>
          </div>
        </header>

        {/* Tool content */}
        <main className="max-w-xl mx-auto px-4 sm:px-6 py-8">
          {active==="compress"&&<CompressTool/>}
          {active==="split"   &&<SplitTool/>}
          {active==="audio"   &&<AudioTool/>}
          {active==="mute"    &&<MuteTool/>}
        </main>
      </div>
    );
  }

  return(
    <div className="min-h-screen bg-[#07070f] flex flex-col">
      {/* Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px]" style={{background:"radial-gradient(ellipse at 50% 0%,rgba(124,58,237,0.09) 0%,transparent 65%)"}}/>
        <div className="absolute bottom-0 right-0 w-[400px] h-[400px]" style={{background:"radial-gradient(ellipse at 100% 100%,rgba(219,39,119,0.05) 0%,transparent 65%)"}}/>
      </div>

      {/* Nav */}
      <header className="relative z-10 border-b border-white/[0.04]">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{background:"linear-gradient(135deg,#7c3aed,#db2777)"}}>
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
            </div>
            <span className="font-bold text-[15px] text-white/90 tracking-tight">VideoTools</span>
          </div>
          <span className="text-xs text-white/20 font-medium hidden sm:block">Free · Fast · No account needed</span>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 pt-16 pb-14 text-center px-4">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-purple-500/20 bg-purple-500/6 text-purple-300/70 text-xs font-medium mb-6">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse"/>
          Powered by FFmpeg
        </div>
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-white leading-[1.1] mb-4">
          Video tools that<br/>
          <span style={{background:"linear-gradient(90deg,#a78bfa,#f472b6)",WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>actually work</span>
        </h1>
        <p className="text-white/35 text-base sm:text-lg max-w-md mx-auto leading-relaxed">
          Compress, trim, extract audio — all processed instantly. No sign-up, no limits.
        </p>
      </section>

      {/* Tool cards */}
      <section className="relative z-10 flex-1 max-w-5xl mx-auto w-full px-4 sm:px-6 pb-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {TOOLS.map(tool=>(
            <button key={tool.id} onClick={()=>setActive(tool.id)}
              className="group text-left p-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/10 transition-all duration-200 cursor-pointer">
              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-xl flex-shrink-0 flex items-center justify-center bg-gradient-to-br ${tool.color} shadow-lg`} style={{boxShadow:"0 4px 20px rgba(0,0,0,0.3)"}}>
                  {tool.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-bold text-[15px] text-white/85 group-hover:text-white transition-colors">{tool.title}</h2>
                    <svg className="w-4 h-4 text-white/15 group-hover:text-white/40 group-hover:translate-x-0.5 transition-all flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
                  </div>
                  <p className="text-[13px] text-white/35 mt-1 leading-relaxed">{tool.desc}</p>
                </div>
              </div>
            </button>
          ))}
        </div>

        {/* Bottom feature strip */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
          {[
            {icon:"⚡","text":"FFmpeg processing"},
            {icon:"🔒","text":"Files deleted after download"},
            {icon:"∞", "text":"No file size limits"},
          ].map(({icon,text})=>(
            <div key={text} className="flex items-center gap-2 text-white/20 text-xs font-medium">
              <span>{icon}</span><span>{text}</span>
            </div>
          ))}
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/[0.04] py-5">
        <p className="text-center text-xs text-white/15">© 2025 VideoTools · Free to use</p>
      </footer>
    </div>
  );
}
