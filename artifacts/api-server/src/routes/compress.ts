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

// ── POST /api/compress ─────────────────────────────────────────────────────────
// Streams ffmpeg output directly → response so the proxy never times out
router.post("/compress", (req, res) => {
  upload.single("video")(req, res, (uploadErr) => {
    if (uploadErr) {
      req.log.warn({ err: uploadErr.message }, "upload error");
      if (!res.headersSent) res.status(400).json({ error: uploadErr.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const quality  = (req.body.quality as string) ?? "medium";
    const crf      = CRF[quality] ?? CRF.medium;
    const inputPath = req.file.path;

    // Pipe ffmpeg stdout → HTTP response using fragmented MP4
    // -movflags frag_keyframe+empty_moov allows streaming without knowing size up-front
    const ff = spawn("ffmpeg", [
      "-y",
      "-i", inputPath,
      "-vcodec", "libx264",
      "-crf", crf,
      "-preset", "ultrafast",   // fastest encode, still good quality reduction
      "-tune", "fastdecode",
      "-acodec", "aac",
      "-b:a", "128k",
      "-movflags", "frag_keyframe+empty_moov+default_base_moof",
      "-f", "mp4",
      "pipe:1",                  // write to stdout
    ]);

    let stderr = "";
    ff.stderr.on("data", (c: Buffer) => { stderr += c.toString(); });

    const base = path.basename(req.file.originalname, path.extname(req.file.originalname));
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Content-Disposition", `attachment; filename="${base}_compressed.mp4"`);
    res.setHeader("X-Original-Size", String(req.file.size));
    res.setHeader("Transfer-Encoding", "chunked");

    let headersSent = false;
    let outputBytes = 0;

    ff.stdout.on("data", (chunk: Buffer) => {
      headersSent = true;
      outputBytes += chunk.length;
      res.write(chunk);
    });

    req.on("close", () => {
      if (!res.writableEnded) ff.kill("SIGKILL");
    });

    ff.on("close", (code) => {
      cleanup(inputPath);
      if (code !== 0) {
        req.log.error({ stderr: stderr.slice(-800) }, "ffmpeg compress failed");
        if (!headersSent && !res.headersSent) {
          res.status(500).json({ error: "Compression failed" });
        } else {
          res.end();
        }
        return;
      }
      res.setHeader("X-Compressed-Size", String(outputBytes));
      req.log.info({ quality, crf, outputBytes }, "compress done");
      res.end();
    });

    ff.on("error", (err) => {
      req.log.error({ err }, "ffmpeg spawn error");
      cleanup(inputPath);
      if (!headersSent && !res.headersSent) {
        res.status(500).json({ error: "Processing not available" });
      } else {
        res.end();
      }
    });
  });
});

// ── POST /api/split ───────────────────────────────────────────────────────────
router.post("/split", (req, res) => {
  upload.single("video")(req, res, (uploadErr) => {
    if (uploadErr) {
      req.log.warn({ err: uploadErr.message }, "upload error");
      if (!res.headersSent) res.status(400).json({ error: uploadErr.message });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No video file provided" });
      return;
    }

    const startTime = parseFloat(req.body.startTime ?? "0");
    const endTime   = parseFloat(req.body.endTime   ?? "0");
    if (!isFinite(startTime) || !isFinite(endTime) || endTime <= startTime) {
      cleanup(req.file.path);
      res.status(400).json({ error: "Invalid start/end time" });
      return;
    }

    const inputPath  = req.file.path;
    const outputPath = path.join(os.tmpdir(), `vc-split-${randomUUID()}.mp4`);

    // -c copy = stream copy, near-instant (no re-encoding needed)
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
        res.setHeader("X-Original-Size", String(req.file!.size));
        res.setHeader("X-Compressed-Size", String(stat.size));
        const stream = fs.createReadStream(outputPath);
        stream.pipe(res);
        stream.on("close", () => cleanup(outputPath));
        stream.on("error", () => cleanup(outputPath));
      } catch {
        cleanup(outputPath);
        if (!res.headersSent) res.status(500).json({ error: "Failed to read output file" });
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
