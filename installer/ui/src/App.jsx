import React, { useState, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import Welcome from './pages/Welcome';
import InstallPath from './pages/InstallPath';
import Options from './pages/Options';
import Progress from './pages/Progress';
import Complete from './pages/Complete';
import StepIndicator from './components/StepIndicator';
import { sendCommand, onEvent, offEvent } from './bridge';

export default function App() {
  const [currentStep, setCurrentStep] = useState('Welcome');
  const [installPath, setInstallPath] = useState('');
  const [existingInstall, setExistingInstall] = useState(null);
  const [options, setOptions] = useState({
    desktopShortcut: true,
    startMenuShortcut: true,
    launchAfter: true
  });

  useEffect(() => {
    const handleSystemInfo = (data) => {
      if (data?.defaultPath && !installPath) {
        setInstallPath(data.defaultPath);
      }
      if (data?.existingInstall) {
        setExistingInstall(data.existingInstall);
      }
    };
    onEvent('systemInfo', handleSystemInfo);
    sendCommand('getSystemInfo');
    return () => offEvent('systemInfo', handleSystemInfo);
  }, []);

  const [targetRelease, setTargetRelease] = useState(null);

  const handleStartInstallation = (targetPath = installPath, targetOptions = options, release = targetRelease) => {
    sendCommand('setInstallPath', { path: targetPath });
    sendCommand('createShortcuts', targetOptions);
    if (release) {
      setTargetRelease(release);
    }
    setCurrentStep('Progress');
  };

  const renderStep = () => {
    switch (currentStep) {
      case 'Welcome':
        return (
          <Welcome 
            key="welcome" 
            installPath={installPath}
            existingInstall={existingInstall}
            onNext={(rel) => handleStartInstallation(installPath, options, rel)}
            onCustomize={(rel) => {
              if (rel) setTargetRelease(rel);
              setCurrentStep('InstallPath');
            }}
          />
        );
      case 'InstallPath':
        return (
          <InstallPath 
            key="path" 
            onNext={() => {
              sendCommand('setInstallPath', { path: installPath });
              setCurrentStep('Options');
            }} 
            onBack={() => setCurrentStep('Welcome')}
            installPath={installPath}
            setInstallPath={setInstallPath}
          />
        );
      case 'Options':
        return (
          <Options 
            key="options" 
            onNext={() => handleStartInstallation(installPath, options, targetRelease)} 
            onBack={() => setCurrentStep('InstallPath')}
            options={options}
            setOptions={setOptions}
          />
        );
      case 'Progress':
        return (
          <Progress 
            key="progress" 
            installPath={installPath}
            options={options}
            targetRelease={targetRelease}
            onNext={() => setCurrentStep('Complete')} 
            onCancel={() => setCurrentStep('Welcome')}
          />
        );
      case 'Complete':
        return <Complete key="complete" installPath={installPath} options={options} />;
      default:
        return null;
    }
  };

  return (
    <div className="w-full h-full relative overflow-hidden bg-background font-sans">
      <StepIndicator currentStepId={currentStep} />
      <AnimatePresence mode="wait">
        {renderStep()}
      </AnimatePresence>
    </div>
  );
}
