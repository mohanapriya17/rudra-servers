import { loadServiceConfig } from "@rudra/config";
import { createApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadServiceConfig("pdf-generator-api");
  const { app, logger } = createApp();
  const { createServer } = await import("node:http");
  const server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(config.port, config.host, () => resolve());
    server.once("error", reject);
  });
  logger.info("listening", { host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
