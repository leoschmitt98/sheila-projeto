import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

export type DashboardStatus = "pending" | "confirmed" | "completed" | "cancelled";

export type DashboardAppointment = {
  id: number;
  nomeCliente: string;
  servico: string;
  data: string;
  horario: string;
  status: DashboardStatus;
  telefone?: string;
  observacao?: string;
};

export function onlyDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

export function formatHHMM(value?: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;

  const isoMatch = raw.match(/T(\d{2}:\d{2})/) || raw.match(/\s(\d{2}:\d{2})/);
  if (isoMatch?.[1]) return isoMatch[1];

  return raw.slice(11, 16) || raw.slice(0, 5);
}

export function toYMD(value?: string) {
  return String(value || "").slice(0, 10);
}

export function localYMD(date: Date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseYMDToLocalDate(ymd: string) {
  const [y, m, d] = String(ymd || "").split("-").map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function buildDateTimeFromAppointment(apt: {
  DataAgendada?: string;
  HoraAgendada?: string;
  InicioEm?: string;
}) {
  const ymd = toYMD(apt.DataAgendada || "");
  const hhmm = formatHHMM(apt.HoraAgendada || apt.InicioEm || "");

  if (/^\d{4}-\d{2}-\d{2}$/.test(ymd) && /^\d{2}:\d{2}$/.test(hhmm)) {
    const [y, m, d] = ymd.split("-").map(Number);
    const [h, min] = hhmm.split(":").map(Number);
    return new Date(y, m - 1, d, h, min, 0, 0);
  }

  const fallback = new Date(String(apt.InicioEm || ""));
  if (!Number.isNaN(fallback.getTime())) return fallback;
  return parseYMDToLocalDate(ymd);
}

export function formatDateLabel(ymd: string) {
  const dt = parseYMDToLocalDate(ymd);
  if (isToday(dt)) return "Hoje";
  if (isTomorrow(dt)) return "Amanhã";
  return format(dt, "EEE, dd/MM", { locale: ptBR });
}

export function dayDiffLabel(current: number, previous: number) {
  if (current === previous) return { text: "0% vs ontem", tone: "neutral" as const };
  if (previous === 0 && current > 0) return { text: "novo vs ontem", tone: "positive" as const };
  if (previous === 0 && current === 0) return { text: "0% vs ontem", tone: "neutral" as const };

  const percent = ((current - previous) / Math.abs(previous)) * 100;
  const positive = percent > 0;
  return {
    text: `${positive ? "+" : "-"}${Math.abs(percent).toFixed(0)}% vs ontem`,
    tone: positive ? ("positive" as const) : ("negative" as const),
  };
}

export function statusLabel(status: DashboardStatus) {
  if (status === "confirmed") return "Confirmado";
  if (status === "completed") return "Concluído";
  if (status === "cancelled") return "Cancelado";
  return "Pendente";
}

export function statusBadgeClass(status: DashboardStatus) {
  if (status === "confirmed") return "border-emerald-500/30 bg-emerald-500/15 text-emerald-300";
  if (status === "completed") return "border-blue-500/30 bg-blue-500/15 text-blue-300";
  if (status === "cancelled") return "border-rose-500/30 bg-rose-500/15 text-rose-300";
  return "border-amber-500/30 bg-amber-500/15 text-amber-300";
}

export function parseSafeISO(value: string) {
  try {
    return parseISO(value);
  } catch {
    return new Date();
  }
}
