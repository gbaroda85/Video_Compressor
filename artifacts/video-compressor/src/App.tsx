import { useState, useRef } from "react";

// ── utils ─────────────────────────────────────────────────────────────────────
function fmt(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / 1024 ** i).toFixed(2)} ${u[i]}`;
}
function toDisplay(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}
function parseTime(str: string): number | null {
  str = str.trim();
  if (!str) return null;
  if (/^\d+(\.\d+)?$/.test(str)) return parseFloat(str);
  const parts = str.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

type Quality = "high" | "medium" | "low";
type Tab = "compress" | "split" | "audio" | "mute";
type Stage = "idle" | "ready" | "uploading" | "processing" | "done" | "error";

const Q: Record<Quality, { label: string; tag: string }> = {
  high:   { label: "High",    tag: "~60% smaller" },
  medium: { label: "Balanced", tag: "~80% smaller" },
  low:    { label: "Max",     tag: "~92% smaller" },
};

interface VInfo { file: File; url: string; size: number; name: string; duration: number }
interface Result { url: string; size: number; originalSize: number; ext: string; mimeType: string }

function xhrPost(
  url: string, data: FormData,
  onProgress: (p: number) => void,
  onDone: (ok: boolean, buf: ArrayBuffer, xhr: XMLHttpRequest) => void,
  ref: React.MutableRefObject<XMLHttpRequest | null>,
) {
  const xhr = new XMLHttpRequest();
  ref.current = xhr;
  xhr.responseType = "arraybuffer";
  xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
  xhr.onload  = () => onDone(xhr.status === 200, xhr.response, xhr);
  xhr.onerror = () => onDone(false, new ArrayBuffer(0), xhr);
  xhr.open("POST", url);
  xhr.send(data);
}

// ── shared components ─────────────────────────────────────────────────────────
function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("video/")) onFile(f); }}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onClick={() => ref.current?.click()}
      className={`group cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center gap-4 py-14 px-6
        ${drag ? "border-purple-500 bg-purple-500/10" : "border-white/10 hover:border-purple-400/40 hover:bg-white/[0.015]"}`}
    >
      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center transition-all
        ${drag ? "bg-purple-500/30 scale-110" : "bg-white/5 group-hover:bg-purple-500/15"}`}>
        <svg className={`w-9 h-9 transition-colors ${drag ? "text-purple-300" : "text-white/30 group-hover:text-purple-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
        </svg>
      </div>
      <div className="text-center">
        <p className="text-white/80 font-semibold">{drag ? "Drop here!" : "Choose a video file"}</p>
        <p className="text-white/30 text-sm mt-1">MP4, MOV, AVI, MKV, WebM supported</p>
      </div>
      <input ref={ref} type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </div>
  );
}

function FileCard({ info, onClear, busy, showPreview = true }: { info: VInfo; onClear: () => void; busy: boolean; showPreview?: boolean }) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-2xl bg-purple-500/15 flex-shrink-0 flex items-center justify-center">
          <svg className="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white/90 truncate">{info.name}</p>
          <p className="text-xs text-white/35 mt-0.5">{fmt(info.size)} · {toDisplay(info.duration)}</p>
        </div>
        {!busy && (
          <button onClick={onClear} className="w-7 h-7 rounded-xl flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/8 transition-all">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        )}
      </div>
      {showPreview && <video src={info.url} controls playsInline className="w-full rounded-2xl max-h-48 bg-black object-contain"/>}
    </div>
  );
}

function ProcessingCard({ progress, stage }: { progress: number; stage: Stage }) {
  const done = stage === "processing";
  return (
    <div className="card p-6 flex flex-col items-center gap-5">
      {/* Animated ring */}
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth="6"/>
          <circle cx="40" cy="40" r="34" fill="none" stroke="url(#pg)" strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 34}`}
            strokeDashoffset={`${2 * Math.PI * 34 * (1 - (done ? 0.95 : progress / 100))}`}
            className="transition-all duration-500"/>
          <defs>
            <linearGradient id="pg" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#9333ea"/>
              <stop offset="100%" stopColor="#ec4899"/>
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {done
            ? <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/>
            : <span className="text-sm font-bold text-white/80 tabular-nums">{progress}%</span>}
        </div>
      </div>
      <div className="text-center">
        <p className="text-white/80 font-semibold text-sm">
          {done ? "Processing…" : "Transferring…"}
        </p>
        {!done && (
          <p className="text-white/30 text-xs mt-1">{progress}% complete</p>
        )}
      </div>
    </div>
  );
}

