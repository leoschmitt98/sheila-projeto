function getRequiredEnv(name: string) {
  const value = Cypress.env(name);
  if (!value || String(value).trim() === "") {
    throw new Error(
      `[Cypress] Variavel obrigatoria ausente: ${name}. Configure antes de rodar os testes E2E.`
    );
  }
  return String(value);
}

Cypress.Commands.add("loginAdmin", (slugArg?: string) => {
  const slug = slugArg || String(Cypress.env("CYPRESS_EMPRESA_SLUG") || "nando");
  const password = getRequiredEnv("CYPRESS_ADMIN_PASSWORD");

  cy.viewport(1280, 800);
  cy.visit(`/admin/login?empresa=${encodeURIComponent(slug)}`);
  cy.get('[data-cy="admin-password-input"]').should("be.visible").clear().type(password, {
    log: false,
  });
  cy.get('[data-cy="admin-login-submit"]').click();
  cy.url({ timeout: 15000 }).should("include", "/admin");
  cy.url({ timeout: 15000 }).should("include", `empresa=${slug}`);
  cy.get('[data-cy="admin-password-input"]').should("not.exist");
  cy.get('[data-cy="admin-login-submit"]').should("not.exist");
  cy.get('[data-cy="admin-sidebar"]', { timeout: 10000 }).should("exist");
  cy.get('[data-cy="admin-nav"]', { timeout: 10000 }).should("exist");
});

declare global {
  namespace Cypress {
    interface Chainable {
      loginAdmin(slug?: string): Chainable<void>;
    }
  }
}

export {};
