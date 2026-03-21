import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPatch, apiPost, apiPut } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { buildWhatsAppUrlWithText, isValidWhatsAppPhone } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FileText, MessageCircle, Pencil, Plus, Printer, RefreshCw, Search } from "lucide-react";

type OrderStatus =
  | "aberta"
  | "aguardando_aprovacao"
  | "aprovada"
  | "em_reparo"
  | "pronta"
  | "entregue"
  | "cancelada"
  | "recusada";

type BudgetStatus = "aguardando_aprovacao" | "aprovado" | "recusado";
type DeviceType = "celular" | "tablet" | "notebook" | "outro";

type ServiceOrder = {
  Id: number;
  NumeroOS: string;
  EmpresaId: number;
  ClienteNome: string;
  ClienteTelefone: string;
  ClienteCpf: string | null;
  TipoAparelho: DeviceType;
  Marca: string;
  Modelo: string;
  Cor: string | null;
  ImeiSerial: string | null;
  Acessorios: string | null;
  SenhaPadrao?: string | null;
  EstadoEntrada: string;
  DefeitoRelatado: string;
  DefeitoResumo?: string;
  ObservacoesTecnicas: string | null;
  ValorMaoObra: number;
  ValorPecas: number;
  ValorMaterial?: number;
  ValorTotal: number;
  PrazoEstimado: string | null;
  StatusOrcamento: BudgetStatus;
  StatusOrdem: OrderStatus;
  DataEntrada: string;
  PrevisaoEntrega: string | null;
  ObservacoesGerais: string | null;
  ReceitaGerada?: boolean;
  FinanceiroReceitaId?: number | null;
  ReceitaGeradaEm?: string | null;
  CriadoEm: string | null;
  AtualizadoEm: string | null;
};

