const { defineConfig } = require("cypress");
const fs = require("fs");
const path = require("path");

const localEnvPath = path.join(__dirname, "cypress.env.json");
let localEnv = {};

if (fs.existsSync(localEnvPath)) {
  try {
    localEnv = JSON.parse(fs.readFileSync(localEnvPath, "utf8"));
  } catch {
    localEnv = {};
  }
}

function readEnv(key, fallback) {
  if (process.env[key] !== undefined) return process.env[key];
  if (localEnv[key] !== undefined) return localEnv[key];
  return fallback;
}

module.exports = defineConfig({
  e2e: {
    baseUrl: readEnv("CYPRESS_BASE_URL", "http://localhost:5173"),
    specPattern: "cypress/e2e/**/*.cy.{ts,tsx}",
    supportFile: "cypress/support/e2e.ts",
    video: false,
    screenshotOnRunFailure: true,
    env: {
      CYPRESS_ADMIN_PASSWORD: readEnv("CYPRESS_ADMIN_PASSWORD", undefined),
      CYPRESS_EMPRESA_SLUG: readEnv("CYPRESS_EMPRESA_SLUG", "nando"),
      CYPRESS_API_BASE_URL: readEnv("CYPRESS_API_BASE_URL", "http://localhost:3001"),
    },
  },
});
