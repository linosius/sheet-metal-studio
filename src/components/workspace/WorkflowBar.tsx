import { cn } from '@/lib/utils';

export type WorkflowStep = 'sketch' | 'base-face' | 'flanges' | 'unfold' | 'export';

interface WorkflowBarProps {
  currentStep: WorkflowStep;
  onStepClick: (step: WorkflowStep) => void;
}

const steps: { id: WorkflowStep; label: string; number: number }[] = [
  { id: 'sketch', label: 'Sketch', number: 1 },
  { id: 'base-face', label: 'Base Face', number: 2 },
  { id: 'flanges', label: 'Flanges', number: 3 },
  { id: 'unfold', label: 'Unfold', number: 4 },
  { id: 'export', label: 'Export', number: 5 },
];

export function WorkflowBar({ currentStep, onStepClick }: WorkflowBarProps) {
  const currentIndex = steps.findIndex(s => s.id === currentStep);

  return (
    <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1">
      {steps.map((step, i) => {
        const isActive = step.id === currentStep;
        const isComplete = i < currentIndex;

        return (
          <button
            key={step.id}
            onClick={() => onStepClick(step.id)}
            className={cn(
              'workflow-step',
              isActive && 'workflow-step-active',
              isComplete && 'workflow-step-complete',
              !isActive && !isComplete && 'workflow-step-inactive',
            )}
          >
            <span className={cn(
              'w-5 h-5 rounded-full text-xs flex items-center justify-center font-mono font-bold',
              isActive && 'bg-primary-foreground/20',
              isComplete && 'bg-accent/30',
              !isActive && !isComplete && 'bg-foreground/10',
            )}>
              {isComplete ? '✓' : step.number}
            </span>
            <span className="hidden sm:inline">{step.label}</span>
          </button>
        );
      })}
    </div>
  );
}
