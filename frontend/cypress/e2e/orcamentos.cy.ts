import { fakerPT_BR as faker } from "@faker-js/faker";
import { gerarCliente } from "../support/faker";

const slug = String(Cypress.env("CYPRESS_EMPRESA_SLUG") || "nando");

function fillChatInput(selector: string, value: string) {
  cy.get(selector, { timeout: 10000 }).should("exist");
  cy.get(selector, { timeout: 10000 }).should("be.visible").click();
  cy.get(selector, { timeout: 10000 }).clear();
  cy.get(selector, { timeout: 10000 }).type(value, { delay: 20 });
}

describe("Solicitacoes de orcamento", () => {
  it("capta solicitacao no SheilaChat e lista no admin", () => {
    const cliente = gerarCliente();
    const tipo = "celular";
    const modelo = `Modelo-${faker.string.alphanumeric(6).toUpperCase()}`;
    const defeito = `Defeito teste ${faker.string.alphanumeric(5)}`;
    const observacoes = `Obs ${faker.string.alphanumeric(4)}`;

    cy.visit(`/?empresa=${slug}`);
    cy.intercept("POST", "**/orcamentos/solicitacoes").as("postOrcamento");

    cy.get('[data-cy="chat-option-orcamento"]', { timeout: 15000 }).click();
    fillChatInput('[data-cy="quote-name-input"]', cliente.nome);
    cy.get('[data-cy="quote-name-next"]').click();
    fillChatInput('[data-cy="quote-phone-input"]', cliente.telefone);
    cy.get('[data-cy="quote-phone-next"]').click();
    fillChatInput('[data-cy="quote-type-input"]', tipo);
    cy.get('[data-cy="quote-type-next"]').click();
    fillChatInput('[data-cy="quote-model-input"]', modelo);
    cy.get('[data-cy="quote-model-next"]').click();
    fillChatInput('[data-cy="quote-issue-input"]', defeito);
    cy.get('[data-cy="quote-issue-next"]').click();
    fillChatInput('[data-cy="quote-notes-input"]', observacoes);
    cy.get('[data-cy="quote-notes-next"]').click();
    cy.get('[data-cy="quote-submit-request"]').click();

    cy.wait("@postOrcamento", { timeout: 20000 })
      .its("response.statusCode")
      .should("be.oneOf", [200, 201]);
    cy.get('[data-cy="quote-ready"]', { timeout: 15000 }).should("not.exist");
    cy.get('[data-cy="chat-option-orcamento"]', { timeout: 15000 }).should("be.visible");

    cy.loginAdmin(slug);
    cy.visit(`/admin/solicitacoes-orcamento?empresa=${slug}`);
    cy.get('[data-cy="budget-requests-page"]').should("be.visible");
    cy.get('[data-cy="budget-requests-search"]').clear().type(modelo);
    cy.contains(modelo, { timeout: 15000 }).should("be.visible");
    cy.contains(cliente.nome).should("be.visible");
  });
});
