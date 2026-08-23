import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { RudraError } from "@rudra/errors";
import { MemoryRateLimiter } from "@rudra/rate-limit";
import type { AuthVerifier } from "../auth/firebase.js";
import { requireAuth, type AuthedRequest } from "../middleware/require-auth.js";
import {
  MAX_ROWS_PER_USER,
  parseDataFile,
  parseJsonData,
  type DataRow,
} from "../parse/data.js";
import { renderPdfBatch } from "../pdf/render.js";
import { zipBuffers } from "../zip/create.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 2,
  },
});

const jsonBodySchema = z.object({
  template: z.string().min(1).max(200_000).optional(),
  data: z.unknown().optional(),
  fileNamePrefix: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
});

export function createPdfRouter(options: {
  auth: AuthVerifier;
  /** Max generate calls per user per window (default 10 / hour). */
  jobLimiter?: MemoryRateLimiter;
}): Router {
  const router = Router();
  const jobLimiter =
    options.jobLimiter ??
    new MemoryRateLimiter({ windowMs: 60 * 60 * 1000, max: 10 });

  router.post(
    "/generate",
    requireAuth(options.auth),
    upload.fields([
      { name: "template", maxCount: 1 },
      { name: "data", maxCount: 1 },
      { name: "dataFile", maxCount: 1 },
    ]),
    async (req, res, next) => {
      try {
        const user = (req as AuthedRequest).user;
        if (!user) throw new RudraError("UNAUTHORIZED", "Authentication required");

        jobLimiter.consume(`pdf-generate:${user.uid}`);

        const files = req.files as
          | Record<string, Express.Multer.File[] | undefined>
          | undefined;
        const templateFile = files?.template?.[0];
        const dataFile = files?.data?.[0] ?? files?.dataFile?.[0];

        const body = jsonBodySchema.parse(req.body ?? {});
        const templateSource =
          templateFile?.buffer.toString("utf8") ??
          (typeof body.template === "string" ? body.template : null);

        if (!templateSource?.trim()) {
          throw new RudraError(
            "VALIDATION_ERROR",
            "Provide a PDF template via multipart field `template` or JSON field `template`",
          );
        }

        let rows: DataRow[];
        if (dataFile) {
          rows = parseDataFile(dataFile);
        } else if (body.data !== undefined) {
          rows = parseJsonData(body.data);
        } else if (typeof req.body?.dataJson === "string") {
          rows = parseJsonData(req.body.dataJson);
        } else {
          throw new RudraError(
            "VALIDATION_ERROR",
            "Provide input data via multipart `data`/`dataFile` (.json/.csv/.xlsx) or JSON `data`",
          );
        }

        const pdfs = await renderPdfBatch(templateSource, rows);
        const prefix = body.fileNamePrefix ?? "document";
        const named = pdfs.map((file, index) => ({
          fileName: `${prefix}-${String(index + 1).padStart(3, "0")}.pdf`,
          buffer: file.buffer,
        }));
        const zip = await zipBuffers(named);

        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${prefix}-pdfs.zip"`,
        );
        res.setHeader("X-Rudra-Row-Count", String(rows.length));
        res.setHeader("X-Rudra-Row-Limit", String(MAX_ROWS_PER_USER));
        res.setHeader("X-Rudra-User-Id", user.uid);
        res.status(200).send(zip);
      } catch (error) {
        next(error);
      }
    },
  );

  router.get("/limits", requireAuth(options.auth), (_req, res) => {
    res.json({
      data: {
        maxRowsPerRequest: MAX_ROWS_PER_USER,
        maxGenerateJobsPerHour: 10,
        acceptedDataFormats: ["json", "csv", "xlsx", "xls"],
        acceptedTemplateFormats: ["txt", "hbs", "html", "raw string"],
      },
    });
  });

  return router;
}
