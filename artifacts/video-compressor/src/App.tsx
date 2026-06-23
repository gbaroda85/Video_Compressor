import { useState, useRef, useCallback } from "react";

type CompressionQuality = "low" | "medium" | "high";
type Stage = "idle" | "ready" | "uploading" | "compressing" | "done" | "error";

interface VideoFile {
  file: File;
  url: string;
  size: number;
  name: string;
  duration?: number;
}

interface CompressedResult {
  url: string;
  size: number;
  originalSize: number;
}

const QUALITY_MAP: Record<CompressionQuality, { label: string; desc: string }> = {
  high:   { label: "High Quality",  desc: "~60-80% smaller, great quality" },
  medium: { label: "Balanced",      desc: "~75-90% smaller, good quality" },
  low:    { label: "Max Compress",  desc: "~90-95% smaller, lower quality" },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function App() {
  const [stage, setStage] = useState<Stage>("idle");
  const [video, setVideo] = useState<VideoFile | null>(null);
  const [result, setResult] = useState<CompressedResult | null>(null);
  const [quality, setQuality] = useState<CompressionQuality>("medium");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const resultFilename = useRef<string>("");

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("video/")) {
      setError("Please select a valid video file.");
      return;
    }
    const url = URL.createObjectURL(file);
    setVideo({ file, url, size: file.size, name: file.name });
    setResult(null);
    setError("");
    setUploadProgress(0);
    setStage("ready");

    const tempVid = document.createElement("video");
    tempVid.src = url;
    tempVid.onloadedmetadata = () => {
      setVideo(v => v ? { ...v, duration: tempVid.duration } : v);
    };
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const compress = useCallback(() => {
    if (!video) return;

    setStage("uploading");
    setUploadProgress(0);
    setError("");

    const formData = new FormData();
    formData.append("video", video.file);
    formData.append("quality", quality);

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        setUploadProgress(pct);
        if (pct === 100) setStage("compressing");
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        const blob = new Blob([xhr.response], { type: "video/mp4" });
        const url = URL.createObjectURL(blob);
        const originalSize = Number(xhr.getResponseHeader("X-Original-Size")) || video.size;
        const compressedSize = Number(xhr.getResponseHeader("X-Compressed-Size")) || blob.size;
        setResult({ url, size: compressedSize, originalSize });
        setStage("done");
      } else {
        let msg = "Compression failed on server.";
        try {
          const json = JSON.parse(xhr.responseText);
          if (json.error) msg = json.error;
        } catch {}
        setError(msg);
        setStage("ready");
      }
    };

    xhr.onerror = () => {
      setError("Upload failed. Check your connection and try again.");
      setStage("ready");
    };

    xhr.onabort = () => {
      setStage("ready");
    };

    xhr.responseType = "arraybuffer";
    xhr.open("POST", "/api/compress");
    xhr.send(formData);
  }, [video, quality]);

  const cancel = () => {
    xhrRef.current?.abort();
    setUploadProgress(0);
  };

  const downloadResult = () => {
    if (!result || !video) return;
    const a = document.createElement("a");
    a.href = result.url;
    const base = video.name.replace(/\.[^.]+$/, "");
    a.download = resultFilename.current || `${base}_compressed.mp4`;
    a.click();
  };

  const reset = () => {
    xhrRef.current?.abort();
    setVideo(null);
    setResult(null);
    setError("");
    setUploadProgress(0);
    setStage("idle");
    if (inputRef.current) inputRef.current.value = "";
  };

  const reduction = result
    ? Math.round((1 - result.size / result.originalSize) * 100)
    : null;

  const isProcessing = stage === "uploading" || stage === "compressing";

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center py-10 px-4">
      {/* Header */}
      <div className="mb-10 text-center">
        <div className="inline-flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="2"/>
              <path d="M10 9l5 3-5 3V9z"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">Video Compressor</h1>
        </div>
        <p className="text-muted-foreground text-sm max-w-md mx-auto">
          Real server-side compression using FFmpeg — fast, reliable, works on any device
        </p>
      </div>

      <div className="w-full max-w-2xl space-y-5">

        {/* Drop Zone */}
        {!video && (
          <div
            onDrop={handleDrop}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onClick={() => inputRef.current?.click()}
            className={`relative border-2 border-dashed rounded-2xl cursor-pointer transition-all duration-200 flex flex-col items-center justify-center gap-4 py-16 px-8
              ${dragging
                ? "border-primary bg-primary/10 scale-[1.01]"
                : "border-border hover:border-primary/60 hover:bg-card"}`}
          >
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-colors ${dragging ? "bg-primary/30" : "bg-muted"}`}>
              <svg className={`w-8 h-8 transition-colors ${dragging ? "text-primary" : "text-muted-foreground"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>
              </svg>
            </div>
            <div className="text-center">
              <p className="text-base font-medium">{dragging ? "Drop to load" : "Drop video here"}</p>
              <p className="text-sm text-muted-foreground mt-1">or click to browse • MP4, MOV, AVI, MKV, WebM</p>
            </div>
            <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={e => handleFiles(e.target.files)} />
          </div>
        )}

        {/* Video Info Card */}
        {video && (
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center flex-shrink-0">
                <svg className="w-6 h-6 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="6" width="20" height="12" rx="2"/>
                  <path d="M10 9l5 3-5 3V9z"/>
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{video.name}</p>
                <div className="flex gap-3 mt-1 text-sm text-muted-foreground flex-wrap">
                  <span>{formatBytes(video.size)}</span>
                  {video.duration && <span>{formatDuration(video.duration)}</span>}
                </div>
              </div>
              {!isProcessing && (
                <button onClick={reset} className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-lg hover:bg-muted">
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              )}
            </div>
            <video src={video.url} controls className="w-full rounded-xl max-h-48 object-contain bg-black" />
          </div>
        )}

        {/* Quality Settings */}
        {(stage === "ready" || stage === "done") && video && (
          <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Compression Quality</p>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(QUALITY_MAP) as CompressionQuality[]).map(q => {
                const { label, desc } = QUALITY_MAP[q];
                const active = quality === q;
                return (
                  <button
                    key={q}
                    onClick={() => setQuality(q)}
                    className={`rounded-xl p-3 text-left transition-all border ${
                      active ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-foreground hover:border-primary/40"
                    }`}
                  >
                    <p className="text-xs font-semibold">{label}</p>
                    <p className={`text-[10px] mt-0.5 leading-tight ${active ? "text-primary/70" : "text-muted-foreground"}`}>{desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Compress Button */}
        {stage === "ready" && video && (
          <button
            onClick={compress}
            className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-semibold text-base hover:opacity-90 active:scale-[0.98] transition-all"
          >
            Compress Video
          </button>
        )}

        {/* Progress */}
        {isProcessing && (
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-sm">
                  {stage === "uploading" ? "Uploading..." : "Compressing with FFmpeg..."}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {stage === "uploading"
                    ? `${uploadProgress}% uploaded`
                    : "Server is processing your video"}
                </p>
              </div>
              {stage === "uploading" && (
                <span className="text-primary font-bold text-sm">{uploadProgress}%</span>
              )}
              {stage === "compressing" && (
                <div className="w-6 h-6 rounded-full border-2 border-primary border-t-transparent animate-spin"/>
              )}
            </div>

            {stage === "uploading" && (
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            )}

            {stage === "compressing" && (
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full animate-pulse" style={{ width: "90%" }} />
              </div>
            )}

            <button
              onClick={cancel}
              className="text-xs text-muted-foreground hover:text-foreground underline transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Result */}
        {stage === "done" && result && video && (
          <div className="bg-card border border-border rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                <svg className="w-3.5 h-3.5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M20 6L9 17l-5-5"/>
                </svg>
              </div>
              <p className="font-semibold text-green-400">Compression Complete</p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-muted/40 rounded-xl p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Original</p>
                <p className="text-base font-bold mt-1">{formatBytes(result.originalSize)}</p>
              </div>
              <div className="bg-primary/10 rounded-xl p-3 text-center border border-primary/20">
                <p className="text-[10px] text-primary/70 uppercase tracking-wide">Saved</p>
                <p className="text-base font-bold text-primary mt-1">{reduction}%</p>
              </div>
              <div className="bg-muted/40 rounded-xl p-3 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Compressed</p>
                <p className="text-base font-bold mt-1">{formatBytes(result.size)}</p>
              </div>
            </div>

            <video src={result.url} controls className="w-full rounded-xl max-h-48 object-contain bg-black" />

            <div className="flex gap-3">
              <button
                onClick={downloadResult}
                className="flex-1 py-3 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Download MP4
              </button>
              <button
                onClick={() => { setResult(null); setStage("ready"); }}
                className="px-5 py-3 rounded-xl border border-border text-sm font-medium hover:bg-muted transition-colors"
              >
                Re-compress
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 flex items-start gap-3">
            <svg className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>
            </svg>
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {/* How it works */}
        <div className="bg-card border border-border rounded-2xl p-5 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">How it works</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: "⬆️", title: "Upload",    desc: "Send video to compression server" },
              { icon: "⚡", title: "FFmpeg",    desc: "Real H.264 encoding on server" },
              { icon: "💾", title: "Download",  desc: "Get the compressed MP4 file" },
            ].map(({ icon, title, desc }) => (
              <div key={title} className="text-center space-y-1.5">
                <div className="text-2xl">{icon}</div>
                <p className="text-xs font-semibold">{title}</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
