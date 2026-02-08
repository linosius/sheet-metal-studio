import { useReducer, useCallback } from 'react';
import { Flange, Fold, FaceSketch } from '@/lib/geometry';
import { generateId } from '@/lib/sheetmetal';

export interface WorkspaceSnapshot {
  flanges: Flange[];
  folds: Fold[];
  faceSketches: FaceSketch[];
}

export interface HistoryEntry {
  id: string;
  label: string;
  type: 'initial' | 'base-face' | 'fold' | 'flange' | 'sketch' | 'remove-fold' | 'remove-flange' | 'update-flange';
  timestamp: number;
  state: WorkspaceSnapshot;
}

interface HistoryState {
  entries: HistoryEntry[];
  currentIndex: number;
}

type HistoryAction =
  | { type: 'PUSH'; label: string; entryType: HistoryEntry['type']; state: WorkspaceSnapshot }
  | { type: 'UNDO' }
  | { type: 'REDO' }
  | { type: 'GO_TO'; index: number };

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'PUSH':
      return {
        entries: [
          ...state.entries.slice(0, state.currentIndex + 1),
          {
            id: generateId(),
            label: action.label,
            type: action.entryType,
            timestamp: Date.now(),
            state: action.state,
          },
        ],
        currentIndex: state.currentIndex + 1,
      };
    case 'UNDO':
      return state.currentIndex > 0
        ? { ...state, currentIndex: state.currentIndex - 1 }
        : state;
    case 'REDO':
      return state.currentIndex < state.entries.length - 1
        ? { ...state, currentIndex: state.currentIndex + 1 }
        : state;
    case 'GO_TO':
      return action.index >= 0 && action.index < state.entries.length
        ? { ...state, currentIndex: action.index }
        : state;
    default:
      return state;
  }
}

const EMPTY_STATE: WorkspaceSnapshot = { flanges: [], folds: [], faceSketches: [] };

export function useActionHistory() {
  const [state, dispatch] = useReducer(historyReducer, {
    entries: [
      { id: 'init', label: 'New Project', type: 'initial', timestamp: Date.now(), state: EMPTY_STATE },
    ],
    currentIndex: 0,
  });

  const currentState = state.entries[state.currentIndex].state;
  const canUndo = state.currentIndex > 0;
  const canRedo = state.currentIndex < state.entries.length - 1;

  const pushAction = useCallback(
    (label: string, entryType: HistoryEntry['type'], newState: WorkspaceSnapshot) => {
      dispatch({ type: 'PUSH', label, entryType, state: newState });
    },
    [],
  );

  const undo = useCallback(() => dispatch({ type: 'UNDO' }), []);
  const redo = useCallback(() => dispatch({ type: 'REDO' }), []);
  const goTo = useCallback((index: number) => dispatch({ type: 'GO_TO', index }), []);

  return {
    currentState,
    entries: state.entries,
    currentIndex: state.currentIndex,
    canUndo,
    canRedo,
    pushAction,
    undo,
    redo,
    goTo,
  };
}
