import { PassThrough } from "node:stream";
import archiver from "archiver";

export async function zipBuffers(
  files: Array<{ fileName: string; buffer: Buffer }>,
): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];

    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    archive.on("error", reject);

    archive.pipe(stream);
    for (const file of files) {
      archive.append(file.buffer, { name: file.fileName });
    }
    void archive.finalize();
  });
}
