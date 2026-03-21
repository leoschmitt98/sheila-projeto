import { format } from "date-fns";
import { gerarOS } from "../support/faker";

const slug = String(Cypress.env("CYPRESS_EMPRESA_SLUG") || "nando");
const apiBaseUrl = String(Cypress.env("CYPRESS_API_BASE_URL") || "http://localhost:3001");

function fillInput(selector: string, value: string) {
  cy.get(selector, { timeout: 10000 }).should("be.visible").click();
  cy.get(selector, { timeout: 10000 }).clear();
  cy.get(selector, { timeout: 10000 }).type(value, { delay: 20 });
}

function clickStepNext(selector: string) {
  cy.get(selector, { timeout: 10000 }).should("exist").then(($btn) => {
    cy.wrap($btn).should("be.visible").click({ force: true });
  });
}

function criarOrdemServico(os: ReturnType<typeof gerarOS>) {
  return cy.request({
    method: "POST",
    url: `${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/ordens-servico`,
    body: {
      clienteNome: os.clienteNome,
      clienteTelefone: os.clienteTelefone,
      clienteCpf: null,
      tipoAparelho: "celular",
      marca: os.marca,
      modelo: os.modelo,
      cor: null,
      imeiSerial: null,
      acessorios: null,
      senhaPadrao: null,
      estadoEntrada: os.estadoEntrada,
      defeitoRelatado: os.defeito,
      observacoesTecnicas: null,
      valorMaoObra: os.valorMaoObra,
      valorPecas: os.valorMaterial,
      valorMaterial: os.valorMaterial,
      valorTotal: Number((os.valorMaoObra + os.valorMaterial).toFixed(2)),
      prazoEstimado: "2 dias uteis",
      statusOrcamento: "aprovado",
      statusOrdem: "em_reparo",
      dataEntrada: new Date().toISOString().slice(0, 10),
      previsaoEntrega: os.previsaoEntrega,
      observacoesGerais: null,
    },
  });
}

describe("SheilaChat", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
  });

  it("consulta servico por nome + telefone e retorna OS", () => {
    const osBase = gerarOS();
    const os = {
      ...osBase,
      clienteNome: `Cliente E2E Status ${Date.now()}`,
      clienteTelefone: `5199${String(Date.now()).slice(-7)}`.replace(/\D/g, "").slice(0, 11),
      modelo: `Modelo E2E ${String(Date.now()).slice(-4)}`,
    };

    cy.loginAdmin(slug);
    criarOrdemServico(os).then((resp) => {
      const numeroOs = String(resp.body?.ordem?.NumeroOS || "").trim();
      expect(numeroOs, "numero da OS criado via API").to.match(/^OS-\d+/);
      cy.wrap(numeroOs).as("numeroOs");
    });
    cy.request({
      method: "POST",
      url: `${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/ordens-servico/consultar-status`,
      body: { name: os.clienteNome, phone: os.clienteTelefone },
    }).then((lookupResp) => {
      expect(lookupResp.body?.ok).to.eq(true);
      expect(lookupResp.body?.ordem?.NumeroOS).to.match(/^OS-\d+/);
    });

    cy.visit(`/?empresa=${slug}`);
    cy.get('[data-cy="chat-option-consultar_servico"]', { timeout: 15000 }).click();

    clickStepNext('[data-cy="service-status-name-next"]');
    cy.get('[data-cy="service-status-name-input"]').should("be.visible");
    cy.get('[data-cy="service-status-phone-input"]').should("not.exist");

    fillInput('[data-cy="service-status-name-input"]', os.clienteNome);
    clickStepNext('[data-cy="service-status-name-next"]');
    cy.get('[data-cy="service-status-phone-input"]', { timeout: 10000 }).should("be.visible");

    clickStepNext('[data-cy="service-status-phone-next"]');
    cy.get('[data-cy="service-status-phone-input"]').should("be.visible");
    cy.get('[data-cy="service-status-result"]').should("not.exist");

    fillInput('[data-cy="service-status-phone-input"]', os.clienteTelefone);
    clickStepNext('[data-cy="service-status-phone-next"]');

    cy.get('[data-cy="service-status-result"]', { timeout: 15000 }).should("be.visible");
    cy.get("@numeroOs").then((numeroOs) => {
      cy.contains(String(numeroOs)).should("be.visible");
    });
    cy.contains(os.modelo).should("be.visible");
  });

  it("valida campos vazios nos fluxos de registros e cancelamento", () => {
    const hoje = format(new Date(), "dd/MM/yyyy");

    cy.visit(`/?empresa=${slug}`);

    cy.get('[data-cy="chat-option-registros"]', { timeout: 15000 }).click();
    cy.get('[data-cy="history-name-input"]', { timeout: 10000 }).should("be.visible");
    clickStepNext('[data-cy="history-name-next"]');
    cy.get('[data-cy="history-name-input"]').should("be.visible");
    cy.get('[data-cy="history-phone-input"]').should("not.exist");

    fillInput('[data-cy="history-name-input"]', "Cliente Teste");
    clickStepNext('[data-cy="history-name-next"]');
    cy.get('[data-cy="history-phone-input"]', { timeout: 10000 }).should("be.visible");
    clickStepNext('[data-cy="history-phone-next"]');
    cy.get('[data-cy="history-phone-input"]').should("be.visible");
    cy.get('[data-cy="history-list"]').should("not.exist");

    cy.get('[data-cy="chat-menu-shortcut"]', { timeout: 10000 }).click({ force: true });
    cy.get('[data-cy="chat-option-cancelar"]').click();

    clickStepNext('[data-cy="cancel-date-next"]');
    cy.get('[data-cy="cancel-date-input"]').should("be.visible");
    cy.get('[data-cy="cancel-name-input"]').should("not.exist");

    fillInput('[data-cy="cancel-date-input"]', hoje);
    clickStepNext('[data-cy="cancel-date-next"]');
    cy.get('[data-cy="cancel-name-input"]', { timeout: 10000 }).should("be.visible");

    clickStepNext('[data-cy="cancel-name-next"]');
    cy.get('[data-cy="cancel-name-input"]').should("be.visible");
    cy.get('[data-cy="cancel-phone-input"]').should("not.exist");

    fillInput('[data-cy="cancel-name-input"]', "Cliente Teste");
    clickStepNext('[data-cy="cancel-name-next"]');
    cy.get('[data-cy="cancel-phone-input"]', { timeout: 10000 }).should("be.visible");

    clickStepNext('[data-cy="cancel-phone-next"]');
    cy.get('[data-cy="cancel-phone-input"]').should("be.visible");
    cy.get('[data-cy="cancel-select-list"]').should("not.exist");
  });
});
