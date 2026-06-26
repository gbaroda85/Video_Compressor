import { Router } from "express";
import multer from "multer";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const router = Router();

const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || ".mp4";
    cb(null, `vc-${randomUUID()}${ext}`);
  },
});

const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

const CRF: Record<string, string> = { high: "23", medium: "28", low: "36" };

function cleanup(...files: string[]) {
  for (const f of files) fs.unlink(f, () => {});
}

// In-memory job store
interface Job {
  status: "running" | "done" | "error";
  outputPath?: string;
  originalSize: number;
  outputSize?: number;
  basename: string;
  error?: string;
}
const jobs = new Map<string, Job>();

// Clean up jobs older than 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.status !== "running") {
      if (job.outputPath) cleanup(job.outputPath);
      jobs.delete(id);
    }
  }
  void cutoff;
}, 5 * 60 * 1000);

// ── POST /api/compress ── starts job, returns jobId immediately ───────────────
router.post("/compress", (req, res) => {
  upload.single("video")(req, res, (uploadErr) => {
    if (uploadErr) {
      if (!res.headersSent) res.status(400).json({ error: uploadErr.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const quality    = (req.body.quality as string) ?? "medium";
    const crf        = CRF[quality] ?? CRF.medium;
    const inputPath  = req.file.path;
    const outputPath = path.join(os.tmpdir(), `vc-out-${randomUUID()}.mp4`);
    const jobId      = randomUUID();
    const basename   = path.basename(req.file.originalname, path.extname(req.file.originalname));

    jobs.set(jobId, { status: "running", originalSize: req.file.size, basename });

    // Return job ID immediately — client will poll
    res.json({ jobId });

    const ff = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      "-vcodec", "libx264",
      "-crf", crf,
      "-preset", "ultrafast",
      "-acodec", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      outputPath,
    ]);

    let stderr = "";
    ff.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });

    ff.on("close", (code) => {
      cleanup(inputPath);
      const job = jobs.get(jobId);
      if (!job) return;
      if (code !== 0) {
        req.log.error({ stderr: stderr.slice(-600) }, "ffmpeg compress failed");
        cleanup(outputPath);
        job.status = "error";
        job.error  = "Compression failed";
        return;
      }
      try {
        const stat = fs.statSync(outputPath);
        job.status     = "done";
        job.outputPath = outputPath;
        job.outputSize = stat.size;
      } catch {
        job.status = "error";
        job.error  = "Failed to read output";
        cleanup(outputPath);
      }
    });

    ff.on("error", (err) => {
      req.log.error({ err }, "ffmpeg spawn error");
      cleanup(inputPath);
      const job = jobs.get(jobId);
      if (job) { job.status = "error"; job.error = "Processing not available"; }
    });
  });
});

// ── GET /api/job/:id ── poll status ───────────────────────────────────────────
router.get("/job/:id", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }
  res.json({
    status:       job.status,
    originalSize: job.originalSize,
    outputSize:   job.outputSize,
    error:        job.error,
  });
});

// ── GET /api/job/:id/download ── serve result file ────────────────────────────
router.get("/job/:id/download", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "done" || !job.outputPath) {
    res.status(404).json({ error: "File not ready" });
    return;
  }
  try {
    const stat = fs.statSync(job.outputPath);
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${job.basename}_compressed.mp4"`);
    res.setHeader("Content-Length", String(stat.size));
    res.setHeader("X-Original-Size",    String(job.originalSize));
    res.setHeader("X-Compressed-Size",  String(stat.size));
    const stream = fs.createReadStream(job.outputPath);
    stream.pipe(res);
    stream.on("close",  () => { cleanup(job.outputPath!); jobs.delete(req.params.id); });
    stream.on("error",  () => { if (!res.headersSent) res.status(500).json({ error: "Read error" }); });
  } catch {
    res.status(500).json({ error: "File not available" });
  }
});

// ── POST /api/split ───────────────────────────────────────────────────────────
router.post("/split", (req, res) => {
  upload.single("video")(req, res, (uploadErr) => {
    if (uploadErr) {
      if (!res.headersSent) res.status(400).json({ error: uploadErr.message });
      return;
    }
    if (!req.file) { res.status(400).json({ error: "No video file provided" }); return; }

    const startTime = parseFloat(req.body.startTime ?? "0");
    const endTime   = parseFloat(req.body.endTime   ?? "0");
    if (!isFinite(startTime) || !isFinite(endTime) || endTime <= startTime) {
      cleanup(req.file.path);
      res.status(400).json({ error: "Invalid start/end time" });
      return;
    }

    const inputPath  = req.file.path;
    const outputPath = path.join(os.tmpdir(), `vc-split-${randomUUID()}.mp4`);

    const ff = spawn("ffmpeg", [
      "-y",
      "-ss", String(startTime),
      "-i",  inputPath,
      "-to", String(endTime - startTime),
      "-c",  "copy",
      outputPath,
    ]);

    let stderr = "";
    ff.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    req.on("close", () => { if (!res.writableEnded) ff.kill("SIGKILL"); });

    ff.on("close", (code) => {
      cleanup(inputPath);
      if (code !== 0) {
        req.log.error({ stderr: stderr.slice(-500) }, "ffmpeg split failed");
        cleanup(outputPath);
        if (!res.headersSent) res.status(500).json({ error: "Split failed" });
        return;
      }
      try {
        const stat = fs.statSync(outputPath);
        const base = path.basename(req.file!.originalname, path.extname(req.file!.originalname));
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", `attachment; filename="${base}_clip.mp4"`);
        res.setHeader("Content-Length", String(stat.size));
        res.setHeader("X-Original-Size",   String(req.file!.size));
        res.setHeader("X-Compressed-Size", String(stat.size));
        const stream = fs.createReadStream(outputPath);
        stream.pipe(res);
        stream.on("close", () => cleanup(outputPath));
        stream.on("error", () => cleanup(outputPath));
      } catch {
        cleanup(outputPath);
        if (!res.headersSent) res.status(500).json({ error: "Failed to read output" });
      }
    });

    ff.on("error", (err) => {
      req.log.error({ err }, "ffmpeg split spawn error");
      cleanup(inputPath, outputPath);
      if (!res.headersSent) res.status(500).json({ error: "Processing not available" });
    });
  });
});

export default router;
