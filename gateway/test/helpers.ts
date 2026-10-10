import { generateKeyPair, SignJWT, type KeyLike } from "jose";
import { randomUUID } from "node:crypto";
import { __setJwksForTesting } from "../src/auth/entraAuth.js";

export const TEST_TENANT = "test-tenant";
export const TEST_AUDIENCE = "test-audience";

let privateKey: KeyLike;

/**
 * Generates a throwaway RSA keypair and wires the auth middleware's JWKS
 * resolver to it, standing in for Microsoft's real JWKS endpoint. This lets
 * tests prove the middleware's own verification logic (signature, issuer,
 * audience, tenant claim) is correct without any network call. It does NOT
 * prove a real Entra app registration issues tokens this middleware accepts
 * — that integration is still Blocked pending the app registration itself.
 */
export async function initTestJwks(): Promise<void> {
  const { privateKey: priv, publicKey } = await generateKeyPair("RS256");
  privateKey = priv;
  __setJwksForTesting(async () => publicKey);
}

export function newTestIdentity() {
  const suffix = randomUUID();
  return {
    oid: `oid-${suffix}`,
    email: `user-${suffix}@example.com`,
    name: `Test User ${suffix.slice(0, 8)}`,
  };
}

export async function signToken(opts: {
  oid: string;
  email: string;
  name?: string;
  tid?: string;
  audience?: string;
  expiresIn?: string;
  absoluteExpSeconds?: number;
}): Promise<string> {
  let jwt = new SignJWT({
    oid: opts.oid,
    tid: opts.tid ?? TEST_TENANT,
    preferred_username: opts.email,
    name: opts.name ?? opts.email,
  })
    .setProtectedHeader({ alg: "RS256" })
    .setIssuedAt()
    .setIssuer(`https://login.microsoftonline.com/${TEST_TENANT}/v2.0`)
    .setAudience(opts.audience ?? TEST_AUDIENCE);

  jwt = opts.absoluteExpSeconds
    ? jwt.setExpirationTime(opts.absoluteExpSeconds)
    : jwt.setExpirationTime(opts.expiresIn ?? "10m");

  return jwt.sign(privateKey);
}
