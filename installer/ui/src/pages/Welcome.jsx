import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Sliders, HardDrive, ShieldCheck, Sparkles, FileText, X, RefreshCw, CheckCircle2 } from 'lucide-react';
import AnimatedLogo from '../components/AnimatedLogo';
import ParticleBackground from '../components/ParticleBackground';

const CACHE_KEY = 'charon_release_cache';
const CACHE_TTL_MS = 15 * 60 * 1000; // 15-minute Rate-Limit Shield

export default function Welcome({ onNext, onCustomize, installPath, existingInstall }) {
  const displayPath = installPath || 'C:\\Program Files\\Charon Launcher';
  const [onlineRelease, setOnlineRelease] = useState(null);
  const [showChangelog, setShowChangelog] = useState(false);

  useEffect(() => {
    let cached = null;
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        cached = JSON.parse(raw);
        if (cached?.data) {
          setOnlineRelease(cached.data);
        }
      }
    } catch (e) {}

    const now = Date.now();
    // Rate-limit shield: Skip remote request if cached within last 15 minutes
    if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);

    const headers = {
      'Accept': 'application/vnd.github.v3+json'
    };
    if (cached?.etag) {
      headers['If-None-Match'] = cached.etag;
    }

    fetch('https://api.github.com/repos/BlissBlender/Charon-Launcher/releases/latest', {
      headers,
      signal: controller.signal
    })
      .then(async (res) => {
        clearTimeout(timer);
        if (res.status === 304 && cached) {
          // 304 Not Modified: Cache is still valid, bump timestamp
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({ ...cached, timestamp: now }));
          } catch (e) {}
          return;
        }

        if (!res.ok) return null;

        const etag = res.headers.get('ETag') || '';
        const data = await res.json();
        if (data && data.tag_name) {
          const remoteVersion = data.tag_name.replace(/^v/, '');
          const asarAsset = data.assets?.find(a => a.name === 'app.asar' || a.name.endsWith('.asar'));
          const releaseObj = {
            version: remoteVersion,
            tag: data.tag_name,
            patchUrl: asarAsset?.browser_download_url || '',
            body: data.body || '',
            publishedAt: data.published_at || '',
            htmlUrl: data.html_url || ''
          };
          setOnlineRelease(releaseObj);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify({
              timestamp: now,
              etag,
              data: releaseObj
            }));
          } catch (e) {}
        }
      })
      .catch(() => {});

    return () => clearTimeout(timer);
  }, []);

  const isInstalled = Boolean(existingInstall?.installed);
  const existingVersion = existingInstall?.version || '';
  const hasNewerVersion = onlineRelease && (!existingVersion || onlineRelease.version !== existingVersion);

  let buttonTitle = 'Install Charon';
  if (isInstalled) {
    if (hasNewerVersion && onlineRelease?.version) {
      buttonTitle = `Update to v${onlineRelease.version}`;
    } else {
      buttonTitle = 'Repair & Reinstall';
    }
  } else if (onlineRelease) {
    buttonTitle = `Install Charon v${onlineRelease.version}`;
  }

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="relative w-full h-full flex flex-col items-center justify-between p-10 bg-background overflow-hidden select-none"
    >
      <ParticleBackground />

      {/* Top subtle badge & Changelog button */}
      <motion.div 
        initial={{ y: -10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="z-10 flex items-center gap-2.5"
      >
        {isInstalled && hasNewerVersion ? (
          <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-[11px] text-cyan-300 tracking-wide shadow-[0_0_15px_rgba(0,212,255,0.2)]">
            <RefreshCw size={12} className="text-cyan-400 animate-spin" style={{ animationDuration: '4s' }} />
            <span>Upgrade Available · v{existingVersion || '1.0.0'} → v{onlineRelease.version}</span>
          </div>
        ) : isInstalled ? (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-400 tracking-wide">
            <CheckCircle2 size={13} className="text-emerald-400" />
            <span>Installed v{existingVersion || '1.0.0'} Detected · Ready to Repair</span>
          </div>
        ) : onlineRelease ? (
          <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-400 tracking-wide shadow-[0_0_15px_rgba(16,185,129,0.15)] animate-pulse">
            <Sparkles size={12} className="text-emerald-400" />
            <span>Latest v{onlineRelease.version} Detected · Smart Auto-Update Ready</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.03] border border-white/10 text-[11px] text-slate-400 tracking-wide">
            <ShieldCheck size={13} className="text-cyan-400" />
            <span>Verified Package · 64-bit Native</span>
            <span className="text-slate-600">|</span>
            <span className="text-slate-400">v1.0.0</span>
          </div>
        )}

        {onlineRelease?.body && (
          <button
            type="button"
            onClick={() => setShowChangelog(true)}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/30 px-2.5 py-1 rounded-full transition-all cursor-pointer shadow-[0_0_10px_rgba(0,212,255,0.1)]"
          >
            <FileText size={11} />
            <span>What's New</span>
          </button>
        )}
      </motion.div>

      {/* Central Brand Unit */}
      <div className="z-10 flex flex-col items-center text-center my-auto">
        <AnimatedLogo />

        <motion.p 
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.4 }}
          className="text-slate-400 text-sm max-w-sm mt-3 tracking-normal leading-relaxed"
        >
          {isInstalled 
            ? 'Existing Charon installation detected. Choose update or repair to restore system components.'
            : 'High-performance, next-generation gaming hub with ultra-fast multi-threaded asset delivery.'}
        </motion.p>
      </div>

      {/* Action Section */}
      <div className="z-10 flex flex-col items-center w-full max-w-md">
        {/* Main Install Button */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.4 }}
          className="relative w-full max-w-[340px] group"
        >
          {/* Ambient colored blur behind button for authentic glow */}
          <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-blue-600 rounded-xl blur-lg opacity-40 group-hover:opacity-75 transition-opacity duration-300 pointer-events-none" />

          <button
            onClick={() => onNext(onlineRelease)}
            className="relative w-full h-14 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 hover:from-cyan-300 hover:via-sky-300 hover:to-blue-400 active:scale-[0.985] text-slate-950 font-black text-sm uppercase tracking-[0.14em] rounded-xl border-t border-white/60 shadow-[0_8px_30px_rgba(0,212,255,0.35)] transition-all duration-200 flex items-center justify-center gap-3 overflow-hidden cursor-pointer"
          >
            {/* Shimmer sweep effect */}
            <div className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/35 to-transparent -translate-x-full group-hover:translate-x-[300%] transition-transform duration-1000 ease-out pointer-events-none" />

            <span className="relative z-10 drop-shadow-sm">
              {buttonTitle}
            </span>
            
            <div className="relative z-10 w-7 h-7 rounded-lg bg-slate-950/15 flex items-center justify-center text-slate-950 group-hover:translate-x-1 transition-transform duration-200">
              <ArrowRight size={16} strokeWidth={2.5} />
            </div>
          </button>
        </motion.div>

        {/* Secondary Options button */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.65 }}
          className="flex items-center gap-3 mt-4"
        >
          <button
            onClick={() => (onCustomize ? onCustomize(onlineRelease) : onNext(onlineRelease))}
            className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-cyan-300 bg-white/[0.03] hover:bg-white/[0.07] border border-white/10 hover:border-cyan-500/40 px-4 py-2 rounded-lg transition-all cursor-pointer"
          >
            <Sliders size={13} className="text-slate-400 group-hover:text-cyan-300" />
            <span>Customize Installation</span>
          </button>
        </motion.div>

        {/* Location snippet */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="flex items-center gap-1.5 mt-5 text-[11px] text-slate-500 max-w-full truncate"
        >
          <HardDrive size={12} className="text-slate-600 flex-shrink-0" />
          <span className="truncate">Destination: <span className="text-slate-400 font-mono">{displayPath}</span></span>
        </motion.div>
      </div>

      {/* Interactive What's New / Changelog Modal */}
      <AnimatePresence>
        {showChangelog && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-6 select-text"
            onClick={() => setShowChangelog(false)}
          >
            <motion.div
              initial={{ scale: 0.94, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.94, opacity: 0, y: 10 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="relative bg-slate-900/95 border border-cyan-500/40 rounded-2xl w-full max-w-lg shadow-[0_0_50px_rgba(0,212,255,0.25)] overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <Sparkles size={16} className="text-cyan-400" />
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Release Notes · v{onlineRelease?.version || 'Latest'}
                  </h3>
                </div>
                <button
                  onClick={() => setShowChangelog(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 max-h-[55vh] overflow-y-auto custom-scrollbar text-xs text-slate-300 leading-relaxed space-y-3 font-sans">
                {onlineRelease?.body ? (
                  <div className="whitespace-pre-wrap font-mono text-[11.5px] bg-black/40 p-4 rounded-xl border border-white/5 text-slate-300 select-text leading-relaxed">
                    {onlineRelease.body}
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-400">
                    <p>No extended release notes found for v{onlineRelease?.version}.</p>
                    <p className="text-[11px] text-slate-500 mt-1">Visit github.com/BlissBlender/Charon-Launcher for details.</p>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between px-6 py-3.5 border-t border-white/10 bg-slate-950/60">
                <span className="text-[10px] text-slate-500">
                  Verified GitHub Release Asset
                </span>
                <button
                  onClick={() => setShowChangelog(false)}
                  className="px-4 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

