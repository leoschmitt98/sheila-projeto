const slug = String(Cypress.env("CYPRESS_EMPRESA_SLUG") || "nando");

describe("Auth admin", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
  });

  it("redireciona para login ao tentar acessar /admin sem sessao", () => {
    cy.visit(`/admin?empresa=${slug}`);
    cy.url({ timeout: 15000 }).should("include", `/admin/login?empresa=${slug}`);
    cy.get('[data-cy="admin-password-input"]').should("be.visible");
  });

  it("realiza login valido e libera painel", () => {
    cy.loginAdmin(slug);
    cy.get('[data-cy="admin-nav"]', { timeout: 10000 }).should("be.visible");
  });

  it("mantem login invalido bloqueado", () => {
    cy.visit(`/admin/login?empresa=${slug}`);
    cy.get('[data-cy="admin-password-input"]').type("senha-invalida", { log: false });
    cy.get('[data-cy="admin-login-submit"]').click();
    cy.get('[data-cy="admin-login-error"]', { timeout: 10000 })
      .should("be.visible")
      .and("contain.text", "Senha");
    cy.contains(/senha|incorreta|invalida|inválida/i, { timeout: 10000 }).should("be.visible");
    cy.url().should("include", `/admin/login?empresa=${slug}`);
  });

  it("faz logout e bloqueia acesso ao voltar", () => {
    cy.loginAdmin(slug);
    cy.get('[data-cy="admin-logout"]').click();
    cy.url({ timeout: 15000 }).should("include", `/admin/login?empresa=${slug}`);

    cy.go("back");
    cy.get("body", { timeout: 15000 }).then(($body) => {
      const hasPasswordInput = $body.find('[data-cy="admin-password-input"]').length > 0;
      const hasAdminNav = $body.find('[data-cy="admin-nav"]').length > 0;
      const currentUrl = Cypress.config("baseUrl")
        ? String(cy.state("window")?.location?.href || "")
        : "";

      if (!hasPasswordInput) {
        expect(hasAdminNav, "menu admin nao deve estar acessivel apos logout").to.eq(false);
        if (currentUrl) {
          expect(currentUrl.includes("/admin/login") || currentUrl === "about:blank").to.eq(true);
        }
      } else {
        expect(hasPasswordInput, "formulario de login deve estar visivel").to.eq(true);
      }
    });
    cy.get('[data-cy="admin-nav"]').should("not.exist");

    cy.visit(`/admin/agendamentos?empresa=${slug}`);
    cy.url({ timeout: 15000 }).should("include", `/admin/login?empresa=${slug}`);
  });
});
