import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import ProgressRing from '../components/ProgressRing';
import { sendCommand, onEvent, offEvent } from '../bridge';

export default function Progress({ onNext, onCancel, installPath, options, targetRelease }) {
  const [progress, setProgress] = useState(0);
  const [file, setFile] = useState(targetRelease ? `Preparing v${targetRelease.version} installation...` : 'Preparing installation...');
  const [speed, setSpeed] = useState('');
  const [filesProgress, setFilesProgress] = useState('');
  const [eta, setEta] = useState('');

  useEffect(() => {
    const handleProgress = (data) => {
      if (data.percent !== undefined) setProgress(data.percent);
      if (data.file) setFile(data.file);
      if (data.speed) setSpeed(data.speed);
      if (data.filesDone !== undefined && data.filesTotal !== undefined) {
        setFilesProgress(`${data.filesDone} / ${data.filesTotal} files`);
      }
      if (data.eta) setEta(data.eta);
    };

    const handleComplete = () => {
      onNext();
    };

    onEvent('progress', handleProgress);
    onEvent('complete', handleComplete);

    sendCommand('startInstall', {
      path: installPath || '',
      shortcuts: options || { desktop: true, startMenu: true },
      version: targetRelease?.version || '1.0.0',
      patchUrl: targetRelease?.patchUrl || ''
    });

    return () => {
      offEvent('progress', handleProgress);
      offEvent('complete', handleComplete);
    };
  }, [onNext, installPath, options, targetRelease]);

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="w-full h-full flex flex-col items-center justify-center p-12 pt-24 bg-background"
    >
      <ProgressRing percent={progress} />
      
      <div className="mt-10 text-center w-full max-w-md">
        <p className="text-textHeading font-medium truncate mb-2">{file}</p>
        <div className="flex justify-between text-sm text-gray-400 mt-4 bg-card border border-border p-4 rounded-sm">
          <div className="flex flex-col items-start">
            <span className="text-gray-500 mb-1">Speed</span>
            <span>{speed || '--'}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className="text-gray-500 mb-1">Progress</span>
            <span>{filesProgress || '--'}</span>
          </div>
          <div className="flex flex-col items-end">
            <span className="text-gray-500 mb-1">ETA</span>
            <span>{eta || '--'}</span>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 right-12">
        <button 
          onClick={() => {
            if (confirm('Are you sure you want to cancel the installation?')) {
              sendCommand('abort');
              onCancel();
            }
          }}
          className="px-4 py-2 text-red-400 hover:text-red-300 transition-colors text-sm"
        >
          Cancel
        </button>
      </div>
    </motion.div>
  );
}
