import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { buildApp } from "../src/app.js";
import { config } from "../src/config.js";
import { initTestJwks, newTestIdentity, signToken, TEST_TENANT } from "./helpers.js";

const app = buildApp();

beforeAll(async () => {
  await initTestJwks();
});

async function approvedUserToken() {
  const identity = newTestIdentity();
  const token = await signToken(identity);
  await request(app)
    .post("/admin/users/approve")
    .set("Authorization", `Bearer ${config.adminToken}`)
    .send({ entraOid: identity.oid, entraTid: TEST_TENANT, email: identity.email, displayName: identity.name });
  return { identity, token };
}

describe("device registry", () => {
  it("registers a new device", async () => {
    const { token } = await approvedUserToken();
    const res = await request(app)
      .post("/devices/register")
      .set("Authorization", `Bearer ${token}`)
      .send({ deviceId: "phone-1", platform: "ANDROID", pushToken: "fcm-token-abc" });

    expect(res.status).toBe(200);
    expect(res.body.device.deviceId).toBe("phone-1");
    expect(res.body.device.platform).toBe("ANDROID");
  });

  it("re-registering the same deviceId updates it instead of duplicating", async () => {
    const { token } = await approvedUserToken();

    await request(app)
      .post("/devices/register")
      .set("Authorization", `Bearer ${token}`)
      .send({ deviceId: "laptop-1", platform: "WINDOWS", pushToken: "old-token" });

    await request(app)
      .post("/devices/register")
      .set("Authorization", `Bearer ${token}`)
      .send({ deviceId: "laptop-1", platform: "WINDOWS", pushToken: "new-token" });

    const list = await request(app).get("/devices").set("Authorization", `Bearer ${token}`);
    expect(list.body.devices).toHaveLength(1);
    expect(list.body.devices[0].pushToken).toBe("new-token");
  });

  it("rejects an unknown platform value", async () => {
    const { token } = await approvedUserToken();
    const res = await request(app)
      .post("/devices/register")
      .set("Authorization", `Bearer ${token}`)
      .send({ deviceId: "x", platform: "IOS" });
    expect(res.status).toBe(400);
  });

  it("does not let one user see or revoke another user's device", async () => {
    const userA = await approvedUserToken();
    const userB = await approvedUserToken();

    const registered = await request(app)
      .post("/devices/register")
      .set("Authorization", `Bearer ${userA.token}`)
      .send({ deviceId: "a-phone", platform: "ANDROID" });
    const deviceId = registered.body.device.id as string;

    const listB = await request(app).get("/devices").set("Authorization", `Bearer ${userB.token}`);
    expect(listB.body.devices).toEqual([]);

    const revokeAttempt = await request(app)
      .delete(`/devices/${deviceId}`)
      .set("Authorization", `Bearer ${userB.token}`);
    expect(revokeAttempt.status).toBe(404);

    const stillThere = await request(app).get("/devices").set("Authorization", `Bearer ${userA.token}`);
    expect(stillThere.body.devices).toHaveLength(1);
  });

  it("revoking a device removes it from the owner's list", async () => {
    const { token } = await approvedUserToken();
    const registered = await request(app)
      .post("/devices/register")
      .set("Authorization", `Bearer ${token}`)
      .send({ deviceId: "to-revoke", platform: "WINDOWS" });

    const revoke = await request(app)
      .delete(`/devices/${registered.body.device.id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(revoke.status).toBe(204);

    const list = await request(app).get("/devices").set("Authorization", `Bearer ${token}`);
    expect(list.body.devices).toEqual([]);
  });
});