function ResultCard({ result, onRedo, filename }: { result: Result; onRedo: () => void; filename: string }) {
  const saved = Math.max(0, Math.round((1 - result.size / result.originalSize) * 100));
  const download = () => {
    const a = document.createElement("a"); a.href = result.url; a.download = filename; a.click();
  };
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <span className="text-emerald-400 font-semibold">Complete</span>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { l: "Original", v: fmt(result.originalSize), hi: false },
          { l: "Reduced",  v: `${saved}%`,              hi: true  },
          { l: "Output",   v: fmt(result.size),          hi: false },
        ].map(({ l, v, hi }) => (
          <div key={l} className={`rounded-2xl p-3 ${hi ? "bg-purple-500/10 border border-purple-500/15" : "bg-white/[0.025]"}`}>
            <p className="text-[10px] text-white/25 uppercase tracking-wider font-medium">{l}</p>
            <p className={`font-bold mt-1 ${hi ? "text-purple-300 text-lg" : "text-white/70 text-sm"}`}>{v}</p>
          </div>
        ))}
      </div>

      {result.mimeType.startsWith("video") && (
        <video src={result.url} controls playsInline className="w-full rounded-2xl max-h-48 bg-black object-contain"/>
      )}
      {result.mimeType.startsWith("audio") && (
        <div className="bg-white/[0.025] rounded-2xl p-4">
          <audio src={result.url} controls className="w-full"/>
        </div>
      )}

      <div className="flex gap-2.5">
        <button onClick={download} className="flex-1 btn-primary py-3.5 text-sm font-semibold flex items-center justify-center gap-2">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          Download {result.ext.toUpperCase()}
        </button>
        <button onClick={onRedo} className="px-5 py-3.5 rounded-2xl border border-white/8 text-sm font-medium text-white/40 hover:text-white/70 hover:border-white/15 transition-all">
          Redo
        </button>
      </div>
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div className="flex items-start gap-3 bg-red-500/8 border border-red-500/15 rounded-2xl p-4">
      <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
      <p className="text-sm text-red-300/90 flex-1">{msg}</p>
      <button onClick={onDismiss} className="text-red-400/50 hover:text-red-300 transition-colors">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>
  );
}

// ── generic single-upload tool ────────────────────────────────────────────────
function useToolState(endpoint: string, resultMime: string, resultExt: string) {
  const [info, setInfo]     = useState<VInfo | null>(null);
  const [stage, setStage]   = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError]   = useState("");
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const onFile = (f: File) => {
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.src = url;
    v.onloadedmetadata = () => setInfo({ file: f, url, size: f.size, name: f.name, duration: v.duration });
    setStage("ready"); setResult(null); setError("");
  };

  const clear = () => { xhrRef.current?.abort(); setInfo(null); setStage("idle"); setResult(null); setError(""); };

  const run = (extraFields?: Record<string, string>) => {
    if (!info) return;
    setStage("uploading"); setProgress(0); setError("");
    const fd = new FormData();
    fd.append("video", info.file);
    if (extraFields) Object.entries(extraFields).forEach(([k, v]) => fd.append(k, v));
    xhrPost(endpoint, fd,
      p => { setProgress(p); if (p === 100) setStage("processing"); },
      (ok, buf, xhr) => {
        if (ok) {
          const blob = new Blob([buf], { type: resultMime });
          setResult({
            url: URL.createObjectURL(blob),
            size: Number(xhr.getResponseHeader("X-Compressed-Size")) || blob.size,
            originalSize: Number(xhr.getResponseHeader("X-Original-Size")) || info.size,
            ext: resultExt, mimeType: resultMime,
          });
          setStage("done");
        } else {
          let msg = "Something went wrong. Please try again.";
          try { const j = JSON.parse(new TextDecoder().decode(buf)); if (j.error) msg = j.error; } catch {}
          setError(msg); setStage("ready");
        }
      }, xhrRef);
  };

  const cancel = () => { xhrRef.current?.abort(); setStage("ready"); setProgress(0); };

  return { info, stage, progress, result, error, onFile, clear, run, cancel, setError };
}

