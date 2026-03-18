import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import { apiGet, apiPost, apiPut } from "@/lib/api";
import { resolveEmpresaSlug } from "@/lib/getEmpresaSlug";
import { useAdminProfessionalContext } from "@/hooks/useAdminProfessionalContext";

import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

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

type ProfissionalHorario = {
  DiaSemana: number;
  Ativo: boolean;
  HoraInicio: string;
  HoraFim: string;
  IntervaloAtivo?: boolean;
  IntervaloInicio?: string | null;
  IntervaloFim?: string | null;
};

function formatHHMM(horaIso: string) {
  return horaIso?.slice(11, 16) || "";
}

function buildWhatsAppUrl(phone: string, message: string) {
  const clean = String(phone || "").replace(/\D/g, "");
  return `https://wa.me/55${clean}?text=${encodeURIComponent(message)}`;
}

function timeToMinutes(value: string) {
  const [h, m] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function dayName(day: number) {
  return ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][day] || `Dia ${day}`;
}

function normalizeScheduleRows(items: ProfissionalHorario[]) {
  const byDay = new Map((items || []).map((row) => [Number(row.DiaSemana), row]));
  return Array.from({ length: 7 }).map((_, day) => {
    const cur = byDay.get(day);
    const intervaloAtivo = Boolean(cur?.IntervaloAtivo);
    return {
      DiaSemana: day,
      Ativo: cur ? Boolean(cur.Ativo) : day !== 0,
      HoraInicio: cur?.HoraInicio ? String(cur.HoraInicio).slice(0, 5) : "09:00",
      HoraFim: cur?.HoraFim ? String(cur.HoraFim).slice(0, 5) : "18:00",
      IntervaloAtivo: intervaloAtivo,
      IntervaloInicio: intervaloAtivo && cur?.IntervaloInicio ? String(cur.IntervaloInicio).slice(0, 5) : "12:00",
      IntervaloFim: intervaloAtivo && cur?.IntervaloFim ? String(cur.IntervaloFim).slice(0, 5) : "13:00",
    } as ProfissionalHorario;
  });
}

