import { randomUUID } from "node:crypto";
import { RudraError } from "@rudra/errors";
import type { StorageProvider } from "@rudra/storage-driver";

export interface FileRecord {
  id: string;
  applicationId: string | null;
  environmentId: string | null;
  provider: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  size: number;
  visibility: "private" | "public";
  checksum: string | null;
  metadata: Record<string, unknown>;
  status: "pending" | "ready";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export class MemoryStorageProvider implements StorageProvider {
  private objects = new Map<string, { body: Buffer; contentType: string }>();

  async createUploadUrl(input: { objectKey: string; mimeType: string; expiresInSeconds?: number }) {
    const expiresIn = input.expiresInSeconds ?? 900;
    const token = randomUUID();
    const uploadUrl = `memory://upload/${encodeURIComponent(input.objectKey)}?token=${token}`;
    // Store placeholder so complete can succeed in tests without real bytes
    this.objects.set(input.objectKey, { body: Buffer.alloc(0), contentType: input.mimeType });
    return {
      uploadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async createDownloadUrl(input: { objectKey: string; expiresInSeconds?: number }) {
    if (!this.objects.has(input.objectKey)) {
      throw new RudraError("NOT_FOUND", "Object not found");
    }
    const expiresIn = input.expiresInSeconds ?? 900;
    return {
      downloadUrl: `memory://download/${encodeURIComponent(input.objectKey)}`,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async delete(objectKey: string): Promise<void> {
    this.objects.delete(objectKey);
  }

  async exists(objectKey: string): Promise<boolean> {
    return this.objects.has(objectKey);
  }

  async getMetadata(objectKey: string) {
    const obj = this.objects.get(objectKey);
    if (!obj) throw new RudraError("NOT_FOUND", "Object not found");
    return { contentType: obj.contentType, contentLength: obj.body.length };
  }
}

export class FileStore {
  private files = new Map<string, FileRecord>();

  constructor(
    private readonly provider: StorageProvider,
    private readonly providerName: string,
    private readonly bucket: string,
  ) {}

  getProvider(): StorageProvider {
    return this.provider;
  }

  async createUpload(input: {
    fileName: string;
    mimeType: string;
    size: number;
    visibility: "private" | "public";
    applicationId?: string;
    environmentId?: string;
    metadata?: Record<string, unknown>;
    createdBy?: string;
  }) {
    const id = randomUUID();
    const objectKey = `${input.applicationId ?? "app"}/${id}/${input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const upload = await this.provider.createUploadUrl({
      objectKey,
      mimeType: input.mimeType,
    });
    const ts = new Date().toISOString();
    const record: FileRecord = {
      id,
      applicationId: input.applicationId ?? null,
      environmentId: input.environmentId ?? null,
      provider: this.providerName,
      bucket: this.bucket,
      objectKey,
      originalName: input.fileName,
      mimeType: input.mimeType,
      size: input.size,
      visibility: input.visibility,
      checksum: null,
      metadata: input.metadata ?? {},
      status: "pending",
      createdBy: input.createdBy ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.files.set(id, record);
    return {
      fileId: id,
      uploadUrl: upload.uploadUrl,
      expiresAt: upload.expiresAt,
      objectKey,
    };
  }

  async complete(fileId: string): Promise<FileRecord> {
    const file = this.files.get(fileId);
    if (!file) throw new RudraError("NOT_FOUND", "File not found");
    const exists = await this.provider.exists(file.objectKey);
    if (!exists) throw new RudraError("VALIDATION_ERROR", "Upload not found in storage");
    file.status = "ready";
    file.updatedAt = new Date().toISOString();
    return file;
  }

  async get(fileId: string): Promise<FileRecord> {
    const file = this.files.get(fileId);
    if (!file) throw new RudraError("NOT_FOUND", "File not found");
    return file;
  }

  list(filter?: { applicationId?: string; environmentId?: string }): FileRecord[] {
    return [...this.files.values()].filter((file) => {
      if (filter?.applicationId && file.applicationId !== filter.applicationId) return false;
      if (filter?.environmentId && file.environmentId !== filter.environmentId) return false;
      return true;
    });
  }

  async downloadUrl(fileId: string) {
    const file = await this.get(fileId);
    if (file.status !== "ready") {
      throw new RudraError("VALIDATION_ERROR", "File upload not completed");
    }
    return this.provider.createDownloadUrl({ objectKey: file.objectKey });
  }

  async delete(fileId: string): Promise<void> {
    const file = await this.get(fileId);
    await this.provider.delete(file.objectKey);
    this.files.delete(fileId);
  }
}
