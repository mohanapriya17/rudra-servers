import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { FileStore, MemoryStorageProvider } from "./store/files.js";

describe("file-api", () => {
  const store = new FileStore(new MemoryStorageProvider(), "memory", "rudra-files");
  const { app } = createApp({ store });

  it("upload-url -> complete -> download-url -> delete", async () => {
    const upload = await request(app).post("/api/v1/files/upload-url").send({
      fileName: "resume.pdf",
      mimeType: "application/pdf",
      size: 240000,
      visibility: "private",
      applicationId: "app1",
    });
    expect(upload.status).toBe(201);
    expect(upload.body.data.uploadUrl).toContain("memory://upload/");

    const complete = await request(app).post(`/api/v1/files/${upload.body.data.fileId}/complete`);
    expect(complete.status).toBe(200);
    expect(complete.body.data.status).toBe("ready");

    const download = await request(app).get(
      `/api/v1/files/${upload.body.data.fileId}/download-url`,
    );
    expect(download.status).toBe(200);
    expect(download.body.data.downloadUrl).toContain("memory://download/");

    const meta = await request(app).get(`/api/v1/files/${upload.body.data.fileId}`);
    expect(meta.body.data.originalName).toBe("resume.pdf");

    const del = await request(app).delete(`/api/v1/files/${upload.body.data.fileId}`);
    expect(del.status).toBe(204);
  });
});
