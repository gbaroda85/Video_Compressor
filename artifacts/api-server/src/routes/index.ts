import { Router, type IRouter } from "express";
import fs from "fs";
import healthRouter   from "./health.js";
import compressRouter from "./compress.js";
import audioRouter    from "./audio.js";
import muteRouter     from "./mute.js";
import rotateRouter   from "./rotate.js";
import watermarkRouter from "./watermark.js";
import { jobs } from "../shared-jobs.js";

const router: IRouter = Router();

router.use(healthRouter);
router.use(compressRouter);
router.use(audioRouter);
router.use(muteRouter);
router.use(rotateRouter);
router.use(watermarkRouter);

// ── Central job poll ──────────────────────────────────────────────────────────
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

// ── Central job download ──────────────────────────────────────────────────────
router.get("/job/:id/download", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || job.status !== "done" || !job.outputPath) {
    res.status(404).json({ error: "File not ready" });
    return;
  }
  try {
    const stat = fs.statSync(job.outputPath);
    res.setHeader("Content-Type",        job.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename="${job.basename}_${job.ext === "mp3" ? "audio" : "output"}.${job.ext}"`);
    res.setHeader("Content-Length",      String(stat.size));
    res.setHeader("X-Original-Size",     String(job.originalSize));
    res.setHeader("X-Compressed-Size",   String(stat.size));
    const stream = fs.createReadStream(job.outputPath);
    stream.pipe(res);
    stream.on("close", () => {
      fs.unlink(job.outputPath!, () => {});
      jobs.delete(req.params.id);
    });
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).json({ error: "Read error" });
    });
  } catch {
    res.status(500).json({ error: "File not available" });
  }
});

export default router;
