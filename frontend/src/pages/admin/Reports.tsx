import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useAdminProfessionalContext } from "@/hooks/useAdminProfessionalContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import {
  Activity,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clock,
  Sparkles,
  TrendingUp,
  Users,
  Wrench,
  XCircle,
} from "lucide-react";
import {
  addDays,
  endOfDay,
  endOfMonth,
  format,
  parseISO,
  startOfDay,
  startOfMonth,
  subDays,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, XAxis, YAxis } from "recharts";

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
  pagination?: {
    totalPages?: number;
  };
};

type PeriodPreset = "today" | "7d" | "next7" | "30d" | "month" | "custom";

type PeriodRow = {
  a: ApiAgendamento;
  dateISO: string;
  dt: Date;
};

type Summary = {
  completed: number;
  confirmed: number;
  pending: number;
  cancelled: number;
  total: number;
  clients: number;
  servicesDone: number;
  conversionRate: number;
  avgPerClient: number;
  peakHour: string;
  peakWeekday: string;
};

const evolutionChartConfig = {
  total: { label: "Total", color: "#3b82f6" },
  completed: { label: "Concluidos", color: "#22c55e" },
} satisfies ChartConfig;

const statusChartConfig = {
  completed: { label: "Concluidos", color: "#22c55e" },
  confirmed: { label: "Confirmados", color: "#3b82f6" },
  pending: { label: "Pendentes", color: "#f59e0b" },
  cancelled: { label: "Cancelados", color: "#ef4444" },
} satisfies ChartConfig;

function onlyDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function toLocalDateKey(isoLike: string) {
  const s = String(isoLike || "").trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return format(d, "yyyy-MM-dd");
  return s.slice(0, 10);
}

function getAppointmentDateISO(a: ApiAgendamento) {
  const inicio = a?.InicioEm ? String(a.InicioEm) : "";
  if (inicio) {
    try {
      return format(parseISO(inicio), "yyyy-MM-dd");
    } catch {}
  }
  return toLocalDateKey(a?.DataAgendada || "");
}

function parseAppointmentLocalDateTime(a: ApiAgendamento): Date {
  if (a?.InicioEm) {
    const d = new Date(String(a.InicioEm));
    if (!Number.isNaN(d.getTime())) return d;
  }

  const datePart = a?.DataAgendada ? new Date(String(a.DataAgendada)) : null;
  const hPart = a?.HoraAgendada ? new Date(String(a.HoraAgendada)) : null;
  if (datePart && !Number.isNaN(datePart.getTime())) {
    const base = new Date(datePart.getFullYear(), datePart.getMonth(), datePart.getDate(), 0, 0, 0, 0);
    if (hPart && !Number.isNaN(hPart.getTime())) {
      base.setHours(hPart.getUTCHours(), hPart.getUTCMinutes(), hPart.getUTCSeconds(), 0);
    }
    return base;
  }

  return new Date(0);
}

function percentVsPrevious(current: number, previous: number) {
  if (previous === 0) {
    if (current === 0) return null;
    return { text: "novo vs periodo anterior", positive: true };
  }
  const diff = ((current - previous) / previous) * 100;
  if (!Number.isFinite(diff)) return null;
  if (Math.abs(diff) < 0.0001) return { text: "0% vs periodo anterior", positive: true };
  const arrow = diff >= 0 ? "↑" : "↓";
  const sign = diff >= 0 ? "+" : "-";
  return { text: `${arrow} ${sign}${Math.abs(diff).toFixed(1)}% vs periodo anterior`, positive: diff >= 0 };
}

