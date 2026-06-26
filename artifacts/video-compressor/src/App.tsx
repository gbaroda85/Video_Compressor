import { useState, useRef, useCallback, useEffect } from "react";

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return `${(b / 1024 ** i).toFixed(2)} ${u[i]}`;
}
function fmtT(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
}

type Quality = "high" | "medium" | "low";
type Tab = "compress" | "split";
type Stage = "idle" | "ready" | "uploading" | "processing" | "done" | "error";

const Q: Record<Quality, { crf: number; label: string; tag: string }> = {
  high:   { crf: 23, label: "High",   tag: "~60% smaller" },
  medium: { crf: 32, label: "Balanced", tag: "~80% smaller" },
  low:    { crf: 40, label: "Max",    tag: "~90% smaller" },
};

interface VInfo { file: File; url: string; size: number; name: string; duration: number }
interface Result { url: string; size: number; originalSize: number; ext: string }

// ── upload helper ─────────────────────────────────────────────────────────────
function xhrPost(
  url: string,
  data: FormData,
  onProgress: (p: number) => void,
  onDone: (ok: boolean, blob: ArrayBuffer, xhr: XMLHttpRequest) => void,
  xhrRef: React.MutableRefObject<XMLHttpRequest | null>,
) {
  const xhr = new XMLHttpRequest();
  xhrRef.current = xhr;
  xhr.responseType = "arraybuffer";
  xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
  xhr.onload = () => onDone(xhr.status === 200, xhr.response, xhr);
  xhr.onerror = () => onDone(false, new ArrayBuffer(0), xhr);
  xhr.open("POST", url);
  xhr.send(data);
}

