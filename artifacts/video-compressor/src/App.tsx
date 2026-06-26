import { useState, useRef, useCallback, useEffect } from "react";

type Tab = "compress" | "split";
type Quality = "high" | "medium" | "low";
type Stage = "idle" | "ready" | "processing" | "done" | "error";

const QUALITY: Record<Quality, { bps: number; label: string; desc: string }> = {
  high:   { bps: 1_800_000, label: "High Quality",   desc: "~50-70% smaller" },
  medium: { bps: 800_000,   label: "Balanced",        desc: "~70-85% smaller" },
  low:    { bps: 300_000,   label: "Max Compress",    desc: "~85-95% smaller" },
};

function fmt(b: number) {
  if (!b) return "0 B";
  const u = ["B","KB","MB","GB"], i = Math.floor(Math.log(b)/Math.log(1024));
  return `${(b/1024**i).toFixed(2)} ${u[i]}`;
}
function fmtT(s: number) {
  if (!isFinite(s) || s < 0) return "--:--";
  const m = Math.floor(s/60), ss = Math.floor(s%60);
  return `${m}:${String(ss).padStart(2,"0")}`;
}
function fmtMs(s: number) {
  const m = Math.floor(s/60), ss = (s%60).toFixed(1);
  return `${String(m).padStart(2,"0")}:${ss.padStart(4,"0")}`;
}

function getMime(): string {
  const types = ["video/mp4","video/webm;codecs=vp9","video/webm;codecs=vp8","video/webm"];
  return types.find(t => MediaRecorder.isTypeSupported(t)) ?? "";
}

interface VideoInfo { file: File; url: string; duration: number; size: number; name: string }
interface ResultInfo { url: string; size: number; ext: string }

function UploadZone({ onFile }: { onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  return (
    <div
      onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f?.type.startsWith("video/")) onFile(f); }}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onClick={() => ref.current?.click()}
      className={`group relative cursor-pointer rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-4 py-14 px-6 transition-all duration-300 select-none
        ${drag ? "border-violet-500 bg-violet-500/10 scale-[1.02]" : "border-white/10 hover:border-violet-500/50 hover:bg-white/[0.02]"}`}
    >
      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all ${drag ? "bg-violet-500/30" : "bg-white/5 group-hover:bg-violet-500/10"}`}>
        <svg className={`w-7 h-7 transition-colors ${drag ? "text-violet-400" : "text-white/40 group-hover:text-violet-400"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <div className="text-center">
        <p className="font-semibold text-white/80">{drag ? "Drop it!" : "Drop video here"}</p>
        <p className="text-sm text-white/30 mt-1">or tap to browse · MP4, MOV, AVI, MKV, WebM</p>
      </div>
      <input ref={ref} type="file" accept="video/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </div>
  );
}

function VideoCard({ info, onClear, disabled }: { info: VideoInfo; onClear: () => void; disabled?: boolean }) {
  return (
    <div className="glass rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center flex-shrink-0">
          <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-white/90 truncate">{info.name}</p>
          <p className="text-xs text-white/40 mt-0.5">{fmt(info.size)} · {fmtT(info.duration)}</p>
        </div>
        {!disabled && (
          <button onClick={onClear} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/10 transition-all">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        )}
      </div>
      <video src={info.url} controls playsInline className="w-full rounded-xl max-h-44 bg-black object-contain" />
    </div>
  );
}

function ProgressCard({ progress, label, sub, onCancel }: { progress: number; label: string; sub: string; onCancel: () => void }) {
  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-white/90">{label}</p>
          <p className="text-xs text-white/40 mt-0.5">{sub}</p>
        </div>
        <span className="text-violet-400 font-bold tabular-nums">{progress}%</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-500" style={{ width: `${progress}%` }}/>
      </div>
      <button onClick={onCancel} className="text-xs text-white/30 hover:text-white/60 underline transition-colors">Cancel</button>
    </div>
  );
}

function ResultCard({ result, original, onDownload, onRedo, label }: { result: ResultInfo; original: number; onDownload: () => void; onRedo: () => void; label: string }) {
  const saved = Math.round((1 - result.size / original) * 100);
  return (
    <div className="glass rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
          <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5"/></svg>
        </div>
        <span className="font-semibold text-emerald-400 text-sm">{label}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { l: "Original", v: fmt(original), color: "" },
          { l: "Saved", v: `${saved}%`, color: "text-violet-400" },
          { l: "Output", v: fmt(result.size), color: "" },
        ].map(({ l, v, color }) => (
          <div key={l} className={`rounded-xl p-3 text-center ${color ? "bg-violet-500/10 border border-violet-500/20" : "bg-white/[0.03]"}`}>
            <p className="text-[10px] text-white/30 uppercase tracking-wider">{l}</p>
            <p className={`text-sm font-bold mt-1 ${color || "text-white/90"}`}>{v}</p>
          </div>
        ))}
      </div>
      <video src={result.url} controls playsInline className="w-full rounded-xl max-h-44 bg-black object-contain"/>
      <div className="flex gap-2">
        <button onClick={onDownload} className="flex-1 py-3 rounded-xl grad-btn font-semibold text-sm flex items-center justify-center gap-2">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
          Download {result.ext.toUpperCase()}
        </button>
        <button onClick={onRedo} className="px-4 py-3 rounded-xl border border-white/10 text-sm text-white/60 hover:border-white/20 hover:text-white/80 transition-all">
          Redo
        </button>
      </div>
    </div>
  );
}

