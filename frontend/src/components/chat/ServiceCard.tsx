import { Service } from '@/types/database';
import { Clock, DollarSign } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ServiceCardProps {
  service: Service;
  onSelect: (service: Service) => void;
}

export function ServiceCard({ service, onSelect }: ServiceCardProps) {
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(price);
  };

  return (
    <div className="glass-card p-4 hover:border-primary/50 transition-all duration-300 group w-full min-w-0 overflow-hidden">
      <h4 className="font-display font-semibold text-foreground group-hover:text-primary transition-colors break-words">
        {service.name}
      </h4>
      <p className="text-sm text-muted-foreground mt-1 break-words">{service.description}</p>
      
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-start sm:items-center">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 min-w-0">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock size={14} />
            <span>{service.duration} min</span>
          </div>
          <div className="flex items-center gap-1 text-sm font-semibold text-primary">
            <DollarSign size={14} />
            <span>{formatPrice(service.price)}</span>
          </div>
        </div>
        
        <Button
          size="sm"
          onClick={() => onSelect(service)}
          className="btn-glow w-full sm:w-auto shrink-0"
          data-cy={`service-card-select-${service.id}`}
        >
          Agendar
        </Button>
      </div>
    </div>
  );
}
