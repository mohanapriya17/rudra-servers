import type { Server } from "node:http";
import { createGatewayApp } from "./app.js";

const { app, config, logger } = createGatewayApp();

let server: Server | undefined;

function shutdown(signal: string) {
  logger.info("shutdown requested", { signal });
  if (!server) {
    process.exit(0);
    return;
  }
  server.close((error) => {
    if (error) {
      logger.error("shutdown failed", { error: error.message });
      process.exit(1);
      return;
    }
    logger.info("shutdown complete");
    process.exit(0);
  });
}

server = app.listen(config.port, config.host, () => {
  logger.info("ai-gateway-api listening", { host: config.host, port: config.port });
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
