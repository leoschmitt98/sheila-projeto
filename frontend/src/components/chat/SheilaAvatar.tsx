import { Bot } from 'lucide-react';

export function SheilaAvatar({ size = 'default' }: { size?: 'small' | 'default' | 'large' }) {
  const sizeClasses = {
    small: 'w-8 h-8',
    default: 'w-12 h-12',
    large: 'w-20 h-20',
  };

  const iconSizes = {
    small: 16,
    default: 24,
    large: 40,
  };

  return (
    <div className={`${sizeClasses[size]} rounded-full bg-gradient-to-br from-primary to-orange-400 flex items-center justify-center animate-pulse-glow`}>
      <Bot size={iconSizes[size]} className="text-primary-foreground" />
    </div>
  );
}
