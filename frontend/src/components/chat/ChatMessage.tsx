import { SheilaAvatar } from './SheilaAvatar';
import { User } from 'lucide-react';

interface ChatMessageProps {
  role: 'assistant' | 'user';
  content: string;
}

export function ChatMessage({ role, content }: ChatMessageProps) {
  const isAssistant = role === 'assistant';

  return (
    <div
      className={`flex w-full min-w-0 items-end gap-2 md:gap-3 animate-slide-up ${
        isAssistant ? 'justify-start' : 'justify-end'
      }`}
    >
      {isAssistant && <SheilaAvatar size="small" />}

      <div
        className={`min-w-0 w-fit max-w-[72%] sm:max-w-[82%] ${
          isAssistant ? 'chat-bubble-assistant' : 'chat-bubble-user'
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{content}</p>
      </div>

      {!isAssistant && (
        <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
          <User size={16} className="text-muted-foreground" />
        </div>
      )}
    </div>
  );
}
