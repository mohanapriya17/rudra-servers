import { createHmac, randomBytes } from "node:crypto";

/** Time-limited TURN credentials (Coturn REST API style). */
export function generateTurnCredentials(options: {
  secret: string;
  ttlSeconds?: number;
  username?: string;
}): { username: string; credential: string; ttl: number } {
  const ttl = options.ttlSeconds ?? 3600;
  const expiry = Math.floor(Date.now() / 1000) + ttl;
  const username = `${expiry}:${options.username ?? randomBytes(4).toString("hex")}`;
  const credential = createHmac("sha1", options.secret).update(username).digest("base64");
  return { username, credential, ttl };
}

export function buildIceServers(options?: {
  stunUrls?: string[];
  turnUrl?: string;
  turnSecret?: string;
  turnUsername?: string;
}): Array<Record<string, unknown>> {
  const iceServers: Array<Record<string, unknown>> = [
    ...(options?.stunUrls ?? ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"]).map(
      (urls) => ({ urls }),
    ),
  ];

  if (options?.turnUrl && options.turnSecret) {
    const creds = generateTurnCredentials({
      secret: options.turnSecret,
      username: options.turnUsername,
    });
    iceServers.push({
      urls: options.turnUrl,
      username: creds.username,
      credential: creds.credential,
    });
  }

  return iceServers;
}