// ─── COMPRESS PANEL ────────────────────────────────────────────────────────────
function CompressPanel() {
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [quality, setQuality] = useState<Quality>("medium");
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ResultInfo | null>(null);
  const [error, setError] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRef = useRef(false);

  const onFile = useCallback((f: File) => {
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.src = url;
    v.onloadedmetadata = () => setInfo({ file: f, url, duration: v.duration, size: f.size, name: f.name });
    setStage("ready");
    setResult(null);
    setError("");
  }, []);

  const clear = () => { setInfo(null); setStage("idle"); setResult(null); setError(""); setProgress(0); };

  const compress = useCallback(async () => {
    if (!info || !videoRef.current) return;
    const mime = getMime();
    if (!mime) { setError("Your browser doesn't support video recording. Try Chrome or Firefox."); return; }

    cancelRef.current = false;
    chunksRef.current = [];
    setStage("processing");
    setProgress(0);
    setElapsed(0);
    setError("");

    const vid = videoRef.current;
    vid.src = info.url;
    vid.muted = false;
    vid.currentTime = 0;

    await new Promise<void>(r => { vid.onseeked = () => r(); vid.load(); vid.currentTime = 0; });

    const stream = (vid as any).captureStream?.() ?? (vid as any).mozCaptureStream?.();
    if (!stream) { setError("captureStream not supported in this browser."); setStage("ready"); return; }

    const recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: QUALITY[quality].bps,
      audioBitsPerSecond: 96_000,
    });
    recorderRef.current = recorder;

    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };

    recorder.onstop = () => {
      if (cancelRef.current) return;
      const blob = new Blob(chunksRef.current, { type: mime });
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      setResult({ url: URL.createObjectURL(blob), size: blob.size, ext });
      setStage("done");
      vid.pause();
    };

    const startTs = Date.now();
    const ticker = setInterval(() => {
      if (cancelRef.current) { clearInterval(ticker); return; }
      const cur = vid.currentTime;
      const pct = Math.min(Math.round((cur / info.duration) * 100), 99);
      setProgress(pct);
      setElapsed(Math.round((Date.now() - startTs) / 1000));
    }, 500);

    vid.onended = () => { clearInterval(ticker); recorder.stop(); };

    recorder.start(250);
    try { await vid.play(); } catch {
      clearInterval(ticker);
      setError("Playback failed. Try a different video.");
      setStage("ready");
    }
  }, [info, quality]);

  const cancel = () => {
    cancelRef.current = true;
    recorderRef.current?.stop();
    videoRef.current?.pause();
    setStage("ready");
    setProgress(0);
  };

  const download = () => {
    if (!result || !info) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `${info.name.replace(/\.[^.]+$/, "")}_compressed.${result.ext}`;
    a.click();
  };

  const remaining = elapsed > 0 && progress > 0 ? Math.round(elapsed / (progress / 100) - elapsed) : null;

  return (
    <div className="space-y-4">
      {!info && <UploadZone onFile={onFile} />}
      {info && <VideoCard info={info} onClear={clear} disabled={stage === "processing"} />}

      {(stage === "ready" || stage === "done") && info && (
        <div className="glass rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-white/30 uppercase tracking-widest">Quality</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(QUALITY) as Quality[]).map(q => (
              <button key={q} onClick={() => setQuality(q)}
                className={`rounded-xl p-3 text-left border transition-all ${quality === q ? "border-violet-500/60 bg-violet-500/10" : "border-white/5 hover:border-white/10 bg-white/[0.02]"}`}>
                <p className={`text-xs font-semibold ${quality === q ? "text-violet-300" : "text-white/70"}`}>{QUALITY[q].label}</p>
                <p className={`text-[10px] mt-0.5 ${quality === q ? "text-violet-400/60" : "text-white/25"}`}>{QUALITY[q].desc}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {stage === "ready" && info && (
        <button onClick={compress} className="w-full py-3.5 rounded-2xl grad-btn font-semibold text-base">
          Compress Video
        </button>
      )}

      {stage === "processing" && (
        <ProgressCard
          progress={progress}
          label="Compressing..."
          sub={`${fmtT(elapsed)} elapsed${remaining !== null ? ` · ~${fmtT(remaining)} remaining` : ""}`}
          onCancel={cancel}
        />
      )}

      {stage === "done" && result && info && (
        <ResultCard result={result} original={info.size} onDownload={download} onRedo={() => { setResult(null); setStage("ready"); }} label="Compression complete!" />
      )}

      {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}

      {/* hidden video for capture */}
      <video ref={videoRef} playsInline style={{ position: "fixed", left: "-9999px", width: "1px", height: "1px" }} />
    </div>
  );
}

// ─── SPLIT PANEL ───────────────────────────────────────────────────────────────
function SplitPanel() {
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [startT, setStartT] = useState(0);
  const [endT, setEndT] = useState(0);
  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ResultInfo | null>(null);
  const [error, setError] = useState("");
  const [currentT, setCurrentT] = useState(0);

  const previewRef = useRef<HTMLVideoElement>(null);
  const hiddenRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const cancelRef = useRef(false);

  const onFile = useCallback((f: File) => {
    const url = URL.createObjectURL(f);
    const v = document.createElement("video");
    v.src = url;
    v.onloadedmetadata = () => {
      setInfo({ file: f, url, duration: v.duration, size: f.size, name: f.name });
      setStartT(0);
      setEndT(Math.min(v.duration, 30));
      setStage("ready");
      setResult(null);
      setError("");
    };
  }, []);

  const clear = () => { setInfo(null); setStage("idle"); setResult(null); setError(""); };

  const clipDuration = endT - startT;

  const split = useCallback(async () => {
    if (!info || !hiddenRef.current) return;
    if (startT >= endT) { setError("Start time must be before end time."); return; }
    const mime = getMime();
    if (!mime) { setError("Your browser doesn't support video recording. Try Chrome or Firefox."); return; }

    cancelRef.current = false;
    chunksRef.current = [];
    setStage("processing");
    setProgress(0);
    setError("");

    const vid = hiddenRef.current;
    vid.src = info.url;
    vid.muted = false;
    vid.currentTime = startT;

    await new Promise<void>(r => { vid.onseeked = () => r(); vid.load(); vid.currentTime = startT; });

    const stream = (vid as any).captureStream?.() ?? (vid as any).mozCaptureStream?.();
    if (!stream) { setError("captureStream not supported in this browser."); setStage("ready"); return; }

    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 128_000 });
    recorderRef.current = recorder;

    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      if (cancelRef.current) return;
      const blob = new Blob(chunksRef.current, { type: mime });
      const ext = mime.startsWith("video/mp4") ? "mp4" : "webm";
      setResult({ url: URL.createObjectURL(blob), size: blob.size, ext });
      setStage("done");
      vid.pause();
    };

    const ticker = setInterval(() => {
      if (cancelRef.current) { clearInterval(ticker); return; }
      const elapsed = vid.currentTime - startT;
      const pct = Math.min(Math.round((elapsed / clipDuration) * 100), 99);
      setProgress(pct);
      if (vid.currentTime >= endT - 0.1) {
        clearInterval(ticker);
        recorder.stop();
      }
    }, 200);

    recorder.start(250);
    try { await vid.play(); } catch {
      clearInterval(ticker);
      setError("Playback failed.");
      setStage("ready");
    }
  }, [info, startT, endT, clipDuration]);

  const cancel = () => {
    cancelRef.current = true;
    recorderRef.current?.stop();
    hiddenRef.current?.pause();
    setStage("ready");
    setProgress(0);
  };

  const download = () => {
    if (!result || !info) return;
    const a = document.createElement("a");
    a.href = result.url;
    a.download = `${info.name.replace(/\.[^.]+$/, "")}_clip_${fmtT(startT)}-${fmtT(endT)}.${result.ext}`;
    a.click();
  };

  function TimeInput({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
    return (
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-white/40 font-medium uppercase tracking-wider">{label}</span>
          <span className="text-sm font-bold text-violet-300 tabular-nums">{fmtT(value)}</span>
        </div>
        <input type="range" min={min} max={max} step={0.1} value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="w-full accent-violet-500 h-1.5 rounded-full" />
        <div className="flex justify-between text-[10px] text-white/20">
          <span>{fmtT(min)}</span><span>{fmtT(max)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!info && <UploadZone onFile={onFile} />}

      {info && (
        <>
          <div className="glass rounded-2xl p-4 space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-white/90 truncate">{info.name}</p>
                <p className="text-xs text-white/40 mt-0.5">{fmt(info.size)} · {fmtT(info.duration)}</p>
              </div>
              {stage !== "processing" && (
                <button onClick={clear} className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white/70 hover:bg-white/10 transition-all">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
              )}
            </div>
            <video ref={previewRef} src={info.url} controls playsInline
              onTimeUpdate={e => setCurrentT((e.target as HTMLVideoElement).currentTime)}
              className="w-full rounded-xl max-h-44 bg-black object-contain" />
            <div className="flex items-center justify-center gap-2 text-xs text-white/30">
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
              Current: <span className="text-violet-300 font-semibold tabular-nums">{fmtT(currentT)}</span>
              <button onClick={() => setStartT(Math.min(currentT, endT - 0.5))}
                className="ml-2 px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors">
                Set Start
              </button>
              <button onClick={() => setEndT(Math.max(currentT, startT + 0.5))}
                className="px-2 py-0.5 rounded-md bg-violet-500/20 text-violet-300 hover:bg-violet-500/30 transition-colors">
                Set End
              </button>
            </div>
          </div>

          {(stage === "ready" || stage === "done") && (
            <div className="glass rounded-2xl p-5 space-y-5">
              <p className="text-xs font-semibold text-white/30 uppercase tracking-widest">Select Clip Range</p>
              <div className="flex gap-6">
                <TimeInput label="Start" value={startT} onChange={v => setStartT(Math.min(v, endT - 0.5))} min={0} max={info.duration - 0.5} />
                <TimeInput label="End" value={endT} onChange={v => setEndT(Math.max(v, startT + 0.5))} min={0.5} max={info.duration} />
              </div>
              <div className="flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-violet-500/5 border border-violet-500/10">
                <svg className="w-4 h-4 text-violet-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v20M2 12h20" strokeLinecap="round"/>
                </svg>
                <span className="text-sm text-violet-300 font-semibold">Clip: {fmtT(clipDuration)}</span>
              </div>
            </div>
          )}

          {stage === "ready" && (
            <button onClick={split} className="w-full py-3.5 rounded-2xl grad-btn font-semibold text-base">
              Extract Clip
            </button>
          )}

          {stage === "processing" && (
            <ProgressCard progress={progress} label="Extracting clip..." sub={`Recording ${fmtT(clipDuration)} segment`} onCancel={cancel} />
          )}

          {stage === "done" && result && (
            <ResultCard result={result} original={info.size} onDownload={download} onRedo={() => { setResult(null); setStage("ready"); }} label="Clip extracted!" />
          )}

          {error && <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">{error}</p>}

          <video ref={hiddenRef} playsInline style={{ position: "fixed", left: "-9999px", width: "1px", height: "1px" }} />
        </>
      )}
    </div>
  );
}

// ─── ROOT ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>("compress");

  return (
    <div className="min-h-screen bg-[#070714] text-white">
      {/* Ambient glow */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-40 -left-40 w-96 h-96 bg-violet-600/10 rounded-full blur-3xl"/>
        <div className="absolute top-20 right-0 w-72 h-72 bg-indigo-600/8 rounded-full blur-3xl"/>
        <div className="absolute bottom-0 left-1/2 w-80 h-80 bg-purple-600/6 rounded-full blur-3xl"/>
      </div>

      <div className="relative z-10 max-w-xl mx-auto px-4 pb-16">
        {/* Header */}
        <div className="pt-10 pb-7 text-center">
          <div className="inline-flex items-center gap-2.5 mb-3">
            <div className="w-9 h-9 rounded-xl grad-bg flex items-center justify-center shadow-lg shadow-violet-500/30">
              <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M10 9l5 3-5 3V9z"/>
              </svg>
            </div>
            <h1 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
              Video Tools
            </h1>
          </div>
          <p className="text-white/30 text-xs">100% browser-based · no uploads · no servers</p>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-2 p-1 glass rounded-2xl mb-6">
          {([
            { id: "compress", label: "Compressor", icon: "M19 14l-7 7m0 0l-7-7m7 7V3" },
            { id: "split",    label: "Splitter",   icon: "M12 2v20M2 12h20" },
          ] as const).map(({ id, label, icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-all duration-300 ${
                tab === id ? "grad-bg text-white shadow-lg shadow-violet-500/25" : "text-white/30 hover:text-white/60"
              }`}>
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d={icon}/>
              </svg>
              {label}
            </button>
          ))}
        </div>

        {/* Panel */}
        {tab === "compress" ? <CompressPanel /> : <SplitPanel />}

        {/* Footer note */}
        <p className="text-center text-[11px] text-white/15 mt-8">
          Video processes locally in your browser · nothing is uploaded
        </p>
      </div>
    </div>
  );
}
