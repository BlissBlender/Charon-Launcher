import React from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { sendCommand } from '../bridge';

export default function Complete({ installPath, options }) {
  const handleLaunch = () => {
    sendCommand('launchApp');
    setTimeout(() => {
      window.close();
    }, 500);
  };

  const handleClose = () => {
    window.close();
  };

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="w-full h-full flex flex-col items-center justify-center p-12 bg-background relative overflow-hidden"
    >
      {/* Burst effect */}
      <motion.div 
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: [0, 1.5, 1], opacity: [0, 1, 0] }}
        transition={{ duration: 1, ease: "easeOut" }}
        className="absolute w-96 h-96 bg-primary/20 rounded-full blur-3xl pointer-events-none"
      />

      <motion.div 
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", bounce: 0.5, delay: 0.2 }}
        className="w-24 h-24 rounded-full bg-card border-2 border-primary flex items-center justify-center glow-cyan mb-8 z-10"
      >
        <Check size={48} className="text-primary" />
      </motion.div>

      <motion.h2 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4 }}
        className="text-4xl font-bold text-textHeading mb-2 z-10"
      >
        Installation Complete!
      </motion.h2>

      <motion.p 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="text-gray-400 mb-12 z-10 text-center"
      >
        Charon Game Launcher has been successfully installed to:<br/>
        <span className="text-textMain font-mono text-sm block mt-2">{installPath}</span>
      </motion.p>

      <motion.div 
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        className="flex flex-col items-center gap-3.5 z-10 w-full max-w-[320px]"
      >
        <button 
          onClick={handleLaunch}
          className="relative w-full h-13 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 active:scale-[0.985] text-slate-950 font-extrabold text-xs uppercase tracking-[0.15em] rounded-xl border-t border-white/60 shadow-[0_8px_30px_rgba(0,212,255,0.4)] transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <span>Launch Charon Launcher</span>
        </button>
        
        <button 
          onClick={handleClose}
          className="text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors py-2 cursor-pointer"
        >
          Finish & Exit
        </button>
      </motion.div>
    </motion.div>
  );
}
