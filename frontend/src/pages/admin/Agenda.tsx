import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  CalendarRange,
  Clock3,
  Layers3,
  ListChecks,
  Sparkles,
} from "lucide-react";

import { apiGet } from "@/lib/api";
import { buildEmpresaPath, resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useAdminProfessionalContext } from "@/hooks/useAdminProfessionalContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type ApiAgendamentoStatus = "pending" | "confirmed" | "completed" | "cancelled";

type ApiAgendamento = {
  AgendamentoId: number;
  ServicoId: number;
  Servico: string;
  DataAgendada: string;
  HoraAgendada: string;
  DuracaoMin: number;
  InicioEm: string;
  FimEm: string;
  AgendamentoStatus: ApiAgendamentoStatus;
  ClienteNome: string;
  ClienteWhatsapp: string;
  ProfissionalId?: number | null;
  ProfissionalNome?: string | null;
};

type ApiListWithPaginationResponse = {
  ok: true;
  agendamentos: ApiAgendamento[];
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type ApiServicosResponse = {
  ok: true;
  servicos: Array<{
    Id: number;
    Nome: string;
    Ativo?: boolean;
    DuracaoMin?: number;
  }>;
};

type DisponibilidadeResp = {
  ok: boolean;
  data: string;
  slots: string[];
};

type TimelineItem = {
  id: number;
  cliente: string;
  servico: string;
  profissional: string;
  status: ApiAgendamentoStatus;
  startLabel: string;
  endLabel: string;
  startMin: number;
  endMin: number;
};

const DEFAULT_START_MIN = 8 * 60;
const DEFAULT_END_MIN = 18 * 60;
const PIXELS_PER_MINUTE = 1;
const TIMELINE_MIN_HEIGHT = 560;

function extractHHMM(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{2}:\d{2}$/.test(raw)) return raw;
  const match = raw.match(/T(\d{2}:\d{2})/) || raw.match(/(\d{2}:\d{2})/);
  return match?.[1] || raw.slice(0, 5);
}

function minutesFromHHMM(value?: string | null) {
  const hhmm = extractHHMM(value);
  const [hour, minute] = hhmm.split(":").map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}

