import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { addDays, endOfWeek, format, startOfWeek, subDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar, CheckCircle2, Clock, TrendingUp, Users } from "lucide-react";

import { apiGet, apiPut } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useAdminProfessionalContext } from "@/hooks/useAdminProfessionalContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

import { DashboardAppointmentItem } from "./dashboard/DashboardAppointmentItem";
import { DashboardStatCard } from "./dashboard/DashboardStatCard";
import {
  buildDateTimeFromAppointment,
  DashboardAppointment,
  DashboardStatus,
  dayDiffLabel,
  formatDateLabel,
  formatHHMM,
  localYMD,
  onlyDigits,
  parseYMDToLocalDate,
  toYMD,
} from "./dashboard/dashboard-utils";

type QuickFilter = "today" | "tomorrow" | "week" | "date";

type ApiAgendamentoStatus = "pending" | "confirmed" | "completed" | "cancelled";
type ApiListAppointment = {
  AgendamentoId: number;
  Servico: string;
  DataAgendada: string;
  HoraAgendada: string;
  InicioEm: string;
  AgendamentoStatus: ApiAgendamentoStatus;
  ClienteNome: string;
  ClienteWhatsapp: string;
  Observacoes?: string | null;
};
type ApiAgendamentosResponse = {
  ok: true;
  agendamentos: ApiListAppointment[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};
type ApiAgendamentosPorDataResponse = {
  ok: true;
  data: string;
  totalDia: number;
  agendamentos: Array<{
    id: number;
    nomeCliente: string;
    servico: string;
    data: string;
    horario: string;
    status: DashboardStatus;
    telefone?: string;
    observacao?: string;
  }>;
};

function mapListAppointmentToDashboard(apt: ApiListAppointment): DashboardAppointment {
  return {
    id: Number(apt.AgendamentoId),
    nomeCliente: String(apt.ClienteNome || ""),
    servico: String(apt.Servico || ""),
    data: toYMD(apt.DataAgendada),
    horario: formatHHMM(apt.HoraAgendada || apt.InicioEm),
    status: (String(apt.AgendamentoStatus || "pending").trim().toLowerCase() as DashboardStatus) || "pending",
    telefone: String(apt.ClienteWhatsapp || ""),
    observacao: String(apt.Observacoes || ""),
  };
}

function normalizeDayList(items: ApiAgendamentosPorDataResponse["agendamentos"]): DashboardAppointment[] {
  return (items || []).map((item) => ({
    id: Number(item.id || 0),
    nomeCliente: String(item.nomeCliente || ""),
    servico: String(item.servico || ""),
    data: String(item.data || ""),
    horario: String(item.horario || ""),
    status: (String(item.status || "pending").trim().toLowerCase() as DashboardStatus) || "pending",
    telefone: String(item.telefone || ""),
    observacao: String(item.observacao || ""),
  }));
}

export function Dashboard() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const { profissionalIdParam } = useAdminProfessionalContext(slug);
  const queryClient = useQueryClient();

  const [quickFilter, setQuickFilter] = useState<QuickFilter>("today");
  const [selectedDate, setSelectedDate] = useState<string>(localYMD());
  const [showMoreUpcoming, setShowMoreUpcoming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const allAppointmentsQuery = useQuery({
    queryKey: ["dashboard", "agendamentos-all", slug, profissionalIdParam],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("status", "todos");
      params.set("page", "1");
      params.set("pageSize", "50");
      if (profissionalIdParam) params.set("profissionalId", String(profissionalIdParam));

      const first = await apiGet<ApiAgendamentosResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/agendamentos?${params.toString()}`
      );
      const firstItems = Array.isArray(first?.agendamentos) ? first.agendamentos : [];
      const totalPages = Number(first?.pagination?.totalPages || 1);
      if (totalPages <= 1) return firstItems.map(mapListAppointmentToDashboard);

      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }).map((_, idx) => {
          const page = idx + 2;
          const p = new URLSearchParams(params);
          p.set("page", String(page));
          return apiGet<ApiAgendamentosResponse>(
            `/api/empresas/${encodeURIComponent(slug)}/agendamentos?${p.toString()}`
          );
        })
      );

      const merged = [...firstItems];
      for (const pageData of rest) {
        if (Array.isArray(pageData?.agendamentos)) merged.push(...pageData.agendamentos);
      }
      return merged.map(mapListAppointmentToDashboard);
    },
  });

  const dayAppointmentsQuery = useQuery({
    queryKey: ["dashboard", "agendamentos-dia", slug, selectedDate, profissionalIdParam],
    enabled: quickFilter !== "week",
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("data", selectedDate);
      if (profissionalIdParam) params.set("profissionalId", String(profissionalIdParam));
      return apiGet<ApiAgendamentosPorDataResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/agendamentos-por-data?${params.toString()}`
      );
    },
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: DashboardStatus }) => {
      return apiPut(`/api/empresas/${encodeURIComponent(slug)}/agendamentos/${id}/status`, { status });
    },
    onSuccess: async () => {
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["dashboard", "agendamentos-all", slug, profissionalIdParam] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard", "agendamentos-dia", slug, selectedDate, profissionalIdParam] }),
      ]);
    },
    onError: (err: any) => {
      setActionError(String(err?.message || "Nao foi possivel atualizar o agendamento."));
    },
  });

  const allAppointments = allAppointmentsQuery.data || [];
  const today = useMemo(() => localYMD(), []);
  const yesterday = useMemo(() => localYMD(subDays(new Date(), 1)), []);
  const tomorrow = useMemo(() => localYMD(addDays(new Date(), 1)), []);

  const todayCount = useMemo(
    () => allAppointments.filter((apt) => apt.data === today && apt.status !== "cancelled").length,
    [allAppointments, today]
  );
  const yesterdayCount = useMemo(
    () => allAppointments.filter((apt) => apt.data === yesterday && apt.status !== "cancelled").length,
    [allAppointments, yesterday]
  );
  const pendingTodayCount = useMemo(
    () => allAppointments.filter((apt) => apt.data === today && apt.status === "pending").length,
    [allAppointments, today]
  );
  const pendingYesterdayCount = useMemo(
    () => allAppointments.filter((apt) => apt.data === yesterday && apt.status === "pending").length,
    [allAppointments, yesterday]
  );
  const completedTodayCount = useMemo(
    () => allAppointments.filter((apt) => apt.data === today && apt.status === "completed").length,
    [allAppointments, today]
  );
  const completedYesterdayCount = useMemo(
    () => allAppointments.filter((apt) => apt.data === yesterday && apt.status === "completed").length,
    [allAppointments, yesterday]
  );
  const totalClients = useMemo(
    () => new Set(allAppointments.map((apt) => onlyDigits(apt.telefone || "")).filter(Boolean)).size,
    [allAppointments]
  );

  const weekRange = useMemo(() => {
    const base = parseYMDToLocalDate(selectedDate);
    const start = startOfWeek(base, { weekStartsOn: 1 });
    const end = endOfWeek(base, { weekStartsOn: 1 });
    return {
      startYmd: localYMD(start),
      endYmd: localYMD(end),
      startLabel: format(start, "dd/MM", { locale: ptBR }),
      endLabel: format(end, "dd/MM", { locale: ptBR }),
    };
  }, [selectedDate]);

  const weekAppointments = useMemo(() => {
    return allAppointments
      .filter((apt) => apt.data >= weekRange.startYmd && apt.data <= weekRange.endYmd)
      .sort((a, b) => {
        const d = a.data.localeCompare(b.data);
        if (d !== 0) return d;
        return (a.horario || "").localeCompare(b.horario || "");
      });
  }, [allAppointments, weekRange]);

  const selectedList = useMemo(() => {
    if (quickFilter === "week") return weekAppointments;
    return normalizeDayList(dayAppointmentsQuery.data?.agendamentos || []);
  }, [quickFilter, weekAppointments, dayAppointmentsQuery.data?.agendamentos]);

  const groupedWeek = useMemo(() => {
    const groups = new Map<string, DashboardAppointment[]>();
    for (const apt of weekAppointments) {
      const key = apt.data;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)?.push(apt);
    }
    return Array.from(groups.entries());
  }, [weekAppointments]);

  const upcomingAppointments = useMemo(() => {
    const now = new Date();
    return allAppointments
      .filter((apt) => apt.status === "pending" || apt.status === "confirmed")
      .map((apt) => ({
        ...apt,
        dt: buildDateTimeFromAppointment({
          DataAgendada: apt.data,
          HoraAgendada: apt.horario,
          InicioEm: `${apt.data}T${apt.horario || "00:00"}:00`,
        }),
      }))
      .filter((apt) => apt.dt.getTime() > now.getTime())
      .sort((a, b) => a.dt.getTime() - b.dt.getTime());
  }, [allAppointments]);

  const visibleUpcoming = showMoreUpcoming ? upcomingAppointments.slice(0, 15) : upcomingAppointments.slice(0, 6);
  const hasMoreUpcoming = upcomingAppointments.length > 6;

  const listLoading = quickFilter === "week" ? allAppointmentsQuery.isLoading : dayAppointmentsQuery.isLoading;
  const listError = quickFilter === "week" ? allAppointmentsQuery.isError : dayAppointmentsQuery.isError;

  const insights = useMemo(() => {
    const items: string[] = [];
    const total = selectedList.length;
    const pending = selectedList.filter((x) => x.status === "pending").length;
    const confirmed = selectedList.filter((x) => x.status === "confirmed").length;
    const completed = selectedList.filter((x) => x.status === "completed").length;
    const cancelled = selectedList.filter((x) => x.status === "cancelled").length;

    if (total === 0) {
      items.push("Voce nao possui agendamentos para o periodo selecionado.");
      return items;
    }
    if (pending >= 3 || (total > 0 && pending / total >= 0.4)) {
      items.push("Ha muitos agendamentos pendentes aguardando confirmacao.");
    }
    if (total >= 8) {
      items.push("Dia movimentado: sua agenda esta com bom volume de atendimentos.");
    }
    if (todayCount > yesterdayCount) {
      items.push("Voce teve mais agendamentos hoje do que ontem.");
    }
    if (total > 0 && completed / total < 0.3) {
      items.push("Taxa de conclusao baixa no periodo. Considere acompanhar os pendentes.");
    }
    if (confirmed > 0 && pending === 0) {
      items.push("Agenda bem organizada: todos os agendamentos ativos ja estao confirmados.");
    }
    if (cancelled >= 2) {
      items.push("Cancelamentos acima do comum hoje. Vale revisar horarios de maior evasao.");
    }
    if (items.length === 0) {
      items.push("Operacao estavel. Continue acompanhando confirmacoes e concluidos ao longo do dia.");
    }
    return items.slice(0, 3);
  }, [selectedList, todayCount, yesterdayCount]);

  const handleQuickFilter = (filter: QuickFilter) => {
    setQuickFilter(filter);
    if (filter === "today") setSelectedDate(today);
    if (filter === "tomorrow") setSelectedDate(tomorrow);
  };

  const periodTitle = quickFilter === "week" ? "Agendamentos da semana selecionada" : "Agendamentos do dia selecionado";

  return (
    <div className="space-y-6">
      <header className="glass-card p-6 border border-border/60">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground">Dashboard operacional</h1>
            <p className="text-muted-foreground mt-1">
              Controle sua agenda com foco no dia, atualize status rapidamente e acompanhe os proximos atendimentos.
            </p>
          </div>
          <Badge variant="outline" className="w-fit border-primary/40 text-primary">
            Base ativa: {quickFilter === "week" ? `${weekRange.startLabel} ate ${weekRange.endLabel}` : formatDateLabel(selectedDate)}
          </Badge>
        </div>

        <div className="mt-5 grid grid-cols-1 lg:grid-cols-[auto_1fr] gap-4 items-end">
          <div className="space-y-1">
            <label htmlFor="dashboard-data" className="text-xs text-muted-foreground uppercase tracking-wide">
              Filtrar por data
            </label>
            <Input
              id="dashboard-data"
              type="date"
              value={selectedDate}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setQuickFilter("date");
              }}
              className="w-full lg:w-[220px]"
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant={quickFilter === "today" ? "default" : "secondary"} onClick={() => handleQuickFilter("today")}>
              Hoje
            </Button>
            <Button variant={quickFilter === "tomorrow" ? "default" : "secondary"} onClick={() => handleQuickFilter("tomorrow")}>
              Amanha
            </Button>
            <Button variant={quickFilter === "week" ? "default" : "secondary"} onClick={() => handleQuickFilter("week")}>
              Esta semana
            </Button>
          </div>
        </div>
      </header>

      <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <DashboardStatCard
          label="Agendamentos hoje"
          value={todayCount}
          subtitle="Agenda ativa no dia atual"
          icon={Calendar}
          iconClassName="text-blue-300"
          loading={allAppointmentsQuery.isLoading}
          variation={dayDiffLabel(todayCount, yesterdayCount)}
        />
        <DashboardStatCard
          label="Pendentes"
          value={pendingTodayCount}
          subtitle="Aguardando confirmacao hoje"
          icon={Clock}
          iconClassName="text-amber-300"
          loading={allAppointmentsQuery.isLoading}
          variation={dayDiffLabel(pendingTodayCount, pendingYesterdayCount)}
        />
        <DashboardStatCard
          label="Total de clientes"
          value={totalClients}
          subtitle="Clientes com historico na agenda"
          icon={Users}
          iconClassName="text-primary"
          loading={allAppointmentsQuery.isLoading}
        />
        <DashboardStatCard
          label="Concluidos"
          value={completedTodayCount}
          subtitle="Atendimentos finalizados hoje"
          icon={CheckCircle2}
          iconClassName="text-emerald-300"
          loading={allAppointmentsQuery.isLoading}
          variation={dayDiffLabel(completedTodayCount, completedYesterdayCount)}
        />
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <article className="glass-card p-5 border border-border/60 xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-semibold text-foreground">{periodTitle}</h2>
              <p className="text-sm text-muted-foreground">
                {quickFilter === "week"
                  ? `Periodo ${weekRange.startLabel} a ${weekRange.endLabel}`
                  : `Data selecionada: ${format(parseYMDToLocalDate(selectedDate), "dd/MM/yyyy", { locale: ptBR })}`}
              </p>
            </div>
            {!listLoading && (
              <Badge variant="outline" className="border-border/70 text-muted-foreground">
                {selectedList.length} item(ns)
              </Badge>
            )}
          </div>

          {actionError && <p className="text-sm text-rose-300">{actionError}</p>}

          {listLoading && (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="h-24 rounded-xl border border-border/60 bg-background/30 animate-pulse" />
              ))}
            </div>
          )}

          {listError && !listLoading && (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-200">
              Nao foi possivel carregar os agendamentos deste periodo. Tente novamente em instantes.
            </div>
          )}

          {!listLoading && !listError && quickFilter !== "week" && selectedList.length === 0 && (
            <div className="rounded-xl border border-border/60 bg-background/30 p-6 text-sm text-muted-foreground text-center">
              Nenhum agendamento encontrado para este dia.
            </div>
          )}

          {!listLoading && !listError && quickFilter !== "week" && selectedList.length > 0 && (
            <div className="space-y-3">
              {selectedList.map((apt) => (
                <DashboardAppointmentItem
                  key={apt.id}
                  appointment={apt}
                  onConfirm={(id) => statusMutation.mutate({ id, status: "confirmed" })}
                  onCancel={(id) => statusMutation.mutate({ id, status: "cancelled" })}
                  actionLoadingId={statusMutation.isPending ? statusMutation.variables?.id : null}
                />
              ))}
            </div>
          )}

          {!listLoading && !listError && quickFilter === "week" && groupedWeek.length === 0 && (
            <div className="rounded-xl border border-border/60 bg-background/30 p-6 text-sm text-muted-foreground text-center">
              Nenhum agendamento encontrado para esta semana.
            </div>
          )}

          {!listLoading && !listError && quickFilter === "week" && groupedWeek.length > 0 && (
            <div className="space-y-4">
              {groupedWeek.map(([day, items]) => (
                <div key={day} className="space-y-3">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {format(parseYMDToLocalDate(day), "EEEE, dd/MM", { locale: ptBR })}
                  </p>
                  <div className="space-y-3">
                    {items.map((apt) => (
                      <DashboardAppointmentItem
                        key={apt.id}
                        appointment={apt}
                        compactDate
                        onConfirm={(id) => statusMutation.mutate({ id, status: "confirmed" })}
                        onCancel={(id) => statusMutation.mutate({ id, status: "cancelled" })}
                        actionLoadingId={statusMutation.isPending ? statusMutation.variables?.id : null}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="glass-card p-5 border border-border/60 space-y-4">
          <h2 className="font-display text-xl font-semibold text-foreground">Insights do dia</h2>
          <div className="space-y-2">
            {insights.map((insight, idx) => (
              <div key={idx} className="rounded-lg border border-border/60 bg-background/30 p-3 text-sm text-muted-foreground">
                {insight}
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="glass-card p-5 border border-border/60 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-semibold text-foreground">Proximos agendamentos</h2>
            <p className="text-sm text-muted-foreground">Agenda futura de pendentes e confirmados.</p>
          </div>
          {hasMoreUpcoming && (
            <Button variant="secondary" size="sm" onClick={() => setShowMoreUpcoming((v) => !v)}>
              {showMoreUpcoming ? "Ver menos" : "Ver mais"}
            </Button>
          )}
        </div>

        {allAppointmentsQuery.isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, idx) => (
              <div key={idx} className="h-20 rounded-xl border border-border/60 bg-background/30 animate-pulse" />
            ))}
          </div>
        )}

        {!allAppointmentsQuery.isLoading && visibleUpcoming.length === 0 && (
          <div className="rounded-xl border border-border/60 bg-background/30 p-6 text-sm text-muted-foreground text-center">
            Nenhum agendamento futuro encontrado.
          </div>
        )}

        {!allAppointmentsQuery.isLoading && visibleUpcoming.length > 0 && (
          <div className="space-y-3">
            {visibleUpcoming.map((apt) => (
              <div key={apt.id} className="rounded-xl border border-border/60 bg-background/30 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-foreground truncate">{apt.nomeCliente || "Cliente sem nome"}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {apt.servico || "Servico nao informado"} • {apt.horario || "--:--"}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="border-border/70 text-muted-foreground">
                    {formatDateLabel(apt.data)}
                  </Badge>
                  <Badge className="border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                    {apt.status === "confirmed" ? "Confirmado" : "Pendente"}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
