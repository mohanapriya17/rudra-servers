import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  GetObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { RudraError } from "@rudra/errors";

export interface CreateUploadUrlInput {
  objectKey: string;
  mimeType: string;
  expiresInSeconds?: number;
}

export interface CreateDownloadUrlInput {
  objectKey: string;
  expiresInSeconds?: number;
}

export interface StorageProvider {
  createUploadUrl(input: CreateUploadUrlInput): Promise<{ uploadUrl: string; expiresAt: string }>;
  createDownloadUrl(input: CreateDownloadUrlInput): Promise<{ downloadUrl: string; expiresAt: string }>;
  delete(objectKey: string): Promise<void>;
  exists(objectKey: string): Promise<boolean>;
  getMetadata(objectKey: string): Promise<{ contentType?: string; contentLength?: number }>;
}

export interface S3CompatibleOptions {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle?: boolean;
}

export class S3CompatibleStorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3CompatibleOptions) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      region: options.region,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? Boolean(options.endpoint),
      credentials: {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
      },
    });
  }

  async createUploadUrl(input: CreateUploadUrlInput) {
    const expiresIn = input.expiresInSeconds ?? 900;
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
      ContentType: input.mimeType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn });
    return {
      uploadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async createDownloadUrl(input: CreateDownloadUrlInput) {
    const expiresIn = input.expiresInSeconds ?? 900;
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: input.objectKey,
    });
    const downloadUrl = await getSignedUrl(this.client, command, { expiresIn });
    return {
      downloadUrl,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    };
  }

  async delete(objectKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
      }),
    );
  }

  async exists(objectKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async getMetadata(objectKey: string) {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: objectKey,
        }),
      );
      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
      };
    } catch (error) {
      throw new RudraError("NOT_FOUND", "Object not found", { cause: error });
    }
  }
}

export function createR2Provider(options: S3CompatibleOptions): StorageProvider {
  return new S3CompatibleStorageProvider(options);
}
