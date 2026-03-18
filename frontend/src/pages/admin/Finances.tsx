import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useAdminProfessionalContext } from "@/hooks/useAdminProfessionalContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { toast } from "sonner";
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calculator, PiggyBank, TrendingUp, Wallet } from "lucide-react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

type Period = "week" | "month" | "next7";

type FinanceRules = {
  owner: number;
  cash: number;
  expenses: number;
};

type ExpenseItem = {
  Id: number;
  EmpresaId: number;
  Descricao: string;
  Categoria: string;
  CategoriaLabel?: string;
  Valor: number;
  DataDespesa: string;
  Observacao?: string | null;
  CriadoEm?: string | null;
  AtualizadoEm?: string | null;
};

type FinanceConfigResponse = {
  ok: true;
  config: FinanceRules;
};

type FinanceSummaryResponse = {
  ok: true;
  resumo: {
    weekRevenue: number;
    monthRevenue: number;
    customRevenue?: number;
    customRange?: { startDate: string; endDate: string } | null;
    financeRules: FinanceRules;
    weekExpensesBudget: number;
    monthExpensesBudget: number;
    customExpensesBudget: number;
    weekExpensesActual: number;
    monthExpensesActual: number;
    customExpensesActual: number;
    weekNetRevenue: number;
    monthNetRevenue: number;
    customNetRevenue: number;
    weekBudgetDifference: number;
    monthBudgetDifference: number;
    customBudgetDifference: number;
    dailyRevenue?: Array<{
      date: string;
      value: number;
    }>;
  };
};

type ExpensesResponse = {
  ok: true;
  despesas: ExpenseItem[];
  total: number;
};

type ExpenseMutationResponse = {
  ok: boolean;
  despesa?: ExpenseItem | null;
};

type ExpenseFormState = {
  descricao: string;
  categoria: string;
  valor: string;
  dataDespesa: string;
  observacao: string;
};

const DEFAULT_RULES: FinanceRules = {
  owner: 50,
  cash: 30,
  expenses: 20,
};

const EXPENSE_CATEGORIES = [
  { value: "aluguel", label: "Aluguel" },
  { value: "manutencao", label: "Manutencao" },
  { value: "reposicao_produtos", label: "Reposicao de produtos" },
  { value: "agua_luz", label: "Agua/luz" },
  { value: "internet", label: "Internet" },
  { value: "marketing", label: "Marketing" },
  { value: "outros", label: "Outros" },
] as const;

const revenueChartConfig = {
  value: {
    label: "Faturamento",
    color: "hsl(var(--primary))",
  },
} satisfies ChartConfig;

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function getEmptyExpenseForm(dateValue: string): ExpenseFormState {
  return {
    descricao: "",
    categoria: "outros",
    valor: "",
    dataDespesa: dateValue,
    observacao: "",
  };
}

