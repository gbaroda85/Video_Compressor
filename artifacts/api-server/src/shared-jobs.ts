import fs from "fs";

export interface Job {
  status:       "running" | "done" | "error";
  outputPath?:  string;
  originalSize: number;
  outputSize?:  number;
  basename:     string;
  error?:       string;
  mimeType:     string;
  ext:          string;
}

export const jobs = new Map<string, Job>();

function cleanup(...files: string[]) {
  for (const f of files) fs.unlink(f, () => {});
}

// Sweep completed jobs every 5 minutes
setInterval(() => {
  for (const [id, job] of jobs) {
    if (job.status !== "running") {
      if (job.outputPath) cleanup(job.outputPath);
      jobs.delete(id);
    }
  }
}, 5 * 60 * 1000);
