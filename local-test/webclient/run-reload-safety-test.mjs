import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const PORT = 5757;
const WS_SERVER = process.env.WS_SERVER || "ws://127.0.0.1:18088/ws";

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  const path = pathname === "/" ? "/index.html" : pathname;
  try {
    const body = await readFile(join(import.meta.dirname, path));
    res.writeHead(200, { "Content-Type": path.endsWith(".js") ? "text/javascript" : "text/html" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

async function getPeerStats(page) {
  return page.evaluate(async () => {
    const pc = window.__pcInstances?.[window.__pcInstances.length - 1];
    if (!pc) return null;
    const report = await pc.getStats();
    let out = null;
    report.forEach((s) => {
      if (s.type === "outbound-rtp" && s.kind === "audio") {
        out = { packetsSent: s.packetsSent, bytesSent: s.bytesSent };
      }
    });
    return out;
  });
}

const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
const page = await browser.newPage();
await page.goto(`http://localhost:${PORT}/?ws=${encodeURIComponent(WS_SERVER)}`);

async function waitFor(predicate, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate(() => window.__result);
    if (result && predicate(result)) return result;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timeout waiting for condition");
}

console.log("[T+0s] Call 1: registering and calling...");
await waitFor((r) => r.registered, 15000);
await waitFor((r) => r.callAnswered, 15000);
console.log("[T+0s] Call 1 answered.");

await new Promise((r) => setTimeout(r, 4000));
const snap1 = await getPeerStats(page);
console.log("[T+4s] Snapshot BEFORE external reload window:", JSON.stringify(snap1));
console.log(">>> RELOAD_WINDOW_OPEN <<<"); // host script watches for this line

await new Promise((r) => setTimeout(r, 8000)); // host applies reload somewhere in this window
const snap2 = await getPeerStats(page);
console.log("[T+12s] Snapshot AFTER external reload window:", JSON.stringify(snap2));

const stillConnected = await page.evaluate(() => {
  const pc = window.__pcInstances?.[window.__pcInstances.length - 1];
  return pc ? pc.connectionState : "no-pc";
});
console.log("[T+12s] connectionState:", stillConnected);

const call1Continuous = snap2.packetsSent > snap1.packetsSent && stillConnected === "connected";
console.log("Call 1 continuous through the reload window:", call1Continuous);

await page.evaluate(() => window.__hangup());
await new Promise((r) => setTimeout(r, 1500));

console.log("[T+14s] Call 2: placing a fresh call AFTER reload...");
await page.evaluate(() => {
  window.__result.callAnswered = false;
  window.__call("sip:999@127.0.0.1");
});
let call2Answered = false;
try {
  await waitFor((r) => r.callAnswered, 15000);
  call2Answered = true;
  await new Promise((r) => setTimeout(r, 3000));
  const call2Stats = await getPeerStats(page);
  console.log("Call 2 answered. Stats:", JSON.stringify(call2Stats));
  await page.evaluate(() => window.__hangup());
} catch (e) {
  console.log("Call 2 FAILED:", e.message);
}

await browser.close();
server.close();

const allPassed = call1Continuous && call2Answered;
console.log("\n=== RELOAD SAFETY TEST:", allPassed ? "PASSED" : "FAILED", "===");
process.exit(allPassed ? 0 : 1);
