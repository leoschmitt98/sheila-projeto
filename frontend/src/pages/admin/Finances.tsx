import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";

type Period = "week" | "month";

type ApiResumoResponse = {
  ok: true;
  resumo: {
    weekRevenue: number;
    monthRevenue: number;
  };
};

type FinanceRules = {
  owner: number;
  cash: number;
  expenses: number;
};

const DEFAULT_RULES: FinanceRules = {
  owner: 50,
  cash: 30,
  expenses: 20,
};

function getFinanceRules(slug: string): FinanceRules {
  const raw = localStorage.getItem(`financeRules:${slug}`);
  if (!raw) return DEFAULT_RULES;

  try {
    const parsed = JSON.parse(raw);
    return {
      owner: Number(parsed.owner) || 0,
      cash: Number(parsed.cash) || 0,
      expenses: Number(parsed.expenses) || 0,
    };
  } catch {
    return DEFAULT_RULES;
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

export default function Finances() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => searchParams.get("empresa") || "nando", [searchParams]);

  const [period, setPeriod] = useState<Period>("week");
  const [rules, setRules] = useState<FinanceRules>(() => getFinanceRules(slug));

  useEffect(() => {
    setRules(getFinanceRules(slug));
  }, [slug]);

  const { data: resumoData, isLoading } = useQuery({
    queryKey: ["finances-resumo", slug],
    queryFn: () => apiGet<ApiResumoResponse>(`/api/empresas/${encodeURIComponent(slug)}/insights/resumo`),
  });

  const periodRange = useMemo(() => {
    const now = new Date();
    if (period === "month") {
      return { start: startOfMonth(now), end: endOfMonth(now), label: "mês" };
    }
    return {
      start: startOfWeek(now, { weekStartsOn: 1 }),
      end: endOfWeek(now, { weekStartsOn: 1 }),
      label: "semana",
    };
  }, [period]);

  const totalRevenue = period === "month" ? resumoData?.resumo.monthRevenue || 0 : resumoData?.resumo.weekRevenue || 0;

  const totals = useMemo(() => {
    const owner = (totalRevenue * rules.owner) / 100;
    const cash = (totalRevenue * rules.cash) / 100;
    const expenses = (totalRevenue * rules.expenses) / 100;

    return { owner, cash, expenses };
  }, [rules.cash, rules.expenses, rules.owner, totalRevenue]);

  const sheilaSummary = useMemo(() => {
    return (
      `No ${periodRange.label}, o faturamento foi ${formatCurrency(totalRevenue)}. ` +
      `${rules.owner}% (${formatCurrency(totals.owner)}) pode ser retirado pelo dono, ` +
      `${rules.cash}% (${formatCurrency(totals.cash)}) permanece em caixa e ` +
      `${rules.expenses}% (${formatCurrency(totals.expenses)}) é reservado para despesas.`
    );
  }, [periodRange.label, rules.cash, rules.expenses, rules.owner, totalRevenue, totals.cash, totals.expenses, totals.owner]);

  function updateRule(field: keyof FinanceRules, value: string) {
    setRules((prev) => ({ ...prev, [field]: Number(value) || 0 }));
  }

  function saveRules() {
    const sum = rules.owner + rules.cash + rules.expenses;
    if (sum !== 100) {
      toast.error("A soma das porcentagens precisa ser 100%.");
      return;
    }

    localStorage.setItem(`financeRules:${slug}`, JSON.stringify(rules));
    toast.success("Configuração financeira salva com sucesso.");
  }

  async function copySummary() {
    await navigator.clipboard.writeText(sheilaSummary);
    toast.success("Resumo copiado.");
  }

  return (
    <div className="space-y-6" data-cy="finances-page">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Finanças</h1>
        <p className="text-muted-foreground mt-1">
          Configure a divisão do faturamento que a Sheila vai usar para te responder.
        </p>
      </div>

      <div className="glass-card p-6 space-y-4">
        <div className="flex gap-2">
          <Button
            variant={period === "week" ? "default" : "outline"}
            onClick={() => setPeriod("week")}
            data-cy="period-week"
          >
            Semana
          </Button>
          <Button
            variant={period === "month" ? "default" : "outline"}
            onClick={() => setPeriod("month")}
            data-cy="period-month"
          >
            Mês
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Período: {format(periodRange.start, "dd/MM/yyyy", { locale: ptBR })} até{" "}
          {format(periodRange.end, "dd/MM/yyyy", { locale: ptBR })}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label>Retirada do dono (%)</Label>
            <Input
              type="number"
              value={rules.owner}
              onChange={(e) => updateRule("owner", e.target.value)}
              data-cy="rule-owner"
            />
          </div>

          <div>
            <Label>Caixa do estabelecimento (%)</Label>
            <Input
              type="number"
              value={rules.cash}
              onChange={(e) => updateRule("cash", e.target.value)}
              data-cy="rule-cash"
            />
          </div>

          <div>
            <Label>Despesas (%)</Label>
            <Input
              type="number"
              value={rules.expenses}
              onChange={(e) => updateRule("expenses", e.target.value)}
              data-cy="rule-expenses"
            />
          </div>
        </div>

        <Button onClick={saveRules} data-cy="save-finance-rules">Salvar configuração</Button>
      </div>

      <div className="glass-card p-6 space-y-3" data-cy="finance-results">
        <p className="text-sm text-muted-foreground">Faturamento no período</p>
        <p className="text-3xl font-bold">{isLoading ? "Carregando..." : formatCurrency(totalRevenue)}</p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
          <div className="rounded-lg bg-secondary/40 p-3">
            <p className="text-xs text-muted-foreground">Dono ({rules.owner}%)</p>
            <p className="font-semibold">{formatCurrency(totals.owner)}</p>
          </div>
          <div className="rounded-lg bg-secondary/40 p-3">
            <p className="text-xs text-muted-foreground">Caixa ({rules.cash}%)</p>
            <p className="font-semibold">{formatCurrency(totals.cash)}</p>
          </div>
          <div className="rounded-lg bg-secondary/40 p-3">
            <p className="text-xs text-muted-foreground">Despesas ({rules.expenses}%)</p>
            <p className="font-semibold">{formatCurrency(totals.expenses)}</p>
          </div>
        </div>

        <div className="rounded-lg border border-border p-3 text-sm" data-cy="sheila-finance-summary">
          {sheilaSummary}
        </div>

        <Button variant="outline" onClick={copySummary} data-cy="copy-finance-summary">
          Copiar resposta da Sheila
        </Button>
      </div>
    </div>
  );
}
