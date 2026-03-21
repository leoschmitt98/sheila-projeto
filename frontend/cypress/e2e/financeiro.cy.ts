import { gerarOS } from "../support/faker";

const slug = String(Cypress.env("CYPRESS_EMPRESA_SLUG") || "nando");
const apiBaseUrl = String(Cypress.env("CYPRESS_API_BASE_URL") || "http://localhost:3001");

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

function atualizarStatusDaLinha(linhaAlias: string, status: string) {
  cy.get(linhaAlias)
    .invoke("attr", "data-cy")
    .then((dataCy) => {
      const id = Number(String(dataCy || "").split("-").pop() || 0);
      cy.get(`[data-cy="service-order-status-select-${id}"]`).click({ force: true });
      cy.contains('[role="option"]', status, { timeout: 10000 }).click({ force: true });
      cy.get(`[data-cy="service-order-status-save-${id}"]`).click({ force: true });
    });
}

describe("Financeiro (integracao com OS)", () => {
  it("gera receita ao entregar OS e evita duplicidade", () => {
    const os = gerarOS();

    cy.loginAdmin(slug);
    cy.visit(`/admin/ordens-servico?empresa=${slug}`);

    criarOrdemServico(os);

    cy.contains('tr[data-cy^="service-order-row-"]', os.clienteNome, { timeout: 15000 }).as("linhaOs");
    cy.get("@linhaOs")
      .invoke("attr", "data-cy")
      .then((dataCy) => {
        const orderId = Number(String(dataCy || "").split("-").pop() || 0);
        expect(orderId).to.be.greaterThan(0);

        atualizarStatusDaLinha("@linhaOs", "Entregue");
        cy.contains(/os marcada como entregue/i, { timeout: 15000 }).should("be.visible");

        cy.request(
          `${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/ordens-servico/${orderId}`
        ).then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body?.ordem?.ReceitaGerada).to.eq(true);
          expect(Number(response.body?.ordem?.ValorMaoObra || 0)).to.be.closeTo(os.valorMaoObra, 0.01);
          expect(response.body?.ordem?.FinanceiroReceitaId).to.be.a("number");
        });

        atualizarStatusDaLinha("@linhaOs", "Em reparo");
        cy.contains(/status da os atualizado com sucesso/i, { timeout: 15000 }).should("be.visible");

        atualizarStatusDaLinha("@linhaOs", "Entregue");
        cy.contains(/ja estava lancada anteriormente/i, { timeout: 15000 }).should("be.visible");
      });

    cy.visit(`/admin/financas?empresa=${slug}`);
    cy.get('[data-cy="finances-page"]').should("be.visible");
    cy.contains(/faturamento bruto/i).should("be.visible");
  });
});