function formatMinutesLabel(totalMinutes: number) {
  const safe = Math.max(0, totalMinutes);
  const hour = Math.floor(safe / 60);
  const minute = safe % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function snapToHourStart(totalMinutes: number) {
  return Math.floor(totalMinutes / 60) * 60;
}

function snapToHourEnd(totalMinutes: number) {
  return Math.ceil(totalMinutes / 60) * 60;
}

function getStatusBadgeClass(status: ApiAgendamentoStatus) {
  if (status === "confirmed") return "border-emerald-500/30 bg-emerald-500/15 text-emerald-300";
  if (status === "completed") return "border-blue-500/30 bg-blue-500/15 text-blue-300";
  if (status === "cancelled") return "border-rose-500/30 bg-rose-500/15 text-rose-300";
  return "border-amber-500/30 bg-amber-500/15 text-amber-200";
}

function getStatusLabel(status: ApiAgendamentoStatus) {
  if (status === "confirmed") return "Confirmado";
  if (status === "completed") return "Concluido";
  if (status === "cancelled") return "Cancelado";
  return "Pendente";
}

function parseTimelineItem(apt: ApiAgendamento): TimelineItem {
  const startMin =
    minutesFromHHMM(apt.InicioEm) ??
    minutesFromHHMM(apt.HoraAgendada) ??
    DEFAULT_START_MIN;
  const durationMin = Number(apt.DuracaoMin || 60);
  const endMin =
    minutesFromHHMM(apt.FimEm) ??
    startMin + (Number.isFinite(durationMin) && durationMin > 0 ? durationMin : 60);

  return {
    id: Number(apt.AgendamentoId),
    cliente: String(apt.ClienteNome || "Cliente sem nome"),
    servico: String(apt.Servico || "Servico"),
    profissional: String(apt.ProfissionalNome || "Fluxo geral"),
    status: apt.AgendamentoStatus,
    startLabel: formatMinutesLabel(startMin),
    endLabel: formatMinutesLabel(endMin),
    startMin,
    endMin,
  };
}

export function Agenda() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const todayYmd = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const { activeProfessionals, hasMulti, selectedProfessionalId } = useAdminProfessionalContext(slug);

  const [selectedDate, setSelectedDate] = useState(todayYmd);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [agendaProfessionalId, setAgendaProfessionalId] = useState("all");
  const [selectedFreeSlot, setSelectedFreeSlot] = useState("");

  useEffect(() => {
    if (hasMulti) {
      if (selectedProfessionalId !== "all") {
        setAgendaProfessionalId((current) => (current === "all" ? selectedProfessionalId : current));
        return;
      }

      const stillExists = activeProfessionals.some((item) => String(item.Id) === agendaProfessionalId);
      if (!stillExists && agendaProfessionalId !== "all") {
        setAgendaProfessionalId("all");
      }
      return;
    }

    setAgendaProfessionalId("all");
  }, [activeProfessionals, agendaProfessionalId, hasMulti, selectedProfessionalId]);

  useEffect(() => {
    setSelectedFreeSlot("");
  }, [selectedDate, selectedServiceId, agendaProfessionalId]);

  const servicesQuery = useQuery({
    queryKey: ["agenda-servicos", slug],
    queryFn: () => apiGet<ApiServicosResponse>(`/api/empresas/${encodeURIComponent(slug)}/servicos`),
  });

  const activeServices = useMemo(
    () => (servicesQuery.data?.servicos || []).filter((service) => service.Ativo !== false),
    [servicesQuery.data?.servicos]
  );

  const selectedService = useMemo(
    () => activeServices.find((service) => String(service.Id) === selectedServiceId) || null,
    [activeServices, selectedServiceId]
  );

  const canQueryExactAvailability = !hasMulti || agendaProfessionalId !== "all";

  const dayAppointmentsQuery = useQuery({
    queryKey: ["agenda-day-appointments", slug, selectedDate, agendaProfessionalId],
    enabled: Boolean(slug && selectedDate),
    queryFn: () => {
      const params = new URLSearchParams({
        status: "all",
        data: selectedDate,
        page: "1",
        pageSize: "200",
      });

      if (agendaProfessionalId !== "all") {
        params.set("profissionalId", agendaProfessionalId);
      }

      return apiGet<ApiListWithPaginationResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/agendamentos?${params.toString()}`
      );
    },
  });

  const availabilityQuery = useQuery({
    queryKey: ["agenda-free-slots", slug, selectedDate, selectedServiceId, agendaProfessionalId],
    enabled: Boolean(
      slug &&
        selectedDate &&
        selectedServiceId &&
        canQueryExactAvailability
    ),
    queryFn: () => {
      const params = new URLSearchParams({
        servicoId: selectedServiceId,
        data: selectedDate,
      });

      if (agendaProfessionalId !== "all") {
        params.set("profissionalId", agendaProfessionalId);
      }

      return apiGet<DisponibilidadeResp>(
        `/api/empresas/${encodeURIComponent(slug)}/agenda/disponibilidade?${params.toString()}`
      );
    },
  });

  const timelineItems = useMemo(
    () =>
      (dayAppointmentsQuery.data?.agendamentos || [])
        .map(parseTimelineItem)
        .sort((a, b) => a.startMin - b.startMin),
    [dayAppointmentsQuery.data?.agendamentos]
  );

  const totalAppointments = timelineItems.length;
  const confirmedCount = timelineItems.filter((item) => item.status === "confirmed").length;
  const pendingCount = timelineItems.filter((item) => item.status === "pending").length;
  const completedCount = timelineItems.filter((item) => item.status === "completed").length;
  const freeSlots = availabilityQuery.data?.slots || [];
  const selectedServiceDuration = Number(selectedService?.DuracaoMin || 60);

  const boardRange = useMemo(() => {
    const candidatesStart = [
      DEFAULT_START_MIN,
      ...timelineItems.map((item) => item.startMin),
      ...freeSlots.map((slot) => minutesFromHHMM(slot) ?? DEFAULT_START_MIN),
    ];
    const candidatesEnd = [
      DEFAULT_END_MIN,
      ...timelineItems.map((item) => item.endMin),
      ...freeSlots.map((slot) => (minutesFromHHMM(slot) ?? DEFAULT_END_MIN) + selectedServiceDuration),
    ];

    const start = Math.max(6 * 60, snapToHourStart(Math.min(...candidatesStart)));
    const end = Math.min(23 * 60, snapToHourEnd(Math.max(...candidatesEnd)));

    return {
      start,
      end: end <= start ? start + 10 * 60 : end,
    };
  }, [freeSlots, selectedServiceDuration, timelineItems]);

  const timelineHeight = Math.max(
    TIMELINE_MIN_HEIGHT,
    (boardRange.end - boardRange.start) * PIXELS_PER_MINUTE
  );

  const hourMarks = useMemo(() => {
    const items: number[] = [];
    for (let minute = boardRange.start; minute <= boardRange.end; minute += 60) {
      items.push(minute);
    }
    return items;
  }, [boardRange.end, boardRange.start]);

  const canShowVisualBoard = !hasMulti || agendaProfessionalId !== "all";
  const agendaDateLabel = useMemo(
    () => format(parseISO(`${selectedDate}T00:00:00`), "EEEE, dd 'de' MMMM", { locale: ptBR }),
    [selectedDate]
  );

  return (
    <div className="space-y-6" data-cy="admin-agenda-page">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
            <CalendarRange size={14} />
            Consulta visual de agenda
          </div>
          <h1 className="mt-3 font-display text-3xl font-bold text-foreground">Agenda</h1>
          <p className="mt-1 text-muted-foreground">
            Consulte os agendamentos do dia e veja rapidamente os horarios livres para encaixe.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            onClick={() => navigate(buildEmpresaPath("/admin/agendamentos", slug))}
          >
            Ir para Agendamentos
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="glass-card p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Layers3 size={18} className="text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Filtros da agenda</h2>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Data</p>
              <Input
                type="date"
                value={selectedDate}
                min={todayYmd}
                onChange={(e) => setSelectedDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Servico para encaixe</p>
              <Select value={selectedServiceId} onValueChange={setSelectedServiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um servico" />
                </SelectTrigger>
                <SelectContent>
                  {activeServices.map((service) => (
                    <SelectItem key={service.Id} value={String(service.Id)}>
                      {service.Nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Profissional</p>
              <Select
                value={agendaProfessionalId}
                onValueChange={setAgendaProfessionalId}
                disabled={!hasMulti}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um profissional" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Visao geral do dia</SelectItem>
                  {activeProfessionals.map((professional) => (
                    <SelectItem key={professional.Id} value={String(professional.Id)}>
                      {professional.Nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-border/60 bg-background/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Agendamentos</p>
              <p className="mt-2 text-2xl font-bold text-foreground">
                {dayAppointmentsQuery.isLoading ? "--" : totalAppointments}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Pendentes</p>
              <p className="mt-2 text-2xl font-bold text-amber-300">
                {dayAppointmentsQuery.isLoading ? "--" : pendingCount}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Confirmados</p>
              <p className="mt-2 text-2xl font-bold text-emerald-300">
                {dayAppointmentsQuery.isLoading ? "--" : confirmedCount}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Concluidos</p>
              <p className="mt-2 text-2xl font-bold text-blue-300">
                {dayAppointmentsQuery.isLoading ? "--" : completedCount}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-border/60 bg-background/20 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/30 text-primary">
                {agendaDateLabel}
              </Badge>
              {selectedService ? (
                <Badge variant="outline">
                  Servico: {selectedService.Nome}
                </Badge>
              ) : (
                <Badge variant="outline">Selecione um servico para consultar encaixes</Badge>
              )}
              {agendaProfessionalId !== "all" && (
                <Badge variant="outline">
                  Profissional: {activeProfessionals.find((item) => String(item.Id) === agendaProfessionalId)?.Nome || "Selecionado"}
                </Badge>
              )}
            </div>
          </div>
        </section>

        <section className="glass-card p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Horarios livres</h2>
          </div>

          {!selectedServiceId ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/20 p-5 text-sm text-muted-foreground">
              Selecione um servico para consultar os horarios disponiveis de encaixe.
            </div>
          ) : hasMulti && agendaProfessionalId === "all" ? (
            <div className="rounded-xl border border-dashed border-border/70 bg-background/20 p-5 text-sm text-muted-foreground">
              Para ver horarios livres com precisao, escolha um profissional especifico. A visao geral do dia mostra os agendamentos, mas a disponibilidade depende do profissional e do servico.
            </div>
          ) : availabilityQuery.isLoading ? (
            <div className="rounded-xl border border-border/60 bg-background/20 p-5 text-sm text-muted-foreground">
              Carregando horarios livres...
            </div>
          ) : freeSlots.length === 0 ? (
            <div className="rounded-xl border border-border/60 bg-background/20 p-5 text-sm text-muted-foreground">
              Nao encontramos horarios livres para este servico nesta data.
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Clique em um horario para destacar um encaixe possivel.
              </p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {freeSlots.map((slot) => {
                  const selected = selectedFreeSlot === slot;
                  return (
                    <Button
                      key={slot}
                      type="button"
                      variant={selected ? "default" : "outline"}
                      onClick={() => setSelectedFreeSlot(slot)}
                      className="justify-start"
                    >
                      <Clock3 size={14} className="mr-2" />
                      {slot}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {selectedFreeSlot && (
            <div className="rounded-xl border border-primary/30 bg-primary/10 p-4 text-sm">
              <p className="font-medium text-foreground">Horario sugerido para encaixe</p>
              <p className="mt-1 text-muted-foreground">
                {selectedFreeSlot} em {format(parseISO(`${selectedDate}T00:00:00`), "dd/MM/yyyy", { locale: ptBR })}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Use esse horario na tela de agendamentos para registrar o atendimento manual.
              </p>
            </div>
          )}
        </section>
      </div>

      <section className="glass-card p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ListChecks size={18} className="text-primary" />
          <div>
            <h2 className="text-lg font-semibold text-foreground">Quadro da agenda</h2>
            <p className="text-sm text-muted-foreground">
              Visualize os horarios ocupados e identifique as brechas ao longo do dia.
            </p>
          </div>
        </div>

        {dayAppointmentsQuery.isLoading ? (
          <div className="rounded-xl border border-border/60 bg-background/20 p-8 text-sm text-muted-foreground">
            Carregando agenda...
          </div>
        ) : dayAppointmentsQuery.isError ? (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-8 text-sm text-rose-200">
            Nao foi possivel carregar os agendamentos dessa data agora.
          </div>
        ) : hasMulti && agendaProfessionalId === "all" ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              A visao geral mostra todos os agendamentos do dia. Para enxergar as brechas com mais precisao, selecione um profissional.
            </p>
            {timelineItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border/70 bg-background/20 p-8 text-sm text-muted-foreground">
                Nenhum agendamento encontrado para esta data.
              </div>
            ) : (
              <div className="space-y-3">
                {timelineItems.map((item) => (
                  <div key={item.id} className="rounded-xl border border-border/70 bg-background/30 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-foreground">{item.cliente}</p>
                        <p className="text-sm text-muted-foreground">
                          {item.servico} • {item.profissional}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={`border ${getStatusBadgeClass(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </Badge>
                        <Badge variant="outline">
                          {item.startLabel} - {item.endLabel}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : timelineItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/70 bg-background/20 p-8 text-sm text-muted-foreground">
            Nenhum agendamento encontrado para esta data.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[720px] rounded-2xl border border-border/60 bg-background/20 p-4">
              <div className="relative" style={{ height: `${timelineHeight}px` }}>
                {hourMarks.map((mark) => {
                  const top = (mark - boardRange.start) * PIXELS_PER_MINUTE;
                  return (
                    <div
                      key={mark}
                      className="absolute inset-x-0"
                      style={{ top: `${top}px` }}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-16 shrink-0 text-xs text-muted-foreground">
                          {formatMinutesLabel(mark)}
                        </div>
                        <div className="h-px flex-1 bg-border/70" />
                      </div>
                    </div>
                  );
                })}

                {timelineItems.map((item) => {
                  const top = (item.startMin - boardRange.start) * PIXELS_PER_MINUTE;
                  const height = Math.max(52, (item.endMin - item.startMin) * PIXELS_PER_MINUTE);

                  return (
                    <div
                      key={item.id}
                      className={`absolute left-20 right-4 rounded-2xl border px-4 py-3 shadow-sm ${getStatusBadgeClass(item.status)}`}
                      style={{ top: `${top}px`, height: `${height}px` }}
                    >
                      <div className="flex h-full flex-col justify-between gap-2">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-medium text-foreground">{item.cliente}</p>
                            <span className="text-xs text-muted-foreground">
                              {item.startLabel} - {item.endLabel}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">{item.servico}</p>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-muted-foreground">{item.profissional}</span>
                          <Badge className={`border ${getStatusBadgeClass(item.status)}`}>
                            {getStatusLabel(item.status)}
                          </Badge>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {canShowVisualBoard && freeSlots.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Dica: compare os blocos ocupados com os horarios livres ao lado para decidir encaixes mais rapidamente.
          </p>
        )}
      </section>
    </div>
  );
}
