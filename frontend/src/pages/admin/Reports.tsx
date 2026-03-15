import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useAdminProfessionalContext } from "@/hooks/useAdminProfessionalContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  BarChart3,
  Calendar,
  DollarSign,
  Users,
  Wrench,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
} from "lucide-react";
import {
  format,
  startOfDay,
  endOfDay,
  subDays,
  addDays,
  startOfMonth,
  endOfMonth,
  parseISO,
  isValid,
} from "date-fns";
import { ptBR } from "date-fns/locale";

/* =======================
   TIPOS (API)
======================= */

type ApiAgendamentoStatus = "pending" | "confirmed" | "completed" | "cancelled";

type ApiAgendamento = {
  AgendamentoId: number;
  ServicoId: number;
  Servico: string;
  DataAgendada: string; // YYYY-MM-DD
  HoraAgendada: string; // HH:mm:ss ou HH:mm
  InicioEm: string; // ISO (pode vir com timezone)
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

function onlyDigits(v: string) {
  return String(v || "").replace(/\D/g, "");
}

function formatHHMM(hora: string) {
  const h = String(hora || "").trim();
  if (!h) return "00:00";

  // Caso venha como ISO datetime (ex: "1970-01-01T10:30:00.000Z")
  if (h.includes("T")) {
    const timePart = h.split("T")[1] || "";
    // timePart pode ser "10:30:00.000Z"
    if (timePart.length >= 5) return timePart.slice(0, 5);
  }

  // Caso venha como "HH:mm:ss" ou "HH:mm"
  const m = h.match(/(\d{2}):(\d{2})/);
  if (m) return `${m[1]}:${m[2]}`;

  // fallback: se tiver 5+ chars assume que começa com HH:mm
  if (h.length >= 5) return h.slice(0, 5);
  return "00:00";
}



function toLocalDateKey(isoLike: string) {
  const s = String(isoLike || "").trim();
  if (!s) return "";
  // Se vier "YYYY-MM-DD", mantém.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // Se vier ISO completo (com Z ou offset), converte para dia LOCAL.
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return format(d, "yyyy-MM-dd");
  }

  // fallback: tenta pegar os 10 primeiros chars
  return s.slice(0, 10);
}





function getAppointmentDateISO(a: any) {
  // Prefer InicioEm (datetime) because it reflects the real local day/time of the appointment.
  const inicio = a?.InicioEm ? String(a.InicioEm) : "";
  if (inicio) {
    try {
      return format(parseISO(inicio), "yyyy-MM-dd");
    } catch {}
  }

  // Fallback to DataAgendada
  const da = a?.DataAgendada ? String(a.DataAgendada) : "";
  return toLocalDateKey(da);
}




function parseAppointmentLocalDateTime(a: any): Date {
  // Preferir InicioEm (já vem com data+hora)
  if (a?.InicioEm) {
    const d = new Date(String(a.InicioEm));
    if (!isNaN(d.getTime())) return d;
  }

  // Fallback: DataAgendada + HoraAgendada
  const datePart = a?.DataAgendada ? new Date(String(a.DataAgendada)) : null;
  const hPart = a?.HoraAgendada ? new Date(String(a.HoraAgendada)) : null;

  if (datePart && !isNaN(datePart.getTime())) {
    const base = new Date(datePart.getFullYear(), datePart.getMonth(), datePart.getDate(), 0, 0, 0, 0);
    if (hPart && !isNaN(hPart.getTime())) {
      base.setHours(hPart.getUTCHours(), hPart.getUTCMinutes(), hPart.getUTCSeconds(), 0);
    }
    return base;
  }

  return new Date(0);
}

function formatPriceBRL(price: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(price || 0);
}

type PeriodPreset = "today" | "7d" | "next7" | "30d" | "month" | "custom";

