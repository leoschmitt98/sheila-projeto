import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { useWorkSchedule } from "@/hooks/useWorkSchedule";
import { ChevronLeft, Clock } from "lucide-react";
import { format, addDays, isBefore, startOfToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { apiGet } from "@/lib/api";

interface DateTimePickerProps {
  onSelect: (date: string, time: string) => void;
  onBack: () => void;
  serviceDuration: number;
  serviceId: string | number; // ✅ novo
}

type DisponibilidadeResp = {
  ok: boolean;
  data: string;
  slots: string[];
  servico?: { Id: number; Nome: string; DuracaoMin: number };
  error?: string;
};

function getEmpresaSlugFromUrl() {
  try {
    const url = new URL(window.location.href);
    return (url.searchParams.get("empresa") || "nando").trim() || "nando";
  } catch {
    return "nando";
  }
}

export function DateTimePicker({
  onSelect,
  onBack,
  serviceDuration,
  serviceId,
}: DateTimePickerProps) {
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();

  const { schedule } = useWorkSchedule();

  const [loadingSlots, setLoadingSlots] = useState(false);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [freeSlots, setFreeSlots] = useState<string[]>([]);

  const empresaSlug = useMemo(() => getEmpresaSlugFromUrl(), []);

  const selectedDateStr = useMemo(() => {
    return selectedDate ? format(selectedDate, "yyyy-MM-dd") : "";
  }, [selectedDate]);

  const isDateDisabled = (date: Date) => {
    if (isBefore(date, startOfToday())) return true;
    const daySchedule = schedule.find((s) => s.dayOfWeek === date.getDay());
    return !daySchedule?.active;
  };

  // ✅ Busca horários livres do backend quando escolher a data
  useEffect(() => {
    let alive = true;

    async function loadSlots() {
      if (!selectedDateStr) {
        setFreeSlots([]);
        setSlotsError(null);
        return;
      }

      setLoadingSlots(true);
      setSlotsError(null);

      const sid = Number(serviceId);
      if (!Number.isFinite(sid) || sid <= 0) {
        setLoadingSlots(false);
        setSlotsError("Serviço inválido.");
        setFreeSlots([]);
        return;
      }

      try {
        const resp = await apiGet<DisponibilidadeResp>(
          `/api/empresas/${empresaSlug}/agenda/disponibilidade?servicoId=${sid}&data=${selectedDateStr}`
        );

        if (!alive) return;

        // Se o backend devolver slots já filtrados, usamos direto
        // (serviceDuration ainda é útil para UI, mas a disponibilidade é do backend)
        setFreeSlots(Array.isArray(resp.slots) ? resp.slots : []);
      } catch (err: any) {
        if (!alive) return;
        setSlotsError("Não foi possível carregar os horários. Tente novamente.");
        setFreeSlots([]);
      } finally {
        if (!alive) return;
        setLoadingSlots(false);
      }
    }

    loadSlots();
    return () => {
      alive = false;
    };
  }, [empresaSlug, selectedDateStr, serviceId, serviceDuration]);

  const handleTimeSelect = (time: string) => {
    if (!selectedDate) return;
    onSelect(format(selectedDate, "yyyy-MM-dd"), time);
  };

  return (
    <div className="space-y-4 animate-slide-up w-full min-w-0 overflow-x-hidden">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={16} className="mr-1" />
        Voltar
      </Button>

      <div className="glass-card p-3 sm:p-4 w-full min-w-0 overflow-hidden">
        <h4 className="font-display font-semibold text-foreground mb-4 break-words">
          Escolha uma data
        </h4>

        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={setSelectedDate}
          disabled={isDateDisabled}
          fromDate={new Date()}
          toDate={addDays(new Date(), 30)}
          locale={ptBR}
          className="rounded-md w-full max-w-full"
        />
      </div>

      {selectedDate && (
        <div className="glass-card p-3 sm:p-4 animate-fade-in w-full min-w-0 overflow-hidden">
          <h4 className="font-display font-semibold text-foreground mb-4 flex items-center gap-2 break-words">
            <Clock size={18} className="text-primary" />
            Horários disponíveis para{" "}
            {format(selectedDate, "dd 'de' MMMM", { locale: ptBR })}
          </h4>

          {loadingSlots ? (
            <p className="text-muted-foreground text-sm">Carregando horários…</p>
          ) : slotsError ? (
            <p className="text-destructive text-sm">{slotsError}</p>
          ) : freeSlots.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
              {freeSlots.map((time) => (
                <Button
                  key={time}
                  variant="outline"
                  size="sm"
                  onClick={() => handleTimeSelect(time)}
                  className="bg-secondary/50 border-border/50 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all min-w-0"
                >
                  {time}
                </Button>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              Não há horários disponíveis nesta data. Por favor, escolha outra data.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
