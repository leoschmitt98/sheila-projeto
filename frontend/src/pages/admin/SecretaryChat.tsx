import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { endOfWeek, format, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiGet } from "@/lib/api";

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

type ApiResumoResponse = {
  ok: true;
  resumo: {
    pendingCount: number;
    weekAgendaCount: number;
    weekRevenue: number;
    monthRevenue: number;
    todayAgenda: ApiAgendaItem[];
  };
};

type EmpresaApi = {
  NomeProprietario?: string | null;
};

type FinanceRules = {
  owner: number;
  cash: number;
  expenses: number;
};

const DEFAULT_RULES: FinanceRules = {
  owner: 50,
  cash: 30,
  expenses: 20,
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function getRules(slug: string): FinanceRules {
  const raw = localStorage.getItem(`financeRules:${slug}`);
  if (!raw) return DEFAULT_RULES;

  try {
    const parsed = JSON.parse(raw);
    return {
      owner: Number(parsed.owner) || 0,
      cash: Number(parsed.cash) || 0,
      expenses: Number(parsed.expenses) || 0,
    };
  } catch {
    return DEFAULT_RULES;
  }
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function getGreetingByTime() {
  const hour = new Date().getHours();
  if (hour < 12) return "Bom dia";
  if (hour < 18) return "Boa tarde";
  return "Boa noite";
}

export default function SecretaryChat() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => searchParams.get("empresa") || "nando", [searchParams]);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);

  const { data: resumoData, isLoading: loadingResumo } = useQuery({
    queryKey: ["secretary-resumo", slug],
    queryFn: () =>
      apiGet<ApiResumoResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/insights/resumo`
      ),
  });

  const { data: empresa } = useQuery({
    queryKey: ["secretary-empresa", slug],
    queryFn: () => apiGet<EmpresaApi>(`/api/empresas/${encodeURIComponent(slug)}`),
  });

  const pendingCount = resumoData?.resumo.pendingCount || 0;
  const todayAppointments = resumoData?.resumo.todayAgenda || [];
  const weekAgendaCount = resumoData?.resumo.weekAgendaCount || 0;
  const weekRevenue = resumoData?.resumo.weekRevenue || 0;
  const monthRevenue = resumoData?.resumo.monthRevenue || 0;

  useEffect(() => {
    if (messages.length > 0) return;

    const ownerName = empresa?.NomeProprietario?.trim() || "chefe";
    const greeting = getGreetingByTime();

    const agendaPreview = todayAppointments
      .slice(0, 5)
      .map((apt) => {
        const hora = apt.HoraAgendada?.slice(11, 16) || apt.InicioEm?.slice(11, 16) || "--:--";
        return `${hora} - ${apt.ClienteNome || "Cliente"} (${apt.Servico || "Serviço"})`;
      })
      .join("\n");

    const opening =
      `${greeting}, ${ownerName}! ` +
      `Temos ${pendingCount} agendamento(s) pendente(s) aguardando confirmação. ` +
      (todayAppointments.length
        ? `Nossa agenda de hoje está assim:\n${agendaPreview}\nTenha um ótimo dia de trabalho! Estou à disposição para o que precisar.`
        : "Hoje não há agendamentos ativos. Estou à disposição para o que precisar.");

    setMessages([{ role: "sheila", text: opening }]);
  }, [empresa?.NomeProprietario, messages.length, pendingCount, todayAppointments]);

  function ask(question: string) {
    const q = normalize(question);
    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
    const rules = getRules(slug);

    if (q.includes("agenda") && q.includes("hoje")) {
      if (!todayAppointments.length) return "Hoje não há agendamentos ativos.";

      const lines = todayAppointments.slice(0, 10).map((apt) => {
        const hora = apt.HoraAgendada?.slice(11, 16) || apt.InicioEm?.slice(11, 16) || "--:--";
        return `• ${hora} - ${apt.ClienteNome || "Cliente"} (${apt.Servico || "Serviço"})`;
      });

      return `Agenda de hoje (${todayAppointments.length}):\n${lines.join("\n")}`;
    }

    if (q.includes("agenda") && q.includes("semana")) {
      return `Agenda da semana: ${weekAgendaCount} agendamentos entre ${format(
        weekStart,
        "dd/MM",
        { locale: ptBR }
      )} e ${format(weekEnd, "dd/MM", { locale: ptBR })}.`;
    }

    if ((q.includes("fatur") || q.includes("receita")) && q.includes("semana")) {
      const owner = (weekRevenue * rules.owner) / 100;
      const cash = (weekRevenue * rules.cash) / 100;
      const expenses = (weekRevenue * rules.expenses) / 100;
      return `Faturamento da semana: ${formatCurrency(
        weekRevenue
      )}. Divisão: dono ${rules.owner}% (${formatCurrency(
        owner
      )}), caixa ${rules.cash}% (${formatCurrency(cash)}), despesas ${rules.expenses}% (${formatCurrency(expenses)}).`;
    }

    if ((q.includes("fatur") || q.includes("receita")) && q.includes("mes")) {
      const owner = (monthRevenue * rules.owner) / 100;
      const cash = (monthRevenue * rules.cash) / 100;
      const expenses = (monthRevenue * rules.expenses) / 100;
      return `Faturamento do mês: ${formatCurrency(
        monthRevenue
      )}. Divisão: dono ${rules.owner}% (${formatCurrency(
        owner
      )}), caixa ${rules.cash}% (${formatCurrency(cash)}), despesas ${rules.expenses}% (${formatCurrency(expenses)}).`;
    }

    if (q.includes("pendente") || q.includes("confirmacao")) {
      return `No total, temos ${pendingCount} agendamento(s) pendente(s) aguardando confirmação.`;
    }

    if (q.includes("ajuda") || q.includes("o que voce faz") || q.includes("oq voce faz")) {
      return "Posso te informar: agenda de hoje, pendentes de hoje, agenda da semana, faturamento da semana e faturamento do mês.";
    }

    return "Não entendi essa pergunta ainda. Tente: 'como está a agenda de hoje?' ou 'quanto faturamos essa semana?'";
  }

  function sendQuestion(textParam?: string) {
    const question = (textParam ?? input).trim();
    if (!question) return;

    setMessages((prev) => [...prev, { role: "owner", text: question }]);
    const answer = ask(question);
    setMessages((prev) => [...prev, { role: "sheila", text: answer }]);
    setInput("");
  }

  const loading = loadingResumo;

  return (
    <div className="space-y-4" data-cy="admin-secretary-page">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Secretária Sheila</h1>
        <p className="text-muted-foreground mt-1">
          Pergunte diretamente sobre agenda e faturamento. A Sheila consulta os dados do sistema.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => sendQuestion("Como está a agenda de hoje?")}
          data-cy="quick-agenda-hoje"
        >
          Agenda de hoje
        </Button>
        <Button
          variant="outline"
          onClick={() => sendQuestion("Como está a agenda da semana?")}
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
          onClick={() => sendQuestion("Quanto faturamos esse mês?")}
          data-cy="quick-faturamento-mes"
        >
          Faturamento mês
        </Button>
      </div>

      <div
        className="rounded-xl border border-border bg-card/30 p-4 h-[55vh] overflow-y-auto space-y-3"
        data-cy="secretary-chat-log"
      >
        {loading && <p className="text-sm text-muted-foreground">Carregando dados...</p>}

        {messages.map((message, idx) => (
          <div
            key={idx}
            className={`max-w-[90%] rounded-lg p-3 text-sm whitespace-pre-line ${
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
          placeholder="Ex.: como está a agenda de hoje?"
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
