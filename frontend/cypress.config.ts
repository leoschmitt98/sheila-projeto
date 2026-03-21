import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: process.env.CYPRESS_BASE_URL || "http://localhost:5173",
    specPattern: "cypress/e2e/**/*.cy.{ts,tsx}",
    supportFile: "cypress/support/e2e.ts",
    video: false,
    screenshotOnRunFailure: true,
    env: {
      CYPRESS_ADMIN_PASSWORD: process.env.CYPRESS_ADMIN_PASSWORD,
      CYPRESS_EMPRESA_SLUG: process.env.CYPRESS_EMPRESA_SLUG || "nando",
      CYPRESS_API_BASE_URL: process.env.CYPRESS_API_BASE_URL || "http://localhost:3001",
    },
  },
});
