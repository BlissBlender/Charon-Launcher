import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { FolderOpen } from 'lucide-react';
import { sendCommand, onEvent, offEvent } from '../bridge';

export default function InstallPath({ onNext, onBack, installPath, setInstallPath }) {
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(true);
  const requiredSpace = 250 * 1024 * 1024; // 250 MB in bytes

  useEffect(() => {
    const handleSystemInfo = (data) => {
      // Normalize drive format from C++ (path/freeBytes/totalBytes) or mock (letter/free/total)
      const normalized = (data.drives || []).map(d => ({
        letter: d.letter || (d.path ? d.path.substring(0, 2) : '?:'),
        free: d.free ?? d.freeBytes ?? 0,
        total: d.total ?? d.totalBytes ?? 0
      }));
      setDrives(normalized);
      if (!installPath && data.defaultPath) {
        setInstallPath(data.defaultPath);
      }
      setLoading(false);
    };

    const handleFolderSelected = (data) => {
      if (data.path) setInstallPath(data.path);
    };

    onEvent('systemInfo', handleSystemInfo);
    onEvent('folderSelected', handleFolderSelected);

    sendCommand('getSystemInfo');

    return () => {
      offEvent('systemInfo', handleSystemInfo);
      offEvent('folderSelected', handleFolderSelected);
    };
  }, [installPath, setInstallPath]);

  const handleBrowse = () => {
    sendCommand('browseFolder');
  };

  const formatBytes = (bytes) => {
    if (bytes === undefined || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const currentDriveLetter = installPath ? installPath.substring(0, 2).toUpperCase() : '';
  const currentDrive = drives.find(d => d.letter.toUpperCase() === currentDriveLetter);
  const hasEnoughSpace = currentDrive ? currentDrive.free >= requiredSpace : false;

  return (
    <motion.div 
      initial={{ opacity: 0, x: 50 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -50 }}
      className="w-full h-full flex flex-col p-12 pt-24 bg-background"
    >
      <h2 className="text-3xl text-textHeading font-semibold mb-8">Installation Location</h2>
      
      <div className="flex gap-4 mb-8">
        <div className="flex-1 bg-card border border-border rounded-sm flex items-center px-4 focus-within:border-primary transition-colors">
          <FolderOpen size={20} className="text-gray-400 mr-3" />
          <input 
            type="text" 
            value={installPath}
            onChange={(e) => setInstallPath(e.target.value)}
            className="bg-transparent border-none outline-none text-textMain w-full py-3"
            spellCheck={false}
          />
        </div>
        <button 
          onClick={handleBrowse}
          className="bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 hover:border-cyan-500/40 text-slate-200 px-6 py-2.5 rounded-lg text-xs font-semibold tracking-wide transition-all shadow-sm flex items-center gap-2 cursor-pointer"
        >
          <FolderOpen size={14} className="text-cyan-400" />
          Browse
        </button>
      </div>

      <div className="bg-card border border-border p-6 rounded-xl flex-1">
        <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center justify-between">
          <span>Available Storage</span>
          <span className="text-xs font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-500/30 px-2.5 py-1 rounded-md">Required: {formatBytes(requiredSpace)}</span>
        </h3>
        
        {loading ? (
          <p className="text-gray-500 text-xs">Scanning storage drives...</p>
        ) : drives.length > 0 ? (
          <div className="space-y-3 max-h-40 overflow-y-auto pr-2">
            {drives.map(drive => {
              const used = drive.total - drive.free;
              const percentUsed = (used / drive.total) * 100;
              const isSelected = drive.letter.toUpperCase() === currentDriveLetter;
              
              return (
                <div key={drive.letter} className={`p-3.5 border rounded-lg transition-all ${isSelected ? 'border-cyan-500/50 bg-cyan-500/[0.04] shadow-[0_0_15px_rgba(0,212,255,0.06)]' : 'border-white/5 bg-white/[0.01]'}`}>
                  <div className="flex justify-between mb-2">
                    <span className="font-semibold text-sm text-textHeading">{drive.letter} Drive</span>
                    <span className="text-xs text-gray-400">{formatBytes(drive.free)} free of {formatBytes(drive.total)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                    <div 
                      className={`h-full rounded-full transition-all duration-500 ${percentUsed > 90 ? 'bg-rose-500' : 'bg-gradient-to-r from-cyan-400 to-blue-500'}`}
                      style={{ width: `${percentUsed}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-500 text-xs">No drive telemetry available.</p>
        )}
      </div>

      <div className="flex justify-between items-center mt-6">
        <button 
          onClick={onBack}
          className="px-5 py-2.5 text-xs font-semibold tracking-wide text-slate-400 hover:text-slate-200 transition-colors rounded-lg bg-white/[0.02] hover:bg-white/[0.06] border border-white/5 hover:border-white/15 cursor-pointer"
        >
          Back
        </button>
        <button 
          onClick={onNext}
          disabled={!installPath || (currentDrive && !hasEnoughSpace)}
          className="px-8 py-2.5 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-extrabold text-xs uppercase tracking-wider rounded-lg shadow-[0_4px_20px_rgba(0,212,255,0.3)] hover:shadow-[0_4px_25px_rgba(0,212,255,0.5)] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none cursor-pointer"
        >
          Continue
        </button>
      </div>
    </motion.div>
  );
}
