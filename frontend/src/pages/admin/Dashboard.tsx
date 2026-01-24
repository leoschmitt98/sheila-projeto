import { useMemo, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost } from "@/lib/api";

import { Calendar, Users, DollarSign, Clock, Send, Bot } from "lucide-react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/* =======================
   TIPOS
======================= */

type ApiAgendamentoStatus = "pending" | "confirmed" | "completed" | "cancelled";

type ApiAgendamento = {
  AgendamentoId: number;
  ServicoId: number;
  Servico: string;
  DataAgendada: string;
  HoraAgendada: string;
  InicioEm: string;
  AgendamentoStatus: ApiAgendamentoStatus;
  ClienteNome: string;
  ClienteWhatsapp: string;
};

type ApiAgendamentosResponse = {
  ok: true;
  agendamentos: ApiAgendamento[];
};

type ApiServico = {
  Id: number;
  Nome: string;
  Preco: number;
};

type ApiServicosResponse = {
  ok: true;
  servicos: ApiServico[];
};

type AdminChatResponse = {
  ok: true;
  type: "text";
  content: string;
};

type AdminChatMessage = {
  role: "admin" | "sheila";
  content: string;
  ts: number;
};

/* =======================
   HELPERS
======================= */

function formatHHMM(horaIso: string) {
  return horaIso?.slice(11, 16) || "";
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function nowTs() {
  return Date.now();
}

/* =======================
   COMPONENTE
======================= */

export function Dashboard() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(
    () => searchParams.get("empresa") || "nando",
    [searchParams]
  );

  const { data: agData, isLoading } = useQuery({
    queryKey: ["dashboard-agendamentos", slug],
    queryFn: () =>
      apiGet<ApiAgendamentosResponse>(`/api/empresas/${slug}/agendamentos`),
  });

  const { data: servData } = useQuery({
    queryKey: ["dashboard-servicos", slug],
    queryFn: () => apiGet<ApiServicosResponse>(`/api/empresas/${slug}/servicos`),
  });

  const appointments = agData?.agendamentos ?? [];
  const services = servData?.servicos ?? [];

  const servicePriceById = useMemo(() => {
    const map = new Map<number, number>();
    services.forEach((s) => map.set(s.Id, Number(s.Preco) || 0));
    return map;
  }, [services]);

  const todayAppointments = appointments.filter(
    (apt) =>
      isToday(parseISO(apt.DataAgendada)) &&
      apt.AgendamentoStatus !== "cancelled"
  );

  const pendingAppointments = appointments.filter(
    (apt) => apt.AgendamentoStatus === "pending"
  );

  const totalClients = new Set(appointments.map((a) => a.ClienteWhatsapp)).size;

  const revenue = appointments
    .filter((apt) => apt.AgendamentoStatus === "completed")
    .reduce((total, apt) => {
      const price = servicePriceById.get(apt.ServicoId) ?? 0;
      return total + price;
    }, 0);

  const now = new Date();

  const upcomingAppointments = appointments
    .filter((apt) => {
      // remove cancelados e concluídos
      if (
        apt.AgendamentoStatus === "cancelled" ||
        apt.AgendamentoStatus === "completed"
      ) {
        return false;
      }

      // remove horários que já passaram
      const inicio = new Date(apt.InicioEm);
      return inicio.getTime() > now.getTime();
    })
    .sort(
      (a, b) =>
        new Date(a.InicioEm).getTime() - new Date(b.InicioEm).getTime()
    )
    .slice(0, 5);

  /* =======================
     CHAT (ADMIN)
  ======================= */

  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<AdminChatMessage[]>(() => [
    {
      role: "sheila",
      ts: nowTs(),
      content:
        "Oi! 👋 Sou a Sheila (modo admin). Pergunte coisas como: “agenda de amanhã”, “agenda 24/01”, “agenda de hoje”.",
    },
  ]);
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // auto-scroll
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages.length, chatSending]);

  async function sendAdminChat(textRaw: string) {
    const text = textRaw.trim();
    if (!text || chatSending) return;

    setChatError(null);
    setChatSending(true);

    setChatMessages((prev) => [
      ...prev,
      { role: "admin", ts: nowTs(), content: text },
    ]);

    try {
      const resp = await apiPost<AdminChatResponse>(
        `/api/empresas/${slug}/chat/admin`,
        { message: text }
      );

      setChatMessages((prev) => [
        ...prev,
        { role: "sheila", ts: nowTs(), content: resp.content },
      ]);
    } catch (e: any) {
      setChatError(
        e?.message || "Não consegui falar com a Sheila agora. Tente novamente."
      );
      setChatMessages((prev) => [
        ...prev,
        {
          role: "sheila",
          ts: nowTs(),
          content:
            "Tive um probleminha para consultar os dados agora 😕 Pode tentar de novo?",
        },
      ]);
    } finally {
      setChatSending(false);
    }
  }

  function handleChatSend() {
    const toSend = chatInput;
    setChatInput("");
    void sendAdminChat(toSend);
  }

  function handleChatKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleChatSend();
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">
          Dashboard
        </h1>
        <p className="text-muted-foreground mt-1">
          Bem-vindo ao painel de controle da Sheila
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          {
            label: "Agendamentos Hoje",
            value: todayAppointments.length,
            icon: Calendar,
          },
          {
            label: "Pendentes",
            value: pendingAppointments.length,
            icon: Clock,
          },
          {
            label: "Total de Clientes",
            value: totalClients,
            icon: Users,
          },
          {
            label: "Faturamento",
            value: formatPrice(revenue),
            icon: DollarSign,
          },
        ].map((stat) => (
          <div key={stat.label} className="glass-card p-6">
            <div className="flex items-center gap-4">
              <stat.icon size={24} />
              <div>
                <p className="text-sm text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold">
                  {isLoading ? "—" : stat.value}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h2 className="font-display text-xl font-semibold mb-4">
            Próximos Agendamentos
          </h2>

          {upcomingAppointments.length > 0 ? (
            <div className="space-y-4">
              {upcomingAppointments.map((apt) => {
                const date = parseISO(apt.DataAgendada);
                let dateLabel = format(date, "dd 'de' MMMM", { locale: ptBR });
                if (isToday(date)) dateLabel = "Hoje";
                if (isTomorrow(date)) dateLabel = "Amanhã";

                return (
                  <div
                    key={apt.AgendamentoId}
                    className="flex justify-between p-4 bg-secondary/50 rounded-lg"
                  >
                    <div>
                      <p className="font-medium">{apt.ClienteNome}</p>
                      <p className="text-sm text-muted-foreground">
                        {apt.Servico} • {formatHHMM(apt.HoraAgendada)}
                      </p>
                    </div>
                    <span className="text-sm">{dateLabel}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-6">
              Nenhum agendamento encontrado
            </p>
          )}
        </div>

        <div className="glass-card p-6 flex flex-col">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <Bot size={20} />
              <h2 className="font-display text-xl font-semibold">
                Pergunte para a Sheila
              </h2>
            </div>

            <div className="text-xs text-muted-foreground">
              Modo admin • empresa: <span className="font-medium">{slug}</span>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto pr-2 space-y-3 max-h-[360px]">
            {chatMessages.map((m) => (
              <div
                key={m.ts + m.role + m.content.slice(0, 8)}
                className={
                  m.role === "admin"
                    ? "flex justify-end"
                    : "flex justify-start"
                }
              >
                <div
                  className={
                    m.role === "admin"
                      ? "max-w-[85%] rounded-2xl px-4 py-3 bg-primary text-primary-foreground"
                      : "max-w-[85%] rounded-2xl px-4 py-3 bg-secondary/60 text-foreground"
                  }
                >
                  <div className="whitespace-pre-wrap text-sm leading-relaxed">
                    {m.content}
                  </div>
                </div>
              </div>
            ))}

            {chatSending ? (
              <div className="flex justify-start">
                <div className="max-w-[85%] rounded-2xl px-4 py-3 bg-secondary/60 text-foreground text-sm">
                  Consultando…
                </div>
              </div>
            ) : null}

            <div ref={chatEndRef} />
          </div>

          {chatError ? (
            <p className="text-sm text-destructive mt-3">{chatError}</p>
          ) : null}

          <div className="mt-4 flex gap-3 items-end">
            <Textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={handleChatKeyDown}
              placeholder='Ex: "agenda de amanhã"'
              className="min-h-[44px] resize-none"
              disabled={chatSending}
            />
            <Button
              onClick={handleChatSend}
              disabled={chatSending || !chatInput.trim()}
              className="h-[44px] px-4"
              aria-label="Enviar"
              title="Enviar"
            >
              <Send size={18} />
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-2">
            Dica: Enter para enviar • Shift+Enter para quebrar linha.
          </p>
        </div>
      </div>
    </div>
  );
}
