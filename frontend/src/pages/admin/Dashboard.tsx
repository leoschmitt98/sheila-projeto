import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api";

import { Calendar, Users, DollarSign, Clock } from "lucide-react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
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

function formatHHMM(horaIso: string) {
  return horaIso?.slice(11, 16) || "";
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
      apiGet<ApiAgendamentosResponse>(`/api/empresas/${slug}/agendamentos`),
  });

  const { data: servData } = useQuery({
    queryKey: ["dashboard-servicos", slug],
    queryFn: () =>
      apiGet<ApiServicosResponse>(`/api/empresas/${slug}/servicos`),
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

  const totalClients = new Set(
    appointments.map((a) => a.ClienteWhatsapp)
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
      new Date(a.InicioEm).getTime() -
      new Date(b.InicioEm).getTime()
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
    </div>
  );
}
