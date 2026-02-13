/**
 * API Logger — captures all request/response pairs for debugging.
 */

export interface ApiLogEntry {
  id: string;
  timestamp: string;
  endpoint: string;
  method: string;
  requestBody: any;
  responseStatus: number;
  responseBody: any;
  durationMs: number;
}

let logs: ApiLogEntry[] = [];
let listeners: (() => void)[] = [];

let counter = 0;

export function addApiLog(entry: Omit<ApiLogEntry, 'id'>) {
  logs = [...logs, { ...entry, id: `api_${++counter}` }];
  listeners.forEach(fn => fn());
}

export function getApiLogs(): ApiLogEntry[] {
  return logs;
}

export function clearApiLogs() {
  logs = [];
  listeners.forEach(fn => fn());
}

export function subscribeApiLogs(fn: () => void) {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}
