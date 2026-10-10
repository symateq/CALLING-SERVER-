import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { Request, Response, NextFunction } from "express";
import { config } from "../config.js";

export interface AuthenticatedClaims {
  oid: string;
  tid: string;
  email: string;
  name: string;
}

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthenticatedClaims;
  }
}

let jwks: JWTVerifyGetKey | null = null;

function getJwks(): JWTVerifyGetKey {
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${config.azureAdTenantId}/discovery/v2.0/keys`),
    );
  }
  return jwks;
}

/**
 * Test-only seam: lets tests supply a local key resolver (signed with a
 * throwaway keypair) instead of hitting the real Microsoft JWKS endpoint.
 * Real end-to-end validation against an actual Entra app registration is
 * still Blocked (see gateway/README.md) — this only proves the middleware's
 * own verification logic (signature, issuer, audience, tenant claim) is
 * correct.
 */
export function __setJwksForTesting(resolver: JWTVerifyGetKey): void {
  jwks = resolver;
}

export function __resetJwksForTesting(): void {
  jwks = null;
}

function readStringClaim(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Validates the bearer token against Microsoft identity platform: correct
 * signature (via tenant JWKS), correct issuer, correct audience (this
 * gateway's app registration), and that the token's tid claim matches our
 * single tenant. An email domain/suffix is never treated as authentication.
 */
export async function requireEntraAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "missing_bearer_token" });
    return;
  }
  const token = header.slice("Bearer ".length);

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: `https://login.microsoftonline.com/${config.azureAdTenantId}/v2.0`,
      audience: config.azureAdAudience,
    });

    const tid = readStringClaim(payload, "tid");
    if (!tid || tid !== config.azureAdTenantId) {
      res.status(401).json({ error: "wrong_tenant" });
      return;
    }

    const oid = readStringClaim(payload, "oid");
    const email = readStringClaim(payload, "preferred_username") ?? readStringClaim(payload, "email");
    if (!oid || !email) {
      res.status(401).json({ error: "token_missing_claims" });
      return;
    }

    req.auth = {
      oid,
      tid,
      email,
      name: readStringClaim(payload, "name") ?? email,
    };
    next();
  } catch {
    res.status(401).json({ error: "invalid_token" });
  }
}
