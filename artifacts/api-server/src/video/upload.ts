import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { uploadDir } from "./worker";

// Shared multer instance: files land on disk under `VIDEO_UPLOAD_DIR` (tests
// point it at a tmp dir). Used by the vault upload route (single "file") and
// the interchange import route (optional "media" array).
export const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const dir = uploadDir();
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).slice(0, 12);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 * 1024 }, // 10 GB cap for raw footage
});
