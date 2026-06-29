import { Router } from "express";
import multer from "multer";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { jobs } from "../shared-jobs.js";

const router = Router();

const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (_req, file, cb) => cb(null, `wm-${randomUUID()}${path.extname(file.originalname) || ".mp4"}`),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

function cleanup(...files: string[]) { for (const f of files) fs.unlink(f, () => {}); }

// Position expressions
const POS: Record<string, { x: string; y: string }> = {
  "top-left":     { x: "20",            y: "20" },
  "top-right":    { x: "w-tw-20",       y: "20" },
  "bottom-left":  { x: "20",            y: "h-th-20" },
  "bottom-right": { x: "w-tw-20",       y: "h-th-20" },
  "center":       { x: "(w-tw)/2",      y: "(h-th)/2" },
};

const SIZE: Record<string, number> = { small: 22, medium: 38, large: 58 };

router.post("/watermark-video", (req, res) => {
  upload.single("video")(req, res, (err) => {
    if (err) { if (!res.headersSent) res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: "No video file provided" }); return; }

    const text       = ((req.body.text as string) ?? "VideoTools").slice(0, 80).replace(/['"\\:]/g, " ");
    const position   = (req.body.position  as string) ?? "bottom-right";
    const size       = (req.body.size      as string) ?? "medium";
    const opacity    = Math.min(1, Math.max(0.1, parseFloat(req.body.opacity ?? "0.7")));

    const pos        = POS[position] ?? POS["bottom-right"];
    const fontsize   = SIZE[size] ?? SIZE.medium;
    const inputPath  = req.file.path;
    const outputPath = path.join(os.tmpdir(), `wm-out-${randomUUID()}.mp4`);
    const jobId      = randomUUID();
    const basename   = path.basename(req.file.originalname, path.extname(req.file.originalname));

    // drawtext filter — uses FFmpeg's built-in font (no fontconfig needed)
    const drawtext = [
      `text=${text}`,
      `fontsize=${fontsize}`,
      `fontcolor=white@${opacity}`,
      `x=${pos.x}`,
      `y=${pos.y}`,
      `box=1`,
      `boxcolor=black@${(opacity * 0.5).toFixed(2)}`,
      `boxborderw=8`,
    ].join(":");

    jobs.set(jobId, { status: "running", originalSize: req.file.size, basename, mimeType: "video/mp4", ext: "mp4" });
    res.json({ jobId });

    const ff = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      "-vf", `drawtext=${drawtext}`,
      "-c:v", "libx264", "-preset", "fast", "-crf", "22",
      "-c:a", "copy",
      outputPath,
    ]);

    let stderr = "";
    ff.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });

    ff.on("close", (code) => {
      cleanup(inputPath);
      const job = jobs.get(jobId);
      if (!job) return;
      if (code !== 0) {
        req.log.error({ stderr: stderr.slice(-500) }, "ffmpeg watermark failed");
        cleanup(outputPath);
        job.status = "error"; job.error = "Watermark failed";
        return;
      }
      try {
        const stat = fs.statSync(outputPath);
        job.status = "done"; job.outputPath = outputPath; job.outputSize = stat.size;
      } catch {
        cleanup(outputPath);
        job.status = "error"; job.error = "Failed to read output";
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

export default router;
