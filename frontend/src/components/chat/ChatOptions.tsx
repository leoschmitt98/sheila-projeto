import { Button } from '@/components/ui/button';
import { LucideIcon } from 'lucide-react';

export interface ChatOption {
  id: string;
  label: string;
  icon?: LucideIcon;
  description?: string;
}

interface ChatOptionsProps {
  options: ChatOption[];
  onSelect: (option: ChatOption) => void;
}

export function ChatOptions({ options, onSelect }: ChatOptionsProps) {
  return (
    <div className="flex flex-wrap w-full min-w-0 gap-2 animate-slide-up">
      {options.map((option) => (
        <Button
          key={option.id}
          variant="outline"
          className="max-w-full min-w-0 flex items-center gap-2 bg-secondary/50 border-border/50 hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all duration-300 btn-glow"
          onClick={() => onSelect(option)}
          data-cy={`chat-option-${option.id}`}
        >
          {option.icon && <option.icon size={16} />}
          <span className="break-words text-left">{option.label}</span>
        </Button>
      ))}
    </div>
  );
}
