import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useAdminProfessionalContext } from "@/hooks/useAdminProfessionalContext";
import {
  buildAppointmentReminderMessage,
  buildAppointmentReminderWhatsAppUrl,
  getAppointmentContactPhone,
} from "@/lib/appointment-reminder";

import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  MessageCircle,
  Copy,
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
  ProfissionalId?: number | null;
  ProfissionalNome?: string | null;
  ProfissionalWhatsapp?: string | null;
  IsServicoAvulso?: boolean;
  ServicoDescricaoAvulsa?: string | null;
  ModeloReferencia?: string | null;
  ValorMaoObra?: number | null;
  ValorProdutos?: number | null;
  ValorFinal?: number | null;
};

type ApiPagination = { page: number; pageSize: number; total: number; totalPages: number };
type ApiListWithPaginationResponse = {
  ok: true;
  agendamentos: ApiAgendamento[];
  pagination?: ApiPagination;
  retentionDays?: number;
};

type Profissional = {
  Id: number;
  Nome: string;
  Whatsapp: string;
  Ativo: boolean;
};

type ApiProfissionaisResponse = {
  ok: boolean;
  profissionais: Profissional[];
};

type ApiServicosResponse = { ok: true; servicos: Array<{ Id: number; Nome: string; Ativo?: boolean }> };
type CompanyResponse = { Nome?: string };
const ALLOWED_DURATION_OPTIONS = [30, 60, 90, 120, 150, 180] as const;

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

function extractFriendlyErrorMessage(err: any, fallback: string) {
  const raw = String(err?.message || "").trim();
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    // segue fluxo normal abaixo
  }

  return raw;
}

