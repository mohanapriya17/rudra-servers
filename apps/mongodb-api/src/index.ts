import { loadServiceConfig } from "@rudra/config";
import { createApp } from "./app.js";

async function main(): Promise<void> {
  const config = loadServiceConfig("mongodb-api");
  const { app, logger, clients } = createApp();

  const { createServer } = await import("node:http");
  const server = createServer(app);

  const shutdown = async () => {
    logger.info("shutting down");
    await clients.closeAll();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());

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
