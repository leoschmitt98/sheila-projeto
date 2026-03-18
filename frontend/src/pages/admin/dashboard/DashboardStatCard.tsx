import { type LucideIcon } from "lucide-react";

type Variation = {
  text: string;
  tone: "positive" | "negative" | "neutral";
};

type DashboardStatCardProps = {
  label: string;
  value: number | string;
  subtitle: string;
  icon: LucideIcon;
  iconClassName: string;
  loading?: boolean;
  variation?: Variation;
};

export function DashboardStatCard({
  label,
  value,
  subtitle,
  icon: Icon,
  iconClassName,
  loading,
  variation,
}: DashboardStatCardProps) {
  return (
    <article className="glass-card p-5 border border-border/60 transition-all duration-200 hover:border-primary/40 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="font-display text-3xl font-bold text-foreground">{loading ? "—" : value}</p>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <div className={`rounded-xl border border-border/60 bg-background/40 p-3 ${iconClassName}`}>
          <Icon size={18} />
        </div>
      </div>

      {variation && (
        <p
          className={`mt-3 text-xs ${
            variation.tone === "positive"
              ? "text-emerald-300"
              : variation.tone === "negative"
                ? "text-rose-300"
                : "text-muted-foreground"
          }`}
        >
          {variation.text}
        </p>
      )}
    </article>
  );
}
