'use client';

import { Check, Loader2, X } from 'lucide-react';

export type WorkflowStepStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'error';

export type WorkflowProgressStep = {
  id: string;
  label: string;
  status: WorkflowStepStatus;
};

type Props = {
  steps: WorkflowProgressStep[];
  onSelect?: (stepId: string) => void;
};

const statusLabel = (status: WorkflowStepStatus) => {
  switch (status) {
    case 'completed':
      return 'Done';
    case 'in_progress':
      return 'Running';
    case 'error':
      return 'Failed';
    default:
      return 'Waiting';
  }
};

/**
 * Horizontal FDC pipeline rail — one glance at prepare → verify progress.
 */
export function WorkflowProgress({ steps, onSelect }: Props) {
  const completedCount = steps.filter(s => s.status === 'completed').length;
  const hasError = steps.some(s => s.status === 'error');
  const allDone = completedCount === steps.length && steps.length > 0;
  const progress =
    steps.length === 0 ? 0 : Math.round((completedCount / steps.length) * 100);

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <div>
          <p className='text-sm font-medium text-gray-900'>Pipeline</p>
          <p className='text-xs text-gray-500'>
            {allDone
              ? 'All five stages complete'
              : hasError
                ? 'Pipeline stopped — expand the failed step'
                : completedCount === 0
                  ? 'Start from Configure to run the live flow'
                  : `Stage ${Math.min(completedCount + 1, steps.length)} of ${steps.length}`}
          </p>
        </div>
        <span
          className={`text-xs font-medium tabular-nums ${
            allDone
              ? 'text-green-700'
              : hasError
                ? 'text-red-600'
                : 'text-[#E62058]'
          }`}
        >
          {progress}%
        </span>
      </div>

      <div
        className='h-1.5 w-full overflow-hidden rounded-full bg-gray-100'
        role='progressbar'
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            hasError && !allDone ? 'bg-red-500' : allDone ? 'bg-green-500' : ''
          }`}
          style={{
            width: `${progress}%`,
            backgroundColor:
              hasError && !allDone
                ? undefined
                : allDone
                  ? undefined
                  : '#E62058',
          }}
        />
      </div>

      <ol className='grid grid-cols-5 gap-1 sm:gap-2'>
        {steps.map((step, index) => {
          const isActive = step.status === 'in_progress';
          const isDone = step.status === 'completed';
          const isError = step.status === 'error';

          return (
            <li key={step.id} className='min-w-0'>
              <button
                type='button'
                onClick={() => onSelect?.(step.id)}
                className={`group flex w-full flex-col items-center gap-2 rounded-lg px-1 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E62058]/40 ${
                  isActive ? 'bg-[#fef7f0]' : 'hover:bg-gray-50'
                }`}
                aria-current={isActive ? 'step' : undefined}
                aria-label={`${step.label}, ${statusLabel(step.status)}`}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold transition-colors ${
                    isDone
                      ? 'bg-green-500 text-white'
                      : isError
                        ? 'bg-red-500 text-white'
                        : isActive
                          ? 'bg-[#E62058] text-white'
                          : 'border border-gray-200 bg-white text-gray-400'
                  }`}
                >
                  {isDone ? (
                    <Check className='h-4 w-4' strokeWidth={2.5} />
                  ) : isError ? (
                    <X className='h-4 w-4' strokeWidth={2.5} />
                  ) : isActive ? (
                    <Loader2 className='h-4 w-4 animate-spin' />
                  ) : (
                    index + 1
                  )}
                </span>
                <span
                  className={`w-full truncate text-[11px] font-medium sm:text-xs ${
                    isActive || isDone
                      ? 'text-gray-900'
                      : isError
                        ? 'text-red-700'
                        : 'text-gray-400'
                  }`}
                >
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
