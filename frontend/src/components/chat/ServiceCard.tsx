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
    <div className="glass-card p-4 hover:border-primary/50 transition-all duration-300 group">
      <h4 className="font-display font-semibold text-foreground group-hover:text-primary transition-colors">
        {service.name}
      </h4>
      <p className="text-sm text-muted-foreground mt-1">{service.description}</p>
      
      <div className="flex items-center justify-between mt-4">
        <div className="flex items-center gap-4">
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
          className="btn-glow"
        >
          Agendar
        </Button>
      </div>
    </div>
  );
}
