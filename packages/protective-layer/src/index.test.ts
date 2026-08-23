import { describe, expect, it } from "vitest";
import { ServiceTokenClaimsSchema } from "@rudra/ai-contracts";
import { verifyJwt } from "@rudra/auth";
import {
  allowlistedRouteRedirect,
  assertServerSession,
  createActionRegistry,
  createPaymentService,
  isSafeRelativeRedirect,
  mintGatewayServiceToken,
} from "./index.js";

describe("protective-layer", () => {
  it("validates safe session redirects", () => {
    expect(isSafeRelativeRedirect("/checkout/success")).toBe(true);
    expect(isSafeRelativeRedirect("//evil.example")).toBe(false);
    expect(isSafeRelativeRedirect("https://evil.example")).toBe(false);
    expect(allowlistedRouteRedirect("success", { success: "/done" })).toBe("/done");
    expect(() => allowlistedRouteRedirect("missing", { success: "/done" })).toThrow();
  });

  it("requires confirmation for write actions", async () => {
    const registry = createActionRegistry([
      {
        version: 1,
        actionId: "update_profile",
        applicationId: "app_demo",
        enabled: true,
        auth: { requireAuthenticated: true, roles: [] },
        allowedRoutes: ["*"],
        allowedEnvironments: ["*"],
        inputSchema: {},
        outputSchema: {},
        queryKind: "repository",
        readOnly: false,
        requiresConfirmation: true,
        timeoutMs: 5000,
        maxRows: 10,
        maxBytes: 1024,
        redactFields: ["ssn"],
        auditClassification: "medium",
      },
    ]);

    const session = assertServerSession({
      sub: "user-1",
      applicationId: "app_demo",
      environmentId: "development",
      sessionId: "sess-1",
      roles: [],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    await expect(
      registry.invoke(
        "update_profile",
        { version: 1, input: { name: "Ada" } },
        {
          session,
          environmentId: "development",
          handler: async () => ({ ok: true }),
        },
      ),
    ).rejects.toThrow(/confirmation/i);

    const result = await registry.invoke(
      "update_profile",
      { version: 1, input: { name: "Ada" }, confirmed: true, idempotencyKey: "idem-12345678" },
      {
        session,
        environmentId: "development",
        handler: async () => ({ ok: true, ssn: "secret" }),
      },
    );
    expect(result).toEqual({ ok: true, ssn: "[REDACTED]" });
  });

  it("enforces payment checkout redirect allowlist", () => {
    const payments = createPaymentService({
      allowedRoutes: { success: "/checkout/success", cancel: "/checkout/cancel" },
      webhookSecret: "whsec_test",
    });
    const checkout = payments.createCheckout({
      version: 1,
      paymentConfigId: "pay_cfg_1",
      productId: "prod_basic",
      quantity: 1,
      successRouteId: "success",
      cancelRouteId: "cancel",
      idempotencyKey: "checkout-key-1",
    });
    expect(checkout.redirectUrl).toContain("payments.fake.rudra.example");
    expect(checkout.redirectUrl).not.toMatch(/amount|price/i);
  });

  it("mints gateway service tokens with assistantIds", () => {
    const token = mintGatewayServiceToken({
      secret: "dev-only-ai-gateway-signing-secret!!",
      issuer: "https://ai.rudra.example",
      audience: "rudra-ai-gateway",
      sub: "session:user-1",
      applicationId: "app_demo",
      environmentId: "development",
      assistantIds: ["app_demo", "support"],
      requestId: "req-1",
    });
    const claims = ServiceTokenClaimsSchema.parse(
      verifyJwt(token, "dev-only-ai-gateway-signing-secret!!"),
    );
    expect(claims.assistantIds).toEqual(["app_demo", "support"]);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(60);
  });
});
