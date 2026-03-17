import { Button } from "@/components/ui/button";
import { CheckCircle, Calendar, Clock, Wrench, User, RotateCcw } from "lucide-react";
import { Service } from "@/types/database";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

interface BookingConfirmationProps {
  service: Service;
  date: string;
  time: string;
  clientName: string;
  clientPhone: string;
  onNewBooking: () => void;
}

export function BookingConfirmation({
  service,
  date,
  time,
  clientName,
  clientPhone,
  onNewBooking,
}: BookingConfirmationProps) {
  const formattedDate = format(parseISO(date), "EEEE, dd 'de' MMMM", { locale: ptBR });

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(price);
  };

  return (
    <div className="space-y-6 animate-slide-up w-full min-w-0 overflow-x-hidden">
      <div className="glass-card p-4 sm:p-6 text-center w-full min-w-0 overflow-hidden">
        <div className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-success" />
        </div>

        <h3 className="font-display text-xl font-bold text-foreground mb-2">
          Agendamento Realizado!
        </h3>
        <p className="text-muted-foreground text-sm">
          Seu horario foi reservado com sucesso. Confira os detalhes abaixo:
        </p>
      </div>

      <div className="glass-card p-4 sm:p-6 space-y-4 w-full min-w-0 overflow-hidden">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Wrench size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Servico</p>
            <p className="font-semibold text-foreground break-words">{service.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Calendar size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Data</p>
            <p className="font-semibold text-foreground capitalize break-words">{formattedDate}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <Clock size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Horario</p>
            <p className="font-semibold text-foreground">{time}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/20 flex items-center justify-center">
            <User size={20} className="text-primary" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Cliente</p>
            <p className="font-semibold text-foreground break-words">{clientName}</p>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Valor do servico:</span>
            <span className="font-display text-xl font-bold text-primary">
              {formatPrice(service.price)}
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-success/20 bg-success/10 p-4 text-sm text-foreground">
          O prestador ja foi notificado sobre seu agendamento, agora e so aguardar a confirmacao.
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Button variant="outline" className="w-full" onClick={onNewBooking}>
          <RotateCcw size={18} className="mr-2" />
          Fazer novo agendamento
        </Button>
      </div>
    </div>
  );
}
