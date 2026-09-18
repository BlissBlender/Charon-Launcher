import React from 'react';

const steps = [
  { id: 'InstallPath', label: 'Path' },
  { id: 'Options', label: 'Options' },
  { id: 'Progress', label: 'Installing' },
  { id: 'Complete', label: 'Done' }
];

export default function StepIndicator({ currentStepId }) {
  if (currentStepId === 'Welcome') return null;

  const currentIndex = steps.findIndex(s => s.id === currentStepId);

  return (
    <div className="absolute top-8 w-full flex justify-center items-center z-20 px-12">
      <div className="flex items-center w-full max-w-lg justify-between relative">
        {steps.map((step, idx) => {
          const isPast = idx < currentIndex;
          const isCurrent = idx === currentIndex;
          
          return (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center relative z-10">
                <div className={`h-4 w-4 rounded-full transition-all duration-300 ${isCurrent ? 'bg-primary glow-cyan scale-125' : isPast ? 'bg-primary opacity-60' : 'bg-border'}`}></div>
                <span className={`text-xs mt-2 absolute top-4 transition-colors duration-300 ${isCurrent ? 'text-primary font-medium' : isPast ? 'text-textMain' : 'text-gray-600'}`}>
                  {step.label}
                </span>
              </div>
              {idx < steps.length - 1 && (
                <div className={`flex-1 h-0.5 mx-4 transition-colors duration-300 ${idx < currentIndex ? 'bg-primary opacity-60' : 'bg-border'}`}></div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
