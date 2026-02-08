import { cn } from '@/lib/utils';
import { HistoryEntry } from '@/hooks/useActionHistory';
import { Scissors, ArrowUpFromLine, PenLine, Box, Trash2, RotateCcw } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  'initial': Box,
  'base-face': Box,
  'fold': Scissors,
  'flange': ArrowUpFromLine,
  'sketch': PenLine,
  'remove-fold': Trash2,
  'remove-flange': Trash2,
  'update-flange': RotateCcw,
};

interface ActionTreeProps {
  entries: HistoryEntry[];
  currentIndex: number;
  onGoTo: (index: number) => void;
}

export function ActionTree({ entries, currentIndex, onGoTo }: ActionTreeProps) {
  return (
    <ScrollArea className="max-h-48">
      <div className="space-y-0.5">
        {entries.map((entry, i) => {
          const Icon = iconMap[entry.type] || Box;
          const isCurrent = i === currentIndex;
          const isFuture = i > currentIndex;

          return (
            <button
              key={entry.id}
              onClick={() => onGoTo(i)}
              className={cn(
                'w-full flex items-center gap-2 px-2 py-1 rounded text-[11px] transition-colors text-left',
                isCurrent && 'bg-primary/15 text-primary font-semibold',
                !isCurrent && !isFuture && 'text-foreground/70 hover:bg-muted/50',
                isFuture && 'text-muted-foreground/40 hover:bg-muted/30 line-through',
              )}
            >
              <div className={cn(
                'w-4 h-4 rounded-full flex items-center justify-center shrink-0',
                isCurrent && 'bg-primary/20',
                !isCurrent && !isFuture && 'bg-muted',
                isFuture && 'bg-muted/50',
              )}>
                <Icon className="h-2.5 w-2.5" />
              </div>
              <span className="truncate flex-1">{entry.label}</span>
              {isCurrent && (
                <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}
