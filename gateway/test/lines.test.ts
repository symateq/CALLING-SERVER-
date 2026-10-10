import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { initTestJwks, newTestIdentity, signToken, TEST_TENANT } from "./helpers.js";

const app = buildApp();

beforeAll(async () => {
  await initTestJwks();
});

async function approvedUser() {
  const identity = newTestIdentity();
  const token = await signToken(identity);
  const approve = await request(app)
    .post("/admin/users/approve")
    .set("Authorization", `Bearer ${config.adminToken}`)
    .send({ entraOid: identity.oid, entraTid: TEST_TENANT, email: identity.email, displayName: identity.name });
  return { identity, token, userId: approve.body.user.id as string };
}

async function createLine(e164Number: string) {
  const res = await request(app)
    .post("/admin/lines")
    .set("Authorization", `Bearer ${config.adminToken}`)
    .send({ label: "Primary", e164Number });
  return res.body.line.id as string;
}

describe("line assignment and caller-ID enforcement", () => {
  it("rejects admin requests without the admin token", async () => {
    const res = await request(app).post("/admin/lines").send({ label: "x", e164Number: "+10000000000" });
    expect(res.status).toBe(401);
  });

  it("a user with no line assignments sees no lines and no permitted caller ID", async () => {
    const { token } = await approvedUser();
    const lineId = await createLine(`+1${randomUUID().replace(/\D/g, "").slice(0, 10)}`);

    const lines = await request(app).get("/lines").set("Authorization", `Bearer ${token}`);
    expect(lines.body.lines).toEqual([]);

    const validate = await request(app)
      .post("/lines/validate-caller-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ lineId });
    expect(validate.body.permitted).toBe(false);
    expect(validate.body.e164Number).toBeNull();
  });

  it("once assigned, a line shows up and validates as a permitted caller ID", async () => {
    const { token, userId } = await approvedUser();
    const e164 = "+14077511755";
    const lineId = await createLine(e164);

    const assign = await request(app)
      .post(`/admin/users/${userId}/assign-line`)
      .set("Authorization", `Bearer ${config.adminToken}`)
      .send({ lineId, canUseAsCallerId: true });
    expect(assign.status).toBe(200);

    const lines = await request(app).get("/lines").set("Authorization", `Bearer ${token}`);
    expect(lines.body.lines).toHaveLength(1);
    expect(lines.body.lines[0].e164Number).toBe(e164);

    const validate = await request(app)
      .post("/lines/validate-caller-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ lineId });
    expect(validate.body.permitted).toBe(true);
    expect(validate.body.e164Number).toBe(e164);
  });

  it("a second assigned line does not revoke caller-ID permission on the first", async () => {
    const { token, userId } = await approvedUser();
    const lineA = await createLine("+14077511178");
    const lineB = await createLine("+19175550100");

    await request(app)
      .post(`/admin/users/${userId}/assign-line`)
      .set("Authorization", `Bearer ${config.adminToken}`)
      .send({ lineId: lineA, canUseAsCallerId: true });
    await request(app)
      .post(`/admin/users/${userId}/assign-line`)
      .set("Authorization", `Bearer ${config.adminToken}`)
      .send({ lineId: lineB, canUseAsCallerId: true });

    const lines = await request(app).get("/lines").set("Authorization", `Bearer ${token}`);
    expect(lines.body.lines.map((l: { e164Number: string }) => l.e164Number).sort()).toEqual(
      ["+14077511178", "+19175550100"].sort(),
    );

    const validateA = await request(app)
      .post("/lines/validate-caller-id")
      .set("Authorization", `Bearer ${token}`)
      .send({ lineId: lineA });
    expect(validateA.body.permitted).toBe(true);
  });
});
