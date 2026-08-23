import { createRequire } from "node:module";
import { RudraError } from "@rudra/errors";

export interface AuthUser {
  uid: string;
  email?: string;
  claims: Record<string, unknown>;
}

export interface AuthVerifier {
  verifyIdToken(token: string): Promise<AuthUser>;
}

type FirebaseAdminModule = typeof import("firebase-admin");

let adminModule: FirebaseAdminModule | null = null;
let initialized = false;

function loadAdmin(): FirebaseAdminModule {
  if (adminModule) return adminModule;
  const require = createRequire(import.meta.url);
  adminModule = require("firebase-admin") as FirebaseAdminModule;
  return adminModule;
}

export function createFirebaseAuthVerifier(env: NodeJS.ProcessEnv = process.env): AuthVerifier {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  const clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim();
  const privateKey = env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();

  if (!projectId) {
    throw new Error(
      "FIREBASE_PROJECT_ID is required for pdf-generator-api Firebase auth (or inject a custom AuthVerifier in tests)",
    );
  }

  const admin = loadAdmin();
  if (!initialized) {
    if (clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
    } else if (env.GOOGLE_APPLICATION_CREDENTIALS || env.FIREBASE_AUTH_EMULATOR_HOST) {
      admin.initializeApp({ projectId });
    } else {
      throw new Error(
        "Configure FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY, GOOGLE_APPLICATION_CREDENTIALS, or FIREBASE_AUTH_EMULATOR_HOST",
      );
    }
    initialized = true;
  }

  return {
    async verifyIdToken(token: string): Promise<AuthUser> {
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        return {
          uid: decoded.uid,
          email: typeof decoded.email === "string" ? decoded.email : undefined,
          claims: decoded as Record<string, unknown>,
        };
      } catch (error) {
        throw new RudraError("UNAUTHORIZED", "Invalid or expired Firebase ID token", {
          cause: error,
        });
      }
    },
  };
}

/** Test/dev verifier: accepts `test:<uid>` tokens when auth is injected. */
export function createTestAuthVerifier(): AuthVerifier {
  return {
    async verifyIdToken(token: string): Promise<AuthUser> {
      if (!token.startsWith("test:")) {
        throw new RudraError("UNAUTHORIZED", "Invalid test token");
      }
      const uid = token.slice("test:".length).trim();
      if (!uid) throw new RudraError("UNAUTHORIZED", "Invalid test token");
      return { uid, email: `${uid}@test.local`, claims: { test: true } };
    },
  };
}
