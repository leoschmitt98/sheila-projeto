import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import { useWorkSchedule } from "@/hooks/useWorkSchedule";
import { apiPost } from "@/lib/api";

import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

import { Clock, AlertTriangle } from "lucide-react";

type CancelDiaItem = {
  AgendamentoId: number;
  Servico: string;
  DataAgendada: string;
  HoraAgendada: string;
  ClienteNome: string;
  ClienteWhatsapp: string;
};

type CancelDiaResponse = {
  ok: true;
  cancelled: number;
  reason?: string;
  agendamentos: CancelDiaItem[];
};

function formatHHMM(horaIso: string) {
  return horaIso?.slice(11, 16) || "";
}

function buildWhatsAppUrl(phone: string, message: string) {
  const clean = String(phone || "").replace(/\D/g, "");
  return `https://wa.me/55${clean}?text=${encodeURIComponent(message)}`;
}

function CancelDayCard() {
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => searchParams.get("empresa") || "nando", [searchParams]);

  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<CancelDiaResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCancel() {
    if (!date) {
      alert("Selecione uma data.");
      return;
    }

    const ok = window.confirm(
      "Isso irá CANCELAR TODOS os agendamentos desse dia (pendentes/confirmados). Deseja continuar?"
    );
    if (!ok) return;

    try {
      setLoading(true);
      setResult(null);

      const r = await apiPost<CancelDiaResponse>(
        `/api/empresas/${slug}/agendamentos/cancelar-dia`,
        { date, reason }
      );

      setResult(r);
    } catch (e: any) {
      alert(e?.message || "Erro ao cancelar os atendimentos.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="glass-card p-6 border border-destructive/30">
      <h2 className="font-display text-lg font-semibold text-destructive flex items-center gap-2">
        <AlertTriangle size={18} />
        Cancelar atendimentos do dia
      </h2>

      <p className="text-sm text-muted-foreground mt-2">
        Use em casos de imprevisto (ex: doença). Os clientes serão listados para você avisar e reagendar.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-secondary border-border"
        />

        <Input
          type="text"
          placeholder="Motivo (opcional)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="bg-secondary border-border"
        />

        <Button variant="destructive" onClick={handleCancel} disabled={loading}>
          {loading ? "Cancelando..." : "Cancelar dia"}
        </Button>
      </div>

      {result && (
        <div className="mt-6">
          <p className="font-medium text-foreground">
            {result.cancelled === 0
              ? "Nenhum agendamento para cancelar nesse dia."
              : `Agendamentos cancelados: ${result.cancelled}`}
          </p>

          {result.agendamentos?.length > 0 && (
            <div className="mt-4 space-y-3">
              {result.agendamentos.map((apt) => {
                const msg = `Olá, ${apt.ClienteNome}! Precisei cancelar os atendimentos do dia ${format(
                  parseISO(apt.DataAgendada),
                  "dd/MM/yyyy",
                  { locale: ptBR }
                )}. Podemos reagendar? 😊`;

                return (
                  <div
                    key={apt.AgendamentoId}
                    className="flex items-center justify-between bg-secondary/40 p-3 rounded-md"
                  >
                    <div>
                      <p className="font-medium text-foreground">{apt.ClienteNome}</p>
                      <p className="text-sm text-muted-foreground">
                        {apt.Servico} • {formatHHMM(apt.HoraAgendada)}
                      </p>
                    </div>

                    <Button
                      variant="outline"
                      onClick={() => window.open(buildWhatsAppUrl(apt.ClienteWhatsapp, msg), "_blank")}
                    >
                      WhatsApp
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function Schedule() {
  const { schedule, updateDaySchedule, getDayName } = useWorkSchedule();

  const handleTimeChange = (dayOfWeek: number, field: "startTime" | "endTime", value: string) => {
    updateDaySchedule(dayOfWeek, { [field]: value });
  };

  const handleActiveChange = (dayOfWeek: number, active: boolean) => {
    updateDaySchedule(dayOfWeek, { active });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Horários de Funcionamento</h1>
        <p className="text-muted-foreground mt-1">Configure os dias e horários de atendimento</p>
      </div>

      <div className="glass-card p-6">
        <div className="space-y-4">
          {schedule
            .sort(
              (a, b) =>
                (a.dayOfWeek === 0 ? 7 : a.dayOfWeek) - (b.dayOfWeek === 0 ? 7 : b.dayOfWeek)
            )
            .map((day) => (
              <div
                key={day.id}
                className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                  day.active ? "bg-secondary/50 border-border" : "bg-secondary/20 border-border/50 opacity-60"
                }`}
              >
                <div className="flex items-center gap-4">
                  <Switch checked={day.active} onCheckedChange={(checked) => handleActiveChange(day.dayOfWeek, checked)} />
                  <span className="font-medium text-foreground w-24">{getDayName(day.dayOfWeek)}</span>
                </div>

                {day.active ? (
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground">Das</Label>
                      <Input
                        type="time"
                        value={day.startTime}
                        onChange={(e) => handleTimeChange(day.dayOfWeek, "startTime", e.target.value)}
                        className="w-32 bg-secondary border-border"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-sm text-muted-foreground">às</Label>
                      <Input
                        type="time"
                        value={day.endTime}
                        onChange={(e) => handleTimeChange(day.dayOfWeek, "endTime", e.target.value)}
                        className="w-32 bg-secondary border-border"
                      />
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground text-sm flex items-center gap-2">
                    <Clock size={14} />
                    Fechado
                  </span>
                )}
              </div>
            ))}
        </div>
      </div>

      {/* ✅ Cancelar dia (agora no lugar certo) */}
      <CancelDayCard />

      <div className="glass-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground mb-4">Informações</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>• Os horários configurados serão exibidos para os clientes na hora de agendar</li>
          <li>• Dias desativados não aparecerão como opção no calendário</li>
          <li>• O sistema divide automaticamente o período em slots de 30 minutos</li>
          <li>• Horários já agendados não ficam disponíveis para novos clientes</li>
        </ul>
      </div>
    </div>
  );
}
