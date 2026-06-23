import { Router } from "express";
import multer from "multer";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: os.tmpdir(),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || ".mp4";
      cb(null, `vc-in-${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

const CRF_MAP: Record<string, string> = {
  high: "23",
  medium: "32",
  low: "40",
};

router.post("/compress", upload.single("video"), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "No video file provided" });
    return;
  }

  const quality = (req.body.quality as string) || "medium";
  const crf = CRF_MAP[quality] ?? CRF_MAP.medium;
  const inputPath = req.file.path;
  const outputPath = path.join(os.tmpdir(), `vc-out-${randomUUID()}.mp4`);

  const args = [
    "-y",
    "-i", inputPath,
    "-vcodec", "libx264",
    "-crf", crf,
    "-preset", "fast",
    "-acodec", "aac",
    "-b:a", "128k",
    "-movflags", "+faststart",
    outputPath,
  ];

  const ff = spawn("ffmpeg", args);

  let stderr = "";
  ff.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  ff.on("close", (code) => {
    fs.unlink(inputPath, () => {});

    if (code !== 0) {
      req.log.error({ stderr }, "ffmpeg failed");
      fs.unlink(outputPath, () => {});
      res.status(500).json({ error: "Compression failed" });
      return;
    }

    const stat = fs.statSync(outputPath);
    const originalName = path.basename(
      req.file!.originalname,
      path.extname(req.file!.originalname),
    );

    res.setHeader("Content-Type", "video/mp4");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${originalName}_compressed.mp4"`,
    );
    res.setHeader("Content-Length", stat.size);
    res.setHeader("X-Original-Size", String(req.file!.size));
    res.setHeader("X-Compressed-Size", String(stat.size));

    const stream = fs.createReadStream(outputPath);
    stream.pipe(res);
    stream.on("close", () => {
      fs.unlink(outputPath, () => {});
    });
  });

  ff.on("error", (err) => {
    req.log.error({ err }, "ffmpeg spawn error");
    fs.unlink(inputPath, () => {});
    fs.unlink(outputPath, () => {});
    res.status(500).json({ error: "Failed to start compression" });
  });
});

export default router;