export function Appointments() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [professionalFilter, setProfessionalFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [notify, setNotify] = useState<NotifyState>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);
  const [lastCreatedAppointmentId, setLastCreatedAppointmentId] = useState<number | null>(null);
  const [quickForm, setQuickForm] = useState({
    tipoServico: "catalogo" as "catalogo" | "avulso",
    servicoId: "",
    customDescricao: "",
    customModelo: "",
    customDuracaoMin: "60",
    customValorMaoObra: "",
    customValorProdutos: "",
    date: "",
    time: "",
    clientName: "",
    clientPhone: "",
    profissionalId: "",
  });

  const todayYmd = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);
  const nowHHMM = useMemo(() => format(new Date(), "HH:mm"), []);

  const [searchParams] = useSearchParams();
  const highlightedAppointmentId = useMemo(() => {
    const raw = Number(searchParams.get("agendamento"));
    return Number.isFinite(raw) && raw > 0 ? raw : null;
  }, [searchParams]);
  const effectiveHighlightedAppointmentId = highlightedAppointmentId ?? lastCreatedAppointmentId;
  const [hasAutoScrolled, setHasAutoScrolled] = useState(false);
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const { activeProfessionals: contextActiveProfessionals, selectedProfessionalId, setSelectedProfessionalId } = useAdminProfessionalContext(slug);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["admin-agendamentos", slug, statusFilter, professionalFilter, page],
    queryFn: () => {
      const params = new URLSearchParams({
        status: statusFilter,
        page: String(page),
        pageSize: "15",
      });

      if (professionalFilter !== "all") {
        params.set("profissionalId", professionalFilter);
      }

      const url = `/api/empresas/${encodeURIComponent(slug)}/agendamentos?${params.toString()}`;
      console.debug("[Appointments] list request url:", url);
      console.debug("[Appointments] active filters:", {
        slug,
        statusFilter,
        professionalFilter,
        page,
      });

      return apiGet<ApiListWithPaginationResponse>(url);
    },
  });

  const { data: servicesData } = useQuery({
    queryKey: ["admin-servicos", slug],
    queryFn: () => apiGet<ApiServicosResponse>(`/api/empresas/${encodeURIComponent(slug)}/servicos`),
  });
  const companyQuery = useQuery({
    queryKey: ["admin-company", slug],
    queryFn: () => apiGet<CompanyResponse>(`/api/empresas/${encodeURIComponent(slug)}`),
  });
  const companyName = companyQuery.data?.Nome?.trim() || "nossa equipe";

  const activeServices = useMemo(
    () => (servicesData?.servicos ?? []).filter((svc) => svc?.Ativo !== false),
    [servicesData]
  );

  const { data: professionalsData } = useQuery({
    queryKey: ["admin-profissionais", slug],
    queryFn: () => apiGet<ApiProfissionaisResponse>(`/api/empresas/${encodeURIComponent(slug)}/profissionais`),
  });

  const activeProfessionals = useMemo(
    () => (professionalsData?.profissionais ?? []).filter((p) => p?.Ativo !== false),
    [professionalsData]
  );

  useEffect(() => {
    setProfessionalFilter(selectedProfessionalId || "all");
  }, [selectedProfessionalId]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, professionalFilter, slug]);

  const rows = useMemo(() => data?.agendamentos ?? [], [data]);
  const hasHighlightedInRows = useMemo(
    () => rows.some((apt) => apt.AgendamentoId === effectiveHighlightedAppointmentId),
    [rows, effectiveHighlightedAppointmentId]
  );
  const pagination = data?.pagination;

  useEffect(() => {
    const payload = rows.map((apt) => ({
      AgendamentoId: apt.AgendamentoId,
      AtendimentoId: apt.AtendimentoId,
      DataAgendada: apt.DataAgendada,
      HoraAgendada: apt.HoraAgendada,
      Status: apt.AgendamentoStatus,
    }));

    console.debug("[Appointments] API items:", rows.length);
    console.debug("[Appointments] payload received:", payload);
    console.debug("[Appointments] rendered items:", rows.length);
    console.debug("[Appointments] rendered ids:", rows.map((apt) => apt.AgendamentoId));
  }, [rows]);

  useEffect(() => {
    setHasAutoScrolled(false);
  }, [effectiveHighlightedAppointmentId]);

  useEffect(() => {
    if (!effectiveHighlightedAppointmentId || !hasHighlightedInRows || hasAutoScrolled) return;

    const target = document.querySelector(`[data-appointment-id="${effectiveHighlightedAppointmentId}"]`);
    if (target instanceof HTMLElement) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setHasAutoScrolled(true);
    }
  }, [hasAutoScrolled, hasHighlightedInRows, effectiveHighlightedAppointmentId]);

  function openReminderMessage(apt: ApiAgendamento) {
    const reminderInput = {
      clienteNome: apt.ClienteNome,
      servico: apt.Servico,
      dataAgendada: apt.DataAgendada,
      horaAgendada: apt.HoraAgendada,
      empresaNome: companyName,
      profissionalNome: apt.ProfissionalNome || null,
      clienteWhatsapp: apt.ClienteWhatsapp || null,
      clienteTelefone: null,
    };

    setNotify({
      phone: getAppointmentContactPhone(reminderInput),
      message: buildAppointmentReminderMessage(reminderInput),
      url: buildAppointmentReminderWhatsAppUrl(reminderInput),
      title: "Mensagem de lembrete pronta",
    });
  }

  async function copyNotifyMessage() {
    if (!notify?.message) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(notify.message);
        alert("Mensagem copiada.");
        return;
      }
    } catch {
      // fallback para ambientes sem permissao de clipboard
    }
    alert("Não foi possível copiar automaticamente neste navegador.");
  }

  async function updateStatus(apt: ApiAgendamento, status: ApiAgendamentoStatus) {
    try {
      setBusyId(apt.AgendamentoId);

      await apiPut(`/api/empresas/${encodeURIComponent(slug)}/agendamentos/${apt.AgendamentoId}/status`, {
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

  async function createQuickAppointment() {
    const isCustomService = quickForm.tipoServico === "avulso";
    const sid = Number(quickForm.servicoId);
    if (!isCustomService && (!Number.isFinite(sid) || sid <= 0)) {
        alert("Selecione um serviço válido.");
        return;
    }
    if (!quickForm.date) {
      alert("Selecione a data.");
      return;
    }
    if (!quickForm.time) {
      alert("Selecione o horário.");
      return;
    }
    if (!quickForm.clientName.trim()) {
      alert("Informe o nome do cliente.");
      return;
    }
    const quickPhoneDigits = String(quickForm.clientPhone || "").replace(/\D/g, "");
    if (quickPhoneDigits.length < 10) {
      alert("Informe um WhatsApp válido com DDD.");
      return;
    }

    const customDuracaoMin = Number(quickForm.customDuracaoMin);
    const customValorMaoObra = Number(String(quickForm.customValorMaoObra).replace(",", "."));
    const customValorProdutos = Number(String(quickForm.customValorProdutos).replace(",", "."));
    if (isCustomService) {
      if (!quickForm.customDescricao.trim()) {
        alert("Informe a descrição do serviço avulso.");
        return;
      }
      if (!Number.isFinite(customDuracaoMin) || !ALLOWED_DURATION_OPTIONS.includes(customDuracaoMin as 30 | 60)) {
        alert("Para manter a agenda organizada, use uma duração permitida: 30, 60, 90, 120, 150 ou 180 minutos.");
        return;
      }
      if (!Number.isFinite(customValorMaoObra) || customValorMaoObra < 0) {
        alert("Informe um valor válido para mão de obra.");
        return;
      }
      if (!Number.isFinite(customValorProdutos) || customValorProdutos < 0) {
        alert("Informe um valor válido para produtos.");
        return;
      }
    }

    const requireProfessional = contextActiveProfessionals.length > 1;
    const quickProfessionalId = Number(quickForm.profissionalId);
    if (requireProfessional && (!Number.isFinite(quickProfessionalId) || quickProfessionalId <= 0)) {
      alert("Selecione o profissional do atendimento.");
      return;
    }

    try {
      setQuickBusy(true);
      const created = await apiPost<any>(`/api/empresas/${encodeURIComponent(slug)}/agendamentos`, {
        servicoId: isCustomService ? null : sid,
        date: quickForm.date,
        time: quickForm.time,
        clientName: quickForm.clientName.trim(),
        clientPhone: quickPhoneDigits,
        source: "admin_manual",
        profissionalId: Number.isFinite(quickProfessionalId) && quickProfessionalId > 0 ? quickProfessionalId : null,
        customService: isCustomService
          ? {
              descricao: quickForm.customDescricao.trim(),
              modelo: quickForm.customModelo.trim(),
              duracaoMin: customDuracaoMin,
              valorMaoObra: customValorMaoObra,
              valorProdutos: customValorProdutos,
            }
          : null,
      });

      const createdId = Number(created?.agendamento?.Id || created?.agendamento?.AgendamentoId);
      setLastCreatedAppointmentId(Number.isFinite(createdId) && createdId > 0 ? createdId : null);

      setQuickForm({
        tipoServico: "catalogo",
        servicoId: "",
        customDescricao: "",
        customModelo: "",
        customDuracaoMin: "60",
        customValorMaoObra: "",
        customValorProdutos: "",
        date: "",
        time: "",
        clientName: "",
        clientPhone: "",
        profissionalId: "",
      });
      await refetch();
      alert("Agendamento rápido criado com sucesso.");
    } catch (e: any) {
      const rawMessage = extractFriendlyErrorMessage(e, "Falha ao criar agendamento rápido.");
      if (/fora da jornada/i.test(rawMessage)) {
        alert(
          "Horário fora da jornada do profissional selecionado. Escolha um horário dentro do expediente configurado."
        );
      } else {
        alert(rawMessage);
      }
    } finally {
      setQuickBusy(false);
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

          <Select value={professionalFilter} onValueChange={(v) => { setProfessionalFilter(v); setSelectedProfessionalId(v); }}>
            <SelectTrigger className="w-full sm:w-56 bg-secondary border-border">
              <SelectValue placeholder="Filtrar por profissional" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os profissionais</SelectItem>
              {contextActiveProfessionals.map((p) => (
                <SelectItem key={p.Id} value={String(p.Id)}>{p.Nome}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Exibindo 15 por página. Registros com mais de {data?.retentionDays ?? 60} dias são removidos automaticamente.
      </p>

      {/* Card WhatsApp após ação */}
      {effectiveHighlightedAppointmentId && (
        <p className="text-xs text-muted-foreground">
          {hasHighlightedInRows
            ? `Agendamento ${effectiveHighlightedAppointmentId} destacado na lista atual da empresa.`
            : `Agendamento ${effectiveHighlightedAppointmentId} não apareceu na lista atual. Confira filtros, paginação e status.`}
        </p>
      )}

      {notify && (
        <div className="glass-card p-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-medium text-foreground">{notify.title}</p>
            <p className="text-sm text-muted-foreground break-words mt-1">{notify.message}</p>
            {!notify.url ? (
              <p className="text-xs text-amber-300 mt-2">
                WhatsApp indisponível: telefone do cliente não encontrado ou inválido.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
            <Button variant="outline" onClick={copyNotifyMessage}>
              <Copy size={14} className="mr-2" />
              Copiar mensagem
            </Button>
            <Button variant="default" onClick={() => window.open(notify.url, "_blank")} disabled={!notify.url}>
              Abrir WhatsApp
            </Button>
            <Button variant="outline" onClick={() => setNotify(null)}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      <div className="glass-card p-4 sm:p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Agendamento rápido (manual)</h2>
          <p className="text-sm text-muted-foreground">
            Use quando o horário já foi combinado diretamente com o cliente, sem confirmação por WhatsApp.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Tipo do agendamento</p>
            <Select
              value={quickForm.tipoServico}
              onValueChange={(v: "catalogo" | "avulso") => setQuickForm((prev) => ({ ...prev, tipoServico: v }))}
            >
              <SelectTrigger className="w-full bg-secondary border-border">
                <SelectValue placeholder="Selecione o tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="catalogo">Serviço do catálogo</SelectItem>
                <SelectItem value="avulso">Serviço avulso por orçamento</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {quickForm.tipoServico === "catalogo" ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Serviço</p>
            <Select
              value={quickForm.servicoId}
              onValueChange={(v) => setQuickForm((prev) => ({ ...prev, servicoId: v }))}
            >
              <SelectTrigger className="w-full bg-secondary border-border">
                <SelectValue placeholder="Selecione um serviço" />
              </SelectTrigger>
              <SelectContent>
                {activeServices.map((svc) => (
                  <SelectItem key={svc.Id} value={String(svc.Id)}>
                    {svc.Nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Serviço a ser executado</p>
                <Input
                  value={quickForm.customDescricao}
                  onChange={(e) => setQuickForm((prev) => ({ ...prev, customDescricao: e.target.value }))}
                  placeholder="Ex: Pintura da porta"
                  className="bg-secondary border-border"
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Modelo / referência</p>
                <Input
                  value={quickForm.customModelo}
                  onChange={(e) => setQuickForm((prev) => ({ ...prev, customModelo: e.target.value }))}
                  placeholder="Ex: Celta 2012"
                  className="bg-secondary border-border"
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Duração (min)</p>
                <Select
                  value={quickForm.customDuracaoMin}
                  onValueChange={(v) => setQuickForm((prev) => ({ ...prev, customDuracaoMin: v }))}
                >
                  <SelectTrigger className="w-full bg-secondary border-border">
                    <SelectValue placeholder="Selecione a duração" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="30">30 minutos</SelectItem>
                    <SelectItem value="60">60 minutos</SelectItem>
                    <SelectItem value="90">90 minutos</SelectItem>
                    <SelectItem value="120">120 minutos</SelectItem>
                    <SelectItem value="150">150 minutos</SelectItem>
                    <SelectItem value="180">180 minutos</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Valor mão de obra (R$)</p>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={quickForm.customValorMaoObra}
                  onChange={(e) => setQuickForm((prev) => ({ ...prev, customValorMaoObra: e.target.value }))}
                  className="bg-secondary border-border"
                />
              </div>
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Gasto com produtos (R$)</p>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={quickForm.customValorProdutos}
                  onChange={(e) => setQuickForm((prev) => ({ ...prev, customValorProdutos: e.target.value }))}
                  className="bg-secondary border-border"
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Nome do cliente</p>
            <Input
              value={quickForm.clientName}
              onChange={(e) => setQuickForm((prev) => ({ ...prev, clientName: e.target.value }))}
              placeholder="Ex: Maria Souza"
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">WhatsApp do cliente</p>
            <Input
              value={quickForm.clientPhone}
              onChange={(e) =>
                setQuickForm((prev) => ({
                  ...prev,
                  clientPhone: e.target.value.replace(/[^\d()+\-\s]/g, ""),
                }))
              }
              placeholder="Ex: (51) 99999-9999"
              className="bg-secondary border-border"
            />
          </div>

          {contextActiveProfessionals.length > 1 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Profissional</p>
              <Select
                value={quickForm.profissionalId}
                onValueChange={(v) => setQuickForm((prev) => ({ ...prev, profissionalId: v }))}
              >
                <SelectTrigger className="w-full bg-secondary border-border">
                  <SelectValue placeholder="Selecione o profissional" />
                </SelectTrigger>
                <SelectContent>
                  {contextActiveProfessionals.map((p) => (
                    <SelectItem key={p.Id} value={String(p.Id)}>
                      {p.Nome}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Data</p>
            <Input
              type="date"
              value={quickForm.date}
              onChange={(e) => setQuickForm((prev) => ({ ...prev, date: e.target.value }))}
              min={todayYmd}
              className="bg-secondary border-border"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Horário</p>
            <Input
              type="time"
              value={quickForm.time}
              onChange={(e) => setQuickForm((prev) => ({ ...prev, time: e.target.value }))}
              min={quickForm.date === todayYmd ? nowHHMM : undefined}
              step={1800}
              className="bg-secondary border-border"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={createQuickAppointment} disabled={quickBusy}>
            {quickBusy ? "Salvando..." : "Criar agendamento rápido"}
          </Button>
        </div>
      </div>

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
                const isHighlighted = effectiveHighlightedAppointmentId === apt.AgendamentoId;

                const canConfirm = apt.AgendamentoStatus === "pending";
                const canCancel =
                  apt.AgendamentoStatus !== "cancelled" && apt.AgendamentoStatus !== "completed";
                const canComplete = apt.AgendamentoStatus === "confirmed";

                return (
                  <div
                    key={apt.AgendamentoId}
                    data-appointment-id={apt.AgendamentoId}
                    className={
                      isHighlighted
                        ? "rounded-lg border border-primary/50 bg-primary/5 p-3 shadow-sm ring-1 ring-primary/20"
                        : "rounded-lg border border-border/60 bg-secondary/20 p-3"
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{apt.ClienteNome}</p>
                        <p className="text-sm text-muted-foreground">{apt.Servico}</p>
                        {apt.ProfissionalNome ? (<p className="text-xs text-muted-foreground">Profissional: {apt.ProfissionalNome}</p>) : null}
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

                    <div className="mt-3">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-full"
                        onClick={() => openReminderMessage(apt)}
                      >
                        <MessageCircle size={14} className="mr-2" />
                        Ver lembrete para contato
                      </Button>
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
                <th className="text-left p-4 font-medium text-muted-foreground">Profissional</th>
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
                const isHighlighted = effectiveHighlightedAppointmentId === apt.AgendamentoId;

                const canConfirm = apt.AgendamentoStatus === "pending";
                const canCancel =
                  apt.AgendamentoStatus !== "cancelled" && apt.AgendamentoStatus !== "completed";
                const canComplete = apt.AgendamentoStatus === "confirmed";
                const canDelete = apt.AgendamentoStatus === "cancelled";

                return (
                  <tr
                    data-appointment-id={apt.AgendamentoId}
                    key={apt.AgendamentoId}
                    className={
                      isHighlighted
                        ? "border-b border-primary/30 bg-primary/5 hover:bg-primary/10 transition-colors"
                        : "border-b border-border/50 hover:bg-secondary/30 transition-colors"
                    }
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

                    <td className="p-4 text-foreground">{apt.ProfissionalNome || "—"}</td>

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

                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openReminderMessage(apt)}
                          className="text-primary hover:text-primary hover:bg-primary/20"
                          title="Mensagem de lembrete para WhatsApp"
                        >
                          <MessageCircle size={16} />
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

      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Página {pagination.page} de {pagination.totalPages} • {pagination.total} agendamento(s)
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={pagination.page <= 1}
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => setPage((prev) => prev + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