export default function Reports() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const { profissionalIdParam } = useAdminProfessionalContext(slug);

  const { data: agData, isLoading: agLoading } = useQuery({
    queryKey: ["reports", "appointments", slug],
    queryFn: () => apiGet<ApiAgendamentosResponse>(`/api/empresas/${encodeURIComponent(slug)}/agendamentos${profissionalIdParam ? `?profissionalId=${profissionalIdParam}` : ""}`),
  });

  const { data: servData, isLoading: servLoading } = useQuery({
    queryKey: ["reports", "services", slug],
    queryFn: () => apiGet<ApiServicosResponse>(`/api/empresas/${encodeURIComponent(slug)}/servicos?all=1`),
  });

  const isLoading = agLoading || servLoading;

  // ✅ Normaliza respostas da API (evita “tudo zero” quando o backend muda nomes de campos)
  const rawAppointments: any[] =
    Array.isArray(agData)
      ? (agData as any[])
      : (agData as any)?.agendamentos ??
        (agData as any)?.appointments ??
        (agData as any)?.itens ??
        [];

  const rawServices: any[] =
    Array.isArray(servData)
      ? (servData as any[])
      : (servData as any)?.servicos ??
        (servData as any)?.services ??
        (servData as any)?.itens ??
        [];

  const appointments: ApiAgendamento[] = useMemo(() => {
    return rawAppointments
      .map((x) => {
        const statusRaw = String(
          x?.AgendamentoStatus ?? x?.Status ?? x?.status ?? ""
        )
          .trim()
          .toLowerCase();

        const status: ApiAgendamentoStatus =
          statusRaw === "pending" ||
          statusRaw === "confirmed" ||
          statusRaw === "completed" ||
          statusRaw === "cancelled"
            ? (statusRaw as ApiAgendamentoStatus)
            : "pending";

        const data = String(
          x?.DataAgendada ?? x?.date ?? x?.Data ?? ""
        ).slice(0, 10);

        const hora = String(
          x?.HoraAgendada ?? x?.time ?? x?.Hora ?? "00:00"
        );

        return {
          AgendamentoId: Number(x?.AgendamentoId ?? x?.Id ?? x?.id ?? 0),
          ServicoId: Number(x?.ServicoId ?? x?.serviceId ?? x?.ServicoID ?? 0),
          Servico: String(x?.Servico ?? x?.serviceName ?? x?.ServicoNome ?? ""),
          DataAgendada: data,
          HoraAgendada: hora,
          InicioEm: String(x?.InicioEm ?? x?.startAt ?? x?.Inicio ?? ""),
          AgendamentoStatus: status,
          ClienteNome: String(
            x?.ClienteNome ?? x?.clientName ?? x?.NomeCliente ?? ""
          ),
          ClienteWhatsapp: String(
            x?.ClienteWhatsapp ??
              x?.ClienteTelefone ??
              x?.clientPhone ??
              x?.Whatsapp ??
              ""
          ),
        } as ApiAgendamento;
      })
      .filter((a) => a.AgendamentoId && a.ServicoId && a.DataAgendada);
  }, [rawAppointments]);

  const services: ApiServico[] = useMemo(() => {
    return rawServices
      .map((s) => ({
        Id: Number(s?.Id ?? s?.id ?? 0),
        Nome: String(s?.Nome ?? s?.name ?? ""),
        Preco: Number(s?.Preco ?? s?.price ?? 0),
      }))
      .filter((s) => s.Id);
  }, [rawServices]);

  const servicePriceById = useMemo(() => {
    const m = new Map<number, number>();
    services.forEach((s) => m.set(s.Id, Number(s.Preco) || 0));
    return m;
  }, [services]);

  /* =======================
     FILTRO DE PERÍODO
  ======================= */

  const [preset, setPreset] = useState<PeriodPreset>("7d");

  const systemToday = new Date();

  // 🔎 Para testes (quando existem agendamentos no "futuro"), usamos como "data base"
  // a MAIOR DataAgendada encontrada. Assim os presets (Hoje/7d/30d/Mês) ficam coerentes
  // com os dados que você está vendo na tela.
  const baseDate = useMemo(() => new Date(), []);

const [customFrom, setCustomFrom] = useState<string>(format(systemToday, "yyyy-MM-dd"));
  const [customTo, setCustomTo] = useState<string>(format(systemToday, "yyyy-MM-dd"));

  const range = useMemo(() => {
  // Observação: aqui "7 dias" e "30 dias" significam ÚLTIMOS X dias (inclui hoje).
  // Também temos "Próx. 7 dias" para olhar agenda futura.
  if (preset === "today") {
    return { from: startOfDay(baseDate), to: endOfDay(baseDate) };
  }
  if (preset === "7d") {
    return { from: startOfDay(subDays(baseDate, 6)), to: endOfDay(baseDate) };
  }
  if (preset === "next7") {
    return { from: startOfDay(baseDate), to: endOfDay(addDays(baseDate, 6)) };
  }
  if (preset === "30d") {
    return { from: startOfDay(subDays(baseDate, 29)), to: endOfDay(baseDate) };
  }
  if (preset === "month") {
    const start = startOfMonth(baseDate);
    const end = endOfMonth(baseDate);
    return { from: startOfDay(start), to: endOfDay(end) };
  }

  // custom
  const from = customFrom ? parseISO(customFrom) : startOfDay(baseDate);
  const to = customTo ? parseISO(customTo) : from;
  return { from: startOfDay(from), to: endOfDay(to) };
}, [preset, baseDate, customFrom, customTo]);

