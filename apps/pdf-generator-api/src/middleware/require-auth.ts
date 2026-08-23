import type { NextFunction, Request, Response } from "express";
import { parseBearerToken } from "@rudra/auth";
import { RudraError } from "@rudra/errors";
import type { AuthUser, AuthVerifier } from "../auth/firebase.js";

export type AuthedRequest = Request & { user?: AuthUser };

export function requireAuth(verifier: AuthVerifier) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = parseBearerToken(req.header("authorization") ?? undefined);
      if (!token) {
        throw new RudraError("UNAUTHORIZED", "Missing Bearer token");
      }
      const user = await verifier.verifyIdToken(token);
      (req as AuthedRequest).user = user;
      next();
    } catch (error) {
      next(error);
    }
  };
}
