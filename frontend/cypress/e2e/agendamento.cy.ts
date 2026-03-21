import { addDays, format } from "date-fns";
import { gerarAgendamento } from "../support/faker";

const slug = String(Cypress.env("CYPRESS_EMPRESA_SLUG") || "nando");
const apiBaseUrl = String(Cypress.env("CYPRESS_API_BASE_URL") || "http://localhost:3001");

type ServicoApi = {
  Id?: number;
  id?: number;
  Nome?: string;
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
    throw new Error(
      "Nao foi encontrado horario disponivel para nenhuma combinacao de servico/profissional nos proximos 60 dias."
    );
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

describe("Agendamento", () => {
  it("cria agendamento publico via API e valida no admin com troca de status", () => {
    const dados = gerarAgendamento();

    cy.request(`${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/servicos`).then((servResp) => {
      const servicos = Array.isArray(servResp.body?.servicos)
        ? (servResp.body.servicos as ServicoApi[])
        : [];
      const serviceIds = servicos
        .filter((s) => (s.Ativo ?? true) && Number(s.Id ?? s.id) > 0)
        .map((s) => Number(s.Id ?? s.id));
      expect(serviceIds.length, "servicos ativos para teste").to.be.greaterThan(0);

      return cy
        .request(`${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/profissionais?ativos=1`)
        .then((profResp) => {
          const profissionais = Array.isArray(profResp.body?.profissionais)
            ? (profResp.body.profissionais as ProfissionalApi[])
            : [];
          const profissionalIds = profissionais
            .filter((p) => (p.Ativo ?? true) && Number(p.Id ?? p.id) > 0)
            .map((p) => Number(p.Id ?? p.id));
          expect(profissionalIds.length, "profissionais ativos para teste").to.be.greaterThan(0);

          return encontrarPrimeiroSlotDisponivel(serviceIds, profissionalIds).then(
            ({ serviceId, profissionalId, data, horario }) => {
              return cy.request({
                method: "POST",
                url: `${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/agendamentos`,
                body: {
                  servicoId: serviceId,
                  profissionalId,
                  date: data,
                  time: horario,
                  clientName: dados.clienteNome,
                  clientPhone: dados.clienteTelefone,
                  notes: "E2E agendamento",
                },
              }).then((createResp) => {
                const agendamentoId = Number(
                  createResp.body?.agendamento?.Id ??
                    createResp.body?.agendamento?.AgendamentoId ??
                    createResp.body?.id
                );
                expect(agendamentoId, "agendamento id retornado").to.be.greaterThan(0);
                cy.wrap(agendamentoId).as("agendamentoId");
              });
            }
          );
        });
    });

    cy.loginAdmin(slug);
    cy.window().then((win) => {
      win.localStorage.removeItem(`adminProfessionalContext:${slug}`);
    });
    cy.get<number>("@agendamentoId").then((agendamentoId) => {
      cy.visit(`/admin/agendamentos?empresa=${slug}&status=all&agendamento=${agendamentoId}&profissionalId=all`);
      cy.url().should("include", "/admin/agendamentos");

      cy.request({
        method: "PUT",
        url: `${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/agendamentos/${agendamentoId}/status`,
        body: { status: "confirmed" },
      }).then((updateResp) => {
        expect(updateResp.body?.ok).to.eq(true);
      });

      cy.request({
        method: "GET",
        url: `${apiBaseUrl}/api/empresas/${encodeURIComponent(slug)}/agendamentos`,
        qs: { status: "confirmed", page: 1, pageSize: 50 },
      }).then((listResp) => {
        const rows = Array.isArray(listResp.body?.agendamentos) ? listResp.body.agendamentos : [];
        const created = rows.find((row: any) => Number(row?.AgendamentoId) === Number(agendamentoId));
        expect(created, "agendamento confirmado na API").to.exist;
        expect(String(created?.AgendamentoStatus || "").toLowerCase()).to.eq("confirmed");
      });
    });
  });
});