const rangeISO = useMemo(() => ({
    fromISO: format(range.from, "yyyy-MM-dd"),
    toISO: format(range.to, "yyyy-MM-dd"),
  }), [range]);

  const inRangeISO = (isoDate: string) => isoDate >= rangeISO.fromISO && isoDate <= rangeISO.toISO;

  const inPeriod = useMemo(() => {
    return appointments
      .map((a) => ({ a, dateISO: getAppointmentDateISO(a), dt: parseAppointmentLocalDateTime(a) }))
      .filter((x) => inRangeISO(x.dateISO))
      .sort((x, y) => x.dt.getTime() - y.dt.getTime());
  }, [appointments, range]);

  const completed = useMemo(() => inPeriod.filter((x) => x.a.AgendamentoStatus === "completed"), [inPeriod]);
  const confirmed = useMemo(() => inPeriod.filter((x) => x.a.AgendamentoStatus === "confirmed"), [inPeriod]);
  const pending = useMemo(() => inPeriod.filter((x) => x.a.AgendamentoStatus === "pending"), [inPeriod]);
  const cancelled = useMemo(() => inPeriod.filter((x) => x.a.AgendamentoStatus === "cancelled"), [inPeriod]);
  const nonCancelled = useMemo(() => inPeriod.filter((x) => x.a.AgendamentoStatus !== "cancelled"), [inPeriod]);

  /* =======================
     MÉTRICAS
  ======================= */

  const revenue = useMemo(() => {
    return completed.reduce((total, x) => {
      const price = servicePriceById.get(x.a.ServicoId) ?? 0;
      return total + price;
    }, 0);
  }, [completed, servicePriceById]);

  const clientsAttended = useMemo(() => {
    return new Set(completed.map((x) => onlyDigits(x.a.ClienteWhatsapp))).size;
  }, [completed]);

  const servicesDone = completed.length;

  const totalAppointments = inPeriod.length;

  const conversionRate = nonCancelled.length ? Math.round((completed.length / nonCancelled.length) * 100) : 0;

  const avgTicket = servicesDone ? revenue / servicesDone : 0;

  const avgPerClient = clientsAttended ? servicesDone / clientsAttended : 0;

  const peakHour = useMemo(() => {
    const count = new Map<string, number>();
    inPeriod.forEach(({ dt }) => {
      const h = format(dt, "HH:00");
      count.set(h, (count.get(h) || 0) + 1);
    });
    const arr = Array.from(count.entries()).sort((a, b) => b[1] - a[1]);
    return arr[0]?.[0] ?? "—";
  }, [inPeriod]);

  const peakWeekday = useMemo(() => {
    const count = new Map<string, number>();
    inPeriod.forEach(({ dt }) => {
      const w = format(dt, "EEEE", { locale: ptBR });
      count.set(w, (count.get(w) || 0) + 1);
    });
    const arr = Array.from(count.entries()).sort((a, b) => b[1] - a[1]);
    return arr[0]?.[0] ?? "—";
  }, [inPeriod]);

  /* =======================
     TABELAS
  ======================= */

  const topServices = useMemo(() => {
    const map = new Map<number, { id: number; name: string; qty: number; revenue: number }>();
    completed.forEach((x) => {
      const price = servicePriceById.get(x.a.ServicoId) ?? 0;
      const cur = map.get(x.a.ServicoId) || { id: x.a.ServicoId, name: x.a.Servico, qty: 0, revenue: 0 };
      cur.qty += 1;
      cur.revenue += price;
      cur.name = x.a.Servico || cur.name;
      map.set(x.a.ServicoId, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue || b.qty - a.qty || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [completed, servicePriceById]);

  const topClients = useMemo(() => {
    const map = new Map<string, { phone: string; name: string; visits: number; revenue: number }>();
    completed.forEach((x) => {
      const phone = onlyDigits(x.a.ClienteWhatsapp);
      const price = servicePriceById.get(x.a.ServicoId) ?? 0;
      const cur = map.get(phone) || { phone, name: x.a.ClienteNome || "—", visits: 0, revenue: 0 };
      cur.visits += 1;
      cur.revenue += price;
      cur.name = x.a.ClienteNome || cur.name;
      map.set(phone, cur);
    });
    return Array.from(map.values())
      .sort((a, b) => b.revenue - a.revenue || b.visits - a.visits || a.name.localeCompare(b.name))
      .slice(0, 10);
  }, [completed, servicePriceById]);

  const daily = useMemo(() => {
    const map = new Map<string, { date: string; completed: number; revenue: number; total: number }>();
    inPeriod.forEach((x) => {
      const key = format(x.dt, "yyyy-MM-dd");
      const cur = map.get(key) || { date: key, completed: 0, revenue: 0, total: 0 };
      cur.total += 1;
      if (x.a.AgendamentoStatus === "completed") {
        cur.completed += 1;
        cur.revenue += servicePriceById.get(x.a.ServicoId) ?? 0;
      }
      map.set(key, cur);
    });
    return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [inPeriod, servicePriceById]);

  /* =======================
     UI
  ======================= */

  const presetLabel: Record<PeriodPreset, string> = {
    today: "Hoje",
    "7d": "Últimos 7 dias",
    next7: "Próx. 7 dias",
    "30d": "Últimos 30 dias",
    month: "Mês",
    custom: "Personalizado",
  };

  const rangeText = useMemo(() => {
    const from = format(range.from, "dd/MM/yyyy");
    const to = format(range.to, "dd/MM/yyyy");
    return `${from} → ${to}`;
  }, [range]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground flex items-center gap-3">
            <BarChart3 className="text-primary" size={28} />
            Relatórios
          </h1>
          <p className="text-muted-foreground mt-1">
            Dados reais para o Nando acompanhar faturamento, clientes, serviços e desempenho.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Empresa: <span className="text-foreground font-medium">{slug}</span> • Período:{" "}
            <span className="text-foreground font-medium">{rangeText}</span>
          </p>
        </div>

        <div className="glass-card p-3 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex flex-wrap gap-2">
            {(["today", "7d", "next7", "30d", "month", "custom"] as const).map((p) => (
              <Button
                key={p}
                variant={p === preset ? "default" : "secondary"}
                onClick={() => setPreset(p)}
                className="h-9"
              >
                {presetLabel[p]}
              </Button>
            ))}
          </div>

          {preset === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2">
                <Calendar size={16} className="text-muted-foreground" />
                <Input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-9 w-[150px]"
                />
              </div>
              <span className="text-muted-foreground">até</span>
              <Input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-9 w-[150px]"
              />
            </div>
          )}
        </div>
      </div>

      {/* KPIs principais */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
        <div className="glass-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Faturamento (concluídos)</p>
              <p className="font-display text-2xl font-bold text-success">
                {isLoading ? "—" : formatPriceBRL(revenue)}
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-success/20 flex items-center justify-center">
              <DollarSign size={22} className="text-success" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Ticket médio: <span className="text-foreground font-medium">{isLoading ? "—" : formatPriceBRL(avgTicket)}</span>
          </p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Clientes atendidos</p>
              <p className="font-display text-2xl font-bold text-foreground">
                {isLoading ? "—" : clientsAttended}
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Users size={22} className="text-blue-500" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Média serviços/cliente:{" "}
            <span className="text-foreground font-medium">
              {isLoading ? "—" : avgPerClient.toFixed(2)}
            </span>
          </p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Serviços prestados</p>
              <p className="font-display text-2xl font-bold text-foreground">
                {isLoading ? "—" : servicesDone}
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <Wrench size={22} className="text-primary" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Conversão: <span className="text-foreground font-medium">{isLoading ? "—" : `${conversionRate}%`}</span>
          </p>
        </div>

        <div className="glass-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Volume no período</p>
              <p className="font-display text-2xl font-bold text-foreground">
                {isLoading ? "—" : totalAppointments}
              </p>
            </div>
            <div className="w-12 h-12 rounded-xl bg-yellow-500/20 flex items-center justify-center">
              <TrendingUp size={22} className="text-yellow-500" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Pico:{" "}
            <span className="text-foreground font-medium">
              {isLoading ? "—" : `${peakWeekday} • ${peakHour}`}
            </span>
          </p>
        </div>
      </div>

      {/* Status breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">
            Status no período
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-border/50 bg-secondary/40 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Concluídos</p>
                <CheckCircle2 size={18} className="text-success" />
              </div>
              <p className="text-2xl font-bold mt-1">{isLoading ? "—" : completed.length}</p>
            </div>

            <div className="rounded-lg border border-border/50 bg-secondary/40 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Confirmados</p>
                <CheckCircle2 size={18} className="text-blue-500" />
              </div>
              <p className="text-2xl font-bold mt-1">{isLoading ? "—" : confirmed.length}</p>
            </div>

            <div className="rounded-lg border border-border/50 bg-secondary/40 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Pendentes</p>
                <Clock size={18} className="text-yellow-500" />
              </div>
              <p className="text-2xl font-bold mt-1">{isLoading ? "—" : pending.length}</p>
            </div>

            <div className="rounded-lg border border-border/50 bg-secondary/40 p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Cancelados</p>
                <XCircle size={18} className="text-destructive" />
              </div>
              <p className="text-2xl font-bold mt-1">{isLoading ? "—" : cancelled.length}</p>
            </div>
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            Dica: pra faturamento, o Nando deve marcar como <b className="text-foreground">Concluído</b> quando o serviço for feito.
          </p>
        </div>

        <div className="glass-card p-6">
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">
            Evolução (por dia)
          </h2>

          {daily.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground bg-secondary/40">
                  <tr className="border-b border-border/50">
                    <th className="text-left font-medium px-4 py-3">Dia</th>
                    <th className="text-right font-medium px-4 py-3">Total</th>
                    <th className="text-right font-medium px-4 py-3">Concluídos</th>
                    <th className="text-right font-medium px-4 py-3">Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((d) => (
                    <tr key={d.date} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3">
                        {format(parseISO(d.date), "dd/MM (EEE)", { locale: ptBR })}
                      </td>
                      <td className="px-4 py-3 text-right">{d.total}</td>
                      <td className="px-4 py-3 text-right">{d.completed}</td>
                      <td className="px-4 py-3 text-right">{formatPriceBRL(d.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              Nenhum agendamento no período
            </p>
          )}
        </div>
      </div>

      {/* Top tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">
            Top serviços (concluídos)
          </h2>

          {topServices.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground bg-secondary/40">
                  <tr className="border-b border-border/50">
                    <th className="text-left font-medium px-4 py-3">Serviço</th>
                    <th className="text-right font-medium px-4 py-3">Qtd.</th>
                    <th className="text-right font-medium px-4 py-3">Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {topServices.map((row) => (
                    <tr key={row.id} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3">{row.name}</td>
                      <td className="px-4 py-3 text-right">{row.qty}</td>
                      <td className="px-4 py-3 text-right">{formatPriceBRL(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              Nenhum serviço concluído no período
            </p>
          )}
        </div>

        <div className="glass-card p-6">
          <h2 className="font-display text-xl font-semibold text-foreground mb-4">
            Top clientes (concluídos)
          </h2>

          {topClients.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border/50">
              <table className="w-full text-sm">
                <thead className="text-muted-foreground bg-secondary/40">
                  <tr className="border-b border-border/50">
                    <th className="text-left font-medium px-4 py-3">Cliente</th>
                    <th className="text-right font-medium px-4 py-3">Visitas</th>
                    <th className="text-right font-medium px-4 py-3">Faturamento</th>
                  </tr>
                </thead>
                <tbody>
                  {topClients.map((row) => (
                    <tr key={row.phone} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{row.name}</div>
                        <div className="text-xs text-muted-foreground">{row.phone || "—"}</div>
                      </td>
                      <td className="px-4 py-3 text-right">{row.visits}</td>
                      <td className="px-4 py-3 text-right">{formatPriceBRL(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-muted-foreground text-center py-8">
              Nenhum cliente atendido no período
            </p>
          )}
        </div>
      </div>

      {/* Insights box */}
      <div className="glass-card p-6">
        <h2 className="font-display text-xl font-semibold text-foreground mb-3">
          Insights rápidos
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-lg border border-border/50 bg-secondary/40 p-4">
            <p className="text-xs text-muted-foreground">Melhor horário (volume)</p>
            <p className="text-lg font-bold">{isLoading ? "—" : peakHour}</p>
          </div>

          <div className="rounded-lg border border-border/50 bg-secondary/40 p-4">
            <p className="text-xs text-muted-foreground">Melhor dia da semana</p>
            <p className="text-lg font-bold capitalize">{isLoading ? "—" : peakWeekday}</p>
          </div>

          <div className="rounded-lg border border-border/50 bg-secondary/40 p-4">
            <p className="text-xs text-muted-foreground">Eficiência (conversão)</p>
            <p className="text-lg font-bold">{isLoading ? "—" : `${conversionRate}%`}</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground mt-4">
          Quer deixar ainda mais “profissa”? Próximo upgrade é salvar o preço do serviço no agendamento
          no momento do agendamento (snapshot), pra manter histórico mesmo se o preço mudar depois.
        </p>
      </div>
    </div>
  );
}