// ── shared sub-components ─────────────────────────────────────────────────────
function DropZone({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("video/")) onFile(f); }}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onClick={() => ref.current?.click()}
      className={`group cursor-pointer rounded-3xl border-2 border-dashed transition-all duration-300 flex flex-col items-center justify-center gap-5 py-14 px-6
        ${drag ? "border-purple-500 bg-purple-500/10" : "border-white/10 hover:border-purple-400/40 hover:bg-white/[0.015]"}`}
    >
      <div className={`w-20 h-20 rounded-2xl flex items-center justify-center transition-all
        ${drag ? "bg-purple-500/30 scale-110" : "bg-white/5 group-hover:bg-purple-500/15"}`}>
        <svg className={`w-9 h-9 transition-colors ${drag ? "text-purple-300" : "text-white/30 group-hover:text-purple-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
        </svg>
      </div>
      <div className="text-center space-y-1">
        <p className="text-white/80 font-semibold text-base">{drag ? "Drop here!" : "Drop your video"}</p>
        <p className="text-white/30 text-sm">or tap to browse • MP4, MOV, AVI, MKV, WebM</p>
      </div>
      <input ref={ref} type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </div>
  );
}

function UploadBar({ progress, stage, label, onCancel }: { progress: number; stage: Stage; label: string; onCancel: () => void }) {
  const isProcessing = stage === "processing";
  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-white/90 font-semibold text-sm">{label}</p>
          <p className="text-white/35 text-xs mt-0.5">
            {isProcessing ? "FFmpeg compressing on server…" : `${progress}% uploaded`}
          </p>
        </div>
        {isProcessing
          ? <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin"/>
          : <span className="text-purple-300 font-bold tabular-nums text-sm">{progress}%</span>
        }
      </div>
      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
        {isProcessing
          ? <div className="h-full w-full bg-gradient-to-r from-purple-500 to-pink-500 animate-pulse"/>
          : <div className="h-full bg-gradient-to-r from-purple-500 to-pink-500 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}/>
        }
      </div>
      <button onClick={onCancel} className="text-xs text-white/25 hover:text-white/50 underline transition-colors">Cancel</button>
    </div>
  );
}

function ResultView({ res: r, onRedo, onDownload }: { res: Result; onRedo: () => void; onDownload: () => void }) {
  const saved = Math.round((1 - r.size / r.originalSize) * 100);
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <span className="text-emerald-400 font-semibold text-sm">Done!</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { l: "Before", v: fmt(r.originalSize), c: "text-white/70" },
          { l: "Saved",  v: `${saved}%`,         c: "text-purple-300 text-lg" },
          { l: "After",  v: fmt(r.size),          c: "text-white/70" },
        ].map(({ l, v, c }) => (
          <div key={l} className={`rounded-2xl p-3 ${l === "Saved" ? "bg-purple-500/10 border border-purple-500/20" : "bg-white/[0.03]"}`}>
            <p className="text-[10px] text-white/25 uppercase tracking-widest">{l}</p>
            <p className={`font-bold mt-1 ${c}`}>{v}</p>
          </div>
        ))}
      </div>
      <video src={r.url} controls playsInline className="w-full rounded-2xl max-h-48 bg-black object-contain"/>
      <div className="flex gap-3">
        <button onClick={onDownload} className="flex-1 btn-primary py-3 text-sm gap-2 flex items-center justify-center">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          Download {r.ext.toUpperCase()}
        </button>
        <button onClick={onRedo} className="px-5 py-3 rounded-2xl border border-white/10 text-sm text-white/50 hover:text-white/80 hover:border-white/20 transition-all">Redo</button>
      </div>
    </div>
  );
}

// ── COMPRESS TAB ──────────────────────────────────────────────────────────────
function CompressTab() {
  const [info, setInfo] = useState<VInfo | null>(null);
  const [quality, setQuality] = useState<Quality>("medium");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const onFile = (f: File) => {
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.src = url;
    v.onloadedmetadata = () => setInfo({ file: f, url, size: f.size, name: f.name, duration: v.duration });
    setStage("ready"); setResult(null); setError("");
  };

  const clear = () => { xhrRef.current?.abort(); setInfo(null); setStage("idle"); setResult(null); setError(""); };

  const start = () => {
    if (!info) return;
    setStage("uploading"); setProgress(0); setError("");
    const fd = new FormData();
    fd.append("video", info.file);
    fd.append("quality", quality);
    xhrPost("/api/compress", fd, (p) => {
      setProgress(p);
      if (p === 100) setStage("processing");
    }, (ok, buf, xhr) => {
      if (ok) {
        const blob = new Blob([buf], { type: "video/mp4" });
        const origSize = Number(xhr.getResponseHeader("X-Original-Size")) || info.size;
        const compSize = Number(xhr.getResponseHeader("X-Compressed-Size")) || blob.size;
        setResult({ url: URL.createObjectURL(blob), size: compSize, originalSize: origSize, ext: "mp4" });
        setStage("done");
      } else {
        let msg = "Compression failed. Please try again.";
        try { const j = JSON.parse(new TextDecoder().decode(buf)); if (j.error) msg = j.error; } catch {}
        setError(msg); setStage("ready");
      }
    }, xhrRef);
  };

  const download = () => {
    if (!result || !info) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `${info.name.replace(/\.[^.]+$/, "")}_compressed.mp4`;
    a.click();
  };

  return (
    <div className="space-y-4">
      {!info && <DropZone onFile={onFile}/>}

      {info && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-white/90 truncate">{info.name}</p>
              <p className="text-xs text-white/35 mt-0.5">{fmt(info.size)} · {fmtT(info.duration)}</p>
            </div>
            {stage !== "uploading" && stage !== "processing" && (
              <button onClick={clear} className="w-7 h-7 rounded-xl flex items-center justify-center text-white/25 hover:text-white/60 hover:bg-white/10 transition-all">
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
              </button>
            )}
          </div>
          <video src={info.url} controls playsInline className="w-full rounded-2xl max-h-48 bg-black object-contain"/>
        </div>
      )}

      {(stage === "ready" || stage === "done") && info && (
        <div className="card p-4 space-y-3">
          <p className="text-[11px] text-white/30 font-semibold uppercase tracking-widest">Quality Setting</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(Q) as Quality[]).map(q => (
              <button key={q} onClick={() => setQuality(q)}
                className={`rounded-2xl p-3.5 border text-left transition-all duration-200 ${quality === q ? "border-purple-500/50 bg-purple-500/10" : "border-white/6 bg-white/[0.02] hover:border-white/10"}`}>
                <p className={`text-xs font-bold ${quality === q ? "text-purple-300" : "text-white/60"}`}>{Q[q].label}</p>
                <p className={`text-[10px] mt-0.5 ${quality === q ? "text-purple-400/60" : "text-white/20"}`}>{Q[q].tag}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {stage === "ready" && info && (
        <button onClick={start} className="w-full btn-primary py-4 text-base font-bold">
          ⚡ Compress with FFmpeg
        </button>
      )}

      {(stage === "uploading" || stage === "processing") && (
        <UploadBar progress={progress} stage={stage} label={stage === "uploading" ? "Uploading video…" : "Compressing…"} onCancel={() => { xhrRef.current?.abort(); setStage("ready"); }}/>
      )}

      {stage === "done" && result && (
        <ResultView res={result} onRedo={() => { setResult(null); setStage("ready"); }} onDownload={download}/>
      )}

      {error && (
        <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
          <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
}

// ── SPLIT TAB ─────────────────────────────────────────────────────────────────
function SplitTab() {
  const [info, setInfo] = useState<VInfo | null>(null);
  const [startT, setStartT] = useState(0);
  const [endT, setEndT] = useState(0);
  const [curT, setCurT] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const vidRef = useRef<HTMLVideoElement>(null);

  const onFile = (f: File) => {
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.src = url;
    v.onloadedmetadata = () => {
      setInfo({ file: f, url, size: f.size, name: f.name, duration: v.duration });
      setStartT(0); setEndT(Math.min(v.duration, 30));
      setStage("ready"); setResult(null); setError("");
    };
  };

  const clear = () => { xhrRef.current?.abort(); setInfo(null); setStage("idle"); setResult(null); setError(""); };

  const clipLen = endT - startT;

  const start = () => {
    if (!info || startT >= endT) { setError("Start time must be before end time."); return; }
    setStage("uploading"); setProgress(0); setError("");
    const fd = new FormData();
    fd.append("video", info.file);
    fd.append("startTime", String(startT));
    fd.append("endTime", String(endT));
    xhrPost("/api/split", fd, (p) => {
      setProgress(p);
      if (p === 100) setStage("processing");
    }, (ok, buf, xhr) => {
      if (ok) {
        const blob = new Blob([buf], { type: "video/mp4" });
        const origSize = Number(xhr.getResponseHeader("X-Original-Size")) || info.size;
        const clipSize = Number(xhr.getResponseHeader("X-Compressed-Size")) || blob.size;
        setResult({ url: URL.createObjectURL(blob), size: clipSize, originalSize: origSize, ext: "mp4" });
        setStage("done");
      } else {
        let msg = "Split failed. Please try again.";
        try { const j = JSON.parse(new TextDecoder().decode(buf)); if (j.error) msg = j.error; } catch {}
        setError(msg); setStage("ready");
      }
    }, xhrRef);
  };

  const download = () => {
    if (!result || !info) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `${info.name.replace(/\.[^.]+$/, "")}_clip_${fmtT(startT)}-${fmtT(endT)}.mp4`;
    a.click();
  };

  const Slider = ({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) => (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-white/30 uppercase tracking-widest font-semibold">{label}</span>
        <span className="text-purple-300 font-bold text-sm tabular-nums">{fmtT(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={0.1} value={value}
        onChange={e => onChange(Number(e.target.value))} className="w-full range-purple"/>
    </div>
  );

  return (
    <div className="space-y-4">
      {!info && <DropZone onFile={onFile}/>}

      {info && (
        <>
          <div className="card p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-purple-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white/90 truncate">{info.name}</p>
                <p className="text-xs text-white/35 mt-0.5">{fmt(info.size)} · {fmtT(info.duration)}</p>
              </div>
              {stage !== "uploading" && stage !== "processing" && (
                <button onClick={clear} className="w-7 h-7 rounded-xl flex items-center justify-center text-white/25 hover:text-white/60 hover:bg-white/10 transition-all">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              )}
            </div>
            <video ref={vidRef} src={info.url} controls playsInline
              onTimeUpdate={() => setCurT(vidRef.current?.currentTime ?? 0)}
              className="w-full rounded-2xl max-h-48 bg-black object-contain"/>

            {/* Quick set buttons */}
            <div className="flex items-center gap-2 pt-1">
              <span className="text-xs text-white/25 flex-shrink-0">At <span className="text-purple-300 font-semibold">{fmtT(curT)}</span></span>
              <div className="flex gap-2 ml-auto">
                <button
                  onClick={() => setStartT(Math.min(curT, Math.max(0, endT - 0.5)))}
                  className="px-3 py-1.5 rounded-xl bg-purple-500/15 text-purple-300 text-xs font-semibold hover:bg-purple-500/25 transition-colors border border-purple-500/20">
                  Set Start
                </button>
                <button
                  onClick={() => setEndT(Math.max(curT, Math.min(info.duration, startT + 0.5)))}
                  className="px-3 py-1.5 rounded-xl bg-purple-500/15 text-purple-300 text-xs font-semibold hover:bg-purple-500/25 transition-colors border border-purple-500/20">
                  Set End
                </button>
              </div>
            </div>
          </div>

          {(stage === "ready" || stage === "done") && (
            <div className="card p-5 space-y-5">
              <p className="text-[11px] text-white/30 font-semibold uppercase tracking-widest">Clip Range</p>
              <Slider label="Start Time" value={startT} min={0} max={Math.max(0, info.duration - 0.5)} onChange={v => setStartT(Math.min(v, endT - 0.5))}/>
              <Slider label="End Time"   value={endT}   min={0.5} max={info.duration} onChange={v => setEndT(Math.max(v, startT + 0.5))}/>

              {/* Timeline visualiser */}
              <div className="relative h-10 bg-white/[0.03] rounded-2xl overflow-hidden border border-white/5">
                <div className="absolute inset-y-0 bg-purple-500/25 border-x-2 border-purple-500/50 transition-all"
                  style={{ left: `${(startT / info.duration) * 100}%`, right: `${100 - (endT / info.duration) * 100}%` }}/>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xs text-purple-200 font-semibold">{fmtT(clipLen)} selected</span>
                </div>
              </div>
            </div>
          )}

          {stage === "ready" && (
            <button onClick={start} className="w-full btn-primary py-4 text-base font-bold">
              ✂️ Extract Clip (Fast — no re-encode)
            </button>
          )}

          {(stage === "uploading" || stage === "processing") && (
            <UploadBar progress={progress} stage={stage}
              label={stage === "uploading" ? "Uploading video…" : "Splitting on server…"}
              onCancel={() => { xhrRef.current?.abort(); setStage("ready"); }}/>
          )}

          {stage === "done" && result && (
            <ResultView res={result} onRedo={() => { setResult(null); setStage("ready"); }} onDownload={download}/>
          )}

          {error && (
            <div className="flex items-start gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl p-4">
              <svg className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>
              <p className="text-sm text-red-300">{error}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>("compress");

  return (
    <div className="min-h-screen bg-[#080812]">
      {/* Background glows */}
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-80 h-80 bg-purple-700/12 rounded-full blur-[80px]"/>
        <div className="absolute bottom-1/3 right-0 w-60 h-60 bg-pink-700/8 rounded-full blur-[60px]"/>
      </div>

      <div className="relative z-10 max-w-lg mx-auto px-4 pb-20 pt-10">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center shadow-xl shadow-purple-500/30">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
              </svg>
            </div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Video Tools</h1>
          </div>
          <p className="text-white/25 text-xs">Powered by FFmpeg · Server-side processing</p>
        </div>

        {/* Tabs */}
        <div className="flex p-1.5 bg-white/[0.04] border border-white/[0.06] rounded-2xl mb-6 gap-1">
          {([
            { id: "compress", label: "Compressor", icon: "M3 7h18M3 12h18M3 17h18" },
            { id: "split",    label: "Splitter",   icon: "M12 3v18M3 12h18" },
          ] as const).map(({ id, label, icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-sm font-semibold transition-all duration-300
                ${tab === id
                  ? "bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg shadow-purple-500/30"
                  : "text-white/30 hover:text-white/55"}`}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <path d={icon}/>
              </svg>
              {label}
            </button>
          ))}
        </div>

        {/* Panel */}
        {tab === "compress" ? <CompressTab/> : <SplitTab/>}

        <p className="text-center text-[10px] text-white/15 mt-8">
          Files are processed on server · deleted immediately after download
        </p>
      </div>
    </div>
  );
}