function summarize(rows: PeriodRow[]): Summary {
  const completedRows = rows.filter((x) => x.a.AgendamentoStatus === "completed");
  const confirmedRows = rows.filter((x) => x.a.AgendamentoStatus === "confirmed");
  const pendingRows = rows.filter((x) => x.a.AgendamentoStatus === "pending");
  const cancelledRows = rows.filter((x) => x.a.AgendamentoStatus === "cancelled");
  const nonCancelled = rows.filter((x) => x.a.AgendamentoStatus !== "cancelled");

  const clients = new Set(completedRows.map((x) => onlyDigits(x.a.ClienteWhatsapp)).filter(Boolean)).size;
  const servicesDone = completedRows.length;
  const conversionRate = nonCancelled.length ? Math.round((completedRows.length / nonCancelled.length) * 100) : 0;
  const avgPerClient = clients ? servicesDone / clients : 0;

  const hourCount = new Map<string, number>();
  const weekdayCount = new Map<string, number>();
  for (const { dt } of rows) {
    const hour = format(dt, "HH:00");
    const weekday = format(dt, "EEEE", { locale: ptBR });
    hourCount.set(hour, (hourCount.get(hour) || 0) + 1);
    weekdayCount.set(weekday, (weekdayCount.get(weekday) || 0) + 1);
  }
  const peakHour = Array.from(hourCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "--";
  const peakWeekday = Array.from(weekdayCount.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "--";

  return {
    completed: completedRows.length,
    confirmed: confirmedRows.length,
    pending: pendingRows.length,
    cancelled: cancelledRows.length,
    total: rows.length,
    clients,
    servicesDone,
    conversionRate,
    avgPerClient,
    peakHour,
    peakWeekday,
  };
}

export default function Reports() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const { profissionalIdParam } = useAdminProfessionalContext(slug);

  const { data: agData, isLoading } = useQuery({
    queryKey: ["reports", "appointments", slug, profissionalIdParam],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("status", "todos");
      params.set("page", "1");
      params.set("pageSize", "50");
      if (profissionalIdParam) params.set("profissionalId", String(profissionalIdParam));

      const first = await apiGet<ApiAgendamentosResponse>(`/api/empresas/${encodeURIComponent(slug)}/agendamentos?${params.toString()}`);
      const firstItems = Array.isArray((first as any)?.agendamentos) ? (first as any).agendamentos : [];
      const totalPages = Number((first as any)?.pagination?.totalPages || 1);
      if (totalPages <= 1) return { ok: true, agendamentos: firstItems };

      const rest = await Promise.all(
        Array.from({ length: totalPages - 1 }).map((_, i) => {
          const page = i + 2;
          const p = new URLSearchParams(params);
          p.set("page", String(page));
          return apiGet<ApiAgendamentosResponse>(`/api/empresas/${encodeURIComponent(slug)}/agendamentos?${p.toString()}`);
        }),
      );

      const all = [...firstItems];
      for (const pageData of rest) {
        if (Array.isArray((pageData as any)?.agendamentos)) all.push(...(pageData as any).agendamentos);
      }
      return { ok: true, agendamentos: all };
    },
  });

  const rawAppointments: any[] = Array.isArray(agData)
    ? (agData as any[])
    : (agData as any)?.agendamentos ?? (agData as any)?.appointments ?? (agData as any)?.itens ?? [];

  const appointments: ApiAgendamento[] = useMemo(() => {
    return rawAppointments
      .map((x) => {
        const statusRaw = String(x?.AgendamentoStatus ?? x?.Status ?? x?.status ?? "").trim().toLowerCase();
        const status: ApiAgendamentoStatus =
          statusRaw === "pending" || statusRaw === "confirmed" || statusRaw === "completed" || statusRaw === "cancelled"
            ? (statusRaw as ApiAgendamentoStatus)
            : "pending";
        return {
          AgendamentoId: Number(x?.AgendamentoId ?? x?.Id ?? x?.id ?? 0),
          ServicoId: Number(x?.ServicoId ?? x?.serviceId ?? x?.ServicoID ?? 0),
          Servico: String(x?.Servico ?? x?.serviceName ?? x?.ServicoNome ?? ""),
          DataAgendada: String(x?.DataAgendada ?? x?.date ?? x?.Data ?? "").slice(0, 10),
          HoraAgendada: String(x?.HoraAgendada ?? x?.time ?? x?.Hora ?? "00:00"),
          InicioEm: String(x?.InicioEm ?? x?.startAt ?? x?.Inicio ?? ""),
          AgendamentoStatus: status,
          ClienteNome: String(x?.ClienteNome ?? x?.clientName ?? x?.NomeCliente ?? ""),
          ClienteWhatsapp: String(x?.ClienteWhatsapp ?? x?.ClienteTelefone ?? x?.clientPhone ?? x?.Whatsapp ?? ""),
        };
      })
      .filter((a) => a.AgendamentoId && a.ServicoId && a.DataAgendada);
  }, [rawAppointments]);

  const [preset, setPreset] = useState<PeriodPreset>("7d");
  const today = new Date();
  const [customFrom, setCustomFrom] = useState<string>(format(today, "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState<string>(format(today, "yyyy-MM-dd"));

  const baseDate = useMemo(() => new Date(), []);
  const range = useMemo(() => {
    if (preset === "today") return { from: startOfDay(baseDate), to: endOfDay(baseDate) };
    if (preset === "7d") return { from: startOfDay(subDays(baseDate, 6)), to: endOfDay(baseDate) };
    if (preset === "next7") return { from: startOfDay(baseDate), to: endOfDay(addDays(baseDate, 6)) };
    if (preset === "30d") return { from: startOfDay(subDays(baseDate, 29)), to: endOfDay(baseDate) };
    if (preset === "month") return { from: startOfDay(startOfMonth(baseDate)), to: endOfDay(endOfMonth(baseDate)) };
    const from = customFrom ? parseISO(customFrom) : startOfDay(baseDate);
    const to = customTo ? parseISO(customTo) : from;
    return { from: startOfDay(from), to: endOfDay(to) };
  }, [preset, customFrom, customTo, baseDate]);

  const rangeISO = useMemo(
    () => ({ fromISO: format(range.from, "yyyy-MM-dd"), toISO: format(range.to, "yyyy-MM-dd") }),
    [range],
  );

  const periodRows = useMemo(() => {
    return appointments
      .map((a) => ({ a, dateISO: getAppointmentDateISO(a), dt: parseAppointmentLocalDateTime(a) }))
      .filter((x) => x.dateISO >= rangeISO.fromISO && x.dateISO <= rangeISO.toISO)
      .sort((a, b) => a.dt.getTime() - b.dt.getTime());
  }, [appointments, rangeISO.fromISO, rangeISO.toISO]);

  const previousRange = useMemo(() => {
    const days = Math.max(1, Math.floor((range.to.getTime() - range.from.getTime()) / (24 * 60 * 60 * 1000)) + 1);
    return {
      from: startOfDay(subDays(range.from, days)),
      to: endOfDay(subDays(range.to, days)),
    };
  }, [range]);

  const previousRangeISO = useMemo(
    () => ({ fromISO: format(previousRange.from, "yyyy-MM-dd"), toISO: format(previousRange.to, "yyyy-MM-dd") }),
    [previousRange],
  );

  const previousRows = useMemo(() => {
    if (preset === "custom") return [];
    return appointments
      .map((a) => ({ a, dateISO: getAppointmentDateISO(a), dt: parseAppointmentLocalDateTime(a) }))
      .filter((x) => x.dateISO >= previousRangeISO.fromISO && x.dateISO <= previousRangeISO.toISO);
  }, [appointments, previousRangeISO.fromISO, previousRangeISO.toISO, preset]);

  const summary = useMemo(() => summarize(periodRows), [periodRows]);
  const previousSummary = useMemo(() => summarize(previousRows), [previousRows]);

  const dailySeries = useMemo(() => {
    const byDay = new Map<string, { date: string; label: string; total: number; completed: number }>();
    for (const x of periodRows) {
      const date = format(x.dt, "yyyy-MM-dd");
      const current = byDay.get(date) || { date, label: format(parseISO(date), "dd/MM"), total: 0, completed: 0 };
      current.total += 1;
      if (x.a.AgendamentoStatus === "completed") current.completed += 1;
      byDay.set(date, current);
    }
    return Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [periodRows]);

  const topServices = useMemo(() => {
    const map = new Map<number, { id: number; name: string; qty: number }>();
    for (const x of periodRows) {
      if (x.a.AgendamentoStatus !== "completed") continue;
      const current = map.get(x.a.ServicoId) || { id: x.a.ServicoId, name: x.a.Servico, qty: 0 };
      current.qty += 1;
      current.name = x.a.Servico || current.name;
      map.set(x.a.ServicoId, current);
    }
    return Array.from(map.values()).sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name)).slice(0, 6);
  }, [periodRows]);

  const topClients = useMemo(() => {
    const map = new Map<string, { phone: string; name: string; visits: number }>();
    for (const x of periodRows) {
      if (x.a.AgendamentoStatus !== "completed") continue;
      const phone = onlyDigits(x.a.ClienteWhatsapp);
      const current = map.get(phone) || { phone, name: x.a.ClienteNome || "--", visits: 0 };
      current.visits += 1;
      current.name = x.a.ClienteNome || current.name;
      map.set(phone, current);
    }
    return Array.from(map.values()).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name)).slice(0, 6);
  }, [periodRows]);

  const statusData = [
    { key: "completed", label: "Concluidos", value: summary.completed, color: "#22c55e", icon: CheckCircle2 },
    { key: "confirmed", label: "Confirmados", value: summary.confirmed, color: "#3b82f6", icon: Activity },
    { key: "pending", label: "Pendentes", value: summary.pending, color: "#f59e0b", icon: Clock },
    { key: "cancelled", label: "Cancelados", value: summary.cancelled, color: "#ef4444", icon: XCircle },
  ];

  const insights = useMemo(() => {
    const leaderService = topServices[0];
    const leaderClient = topClients[0];
    const cancelRate = summary.total ? Math.round((summary.cancelled / summary.total) * 100) : 0;
    const top3Visits = topClients.slice(0, 3).reduce((acc, item) => acc + item.visits, 0);
    const concentration = summary.servicesDone ? Math.round((top3Visits / summary.servicesDone) * 100) : 0;
    const bestDay = dailySeries.slice().sort((a, b) => b.total - a.total)[0];

    return [
      leaderService
        ? `Servico destaque: ${leaderService.name} liderou com ${leaderService.qty} concluidos.`
        : "Ainda nao ha servicos concluidos para gerar destaque.",
      bestDay
        ? `Dia mais forte: ${bestDay.label} teve ${bestDay.total} agendamentos no periodo.`
        : "Ainda nao ha volume suficiente para identificar o dia mais forte.",
      summary.cancelled > 0
        ? `Atencao aos cancelamentos: ${summary.cancelled} no periodo (${cancelRate}% do total).`
        : "Sem cancelamentos no periodo selecionado.",
      leaderClient
        ? `Cliente mais ativo: ${leaderClient.name} com ${leaderClient.visits} visita(s) concluida(s).`
        : "Ainda nao ha cliente frequente suficiente para ranking.",
      summary.servicesDone > 0
        ? `Concentracao de agenda: top 3 clientes somam ${concentration}% dos concluidos.`
        : "Sem concluidos para analisar concentracao de clientes.",
    ];
  }, [dailySeries, summary.cancelled, summary.servicesDone, summary.total, topClients, topServices]);

  const periodLabel: Record<PeriodPreset, string> = {
    today: "Hoje",
    "7d": "Ultimos 7 dias",
    next7: "Prox. 7 dias",
    "30d": "Ultimos 30 dias",
    month: "Mes",
    custom: "Personalizado",
  };

  const rangeText = `${format(range.from, "dd/MM/yyyy")} -> ${format(range.to, "dd/MM/yyyy")}`;
  const maxServiceQty = Math.max(1, ...topServices.map((s) => s.qty));
  const maxClientVisits = Math.max(1, ...topClients.map((c) => c.visits));

  return (
    <div className="space-y-6 pb-6">
      <section className="glass-card p-5 md:p-6 space-y-4 border-primary/20">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs text-primary">
              <Sparkles size={14} />
              Dashboard analitico
            </div>
            <h1 className="font-display text-3xl font-bold text-foreground flex items-center gap-3">
              <BarChart3 className="text-primary" size={28} />
              Relatorios
            </h1>
            <p className="text-sm text-muted-foreground">
              Visao operacional inteligente para apoiar decisoes rapidas do dia a dia.
            </p>
            <p className="text-xs text-muted-foreground">
              Empresa: <span className="text-foreground font-medium">{slug}</span> • Periodo ativo:{" "}
              <span className="text-foreground font-medium">{rangeText}</span>
            </p>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/30 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">{periodLabel[preset]}</p>
            <div className="flex flex-wrap gap-2">
              {(["today", "7d", "next7", "30d", "month", "custom"] as const).map((p) => (
                <Button key={p} variant={p === preset ? "default" : "secondary"} onClick={() => setPreset(p)} className="h-8">
                  {periodLabel[p]}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {preset === "custom" && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-2 items-end">
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Data inicial</p>
              <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-9" />
            </div>
            <div className="text-muted-foreground text-xs px-2 pb-2">ate</div>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Data final</p>
              <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-9" />
            </div>
          </div>
        )}
      </section>

      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          {
            title: "Concluidos",
            value: summary.completed,
            subtitle: "Atendimentos finalizados",
            icon: CheckCircle2,
            color: "text-emerald-400",
            variation: percentVsPrevious(summary.completed, previousSummary.completed),
          },
          {
            title: "Clientes atendidos",
            value: summary.clients,
            subtitle: `${summary.avgPerClient.toFixed(2)} servicos por cliente`,
            icon: Users,
            color: "text-blue-400",
            variation: percentVsPrevious(summary.clients, previousSummary.clients),
          },
          {
            title: "Servicos prestados",
            value: summary.servicesDone,
            subtitle: `Conversao ${summary.conversionRate}%`,
            icon: Wrench,
            color: "text-primary",
            variation: percentVsPrevious(summary.servicesDone, previousSummary.servicesDone),
          },
          {
            title: "Volume no periodo",
            value: summary.total,
            subtitle: `${summary.peakWeekday} as ${summary.peakHour}`,
            icon: TrendingUp,
            color: "text-yellow-400",
            variation: percentVsPrevious(summary.total, previousSummary.total),
          },
        ].map((card) => (
          <article key={card.title} className="glass-card p-5 space-y-3 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40">
            <div className="flex items-start justify-between">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.title}</p>
              <div className={`rounded-lg border border-border/60 bg-background/40 p-2 ${card.color}`}>
                <card.icon size={16} />
              </div>
            </div>
            <p className="font-display text-3xl font-bold text-foreground">{isLoading ? "--" : card.value}</p>
            <p className="text-xs text-muted-foreground">{card.subtitle}</p>
            {preset !== "custom" && card.variation && (
              <p className={`text-xs ${card.variation.positive ? "text-emerald-300" : "text-rose-300"}`}>{card.variation.text}</p>
            )}
          </article>
        ))}
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <article className="glass-card p-5 space-y-4 xl:col-span-2">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Tendencia de movimento</h2>
            <p className="text-sm text-muted-foreground">Evolucao diaria de volume total e concluidos.</p>
          </div>

          {dailySeries.length === 0 ? (
            <div className="h-64 rounded-lg border border-dashed border-border/70 bg-background/20 flex items-center justify-center text-sm text-muted-foreground">
              Nenhum agendamento no periodo.
            </div>
          ) : (
            <ChartContainer config={evolutionChartConfig} className="h-64 w-full">
              <LineChart data={dailySeries} margin={{ top: 10, right: 12, left: -12, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis tickLine={false} axisLine={false} width={36} />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.label || ""}
                      formatter={(value, name) => `${name}: ${Number(value || 0)}`}
                    />
                  }
                />
                <Bar dataKey="total" fill="var(--color-total)" radius={[6, 6, 0, 0]} />
                <Line type="monotone" dataKey="completed" stroke="var(--color-completed)" strokeWidth={3} dot={false} />
              </LineChart>
            </ChartContainer>
          )}
        </article>

        <article className="glass-card p-5 space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Status no periodo</h2>
            <p className="text-sm text-muted-foreground">Distribuicao atual da agenda.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-4 items-center">
            <ChartContainer config={statusChartConfig} className="h-36 w-full">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="label" innerRadius={38} outerRadius={58} paddingAngle={3}>
                  {statusData.map((item) => (
                    <Cell key={item.key} fill={item.color} />
                  ))}
                </Pie>
                <ChartTooltip content={<ChartTooltipContent formatter={(value, name) => `${name}: ${value}`} />} />
              </PieChart>
            </ChartContainer>

            <div className="space-y-2">
              {statusData.map((item) => (
                <div key={item.key} className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <item.icon size={14} style={{ color: item.color }} />
                    <span className="text-sm text-muted-foreground">{item.label}</span>
                  </div>
                  <span className="font-semibold text-foreground">{isLoading ? "--" : item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <article className="glass-card p-5 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Top servicos</h2>
          {topServices.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem servicos concluidos no periodo.</p>
          ) : (
            <div className="space-y-3">
              {topServices.map((row, index) => (
                <div key={row.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <p className="font-medium text-foreground truncate pr-2">
                      #{index + 1} {row.name}
                    </p>
                    <span className="text-muted-foreground">{row.qty}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
                    <div className="h-full bg-primary rounded-full" style={{ width: `${Math.max(8, (row.qty / maxServiceQty) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="glass-card p-5 space-y-4">
          <h2 className="text-lg font-semibold text-foreground">Top clientes</h2>
          {topClients.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem clientes concluidos no periodo.</p>
          ) : (
            <div className="space-y-3">
              {topClients.map((row, index) => (
                <div key={row.phone || `${row.name}-${index}`} className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">
                        #{index + 1} {row.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{row.phone || "--"}</p>
                    </div>
                    <span className="text-sm text-muted-foreground">{row.visits} visita(s)</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${Math.max(8, (row.visits / maxClientVisits) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>

      <section className="glass-card p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-primary" />
          <h2 className="text-lg font-semibold text-foreground">Insights da Sheila</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {insights.map((insight, idx) => (
            <div key={idx} className="rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-sm text-muted-foreground">
              {insight}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