type OrdersResponse = {
  ok: true;
  ordens: ServiceOrder[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type OrderResponse = {
  ok: boolean;
  ordem?: ServiceOrder;
  financeiro?: {
    created?: boolean;
    alreadyExisted?: boolean;
    receitaId?: number | null;
  };
};

type CompanyResponse = {
  Nome?: string;
};

type FormState = {
  clienteNome: string;
  clienteTelefone: string;
  clienteCpf: string;
  tipoAparelho: DeviceType;
  marca: string;
  modelo: string;
  cor: string;
  imeiSerial: string;
  acessorios: string;
  senhaPadrao: string;
  estadoEntrada: string;
  defeitoRelatado: string;
  observacoesTecnicas: string;
  valorMaoObra: string;
  valorPecas: string;
  valorTotal: string;
  prazoEstimado: string;
  statusOrcamento: BudgetStatus;
  statusOrdem: OrderStatus;
  dataEntrada: string;
  previsaoEntrega: string;
  observacoesGerais: string;
};

const ORDER_STATUS_OPTIONS: Array<{ value: OrderStatus; label: string }> = [
  { value: "aberta", label: "Aberta" },
  { value: "aguardando_aprovacao", label: "Aguardando aprovacao" },
  { value: "aprovada", label: "Aprovada" },
  { value: "em_reparo", label: "Em reparo" },
  { value: "pronta", label: "Pronta" },
  { value: "entregue", label: "Entregue" },
  { value: "cancelada", label: "Cancelada" },
  { value: "recusada", label: "Recusada" },
];

const BUDGET_STATUS_OPTIONS: Array<{ value: BudgetStatus; label: string }> = [
  { value: "aguardando_aprovacao", label: "Aguardando aprovacao" },
  { value: "aprovado", label: "Aprovado" },
  { value: "recusado", label: "Recusado" },
];

const DEVICE_TYPE_OPTIONS: Array<{ value: DeviceType; label: string }> = [
  { value: "celular", label: "Celular" },
  { value: "tablet", label: "Tablet" },
  { value: "notebook", label: "Notebook" },
  { value: "outro", label: "Outro" },
];

function formatMoney(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(Number(value || 0));
}

function parseMoneyInput(value: string) {
  const parsed = Number(String(value || "0").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Number(parsed.toFixed(2));
}

function calculateOrderTotal(maoDeObra: string, material: string) {
  return Number((parseMoneyInput(maoDeObra) + parseMoneyInput(material)).toFixed(2));
}

function getStatusLabel(value: OrderStatus) {
  return ORDER_STATUS_OPTIONS.find((item) => item.value === value)?.label || value;
}

function getClientFriendlyStatus(value: OrderStatus) {
  if (value === "aberta") return "Recebemos seu aparelho";
  if (value === "aguardando_aprovacao") return "Aguardando aprovacao";
  if (value === "aprovada") return "Aprovada";
  if (value === "em_reparo") return "Em manutencao";
  if (value === "pronta") return "Pronto para retirada";
  if (value === "entregue") return "Servico finalizado";
  if (value === "cancelada") return "Atendimento cancelado";
  if (value === "recusada") return "Atendimento cancelado";
  return "Em andamento";
}

function normalizeDefectSummary(order: ServiceOrder) {
  const source = String(order.DefeitoResumo || order.DefeitoRelatado || "").trim();
  const oneLine = source.replace(/\s+/g, " ");
  return oneLine.length > 160 ? `${oneLine.slice(0, 157)}...` : oneLine;
}

function buildOrderWhatsAppMessage(order: ServiceOrder, companyName: string) {
  const lines = [
    `Ola, ${order.ClienteNome || "cliente"}!`,
    "",
    "Segue o comprovante do seu atendimento:",
    "",
    `OS: ${order.NumeroOS}`,
    `Aparelho: ${`${order.Marca || ""} ${order.Modelo || ""}`.trim() || "-"}`,
    `Problema: ${normalizeDefectSummary(order) || "-"}`,
    `Status: ${getClientFriendlyStatus(order.StatusOrdem)}`,
    `Valor total: ${formatMoney(order.ValorTotal)}`,
  ];

  if (order.PrevisaoEntrega) {
    lines.push(`Previsao: ${order.PrevisaoEntrega}`);
  }

  lines.push("", "Guarde este numero para acompanhamento do servico.");
  if (companyName) lines.push("", `- ${companyName}`);
  return lines.join("\n");
}

function buildOrderWhatsAppUrl(order: ServiceOrder, companyName: string) {
  return buildWhatsAppUrlWithText(order.ClienteTelefone, buildOrderWhatsAppMessage(order, companyName));
}

function getBudgetStatusLabel(value: BudgetStatus) {
  return BUDGET_STATUS_OPTIONS.find((item) => item.value === value)?.label || value;
}

function getStatusBadgeClass(value: OrderStatus) {
  if (value === "entregue") return "bg-blue-500/20 text-blue-300 border border-blue-500/30";
  if (value === "pronta" || value === "aprovada") return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
  if (value === "cancelada" || value === "recusada") return "bg-rose-500/20 text-rose-300 border border-rose-500/30";
  if (value === "em_reparo") return "bg-purple-500/20 text-purple-300 border border-purple-500/30";
  return "bg-amber-500/20 text-amber-200 border border-amber-500/30";
}

function defaultFormState(): FormState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    clienteNome: "",
    clienteTelefone: "",
    clienteCpf: "",
    tipoAparelho: "celular",
    marca: "",
    modelo: "",
    cor: "",
    imeiSerial: "",
    acessorios: "",
    senhaPadrao: "",
    estadoEntrada: "",
    defeitoRelatado: "",
    observacoesTecnicas: "",
    valorMaoObra: "",
    valorPecas: "",
    valorTotal: "",
    prazoEstimado: "",
    statusOrcamento: "aguardando_aprovacao",
    statusOrdem: "aberta",
    dataEntrada: today,
    previsaoEntrega: "",
    observacoesGerais: "",
  };
}

function mapOrderToForm(order: ServiceOrder): FormState {
  return {
    clienteNome: order.ClienteNome || "",
    clienteTelefone: order.ClienteTelefone || "",
    clienteCpf: order.ClienteCpf || "",
    tipoAparelho: order.TipoAparelho || "outro",
    marca: order.Marca || "",
    modelo: order.Modelo || "",
    cor: order.Cor || "",
    imeiSerial: order.ImeiSerial || "",
    acessorios: order.Acessorios || "",
    senhaPadrao: order.SenhaPadrao || "",
    estadoEntrada: order.EstadoEntrada || "",
    defeitoRelatado: order.DefeitoRelatado || "",
    observacoesTecnicas: order.ObservacoesTecnicas || "",
    valorMaoObra: String(order.ValorMaoObra || ""),
    valorPecas: String(order.ValorPecas || ""),
    valorTotal: String(order.ValorTotal || ""),
    prazoEstimado: order.PrazoEstimado || "",
    statusOrcamento: order.StatusOrcamento || "aguardando_aprovacao",
    statusOrdem: order.StatusOrdem || "aberta",
    dataEntrada: order.DataEntrada || new Date().toISOString().slice(0, 10),
    previsaoEntrega: order.PrevisaoEntrega || "",
    observacoesGerais: order.ObservacoesGerais || "",
  };
}

function openPrintOrder(order: ServiceOrder, companyName: string) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;

  const esc = (value: string | null | undefined) =>
    String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const html = `
    <html>
      <head>
        <title>${esc(order.NumeroOS)} - Ordem de Servico</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 32px; color: #111; }
          h1,h2,h3,p { margin: 0; }
          .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom: 20px; }
          .box { border:1px solid #ddd; border-radius: 8px; padding: 12px; margin-bottom: 12px; }
          .grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
          .line { height: 1px; background: #ddd; margin: 16px 0; }
          .small { color: #555; font-size: 12px; }
          .label { font-size: 12px; color: #555; margin-bottom: 4px; }
          .sig { margin-top: 48px; display:grid; grid-template-columns: 1fr 1fr; gap: 24px; }
          .sig-line { border-top:1px solid #333; padding-top:8px; text-align:center; font-size:12px; color:#333; }
          @media print { body { margin: 16px; } }
        </style>
      </head>
      <body>
        <div class="header">
          <div>
            <h2>${esc(companyName || "Sheila System")}</h2>
            <p class="small">Ordem de Servico</p>
          </div>
          <div style="text-align:right">
            <h3>${esc(order.NumeroOS)}</h3>
            <p class="small">Data de entrada: ${esc(order.DataEntrada)}</p>
          </div>
        </div>
        <div class="box">
          <p><strong>Cliente:</strong> ${esc(order.ClienteNome)} - ${esc(order.ClienteTelefone)}</p>
          <p><strong>CPF:</strong> ${esc(order.ClienteCpf || "-")}</p>
          <p><strong>Aparelho:</strong> ${esc(order.TipoAparelho)} - ${esc(order.Marca)} ${esc(order.Modelo)}</p>
          <p><strong>Defeito:</strong> ${esc(order.DefeitoRelatado)}</p>
          <p><strong>Mao de obra:</strong> ${esc(formatMoney(order.ValorMaoObra))}</p>
          <p><strong>Material:</strong> ${esc(formatMoney(order.ValorMaterial ?? order.ValorPecas))}</p>
          <p><strong>Total:</strong> ${esc(formatMoney(order.ValorTotal))}</p>
          <p><strong>Status:</strong> ${esc(getStatusLabel(order.StatusOrdem))}</p>
        </div>
        <div class="sig">
          <div class="sig-line">Assinatura do cliente</div>
          <div class="sig-line">Assinatura da assistencia/tecnico</div>
        </div>
      </body>
    </html>
  `;

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

export function ServiceOrders() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(
    () => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }),
    [searchParams]
  );

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [clienteFilter, setClienteFilter] = useState("");
  const [numeroFilter, setNumeroFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState("");
  const [endDateFilter, setEndDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [editingOrderId, setEditingOrderId] = useState<number | null>(null);
  const [detailOrder, setDetailOrder] = useState<ServiceOrder | null>(null);
  const [formState, setFormState] = useState<FormState>(() => defaultFormState());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [statusDraftById, setStatusDraftById] = useState<Record<number, OrderStatus>>({});
  const computedTotal = useMemo(
    () => calculateOrderTotal(formState.valorMaoObra, formState.valorPecas),
    [formState.valorMaoObra, formState.valorPecas]
  );

  const companyQuery = useQuery({
    queryKey: ["service-orders-company", slug],
    queryFn: () => apiGet<CompanyResponse>(`/api/empresas/${encodeURIComponent(slug)}`),
  });

  const ordersQuery = useQuery({
    queryKey: [
      "service-orders",
      slug,
      statusFilter,
      clienteFilter,
      numeroFilter,
      startDateFilter,
      endDateFilter,
      page,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "20");
      if (statusFilter && statusFilter !== "all") params.set("status", statusFilter);
      if (clienteFilter.trim()) params.set("cliente", clienteFilter.trim());
      if (numeroFilter.trim()) params.set("numero", numeroFilter.trim());
      if (startDateFilter && endDateFilter) {
        params.set("startDate", startDateFilter);
        params.set("endDate", endDateFilter);
      }
      return apiGet<OrdersResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/ordens-servico?${params.toString()}`
      );
    },
  });

  const orders = ordersQuery.data?.ordens || [];
  const pagination = ordersQuery.data?.pagination;

  useEffect(() => {
    setStatusDraftById((prev) => {
      const next: Record<number, OrderStatus> = { ...prev };
      for (const order of orders) {
        if (!next[order.Id]) next[order.Id] = order.StatusOrdem;
      }
      return next;
    });
  }, [orders]);

  useEffect(() => {
    const nextTotal = String(computedTotal);
    setFormState((prev) => (prev.valorTotal === nextTotal ? prev : { ...prev, valorTotal: nextTotal }));
  }, [computedTotal]);

  useEffect(() => {
    setPage(1);
  }, [statusFilter, clienteFilter, numeroFilter, startDateFilter, endDateFilter, slug]);

  async function refreshOrders() {
    await ordersQuery.refetch();
  }

  function openCreate() {
    setEditingOrderId(null);
    setFormState(defaultFormState());
    setFormError(null);
    setIsFormOpen(true);
  }

  async function openEdit(orderId: number) {
    try {
      const response = await apiGet<OrderResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/ordens-servico/${orderId}`
      );
      if (!response?.ordem) throw new Error("Ordem nao encontrada.");
      setEditingOrderId(orderId);
      setFormState(mapOrderToForm(response.ordem));
      setFormError(null);
      setIsFormOpen(true);
    } catch (err: any) {
      setFormError(err?.message || "Falha ao carregar a ordem para edicao.");
    }
  }

  async function openDetail(orderId: number) {
    try {
      const response = await apiGet<OrderResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/ordens-servico/${orderId}`
      );
      if (!response?.ordem) throw new Error("Ordem nao encontrada.");
      setDetailOrder(response.ordem);
      setIsDetailOpen(true);
    } catch (err: any) {
      alert(err?.message || "Falha ao carregar detalhes da ordem.");
    }
  }

  async function saveOrder() {
    setFormError(null);
    if (!formState.clienteNome.trim()) return setFormError("Informe o nome do cliente.");
    if (!formState.clienteTelefone.trim()) return setFormError("Informe o telefone do cliente.");
    if (!formState.marca.trim()) return setFormError("Informe a marca do aparelho.");
    if (!formState.modelo.trim()) return setFormError("Informe o modelo do aparelho.");
    if (!formState.estadoEntrada.trim()) return setFormError("Informe o estado do aparelho na entrada.");
    if (!formState.defeitoRelatado.trim()) return setFormError("Informe o defeito relatado.");
    if (!formState.dataEntrada) return setFormError("Informe a data de entrada.");

    const valorMaoObra = parseMoneyInput(formState.valorMaoObra);
    const valorMaterial = parseMoneyInput(formState.valorPecas);
    const valorTotal = Number((valorMaoObra + valorMaterial).toFixed(2));

    const payload = {
      ...formState,
      valorMaoObra,
      valorPecas: valorMaterial,
      valorMaterial,
      valorTotal,
      clienteCpf: formState.clienteCpf || null,
      cor: formState.cor || null,
      imeiSerial: formState.imeiSerial || null,
      acessorios: formState.acessorios || null,
      senhaPadrao: formState.senhaPadrao || null,
      observacoesTecnicas: formState.observacoesTecnicas || null,
      prazoEstimado: formState.prazoEstimado || null,
      previsaoEntrega: formState.previsaoEntrega || null,
      observacoesGerais: formState.observacoesGerais || null,
    };

    try {
      setSaving(true);
      if (editingOrderId) {
        await apiPut<OrderResponse>(
          `/api/empresas/${encodeURIComponent(slug)}/ordens-servico/${editingOrderId}`,
          payload
        );
      } else {
        await apiPost<OrderResponse>(
          `/api/empresas/${encodeURIComponent(slug)}/ordens-servico`,
          payload
        );
      }
      setIsFormOpen(false);
      setEditingOrderId(null);
      setFormState(defaultFormState());
      await refreshOrders();
    } catch (err: any) {
      setFormError(err?.message || "Nao foi possivel salvar a ordem de servico.");
    } finally {
      setSaving(false);
    }
  }

  async function saveQuickStatus(order: ServiceOrder) {
    const nextStatus = statusDraftById[order.Id] || order.StatusOrdem;
    try {
      const response = await apiPatch<OrderResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/ordens-servico/${order.Id}/status`,
        { statusOrdem: nextStatus }
      );
      if (nextStatus === "entregue") {
        if (response?.financeiro?.created) {
          setStatusFeedback("OS marcada como entregue e receita lancada no financeiro.");
        } else if (response?.financeiro?.alreadyExisted) {
          setStatusFeedback("OS marcada como entregue. Receita ja estava lancada anteriormente.");
        } else {
          setStatusFeedback("OS marcada como entregue com sucesso.");
        }
      } else {
        setStatusFeedback("Status da OS atualizado com sucesso.");
      }
      await refreshOrders();
    } catch (err: any) {
      alert(err?.message || "Falha ao atualizar status da OS.");
    }
  }

  return (
    <div className="space-y-6" data-cy="service-orders-page">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-foreground">Ordens de Servico</h1>
          <p className="text-muted-foreground mt-1">
            Registre aparelhos, acompanhe status e gere documento para impressao.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refreshOrders()}>
            <RefreshCw size={16} className="mr-2" />
            Atualizar
          </Button>
          <Button onClick={openCreate} data-cy="service-order-new">
            <Plus size={16} className="mr-2" />
            Nova OS
          </Button>
        </div>
      </div>

      <div className="glass-card p-4 sm:p-5 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <div className="xl:col-span-1">
            <Label>Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="mt-2 bg-secondary border-border">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {ORDER_STATUS_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="xl:col-span-2">
            <Label>Cliente</Label>
            <div className="mt-2 relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={clienteFilter}
                onChange={(e) => setClienteFilter(e.target.value)}
                placeholder="Nome ou telefone"
                className="pl-8"
              />
            </div>
          </div>
          <div className="xl:col-span-1">
            <Label>Numero OS</Label>
            <Input
              className="mt-2"
              value={numeroFilter}
              onChange={(e) => setNumeroFilter(e.target.value)}
              placeholder="OS-000001"
            />
          </div>
          <div className="xl:col-span-1">
            <Label>Data inicial</Label>
            <Input
              className="mt-2"
              type="date"
              value={startDateFilter}
              onChange={(e) => setStartDateFilter(e.target.value)}
            />
          </div>
          <div className="xl:col-span-1">
            <Label>Data final</Label>
            <Input
              className="mt-2"
              type="date"
              value={endDateFilter}
              onChange={(e) => setEndDateFilter(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="glass-card overflow-hidden">
        {statusFeedback && (
          <div className="mx-4 mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
            {statusFeedback}
          </div>
        )}
        {ordersQuery.isLoading ? (
          <div className="p-10 text-center text-muted-foreground">Carregando ordens de servico...</div>
        ) : ordersQuery.isError ? (
          <div className="p-10 text-center text-destructive">Falha ao carregar ordens de servico.</div>
        ) : orders.length === 0 ? (
          <div className="p-10 text-center text-muted-foreground">
            Nenhuma ordem de servico encontrada com os filtros atuais.
          </div>
        ) : (
          <>
            <div className="md:hidden p-3 space-y-3">
              {orders.map((order) => (
                <div key={order.Id} className="rounded-lg border border-border/70 bg-secondary/20 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-foreground">{order.NumeroOS}</p>
                    <Badge className={getStatusBadgeClass(order.StatusOrdem)}>
                      {getStatusLabel(order.StatusOrdem)}
                    </Badge>
                  </div>
                  <p className="text-sm text-foreground">{order.ClienteNome}</p>
                  <p className="text-xs text-muted-foreground">
                    {order.Marca} {order.Modelo} - {order.DataEntrada}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Defeito: {order.DefeitoResumo || order.DefeitoRelatado}
                  </p>
                  <p className="text-sm font-semibold text-primary">{formatMoney(order.ValorTotal)}</p>
                  {!isValidWhatsAppPhone(order.ClienteTelefone) && (
                    <p className="text-xs text-amber-300">WhatsApp indisponivel: telefone invalido do cliente.</p>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={() => openDetail(order.Id)} data-cy={`service-order-view-${order.Id}`}>
                      Ver
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(order.Id)} data-cy={`service-order-edit-${order.Id}`}>
                      Editar
                    </Button>
                    {isValidWhatsAppPhone(order.ClienteTelefone) ? (
                      <Button
                        asChild
                        size="sm"
                        className="col-span-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <a
                          href={buildOrderWhatsAppUrl(order, companyQuery.data?.Nome || "Sheila System")}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <MessageCircle size={14} className="mr-1" />
                          Enviar no WhatsApp
                        </a>
                      </Button>
                    ) : (
                      <Button size="sm" className="col-span-2" disabled>
                        <MessageCircle size={14} className="mr-1" />
                        WhatsApp indisponivel
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className="col-span-2"
                      onClick={() => openPrintOrder(order, companyQuery.data?.Nome || "Sheila System")}
                    >
                      <Printer size={14} className="mr-1" />
                      Imprimir / baixar
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <table className="hidden md:table w-full">
              <thead>
                <tr className="border-b border-border bg-secondary/50">
                  <th className="p-3 text-left text-xs text-muted-foreground">OS</th>
                  <th className="p-3 text-left text-xs text-muted-foreground">Cliente</th>
                  <th className="p-3 text-left text-xs text-muted-foreground">Aparelho</th>
                  <th className="p-3 text-left text-xs text-muted-foreground">Defeito</th>
                  <th className="p-3 text-left text-xs text-muted-foreground">Valor</th>
                  <th className="p-3 text-left text-xs text-muted-foreground">Status</th>
                  <th className="p-3 text-left text-xs text-muted-foreground">Data entrada</th>
                  <th className="p-3 text-right text-xs text-muted-foreground">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.Id} className="border-b border-border/50 hover:bg-secondary/20" data-cy={`service-order-row-${order.Id}`}>
                    <td className="p-3 font-medium text-foreground">{order.NumeroOS}</td>
                    <td className="p-3">
                      <p className="text-foreground">{order.ClienteNome}</p>
                      <p className="text-xs text-muted-foreground">{order.ClienteTelefone}</p>
                    </td>
                    <td className="p-3 text-foreground">{order.Marca} {order.Modelo}</td>
                    <td className="p-3 text-sm text-muted-foreground max-w-[260px] truncate">
                      {order.DefeitoResumo || order.DefeitoRelatado}
                    </td>
                    <td className="p-3 font-semibold text-primary">{formatMoney(order.ValorTotal)}</td>
                    <td className="p-3">
                      <Badge className={getStatusBadgeClass(order.StatusOrdem)}>
                        {getStatusLabel(order.StatusOrdem)}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground">{order.DataEntrada}</td>
                    <td className="p-3">
                      <div className="flex items-center justify-end gap-2">
                        <Select
                          value={statusDraftById[order.Id] || order.StatusOrdem}
                          onValueChange={(value) =>
                            setStatusDraftById((prev) => ({ ...prev, [order.Id]: value as OrderStatus }))
                          }
                        >
                          <SelectTrigger className="w-[180px] h-8 bg-secondary border-border" data-cy={`service-order-status-select-${order.Id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ORDER_STATUS_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" variant="outline" onClick={() => saveQuickStatus(order)} data-cy={`service-order-status-save-${order.Id}`}>
                          Salvar
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => openDetail(order.Id)} data-cy={`service-order-view-icon-${order.Id}`}>
                          <FileText size={16} />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => openEdit(order.Id)} data-cy={`service-order-edit-icon-${order.Id}`}>
                          <Pencil size={16} />
                        </Button>
                        {isValidWhatsAppPhone(order.ClienteTelefone) ? (
                          <Button
                            size="icon"
                            variant="ghost"
                            asChild
                            title="Enviar comprovante no WhatsApp"
                          >
                            <a
                              href={buildOrderWhatsAppUrl(order, companyQuery.data?.Nome || "Sheila System")}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <MessageCircle size={16} />
                            </a>
                          </Button>
                        ) : (
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled
                            title="Telefone do cliente invalido para WhatsApp"
                          >
                            <MessageCircle size={16} />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => openPrintOrder(order, companyQuery.data?.Nome || "Sheila System")}
                        >
                          <Printer size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Pagina {pagination.page} de {pagination.totalPages} - {pagination.total} ordem(ns)
          </p>
          <div className="flex gap-2">
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
              Proxima
            </Button>
          </div>
        </div>
      )}

      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingOrderId ? "Editar ordem de servico" : "Nova ordem de servico"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-5 pt-2" data-cy="service-order-form">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>Cliente</Label>
                <Input data-cy="service-order-cliente-nome" value={formState.clienteNome} onChange={(e) => setFormState((p) => ({ ...p, clienteNome: e.target.value }))} />
              </div>
              <div>
                <Label>Telefone</Label>
                <Input data-cy="service-order-cliente-telefone" value={formState.clienteTelefone} onChange={(e) => setFormState((p) => ({ ...p, clienteTelefone: e.target.value }))} />
              </div>
              <div>
                <Label>CPF (opcional)</Label>
                <Input value={formState.clienteCpf} onChange={(e) => setFormState((p) => ({ ...p, clienteCpf: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label>Tipo aparelho</Label>
                <Select value={formState.tipoAparelho} onValueChange={(value) => setFormState((p) => ({ ...p, tipoAparelho: value as DeviceType }))}>
                  <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DEVICE_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Marca</Label>
                <Input data-cy="service-order-marca" value={formState.marca} onChange={(e) => setFormState((p) => ({ ...p, marca: e.target.value }))} />
              </div>
              <div>
                <Label>Modelo</Label>
                <Input data-cy="service-order-modelo" value={formState.modelo} onChange={(e) => setFormState((p) => ({ ...p, modelo: e.target.value }))} />
              </div>
              <div>
                <Label>Cor</Label>
                <Input value={formState.cor} onChange={(e) => setFormState((p) => ({ ...p, cor: e.target.value }))} />
              </div>
              <div>
                <Label>IMEI/Serial</Label>
                <Input value={formState.imeiSerial} onChange={(e) => setFormState((p) => ({ ...p, imeiSerial: e.target.value }))} />
              </div>
              <div>
                <Label>Acessorios</Label>
                <Input value={formState.acessorios} onChange={(e) => setFormState((p) => ({ ...p, acessorios: e.target.value }))} />
              </div>
              <div>
                <Label>Senha/Padrao</Label>
                <Input value={formState.senhaPadrao} onChange={(e) => setFormState((p) => ({ ...p, senhaPadrao: e.target.value }))} />
              </div>
              <div>
                <Label>Data entrada</Label>
                <Input type="date" value={formState.dataEntrada} onChange={(e) => setFormState((p) => ({ ...p, dataEntrada: e.target.value }))} />
              </div>
            </div>

            <div>
              <Label>Estado do aparelho na entrada</Label>
                <Textarea data-cy="service-order-estado-entrada" rows={2} value={formState.estadoEntrada} onChange={(e) => setFormState((p) => ({ ...p, estadoEntrada: e.target.value }))} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Defeito relatado</Label>
                <Textarea data-cy="service-order-defeito" rows={3} value={formState.defeitoRelatado} onChange={(e) => setFormState((p) => ({ ...p, defeitoRelatado: e.target.value }))} />
              </div>
              <div>
                <Label>Observacoes tecnicas</Label>
                <Textarea rows={3} value={formState.observacoesTecnicas} onChange={(e) => setFormState((p) => ({ ...p, observacoesTecnicas: e.target.value }))} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div>
                <Label>Mao de obra</Label>
                <Input data-cy="service-order-mao-obra" type="number" min="0" step="0.01" value={formState.valorMaoObra} onChange={(e) => setFormState((p) => ({ ...p, valorMaoObra: e.target.value }))} />
              </div>
              <div>
                <Label>Material</Label>
                <Input data-cy="service-order-material" type="number" min="0" step="0.01" value={formState.valorPecas} onChange={(e) => setFormState((p) => ({ ...p, valorPecas: e.target.value }))} />
              </div>
              <div>
                <Label>Total (calculado)</Label>
                <Input type="number" min="0" step="0.01" value={String(computedTotal)} readOnly className="bg-secondary/50" />
              </div>
              <div>
                <Label>Prazo estimado</Label>
                <Input value={formState.prazoEstimado} onChange={(e) => setFormState((p) => ({ ...p, prazoEstimado: e.target.value }))} />
              </div>
              <div>
                <Label>Status orcamento</Label>
                <Select value={formState.statusOrcamento} onValueChange={(value) => setFormState((p) => ({ ...p, statusOrcamento: value as BudgetStatus }))}>
                  <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BUDGET_STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status ordem</Label>
                <Select value={formState.statusOrdem} onValueChange={(value) => setFormState((p) => ({ ...p, statusOrdem: value as OrderStatus }))}>
                  <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORDER_STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Previsao entrega</Label>
                <Input data-cy="service-order-previsao-entrega" type="date" value={formState.previsaoEntrega} onChange={(e) => setFormState((p) => ({ ...p, previsaoEntrega: e.target.value }))} />
              </div>
              <div className="md:col-span-4">
                <Label>Observacoes gerais</Label>
                <Textarea rows={2} value={formState.observacoesGerais} onChange={(e) => setFormState((p) => ({ ...p, observacoesGerais: e.target.value }))} />
              </div>
            </div>

            {formError && <p className="text-sm text-destructive">{formError}</p>}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsFormOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={saveOrder} disabled={saving} data-cy="service-order-save">
                {saving ? "Salvando..." : editingOrderId ? "Salvar alteracoes" : "Criar ordem"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {detailOrder?.NumeroOS || "Detalhes da OS"}
            </DialogTitle>
          </DialogHeader>
          {detailOrder ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className={getStatusBadgeClass(detailOrder.StatusOrdem)}>
                  {getStatusLabel(detailOrder.StatusOrdem)}
                </Badge>
                <Badge variant="outline">{getBudgetStatusLabel(detailOrder.StatusOrcamento)}</Badge>
                <Badge variant="outline">Entrada: {detailOrder.DataEntrada}</Badge>
              </div>
              <div className="glass-card p-3">
                <p className="font-medium text-foreground">{detailOrder.ClienteNome}</p>
                <p className="text-sm text-muted-foreground">{detailOrder.ClienteTelefone} - CPF: {detailOrder.ClienteCpf || "-"}</p>
              </div>
              <div className="glass-card p-3 text-sm text-foreground">
                <p><strong>Aparelho:</strong> {detailOrder.TipoAparelho} - {detailOrder.Marca} {detailOrder.Modelo}</p>
                <p><strong>Defeito:</strong> {detailOrder.DefeitoRelatado}</p>
                <p><strong>Estado entrada:</strong> {detailOrder.EstadoEntrada}</p>
                <p><strong>Mao de obra:</strong> {formatMoney(detailOrder.ValorMaoObra)}</p>
                <p><strong>Material:</strong> {formatMoney(detailOrder.ValorMaterial ?? detailOrder.ValorPecas)}</p>
                <p><strong>Total cobrado do cliente:</strong> {formatMoney(detailOrder.ValorTotal)}</p>
                <p><strong>Valor lancado no financeiro:</strong> {formatMoney(detailOrder.ValorMaoObra)}</p>
                <p><strong>Receita lancada:</strong> {detailOrder.ReceitaGerada ? "Sim" : "Nao"}</p>
                {detailOrder.FinanceiroReceitaId ? (
                  <p><strong>Lancamento financeiro:</strong> #{detailOrder.FinanceiroReceitaId}</p>
                ) : null}
              </div>
              {!isValidWhatsAppPhone(detailOrder.ClienteTelefone) && (
                <p className="text-xs text-amber-300">WhatsApp indisponivel: telefone invalido do cliente.</p>
              )}
              <div className="flex justify-end gap-2">
                {isValidWhatsAppPhone(detailOrder.ClienteTelefone) ? (
                  <Button
                    asChild
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <a
                      href={buildOrderWhatsAppUrl(detailOrder, companyQuery.data?.Nome || "Sheila System")}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <MessageCircle size={14} className="mr-2" />
                      Enviar no WhatsApp
                    </a>
                  </Button>
                ) : (
                  <Button disabled>
                    <MessageCircle size={14} className="mr-2" />
                    WhatsApp indisponivel
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => openPrintOrder(detailOrder, companyQuery.data?.Nome || "Sheila System")}
                >
                  <Printer size={14} className="mr-2" />
                  Imprimir / baixar
                </Button>
                <Button
                  onClick={() => {
                    setIsDetailOpen(false);
                    openEdit(detailOrder.Id);
                  }}
                >
                  Editar
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
