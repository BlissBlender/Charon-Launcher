import React from 'react';
import { motion } from 'framer-motion';
import logoImg from '../assets/logo.png';

export default function AnimatedLogo() {
  return (
    <motion.div 
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center z-10 select-none"
    >
      <div className="relative mb-3 flex items-center justify-center">
        {/* Soft atmospheric ambient glow behind the logo */}
        <div className="absolute w-28 h-28 bg-primary/25 rounded-full blur-2xl pointer-events-none" />
        
        {/* Logo emblem */}
        <motion.img 
          src={logoImg} 
          alt="Charon Logo"
          initial={{ y: -8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="relative w-20 h-20 drop-shadow-[0_4px_24px_rgba(0,212,255,0.4)] object-contain"
        />
      </div>

      <div className="flex items-center gap-2">
        <h1 className="text-4xl font-black tracking-[0.25em] text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-slate-300 drop-shadow-sm">
          CHARON
        </h1>
      </div>

      <div className="flex items-center gap-2 mt-1">
        <span className="h-[1px] w-6 bg-gradient-to-r from-transparent to-primary/60" />
        <span className="text-[11px] font-semibold tracking-[0.3em] uppercase text-cyan-400/90">
          Game Launcher
        </span>
        <span className="h-[1px] w-6 bg-gradient-to-l from-transparent to-primary/60" />
      </div>
    </motion.div>
  );
}
