import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { ClipboardList, Loader2, MessageCircle, Search } from "lucide-react";

import { apiGet } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { buildWhatsAppUrlWithText, isValidWhatsAppPhone } from "@/lib/whatsapp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type BudgetRequestStatus = "novo" | "em_analise" | "respondido" | "cancelado";

type BudgetRequest = {
  Id: number;
  EmpresaId: number;
  Nome: string;
  Telefone: string;
  TipoItem: string | null;
  Modelo: string;
  Defeito: string;
  Observacoes: string | null;
  Status: BudgetRequestStatus;
  CriadoEm: string | null;
  AtualizadoEm: string | null;
};

type BudgetRequestListResponse = {
  ok: true;
  solicitacoes: BudgetRequest[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
};

type BudgetRequestDetailResponse = {
  ok: true;
  solicitacao: BudgetRequest;
};

type CompanyResponse = {
  Nome?: string;
};

const STATUS_OPTIONS: Array<{ value: "all" | BudgetRequestStatus; label: string }> = [
  { value: "all", label: "Todos os status" },
  { value: "novo", label: "Novo" },
  { value: "em_analise", label: "Em analise" },
  { value: "respondido", label: "Respondido" },
  { value: "cancelado", label: "Cancelado" },
];

function statusLabel(value: string) {
  return STATUS_OPTIONS.find((item) => item.value === value)?.label || value;
}

function statusBadgeClass(value: BudgetRequestStatus) {
  if (value === "novo") return "bg-blue-500/20 text-blue-300 border border-blue-500/30";
  if (value === "em_analise") return "bg-amber-500/20 text-amber-200 border border-amber-500/30";
  if (value === "respondido") return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30";
  return "bg-rose-500/20 text-rose-300 border border-rose-500/30";
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const parsed = new Date(String(value).replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function buildWhatsAppReplyMessage(item: BudgetRequest, companyName: string) {
  const lines = [
    `Ola, ${item.Nome || "cliente"}! Aqui e da ${companyName}.`,
    "",
    "Recebemos sua solicitacao de orcamento para:",
    `Modelo: ${item.Modelo}`,
    `Problema: ${item.Defeito}`,
  ];

  if (item.TipoItem) lines.push(`Tipo: ${item.TipoItem}`);
  if (item.Observacoes) lines.push(`Observacoes: ${item.Observacoes}`);

  lines.push("", "Estamos enviando seu retorno por aqui.");
  return lines.join("\n");
}

function buildWhatsAppReplyUrl(item: BudgetRequest, companyName: string) {
  const text = buildWhatsAppReplyMessage(item, companyName);
  return buildWhatsAppUrlWithText(item.Telefone, text);
}

export function BudgetRequests() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(
    () => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }),
    [searchParams]
  );

  const [statusFilter, setStatusFilter] = useState<"all" | BudgetRequestStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const companyQuery = useQuery({
    queryKey: ["budget-requests-company", slug],
    queryFn: async () => apiGet<CompanyResponse>(`/api/empresas/${encodeURIComponent(slug)}`),
  });
  const companyName = companyQuery.data?.Nome?.trim() || "nossa equipe";

  const listQuery = useQuery({
    queryKey: ["budget-requests", slug, statusFilter, search, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (search.trim()) params.set("search", search.trim());
      params.set("page", String(page));
      params.set("pageSize", "20");
      return apiGet<BudgetRequestListResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/orcamentos/solicitacoes?${params.toString()}`
      );
    },
  });

  const detailQuery = useQuery({
    queryKey: ["budget-request-detail", slug, selectedId],
    enabled: Boolean(selectedId),
    queryFn: async () =>
      apiGet<BudgetRequestDetailResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/orcamentos/solicitacoes/${selectedId}`
      ),
  });

  const rows = listQuery.data?.solicitacoes || [];
  const pagination = listQuery.data?.pagination;

  return (
    <div className="space-y-6" data-cy="budget-requests-page">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold text-foreground">Solicitacoes de orcamento</h1>
        <p className="text-sm text-muted-foreground">
          Leads captados pelo SheilaChat para analise da equipe.
        </p>
      </div>

      <div className="glass-card p-4 rounded-xl space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <label className="text-xs text-muted-foreground">Buscar por nome, telefone, modelo ou defeito</label>
            <div className="mt-1 flex gap-2">
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder="Ex.: Joao, 1199999..., iPhone 11, tela quebrada..."
                data-cy="budget-requests-search"
              />
              <Button variant="outline" size="icon" className="shrink-0" aria-label="Buscar">
                <Search size={16} />
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value as "all" | BudgetRequestStatus);
                setPage(1);
              }}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status.value} value={status.value}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        {listQuery.isLoading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            Carregando solicitacoes...
          </div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <ClipboardList size={28} className="mx-auto mb-3 opacity-70" />
            Nenhuma solicitacao encontrada com os filtros atuais.
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {rows.map((item) => {
              const canReply = isValidWhatsAppPhone(item.Telefone);
              const whatsappUrl = canReply ? buildWhatsAppReplyUrl(item, companyName) : "";

              return (
                <div key={item.Id} className="p-4 hover:bg-secondary/20 transition-colors">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{item.Nome}</p>
                      <p className="text-sm text-muted-foreground">
                        {item.Telefone} - {item.Modelo}
                      </p>
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{item.Defeito}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <Badge className={statusBadgeClass(item.Status)}>{statusLabel(item.Status)}</Badge>
                      <span className="text-xs text-muted-foreground">{formatDateTime(item.CriadoEm)}</span>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setSelectedId(item.Id)} data-cy={`budget-request-detail-${item.Id}`}>
                      Ver detalhes
                    </Button>
                    {canReply ? (
                      <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" data-cy={`budget-request-whatsapp-${item.Id}`}>
                        <a href={whatsappUrl} target="_blank" rel="noreferrer">
                          <MessageCircle size={14} className="mr-1.5" />
                          Responder no WhatsApp
                        </a>
                      </Button>
                    ) : (
                      <Button size="sm" disabled title="Telefone invalido para abrir WhatsApp">
                        <MessageCircle size={14} className="mr-1.5" />
                        WhatsApp indisponivel
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            Pagina {pagination.page} de {pagination.totalPages} - {pagination.total} solicitacoes
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={pagination.page <= 1}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.min(pagination.totalPages, prev + 1))}
              disabled={pagination.page >= pagination.totalPages}
            >
              Proxima
            </Button>
          </div>
        </div>
      )}

      <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Detalhes da solicitacao</DialogTitle>
          </DialogHeader>

          {detailQuery.isLoading ? (
            <div className="py-8 flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
              Carregando...
            </div>
          ) : detailQuery.data?.solicitacao ? (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-muted-foreground">Nome</p>
                  <p className="font-medium">{detailQuery.data.solicitacao.Nome}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Telefone</p>
                  <p className="font-medium">{detailQuery.data.solicitacao.Telefone}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Tipo de aparelho/servico</p>
                  <p className="font-medium">{detailQuery.data.solicitacao.TipoItem || "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Modelo</p>
                  <p className="font-medium">{detailQuery.data.solicitacao.Modelo}</p>
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Defeito relatado</p>
                <p className="font-medium whitespace-pre-wrap">{detailQuery.data.solicitacao.Defeito}</p>
              </div>

              <div>
                <p className="text-xs text-muted-foreground">Observacoes</p>
                <p className="font-medium whitespace-pre-wrap">{detailQuery.data.solicitacao.Observacoes || "-"}</p>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-border/60">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={statusBadgeClass(detailQuery.data.solicitacao.Status)}>
                    {statusLabel(detailQuery.data.solicitacao.Status)}
                  </Badge>
                  {isValidWhatsAppPhone(detailQuery.data.solicitacao.Telefone) ? (
                    <Button asChild size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white">
                      <a
                        href={buildWhatsAppReplyUrl(detailQuery.data.solicitacao, companyName)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <MessageCircle size={14} className="mr-1.5" />
                        Responder no WhatsApp
                      </a>
                    </Button>
                  ) : (
                    <Button size="sm" disabled title="Telefone invalido para abrir WhatsApp">
                      <MessageCircle size={14} className="mr-1.5" />
                      WhatsApp indisponivel
                    </Button>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  Criado em: {formatDateTime(detailQuery.data.solicitacao.CriadoEm)}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Nao foi possivel carregar os detalhes agora.</p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default BudgetRequests;
