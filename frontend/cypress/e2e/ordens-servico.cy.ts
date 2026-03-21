import { gerarOS } from "../support/faker";

const slug = String(Cypress.env("CYPRESS_EMPRESA_SLUG") || "nando");

function criarOrdemServico(os: ReturnType<typeof gerarOS>) {
  cy.get('[data-cy="service-order-new"]').click();
  cy.get('[data-cy="service-order-form"]').should("be.visible");
  cy.get('[data-cy="service-order-cliente-nome"]').clear().type(os.clienteNome);
  cy.get('[data-cy="service-order-cliente-telefone"]').clear().type(os.clienteTelefone);
  cy.get('[data-cy="service-order-marca"]').clear().type(os.marca);
  cy.get('[data-cy="service-order-modelo"]').clear().type(os.modelo);
  cy.get('[data-cy="service-order-estado-entrada"]').clear().type(os.estadoEntrada);
  cy.get('[data-cy="service-order-defeito"]').clear().type(os.defeito);
  cy.get('[data-cy="service-order-mao-obra"]').clear().type(String(os.valorMaoObra));
  cy.get('[data-cy="service-order-material"]').clear().type(String(os.valorMaterial));
  cy.get('[data-cy="service-order-previsao-entrega"]').clear().type(os.previsaoEntrega);
  cy.get('[data-cy="service-order-save"]').click();
}

describe("Ordens de servico", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
    cy.loginAdmin(slug);
    cy.visit(`/admin/ordens-servico?empresa=${slug}`);
    cy.get('[data-cy="service-orders-page"]').should("be.visible");
  });

  it("cria OS com dados dinamicos e edita depois", () => {
    const os = gerarOS();
    const defeitoEditado = `${os.defeito} (editado E2E)`;

    criarOrdemServico(os);
    cy.contains('tr[data-cy^="service-order-row-"]', os.clienteNome, { timeout: 15000 }).should("be.visible");
    cy.contains('tr[data-cy^="service-order-row-"]', os.modelo, { timeout: 15000 }).should("be.visible");

    cy.contains('tr[data-cy^="service-order-row-"]', os.clienteNome)
      .invoke("attr", "data-cy")
      .then((dataCy) => {
        const orderId = Number(String(dataCy || "").split("-").pop() || 0);
        cy.wrap(orderId).as("orderId");
        cy.get(`[data-cy="service-order-edit-icon-${orderId}"]`).click({ force: true });
      });

    cy.get('[data-cy="service-order-defeito"]').clear().type(defeitoEditado);
    cy.get('[data-cy="service-order-save"]').click();

    cy.get("@orderId").then((id) => {
      cy.get(`[data-cy="service-order-view-icon-${id}"]`, { timeout: 15000 }).click({ force: true });
    });
    cy.get('[role="dialog"]', { timeout: 15000 }).should("be.visible");
    cy.get('[role="dialog"]').contains(defeitoEditado, { timeout: 15000 }).should("be.visible");
  });

  it("altera status da OS via acao rapida", () => {
    const os = gerarOS();

    criarOrdemServico(os);
    cy.contains("tr", os.clienteNome, { timeout: 15000 }).as("linhaOs");

    cy.get("@linhaOs")
      .invoke("attr", "data-cy")
      .then((dataCy) => {
        const id = Number(String(dataCy || "").split("-").pop() || 0);
        cy.get(`[data-cy="service-order-status-select-${id}"]`).click({ force: true });
      });
    cy.contains('[role="option"]', "Em reparo", { timeout: 10000 }).click({ force: true });

    cy.get("@linhaOs").within(() => {
      cy.contains("button", "Salvar").click({ force: true });
    });

    cy.contains(/status da os atualizado com sucesso/i, { timeout: 15000 }).should("be.visible");
    cy.get("@linhaOs").contains(/em reparo/i).should("be.visible");
  });
});
