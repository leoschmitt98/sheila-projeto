import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { endOfWeek, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useAdminProfessionalContext } from "@/hooks/useAdminProfessionalContext";

type Role = "owner" | "sheila";

type Message = {
  role: Role;
  text: string;
};

type ApiAgendamentoStatus = "pending" | "confirmed" | "completed" | "cancelled";

type ApiAgendaItem = {
  AgendamentoId: number;
  ServicoId: number;
  Servico?: string;
  DataAgendada: string;
  HoraAgendada?: string;
  InicioEm?: string;
  AgendamentoStatus: ApiAgendamentoStatus;
  ClienteNome?: string;
};

type FinanceRules = {
  owner: number;
  cash: number;
  expenses: number;
};

type ApiResumoResponse = {
  ok: true;
  resumo: {
    pendingCount: number;
    weekAgendaCount: number;
    weekRevenue: number;
    monthRevenue: number;
    financeRules: FinanceRules;
    weekExpensesBudget: number;
    monthExpensesBudget: number;
    weekExpensesActual: number;
    monthExpensesActual: number;
    weekNetRevenue: number;
    monthNetRevenue: number;
    weekBudgetDifference: number;
    monthBudgetDifference: number;
    todayAgenda: ApiAgendaItem[];
  };
};

type EmpresaApi = {
  NomeProprietario?: string | null;
};

