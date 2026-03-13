import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api";

import { Calendar, Users, DollarSign, Clock } from "lucide-react";
import { format, isToday, isTomorrow } from "date-fns";
import { ptBR } from "date-fns/locale";

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

/* =======================
   HELPERS
======================= */

function formatHHMM(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;

  const match = raw.match(/T(\d{2}:\d{2})/) || raw.match(/\s(\d{2}:\d{2})/);
  if (match?.[1]) return match[1];

  return raw.slice(11, 16) || raw.slice(0, 5);
}

function toYMD(value?: string) {
  if (!value) return "";
  return String(value).slice(0, 10);
}

function localYMD(date: Date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYMDToLocalDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

function buildDateTimeFromAppointment(apt: ApiAgendamento) {
  const ymd = toYMD(apt.DataAgendada);
  const hhmm = formatHHMM(apt.HoraAgendada || apt.InicioEm);

  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd) && /^\d{2}:\d{2}$/.test(hhmm)) {
    const [y, m, d] = ymd.split("-").map(Number);
    const [h, min] = hhmm.split(":").map(Number);
    return new Date(y, m - 1, d, h, min, 0, 0);
  }

  const fallback = new Date(apt.InicioEm);
  if (!Number.isNaN(fallback.getTime())) return fallback;

  return parseYMDToLocalDate(ymd);
}

function formatPrice(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
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
      apiGet<ApiAgendamentosResponse>(`/api/empresas/${encodeURIComponent(slug)}/agendamentos`),
  });

  const { data: servData } = useQuery({
    queryKey: ["dashboard-servicos", slug],
    queryFn: () =>
      apiGet<ApiServicosResponse>(`/api/empresas/${encodeURIComponent(slug)}/servicos`),
  });

  const appointments = agData?.agendamentos ?? [];
  const services = servData?.servicos ?? [];

  const servicePriceById = useMemo(() => {
    const map = new Map<number, number>();
    services.forEach((s) => map.set(s.Id, Number(s.Preco) || 0));
    return map;
  }, [services]);

  const todayYMD = localYMD();

  const todayAppointments = appointments.filter(
    (apt) =>
      toYMD(apt.DataAgendada) === todayYMD &&
      apt.AgendamentoStatus !== "cancelled"
  );

  const pendingAppointments = appointments.filter(
    (apt) => apt.AgendamentoStatus === "pending"
  );

  const totalClients = new Set(
    appointments.map((a) => a.ClienteWhatsapp).filter(Boolean)
  ).size;

  const revenue = appointments
    .filter((apt) => apt.AgendamentoStatus === "completed")
    .reduce((total, apt) => {
      const price = servicePriceById.get(apt.ServicoId) ?? 0;
      return total + price;
    }, 0);

  const now = new Date();

  const upcomingAppointments = appointments
    .filter((apt) => {
      if (
        apt.AgendamentoStatus === "cancelled" ||
        apt.AgendamentoStatus === "completed"
      ) {
        return false;
      }

      const startAt = buildDateTimeFromAppointment(apt);
      return startAt.getTime() > now.getTime();
    })
    .sort(
      (a, b) =>
        buildDateTimeFromAppointment(a).getTime() -
        buildDateTimeFromAppointment(b).getTime()
    )
    .slice(0, 5);

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

      <div className="glass-card p-6">
        <h2 className="font-display text-xl font-semibold mb-4">
          Próximos Agendamentos
        </h2>

        {upcomingAppointments.length > 0 ? (
          <div className="space-y-4">
            {upcomingAppointments.map((apt) => {
              const date = parseYMDToLocalDate(toYMD(apt.DataAgendada));
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
                      {apt.Servico} • {formatHHMM(apt.HoraAgendada || apt.InicioEm)}
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
    </div>
  );
}
