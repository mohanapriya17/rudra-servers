import type { HealthResponse } from "@rudra/contracts";

export async function expectHealthy(
  baseUrl: string,
  service: string,
): Promise<HealthResponse> {
  const response = await fetch(`${baseUrl}/health`);
  if (!response.ok) {
    throw new Error(`Health check failed for ${service}: ${response.status}`);
  }
  const body = (await response.json()) as HealthResponse;
  if (body.status !== "ok" || body.service !== service) {
    throw new Error(`Unexpected health payload for ${service}: ${JSON.stringify(body)}`);
  }
  return body;
}

export function uniqueName(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}
