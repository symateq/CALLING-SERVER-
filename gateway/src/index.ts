import { config } from "./config.js";
import { buildApp } from "./app.js";

const app = buildApp();

app.listen(config.port, () => {
  console.log(`symateq-calling-gateway listening on :${config.port} (${config.nodeEnv})`);
});
