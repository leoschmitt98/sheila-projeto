import { addDays, format } from "date-fns";
import { gerarAgendamento } from "../support/faker";

const slug = String(Cypress.env("CYPRESS_EMPRESA_SLUG") || "nando");
const apiBaseUrl = String(Cypress.env("CYPRESS_API_BASE_URL") || "http://localhost:3001");

type ServicoApi = {
  Id?: number;
  id?: number;
  Ativo?: boolean;
};

type ProfissionalApi = {
  Id?: number;
  id?: number;
  Ativo?: boolean;
};

type SlotFound = {
  serviceId: number;
  profissionalId: number;
  data: string;
  horario: string;
};

function buscarPrimeiroHorarioDisponivel(
  serviceId: number,
  profissionalId: number,
  tentativa = 0
): Cypress.Chainable<{ data: string; horario: string } | null> {
  if (tentativa > 59) {
    return cy.wrap(null);
  }

  const data = format(addDays(new Date(), tentativa), "yyyy-MM-dd");
  return cy
    .request({
      method: "GET",
      url: `${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/agenda/disponibilidade`,
      qs: { servicoId: serviceId, profissionalId, data },
      failOnStatusCode: false,
    })
    .then((resp) => {
      if (resp.status >= 400) {
        return buscarPrimeiroHorarioDisponivel(serviceId, profissionalId, tentativa + 1);
      }

      const slots = Array.isArray(resp.body?.slots) ? (resp.body.slots as string[]) : [];
      if (slots.length > 0) {
        return { data, horario: slots[0] };
      }
      return buscarPrimeiroHorarioDisponivel(serviceId, profissionalId, tentativa + 1);
    });
}

function encontrarPrimeiroSlotDisponivel(
  serviceIds: number[],
  profissionalIds: number[],
  iService = 0,
  iProf = 0
): Cypress.Chainable<SlotFound> {
  if (iService >= serviceIds.length) {
    throw new Error("Nao foi encontrado slot disponivel para preparar o teste de cancelamento.");
  }

  const serviceId = serviceIds[iService];
  const profissionalId = profissionalIds[iProf];

  return buscarPrimeiroHorarioDisponivel(serviceId, profissionalId).then((slot) => {
    if (slot) {
      return {
        serviceId,
        profissionalId,
        data: slot.data,
        horario: slot.horario,
      };
    }

    const nextProf = iProf + 1;
    if (nextProf < profissionalIds.length) {
      return encontrarPrimeiroSlotDisponivel(serviceIds, profissionalIds, iService, nextProf);
    }

    return encontrarPrimeiroSlotDisponivel(serviceIds, profissionalIds, iService + 1, 0);
  });
}

function prepararAgendamentoCancelavel() {
  const dados = gerarAgendamento();
  const clienteNome = `Cliente QA Cancelamento ${Date.now()}`;
  const clienteTelefone = `5199${String(Date.now()).slice(-7)}`.replace(/\D/g, "").slice(0, 11);

  return cy.request(`${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/servicos`).then((servResp) => {
    const servicos = Array.isArray(servResp.body?.servicos) ? (servResp.body.servicos as ServicoApi[]) : [];
    const serviceIds = servicos
      .filter((servico) => (servico.Ativo ?? true) && Number(servico.Id ?? servico.id) > 0)
      .map((servico) => Number(servico.Id ?? servico.id));
    expect(serviceIds.length, "servicos ativos").to.be.greaterThan(0);

    return cy
      .request(`${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/profissionais?ativos=1`)
      .then((profResp) => {
        const profissionais = Array.isArray(profResp.body?.profissionais)
          ? (profResp.body.profissionais as ProfissionalApi[])
          : [];
        const profissionalIds = profissionais
          .filter((profissional) => (profissional.Ativo ?? true) && Number(profissional.Id ?? profissional.id) > 0)
          .map((profissional) => Number(profissional.Id ?? profissional.id));
        expect(profissionalIds.length, "profissionais ativos").to.be.greaterThan(0);

        return encontrarPrimeiroSlotDisponivel(serviceIds, profissionalIds).then(
          ({ serviceId, profissionalId, data, horario }) => {
            return cy
              .request({
                method: "POST",
                url: `${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/agendamentos`,
                body: {
                  servicoId: serviceId,
                  profissionalId,
                  date: data,
                  time: horario,
                  clientName: clienteNome,
                  clientPhone: clienteTelefone,
                  notes: `E2E cancelamento ${dados.clienteNome}`,
                },
              })
              .then((createResp) => {
                const agendamentoId = Number(
                  createResp.body?.agendamento?.Id ??
                    createResp.body?.agendamento?.AgendamentoId ??
                    createResp.body?.id
                );
                expect(agendamentoId).to.be.greaterThan(0);

                return {
                  agendamentoId,
                  clienteNome,
                  clienteTelefone,
                  dataIso: data,
                };
              });
          }
        );
      });
  });
}

function fillInput(selector: string, value: string) {
  cy.get(selector, { timeout: 10000 }).should("be.visible").clear().type(value, { delay: 15 });
}

describe("Cancelamento publico", () => {
  beforeEach(() => {
    cy.viewport(1280, 800);
  });

  it("localiza um agendamento real e gera o pedido de cancelamento por WhatsApp", () => {
    prepararAgendamentoCancelavel().then(({ agendamentoId, clienteNome, clienteTelefone, dataIso }) => {
      const dataBr = format(new Date(`${dataIso}T12:00:00`), "dd/MM/yyyy");

      cy.visit(`/?empresa=${slug}`);
      cy.get('[data-cy="chat-option-cancelar"]', { timeout: 15000 }).click();

      fillInput('[data-cy="cancel-date-input"]', dataBr);
      cy.get('[data-cy="cancel-date-next"]').click();

      fillInput('[data-cy="cancel-name-input"]', clienteNome);
      cy.get('[data-cy="cancel-name-next"]').click();

      fillInput('[data-cy="cancel-phone-input"]', clienteTelefone);
      cy.get('[data-cy="cancel-phone-next"]').click();

      cy.get('[data-cy="cancel-select-list"]', { timeout: 15000 }).should("be.visible");
      cy.get(`[data-cy="cancel-apt-${agendamentoId}"]`, { timeout: 15000 }).click();

      cy.get('[data-cy="cancel-done"]', { timeout: 15000 }).should("be.visible");
      cy.get('[data-cy="cancel-send-whatsapp"] a')
        .should("have.attr", "href")
        .and("include", "wa.me/")
        .and("include", encodeURIComponent(`#${agendamentoId}`));
    });
  });

  it("retorna ao menu quando os dados nao correspondem a um agendamento pendente ou confirmado", () => {
    cy.visit(`/?empresa=${slug}`);
    cy.get('[data-cy="chat-option-cancelar"]', { timeout: 15000 }).click();

    fillInput('[data-cy="cancel-date-input"]', "31/12/2099");
    cy.get('[data-cy="cancel-date-next"]').click();

    fillInput('[data-cy="cancel-name-input"]', "Cliente Inexistente QA");
    cy.get('[data-cy="cancel-name-next"]').click();

    fillInput('[data-cy="cancel-phone-input"]', "51999990000");
    cy.get('[data-cy="cancel-phone-next"]').click();

    cy.contains(/nao encontrei agendamento|confira nome, data e telefone/i, {
      timeout: 15000,
    }).should("be.visible");
    cy.get('[data-cy="chat-option-cancelar"]', { timeout: 15000 }).should("be.visible");
  });
});
