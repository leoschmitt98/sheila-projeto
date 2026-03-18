import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, Check, X } from "lucide-react";
import { type DashboardAppointment, statusBadgeClass, statusLabel } from "./dashboard-utils";

type DashboardAppointmentItemProps = {
  appointment: DashboardAppointment;
  compactDate?: boolean;
  onConfirm: (id: number) => void;
  onCancel: (id: number) => void;
  actionLoadingId?: number | null;
};

export function DashboardAppointmentItem({
  appointment,
  compactDate = false,
  onConfirm,
  onCancel,
  actionLoadingId,
}: DashboardAppointmentItemProps) {
  const busy = actionLoadingId === appointment.id;
  const canConfirm = appointment.status === "pending";
  const canCancel = appointment.status === "pending" || appointment.status === "confirmed";

  return (
    <article className="rounded-xl border border-border/60 bg-background/30 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-foreground truncate">{appointment.nomeCliente || "Cliente sem nome"}</p>
          <p className="text-sm text-muted-foreground truncate">{appointment.servico || "Serviço não informado"}</p>
          {!compactDate && <p className="text-xs text-muted-foreground mt-1">{appointment.data}</p>}
        </div>
        <div className="text-right shrink-0 space-y-2">
          <p className="font-semibold text-foreground">{appointment.horario || "--:--"}</p>
          <Badge className={`border ${statusBadgeClass(appointment.status)}`}>{statusLabel(appointment.status)}</Badge>
        </div>
      </div>

      {(appointment.telefone || appointment.observacao) && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {appointment.telefone && (
            <p className="flex items-center gap-1.5">
              <Phone size={12} className="text-primary" />
              {appointment.telefone}
            </p>
          )}
          {appointment.observacao && <p className="line-clamp-2">{appointment.observacao}</p>}
        </div>
      )}

      {(canConfirm || canCancel) && (
        <div className="flex gap-2">
          {canConfirm && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10"
              disabled={busy}
              onClick={() => onConfirm(appointment.id)}
            >
              <Check size={14} className="mr-1" />
              Confirmar
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 border-rose-500/30 text-rose-300 hover:bg-rose-500/10"
              disabled={busy}
              onClick={() => onCancel(appointment.id)}
            >
              <X size={14} className="mr-1" />
              Cancelar
            </Button>
          )}
        </div>
      )}
    </article>
  );
}
