// Vitest setupFile — runs before any test module imports src/config.ts, so
// these env vars are already set by the time that module's `dotenv/config`
// import runs. dotenv does not override already-set vars, so without this,
// the real .env's placeholder Entra values would leak into tests instead of
// the "test-tenant"/"test-audience" values test/helpers.ts signs tokens for.
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "file:./test.db";
process.env.AZURE_AD_TENANT_ID = "test-tenant";
process.env.AZURE_AD_AUDIENCE = "test-audience";
process.env.GATEWAY_ADMIN_TOKEN = "test-admin-token";
