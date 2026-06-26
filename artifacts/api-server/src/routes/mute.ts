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
  filename: (_req, file, cb) => cb(null, `vm-${randomUUID()}${path.extname(file.originalname) || ".mp4"}`),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 * 1024 } });

function cleanup(...files: string[]) { for (const f of files) fs.unlink(f, () => {}); }

router.post("/mute-video", (req, res) => {
  upload.single("video")(req, res, (err) => {
    if (err) { if (!res.headersSent) res.status(400).json({ error: err.message }); return; }
    if (!req.file) { res.status(400).json({ error: "No video file provided" }); return; }

    const inputPath  = req.file.path;
    const outputPath = path.join(os.tmpdir(), `vm-out-${randomUUID()}.mp4`);

    const ff = spawn("ffmpeg", [
      "-y", "-i", inputPath,
      "-c:v", "copy",  // copy video stream as-is (instant)
      "-an",           // remove audio
      outputPath,
    ]);

    let stderr = "";
    ff.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });
    req.on("close", () => { if (!res.writableEnded) ff.kill("SIGKILL"); });

    ff.on("close", (code) => {
      cleanup(inputPath);
      if (code !== 0) {
        cleanup(outputPath);
        if (!res.headersSent) res.status(500).json({ error: "Processing failed" });
        return;
      }
      try {
        const stat = fs.statSync(outputPath);
        const base = path.basename(req.file!.originalname, path.extname(req.file!.originalname));
        res.setHeader("Content-Type", "video/mp4");
        res.setHeader("Content-Disposition", `attachment; filename="${base}_muted.mp4"`);
        res.setHeader("Content-Length", String(stat.size));
        res.setHeader("X-Original-Size", String(req.file!.size));
        res.setHeader("X-Compressed-Size", String(stat.size));
        const stream = fs.createReadStream(outputPath);
        stream.pipe(res);
        stream.on("close", () => cleanup(outputPath));
      } catch {
        cleanup(outputPath);
        if (!res.headersSent) res.status(500).json({ error: "Failed to read output" });
      }
    });

    ff.on("error", () => {
      cleanup(inputPath, outputPath);
      if (!res.headersSent) res.status(500).json({ error: "Processing not available" });
    });
  });
});

export default router;
