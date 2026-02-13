import { useState, useEffect, useSyncExternalStore } from 'react';
import { getApiLogs, subscribeApiLogs, clearApiLogs, ApiLogEntry } from '@/lib/apiLogger';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Copy, CopyCheck, Trash2, X, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

function useApiLogs() {
  return useSyncExternalStore(subscribeApiLogs, getApiLogs, getApiLogs);
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 px-1.5" onClick={handleCopy}>
      {copied ? <CopyCheck className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
      {label}
    </Button>
  );
}

function LogEntry({ entry, index }: { entry: ApiLogEntry; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const reqStr = JSON.stringify(entry.requestBody, null, 2);
  const resStr = JSON.stringify(entry.responseBody, null, 2);
  const fullStr = JSON.stringify({ request: entry.requestBody, response: entry.responseBody }, null, 2);

  const endpointShort = entry.endpoint.replace('https://api.metal-hero.com', '');

  return (
    <div className="border rounded bg-card text-[11px]">
      <button
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className={cn(
          'font-mono font-semibold',
          entry.responseStatus >= 200 && entry.responseStatus < 300 ? 'text-green-500' : 'text-destructive'
        )}>
          {entry.responseStatus}
        </span>
        <span className="font-mono truncate flex-1 text-muted-foreground">{endpointShort}</span>
        <span className="text-muted-foreground/60 shrink-0">{entry.durationMs}ms</span>
        <span className="text-muted-foreground/60 shrink-0">#{index + 1}</span>
      </button>

      {expanded && (
        <div className="border-t px-2 py-1.5 space-y-2">
          <div className="flex items-center gap-1">
            <CopyButton text={fullStr} label="Copy Both" />
            <CopyButton text={reqStr} label="Request" />
            <CopyButton text={resStr} label="Response" />
          </div>

          <div>
            <p className="font-semibold text-[10px] text-muted-foreground mb-0.5">REQUEST BODY</p>
            <pre className="bg-muted/50 rounded p-2 overflow-auto max-h-60 text-[10px] font-mono whitespace-pre-wrap break-all">
              {reqStr}
            </pre>
          </div>

          <div>
            <p className="font-semibold text-[10px] text-muted-foreground mb-0.5">RESPONSE BODY</p>
            <pre className="bg-muted/50 rounded p-2 overflow-auto max-h-60 text-[10px] font-mono whitespace-pre-wrap break-all">
              {resStr}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

interface DebugPanelProps {
  open: boolean;
  onClose: () => void;
}

export function DebugPanel({ open, onClose }: DebugPanelProps) {
  const logs = useApiLogs();

  if (!open) return null;

  const handleCopyAll = async () => {
    const allData = logs.map((entry, i) => ({
      index: i + 1,
      endpoint: entry.endpoint,
      timestamp: entry.timestamp,
      durationMs: entry.durationMs,
      status: entry.responseStatus,
      request: entry.requestBody,
      response: entry.responseBody,
    }));
    await navigator.clipboard.writeText(JSON.stringify(allData, null, 2));
    toast.success(`${logs.length} API log(s) copied to clipboard`);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-background border rounded-lg shadow-xl w-[720px] max-w-[90vw] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
          <h2 className="text-sm font-semibold">API Debug Log ({logs.length} requests)</h2>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleCopyAll} disabled={logs.length === 0}>
              <Copy className="h-3 w-3" /> Copy All
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={clearApiLogs} disabled={logs.length === 0}>
              <Trash2 className="h-3 w-3" /> Clear
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <ScrollArea className="flex-1 p-3">
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-8">
              No API requests recorded yet. Interact with the model to capture requests.
            </p>
          ) : (
            <div className="space-y-1.5">
              {logs.map((entry, i) => (
                <LogEntry key={entry.id} entry={entry} index={i} />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
}