function CancelDayCard({ slug }: { slug: string }) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<CancelDiaResponse | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleCancel() {
    if (!date) {
      alert("Selecione uma data.");
      return;
    }

    const ok = window.confirm("Isso vai cancelar todos os agendamentos pendentes/confirmados do dia. Deseja continuar?");
    if (!ok) return;

    try {
      setLoading(true);
      setResult(null);
      const response = await apiPost<CancelDiaResponse>(
        `/api/empresas/${encodeURIComponent(slug)}/agendamentos/cancelar-dia`,
        { date, reason }
      );
      setResult(response);
    } catch (err: any) {
      alert(err?.message || "Erro ao cancelar os atendimentos do dia.");
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
        Use apenas em imprevistos. O sistema cancela os horários ativos e mostra a lista para contato com os clientes.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="bg-secondary border-border" />
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
            {result.cancelled === 0 ? "Nenhum agendamento para cancelar nessa data." : `Agendamentos cancelados: ${result.cancelled}`}
          </p>

          {result.agendamentos?.length > 0 && (
            <div className="mt-4 space-y-3">
              {result.agendamentos.map((apt) => {
                const msg = `Olá, ${apt.ClienteNome}! Precisei cancelar os atendimentos do dia ${format(parseISO(apt.DataAgendada), "dd/MM/yyyy", { locale: ptBR })}. Podemos reagendar?`;
                return (
                  <div key={apt.AgendamentoId} className="flex items-center justify-between bg-secondary/40 p-3 rounded-md">
                    <div>
                      <p className="font-medium text-foreground">{apt.ClienteNome}</p>
                      <p className="text-sm text-muted-foreground">
                        {apt.Servico} • {formatHHMM(apt.HoraAgendada)}
                      </p>
                    </div>
                    <Button variant="outline" onClick={() => window.open(buildWhatsAppUrl(apt.ClienteWhatsapp, msg), "_blank")}>
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
  const [searchParams] = useSearchParams();
  const slug = useMemo(() => resolveEmpresaSlug({ search: `?${searchParams.toString()}` }), [searchParams]);
  const { activeProfessionals } = useAdminProfessionalContext(slug);

  const [selectedProfessionalId, setSelectedProfessionalId] = useState<string>("");
  const [scheduleRows, setScheduleRows] = useState<ProfissionalHorario[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectableProfessionals = useMemo(() => {
    if (activeProfessionals.length === 0) {
      return [{ Id: 0, Nome: "Dono (sem equipe)" }];
    }
    return activeProfessionals.map((p) => ({ Id: p.Id, Nome: p.Nome }));
  }, [activeProfessionals]);

  const selectedProfessional = selectableProfessionals.find((p) => String(p.Id) === String(selectedProfessionalId)) || null;

  useEffect(() => {
    if (!selectedProfessionalId && selectableProfessionals.length > 0) {
      setSelectedProfessionalId(String(selectableProfessionals[0].Id));
    }
  }, [selectedProfessionalId, selectableProfessionals]);

  const loadSchedule = async (professionalId: number) => {
    try {
      setLoading(true);
      const response = await apiGet<{ ok: boolean; horarios: ProfissionalHorario[] }>(
        `/api/empresas/${encodeURIComponent(slug)}/profissionais/${professionalId}/horarios`
      );
      setScheduleRows(normalizeScheduleRows(Array.isArray(response.horarios) ? response.horarios : []));
    } catch {
      setScheduleRows(normalizeScheduleRows([]));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const id = Number(selectedProfessionalId);
    if (!Number.isFinite(id) || id < 0) return;
    loadSchedule(id);
  }, [selectedProfessionalId, slug]);

  const updateRow = (day: number, patch: Partial<ProfissionalHorario>) => {
    setScheduleRows((prev) =>
      prev.map((row) => {
        if (row.DiaSemana !== day) return row;
        const next = { ...row, ...patch };
        if (patch.IntervaloAtivo === false) {
          next.IntervaloInicio = "12:00";
          next.IntervaloFim = "13:00";
        }
        return next;
      })
    );
  };

  const validateRows = (rows: ProfissionalHorario[]) => {
    for (const row of rows) {
      const startMin = timeToMinutes(row.HoraInicio || "");
      const endMin = timeToMinutes(row.HoraFim || "");
      if (startMin === null || endMin === null || startMin >= endMin) {
        return `Expediente inválido em ${dayName(row.DiaSemana)}.`;
      }

      if (row.IntervaloAtivo) {
        const breakStart = timeToMinutes(row.IntervaloInicio || "");
        const breakEnd = timeToMinutes(row.IntervaloFim || "");
        if (breakStart === null || breakEnd === null || breakStart >= breakEnd) {
          return `Intervalo inválido em ${dayName(row.DiaSemana)}.`;
        }
        if (breakStart < startMin || breakEnd > endMin) {
          return `Intervalo fora do expediente em ${dayName(row.DiaSemana)}.`;
        }
      }
    }
    return null;
  };

  const handleSave = async () => {
    const id = Number(selectedProfessionalId);
    if (!Number.isFinite(id) || id < 0) {
      alert("Selecione um profissional para salvar os horários.");
      return;
    }

    const error = validateRows(scheduleRows);
    if (error) {
      alert(error);
      return;
    }

    try {
      setSaving(true);
      await apiPut(`/api/empresas/${encodeURIComponent(slug)}/profissionais/${id}/horarios`, {
        horarios: scheduleRows,
      });
      await loadSchedule(id);
      alert("Horários salvos com sucesso.");
    } catch (err: any) {
      alert(err?.message || "Não foi possível salvar os horários.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">Horários de Funcionamento</h1>
        <p className="text-muted-foreground mt-1">Defina expediente e intervalo por dia para cada profissional.</p>
      </div>

      <div className="glass-card p-6 space-y-4">
        {activeProfessionals.length === 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
            Sem funcionários ativos. O sistema está em modo profissional único (dono), mantendo o fluxo antigo.
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>Profissional</Label>
            <select
              className="w-full rounded-md border border-border bg-background px-3 py-2"
              value={selectedProfessionalId}
              onChange={(e) => setSelectedProfessionalId(e.target.value)}
            >
              {selectableProfessionals.map((p) => (
                <option key={p.Id} value={String(p.Id)}>
                  {p.Nome}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label>Resumo rápido</Label>
            <div className="rounded-md border border-border/60 p-2 text-sm text-muted-foreground">
              {selectedProfessional ? `Configuração de horários de ${selectedProfessional.Nome}.` : "Selecione um profissional."}
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-28 rounded-lg border border-border/60 bg-background/30 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {scheduleRows
              .sort((a, b) => (a.DiaSemana === 0 ? 7 : a.DiaSemana) - (b.DiaSemana === 0 ? 7 : b.DiaSemana))
              .map((day) => (
                <article
                  key={day.DiaSemana}
                  className={`rounded-lg border p-4 space-y-3 transition-all ${
                    day.Ativo ? "border-border bg-secondary/30" : "border-border/50 bg-secondary/10 opacity-80"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <Switch checked={day.Ativo} onCheckedChange={(checked) => updateRow(day.DiaSemana, { Ativo: checked })} />
                      <div>
                        <p className="font-medium text-foreground">{dayName(day.DiaSemana)}</p>
                        <p className="text-xs text-muted-foreground">
                          {day.Ativo
                            ? `${day.HoraInicio} às ${day.HoraFim} • ${
                                day.IntervaloAtivo ? `intervalo ${day.IntervaloInicio} às ${day.IntervaloFim}` : "sem intervalo"
                              }`
                            : "Fechado"}
                        </p>
                      </div>
                    </div>
                    {!day.Ativo && (
                      <span className="text-muted-foreground text-sm flex items-center gap-2">
                        <Clock size={14} />
                        Fechado
                      </span>
                    )}
                  </div>

                  {day.Ativo && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Início do expediente</p>
                          <Input type="time" value={day.HoraInicio} onChange={(e) => updateRow(day.DiaSemana, { HoraInicio: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Fim do expediente</p>
                          <Input type="time" value={day.HoraFim} onChange={(e) => updateRow(day.DiaSemana, { HoraFim: e.target.value })} />
                        </div>
                      </div>

                      <div className="rounded-md border border-border/60 bg-background/30 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">Intervalo</p>
                          <label className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={Boolean(day.IntervaloAtivo)}
                              onCheckedChange={(v) => updateRow(day.DiaSemana, { IntervaloAtivo: v === true })}
                            />
                            Ativado
                          </label>
                        </div>

                        {day.IntervaloAtivo ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Início do intervalo</p>
                              <Input
                                type="time"
                                value={day.IntervaloInicio || "12:00"}
                                onChange={(e) => updateRow(day.DiaSemana, { IntervaloInicio: e.target.value })}
                              />
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Fim do intervalo</p>
                              <Input
                                type="time"
                                value={day.IntervaloFim || "13:00"}
                                onChange={(e) => updateRow(day.DiaSemana, { IntervaloFim: e.target.value })}
                              />
                            </div>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">Sem intervalo</p>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              ))}
          </div>
        )}

        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={saving || loading || !selectedProfessionalId}>
            {saving ? "Salvando horários..." : "Salvar horários"}
          </Button>
        </div>
      </div>

      <CancelDayCard slug={slug} />

      <div className="glass-card p-6">
        <h2 className="font-display text-lg font-semibold text-foreground mb-4">Informações</h2>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li>• Dias desativados ficam fechados para novos agendamentos.</li>
          <li>• O intervalo bloqueia horários dentro da pausa e também horários que cruzem essa pausa.</li>
          <li>• O sistema mantém os bloqueios por horários já ocupados normalmente.</li>
          <li>• A validação garante intervalo dentro do expediente e horários consistentes.</li>
        </ul>
      </div>
    </div>
  );
}
