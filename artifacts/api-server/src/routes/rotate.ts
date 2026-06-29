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
  filename: (_req, file, cb) => cb(null, `rot-${randomUUID()}${path.extname(file.originalname) || ".mp4"}`),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

function cleanup(...files: string[]) { for (const f of files) fs.unlink(f, () => {}); }

// direction: "cw90" | "ccw90" | "180"
const TRANSPOSE: Record<string, string[]> = {
  cw90:  ["-vf", "transpose=1"],
  ccw90: ["-vf", "transpose=2"],
  "180": ["-vf", "hflip,vflip"],
};

router.post("/rotate-video", (req, res) => {
  upload.single("video")(req, res, (err) => {
    if (err) { if (!res.headersSent) res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: "No video file provided" }); return; }

    const direction   = (req.body.direction as string) ?? "cw90";
    const vfArgs      = TRANSPOSE[direction] ?? TRANSPOSE.cw90;
    const inputPath   = req.file.path;
    const outputPath  = path.join(os.tmpdir(), `rot-out-${randomUUID()}.mp4`);
    const jobId       = randomUUID();
    const basename    = path.basename(req.file.originalname, path.extname(req.file.originalname));

    jobs.set(jobId, { status: "running", originalSize: req.file.size, basename, mimeType: "video/mp4", ext: "mp4" });
    res.json({ jobId });

    const ff = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      ...vfArgs,
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
        req.log.error({ stderr: stderr.slice(-500) }, "ffmpeg rotate failed");
        cleanup(outputPath);
        job.status = "error"; job.error = "Rotation failed";
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