export default function Finances() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const { profissionalIdParam } = useAdminProfessionalContext(slug);
  const queryClient = useQueryClient();

  const [period, setPeriod] = useState<Period>("week");
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [rules, setRules] = useState<FinanceRules>(DEFAULT_RULES);
  const [savingRules, setSavingRules] = useState(false);
  const [showExpenseForm, setShowExpenseForm] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<number | null>(null);
  const [savingExpense, setSavingExpense] = useState(false);
  const planningSectionRef = useRef<HTMLDivElement | null>(null);
  const expensesSectionRef = useRef<HTMLDivElement | null>(null);
  const [expenseForm, setExpenseForm] = useState<ExpenseFormState>(() =>
    getEmptyExpenseForm(format(new Date(), "yyyy-MM-dd"))
  );

  const customRangeEnabled = useCustomRange;
  const forecastRangeEnabled = !customRangeEnabled && period === "next7";

  const activeRange = useMemo(() => {
    if (useCustomRange) {
      const todayYmd = format(new Date(), "yyyy-MM-dd");
      const startCandidate = customStartDate || customEndDate || todayYmd;
      const endCandidate = customEndDate || customStartDate || startCandidate;
      const orderedStart = startCandidate <= endCandidate ? startCandidate : endCandidate;
      const orderedEnd = startCandidate <= endCandidate ? endCandidate : startCandidate;
      return {
        label: "periodo personalizado",
        startDate: orderedStart,
        endDate: orderedEnd,
      };
    }

    const now = new Date();
    if (period === "month") {
      return {
        label: "mes",
        startDate: format(startOfMonth(now), "yyyy-MM-dd"),
        endDate: format(endOfMonth(now), "yyyy-MM-dd"),
      };
    }

    if (period === "next7") {
      return {
        label: "proximos 7 dias",
        startDate: format(now, "yyyy-MM-dd"),
        endDate: format(addDays(now, 6), "yyyy-MM-dd"),
      };
    }

    return {
      label: "semana",
      startDate: format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
      endDate: format(endOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }, [customEndDate, customStartDate, period, useCustomRange]);

  const financeConfigQuery = useQuery({
    queryKey: ["finances-config", slug],
    queryFn: () => apiGet<FinanceConfigResponse>(`/api/empresas/${encodeURIComponent(slug)}/financeiro/configuracao`),
  });

  useEffect(() => {
    if (financeConfigQuery.data?.config) {
      setRules(financeConfigQuery.data.config);
    }
  }, [financeConfigQuery.data?.config]);

  const summaryQuery = useQuery({
    queryKey: [
      "finances-summary",
      slug,
      profissionalIdParam,
      customRangeEnabled,
      forecastRangeEnabled,
      activeRange.startDate,
      activeRange.endDate,
      period,
    ],
    queryFn: () => {
      const params = new URLSearchParams();
      params.set("period", customRangeEnabled ? "custom" : period);
      if (customRangeEnabled || forecastRangeEnabled) {
        params.set("startDate", activeRange.startDate);
        params.set("endDate", activeRange.endDate);
      }
      if (forecastRangeEnabled) {
        params.set("revenueMode", "forecast");
      }
      if (profissionalIdParam) {
        params.set("profissionalId", String(profissionalIdParam));
      }
      const suffix = params.toString() ? `?${params.toString()}` : "";
      return apiGet<FinanceSummaryResponse>(`/api/empresas/${encodeURIComponent(slug)}/insights/resumo${suffix}`);
    },
  });

  const expensesQuery = useQuery({
    queryKey: ["finances-expenses", slug, activeRange.startDate, activeRange.endDate],
    queryFn: () =>
      apiGet<ExpensesResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/despesas?startDate=${activeRange.startDate}&endDate=${activeRange.endDate}`
      ),
  });

  const selectedMetrics = useMemo(() => {
    const resumo = summaryQuery.data?.resumo;
    if (!resumo) {
      return {
        gross: 0,
        budget: 0,
        actual: 0,
        net: 0,
        difference: 0,
      };
    }

    if (customRangeEnabled || forecastRangeEnabled) {
      return {
        gross: resumo.customRevenue || 0,
        budget: resumo.customExpensesBudget || 0,
        actual: resumo.customExpensesActual || 0,
        net: resumo.customNetRevenue || 0,
        difference: resumo.customBudgetDifference || 0,
      };
    }

    if (period === "month") {
      return {
        gross: resumo.monthRevenue || 0,
        budget: resumo.monthExpensesBudget || 0,
        actual: resumo.monthExpensesActual || 0,
        net: resumo.monthNetRevenue || 0,
        difference: resumo.monthBudgetDifference || 0,
      };
    }

    return {
      gross: resumo.weekRevenue || 0,
      budget: resumo.weekExpensesBudget || 0,
      actual: resumo.weekExpensesActual || 0,
      net: resumo.weekNetRevenue || 0,
      difference: resumo.weekBudgetDifference || 0,
    };
  }, [customRangeEnabled, forecastRangeEnabled, period, summaryQuery.data?.resumo]);

  const revenueChartData = useMemo(() => {
    const source = summaryQuery.data?.resumo?.dailyRevenue || [];
    return source.map((item) => {
      const parsedDate = new Date(`${item.date}T00:00:00`);
      return {
        date: item.date,
        label: Number.isNaN(parsedDate.getTime()) ? item.date : format(parsedDate, "dd/MM"),
        value: Number(item.value || 0),
      };
    });
  }, [summaryQuery.data?.resumo?.dailyRevenue]);

  const budgetUsagePercent = useMemo(() => {
    if (selectedMetrics.budget <= 0) return selectedMetrics.actual > 0 ? 100 : 0;
    return Math.min((selectedMetrics.actual / selectedMetrics.budget) * 100, 100);
  }, [selectedMetrics.actual, selectedMetrics.budget]);

  const budgetUsageRawPercent = useMemo(() => {
    if (selectedMetrics.budget <= 0) return selectedMetrics.actual > 0 ? 100 : 0;
    return (selectedMetrics.actual / selectedMetrics.budget) * 100;
  }, [selectedMetrics.actual, selectedMetrics.budget]);

  const budgetStatus = selectedMetrics.difference >= 0 ? "within" : "over";
  const budgetRemaining = Math.max(selectedMetrics.difference, 0);
  const budgetExceeded = Math.max(Math.abs(selectedMetrics.difference), 0);

  function scrollToSection(ref: { current: HTMLDivElement | null }) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const sheilaSummary = useMemo(() => {
    if (selectedMetrics.gross <= 0 && selectedMetrics.actual <= 0) {
      return "Ainda nao ha movimentacao suficiente neste periodo para analisar faturamento e despesas.";
    }

    const statusMessage =
      budgetStatus === "within"
        ? "As despesas estao dentro do valor planejado para o periodo."
        : `As despesas ultrapassaram em ${formatCurrency(Math.abs(selectedMetrics.difference))} o valor reservado para este periodo.`;

    return (
      `No ${activeRange.label}, o ${forecastRangeEnabled ? "faturamento previsto" : "faturamento bruto"} foi ${formatCurrency(selectedMetrics.gross)}. ` +
      `O orcamento para despesas ficou em ${formatCurrency(selectedMetrics.budget)}, ` +
      `as despesas reais somaram ${formatCurrency(selectedMetrics.actual)} e o lucro liquido ficou em ${formatCurrency(selectedMetrics.net)}. ` +
      statusMessage
    );
  }, [
    activeRange.label,
    budgetStatus,
    forecastRangeEnabled,
    selectedMetrics.actual,
    selectedMetrics.budget,
    selectedMetrics.difference,
    selectedMetrics.gross,
    selectedMetrics.net,
  ]);

  const isLoading = financeConfigQuery.isLoading || summaryQuery.isLoading || expensesQuery.isLoading;

  function updateRule(field: keyof FinanceRules, value: string) {
    const parsed = Number(value);
    setRules((prev) => ({
      ...prev,
      [field]: Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), 100) : 0,
    }));
  }

  async function saveRules() {
    const sum = Number((rules.owner + rules.cash + rules.expenses).toFixed(2));
    if (sum !== 100) {
      toast.error("A soma dos percentuais precisa ser exatamente 100%.");
      return;
    }

    try {
      setSavingRules(true);
      const response = await apiPut<FinanceConfigResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/financeiro/configuracao`,
        rules
      );
      setRules(response.config);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["finances-config", slug] }),
        queryClient.invalidateQueries({ queryKey: ["finances-summary", slug] }),
      ]);
      toast.success("Configuracao financeira salva com sucesso.");
    } catch {
      toast.error("Nao foi possivel salvar a configuracao financeira.");
    } finally {
      setSavingRules(false);
    }
  }

  function startNewExpense() {
    setEditingExpenseId(null);
    setExpenseForm(getEmptyExpenseForm(activeRange.endDate));
    setShowExpenseForm(true);
  }

  function startEditExpense(expense: ExpenseItem) {
    setEditingExpenseId(expense.Id);
    setExpenseForm({
      descricao: expense.Descricao || "",
      categoria: expense.Categoria || "outros",
      valor: String(expense.Valor || ""),
      dataDespesa: expense.DataDespesa || activeRange.endDate,
      observacao: expense.Observacao || "",
    });
    setShowExpenseForm(true);
  }

  async function submitExpense() {
    const descricao = expenseForm.descricao.trim();
    const valor = Number(expenseForm.valor.replace(",", "."));

    if (!descricao) {
      toast.error("Informe a descricao da despesa.");
      return;
    }
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Informe um valor valido para a despesa.");
      return;
    }
    if (!expenseForm.dataDespesa) {
      toast.error("Informe a data da despesa.");
      return;
    }

    try {
      setSavingExpense(true);
      const payload = {
        descricao,
        categoria: expenseForm.categoria,
        valor,
        dataDespesa: expenseForm.dataDespesa,
        observacao: expenseForm.observacao.trim() || null,
      };

      if (editingExpenseId) {
        await apiPut<ExpenseMutationResponse>(
          `/api/empresas/${encodeURIComponent(slug)}/despesas/${editingExpenseId}`,
          payload
        );
        toast.success("Despesa atualizada.");
      } else {
        await apiPost<ExpenseMutationResponse>(
          `/api/empresas/${encodeURIComponent(slug)}/despesas`,
          payload
        );
        toast.success("Despesa cadastrada.");
      }

      setShowExpenseForm(false);
      setEditingExpenseId(null);
      setExpenseForm(getEmptyExpenseForm(activeRange.endDate));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["finances-expenses", slug] }),
        queryClient.invalidateQueries({ queryKey: ["finances-summary", slug] }),
      ]);
    } catch {
      toast.error("Nao foi possivel salvar a despesa.");
    } finally {
      setSavingExpense(false);
    }
  }

  async function removeExpense(id: number) {
    if (!window.confirm("Deseja excluir esta despesa?")) return;

    try {
      await apiDelete(`/api/empresas/${encodeURIComponent(slug)}/despesas/${id}`);
      toast.success("Despesa excluida.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["finances-expenses", slug] }),
        queryClient.invalidateQueries({ queryKey: ["finances-summary", slug] }),
      ]);
    } catch {
      toast.error("Nao foi possivel excluir a despesa.");
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(sheilaSummary);
      toast.success("Resumo copiado.");
    } catch {
      toast.error("Nao foi possivel copiar o resumo neste navegador.");
    }
  }

  return (
    <div className="space-y-6 pb-6" data-cy="finances-page">
      <div className="space-y-1">
        <h1 className="font-display text-3xl font-bold text-foreground">Financas</h1>
        <p className="text-sm text-muted-foreground">
          Planeje o faturamento, acompanhe o orcamento de despesas e registre os gastos reais da empresa.
        </p>
      </div>

      <div ref={planningSectionRef} className="glass-card p-5 space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            variant={period === "week" && !customRangeEnabled ? "default" : "outline"}
            onClick={() => {
              setUseCustomRange(false);
              setPeriod("week");
            }}
          >
            Semana
          </Button>
          <Button
            variant={period === "month" && !customRangeEnabled ? "default" : "outline"}
            onClick={() => {
              setUseCustomRange(false);
              setPeriod("month");
            }}
          >
            Mes
          </Button>
          <Button
            variant={period === "next7" && !customRangeEnabled ? "default" : "outline"}
            onClick={() => {
              setUseCustomRange(false);
              setPeriod("next7");
            }}
          >
            Prox. 7 dias
          </Button>
          <Button
            variant={useCustomRange ? "default" : "outline"}
            onClick={() => setUseCustomRange((prev) => !prev)}
          >
            Personalizado
          </Button>
        </div>

        {useCustomRange ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>Data inicial</Label>
              <Input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} />
            </div>
            <div>
              <Label>Data final</Label>
              <Input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Se uma das datas ficar vazia, o sistema usa a outra como referencia para manter o periodo consistente.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Periodo atual: {format(new Date(`${activeRange.startDate}T00:00:00`), "dd/MM/yyyy", { locale: ptBR })} ate{" "}
            {format(new Date(`${activeRange.endDate}T00:00:00`), "dd/MM/yyyy", { locale: ptBR })}
          </p>
        )}
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Planejamento financeiro</h2>
          <p className="text-sm text-muted-foreground">
            Defina como o faturamento do periodo deve ser dividido e qual parte fica reservada como orcamento para despesas.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label>Retirada do dono (%)</Label>
            <Input type="number" min="0" max="100" value={rules.owner} onChange={(e) => updateRule("owner", e.target.value)} />
          </div>
          <div>
            <Label>Caixa do estabelecimento (%)</Label>
            <Input type="number" min="0" max="100" value={rules.cash} onChange={(e) => updateRule("cash", e.target.value)} />
          </div>
          <div>
            <Label>Orcamento para despesas (%)</Label>
            <Input type="number" min="0" max="100" value={rules.expenses} onChange={(e) => updateRule("expenses", e.target.value)} />
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Soma atual: {(rules.owner + rules.cash + rules.expenses).toFixed(2)}%
          </p>
          <Button onClick={saveRules} disabled={savingRules || financeConfigQuery.isLoading}>
            {savingRules ? "Salvando..." : "Salvar configuracao"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="glass-card group p-5 sm:p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 active:scale-[0.99]">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                {forecastRangeEnabled ? "Faturamento previsto" : "Faturamento bruto"}
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground">
                {isLoading ? "Carregando..." : formatCurrency(selectedMetrics.gross)}
              </p>
            </div>
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-2.5 text-emerald-400">
              <TrendingUp size={18} />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {forecastRangeEnabled
              ? "Soma prevista com base em agendamentos pendentes e confirmados."
              : "Soma dos atendimentos concluídos no período selecionado."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => scrollToSection(planningSectionRef)}
          className="glass-card group p-5 sm:p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 active:scale-[0.99]"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Orçamento para despesas</p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground">
                {isLoading ? "Carregando..." : formatCurrency(selectedMetrics.budget)}
              </p>
            </div>
            <div className="rounded-xl border border-primary/40 bg-primary/10 p-2.5 text-primary">
              <PiggyBank size={18} />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {rules.expenses.toFixed(2)}% do faturamento do período.
          </p>
        </button>
        <button
          type="button"
          onClick={() => scrollToSection(expensesSectionRef)}
          className="glass-card group p-5 sm:p-6 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 active:scale-[0.99]"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Despesas reais</p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground">
                {isLoading ? "Carregando..." : formatCurrency(selectedMetrics.actual)}
              </p>
            </div>
            <div className={`rounded-xl border p-2.5 ${budgetStatus === "within" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}>
              <Wallet size={18} />
            </div>
          </div>
          <div className="mt-3 space-y-2">
            <div className="h-2 overflow-hidden rounded-full bg-secondary/60">
              <div
                className={`h-full rounded-full transition-all ${budgetStatus === "within" ? "bg-emerald-500" : "bg-amber-500"}`}
                style={{ width: `${Math.max(0, Math.min(100, budgetUsageRawPercent))}%` }}
              />
            </div>
            <p className={`text-xs ${budgetStatus === "within" ? "text-emerald-300" : "text-amber-300"}`}>
              {budgetStatus === "within"
                ? `Dentro do orçamento • saldo de ${formatCurrency(budgetRemaining)}`
                : `Acima do orçamento • excedeu ${formatCurrency(budgetExceeded)}`}
            </p>
          </div>
        </button>
        <div className="glass-card group p-5 sm:p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 active:scale-[0.99]">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Lucro líquido</p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground">
                {isLoading ? "Carregando..." : formatCurrency(selectedMetrics.net)}
              </p>
            </div>
            <div className={`rounded-xl border p-2.5 ${selectedMetrics.net >= 0 ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>
              <Calculator size={18} />
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Cálculo: bruto - despesas reais.
          </p>
        </div>
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Faturamento por dia</h2>
          <p className="text-sm text-muted-foreground">
            Evolucao diaria dos atendimentos concluidos no periodo selecionado.
          </p>
        </div>

        {summaryQuery.isLoading ? (
          <div className="h-56 rounded-lg border border-border/60 bg-background/30 flex items-center justify-center text-sm text-muted-foreground">
            Carregando grafico...
          </div>
        ) : revenueChartData.length === 0 ? (
          <div className="h-56 rounded-lg border border-dashed border-border/70 bg-background/20 flex items-center justify-center text-sm text-muted-foreground">
            Sem faturamento concluido no periodo para exibir no grafico.
          </div>
        ) : (
          <ChartContainer config={revenueChartConfig} className="h-56 w-full">
            <LineChart data={revenueChartData} margin={{ top: 12, right: 10, left: -14, bottom: 6 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={28} />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={48}
                tickFormatter={(value) => `R$${Number(value || 0).toFixed(0)}`}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const date = payload?.[0]?.payload?.date;
                      if (!date) return "";
                      return format(new Date(`${date}T00:00:00`), "dd/MM/yyyy");
                    }}
                    formatter={(value) => [formatCurrency(Number(value || 0)), "Faturamento"]}
                  />
                }
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="var(--color-value)"
                strokeWidth={3}
                dot={{ r: 2 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ChartContainer>
        )}
      </div>

      <div className="glass-card p-5 space-y-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-foreground">Comparativo do orcamento</h2>
          <p className="text-sm text-muted-foreground">
            Compare o valor reservado para despesas com o valor que realmente saiu do caixa neste periodo.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Reservado</span>
            <span className="font-medium text-foreground">{formatCurrency(selectedMetrics.budget)}</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-secondary/50">
            <div
              className={`h-full rounded-full transition-all ${budgetStatus === "within" ? "bg-emerald-500" : "bg-amber-500"}`}
              style={{ width: `${budgetUsagePercent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Gasto real</span>
            <span className="font-medium text-foreground">{formatCurrency(selectedMetrics.actual)}</span>
          </div>
        </div>

        <div className={`rounded-lg border p-4 text-sm ${budgetStatus === "within" ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
          <p className="font-medium text-foreground">
            {budgetStatus === "within" ? "Dentro do orcamento" : "Acima do orcamento"}
          </p>
          <p className="mt-1 text-muted-foreground">
            {budgetStatus === "within"
              ? `As despesas estao dentro do valor planejado para o periodo, com margem de ${formatCurrency(selectedMetrics.difference)}.`
              : `As despesas ultrapassaram em ${formatCurrency(Math.abs(selectedMetrics.difference))} o valor reservado para este periodo.`}
          </p>
        </div>

        <div className="rounded-lg border border-border p-4 text-sm">
          {sheilaSummary}
        </div>

        <Button variant="outline" onClick={copySummary}>
          Copiar resposta da Sheila
        </Button>
      </div>

      <div ref={expensesSectionRef} className="glass-card p-5 space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-foreground">Despesas da empresa</h2>
            <p className="text-sm text-muted-foreground">
              Registre aqui as despesas reais para comparar o planejado com o que foi gasto.
            </p>
          </div>
          <Button onClick={startNewExpense}>
            {editingExpenseId ? "Nova despesa" : "Adicionar despesa"}
          </Button>
        </div>

        {showExpenseForm && (
          <div className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label>Descricao</Label>
                <Input
                  value={expenseForm.descricao}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, descricao: e.target.value }))}
                  placeholder="Ex.: Aluguel da sala"
                />
              </div>
              <div>
                <Label>Categoria</Label>
                <select
                  className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={expenseForm.categoria}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, categoria: e.target.value }))}
                >
                  {EXPENSE_CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Valor</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={expenseForm.valor}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, valor: e.target.value }))}
                  placeholder="0,00"
                />
              </div>
              <div>
                <Label>Data</Label>
                <Input
                  type="date"
                  value={expenseForm.dataDespesa}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, dataDespesa: e.target.value }))}
                />
              </div>
              <div className="sm:col-span-2">
                <Label>Observacao (opcional)</Label>
                <Textarea
                  rows={3}
                  value={expenseForm.observacao}
                  onChange={(e) => setExpenseForm((prev) => ({ ...prev, observacao: e.target.value }))}
                  placeholder="Detalhes adicionais sobre esta despesa"
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowExpenseForm(false);
                  setEditingExpenseId(null);
                  setExpenseForm(getEmptyExpenseForm(activeRange.endDate));
                }}
                disabled={savingExpense}
              >
                Cancelar
              </Button>
              <Button onClick={submitExpense} disabled={savingExpense}>
                {savingExpense ? "Salvando..." : editingExpenseId ? "Salvar alteracoes" : "Cadastrar despesa"}
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {expensesQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando despesas...</p>
          ) : (expensesQuery.data?.despesas || []).length === 0 ? (
            <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
              Nenhuma despesa lancada neste periodo.
            </div>
          ) : (
            expensesQuery.data?.despesas.map((expense) => (
              <div key={expense.Id} className="rounded-xl border border-border/70 bg-background/30 p-4 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">{expense.Descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {expense.CategoriaLabel || expense.Categoria} - {format(new Date(`${expense.DataDespesa}T00:00:00`), "dd/MM/yyyy", { locale: ptBR })}
                    </p>
                  </div>
                  <p className="text-lg font-semibold text-foreground">{formatCurrency(expense.Valor)}</p>
                </div>

                {expense.Observacao && (
                  <p className="text-sm text-muted-foreground">{expense.Observacao}</p>
                )}

                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={() => startEditExpense(expense)}>
                    Editar
                  </Button>
                  <Button variant="destructive" onClick={() => removeExpense(expense.Id)}>
                    Excluir
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