// ── COMPRESS TAB ──────────────────────────────────────────────────────────────
function CompressTab() {
  const [quality, setQuality] = useState<Quality>("medium");
  const t = useToolState("/api/compress", "video/mp4", "mp4");
  const busy = t.stage === "uploading" || t.stage === "processing";

  return (
    <div className="space-y-4">
      {!t.info && <DropZone onFile={t.onFile}/>}
      {t.info && <FileCard info={t.info} onClear={t.clear} busy={busy}/>}

      {(t.stage === "ready" || t.stage === "done") && t.info && (
        <div className="card p-4 space-y-3">
          <p className="label">Quality</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(Q) as Quality[]).map(q => (
              <button key={q} onClick={() => setQuality(q)}
                className={`rounded-2xl p-3.5 border text-left transition-all ${quality === q ? "border-purple-500/40 bg-purple-500/10" : "border-white/5 bg-white/[0.02] hover:border-white/10"}`}>
                <p className={`text-xs font-bold ${quality === q ? "text-purple-300" : "text-white/55"}`}>{Q[q].label}</p>
                <p className={`text-[10px] mt-0.5 ${quality === q ? "text-purple-400/55" : "text-white/20"}`}>{Q[q].tag}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {t.stage === "ready" && <button onClick={() => t.run({ quality })} className="w-full btn-primary py-4 font-bold text-base">Compress Video</button>}
      {busy && <ProcessingCard progress={t.progress} stage={t.stage}/>}
      {t.stage === "done" && t.result && t.info && (
        <ResultCard result={t.result} onRedo={() => { t.setError(""); t.result && t.setError(""); t.clear(); setTimeout(() => { if (t.info) {} }); t.onFile(t.info.file); }} filename={`${t.info.name.replace(/\.[^.]+$/, "")}_compressed.mp4`}/>
      )}
      {t.error && <ErrorBanner msg={t.error} onDismiss={() => t.setError("")}/>}
    </div>
  );
}

// ── SPLIT TAB ─────────────────────────────────────────────────────────────────
function SplitTab() {
  const [info, setInfo]     = useState<VInfo | null>(null);
  const [startT, setStartT] = useState(0);
  const [endT,   setEndT]   = useState(0);
  const [startStr, setStartStr] = useState("0:00");
  const [endStr,   setEndStr]   = useState("0:30");
  const [curT,   setCurT]   = useState(0);
  const [stage,  setStage]  = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error,  setError]  = useState("");
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const vidRef = useRef<HTMLVideoElement>(null);

  const onFile = (f: File) => {
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.src = url;
    v.onloadedmetadata = () => {
      const dur = v.duration;
      setInfo({ file: f, url, size: f.size, name: f.name, duration: dur });
      const defEnd = Math.min(dur, 30);
      setStartT(0); setEndT(defEnd);
      setStartStr("0:00"); setEndStr(toDisplay(defEnd));
      setStage("ready"); setResult(null); setError("");
    };
  };
  const clear = () => { xhrRef.current?.abort(); setInfo(null); setStage("idle"); setResult(null); setError(""); };

  const moveStart = (v: number) => { setStartT(v); setStartStr(toDisplay(v)); };
  const moveEnd   = (v: number) => { setEndT(v);   setEndStr(toDisplay(v)); };
  const applyStart = (s: string) => { const v = parseTime(s); if (v !== null && info) { const c = Math.min(Math.max(0, v), endT - 0.1); setStartT(c); setStartStr(toDisplay(c)); } };
  const applyEnd   = (s: string) => { const v = parseTime(s); if (v !== null && info) { const c = Math.min(Math.max(startT + 0.1, v), info.duration); setEndT(c); setEndStr(toDisplay(c)); } };

  const setFromCurrent = (w: "start" | "end") => {
    if (!info) return;
    const t = vidRef.current?.currentTime ?? 0;
    if (w === "start") { const v = Math.min(t, endT - 0.1); setStartT(v); setStartStr(toDisplay(v)); }
    else               { const v = Math.max(t, startT + 0.1); const c = Math.min(v, info.duration); setEndT(c); setEndStr(toDisplay(c)); }
  };

  const clipLen = Math.max(0, endT - startT);
  const busy = stage === "uploading" || stage === "processing";

  const run = () => {
    if (!info || startT >= endT) { setError("Start time must be before end time."); return; }
    setStage("uploading"); setProgress(0); setError("");
    const fd = new FormData();
    fd.append("video", info.file);
    fd.append("startTime", String(startT));
    fd.append("endTime",   String(endT));
    xhrPost("/api/split", fd, p => { setProgress(p); if (p === 100) setStage("processing"); },
      (ok, buf, xhr) => {
        if (ok) {
          const blob = new Blob([buf], { type: "video/mp4" });
          setResult({ url: URL.createObjectURL(blob), size: Number(xhr.getResponseHeader("X-Compressed-Size")) || blob.size, originalSize: Number(xhr.getResponseHeader("X-Original-Size")) || info.size, ext: "mp4", mimeType: "video/mp4" });
          setStage("done");
        } else {
          let msg = "Something went wrong. Please try again.";
          try { const j = JSON.parse(new TextDecoder().decode(buf)); if (j.error) msg = j.error; } catch {}
          setError(msg); setStage("ready");
        }
      }, xhrRef);
  };

  return (
    <div className="space-y-4">
      {!info && <DropZone onFile={onFile}/>}
      {info && (
        <>
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-purple-500/15 flex-shrink-0 flex items-center justify-center">
                <svg className="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white/90 truncate">{info.name}</p>
                <p className="text-xs text-white/35 mt-0.5">{fmt(info.size)} · {toDisplay(info.duration)}</p>
              </div>
              {!busy && <button onClick={clear} className="w-7 h-7 rounded-xl flex items-center justify-center text-white/20 hover:text-white/60 hover:bg-white/8 transition-all"><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>}
            </div>
            <video ref={vidRef} src={info.url} controls playsInline onTimeUpdate={() => setCurT(vidRef.current?.currentTime ?? 0)} className="w-full rounded-2xl max-h-48 bg-black object-contain"/>
            <div className="flex items-center gap-3">
              <span className="text-xs text-white/25 tabular-nums">{toDisplay(curT)}</span>
              <div className="flex gap-2 ml-auto">
                <button onClick={() => setFromCurrent("start")} className="px-3 py-1.5 rounded-xl bg-purple-500/12 border border-purple-500/18 text-purple-300 text-xs font-semibold hover:bg-purple-500/22 transition-colors">Set Start</button>
                <button onClick={() => setFromCurrent("end")}   className="px-3 py-1.5 rounded-xl bg-purple-500/12 border border-purple-500/18 text-purple-300 text-xs font-semibold hover:bg-purple-500/22 transition-colors">Set End</button>
              </div>
            </div>
          </div>

          {(stage === "ready" || stage === "done") && (
            <div className="card p-5 space-y-5">
              <p className="label">Clip Range</p>

              {/* Start */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="label">Start</span>
                  <input type="text" value={startStr} onChange={e => setStartStr(e.target.value)}
                    onBlur={e => applyStart(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && applyStart((e.target as HTMLInputElement).value)}
                    className="time-input" placeholder="0:00"/>
                </div>
                <input type="range" min={0} max={Math.max(0, info.duration - 0.1)} step={0.1} value={startT} onChange={e => moveStart(Number(e.target.value))} className="w-full"/>
              </div>

              {/* End */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="label">End</span>
                  <input type="text" value={endStr} onChange={e => setEndStr(e.target.value)}
                    onBlur={e => applyEnd(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && applyEnd((e.target as HTMLInputElement).value)}
                    className="time-input" placeholder="0:30"/>
                </div>
                <input type="range" min={0.1} max={info.duration} step={0.1} value={endT} onChange={e => moveEnd(Number(e.target.value))} className="w-full"/>
              </div>

              {/* Timeline */}
              <div className="relative h-9 bg-white/[0.025] rounded-xl overflow-hidden border border-white/5">
                <div className="absolute inset-y-0 bg-purple-500/25 border-x-2 border-purple-500/50 transition-all duration-150"
                  style={{ left: `${(startT / info.duration) * 100}%`, right: `${(1 - endT / info.duration) * 100}%` }}/>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-xs text-purple-200/80 font-semibold">{toDisplay(clipLen)}</span>
                </div>
              </div>
            </div>
          )}

          {stage === "ready" && <button onClick={run} className="w-full btn-primary py-4 font-bold text-base">Extract Clip</button>}
          {busy && <ProcessingCard progress={progress} stage={stage}/>}
          {stage === "done" && result && (
            <ResultCard result={result} onRedo={() => { setResult(null); setStage("ready"); }}
              filename={`${info.name.replace(/\.[^.]+$/, "")}_clip.mp4`}/>
          )}
          {error && <ErrorBanner msg={error} onDismiss={() => setError("")}/>}
        </>
      )}
    </div>
  );
}

// ── AUDIO EXTRACT TAB ─────────────────────────────────────────────────────────
function AudioTab() {
  const t = useToolState("/api/extract-audio", "audio/mpeg", "mp3");
  const busy = t.stage === "uploading" || t.stage === "processing";

  return (
    <div className="space-y-4">
      {!t.info && <DropZone onFile={t.onFile}/>}
      {t.info && <FileCard info={t.info} onClear={t.clear} busy={busy}/>}
      {t.stage === "ready" && <button onClick={() => t.run()} className="w-full btn-primary py-4 font-bold text-base">Extract Audio</button>}
      {busy && <ProcessingCard progress={t.progress} stage={t.stage}/>}
      {t.stage === "done" && t.result && t.info && (
        <ResultCard result={t.result} onRedo={() => { t.clear(); }} filename={`${t.info.name.replace(/\.[^.]+$/, "")}_audio.mp3`}/>
      )}
      {t.error && <ErrorBanner msg={t.error} onDismiss={() => t.setError("")}/>}
    </div>
  );
}

// ── MUTE VIDEO TAB ────────────────────────────────────────────────────────────
function MuteTab() {
  const t = useToolState("/api/mute-video", "video/mp4", "mp4");
  const busy = t.stage === "uploading" || t.stage === "processing";

  return (
    <div className="space-y-4">
      {!t.info && <DropZone onFile={t.onFile}/>}
      {t.info && <FileCard info={t.info} onClear={t.clear} busy={busy}/>}
      {t.stage === "ready" && <button onClick={() => t.run()} className="w-full btn-primary py-4 font-bold text-base">Remove Audio</button>}
      {busy && <ProcessingCard progress={t.progress} stage={t.stage}/>}
      {t.stage === "done" && t.result && t.info && (
        <ResultCard result={t.result} onRedo={() => { t.clear(); }} filename={`${t.info.name.replace(/\.[^.]+$/, "")}_muted.mp4`}/>
      )}
      {t.error && <ErrorBanner msg={t.error} onDismiss={() => t.setError("")}/>}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "compress", label: "Compress",      icon: "M3 7h18M3 12h18M3 17h18" },
  { id: "split",    label: "Trim",          icon: "M6 3v18M18 3v18M3 9h18M3 15h18" },
  { id: "audio",    label: "To MP3",        icon: "M9 18V5l12-2v13M6 21a3 3 0 100-6 3 3 0 000 6zM18 19a3 3 0 100-6 3 3 0 000 6z" },
  { id: "mute",     label: "Mute",          icon: "M11 5L6 9H2v6h4l5 4V5zM23 9l-6 6M17 9l6 6" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("compress");

  return (
    <div className="min-h-screen bg-[#080812]">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 left-1/3 w-[500px] h-[500px] bg-purple-700/8 rounded-full blur-[120px]"/>
        <div className="absolute bottom-0 right-0 w-80 h-80 bg-pink-700/6 rounded-full blur-[100px]"/>
      </div>

      <div className="relative z-10 max-w-lg mx-auto px-4 pt-10 pb-20">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-purple-500/25">
              <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
              </svg>
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Video Tools</h1>
          </div>
        </div>

        {/* Scrollable Tab Bar */}
        <div className="flex gap-1 p-1.5 bg-white/[0.035] border border-white/[0.055] rounded-2xl mb-5 overflow-x-auto no-scrollbar">
          {TABS.map(({ id, label, icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-shrink-0 flex items-center justify-center gap-1.5 py-2.5 px-3.5 rounded-xl text-xs font-bold transition-all duration-200 whitespace-nowrap
                ${tab === id
                  ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-md shadow-purple-500/20"
                  : "text-white/30 hover:text-white/60"}`}>
              <svg className="w-3.5 h-3.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon}/>
              </svg>
              {label}
            </button>
          ))}
        </div>

        {tab === "compress" && <CompressTab/>}
        {tab === "split"    && <SplitTab/>}
        {tab === "audio"    && <AudioTab/>}
        {tab === "mute"     && <MuteTab/>}
      </div>
    </div>
  );
}
