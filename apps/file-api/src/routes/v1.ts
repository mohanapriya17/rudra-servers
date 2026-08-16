import { Router } from "express";
import { fileUploadUrlSchema } from "@rudra/contracts";
import type { FileStore } from "../store/files.js";

function data<T>(value: T) {
  return { data: value };
}

export function createFileRouter(store: FileStore): Router {
  const router = Router();

  router.post("/upload-url", async (req, res, next) => {
    try {
      const body = fileUploadUrlSchema.parse(req.body);
      const result = await store.createUpload(body);
      res.status(201).json(data(result));
    } catch (error) {
      next(error);
    }
  });

  router.post("/:fileId/complete", async (req, res, next) => {
    try {
      res.json(data(await store.complete(req.params.fileId!)));
    } catch (error) {
      next(error);
    }
  });

  router.get("/:fileId/download-url", async (req, res, next) => {
    try {
      const result = await store.downloadUrl(req.params.fileId!);
      res.json(data(result));
    } catch (error) {
      next(error);
    }
  });

  router.get("/", (req, res) => {
    const applicationId = typeof req.query.applicationId === "string" ? req.query.applicationId : undefined;
    const environmentId = typeof req.query.environmentId === "string" ? req.query.environmentId : undefined;
    res.json(data(store.list({ applicationId, environmentId })));
  });

  router.get("/:fileId", async (req, res, next) => {
    try {
      res.json(data(await store.get(req.params.fileId!)));
    } catch (error) {
      next(error);
    }
  });

  router.delete("/:fileId", async (req, res, next) => {
    try {
      await store.delete(req.params.fileId!);
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  return router;
}
