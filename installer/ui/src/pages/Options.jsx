import React from 'react';
import { motion } from 'framer-motion';
import { Monitor, BookmarkCheck, Play, ArrowRight } from 'lucide-react';

function OptionCard({ checked, onChange, icon: Icon, title, description }) {
  return (
    <div 
      onClick={onChange}
      className={`group flex items-center justify-between p-4 rounded-xl border transition-all cursor-pointer select-none mb-3 ${
        checked 
          ? 'bg-cyan-500/[0.04] border-cyan-500/40 shadow-[0_0_20px_rgba(0,212,255,0.06)]' 
          : 'bg-white/[0.01] border-white/5 hover:border-white/10 hover:bg-white/[0.03]'
      }`}
    >
      <div className="flex items-center gap-3.5">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
          checked ? 'bg-cyan-500/20 text-cyan-300' : 'bg-white/5 text-slate-400 group-hover:text-slate-200'
        }`}>
          <Icon size={18} />
        </div>
        <div>
          <div className="text-sm font-semibold text-textHeading">{title}</div>
          <div className="text-xs text-slate-400">{description}</div>
        </div>
      </div>

      <div className="relative">
        <input type="checkbox" className="sr-only" checked={checked} onChange={onChange} />
        <div className={`w-11 h-6 rounded-full transition-colors ${checked ? 'bg-cyan-400 shadow-[0_0_10px_rgba(0,212,255,0.5)]' : 'bg-slate-800 border border-slate-700'}`}></div>
        <div className={`absolute left-0.5 top-0.5 bg-slate-950 w-5 h-5 rounded-full transition-transform ${checked ? 'transform translate-x-5' : ''}`}></div>
      </div>
    </div>
  );
}

export default function Options({ onNext, onBack, options, setOptions }) {
  const handleToggle = (key) => {
    setOptions(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      className="w-full h-full flex flex-col p-12 pt-24 bg-background"
    >
      <h2 className="text-2xl font-bold text-textHeading mb-2">Installation Preferences</h2>
      <p className="text-xs text-slate-400 mb-8">Configure system shortcuts and launcher startup behavior.</p>
      
      <div className="flex-1">
        <OptionCard 
          checked={options.desktopShortcut} 
          onChange={() => handleToggle('desktopShortcut')} 
          icon={Monitor}
          title="Desktop Shortcut" 
          description="Place a quick-launch shortcut on your Windows desktop."
        />
        <OptionCard 
          checked={options.startMenuShortcut} 
          onChange={() => handleToggle('startMenuShortcut')} 
          icon={BookmarkCheck}
          title="Start Menu Program Entry" 
          description="Register Charon in the Windows Start Menu & Search."
        />
        <OptionCard 
          checked={options.launchAfter} 
          onChange={() => handleToggle('launchAfter')} 
          icon={Play}
          title="Launch upon completion" 
          description="Automatically launch Charon Game Launcher when ready."
        />
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
          className="px-8 py-3 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:to-blue-400 text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl shadow-[0_6px_25px_rgba(0,212,255,0.35)] hover:shadow-[0_8px_35px_rgba(0,212,255,0.55)] active:scale-[0.985] transition-all flex items-center gap-2 cursor-pointer"
        >
          <span>Begin Installation</span>
          <ArrowRight size={14} strokeWidth={2.5} />
        </button>
      </div>
    </motion.div>
  );
}
