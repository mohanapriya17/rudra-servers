import { ServiceTokenClaimsSchema, type ServiceTokenClaims } from "@rudra/ai-contracts";
import { signJwt } from "@rudra/auth";

const MAX_TOKEN_LIFETIME_SECONDS = 60;

export interface MintGatewayServiceTokenInput {
  secret: string;
  issuer: string;
  audience: string;
  sub: string;
  applicationId: string;
  environmentId: string;
  assistantIds: string[];
  requestId: string;
  lifetimeSeconds?: number;
}

export function mintGatewayServiceToken(input: MintGatewayServiceTokenInput): string {
  const lifetime = Math.min(input.lifetimeSeconds ?? MAX_TOKEN_LIFETIME_SECONDS, MAX_TOKEN_LIFETIME_SECONDS);
  const now = Math.floor(Date.now() / 1000);
  const claims: ServiceTokenClaims = {
    iss: input.issuer,
    aud: input.audience,
    sub: input.sub,
    applicationId: input.applicationId,
    environmentId: input.environmentId,
    assistantIds: input.assistantIds,
    requestId: input.requestId,
    iat: now,
    exp: now + lifetime,
  };
  ServiceTokenClaimsSchema.parse(claims);
  return signJwt(claims, input.secret, { expiresInSeconds: lifetime });
}
