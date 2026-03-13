import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { apiDelete, apiGet, apiPut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Calendar as CalIcon,
  Phone,
  Trash2,
  CheckCircle,
  XCircle,
  CheckCheck,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

type ApiAgendamentoStatus = "pending" | "confirmed" | "completed" | "cancelled";

type ApiAgendamento = {
  AgendamentoId: number;
  EmpresaId: number;
  AtendimentoId: number;
  ServicoId: number;
  Servico: string;
  DataAgendada: string; // ISO
  HoraAgendada: string; // ISO (1970-01-01T08:30:00.000Z)
  DuracaoMin: number;
  InicioEm: string; // ISO
  FimEm: string; // ISO
  AgendamentoStatus: ApiAgendamentoStatus;
  Observacoes?: string | null;

  ClienteId: number;
  ClienteNome: string;
  ClienteWhatsapp: string;
};

type ApiListResponse = { ok: true; agendamentos: ApiAgendamento[] };

type NotifyState = null | {
  phone: string;
  message: string;
  url: string;
  title: string;
};

type StatusFilter = "all" | ApiAgendamentoStatus;

function buildWhatsAppUrl(phone: string, message: string) {
  const clean = String(phone || "").replace(/\D/g, "");
  const text = encodeURIComponent(message);
  return `https://wa.me/55${clean}?text=${text}`;
}

function formatHHMMFromHoraAgendada(horaIso: string) {
  // "1970-01-01T08:30:00.000Z" => "08:30"
  return horaIso?.slice(11, 16) || "";
}

function dateOnlyToLocalDate(dateLike: any): Date {
  const s = String(dateLike ?? "");
  const ymd = s.slice(0, 10); // YYYY-MM-DD
  const parts = ymd.split("-").map((x) => Number(x));
  const [y, m, d] = parts;
  if (
    Number.isFinite(y) &&
    Number.isFinite(m) &&
    Number.isFinite(d) &&
    y > 1900 &&
    m >= 1 &&
    m <= 12 &&
    d >= 1 &&
    d <= 31
  ) {
    // constrói em horário local (sem shift de fuso)
    return new Date(y, m - 1, d);
  }

  // fallback
  try {
    const dt = parseISO(s);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  } catch {
    return new Date();
  }
}

function buildMessage(
  status: "confirmed" | "cancelled" | "completed",
  apt: ApiAgendamento
) {
  const nome = apt.ClienteNome || "Olá";
  const servico = apt.Servico || "serviço";
  const data = format(dateOnlyToLocalDate(apt.DataAgendada), "dd/MM/yyyy", {
    locale: ptBR,
  });
  const hora = formatHHMMFromHoraAgendada(apt.HoraAgendada);

  if (status === "confirmed") {
    return `Olá, ${nome}! Seu agendamento de ${servico} para ${data} às ${hora} está CONFIRMADO. Qualquer coisa é só me chamar 😊`;
  }
  if (status === "cancelled") {
    return `Olá, ${nome}! Seu agendamento de ${servico} para ${data} às ${hora} foi CANCELADO. Se quiser, posso remarcar para outro horário.`;
  }
  return `Olá, ${nome}! Seu atendimento de ${servico} do dia ${data} às ${hora} foi CONCLUÍDO. Obrigado! 😊`;
}

export function Appointments() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [notify, setNotify] = useState<NotifyState>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [searchParams] = useSearchParams();
  const slug = useMemo(() => searchParams.get("empresa") || "nando", [searchParams]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-agendamentos", slug],
    queryFn: () => apiGet<ApiListResponse>(`/api/empresas/${slug}/agendamentos`),
  });

  const rows = useMemo(() => {
    const list = data?.agendamentos ?? [];

    return list
      .filter((apt) => statusFilter === "all" || apt.AgendamentoStatus === statusFilter)
      .sort((a, b) => new Date(b.InicioEm).getTime() - new Date(a.InicioEm).getTime());
  }, [data, statusFilter]);

  async function updateStatus(apt: ApiAgendamento, status: ApiAgendamentoStatus) {
    try {
      setBusyId(apt.AgendamentoId);

      await apiPut(`/api/empresas/${slug}/agendamentos/${apt.AgendamentoId}/status`, {
        status,
      });

      await refetch();

      // Após ação, oferece mensagem pronta no WhatsApp
      if (status === "confirmed" || status === "cancelled" || status === "completed") {
        const msg = buildMessage(status, apt);
        const url = buildWhatsAppUrl(apt.ClienteWhatsapp, msg);

        const title =
          status === "confirmed"
            ? "Mensagem de confirmação pronta"
            : status === "cancelled"
              ? "Mensagem de cancelamento pronta"
              : "Mensagem de finalização pronta";

        setNotify({
          phone: apt.ClienteWhatsapp,
          message: msg,
          url,
          title,
        });
      }
    } catch (e: any) {
      alert(e?.message || "Falha ao atualizar status");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteAppointment(apt: ApiAgendamento) {
    try {
      if (apt.AgendamentoStatus !== "cancelled") {
        alert("Só é possível excluir agendamentos CANCELADOS.");
        return;
      }

      const ok = window.confirm(
        "Excluir este agendamento cancelado? Essa ação não pode ser desfeita."
      );
      if (!ok) return;

      setBusyId(apt.AgendamentoId);

      await apiDelete(`/api/empresas/${encodeURIComponent(slug)}/agendamentos/${apt.AgendamentoId}`);

      await refetch();
    } catch (e: any) {
      alert(e?.message || "Falha ao excluir agendamento");
    } finally {
      setBusyId(null);
    }
  }

  const getStatusBadge = (status: ApiAgendamentoStatus) => {
    const styles: Record<ApiAgendamentoStatus, string> = {
      pending: "bg-yellow-500/20 text-yellow-500",
      confirmed: "bg-success/20 text-success",
      completed: "bg-blue-500/20 text-blue-500",
      cancelled: "bg-destructive/20 text-destructive",
    };

    const labels: Record<ApiAgendamentoStatus, string> = {
      pending: "Pendente",
      confirmed: "Confirmado",
      completed: "Concluído",
      cancelled: "Cancelado",
    };

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
        {labels[status]}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">Agendamentos</h1>
          <p className="text-muted-foreground mt-1">
            Gerencie todos os agendamentos da sua empresa
          </p>
          <p className="text-xs text-muted-foreground mt-1">Empresa: {slug}</p>
        </div>

        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:items-center">
          <Button variant="outline" onClick={() => refetch()} className="w-full sm:w-auto">
            Atualizar
          </Button>

          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
            <SelectTrigger className="w-full sm:w-48 bg-secondary border-border">
              <SelectValue placeholder="Filtrar por status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="confirmed">Confirmados</SelectItem>
              <SelectItem value="completed">Concluídos</SelectItem>
              <SelectItem value="cancelled">Cancelados</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Card WhatsApp após ação */}
      {notify && (
        <div className="glass-card p-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium text-foreground">{notify.title}</p>
            <p className="text-sm text-muted-foreground break-words mt-1">{notify.message}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <Button variant="default" onClick={() => window.open(notify.url, "_blank")}>
              Abrir WhatsApp
            </Button>
            <Button variant="outline" onClick={() => setNotify(null)}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center">
            <p className="text-muted-foreground">Carregando agendamentos...</p>
          </div>
        ) : isError ? (
          <div className="p-12 text-center">
            <p className="text-destructive">
              Erro ao carregar: {String((error as any)?.message ?? error)}
            </p>
          </div>
        ) : rows.length > 0 ? (
          <>
            <div className="p-4 space-y-3 md:hidden">
              {rows.map((apt) => {
                const dateLabel = format(dateOnlyToLocalDate(apt.DataAgendada), "dd/MM/yyyy", {
                  locale: ptBR,
                });
                const timeLabel = formatHHMMFromHoraAgendada(apt.HoraAgendada);
                const isBusy = busyId === apt.AgendamentoId;

                const canConfirm = apt.AgendamentoStatus === "pending";
                const canCancel =
                  apt.AgendamentoStatus !== "cancelled" && apt.AgendamentoStatus !== "completed";
                const canComplete = apt.AgendamentoStatus === "confirmed";

                return (
                  <div key={apt.AgendamentoId} className="rounded-lg border border-border/60 bg-secondary/20 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{apt.ClienteNome}</p>
                        <p className="text-sm text-muted-foreground">{apt.Servico}</p>
                      </div>
                      {getStatusBadge(apt.AgendamentoStatus)}
                    </div>

                    <div className="mt-3 space-y-1 text-sm">
                      <p className="text-foreground">{dateLabel} às {timeLabel}</p>
                      <a
                        href={`https://wa.me/55${apt.ClienteWhatsapp}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline inline-flex items-center gap-1 break-all"
                      >
                        <Phone size={12} />
                        {apt.ClienteWhatsapp}
                      </a>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatus(apt, "confirmed")}
                        disabled={!canConfirm || isBusy}
                        className="text-success border-success/30 disabled:opacity-40"
                      >
                        Confirmar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (window.confirm("Cancelar este agendamento?")) {
                            updateStatus(apt, "cancelled");
                          }
                        }}
                        disabled={!canCancel || isBusy}
                        className="text-destructive border-destructive/30 disabled:opacity-40"
                      >
                        Cancelar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (window.confirm("Marcar como concluído?")) {
                            updateStatus(apt, "completed");
                          }
                        }}
                        disabled={!canComplete || isBusy}
                        className="text-blue-500 border-blue-500/30 disabled:opacity-40"
                      >
                        Finalizar
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={apt.AgendamentoStatus !== "cancelled" || isBusy}
                        onClick={() => deleteAppointment(apt)}
                        className="text-muted-foreground border-border disabled:opacity-40"
                      >
                        Excluir
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>

            <table className="hidden md:table w-full">
            <thead>
              <tr className="border-b border-border bg-secondary/50">
                <th className="text-left p-4 font-medium text-muted-foreground">Data/Hora</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Cliente</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Serviço</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                <th className="text-right p-4 font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((apt) => {
                const dateLabel = format(dateOnlyToLocalDate(apt.DataAgendada), "dd/MM/yyyy", {
                  locale: ptBR,
                });
                const timeLabel = formatHHMMFromHoraAgendada(apt.HoraAgendada);
                const isBusy = busyId === apt.AgendamentoId;

                const canConfirm = apt.AgendamentoStatus === "pending";
                const canCancel =
                  apt.AgendamentoStatus !== "cancelled" && apt.AgendamentoStatus !== "completed";
                const canComplete = apt.AgendamentoStatus === "confirmed";
                const canDelete = apt.AgendamentoStatus === "cancelled";

                return (
                  <tr
                    key={apt.AgendamentoId}
                    className="border-b border-border/50 hover:bg-secondary/30 transition-colors"
                  >
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <CalIcon size={16} className="text-primary" />
                        <div>
                          <p className="font-medium text-foreground">{dateLabel}</p>
                          <p className="text-sm text-muted-foreground">{timeLabel}</p>
                        </div>
                      </div>
                    </td>

                    <td className="p-4">
                      <div>
                        <p className="font-medium text-foreground">{apt.ClienteNome}</p>
                        <a
                          href={`https://wa.me/55${apt.ClienteWhatsapp}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-primary hover:underline flex items-center gap-1"
                        >
                          <Phone size={12} />
                          {apt.ClienteWhatsapp}
                        </a>
                      </div>
                    </td>

                    <td className="p-4 text-foreground">{apt.Servico}</td>

                    <td className="p-4">{getStatusBadge(apt.AgendamentoStatus)}</td>

                    <td className="p-4">
                      <div className="flex items-center justify-end gap-2">
                        {/* Confirmar */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => updateStatus(apt, "confirmed")}
                          disabled={!canConfirm || isBusy}
                          className="text-success hover:text-success hover:bg-success/20 disabled:opacity-40"
                          title="Confirmar agendamento"
                        >
                          <CheckCircle size={16} />
                        </Button>

                        {/* Cancelar */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (window.confirm("Cancelar este agendamento?")) {
                              updateStatus(apt, "cancelled");
                            }
                          }}
                          disabled={!canCancel || isBusy}
                          className="text-destructive hover:text-destructive hover:bg-destructive/20 disabled:opacity-40"
                          title="Cancelar agendamento"
                        >
                          <XCircle size={16} />
                        </Button>

                        {/* Finalizar */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (window.confirm("Marcar como concluído?")) {
                              updateStatus(apt, "completed");
                            }
                          }}
                          disabled={!canComplete || isBusy}
                          className="text-blue-500 hover:text-blue-500 hover:bg-blue-500/20 disabled:opacity-40"
                          title="Finalizar (Concluído)"
                        >
                          <CheckCheck size={16} />
                        </Button>

                        {/* Excluir (somente cancelled) */}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={apt.AgendamentoStatus !== "cancelled" || isBusy}
                          onClick={() => deleteAppointment(apt)}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/20 disabled:opacity-40"
                          title={
                            apt.AgendamentoStatus === "cancelled"
                              ? "Excluir agendamento cancelado"
                              : "Só é possível excluir se estiver cancelado"
                          }
                        >
                          <Trash2 size={16} />
                        </Button>

                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            </table>
          </>
        ) : (
          <div className="p-12 text-center">
            <CalIcon size={48} className="mx-auto text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">Nenhum agendamento encontrado</p>
          </div>
        )}
      </div>
    </div>
  );
}
