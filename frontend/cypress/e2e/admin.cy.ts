describe("Admin panel navigation", () => {
  it("opens admin with empresa slug in URL", () => {
    cy.visit("/?empresa=nando");
    cy.get('[data-cy="btn-admin"]').should("be.visible").click();
    cy.url().should("include", "/admin");
    cy.url().should("include", "empresa=nando");
    cy.get('[data-cy="admin-password-input"]').should("be.visible");
    cy.get('[data-cy="admin-login-submit"]').should("be.visible");
  });

  it("shows mobile open-menu trigger", () => {
    cy.viewport(390, 844);
    cy.visit("/admin?empresa=nando");
    cy.get('[data-cy="btn-admin-open-menu"]').should("be.visible");
  });
});