type ApiAgendamentosResponse = {
  ok: boolean;
  agendamentos: ApiAgendaItem[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatAppointmentTime(horaAgendada?: string, inicioEm?: string) {
  const raw = String(horaAgendada || inicioEm || "").trim();
  if (!raw) return "--:--";

  if (/^\d{2}:\d{2}$/.test(raw)) return raw;

  const datePartMatch = raw.match(/T(\d{2}:\d{2})/) || raw.match(/\s(\d{2}:\d{2})/);
  if (datePartMatch?.[1]) return datePartMatch[1];

  return raw.slice(0, 5);
}

function getGreetingByTime() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

function parseAgendaDateFromQuestion(question: string) {
  const q = normalize(question);
  const match = q.match(/agenda(?:\s+do\s+dia|\s+dia)?\s+(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?/i);
  if (!match) return null;

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = match[3];
  const now = new Date();
  const year = rawYear
    ? rawYear.length === 2
      ? Number(`20${rawYear}`)
      : Number(rawYear)
    : now.getFullYear();

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;

  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;

  return format(dt, "yyyy-MM-dd");
}

function buildFinanceAnswer(params: {
  label: string;
  gross: number;
  budget: number;
  actual: number;
  net: number;
  difference: number;
  expensesPercent: number;
}) {
  const statusMessage =
    params.difference >= 0
      ? "As despesas estao dentro do valor planejado para o periodo."
      : `As despesas ultrapassaram em ${formatCurrency(Math.abs(params.difference))} o valor reservado para este periodo.`;

  return (
    `Faturamento bruto ${params.label}: ${formatCurrency(params.gross)}. ` +
    `Orcamento para despesas: ${formatCurrency(params.budget)} (${params.expensesPercent}% do faturamento). ` +
    `Despesas reais lancadas: ${formatCurrency(params.actual)}. ` +
    `Lucro liquido atual: ${formatCurrency(params.net)}. ` +
    statusMessage
  );
}

export default function SecretaryChat() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const { profissionalIdParam } = useAdminProfessionalContext(slug);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  useEffect(() => {
    setMessages([]);
  }, [slug]);

  const { data: resumoData, isLoading: loadingResumo, isSuccess: resumoReady } = useQuery({
    queryKey: ["secretary-resumo", slug, profissionalIdParam],
    queryFn: () =>
      apiGet<ApiResumoResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/insights/resumo${profissionalIdParam ? `?profissionalId=${profissionalIdParam}` : ""}`
      ),
  });

  const { data: empresa, isLoading: loadingEmpresa, isSuccess: empresaReady } = useQuery({
    queryKey: ["secretary-empresa", slug],
    queryFn: () => apiGet<EmpresaApi>(`/api/empresas/${encodeURIComponent(slug)}`),
  });

  const pendingCount = resumoData?.resumo.pendingCount || 0;
  const todayAppointments = resumoData?.resumo.todayAgenda || [];
  const weekAgendaCount = resumoData?.resumo.weekAgendaCount || 0;
  const weekRevenue = resumoData?.resumo.weekRevenue || 0;
  const monthRevenue = resumoData?.resumo.monthRevenue || 0;
  const financeRules = resumoData?.resumo.financeRules || { owner: 50, cash: 30, expenses: 20 };
  const weekExpensesBudget = resumoData?.resumo.weekExpensesBudget || 0;
  const monthExpensesBudget = resumoData?.resumo.monthExpensesBudget || 0;
  const weekExpensesActual = resumoData?.resumo.weekExpensesActual || 0;
  const monthExpensesActual = resumoData?.resumo.monthExpensesActual || 0;
  const weekNetRevenue = resumoData?.resumo.weekNetRevenue || 0;
  const monthNetRevenue = resumoData?.resumo.monthNetRevenue || 0;
  const weekBudgetDifference = resumoData?.resumo.weekBudgetDifference || 0;
  const monthBudgetDifference = resumoData?.resumo.monthBudgetDifference || 0;

  useEffect(() => {
    if (messages.length > 0) return;
    if (!resumoReady || !empresaReady) return;

    const ownerName = empresa?.NomeProprietario?.trim() || "chefe";
    const greeting = getGreetingByTime();

    const agendaPreview = todayAppointments
      .slice(0, 5)
      .map((apt) => {
        const hora = formatAppointmentTime(apt.HoraAgendada, apt.InicioEm);
        return `${hora} - ${apt.ClienteNome || "Cliente"} (${apt.Servico || "Servico"})`;
      })
      .join("\n");

    const opening =
      `${greeting}, ${ownerName}! ` +
      `Temos ${pendingCount} agendamento(s) pendente(s) aguardando confirmacao. ` +
      (todayAppointments.length
        ? `Nossa agenda de hoje esta assim:\n${agendaPreview}\nTenha um otimo dia de trabalho! Estou a disposicao para o que precisar.`
        : "Hoje nao ha agendamentos ativos. Estou a disposicao para o que precisar.");

    setMessages([{ role: "sheila", text: opening }]);
  }, [
    empresa?.NomeProprietario,
    empresaReady,
    messages.length,
    pendingCount,
    resumoReady,
    todayAppointments,
  ]);

  async function ask(question: string) {
    const q = normalize(question);
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

    if (q.includes("agenda") && q.includes("hoje")) {
      if (!todayAppointments.length) return "Hoje nao ha agendamentos ativos.";

      const lines = todayAppointments.slice(0, 10).map((apt) => {
        const hora = formatAppointmentTime(apt.HoraAgendada, apt.InicioEm);
        return `• ${hora} - ${apt.ClienteNome || "Cliente"} (${apt.Servico || "Servico"})`;
      });

      return `Agenda de hoje (${todayAppointments.length}):\n${lines.join("\n")}`;
    }

    if (q.includes("agenda") && q.includes("semana")) {
      return `Agenda da semana: ${weekAgendaCount} agendamentos entre ${format(weekStart, "dd/MM", { locale: ptBR })} e ${format(weekEnd, "dd/MM", { locale: ptBR })}.`;
    }

    const requestedDate = parseAgendaDateFromQuestion(question);
    if (requestedDate) {
      try {
        const resp = await apiGet<ApiAgendamentosResponse>(
          `/api/empresas/${encodeURIComponent(slug)}/agendamentos?status=todos&data=${requestedDate}&page=1&pageSize=200${profissionalIdParam ? `&profissionalId=${profissionalIdParam}` : ""}`
        );

        const dayList = Array.isArray(resp.agendamentos)
          ? resp.agendamentos.filter((apt) => apt.DataAgendada === requestedDate)
          : [];

        const dateLabel = format(new Date(`${requestedDate}T00:00:00`), "dd/MM/yyyy", { locale: ptBR });

        if (!dayList.length) {
          return `Nao encontrei agendamentos para ${dateLabel}.`;
        }

        const lines = dayList
          .slice(0, 30)
          .map((apt) => {
            const hora = formatAppointmentTime(apt.HoraAgendada, apt.InicioEm);
            return `• ${hora} - ${apt.ClienteNome || "Cliente"} (${apt.Servico || "Servico"}) [${apt.AgendamentoStatus}]`;
          });

        const total = resp.pagination?.total || dayList.length;
        const more = total > lines.length ? `\n... e mais ${total - lines.length} agendamento(s).` : "";

        return `Agenda do dia ${dateLabel} (${total}):\n${lines.join("\n")}${more}`;
      } catch {
        return "Nao consegui consultar a agenda dessa data agora. Tente novamente em instantes.";
      }
    }

    if ((q.includes("fatur") || q.includes("receita")) && q.includes("semana")) {
      return buildFinanceAnswer({
        label: "da semana",
        gross: weekRevenue,
        budget: weekExpensesBudget,
        actual: weekExpensesActual,
        net: weekNetRevenue,
        difference: weekBudgetDifference,
        expensesPercent: financeRules.expenses,
      });
    }

    if ((q.includes("fatur") || q.includes("receita")) && q.includes("mes")) {
      return buildFinanceAnswer({
        label: "do mes",
        gross: monthRevenue,
        budget: monthExpensesBudget,
        actual: monthExpensesActual,
        net: monthNetRevenue,
        difference: monthBudgetDifference,
        expensesPercent: financeRules.expenses,
      });
    }

    if (q.includes("pendente") || q.includes("confirmacao")) {
      return `No total, temos ${pendingCount} agendamento(s) pendente(s) aguardando confirmacao.`;
    }

    if (q.includes("ajuda") || q.includes("o que voce faz") || q.includes("oq voce faz")) {
      return "Posso te informar: agenda de hoje, agenda da semana, pendentes, faturamento bruto, orcamento de despesas, despesas reais e lucro liquido da semana e do mes.";
    }

    return "Nao entendi essa pergunta ainda. Tente: 'como esta a agenda de hoje?' ou 'quanto faturamos essa semana?'";
  }

  async function sendQuestion(textParam?: string) {
    const question = (textParam ?? input).trim();
    if (!question) return;

    setMessages((prev) => [...prev, { role: "owner", text: question }]);
    const answer = await ask(question);
    setMessages((prev) => [...prev, { role: "sheila", text: answer }]);
    setInput("");
  }

  const loading = loadingResumo || loadingEmpresa;

  return (
    <div className="space-y-4" data-cy="admin-secretary-page">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Secretaria Sheila</h1>
        <p className="mt-1 text-muted-foreground">
          Pergunte diretamente sobre agenda e faturamento. A Sheila consulta os dados do sistema.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => sendQuestion("Como esta a agenda de hoje?")}
          data-cy="quick-agenda-hoje"
        >
          Agenda de hoje
        </Button>
        <Button
          variant="outline"
          onClick={() => sendQuestion("Como esta a agenda da semana?")}
          data-cy="quick-agenda-semana"
        >
          Agenda da semana
        </Button>
        <Button
          variant="outline"
          onClick={() => sendQuestion("Quanto faturamos essa semana?")}
          data-cy="quick-faturamento-semana"
        >
          Faturamento semana
        </Button>
        <Button
          variant="outline"
          onClick={() => sendQuestion("Quanto faturamos esse mes?")}
          data-cy="quick-faturamento-mes"
        >
          Faturamento mes
        </Button>
      </div>

      <div
        className="h-[55vh] space-y-3 overflow-y-auto rounded-xl border border-border bg-card/30 p-4"
        data-cy="secretary-chat-log"
      >
        {loading && <p className="text-sm text-muted-foreground">Carregando dados...</p>}

        {messages.map((message, idx) => (
          <div
            key={idx}
            className={`max-w-[90%] whitespace-pre-line rounded-lg p-3 text-sm ${
              message.role === "owner"
                ? "ml-auto bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground"
            }`}
          >
            {message.text}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Ex.: como esta a agenda de hoje?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") sendQuestion();
          }}
          data-cy="secretary-input"
        />
        <Button onClick={() => sendQuestion()} data-cy="secretary-send">
          Perguntar
        </Button>
      </div>
    </div>
  );
}
