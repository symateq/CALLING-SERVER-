import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isTest = nodeEnv === "test";

export const config = {
  nodeEnv,
  isTest,
  port: Number(process.env.PORT ?? 8081),
  azureAdTenantId: isTest
    ? (process.env.AZURE_AD_TENANT_ID ?? "test-tenant")
    : required("AZURE_AD_TENANT_ID"),
  azureAdAudience: isTest
    ? (process.env.AZURE_AD_AUDIENCE ?? "test-audience")
    : required("AZURE_AD_AUDIENCE"),
  adminToken: isTest
    ? (process.env.GATEWAY_ADMIN_TOKEN ?? "test-admin-token")
    : required("GATEWAY_ADMIN_TOKEN"),
};
