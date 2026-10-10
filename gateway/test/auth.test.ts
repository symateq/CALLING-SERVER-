import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import { config } from "../src/config.js";
import { initTestJwks, newTestIdentity, signToken, TEST_TENANT } from "./helpers.js";

const app = buildApp();

beforeAll(async () => {
  await initTestJwks();
});

describe("requireEntraAuth", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await request(app).get("/devices");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("missing_bearer_token");
  });

  it("rejects a garbage bearer token", async () => {
    const res = await request(app).get("/devices").set("Authorization", "Bearer not-a-real-jwt");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });

  it("rejects a token signed for the wrong audience", async () => {
    const identity = newTestIdentity();
    const token = await signToken({ ...identity, audience: "some-other-app" });
    const res = await request(app).get("/devices").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });

  it("rejects an expired token", async () => {
    const identity = newTestIdentity();
    const token = await signToken({
      ...identity,
      absoluteExpSeconds: Math.floor(Date.now() / 1000) - 60,
    });
    const res = await request(app).get("/devices").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_token");
  });

  it("rejects a token whose tid does not match our single tenant", async () => {
    const identity = newTestIdentity();
    const token = await signToken({ ...identity, tid: "some-other-tenant" });
    const res = await request(app).get("/devices").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("wrong_tenant");
  });
});

describe("requireCallingPermission", () => {
  it("rejects a valid, correctly-scoped identity that has never been approved", async () => {
    const identity = newTestIdentity();
    const token = await signToken(identity);
    const res = await request(app).get("/devices").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("calling_not_approved");

    const user = await prisma.gatewayUser.findUnique({ where: { entraOid: identity.oid } });
    expect(user).not.toBeNull();
    expect(user?.callingApproved).toBe(false);
  });

  it("allows access once an admin approves the user", async () => {
    const identity = newTestIdentity();
    const token = await signToken(identity);

    await request(app).get("/devices").set("Authorization", `Bearer ${token}`);

    const approve = await request(app)
      .post("/admin/users/approve")
      .set("Authorization", `Bearer ${config.adminToken}`)
      .send({ entraOid: identity.oid, entraTid: TEST_TENANT, email: identity.email, displayName: identity.name });
    expect(approve.status).toBe(200);

    const res = await request(app).get("/devices").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.devices).toEqual([]);
  });

  it("rejects a revoked user even though they were previously approved", async () => {
    const identity = newTestIdentity();
    const token = await signToken(identity);

    const approve = await request(app)
      .post("/admin/users/approve")
      .set("Authorization", `Bearer ${config.adminToken}`)
      .send({ entraOid: identity.oid, entraTid: TEST_TENANT, email: identity.email, displayName: identity.name });
    const userId = approve.body.user.id as string;

    const ok = await request(app).get("/devices").set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);

    await request(app)
      .post(`/admin/users/${userId}/revoke`)
      .set("Authorization", `Bearer ${config.adminToken}`);

    const res = await request(app).get("/devices").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("access_revoked");
  });
});
