import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  PaymentCheckoutRequestSchema,
  type PaymentCheckoutRequest,
  type PaymentCheckoutResponse,
  type PaymentStatus,
} from "@rudra/ai-contracts";
import { RudraError } from "@rudra/errors";
import { allowlistedRouteRedirect } from "../auth/session.js";

export interface PaymentProduct {
  productId: string;
  title: string;
  amountCents: number;
  currency: string;
}

export interface PaymentServiceOptions {
  allowedRoutes: Record<string, string>;
  webhookSecret: string;
  providerBaseUrl?: string;
}

interface CheckoutRecord {
  checkoutId: string;
  paymentConfigId: string;
  productId: string;
  quantity: number;
  successPath: string;
  cancelPath: string;
  status: PaymentStatus;
  expiresAt: string;
}

export interface PaymentService {
  createCheckout(request: PaymentCheckoutRequest): PaymentCheckoutResponse;
  getStatus(checkoutId: string): PaymentStatus;
  verifyWebhook(signature: string | undefined, rawBody: string): { checkoutId: string; status: PaymentStatus };
}

export function createPaymentService(options: PaymentServiceOptions): PaymentService {
  const checkouts = new Map<string, CheckoutRecord>();
  const providerBaseUrl = options.providerBaseUrl ?? "https://payments.fake.rudra.example";

  return {
    createCheckout(request) {
      const parsed = PaymentCheckoutRequestSchema.parse(request);
      const successPath = allowlistedRouteRedirect(parsed.successRouteId, options.allowedRoutes);
      const cancelPath = allowlistedRouteRedirect(parsed.cancelRouteId, options.allowedRoutes);
      const checkoutId = randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
      const redirectUrl = `${providerBaseUrl}/checkout/${checkoutId}?success=${encodeURIComponent(successPath)}&cancel=${encodeURIComponent(cancelPath)}`;

      checkouts.set(checkoutId, {
        checkoutId,
        paymentConfigId: parsed.paymentConfigId,
        productId: parsed.productId,
        quantity: parsed.quantity,
        successPath,
        cancelPath,
        status: "pending",
        expiresAt,
      });

      return {
        version: 1,
        checkoutId,
        redirectUrl,
        expiresAt,
      };
    },

    getStatus(checkoutId) {
      const checkout = checkouts.get(checkoutId);
      if (!checkout) {
        throw new RudraError("NOT_FOUND", "Checkout not found");
      }
      return checkout.status;
    },

    verifyWebhook(signature, rawBody) {
      if (!signature) {
        throw new RudraError("UNAUTHORIZED", "Missing webhook signature");
      }
      const expected = createHmac("sha256", options.webhookSecret).update(rawBody).digest("hex");
      const provided = signature.startsWith("sha256=") ? signature.slice(7) : signature;
      const a = Buffer.from(provided);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new RudraError("UNAUTHORIZED", "Invalid webhook signature");
      }

      const payload = JSON.parse(rawBody) as { checkoutId?: string; status?: PaymentStatus };
      if (!payload.checkoutId || !payload.status) {
        throw new RudraError("VALIDATION_ERROR", "Invalid webhook payload");
      }
      const checkout = checkouts.get(payload.checkoutId);
      if (!checkout) {
        throw new RudraError("NOT_FOUND", "Checkout not found");
      }
      checkout.status = payload.status;
      return { checkoutId: payload.checkoutId, status: payload.status };
    },
  };
}

export function resolveProductAmount(products: PaymentProduct[], productId: string): PaymentProduct {
  const product = products.find((item) => item.productId === productId);
  if (!product) {
    throw new RudraError("NOT_FOUND", "Product not found");
  }
  return product;
}
