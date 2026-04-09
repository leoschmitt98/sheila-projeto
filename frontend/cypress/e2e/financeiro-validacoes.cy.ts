const slug = String(Cypress.env("CYPRESS_EMPRESA_SLUG") || "nando");

function getFieldByLabel(label: string) {
  return cy.contains("label", label).parent().find("input, textarea, select").first();
}

describe("Financeiro - validacoes e CRUD de despesas", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.loginAdmin(slug);
    cy.visit(`/admin/financas?empresa=${slug}`);
    cy.get('[data-cy="finances-page"]', { timeout: 15000 }).should("be.visible");
  });

  it("bloqueia configuracao financeira quando a soma dos percentuais nao fecha 100", () => {
    getFieldByLabel("Retirada do dono (%)").clear().type("60");
    getFieldByLabel("Caixa do estabelecimento (%)").clear().type("30");
    getFieldByLabel("Orcamento para despesas (%)").clear().type("20");

    cy.contains("button", "Salvar configuracao").click();
    cy.contains(/a soma dos percentuais precisa ser exatamente 100/i, {
      timeout: 10000,
    }).should("be.visible");
  });

  it("cadastra uma despesa real e valida os erros basicos do formulario", () => {
    const descricao = `Internet QA ${Date.now()}`;

    cy.contains("button", "Adicionar despesa").click();

    cy.contains("button", "Cadastrar despesa").click();
    cy.contains(/informe a descricao da despesa/i, { timeout: 10000 }).should("be.visible");

    getFieldByLabel("Descricao").type(descricao);
    cy.contains("button", "Cadastrar despesa").click();
    cy.contains(/informe um valor valido para a despesa/i, { timeout: 10000 }).should("be.visible");

    getFieldByLabel("Valor").type("129.90");
    getFieldByLabel("Observacao (opcional)").type("Lancamento E2E para validar CRUD de despesas.");
    cy.contains("button", "Cadastrar despesa").click();

    cy.contains(/despesa cadastrada/i, { timeout: 15000 }).should("be.visible");
    cy.contains(descricao, { timeout: 15000 }).should("be.visible");
    cy.contains("Lancamento E2E para validar CRUD de despesas.").should("be.visible");
  });
});
