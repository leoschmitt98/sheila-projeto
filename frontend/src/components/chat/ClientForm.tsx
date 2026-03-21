import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChevronLeft, User, Phone, MessageSquare } from 'lucide-react';

interface ClientFormProps {
  onSubmit: (name: string, phone: string, notes: string) => void;
  onBack: () => void;
  isSubmitting?: boolean;
}

export function ClientForm({ onSubmit, onBack, isSubmitting = false }: ClientFormProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 11) {
      return numbers.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    }
    return value;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPhone(formatPhone(e.target.value));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim() && phone.trim()) {
      onSubmit(name.trim(), phone.replace(/\D/g, ''), notes.trim());
    }
  };

  const isValid = name.trim().length >= 2 && phone.replace(/\D/g, '').length >= 10;

  return (
    <div className="space-y-4 animate-slide-up">
      <Button 
        variant="ghost" 
        size="sm" 
        onClick={onBack}
        className="text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft size={16} className="mr-1" />
        Voltar
      </Button>

      <form onSubmit={handleSubmit} className="glass-card p-6 space-y-4">
        <h4 className="font-display font-semibold text-foreground mb-4">
          Seus dados para o agendamento
        </h4>

        <div className="space-y-2">
          <Label htmlFor="name" className="flex items-center gap-2">
            <User size={14} className="text-primary" />
            Nome completo
          </Label>
          <Input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Digite seu nome"
            className="bg-secondary/50 border-border/50"
            data-cy="booking-client-name"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone" className="flex items-center gap-2">
            <Phone size={14} className="text-primary" />
            WhatsApp
          </Label>
          <Input
            id="phone"
            value={phone}
            onChange={handlePhoneChange}
            placeholder="(11) 99999-9999"
            className="bg-secondary/50 border-border/50"
            data-cy="booking-client-phone"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="notes" className="flex items-center gap-2">
            <MessageSquare size={14} className="text-primary" />
            Observações (opcional)
          </Label>
          <Textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Alguma informação adicional sobre o serviço..."
            className="bg-secondary/50 border-border/50 resize-none"
            rows={3}
            data-cy="booking-client-notes"
          />
        </div>

        <Button 
          type="submit" 
          className="w-full btn-glow"
          disabled={!isValid || isSubmitting}
          data-cy="booking-client-submit"
        >
          {isSubmitting ? "Enviando..." : "Confirmar Agendamento"}
        </Button>
      </form>
    </div>
  );
}
