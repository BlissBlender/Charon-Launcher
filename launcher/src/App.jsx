import React, { useState, useEffect, useRef } from 'react';
import { 
  Search, 
  Library, 
  Download, 
  Play, 
  ArrowLeft, 
  FolderOpen, 
  XCircle, 
  CheckCircle2, 
  Check, 
  X, 
  HardDrive, 
  AlertTriangle, 
  FolderCheck, 
  Trash2, 
  RefreshCw, 
  Gamepad2, 
  ShieldCheck, 
  Activity, 
  Layers,
  Sparkles,
  ArrowUpCircle,
  Zap,
  ExternalLink,
  Clock,
  ArrowRight,
  Settings,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Plus,
  Globe,
  Cpu,
  Monitor,
  Film,
  Image as ImageIcon,
  Sliders,
  Info,
  Compass,
  ArrowUpDown,
  LayoutGrid,
  List,
  Trophy,
  Lock,
  Unlock,
  Save,
  DownloadCloud,
  Upload,
  Link,
  RotateCcw,
  Key,
  Settings2,
  Star,
  ChevronDown,
  Terminal,
  Disc
} from 'lucide-react';
import charonLogo from './assets/logo.png';

function formatPlaytime(seconds = 0) {
  if (!seconds || seconds <= 0) return '0 hrs';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 1) return '< 1 min played';
  if (minutes < 60) return `${minutes}m played`;
  const hours = (seconds / 3600).toFixed(1);
  return `${hours} hrs played`;
}

function formatLastPlayed(timestamp) {
  if (!timestamp) return 'Never played';
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (minutes < 5) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString();
}

function playAchievementChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    // First harmonic tone (D5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(587.33, ctx.currentTime);
    gain1.gain.setValueAtTime(0.20, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.6);

    // Second bell chime (A5)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(880.00, ctx.currentTime + 0.12);
    gain2.gain.setValueAtTime(0.24, ctx.currentTime + 0.12);
    gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.95);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime + 0.12);
    osc2.stop(ctx.currentTime + 0.95);
  } catch (e) {
    console.warn('[Audio] Failed to synthesize achievement chime:', e);
  }
}

function getGameArtworkKey(game) {
  if (!game) return '';
  const title = (game.cleanTitle || game.title || game.id || '').trim();
  let s = title.replace(/\[.*?\]/g, ' ').replace(/\(.*?\)/g, ' ');
  if (s.includes(' / ')) {
    const parts = s.split(' / ');
    s = parts.reduce((a, b) => a.length > b.length ? a : b).trim();
  }
  s = s.replace(/\s*[–—\-]\s*(?:v?[\d.]+|build|hotfix|update|offline|deluxe|complete|gold|release|bonus|all dlc|just for fun|supporter|definitive|season).*$/i, '');
  s = s.replace(/:\s*(?:complete|deluxe|definitive|gold|anniversary|enhanced|remastered|special|digital|collector['’]?s?|supporter|ultimate|premium|super digital|game & soundtrack|the set bundle|legendary|platinum|goty|game of the year|standard|bundle|edition|collection|kollection|pack|anthology|trilogy|duology|soundtrack bundle|ski resort edition|year one edition|age of pirates).*$/i, '');
  s = s.replace(/\s+v?\d+\.\d+(?:\.\d+)*.*$/i, '');
  s = s.replace(/\s+(?:build|patch|hotfix|update|release|v\d+)\s*.*$/i, '');
  return s.trim() || title;
}

function getCustomArtworkForGame(game, artworkMap) {
  if (!game || !artworkMap) return null;
  const key1 = getGameArtworkKey(game);
  const key2 = (game.title || '').trim();
  const key3 = (game.cleanTitle || '').trim();
  const key4 = String(game.id || '').trim();
  return artworkMap[key1] || artworkMap[key2] || artworkMap[key3] || artworkMap[key4] || null;
}

function App() {
  const [activeTab, setActiveTab] = useState(() => {
    try {
      const saved = localStorage.getItem('charon_active_tab');
      if (saved === 'store' || saved === 'library' || saved === 'downloads' || saved === 'settings') {
        return saved;
      }
    } catch (e) {}
    return 'store';
  });
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [games, setGames] = useState([]);
  const [page, setPage] = useState(1);
  const [activeSource, setActiveSource] = useState('all');
  const [isSourceLoading, setIsSourceLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchHistory, setSearchHistory] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('charon_search_history') || '[]');
    } catch (e) {
      return [];
    }
  });
  const [instantSuggestions, setInstantSuggestions] = useState([]);
  const [isInstantLoading, setIsInstantLoading] = useState(false);
  const [isSearchDropdownOpen, setIsSearchDropdownOpen] = useState(false);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [repacksModalData, setRepacksModalData] = useState(null);
  const searchInputRef = useRef(null);
  const searchContainerRef = useRef(null);
  const [installModalGame, setInstallModalGame] = useState(null);
  const [deleteTargetGame, setDeleteTargetGame] = useState(null);
  const [defaultDrive, setDefaultDrive] = useState(() => localStorage.getItem('charon_default_drive') || 'C:');
  
  // Auto-Updater State
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [updateStatus, setUpdateStatus] = useState({
    status: 'idle', // 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'error'
    version: null,
    releaseNotes: '',
    releaseDate: '',
    percent: 0,
    speed: '',
    error: null
  });
  const [updateBannerDismissed, setUpdateBannerDismissed] = useState(false);
  const [showChangelogModal, setShowChangelogModal] = useState(false);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const toastTimer = useRef(null);

  const [saveBackupGame, setSaveBackupGame] = useState(null);
  const [achievementToast, setAchievementToast] = useState(null);
  const [artworkPickerGame, setArtworkPickerGame] = useState(null);
  const [exeSettingsGame, setExeSettingsGame] = useState(null);
  const [customArtworkMap, setCustomArtworkMap] = useState({});

  // Sync custom artwork database on startup
  useEffect(() => {
    if (window.api?.getCustomArtwork) {
      window.api.getCustomArtwork().then(db => {
        if (db) setCustomArtworkMap(db);
      }).catch(() => {});
    }
  }, []);

  const handleArtworkUpdated = (gameKey, assetType, newUrl) => {
    setCustomArtworkMap(prev => {
      const next = { ...prev };
      if (!next[gameKey]) next[gameKey] = {};
      if (newUrl) {
        next[gameKey][assetType] = newUrl;
      } else {
        delete next[gameKey][assetType];
        if (Object.keys(next[gameKey]).length === 0) delete next[gameKey];
      }
      return next;
    });
  };

  // Playtime & Active Running Games State
  const [playtimeMap, setPlaytimeMap] = useState({});
  const [runningGames, setRunningGames] = useState([]);

  useEffect(() => {
    if (window.api?.onAchievementUnlocked) {
      const unsub = window.api.onAchievementUnlocked((payload) => {
        if (!payload) return;
        playAchievementChime();
        setAchievementToast(payload);
      });
      return () => { if (unsub) unsub(); };
    }
  }, []);

  useEffect(() => {
    if (window.api?.getPlaytime) {
      window.api.getPlaytime().then(data => {
        if (data) setPlaytimeMap(data);
      }).catch(() => {});
    }

    if (window.api?.getRunningGames) {
      window.api.getRunningGames().then(list => {
        if (list) setRunningGames(list);
      }).catch(() => {});
    }

    if (window.api?.onPlaytimeUpdate) {
      const unsub = window.api.onPlaytimeUpdate((payload) => {
        if (!payload) return;
        setPlaytimeMap(prev => ({
          ...prev,
          [payload.gameKey]: {
            ...(prev[payload.gameKey] || {}),
            totalSeconds: payload.totalSeconds,
            lastPlayed: Date.now()
          }
        }));
        if (payload.isRunning) {
          setRunningGames(prev => {
            const exists = prev.some(r => r.gameKey === payload.gameKey);
            if (exists) {
              return prev.map(r => r.gameKey === payload.gameKey ? { ...r, sessionSeconds: payload.sessionSeconds } : r);
            }
            return [...prev, { gameKey: payload.gameKey, sessionSeconds: payload.sessionSeconds }];
          });
        } else {
          setRunningGames(prev => prev.filter(r => r.gameKey !== payload.gameKey));
        }
      });
      return () => { if (typeof unsub === 'function') unsub(); };
    }
  }, []);

  // Post-Extraction Events (Cloud Save Sync & Classics Discs)
  useEffect(() => {
    const unsubSave = window.api?.onCloudSaveSync?.((data) => {
      if (data?.status === 'synced') {
        showToast(`☁️ Cloud Save Synced: Auto-snapshot backed up for "${data.gameTitle}"!`);
      }
    });

    const unsubDiscs = window.api?.onClassicsDiscsLinked?.((data) => {
      if (data?.discs && data.discs.length > 1) {
        showToast(`🎮 Multi-disc set detected: Auto-linked ${data.discs.length} discs for "${data.title}".`);
      }
    });

    return () => {
      if (typeof unsubSave === 'function') unsubSave();
      if (typeof unsubDiscs === 'function') unsubDiscs();
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('charon_active_tab', activeTab);
    } catch (e) {}
  }, [activeTab]);

  useEffect(() => {
    if (window.api?.onSwitchTab) {
      const unsub = window.api.onSwitchTab((tab) => {
        if (tab) {
          setActiveTab(tab);
          setSelectedGameId(null);
        }
      });
      return () => { if (typeof unsub === 'function') unsub(); };
    }
  }, []);

  useEffect(() => {
    if (window.api?.getSettings) {
      window.api.getSettings().then(st => {
        if (st && st.launchToLibrary) {
          setActiveTab('library');
        }
      }).catch(() => {});
    }
  }, []);

  const showToast = (msg) => {
    setToastMessage(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  const currentRequestId = useRef(0);
  const searchDebounceTimer = useRef(null);

  // Startup Splash Screen State
  const [appBootState, setAppBootState] = useState({
    phaseText: 'Starting Charon Native Core...',
    percent: 22,
    isInitializing: true,
    isMounted: true
  });

  const dismissSplash = () => {
    setAppBootState(prev => {
      if (!prev.isInitializing) return prev;
      return { ...prev, phaseText: 'Library Synchronized • Client Ready', percent: 100, isInitializing: false };
    });
    setTimeout(() => {
      setAppBootState(prev => ({ ...prev, isMounted: false }));
    }, 750);
  };

  useEffect(() => {
    const t1 = setTimeout(() => {
      setAppBootState(prev => prev.isInitializing ? { ...prev, phaseText: 'Initializing 7-Zip decompression core...', percent: 52 } : prev);
    }, 320);

    const t2 = setTimeout(() => {
      setAppBootState(prev => prev.isInitializing ? { ...prev, phaseText: 'Connecting to secure game repositories...', percent: 84 } : prev);
    }, 750);

    const safetyTimer = setTimeout(() => {
      dismissSplash();
    }, 3400);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(safetyTimer);
    };
  }, []);

  useEffect(() => {
    loadGames(1, '', 'all');

    // Fetch live application version
    if (window.api && window.api.getAppVersion) {
      window.api.getAppVersion().then(ver => {
        if (ver) setAppVersion(ver);
      }).catch(() => {});
    }

    // Signal renderer ready to commit any pending post-update health check
    if (window.api && window.api.signalRendererReady) {
      window.api.signalRendererReady();
    }

    // Subscribe to autoUpdater background events
    if (window.api && window.api.onUpdaterEvent) {
      const cleanup = window.api.onUpdaterEvent((data) => {
        if (!data) return;
        console.log('[Updater UI Event]', data);
        if (data.status === 'checking') {
          setIsCheckingUpdate(true);
        } else if (data.status === 'available') {
          setIsCheckingUpdate(false);
          setUpdateStatus({
            status: 'available',
            version: data.version,
            releaseNotes: data.releaseNotes || '',
            releaseDate: data.releaseDate || '',
            percent: 0,
            speed: '',
            error: null
          });
          setUpdateBannerDismissed(false);
        } else if (data.status === 'up-to-date') {
          setIsCheckingUpdate(false);
          showToast(`You're up to date! Charon Launcher v${data.version || appVersion} is the latest version.`);
        } else if (data.status === 'downloading') {
          setIsCheckingUpdate(false);
          setUpdateStatus(prev => ({
            ...prev,
            status: 'downloading',
            percent: data.percent || 0,
            speed: data.speed || ''
          }));
        } else if (data.status === 'downloaded') {
          setIsCheckingUpdate(false);
          setUpdateStatus(prev => ({
            ...prev,
            status: 'downloaded',
            version: data.version || prev.version,
            releaseNotes: data.releaseNotes || prev.releaseNotes
          }));
          setUpdateBannerDismissed(false);
        } else if (data.status === 'error') {
          setIsCheckingUpdate(false);
          console.warn('[Updater UI] Error received:', data.message);
        }
      });
      return () => {
        if (typeof cleanup === 'function') cleanup();
      };
    }
  }, []);

  const handleManualCheckForUpdates = async () => {
    if (isCheckingUpdate) return;
    setIsCheckingUpdate(true);
    try {
      if (window.api && window.api.checkForUpdates) {
        const res = await window.api.checkForUpdates();
        if (res?.status === 'dev') {
          setTimeout(() => {
            setIsCheckingUpdate(false);
            showToast(`Dev build v${appVersion}. Differential updates activate in release setup package.`);
          }, 600);
        }
      } else {
        setIsCheckingUpdate(false);
      }
    } catch (e) {
      setIsCheckingUpdate(false);
      showToast("Unable to reach update server.");
    }
  };

  const handleStartDownloadUpdate = async () => {
    try {
      setUpdateStatus(prev => ({ ...prev, status: 'downloading', percent: 0, speed: 'Connecting...' }));
      if (window.api && window.api.startDownloadUpdate) {
        const res = await window.api.startDownloadUpdate();
        if (res?.status === 'dev') {
          showToast("Update downloading is enabled in the installed setup package.");
          setUpdateStatus(prev => ({ ...prev, status: 'idle' }));
        }
      }
    } catch (err) {
      console.error('Failed to trigger update download:', err);
      showToast("Failed to initiate update download.");
    }
  };

  const handleRestartAndApply = () => {
    if (window.api && window.api.restartAndApplyUpdate) {
      window.api.restartAndApplyUpdate({ version: updateStatus.version });
    }
  };

  const loadGames = async (pageNum, query, source = activeSource) => {
    if (!window.api) return;
    const reqId = ++currentRequestId.current;

    if (pageNum === 1) {
      setGames([]);
      setIsSourceLoading(true);
      setHasMore(true);
    } else {
      setIsLoadingMore(true);
    }

    try {
      let newGames = [];
      if (source === 'all') {
        if (window.api && window.api.searchAllSources) {
          const res = await window.api.searchAllSources({ page: pageNum, query });
          newGames = res?.games || [];
        } else if (window.api && window.api.fetchSource3Page) {
          newGames = await window.api.fetchSource3Page({ page: pageNum, search: query });
        }
      } else if (source === 'steamrip' && window.api.fetchSteamripPage) {
        newGames = await window.api.fetchSteamripPage({ page: pageNum, search: query });
      } else if (source === 'steamunlocked' && window.api.fetchSteamunlockedPage) {
        newGames = await window.api.fetchSteamunlockedPage({ page: pageNum, search: query });
      } else if (source === 'fitgirl' && window.api.fetchSource3Page) {
        newGames = await window.api.fetchSource3Page({ page: pageNum, search: query });
      } else if (source === 'onlinefix' && (window.api.fetchSource4Page || window.api.fetchOnlinefixPage)) {
        const fetcher = window.api.fetchSource4Page || window.api.fetchOnlinefixPage;
        newGames = await fetcher({ page: pageNum, search: query });
      } else if (source === 'dodi' && (window.api.fetchSource5Page || window.api.fetchDodiPage)) {
        const fetcher = window.api.fetchSource5Page || window.api.fetchDodiPage;
        newGames = await fetcher({ page: pageNum, search: query });
      }

      if (reqId !== currentRequestId.current) {
        return;
      }

      if (!newGames || newGames.length === 0) {
        setHasMore(false);
      }

      if (pageNum === 1) {
        const unique = [];
        const seen = new Set();
        for (const g of (newGames || [])) {
          if (!seen.has(g.id)) {
            seen.add(g.id);
            unique.push(g);
          }
        }
        setGames(unique);
        setPage(1);
      } else {
        setGames(prev => {
          const existingIds = new Set(prev.map(g => g.id));
          const filtered = (newGames || []).filter(g => !existingIds.has(g.id));
          if (filtered.length === 0) {
            setHasMore(false);
          }
          return [...prev, ...filtered];
        });
        setPage(pageNum);
      }
    } catch (e) {
      console.error("Failed to fetch games index:", e);
    } finally {
      if (reqId === currentRequestId.current) {
        setIsSourceLoading(false);
        setIsLoadingMore(false);
        dismissSplash();
      }
    }
  };

  const handleEnrich = (id, meta) => {
    if (!meta) return;
    setGames(prevGames => prevGames.map(game => {
      if (game.id === id) {
        const hasValidCover = game.cover && !game.cover.startsWith('data:') && !game.cover.includes('blank.gif');
        return {
          ...game,
          originalCover: game.originalCover || game.cover,
          cover: hasValidCover ? game.cover : (meta.cover || meta.coverFallback || meta.header || game.cover),
          coverFallback: meta.coverFallback || game.coverFallback,
          header: meta.header || game.header,
          banner: meta.banner || meta.header || game.banner || game.cover,
          description: meta.description || game.description,
          developer: meta.developer || game.developer,
          enriched: true
        };
      }
      return game;
    }));
  };

  const [downloadsList, setDownloadsList] = useState(() => {
    try {
      const saved = localStorage.getItem('charon_downloads');
      return saved ? JSON.parse(saved) : [];
    } catch (e) {
      return [];
    }
  });

  const gamesRef = useRef(games);
  useEffect(() => {
    gamesRef.current = games;
  }, [games]);

  useEffect(() => {
    if (window.api && window.api.onDownloadProgress) {
      const unsub = window.api.onDownloadProgress((data) => {
        setGames(prevGames => prevGames.map(game => {
          if (game.id === data.gameId) {
            return { 
              ...game, 
              progress: data.percent, 
              speed: data.speed, 
              eta: data.eta,
              status: data.status,
              filename: data.filename || game.filename,
              installDir: data.installDir || game.installDir,
              filePath: data.filePath || game.filePath,
              exePath: data.exePath || game.exePath,
              downloaded: data.downloaded || game.downloaded,
              totalSize: data.totalSize || game.totalSize
            };
          }
          return game;
        }));

        setDownloadsList(prev => {
          const idx = prev.findIndex(d => d.id === data.gameId);
          const currentGames = gamesRef.current || [];
          const matchedGame = currentGames.find(g => g.id === data.gameId) || (idx >= 0 ? prev[idx] : null);
          const resolvedSlug = matchedGame?.slug || prev[idx]?.slug || (data.gameId?.startsWith('su-') ? `https://steamunlocked.org/${data.gameId.replace(/^su-/, '')}/` : data.gameId);
          const resolvedSource = matchedGame?.source || prev[idx]?.source || (data.gameId?.startsWith('su-') ? 'steamunlocked' : (data.gameId?.startsWith('of-') ? 'onlinefix' : (data.gameId?.startsWith('dodi-') ? 'dodi' : (data.gameId?.startsWith('fg-') ? 'fitgirl' : 'steamrip'))));
          const item = {
            id: data.gameId,
            title: matchedGame?.title || prev[idx]?.title || data.filename || 'Game Download',
            slug: resolvedSlug,
            source: resolvedSource,
            cover: matchedGame?.cover || prev[idx]?.cover || '',
            banner: matchedGame?.banner || prev[idx]?.banner || '',
            filename: data.filename || matchedGame?.filename || prev[idx]?.filename || '',
            installDir: data.installDir || matchedGame?.installDir || (idx >= 0 ? prev[idx]?.installDir : ''),
            filePath: data.filePath || (idx >= 0 ? prev[idx]?.filePath : ''),
            exePath: data.exePath || (idx >= 0 ? prev[idx]?.exePath : null),
            progress: data.percent,
            speed: data.speed,
            eta: data.eta,
            downloaded: data.downloaded || prev[idx]?.downloaded || '',
            totalSize: data.totalSize || matchedGame?.size || prev[idx]?.totalSize || '',
            status: data.status,
            completedAt: data.status === 'completed' ? (prev[idx]?.completedAt || new Date().toLocaleDateString()) : undefined
          };

          let next;
          if (idx >= 0) {
            next = [...prev];
            next[idx] = { ...next[idx], ...item };
          } else {
            next = [item, ...prev];
          }

          try {
            localStorage.setItem('charon_downloads', JSON.stringify(next.filter(d => d.status === 'completed')));
          } catch (e) {}

          return next;
        });
      });
      return unsub;
    }
  }, []);

  const handleStartDownload = (game, installDir) => {
    const defaultD = localStorage.getItem('charon_default_drive') || 'C:';
    const targetDir = installDir || `${defaultD}\\Charon Games`;

    const originalGame = games.find(g => g.id === game.id);
    const resolvedSlug = originalGame?.slug || game.slug || (game.id ? (game.id.startsWith('su-') ? `https://steamunlocked.org/${game.id.replace(/^su-/, '')}/` : game.id) : '');
    const resolvedSource = originalGame?.source || game.source || (game.id?.startsWith('su-') ? 'steamunlocked' : (game.id?.startsWith('of-') ? 'onlinefix' : (game.id?.startsWith('dodi-') ? 'dodi' : (game.id?.startsWith('fg-') ? 'fitgirl' : 'steamrip'))));
    const resolvedTitle = originalGame?.title || game.title || 'Game Download';
    const resolvedCover = originalGame?.cover || game.cover || '';
    const resolvedBanner = originalGame?.banner || game.banner || resolvedCover;
    const resolvedSize = originalGame?.size || game.totalSize || game.size || 'Unknown';

    const initDownload = {
      status: 'downloading',
      progress: 0,
      speed: 'Connecting...',
      eta: 'Calculating...',
      installDir: targetDir
    };

    const gameToDownload = {
      ...game,
      ...(originalGame || {}),
      id: game.id,
      title: resolvedTitle,
      slug: resolvedSlug,
      source: resolvedSource,
      cover: resolvedCover,
      banner: resolvedBanner,
      size: resolvedSize,
      installDir: targetDir,
      uris: (game.uris && game.uris.length > 0) ? game.uris : (originalGame?.uris || [])
    };

    setGames(prev => prev.map(g => g.id === game.id ? { ...g, ...initDownload } : g));
    setDownloadsList(prev => {
      const idx = prev.findIndex(d => d.id === game.id);
      const item = {
        id: game.id,
        title: resolvedTitle,
        slug: resolvedSlug,
        source: resolvedSource,
        cover: resolvedCover,
        banner: resolvedBanner,
        filename: prev[idx]?.filename || game.filename || '',
        installDir: targetDir,
        progress: 0,
        speed: 'Connecting...',
        eta: 'Calculating...',
        downloaded: '0 MB',
        totalSize: resolvedSize,
        status: 'downloading'
      };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], ...item };
        return copy;
      }
      return [item, ...prev];
    });

    window.api?.startDownload(gameToDownload);
  };

  const handleRetryDownload = (item) => {
    if (!item || !item.id) return;
    const defaultD = localStorage.getItem('charon_default_drive') || 'C:';
    const targetDir = item.installDir || `${defaultD}\\Charon Games`;

    const originalGame = games.find(g => g.id === item.id);
    const resolvedSlug = originalGame?.slug || item.slug || (item.id.startsWith('su-') ? `https://steamunlocked.org/${item.id.replace(/^su-/, '')}/` : item.id);
    const resolvedSource = originalGame?.source || item.source || (item.id.startsWith('su-') ? 'steamunlocked' : (item.id.startsWith('of-') ? 'onlinefix' : (item.id.startsWith('dodi-') ? 'dodi' : (item.id.startsWith('fg-') ? 'fitgirl' : 'steamrip'))));
    const resolvedTitle = originalGame?.title || item.title || 'Game Download';
    const resolvedCover = originalGame?.cover || item.cover || '';
    const resolvedBanner = originalGame?.banner || item.banner || resolvedCover;
    const resolvedSize = originalGame?.size || item.totalSize || item.size || 'Unknown';

    const retryState = {
      status: 'downloading',
      progress: 0,
      speed: 'Connecting...',
      eta: 'Reconnecting...',
      installDir: targetDir
    };

    setGames(prev => prev.map(g => g.id === item.id ? { ...g, ...retryState } : g));
    setDownloadsList(prev => {
      const idx = prev.findIndex(d => d.id === item.id);
      const updated = {
        ...item,
        title: resolvedTitle,
        slug: resolvedSlug,
        source: resolvedSource,
        cover: resolvedCover,
        banner: resolvedBanner,
        installDir: targetDir,
        progress: 0,
        speed: 'Connecting...',
        eta: 'Reconnecting...',
        downloaded: '0 MB',
        totalSize: resolvedSize,
        status: 'downloading'
      };
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = updated;
        return copy;
      }
      return [updated, ...prev];
    });

    const gameToDownload = {
      ...(originalGame || {}),
      ...item,
      id: item.id,
      title: resolvedTitle,
      slug: resolvedSlug,
      source: resolvedSource,
      cover: resolvedCover,
      banner: resolvedBanner,
      size: resolvedSize,
      installDir: targetDir,
      uris: (item.uris && item.uris.length > 0) ? item.uris : (originalGame?.uris || [])
    };

    console.log('[Frontend] Retrying download for:', gameToDownload);
    window.api?.startDownload(gameToDownload);
  };

  const handleCancelDownload = (gameId) => {
    window.api?.cancelDownload(gameId);
    setGames(prev => prev.map(g => g.id === gameId ? { ...g, status: 'cancelled', speed: '', eta: '', progress: 0 } : g));
    setDownloadsList(prev => prev.filter(d => d.id !== gameId));
  };

  const verifyDiskFiles = async () => {
    if (!window.api || !window.api.checkFilesExist) return;
    const completed = downloadsList.filter(d => d.status === 'completed');
    if (completed.length === 0) return;

    try {
      const results = await window.api.checkFilesExist(completed);
      let changed = false;
      const updatedList = [];
      for (const item of downloadsList) {
        if (item.status !== 'completed') {
          updatedList.push(item);
          continue;
        }
        const check = results[item.id];
        if (check && !check.exists) {
          changed = true;
          continue;
        }
        let itemUpdated = false;
        const newItem = { ...item };
        if (check && check.sizeFormatted && check.sizeFormatted !== item.totalSize) {
          newItem.totalSize = check.sizeFormatted;
          itemUpdated = true;
        }
        if (check && check.path && check.path !== item.filePath) {
          newItem.filePath = check.path;
          itemUpdated = true;
        }
        if (check && check.exePath && check.exePath !== item.exePath) {
          newItem.exePath = check.exePath;
          itemUpdated = true;
        }
        if (itemUpdated) changed = true;
        updatedList.push(newItem);
      }

      if (changed) {
        setDownloadsList(updatedList);
        try {
          localStorage.setItem('charon_downloads', JSON.stringify(updatedList));
        } catch (e) {}

        const remainingIds = new Set(updatedList.map(d => d.id));
        setGames(prev => prev.map(g => {
          if (g.progress === 100 && !remainingIds.has(g.id)) {
            return { ...g, progress: 0, status: null, filename: null, speed: '', eta: '' };
          }
          const matched = updatedList.find(d => d.id === g.id);
          if (matched && (matched.exePath !== g.exePath || matched.filePath !== g.filePath)) {
            return { ...g, exePath: matched.exePath, filePath: matched.filePath, totalSize: matched.totalSize };
          }
          return g;
        }));
      }
    } catch (err) {
      console.warn('[Auto-Tracker] Integrity check error:', err);
    }
  };

  useEffect(() => {
    verifyDiskFiles();
    const interval = setInterval(verifyDiskFiles, 3000);
    window.addEventListener('focus', verifyDiskFiles);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', verifyDiskFiles);
    };
  }, [downloadsList]);

  const handleDeleteDownloadedGame = async (game, deleteFromDisk) => {
    if (!game) return;
    try {
      if (window.api && window.api.deleteDownloadedGame) {
        await window.api.deleteDownloadedGame({
          id: game.id,
          filename: game.filename,
          installDir: game.installDir,
          filePath: game.filePath,
          deleteFromDisk
        });
      }

      setDownloadsList(prev => {
        const next = prev.filter(d => d.id !== game.id);
        try {
          localStorage.setItem('charon_downloads', JSON.stringify(next.filter(d => d.status === 'completed')));
        } catch (e) {}
        return next;
      });

      setGames(prev => prev.map(g => {
        if (g.id === game.id) {
          return {
            ...g,
            progress: 0,
            status: null,
            filename: null,
            speed: '',
            eta: ''
          };
        }
        return g;
      }));
    } catch (err) {
      console.error('Failed to delete game:', err);
    }
  };

  const handleClearCompleted = () => {
    setDownloadsList(prev => {
      const activeOnly = prev.filter(d => d.status === 'downloading' || d.status === 'extracting' || (d.progress > 0 && d.progress < 100 && d.status !== 'completed'));
      try {
        localStorage.setItem('charon_downloads', JSON.stringify([]));
      } catch (e) {}
      return activeOnly;
    });
  };

  const installedGames = React.useMemo(() => {
    const list = [];
    const seenIds = new Set();
    const seenTitles = new Set();

    // 1. Completed downloads from downloadsList
    for (const d of downloadsList) {
      if (d.status === 'completed' || d.progress === 100) {
        const custom = getCustomArtworkForGame(d, customArtworkMap);
        list.push({
          id: d.id,
          title: d.title || d.filename || 'Game',
          slug: d.slug,
          source: d.source || 'Installed',
          cover: custom?.grid || d.cover,
          originalCover: d.originalCover,
          coverFallback: d.coverFallback,
          header: custom?.hero || d.header,
          banner: custom?.hero || d.banner,
          logo: custom?.logo || d.logo,
          icon: custom?.icon || d.icon,
          customArtwork: custom,
          downloaded: d.downloaded,
          totalSize: d.totalSize || d.size || 'Installed',
          size: d.size || d.totalSize || 'Installed',
          status: 'completed',
          progress: 100,
          filePath: d.filePath,
          exePath: d.exePath,
          installDir: d.installDir,
          filename: d.filename,
          date: d.date || null,
          metadata: d.metadata || null
        });
        if (d.id) seenIds.add(d.id);
        if (d.title) seenTitles.add(d.title.toLowerCase().trim());
      }
    }

    // 2. Playtime entries that might be tracked standalone
    for (const [key, pData] of Object.entries(playtimeMap || {})) {
      const title = pData?.title || key;
      if (title && !seenIds.has(key) && !seenTitles.has(title.toLowerCase().trim())) {
        const custom = getCustomArtworkForGame({ id: key, title }, customArtworkMap);
        list.push({
          id: key,
          title: title,
          slug: null,
          source: 'local',
          cover: custom?.grid || null,
          header: custom?.hero || null,
          banner: custom?.hero || null,
          logo: custom?.logo || null,
          icon: custom?.icon || null,
          customArtwork: custom,
          totalSize: 'Installed',
          size: 'Installed',
          status: 'completed',
          progress: 100,
          filePath: pData?.executablePath || null,
          exePath: pData?.executablePath || null,
          installDir: null,
          date: pData?.lastPlayed ? new Date(pData.lastPlayed).toLocaleDateString() : null
        });
        seenIds.add(key);
        seenTitles.add(title.toLowerCase().trim());
      }
    }

    return list;
  }, [downloadsList, playtimeMap, customArtworkMap]);

  const handleAddLocalGame = async () => {
    if (!window.api?.selectGameExe) return;
    try {
      const game = await window.api.selectGameExe();
      if (game) {
        setDownloadsList(prev => {
          const exists = prev.some(d => (d.exePath && d.exePath.toLowerCase() === game.exePath.toLowerCase()) || 
            (d.title && d.title.toLowerCase() === game.title.toLowerCase()));
          if (exists) {
            showToast(`"${game.title}" is already in your library.`);
            return prev;
          }
          const updated = [game, ...prev];
          try {
            localStorage.setItem('charon_downloads', JSON.stringify(updated));
          } catch (e) {}
          showToast(`Added "${game.title}" to Library!`);
          return updated;
        });
        if (window.api?.fetchMetadata) {
          window.api.fetchMetadata(game.cleanTitle || game.title).then(meta => {
            if (meta) {
              setDownloadsList(prev => prev.map(item => {
                if (item.id === game.id) {
                  return {
                    ...item,
                    cover: meta.cover || meta.coverFallback || meta.header,
                    header: meta.header,
                    banner: meta.banner || meta.header,
                    metadata: meta
                  };
                }
                return item;
              }));
            }
          }).catch(() => {});
        }
      }
    } catch (err) {
      console.warn('Failed to add local game:', err);
    }
  };

  const rawSelectedGame = games.find(g => g.id === selectedGameId) || installedGames.find(g => g.id === selectedGameId);
  const selectedGame = React.useMemo(() => {
    if (!rawSelectedGame) return null;
    const custom = getCustomArtworkForGame(rawSelectedGame, customArtworkMap);
    if (!custom) return rawSelectedGame;
    return {
      ...rawSelectedGame,
      cover: custom.grid || rawSelectedGame.cover,
      banner: custom.hero || rawSelectedGame.banner,
      header: custom.hero || rawSelectedGame.header,
      logo: custom.logo || rawSelectedGame.logo,
      icon: custom.icon || rawSelectedGame.icon,
      customArtwork: custom
    };
  }, [rawSelectedGame, customArtworkMap]);
  const activeDownloadsCount = downloadsList.filter(d => d.status !== 'completed').length;

  const addToSearchHistory = (term) => {
    if (!term || !term.trim()) return;
    const clean = term.trim();
    setSearchHistory(prev => {
      const filtered = prev.filter(t => t.toLowerCase() !== clean.toLowerCase());
      const updated = [clean, ...filtered].slice(0, 10);
      try {
        localStorage.setItem('charon_search_history', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const removeFromSearchHistory = (term, e) => {
    e?.stopPropagation();
    setSearchHistory(prev => {
      const updated = prev.filter(t => t !== term);
      try {
        localStorage.setItem('charon_search_history', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const clearSearchHistory = (e) => {
    e?.stopPropagation();
    setSearchHistory([]);
    try {
      localStorage.removeItem('charon_search_history');
    } catch (e) {}
  };

  const handleSearchChange = (val) => {
    setSearchQuery(val);
    setIsSearchDropdownOpen(true);
    setActiveSuggestionIndex(-1);

    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }

    const trimmed = val.trim();
    if (trimmed === '') {
      setInstantSuggestions([]);
      setIsInstantLoading(false);
      setSelectedGameId(null);
      setActiveTab('store');
      setHasMore(true);
      loadGames(1, '', activeSource);
      return;
    }

    // Instant typeahead suggestion (<15ms pre-indexed search)
    setIsInstantLoading(true);
    if (window.api && window.api.quickSearch) {
      window.api.quickSearch(trimmed, 8).then(results => {
        setInstantSuggestions(results || []);
        setIsInstantLoading(false);
      }).catch(err => {
        console.warn('[QuickSearch] Error:', err);
        setIsInstantLoading(false);
      });
    }

    searchDebounceTimer.current = setTimeout(() => {
      setSelectedGameId(null);
      setActiveTab('store');
      setHasMore(true);
      loadGames(1, trimmed, activeSource);
    }, 400);
  };

  const handleTriggerSearch = (customQuery) => {
    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }
    const queryToUse = customQuery !== undefined ? customQuery : searchQuery;
    const trimmed = queryToUse.trim();
    if (trimmed) {
      addToSearchHistory(trimmed);
    }
    setIsSearchDropdownOpen(false);
    setActiveSuggestionIndex(-1);
    setSelectedGameId(null);
    setActiveTab('store');
    setHasMore(true);
    if (customQuery !== undefined) {
      setSearchQuery(customQuery);
    }
    loadGames(1, trimmed, activeSource);
  };

  const handleSelectSuggestion = (suggestion) => {
    if (!suggestion) return;
    addToSearchHistory(suggestion.title);
    setIsSearchDropdownOpen(false);
    setActiveSuggestionIndex(-1);
    setGames(prev => {
      if (!prev.some(g => g.id === suggestion.id)) {
        return [suggestion, ...prev];
      }
      return prev;
    });
    setSelectedGameId(suggestion.id);
    setActiveTab('store');
  };

  const handleKeyDown = (e) => {
    if (!isSearchDropdownOpen) {
      if (e.key === 'ArrowDown') {
        setIsSearchDropdownOpen(true);
        return;
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (instantSuggestions.length > 0) {
        setActiveSuggestionIndex(prev => (prev + 1) % instantSuggestions.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (instantSuggestions.length > 0) {
        setActiveSuggestionIndex(prev => (prev - 1 + instantSuggestions.length) % instantSuggestions.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < instantSuggestions.length) {
        handleSelectSuggestion(instantSuggestions[activeSuggestionIndex]);
      } else {
        handleTriggerSearch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsSearchDropdownOpen(false);
      setActiveSuggestionIndex(-1);
    }
  };

  const handleClearSearch = () => {
    if (searchDebounceTimer.current) {
      clearTimeout(searchDebounceTimer.current);
    }
    setSearchQuery('');
    setInstantSuggestions([]);
    setIsSearchDropdownOpen(false);
    setActiveSuggestionIndex(-1);
    setSelectedGameId(null);
    setActiveTab('store');
    setHasMore(true);
    loadGames(1, '', activeSource);
  };

  const handleInitiateDownload = async (game) => {
    if (!game) return;
    if (window.api && window.api.getGameRepacks) {
      try {
        const repacks = await window.api.getGameRepacks(game.title, game.id);
        if (repacks && repacks.length > 1) {
          setRepacksModalData({ game, repacks });
          return;
        } else if (repacks && repacks.length === 1) {
          setInstallModalGame({ ...game, ...repacks[0] });
          return;
        }
      } catch (err) {
        console.warn('[Repacks] Error loading repacks:', err);
      }
    }
    setInstallModalGame(game);
  };

  // Global Keyboard Shortcuts (Ctrl+K, /) and Click-Outside Dismissal
  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchDropdownOpen(true);
      } else if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchDropdownOpen(true);
      }
    };

    const handleClickOutside = (e) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target)) {
        setIsSearchDropdownOpen(false);
        setActiveSuggestionIndex(-1);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const storeGamesCount = games ? games.length : 0;

  return (
    <div className="flex h-screen bg-[#0b0d12] text-[#e6edf3] font-sans selection:bg-blue-600/30 overflow-hidden">
      {/* 1. LEFT SIDEBAR: Professional Matte Panel */}
      <aside className="w-60 bg-[#101319] flex flex-col border-r border-white/[0.06] z-30 shrink-0 select-none">
        {/* Brand Header */}
        <div className="pt-4 pb-3 px-5 border-b border-white/[0.05] flex items-center space-x-3 app-drag">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 overflow-hidden shadow-sm">
            <img src={charonLogo} alt="Charon Logo" className="w-full h-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center space-x-1.5 app-no-drag">
              <span className="font-extrabold text-sm tracking-wider text-white">CHARON</span>
              <button
                onClick={handleManualCheckForUpdates}
                disabled={isCheckingUpdate}
                title="Click to check for updates"
                className="group flex items-center space-x-1 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-white/[0.08] hover:bg-blue-600/20 hover:border-blue-500/40 border border-transparent text-slate-300 hover:text-blue-300 transition-all cursor-pointer disabled:opacity-60"
              >
                <span>v{appVersion}</span>
                <RefreshCw className={`w-2 h-2 text-slate-400 group-hover:text-blue-400 ${isCheckingUpdate ? 'animate-spin text-blue-400' : ''}`} />
              </button>
            </div>
            <p className="text-[10px] font-semibold text-slate-400 tracking-wider uppercase truncate">GAME LAUNCHER</p>
          </div>
        </div>

        {/* Navigation items */}
        <nav className="flex-1 px-3 py-4 space-y-1.5">
          <NavItem 
            icon={<Compass className="w-4 h-4" />} 
            label="Store" 
            active={activeTab === 'store' && !selectedGame} 
            onClick={() => { setActiveTab('store'); setSelectedGameId(null); }} 
          />
          <NavItem 
            icon={<Library className="w-4 h-4" />} 
            label="Library" 
            active={activeTab === 'library' && !selectedGame} 
            badge={installedGames.length > 0 ? installedGames.length : null} 
            onClick={() => { setActiveTab('library'); setSelectedGameId(null); }} 
          />
          <NavItem 
            icon={<Download className="w-4 h-4" />} 
            label="Downloads" 
            active={activeTab === 'downloads'} 
            badge={activeDownloadsCount > 0 ? activeDownloadsCount : null} 
            onClick={() => { setActiveTab('downloads'); setSelectedGameId(null); }} 
          />
          <NavItem 
            icon={<Settings className="w-4 h-4" />} 
            label="Settings" 
            active={activeTab === 'settings'} 
            onClick={() => { setActiveTab('settings'); setSelectedGameId(null); }} 
          />
        </nav>

        {/* Sidebar Footer: Storage, Engine Status & Updates */}
        <div className="p-3 border-t border-white/[0.05] bg-[#0c0e14] space-y-2">
          {/* Default Install Directory Card */}
          <div className="p-2.5 rounded-lg bg-[#141822] border border-white/[0.06] flex items-center space-x-2.5">
            <HardDrive className="w-3.5 h-3.5 text-blue-400 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Install Target</p>
              <p className="text-xs font-mono font-semibold text-slate-200 truncate">{defaultDrive}\Charon Games</p>
            </div>
          </div>

          {/* Engine Status indicator */}
          <div className="flex items-center justify-between px-1 text-[11px] text-slate-400">
            <div className="flex items-center space-x-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="font-medium text-slate-300">Aria2 Engine Ready</span>
            </div>
            <span className="text-[10px] font-mono text-slate-500">16x</span>
          </div>

          {/* In-App Auto Updater Button */}
          <button
            onClick={handleManualCheckForUpdates}
            disabled={isCheckingUpdate}
            className="w-full py-1.5 px-2 rounded-lg bg-[#141822] hover:bg-[#1a2130] border border-white/[0.06] hover:border-white/[0.12] flex items-center justify-between text-slate-300 hover:text-white text-[11px] transition-all group cursor-pointer disabled:opacity-60"
          >
            <div className="flex items-center space-x-2">
              <RefreshCw className={`w-3 h-3 text-slate-400 group-hover:text-blue-400 ${isCheckingUpdate ? 'animate-spin text-blue-400' : ''}`} />
              <span className="font-medium">{isCheckingUpdate ? 'Checking for updates...' : 'Check for Updates'}</span>
            </div>
            {updateStatus.status === 'available' ? (
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-400 border border-blue-500/30 animate-pulse">New</span>
            ) : updateStatus.status === 'downloaded' ? (
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">Ready</span>
            ) : (
              <span className="text-[9px] font-mono text-slate-500">v{appVersion}</span>
            )}
          </button>
        </div>
      </aside>

      {/* 2. MAIN CONTENT VIEWPORT */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#0b0d12]">
        {/* Top Header Hub (Frameless Draggable Window Area) */}
        <header className="h-14 bg-[#0e1117] border-b border-white/[0.06] flex items-center justify-between px-6 z-20 shrink-0 app-drag">
          {/* Left / Center: Dynamic tab header */}
          <div className="flex items-center space-x-4 app-no-drag">
            {activeTab === 'store' ? (
              <>
                <div ref={searchContainerRef} className="relative w-84">
                  <button
                    type="button"
                    onClick={() => handleTriggerSearch()}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-blue-400 hover:scale-110 active:scale-95 transition-all cursor-pointer rounded z-10"
                    title="Search games across sources (Enter)"
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                  <input 
                    ref={searchInputRef}
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onFocus={() => setIsSearchDropdownOpen(true)}
                    onKeyDown={handleKeyDown} 
                    type="text" 
                    placeholder={
                      activeSource === 'all' ? 'Search all games & sources (Ctrl+K)...' :
                      activeSource === 'steamrip' ? 'Search SteamRIP...' :
                      activeSource === 'steamunlocked' ? 'Search SteamUnlocked...' :
                      activeSource === 'fitgirl' ? 'Search FitGirl Repacks...' :
                      activeSource === 'dodi' ? 'Search Dodi Repacks...' :
                      'Search OnlineFix Multiplayer...'
                    } 
                    className="w-full bg-[#151922] border border-white/[0.08] focus:border-blue-500/80 focus:bg-[#1a1f2b] rounded-lg py-1.5 pl-9 pr-14 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none transition-all shadow-inner"
                  />
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center space-x-1.5 z-10">
                    {isInstantLoading ? (
                      <div className="w-3 h-3 border-2 border-blue-400/30 border-t-blue-400 rounded-full animate-spin" />
                    ) : searchQuery ? (
                      <button 
                        onClick={handleClearSearch}
                        className="text-slate-400 hover:text-white p-0.5 rounded transition-colors cursor-pointer"
                        title="Clear search (Esc)"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <kbd className="hidden sm:inline-block px-1.5 py-0.5 text-[9px] font-mono font-bold bg-white/[0.06] border border-white/[0.08] text-slate-400 rounded pointer-events-none">
                        Ctrl+K
                      </kbd>
                    )}
                  </div>

                  {/* Instant Search Dropdown */}
                  <SearchDropdown 
                    isOpen={isSearchDropdownOpen}
                    query={searchQuery}
                    suggestions={instantSuggestions}
                    isLoading={isInstantLoading}
                    history={searchHistory}
                    activeIndex={activeSuggestionIndex}
                    onSelectSuggestion={handleSelectSuggestion}
                    onSelectTag={(tag) => {
                      setSearchQuery(tag);
                      handleTriggerSearch(tag);
                    }}
                    onRemoveHistory={removeFromSearchHistory}
                    onClearHistory={clearSearchHistory}
                    onSearchAll={(term) => handleTriggerSearch(term)}
                  />
                </div>

                {/* Source Segmented Control */}
                <div className="inline-flex bg-[#151922] p-0.5 rounded-lg border border-white/[0.08]">
                  <button 
                    onClick={() => {
                      if (activeSource !== 'all') {
                        setSelectedGameId(null);
                        setActiveSource('all');
                        setHasMore(true);
                        loadGames(1, searchQuery, 'all');
                      }
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      activeSource === 'all' 
                        ? 'bg-[#2563eb] text-white shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    All Sources
                  </button>
                  <button 
                    onClick={() => {
                      if (activeSource !== 'steamrip') {
                        setSelectedGameId(null);
                        setActiveSource('steamrip');
                        setHasMore(true);
                        loadGames(1, searchQuery, 'steamrip');
                      }
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      activeSource === 'steamrip' 
                        ? 'bg-[#2563eb] text-white shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    SteamRIP
                  </button>
                  <button 
                    onClick={() => {
                      if (activeSource !== 'steamunlocked') {
                        setSelectedGameId(null);
                        setActiveSource('steamunlocked');
                        setHasMore(true);
                        loadGames(1, searchQuery, 'steamunlocked');
                      }
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      activeSource === 'steamunlocked' 
                        ? 'bg-[#2563eb] text-white shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    SteamUnlocked
                  </button>
                  <button 
                    onClick={() => {
                      if (activeSource !== 'fitgirl') {
                        setSelectedGameId(null);
                        setActiveSource('fitgirl');
                        setHasMore(true);
                        loadGames(1, searchQuery, 'fitgirl');
                      }
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      activeSource === 'fitgirl' 
                        ? 'bg-[#2563eb] text-white shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    FitGirl
                  </button>
                  <button 
                    onClick={() => {
                      if (activeSource !== 'onlinefix') {
                        setSelectedGameId(null);
                        setActiveSource('onlinefix');
                        setHasMore(true);
                        loadGames(1, searchQuery, 'onlinefix');
                      }
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      activeSource === 'onlinefix' 
                        ? 'bg-[#2563eb] text-white shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    OnlineFix
                  </button>
                  <button 
                    onClick={() => {
                      if (activeSource !== 'dodi') {
                        setSelectedGameId(null);
                        setActiveSource('dodi');
                        setHasMore(true);
                        loadGames(1, searchQuery, 'dodi');
                      }
                    }}
                    className={`px-3 py-1 rounded-md text-xs font-semibold transition-all cursor-pointer ${
                      activeSource === 'dodi' 
                        ? 'bg-[#2563eb] text-white shadow-sm' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Dodi
                  </button>
                </div>
              </>
            ) : activeTab === 'library' ? (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
                    <Library className="w-4 h-4 text-blue-400" />
                  </div>
                  <span className="text-sm font-bold text-white tracking-tight">My Library</span>
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-white/[0.05] border border-white/[0.08] text-slate-300">
                  {installedGames.length} {installedGames.length === 1 ? 'game' : 'games'} installed
                </span>
                <button
                  onClick={handleAddLocalGame}
                  className="flex items-center space-x-1.5 px-3 py-1 bg-[#151922] hover:bg-[#1d2330] border border-white/[0.08] hover:border-blue-500/40 text-slate-300 hover:text-white text-xs font-semibold rounded-lg transition-all cursor-pointer shadow-sm ml-2"
                  title="Add any executable or game installed on your PC"
                >
                  <Plus className="w-3.5 h-3.5 text-blue-400" />
                  <span>Add Game (.exe)</span>
                </button>
                <button
                  onClick={() => { setActiveTab('store'); setSelectedGameId(null); }}
                  className="flex items-center space-x-1.5 px-3 py-1 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold rounded-lg transition-all cursor-pointer shadow-md shadow-blue-500/20"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>Browse Store</span>
                </button>
              </div>
            ) : activeTab === 'downloads' ? (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                    <Download className="w-4 h-4 text-emerald-400" />
                  </div>
                  <span className="text-sm font-bold text-white tracking-tight">Downloads Hub</span>
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-400 font-mono">
                  16x Parallel Engine
                </span>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <div className="w-7 h-7 rounded-lg bg-slate-500/10 border border-slate-500/20 flex items-center justify-center">
                    <Settings className="w-4 h-4 text-slate-300" />
                  </div>
                  <span className="text-sm font-bold text-white tracking-tight">Launcher Settings</span>
                </div>
              </div>
            )}
          </div>

          {/* Spacer for native Windows window controls (minimize/maximize/close) */}
          <div className="w-36 shrink-0 pointer-events-none" />
        </header>

        {/* 2.5 STEAM-STYLE AUTO-UPDATE NOTIFICATION BANNER */}
        {updateStatus.status === 'available' && !updateBannerDismissed && (
          <div className="bg-gradient-to-r from-blue-950/80 via-[#10192e] to-indigo-950/80 border-b border-blue-500/30 px-6 py-2.5 flex items-center justify-between text-xs z-10 shrink-0">
            <div className="flex items-center space-x-2.5 min-w-0 mr-3">
              <Sparkles className="w-4 h-4 text-blue-400 animate-pulse shrink-0" />
              <div className="truncate">
                <span className="font-bold text-white">Charon Launcher v{updateStatus.version} is now available!</span>
                <span className="text-slate-400 ml-2 hidden sm:inline text-[11px]">Differential setup update with new features and stability upgrades.</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button 
                onClick={() => setShowChangelogModal(true)}
                className="px-2.5 py-1 bg-white/[0.08] hover:bg-white/[0.14] text-slate-200 hover:text-white rounded-md text-[11px] font-semibold transition cursor-pointer"
              >
                What's New
              </button>
              <button 
                onClick={handleStartDownloadUpdate}
                className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-md text-[11px] font-bold transition flex items-center space-x-1 shadow-sm active:scale-95 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Update Now</span>
              </button>
              <button 
                onClick={() => setUpdateBannerDismissed(true)}
                className="text-slate-400 hover:text-white p-1 rounded transition cursor-pointer"
                title="Dismiss banner"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {updateStatus.status === 'downloading' && (
          <div className="bg-[#0f172a] border-b border-blue-500/40 px-6 py-2 flex items-center justify-between text-xs z-10 shrink-0">
            <div className="flex items-center space-x-3 min-w-0 mr-4">
              <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin shrink-0" />
              <div className="flex items-center space-x-2 truncate">
                <span className="font-bold text-white">Downloading Charon v{updateStatus.version}...</span>
                <span className="font-mono text-blue-400 font-bold">{updateStatus.percent}%</span>
                {updateStatus.speed && (
                  <span className="text-slate-400 text-[11px] font-mono hidden sm:inline">({updateStatus.speed})</span>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-3 shrink-0">
              <div className="w-32 sm:w-44 h-2 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-300 rounded-full"
                  style={{ width: `${updateStatus.percent}%` }}
                />
              </div>
              <span className="text-[10px] text-slate-400 font-medium hidden md:inline">Background update</span>
            </div>
          </div>
        )}

        {updateStatus.status === 'downloaded' && !updateBannerDismissed && (
          <div className="bg-gradient-to-r from-emerald-950/80 via-[#0d1f18] to-teal-950/80 border-b border-emerald-500/40 px-6 py-2.5 flex items-center justify-between text-xs z-10 shrink-0">
            <div className="flex items-center space-x-2.5 min-w-0 mr-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="truncate">
                <span className="font-bold text-white">Charon Launcher v{updateStatus.version} is verified and ready!</span>
                <span className="text-slate-400 ml-2 hidden sm:inline text-[11px]">Restart now to instantly apply the new update.</span>
              </div>
            </div>
            <div className="flex items-center space-x-2 shrink-0">
              <button 
                onClick={() => setShowChangelogModal(true)}
                className="px-2.5 py-1 bg-white/[0.08] hover:bg-white/[0.14] text-slate-200 hover:text-white rounded-md text-[11px] font-semibold transition cursor-pointer"
              >
                Changelog
              </button>
              <button 
                onClick={handleRestartAndApply}
                className="px-3.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md text-[11px] font-bold transition flex items-center space-x-1.5 shadow-md active:scale-95 cursor-pointer"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Restart & Apply</span>
              </button>
              <button 
                onClick={() => setUpdateBannerDismissed(true)}
                className="text-slate-400 hover:text-white p-1 rounded transition cursor-pointer"
                title="Dismiss banner"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Content Body */}
        <main className="flex-1 overflow-y-auto app-no-drag relative">
          {selectedGame ? (
            <GameDetailsPage 
              game={selectedGame} 
              onBack={() => setSelectedGameId(null)} 
              onDownload={() => handleInitiateDownload(selectedGame)} 
              onOpenRepacks={(game) => handleInitiateDownload(game || selectedGame)}
              onCancelDownload={() => handleCancelDownload(selectedGame.id)}
              onEnrich={handleEnrich}
              playtime={playtimeMap[selectedGame.id] || playtimeMap[selectedGame.title]}
              runningGame={runningGames.find(r => r.gameKey === selectedGame.id || r.gameKey === selectedGame.title)}
              onOpenSaveBackups={(game) => setSaveBackupGame(game)}
              onOpenArtworkPicker={(game) => setArtworkPickerGame(game || selectedGame)}
              onOpenExeSettings={(game) => setExeSettingsGame(game || selectedGame)}
              onShowToast={(msg) => showToast(msg)}
            />
          ) : activeTab === 'settings' ? (
            <SettingsPage 
              onNotification={(msg) => showToast(msg)}
            />
          ) : activeTab === 'downloads' ? (
            <DownloadsPage 
              downloads={downloadsList} 
              onCancel={handleCancelDownload}
              onRetry={handleRetryDownload}
              onOpenFolder={(folderPath) => {
                const def = localStorage.getItem('charon_default_drive') || 'C:';
                window.api?.openDownloadsFolder(folderPath || `${def}\\Charon Games`);
              }}
              onOpenFile={(opts) => window.api?.openFileLocation(opts)}
              onOpenOrRun={(item) => window.api?.openOrRunGame(item)}
              onDeleteGame={(item) => setDeleteTargetGame(item)}
              onClearCompleted={handleClearCompleted}
              onVerifyDisk={verifyDiskFiles}
              onSelectGame={(gameId) => {
                setSelectedGameId(gameId);
              }}
              onExploreLibrary={() => {
                setActiveTab('store');
                setSelectedGameId(null);
              }}
            />
          ) : activeTab === 'library' ? (
            <LibraryPage 
              games={installedGames}
              playtimeMap={playtimeMap}
              runningGames={runningGames}
              onOpenOrRun={(game) => window.api?.openOrRunGame(game)}
              onOpenFile={(opts) => window.api?.openFileLocation(opts)}
              onOpenFolder={(folderPath) => {
                const def = localStorage.getItem('charon_default_drive') || 'C:';
                window.api?.openDownloadsFolder(folderPath || `${def}\\Charon Games`);
              }}
              onDeleteGame={(game) => setDeleteTargetGame(game)}
              onSelectGame={(gameId) => {
                setSelectedGameId(gameId);
              }}
              onExploreStore={() => {
                setActiveTab('store');
                setSelectedGameId(null);
              }}
              onAddLocalGame={handleAddLocalGame}
              onVerifyDisk={verifyDiskFiles}
              onEnrich={handleEnrich}
              onOpenSaveBackups={(game) => setSaveBackupGame(game)}
              onOpenArtworkPicker={(game) => setArtworkPickerGame(game)}
              onOpenExeSettings={(game) => setExeSettingsGame(game)}
              onShowToast={(msg) => showToast(msg)}
            />
          ) : (
            <div className="p-6 max-w-7xl mx-auto space-y-6">
              {/* Header Title & Subtitle */}
              <div className="flex items-center justify-between border-b border-white/[0.05] pb-4">
                <div>
                  <h2 className="text-xl font-bold tracking-tight text-white">
                    {searchQuery ? `Search Results: "${searchQuery}"` : (
                      activeSource === 'all' ? 'Unified Catalog (All Sources)' : 
                      activeSource === 'steamrip' ? 'SteamRIP Catalog' : 
                      activeSource === 'steamunlocked' ? 'SteamUnlocked Catalog' : 
                      activeSource === 'fitgirl' ? 'FitGirl Repacks Catalog' :
                      activeSource === 'dodi' ? 'DODI Repacks Catalog' :
                      'OnlineFix Multiplayer Repacks Catalog'
                    )}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {searchQuery ? `Showing matched releases across all indexed providers` :
                     activeSource === 'all' ? 'Browse all verified pre-installed, repacked, and multiplayer titles' :
                     activeSource === 'steamrip' ? 'Browse pre-installed releases directly extracted from Steam' :
                     activeSource === 'steamunlocked' ? 'Browse pre-installed and updated releases from SteamUnlocked' :
                     activeSource === 'fitgirl' ? 'Browse verified ultra-compressed repacks by FitGirl' :
                     activeSource === 'dodi' ? 'Browse verified compressed repacks and releases by DODI' :
                     'Browse online multiplayer repacks and fixes powered by OnlineFix'}
                  </p>
                </div>

                {/* Source Filter Tabs */}
                <div className="flex items-center bg-[#141822] p-1 rounded-xl border border-white/[0.08] shadow-inner">
                  <button 
                    onClick={() => setActiveSource('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeSource === 'all' ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    All ({storeGamesCount.toLocaleString()})
                  </button>
                  <button 
                    onClick={() => setActiveSource('steamrip')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeSource === 'steamrip' ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    SteamRIP
                  </button>
                  <button 
                    onClick={() => setActiveSource('steamunlocked')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeSource === 'steamunlocked' ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    SteamUnlocked
                  </button>
                  <button 
                    onClick={() => setActiveSource('fitgirl')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeSource === 'fitgirl' ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    FitGirl
                  </button>
                  <button 
                    onClick={() => setActiveSource('dodi')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeSource === 'dodi' ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Dodi
                  </button>
                  <button 
                    onClick={() => setActiveSource('onlinefix')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${activeSource === 'onlinefix' ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    OnlineFix
                  </button>
                </div>
              </div>

              {/* Instant Search Bar */}
              <div className="relative">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onFocus={() => {
                      if (searchQuery.trim().length >= 2 || searchHistory.length > 0) {
                        setIsSearchDropdownOpen(true);
                      }
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Search thousands of verified games across all sources..."
                    className="w-full bg-[#121620] border border-white/[0.08] focus:border-blue-500 rounded-xl pl-10 pr-10 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none transition-all shadow-sm"
                  />
                  {searchQuery && (
                    <button
                      onClick={handleClearSearch}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Games Grid or Loading State */}
              {isSourceLoading ? (
                <div className="flex flex-col items-center justify-center py-28 space-y-4">
                  <div className="w-8 h-8 border-2 border-white/[0.1] border-t-blue-500 rounded-full animate-spin" />
                  <span className="text-xs font-semibold text-slate-400 tracking-wider">Synchronizing repository index...</span>
                </div>
              ) : games.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
                  <Library className="w-10 h-10 text-slate-600" />
                  <p className="text-sm font-semibold text-slate-400">No games found.</p>
                  {searchQuery && (
                    <button 
                      onClick={handleClearSearch}
                      className="px-4 py-1.5 bg-[#151922] hover:bg-[#1c212d] border border-white/[0.08] text-xs font-semibold text-slate-200 rounded-lg transition-all cursor-pointer"
                    >
                      Clear Search Filter
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                  {games.map(game => (
                    <GameCard 
                      key={game.id} 
                      game={game} 
                      onClick={() => setSelectedGameId(game.id)} 
                      onEnrich={handleEnrich}
                      playtime={playtimeMap[game.id] || playtimeMap[game.title]}
                      isRunning={runningGames.some(r => r.gameKey === game.id || r.gameKey === game.title)}
                    />
                  ))}
                </div>
              )}

              {/* Pagination / Load More Footer */}
              <div className="flex flex-col items-center justify-center pt-4 pb-12">
                {games.length > 0 && hasMore && (
                  <button 
                    onClick={() => loadGames(page + 1, searchQuery, activeSource)}
                    disabled={isLoadingMore}
                    className="px-6 py-2.5 bg-[#151922] hover:bg-[#1e2330] border border-white/[0.08] hover:border-white/[0.16] text-white font-semibold text-xs rounded-lg transition-all active:scale-[0.98] disabled:opacity-50 flex items-center space-x-2 cursor-pointer"
                  >
                    {isLoadingMore && (
                      <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    )}
                    <span>{isLoadingMore ? 'Loading More Releases...' : 'Load More Games'}</span>
                  </button>
                )}
                {games.length > 0 && !hasMore && (
                  <span className="text-xs text-slate-500 font-medium">All available games loaded</span>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Hydra-Style Repacks and Download Sources Modal */}
      <RepacksModal 
        data={repacksModalData}
        isOpen={Boolean(repacksModalData)}
        onClose={() => setRepacksModalData(null)}
        onSelectRepack={(repack) => {
          const baseGame = repacksModalData?.game || {};
          setRepacksModalData(null);
          setInstallModalGame({
            ...baseGame,
            ...repack,
            id: repack.id || baseGame.id,
            title: repack.title || baseGame.title,
            size: repack.size || baseGame.size,
            source: repack.source || baseGame.source,
            uris: repack.uris || baseGame.uris || []
          });
        }}
      />

      {/* Steam-Style Installation Modal */}
      <InstallModal 
        game={installModalGame}
        isOpen={Boolean(installModalGame)}
        onClose={() => setInstallModalGame(null)}
        onConfirm={(targetDir, chosenDrive) => {
          if (chosenDrive) setDefaultDrive(chosenDrive);
          if (installModalGame) {
            handleStartDownload(installModalGame, targetDir);
            setInstallModalGame(null);
          }
        }}
      />

      {/* Deletion Confirmation Modal */}
      <DeleteModal 
        game={deleteTargetGame}
        isOpen={Boolean(deleteTargetGame)}
        onClose={() => setDeleteTargetGame(null)}
        onConfirm={handleDeleteDownloadedGame}
      />

      {/* What's New Changelog Modal */}
      <ChangelogModal 
        isOpen={showChangelogModal}
        onClose={() => setShowChangelogModal(false)}
        version={updateStatus.version || appVersion}
        releaseNotes={updateStatus.releaseNotes}
        status={updateStatus.status}
        onUpdate={handleStartDownloadUpdate}
        onRestart={handleRestartAndApply}
      />

      {/* Save Game Backup & Restore Modal */}
      <SaveBackupModal 
        game={saveBackupGame}
        isOpen={Boolean(saveBackupGame)}
        onClose={() => setSaveBackupGame(null)}
        onShowToast={(msg) => showToast(msg)}
      />

      {/* SteamGridDB & Custom Artwork Picker Modal */}
      <GameArtworkPickerModal 
        game={artworkPickerGame}
        isOpen={Boolean(artworkPickerGame)}
        customArtworkMap={customArtworkMap}
        onClose={() => setArtworkPickerGame(null)}
        onArtworkUpdated={handleArtworkUpdated}
        onShowToast={(msg) => showToast(msg)}
      />

      {/* Executable & Launch Settings Modal */}
      <ExecutableSettingsModal
        game={exeSettingsGame}
        isOpen={Boolean(exeSettingsGame)}
        onClose={() => setExeSettingsGame(null)}
        onShowToast={(msg) => showToast(msg)}
      />

      {/* Real-Time Steam Achievement Unlock Toast */}
      <AchievementToast 
        achievement={achievementToast}
        onClose={() => setAchievementToast(null)}
      />

      {/* Floating Status Notification Toast */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center space-x-2.5 px-4 py-3 bg-[#151a24] border border-blue-500/40 text-slate-100 text-xs rounded-xl shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-bottom-2 duration-200">
          <Sparkles className="w-4 h-4 text-blue-400 shrink-0" />
          <span className="font-medium">{toastMessage}</span>
        </div>
      )}

      {/* 5. PROFESSIONAL STARTUP SPLASH & BUFFERING SCREEN */}
      {appBootState.isMounted && (
        <div 
          className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-[#0b0d12] transition-opacity duration-700 ease-out select-none ${
            appBootState.isInitializing ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
          style={{
            backgroundImage: 'radial-gradient(circle at 50% 42%, rgba(37, 99, 235, 0.15), transparent 70%)'
          }}
        >
          {/* Frameless Top Drag Bar */}
          <div className="absolute top-0 left-0 right-0 h-10 app-drag" />

          {/* Center Brand & Buffering Box */}
          <div className="flex flex-col items-center text-center px-6 relative z-10">
            {/* Glowing App Emblem */}
            <div className="relative mb-5">
              <div className="absolute -inset-4 rounded-full bg-gradient-to-r from-blue-600 via-indigo-500 to-cyan-400 opacity-50 blur-2xl animate-pulse" />
              <div className="relative w-24 h-24 rounded-full flex items-center justify-center filter drop-shadow-[0_0_20px_rgba(56,189,248,0.5)]">
                <img src={charonLogo} alt="Charon Game Launcher" className="w-full h-full object-contain" />
              </div>
            </div>

            {/* Typography */}
            <h1 className="text-xl font-extrabold tracking-widest text-white uppercase font-sans mb-1">
              CHARON GAME LAUNCHER
            </h1>
            <p className="text-xs font-medium text-slate-400 tracking-wider mb-7">
              High-Performance Native Gaming Platform
            </p>

            {/* High-Tech Progress Track */}
            <div className="w-64 h-1.5 rounded-full bg-white/[0.07] border border-white/[0.08] overflow-hidden relative mb-4">
              <div 
                className="absolute top-0 bottom-0 rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-600 transition-all duration-300 ease-out shadow-[0_0_12px_rgba(56,189,248,0.7)]"
                style={{ width: `${Math.min(100, Math.max(10, appBootState.percent))}%` }}
              />
            </div>

            {/* Dynamic Status Label */}
            <div className="flex items-center space-x-2 text-[11px] font-semibold text-slate-300 tracking-wider uppercase font-mono">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
              <span>{appBootState.phaseText}</span>
            </div>
          </div>

          {/* Footer Metadata */}
          <div className="absolute bottom-6 flex items-center space-x-3 text-[10px] font-mono text-slate-500 tracking-widest uppercase">
            <span>v{appVersion}</span>
            <span>•</span>
            <span>7-Zip Multi-Threaded Unpack</span>
            <span>•</span>
            <span>Secure Client</span>
          </div>
        </div>
      )}
    </div>
  );
}

function NavItem({ icon, label, active, badge, onClick }) {
  let cls = "w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-colors ";
  cls += active 
    ? "bg-[#1c2230] text-white font-semibold border border-white/[0.06]" 
    : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200";
  return (
    <button onClick={onClick} className={cls}>
      <div className="flex items-center space-x-2.5 truncate">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      {badge && (
        <span className="px-1.5 py-0.5 rounded-full bg-blue-600 text-[10px] font-bold text-white shrink-0">
          {badge}
        </span>
      )}
    </button>
  );
}

function HighlightText({ text, highlight }) {
  if (!highlight || !highlight.trim() || !text) return <span>{text}</span>;
  const terms = highlight.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return <span>{text}</span>;
  const pattern = terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  if (!pattern) return <span>{text}</span>;
  const regex = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(regex);
  return (
    <span>
      {parts.map((part, i) => 
        regex.test(part) ? (
          <span key={i} className="text-blue-400 font-bold bg-blue-500/20 px-0.5 rounded">{part}</span>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </span>
  );
}

function SearchDropdown({
  isOpen,
  query,
  suggestions,
  isLoading,
  history,
  activeIndex,
  onSelectSuggestion,
  onSelectTag,
  onRemoveHistory,
  onClearHistory,
  onSearchAll
}) {
  if (!isOpen) return null;

  const popularTags = [
    'Cyberpunk 2077',
    'Elden Ring',
    'Grand Theft Auto V',
    'Red Dead Redemption 2',
    'Black Myth: Wukong',
    'God of War',
    'Spider-Man',
    'Baldur\'s Gate 3'
  ];

  const hasQuery = Boolean(query && query.trim());

  return (
    <div className="absolute top-full left-0 mt-1.5 w-[420px] max-w-[90vw] bg-[#121620] border border-white/[0.12] rounded-xl shadow-2xl overflow-hidden z-50 backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-150">
      {hasQuery ? (
        // Live Typeahead Suggestions
        <div className="py-2">
          <div className="px-3 pb-1.5 pt-1 border-b border-white/[0.06] flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-slate-400">
            <span>Instant Results</span>
            {isLoading && (
              <span className="flex items-center space-x-1 text-blue-400 normal-case font-normal font-mono">
                <div className="w-2 h-2 border border-blue-400 border-t-transparent rounded-full animate-spin" />
                <span>Searching...</span>
              </span>
            )}
          </div>

          {suggestions.length === 0 && !isLoading ? (
            <div className="py-6 px-4 text-center">
              <p className="text-xs text-slate-400 font-medium">No instant matches found for "{query}"</p>
              <button
                type="button"
                onClick={() => onSearchAll(query)}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300 font-semibold flex items-center justify-center mx-auto space-x-1"
              >
                <span>Search across all remote catalogs</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto divide-y divide-white/[0.04]">
              {suggestions.map((item, idx) => {
                const isActive = idx === activeIndex;
                const sourceBadgeColor = 
                  item.source === 'onlinefix' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' :
                  item.source === 'fitgirl' ? 'bg-pink-500/20 text-pink-300 border-pink-500/30' :
                  item.source === 'dodi' ? 'bg-purple-500/20 text-purple-300 border-purple-500/30' :
                  item.source === 'steamunlocked' ? 'bg-amber-500/20 text-amber-300 border-amber-500/30' :
                  'bg-blue-500/20 text-blue-300 border-blue-500/30';

                return (
                  <div
                    key={item.id || idx}
                    onClick={() => onSelectSuggestion(item)}
                    className={`px-3 py-2 flex items-center space-x-3 cursor-pointer transition-colors ${
                      isActive ? 'bg-blue-600/20 border-l-2 border-blue-500' : 'hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-9 h-12 rounded bg-[#1a202c] overflow-hidden shrink-0 border border-white/[0.08] relative">
                      {item.cover ? (
                        <img src={item.cover} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900 text-slate-500">
                          <Gamepad2 className="w-4 h-4" />
                        </div>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold text-slate-100 truncate">
                        <HighlightText text={item.title} highlight={query} />
                      </p>
                      <div className="flex items-center space-x-2 mt-1">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.2 rounded border ${sourceBadgeColor}`}>
                          {item.source === 'onlinefix' ? 'OnlineFix' : item.source === 'fitgirl' ? 'FitGirl' : item.source === 'dodi' ? 'DODI' : item.source === 'steamunlocked' ? 'SteamUnlocked' : 'SteamRIP'}
                        </span>
                        {item.size && (
                          <span className="text-[10px] font-mono text-slate-400 truncate">
                            {item.size}
                          </span>
                        )}
                      </div>
                    </div>

                    <ArrowRight className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isActive ? 'translate-x-0.5 text-blue-400' : ''}`} />
                  </div>
                );
              })}
            </div>
          )}

          {/* Full Search Footer Action */}
          <div
            onClick={() => onSearchAll(query)}
            className="mt-1 px-3 py-2 border-t border-white/[0.06] bg-[#161b27] hover:bg-[#1c2233] cursor-pointer flex items-center justify-between text-xs text-blue-400 hover:text-blue-300 font-semibold transition-colors"
          >
            <div className="flex items-center space-x-2">
              <Search className="w-3.5 h-3.5" />
              <span>Search "{query}" across all sources</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400 bg-white/[0.08] px-1.5 py-0.5 rounded">Enter ↵</span>
          </div>
        </div>
      ) : (
        // Default View: Recent History & Trending Tags
        <div className="p-3 space-y-3">
          {/* Recent Searches */}
          {history && history.length > 0 && (
            <div>
              <div className="flex items-center justify-between pb-1.5 text-[10px] uppercase font-bold tracking-wider text-slate-400">
                <span className="flex items-center space-x-1.5">
                  <Clock className="w-3 h-3 text-slate-400" />
                  <span>Recent Searches</span>
                </span>
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="text-slate-500 hover:text-slate-300 text-[10px] transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="space-y-1">
                {history.slice(0, 5).map((term, idx) => (
                  <div
                    key={idx}
                    onClick={() => onSelectTag(term)}
                    className="flex items-center justify-between px-2.5 py-1.5 rounded-lg hover:bg-white/[0.05] text-xs text-slate-200 cursor-pointer group transition-colors"
                  >
                    <div className="flex items-center space-x-2 truncate">
                      <Clock className="w-3 h-3 text-slate-500 group-hover:text-blue-400 transition-colors" />
                      <span className="truncate">{term}</span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => onRemoveHistory(term, e)}
                      className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 p-0.5 rounded transition-all"
                      title="Remove from history"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trending / Recommended Franchises */}
          <div>
            <div className="pb-1.5 text-[10px] uppercase font-bold tracking-wider text-slate-400 flex items-center space-x-1.5">
              <Sparkles className="w-3 h-3 text-amber-400" />
              <span>Trending Searches</span>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {popularTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => onSelectTag(tag)}
                  className="px-2.5 py-1 rounded-md bg-white/[0.05] hover:bg-blue-600/20 hover:border-blue-500/40 border border-white/[0.08] text-slate-300 hover:text-blue-300 text-xs font-medium transition-all cursor-pointer"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-slate-500 font-mono">
            <span>Press <kbd className="px-1 py-0.5 rounded bg-white/[0.08] text-slate-400">Ctrl</kbd>+<kbd className="px-1 py-0.5 rounded bg-white/[0.08] text-slate-400">K</kbd> anytime to search</span>
            <span>Esc to close</span>
          </div>
        </div>
      )}
    </div>
  );
}

function RepacksModal({ data, isOpen, onClose, onSelectRepack }) {
  if (!isOpen || !data) return null;
  const { game, repacks } = data;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-[#121620] border border-white/[0.12] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header with game thumbnail */}
        <div className="p-5 border-b border-white/[0.08] bg-[#161c29] flex items-center justify-between">
          <div className="flex items-center space-x-3.5 min-w-0">
            <div className="w-10 h-14 rounded-lg bg-slate-800 overflow-hidden shrink-0 border border-white/[0.1]">
              {game.cover ? (
                <img src={game.cover} alt="" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-800 text-slate-500">
                  <Gamepad2 className="w-5 h-5" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-400 flex items-center gap-1">
                <Layers className="w-3 h-3" />
                <span>Charon Multi-Source Engine</span>
              </span>
              <h3 className="text-base font-bold text-white truncate">{game.title}</h3>
              <p className="text-xs text-slate-400">Choose your preferred download source or repack version:</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-white/[0.08] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Repack options list */}
        <div className="p-5 overflow-y-auto space-y-3 flex-1">
          {repacks.map((repack, idx) => {
            const isFitgirl = repack.source === 'fitgirl';
            const isOnlinefix = repack.source === 'onlinefix';
            const isDodi = repack.source === 'dodi';
            const isSteamrip = repack.source === 'steamrip';
            const isSteamunlocked = repack.source === 'steamunlocked';

            const badgeBg = isOnlinefix
              ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
              : isFitgirl 
              ? 'bg-pink-500/20 border-pink-500/40 text-pink-300' 
              : isDodi
              ? 'bg-purple-500/20 border-purple-500/40 text-purple-300'
              : isSteamunlocked 
              ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' 
              : 'bg-blue-500/20 border-blue-500/40 text-blue-300';

            const downloadTypeBadge = isOnlinefix
              ? 'Online Co-op / Multiplayer P2P'
              : isFitgirl
              ? 'Torrent Magnet / Selective Repack'
              : isDodi
              ? 'Torrent Magnet / DODI Repack'
              : isSteamrip
              ? 'Direct Fast DDL (16x Multi-Stream Aria2c)'
              : 'Direct Archive Download (Zip)';

            return (
              <div
                key={repack.id || idx}
                className="p-4 rounded-xl bg-[#171d2b] border border-white/[0.08] hover:border-blue-500/50 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 group"
              >
                <div className="space-y-1 min-w-0 flex-1">
                  <div className="flex items-center space-x-2">
                    <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${badgeBg}`}>
                      {repack.sourceName || repack.source || 'Source'}
                    </span>
                    <span className="text-[10px] font-semibold text-slate-400">
                      {downloadTypeBadge}
                    </span>
                  </div>
                  <h4 className="text-sm font-semibold text-white group-hover:text-blue-300 transition-colors truncate">
                    {repack.title}
                  </h4>
                  <div className="flex items-center space-x-3 text-xs text-slate-400 font-mono">
                    <span>Size: <strong className="text-slate-200">{repack.size || 'Pre-installed'}</strong></span>
                    {repack.date && <span>• {repack.date}</span>}
                    {repack.fileType && <span>• {repack.fileType}</span>}
                  </div>
                </div>

                <div className="flex items-center space-x-2 shrink-0 pt-2 sm:pt-0">
                  {(isFitgirl || isOnlinefix) && repack.uris && repack.uris[0] && (
                    <button
                      type="button"
                      onClick={() => window.api?.openMagnetLink?.(repack.uris[0])}
                      className="px-3 py-2 bg-white/[0.06] hover:bg-white/[0.12] text-slate-200 hover:text-white rounded-lg text-xs font-semibold transition-all flex items-center space-x-1.5"
                      title="Open directly in torrent client (qBittorrent, etc.)"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Magnet</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onSelectRepack(repack);
                    }}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all flex items-center space-x-1.5 shadow-md active:scale-95 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-white/[0.08] bg-[#0f131c] flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center space-x-1.5 text-[11px]">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            <span>All repacks verified and automatically extracted via 7-Zip</span>
          </span>
          <button
            onClick={onClose}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

const CARD_PALETTES = [
  { bg: 'from-blue-950 via-[#101524] to-indigo-950', border: 'border-blue-500/30', accent: 'text-blue-400', glow: 'bg-blue-500/15' },
  { bg: 'from-purple-950 via-[#131226] to-violet-950', border: 'border-purple-500/30', accent: 'text-purple-400', glow: 'bg-purple-500/15' },
  { bg: 'from-emerald-950 via-[#0d1c1a] to-teal-950', border: 'border-emerald-500/30', accent: 'text-emerald-400', glow: 'bg-emerald-500/15' },
  { bg: 'from-amber-950 via-[#1c1410] to-red-950', border: 'border-amber-500/30', accent: 'text-amber-400', glow: 'bg-amber-500/15' },
  { bg: 'from-cyan-950 via-[#0e1924] to-blue-950', border: 'border-cyan-500/30', accent: 'text-cyan-400', glow: 'bg-cyan-500/15' },
  { bg: 'from-rose-950 via-[#1c1018] to-pink-950', border: 'border-rose-500/30', accent: 'text-rose-400', glow: 'bg-rose-500/15' },
];

function getCardPalette(title = '') {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash << 5) - hash + title.charCodeAt(i);
    hash |= 0;
  }
  return CARD_PALETTES[Math.abs(hash) % CARD_PALETTES.length];
}

function GameCard({ game, onClick, onEnrich, playtime, isRunning }) {
  const isExtracting = game.status === 'extracting';
  const isDownloading = !isExtracting && ((game.progress > 0 && game.progress < 100) || game.status === 'downloading');
  const isInstalled = !isExtracting && (game.progress === 100 || game.status === 'completed');
  const [imgSrc, setImgSrc] = useState(game.cover || game.coverFallback || game.header || game.banner || '');
  const [imgFailed, setImgFailed] = useState(false);
  const [metaFetchAttempted, setMetaFetchAttempted] = useState(false);

  useEffect(() => {
    setImgSrc(game.cover || game.coverFallback || game.header || game.banner || '');
    setImgFailed(false);
    setMetaFetchAttempted(false);
  }, [game.cover, game.coverFallback, game.header, game.banner]);
  
  useEffect(() => {
    const isMissingCover = !game.cover || game.cover.length === 0 || game.cover.includes('blank.gif') || game.cover.startsWith('data:image');
    if (!game.enriched && isMissingCover && window.api && window.api.fetchMetadata) {
      let mounted = true;
      const searchTitle = game.cleanTitle || game.title;
      window.api.fetchMetadata(searchTitle).then(meta => {
        if (mounted && meta && onEnrich) {
          onEnrich(game.id, meta);
        }
      }).catch(() => {});
      return () => { mounted = false; };
    }
  }, [game.id, game.enriched, game.cover, game.cleanTitle, game.title, onEnrich]);

  const handleImgError = () => {
    if (game.coverFallback && imgSrc !== game.coverFallback) {
      setImgSrc(game.coverFallback);
    } else if (game.header && imgSrc !== game.header) {
      setImgSrc(game.header);
    } else if (game.banner && imgSrc !== game.banner) {
      setImgSrc(game.banner);
    } else if (game.originalCover && imgSrc !== game.originalCover) {
      setImgSrc(game.originalCover);
    } else if (window.api?.fetchMetadata && !metaFetchAttempted) {
      setMetaFetchAttempted(true);
      const searchTitle = game.cleanTitle || game.title;
      window.api.fetchMetadata(searchTitle).then(meta => {
        if (meta?.cover && meta.cover !== imgSrc) {
          setImgSrc(meta.cover);
          if (onEnrich) onEnrich(game.id, meta);
        } else if (meta?.header && meta.header !== imgSrc) {
          setImgSrc(meta.header);
          if (onEnrich) onEnrich(game.id, meta);
        } else if (meta?.coverFallback && meta.coverFallback !== imgSrc) {
          setImgSrc(meta.coverFallback);
          if (onEnrich) onEnrich(game.id, meta);
        } else {
          setImgFailed(true);
        }
      }).catch(() => setImgFailed(true));
    } else {
      setImgFailed(true);
    }
  };

  return (
    <div 
      onClick={onClick} 
      className="group flex flex-col cursor-pointer transition-transform duration-150 hover:-translate-y-1"
    >
      {/* Strict 2:3 Poster Frame */}
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-[#151922] border border-white/[0.08] group-hover:border-blue-500/60 shadow-sm transition-colors">
        {/* Loading skeleton */}
        <div className="absolute inset-0 bg-[#151922]" />

        {/* High-quality Poster Artwork */}
        {imgSrc && !imgFailed && (
          <>
            <img 
              key={imgSrc}
              src={imgSrc} 
              alt="" 
              className="absolute inset-0 w-full h-full object-cover transition-transform duration-200 group-hover:scale-105" 
              onError={handleImgError} 
            />
            {/* Top-left source badge */}
            <div className="absolute top-2 left-2 z-10">
              <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded shadow-sm backdrop-blur-md border ${
                game.source === 'onlinefix' ? 'bg-emerald-950/85 text-emerald-300 border-emerald-500/40' :
                game.source === 'fitgirl' ? 'bg-pink-950/85 text-pink-300 border-pink-500/40' :
                game.source === 'dodi' ? 'bg-purple-950/85 text-purple-300 border-purple-500/40' :
                game.source === 'steamunlocked' ? 'bg-amber-950/85 text-amber-300 border-amber-500/40' :
                'bg-blue-950/85 text-blue-300 border-blue-500/40'
              }`}>
                {game.source === 'onlinefix' ? 'OnlineFix' : game.source === 'fitgirl' ? 'FitGirl' : game.source === 'dodi' ? 'DODI' : game.source === 'steamunlocked' ? 'SteamUnlocked' : 'SteamRIP'}
              </span>
            </div>
          </>
        )}

        {/* Fallback Artwork with dynamic lighting and branding if missing */}
        {(!imgSrc || imgFailed) && (() => {
          const palette = getCardPalette(game.title);
          return (
            <div className={`absolute inset-0 flex flex-col justify-between p-3.5 bg-gradient-to-br ${palette.bg} border border-white/[0.08] relative overflow-hidden select-none`}>
              <div className={`absolute -top-10 -right-10 w-28 h-28 rounded-full blur-2xl ${palette.glow}`} />
              
              {/* Top Row: Source Pill */}
              <div className="relative z-10 flex items-center justify-between">
                <span className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-white/[0.08] backdrop-blur-sm border border-white/[0.08] ${palette.accent}`}>
                  {game.source === 'onlinefix' ? 'OnlineFix' : game.source === 'fitgirl' ? 'FitGirl' : game.source === 'dodi' ? 'DODI' : game.source === 'steamunlocked' ? 'SteamUnlocked' : 'SteamRIP'}
                </span>
                <Gamepad2 className={`w-3.5 h-3.5 ${palette.accent} opacity-75`} />
              </div>

              {/* Middle: Gamepad Emblem & Title */}
              <div className="relative z-10 flex flex-col items-center justify-center my-auto py-2 text-center">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-white/[0.05] border border-white/[0.1] shadow-inner mb-2">
                  <Gamepad2 className={`w-5 h-5 ${palette.accent}`} />
                </div>
                <h4 className="text-[11px] font-bold text-white leading-snug line-clamp-3 px-0.5 drop-shadow-sm">
                  {game.title}
                </h4>
              </div>

              {/* Bottom: Size Tag & Charon Badge */}
              <div className="relative z-10 pt-1.5 border-t border-white/[0.06] flex items-center justify-between text-[10px]">
                <span className="font-mono text-slate-400 text-[10px]">{game.size || 'Pre-installed'}</span>
                <span className="text-[9px] font-semibold text-slate-500 uppercase">CHARON</span>
              </div>
            </div>
          );
        })()}

        {/* Clean Hover Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-3">
          {isInstalled ? (
            <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white shadow-lg">
              <Play className="w-5 h-5 fill-current ml-0.5" />
            </div>
          ) : !isDownloading && !isExtracting && (
            <span className="px-3 py-1.5 bg-[#0b0d12]/90 border border-white/[0.15] text-white text-[11px] font-semibold rounded-md backdrop-blur-sm shadow-md">
              View Details
            </span>
          )}
        </div>

        {/* Extracting State Pill */}
        {isExtracting && (
          <div className="absolute top-2 right-2 flex items-center space-x-1 bg-purple-600/95 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>UNPACKING</span>
          </div>
        )}

        {/* Installed State Pill */}
        {isInstalled && (
          <div className="absolute top-2 right-2 flex items-center space-x-1 bg-emerald-600/95 text-white text-[10px] font-bold px-2 py-0.5 rounded shadow-sm">
            <Check className="w-3 h-3 stroke-[2.5]" />
            <span>INSTALLED</span>
          </div>
        )}

        {/* Extracting State Progress Overlay */}
        {isExtracting && (
          <div className="absolute bottom-0 left-0 right-0 bg-[#0b0d12]/95 border-t border-purple-500/30 p-1.5 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono font-semibold">
              <span className="text-purple-400 flex items-center gap-1">
                <Zap className="w-2.5 h-2.5 text-purple-400" />
                {game.speed || '7-Zip Unpack'}
              </span>
              <span className="text-purple-200">{game.progress || 0}%</span>
            </div>
            <div className="w-full h-1 bg-[#1a202c] rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 rounded-full transition-all duration-200" style={{ width: `${Math.max(game.progress || 0, 2)}%` }} />
            </div>
          </div>
        )}

        {/* Downloading State Progress Overlay */}
        {isDownloading && (
          <div className="absolute bottom-0 left-0 right-0 bg-[#0b0d12]/95 border-t border-white/[0.1] p-1.5 space-y-1">
            <div className="flex items-center justify-between text-[10px] font-mono font-semibold">
              <span className="text-blue-400">{game.speed || 'Downloading'}</span>
              <span className="text-white">{game.progress || 0}%</span>
            </div>
            <div className="w-full h-1 bg-[#1a202c] rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${game.progress || 0}%` }} />
            </div>
          </div>
        )}
        {/* Live Running Indicator Pill */}
        {isRunning ? (
          <div className="absolute top-2 right-2 z-20 flex items-center space-x-1.5 px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[9px] font-extrabold shadow-lg backdrop-blur-md animate-pulse">
            <span className="w-1.5 h-1.5 rounded-full bg-white inline-block animate-ping" />
            <span>PLAYING</span>
          </div>
        ) : playtime?.totalSeconds > 0 ? (
          <div className="absolute top-2 right-2 z-20 flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-black/85 text-slate-200 text-[9px] font-semibold border border-white/10 backdrop-blur-md shadow-md">
            <Clock className="w-2.5 h-2.5 text-blue-400" />
            <span>{formatPlaytime(playtime.totalSeconds)}</span>
          </div>
        ) : null}
      </div>

      {/* Card Info Below Poster */}
      <div className="pt-2 px-0.5">
        <h3 className="text-xs font-semibold text-slate-200 group-hover:text-blue-400 transition-colors truncate" title={game.title}>
          {game.title}
        </h3>
        <div className="flex items-center justify-between text-[11px] text-slate-400 mt-0.5">
          <span className="font-mono">{game.size || 'Pre-installed'}</span>
          <span className={`text-[9px] font-semibold uppercase px-1.5 py-0.2 rounded border ${
            game.source === 'onlinefix' ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' :
            game.source === 'fitgirl' ? 'bg-pink-500/15 text-pink-300 border-pink-500/30' :
            game.source === 'dodi' ? 'bg-purple-500/15 text-purple-300 border-purple-500/30' :
            game.source === 'steamunlocked' ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
            'bg-blue-500/15 text-blue-300 border-blue-500/30'
          }`}>
            {game.source === 'onlinefix' ? 'OnlineFix' : game.source === 'fitgirl' ? 'FitGirl' : game.source === 'dodi' ? 'DODI' : game.source === 'steamunlocked' ? 'SteamUnlocked' : 'SteamRIP'}
          </span>
        </div>
      </div>
    </div>
  );
}

// ==========================================================
// FEATURE 1, 2, 3 & 4 COMPONENTS (HYDRA-PARITY)
// ==========================================================

function GameArtworkPickerModal({ game, isOpen, customArtworkMap = {}, onClose, onArtworkUpdated, onShowToast }) {
  const [assetType, setAssetType] = useState('grid'); // 'grid' | 'hero' | 'logo' | 'icon'
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [customUrlInput, setCustomUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const gameKey = game ? getGameArtworkKey(game) : '';
  const currentOverrides = game ? getCustomArtworkForGame(game, customArtworkMap) : null;

  // Determine active preview URL based on assetType and overrides
  const getActiveAssetUrl = (type) => {
    if (currentOverrides?.[type]) return currentOverrides[type];
    if (type === 'grid') return game?.cover || game?.coverFallback || game?.header || '';
    if (type === 'hero') return game?.banner || game?.header || game?.cover || '';
    if (type === 'logo') return game?.logo || '';
    if (type === 'icon') return game?.icon || '';
    return '';
  };

  const activePreviewUrl = getActiveAssetUrl(assetType);

  // Fetch artwork when modal opens or assetType changes
  useEffect(() => {
    if (isOpen && game?.title && window.api?.getGameArtwork) {
      loadArtwork();
    }
  }, [isOpen, game?.title, game?.id, assetType]);

  const loadArtwork = async () => {
    setIsLoading(true);
    try {
      const res = await window.api.getGameArtwork({
        title: game.title,
        steamAppId: game.steamAppId || game.id,
        exePath: game.exePath,
        assetType
      });
      if (res) {
        setItems(res.items || []);
        setHasApiKey(Boolean(res.hasApiKey));
      }
    } catch (e) {
      console.error('[Artwork] Error loading artwork candidates:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectArtwork = async (itemUrl) => {
    if (!window.api?.saveGameArtwork || !game) return;
    try {
      const res = await window.api.saveGameArtwork({
        gameId: game.id,
        title: game.title,
        assetType,
        url: itemUrl
      });
      if (res?.success) {
        onArtworkUpdated?.(gameKey, assetType, itemUrl);
        onShowToast?.(`Updated ${assetType === 'grid' ? 'Cover' : assetType === 'hero' ? 'Hero Banner' : assetType === 'logo' ? 'Logo' : 'Icon'} for "${game.title}"!`);
      }
    } catch (err) {
      onShowToast?.('Failed to apply artwork: ' + err.message);
    }
  };

  const handleResetArtwork = async () => {
    if (!window.api?.saveGameArtwork || !game) return;
    try {
      const res = await window.api.saveGameArtwork({
        gameId: game.id,
        title: game.title,
        assetType,
        url: null
      });
      if (res?.success) {
        onArtworkUpdated?.(gameKey, assetType, null);
        onShowToast?.(`Reset ${assetType} artwork to default for "${game.title}"`);
      }
    } catch (err) {
      onShowToast?.('Failed to reset artwork: ' + err.message);
    }
  };

  const handleUploadLocalFile = async () => {
    if (!window.api?.selectLocalImageFile || !game) return;
    setIsUploading(true);
    try {
      const result = await window.api.selectLocalImageFile();
      if (!result.canceled && result.filePath) {
        await handleSelectArtwork(result.filePath);
      }
    } catch (err) {
      onShowToast?.('Failed to import image: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleApplyCustomUrl = async (e) => {
    e?.preventDefault();
    if (!customUrlInput.trim()) return;
    const url = customUrlInput.trim();
    await handleSelectArtwork(url);
    setCustomUrlInput('');
    setShowUrlInput(false);
  };

  const handleSaveApiKey = async (e) => {
    e?.preventDefault();
    if (!apiKeyInput.trim() || !window.api?.saveSteamGridDbKey) return;
    setIsSavingKey(true);
    try {
      await window.api.saveSteamGridDbKey(apiKeyInput.trim());
      setHasApiKey(true);
      setShowKeyInput(false);
      setApiKeyInput('');
      onShowToast?.('SteamGridDB API key saved! Refreshing artwork catalog...');
      await loadArtwork();
    } catch (err) {
      onShowToast?.('Failed to save API key: ' + err.message);
    } finally {
      setIsSavingKey(false);
    }
  };

  if (!isOpen || !game) return null;

  const tabs = [
    { id: 'grid', label: 'Cover / Poster', sub: '2:3 Vertical' },
    { id: 'hero', label: 'Hero Banner', sub: '16:9 Landscape' },
    { id: 'logo', label: 'Game Logo', sub: 'Transparent PNG' },
    { id: 'icon', label: 'Square Icon', sub: '1:1 Square' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-[#10141d] border border-white/[0.1] rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-5 border-b border-white/[0.08] flex items-center justify-between bg-[#141824]">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
              <ImageIcon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <h3 className="text-base font-bold text-white truncate">Customize Game Artwork</h3>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-purple-950/70 text-purple-300 border border-purple-500/30">
                  SteamGridDB
                </span>
              </div>
              <p className="text-xs text-slate-400 truncate">{game.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 4 Asset Tabs Navigation */}
        <div className="flex border-b border-white/[0.08] bg-[#0d1017] px-5 gap-2 select-none overflow-x-auto">
          {tabs.map(tab => {
            const active = assetType === tab.id;
            const hasCustom = Boolean(currentOverrides?.[tab.id]);
            return (
              <button
                key={tab.id}
                onClick={() => setAssetType(tab.id)}
                className={`py-3 px-4 border-b-2 font-medium text-xs flex items-center space-x-2 cursor-pointer transition-all whitespace-nowrap ${
                  active 
                    ? 'border-purple-500 text-white font-bold' 
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <span>{tab.label}</span>
                <span className="text-[10px] text-slate-500 font-normal">({tab.sub})</span>
                {hasCustom && (
                  <span className="w-2 h-2 rounded-full bg-purple-400 inline-block shadow-sm" title="Custom override active" />
                )}
              </button>
            );
          })}
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Checkerboard Preview & Action Panel */}
          <div className="p-5 rounded-xl bg-[#141822] border border-white/[0.08] flex flex-col md:flex-row items-center gap-6 shadow-sm">
            {/* Checkerboard Preview Frame */}
            <div className="shrink-0 flex flex-col items-center">
              <div 
                className="relative rounded-xl overflow-hidden border border-white/[0.12] flex items-center justify-center shadow-lg"
                style={{
                  background: 'repeating-conic-gradient(#1e2533 0% 25%, #131722 0% 50%) 50% / 16px 16px',
                  width: assetType === 'grid' ? '140px' : assetType === 'hero' ? '280px' : assetType === 'logo' ? '220px' : '100px',
                  height: assetType === 'grid' ? '210px' : assetType === 'hero' ? '120px' : assetType === 'logo' ? '110px' : '100px'
                }}
              >
                {activePreviewUrl ? (
                  <img 
                    src={activePreviewUrl} 
                    alt="Active Preview" 
                    className={`w-full h-full ${
                      assetType === 'logo' || assetType === 'icon' ? 'object-contain p-2' : 'object-cover'
                    }`}
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center p-3 text-center text-slate-500">
                    <ImageIcon className="w-8 h-8 mb-1 opacity-50" />
                    <span className="text-[10px]">No Image</span>
                  </div>
                )}

                {currentOverrides?.[assetType] && (
                  <div className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-purple-600/90 text-white text-[9px] font-bold shadow-md">
                    CUSTOM
                  </div>
                )}
              </div>
              <span className="text-[10px] text-slate-400 font-mono mt-1.5">
                Current Active {assetType.toUpperCase()}
              </span>
            </div>

            {/* Preview Action Controls */}
            <div className="flex-1 space-y-3.5 w-full">
              <div>
                <h4 className="text-sm font-bold text-white">
                  {assetType === 'grid' ? 'Cover / Poster (600x900)' :
                   assetType === 'hero' ? 'Hero Banner (1920x620 / 16:9)' :
                   assetType === 'logo' ? 'Game Title Logo (Transparent PNG)' :
                   'Square Game Icon (1:1)'}
                </h4>
                <p className="text-xs text-slate-400 mt-0.5">
                  Pick community artwork below, upload any image from your computer, or paste a direct image URL.
                </p>
              </div>

              {/* Action Buttons Row */}
              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={handleUploadLocalFile}
                  disabled={isUploading}
                  className="px-3.5 py-2 rounded-lg bg-[#1f2737] hover:bg-[#283246] border border-white/[0.1] text-xs font-semibold text-slate-200 hover:text-white transition-all flex items-center space-x-2 cursor-pointer shadow-sm disabled:opacity-50"
                  title="Choose .png, .jpg, .webp or .gif from PC"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-400" />
                  <span>{isUploading ? 'Importing...' : 'Upload Image File'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowUrlInput(!showUrlInput)}
                  className="px-3.5 py-2 rounded-lg bg-[#1f2737] hover:bg-[#283246] border border-white/[0.1] text-xs font-semibold text-slate-200 hover:text-white transition-all flex items-center space-x-2 cursor-pointer shadow-sm"
                  title="Set from direct image URL"
                >
                  <Link className="w-3.5 h-3.5 text-purple-400" />
                  <span>Enter Direct URL</span>
                </button>

                {currentOverrides?.[assetType] && (
                  <button
                    type="button"
                    onClick={handleResetArtwork}
                    className="px-3 py-2 rounded-lg bg-red-950/40 hover:bg-red-900/50 border border-red-500/30 text-xs font-semibold text-red-300 hover:text-red-200 transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
                    title="Reset to official Steam or default source artwork"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset to Default</span>
                  </button>
                )}
              </div>

              {/* Custom URL Input Bar (collapsible) */}
              {showUrlInput && (
                <form onSubmit={handleApplyCustomUrl} className="flex items-center space-x-2 pt-2 animate-in fade-in">
                  <input
                    type="url"
                    placeholder="https://example.com/artwork.png"
                    value={customUrlInput}
                    onChange={(e) => setCustomUrlInput(e.target.value)}
                    className="flex-1 px-3.5 py-1.5 rounded-lg bg-[#0c0e14] border border-white/[0.1] text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-all cursor-pointer shrink-0 shadow-sm"
                  >
                    Apply URL
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* SteamGridDB API Key Banner */}
          {!hasApiKey ? (
            <div className="p-4 rounded-xl bg-gradient-to-r from-purple-950/40 via-[#19182a] to-blue-950/30 border border-purple-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm">
              <div className="space-y-1 min-w-0">
                <div className="flex items-center space-x-2">
                  <Key className="w-4 h-4 text-purple-400 shrink-0" />
                  <h4 className="text-xs font-bold text-white">Unlock 500,000+ Community Artworks</h4>
                </div>
                <p className="text-[11px] text-slate-400">
                  Connect your free SteamGridDB API key to search thousands of animated covers, logos, and custom banners.
                </p>
              </div>

              <div className="flex items-center space-x-2 shrink-0">
                <a
                  href="https://www.steamgriddb.com/profile/preferences/api"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-slate-300 hover:text-white transition-colors flex items-center space-x-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Get Free Key</span>
                </a>
                <button
                  type="button"
                  onClick={() => setShowKeyInput(!showKeyInput)}
                  className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
                >
                  {showKeyInput ? 'Close' : 'Enter Key'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-purple-950/20 border border-purple-500/20 text-xs">
              <div className="flex items-center space-x-2 text-purple-300">
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold">SteamGridDB Connected</span>
                <span className="text-slate-400 text-[11px]">({items.length} candidates loaded)</span>
              </div>
              <button
                type="button"
                onClick={() => setShowKeyInput(!showKeyInput)}
                className="text-[11px] text-slate-400 hover:text-purple-300 underline cursor-pointer"
              >
                Change Key
              </button>
            </div>
          )}

          {/* Inline Key Input Form */}
          {showKeyInput && (
            <form onSubmit={handleSaveApiKey} className="p-4 bg-[#141822] border border-white/[0.08] rounded-xl flex items-center space-x-2.5 animate-in fade-in">
              <Key className="w-4 h-4 text-purple-400 shrink-0" />
              <input
                type="password"
                placeholder="Paste SteamGridDB API Key here..."
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                className="flex-1 px-3.5 py-1.5 rounded-lg bg-[#0c0e14] border border-white/[0.1] text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                autoFocus
              />
              <button
                type="submit"
                disabled={isSavingKey || !apiKeyInput.trim()}
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-all cursor-pointer shrink-0 disabled:opacity-50"
              >
                {isSavingKey ? 'Saving...' : 'Save & Refresh'}
              </button>
            </form>
          )}

          {/* Community & Official Artwork Gallery Grid */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-2">
                <span>Available {tabs.find(t => t.id === assetType)?.label} Candidates</span>
                <span className="text-[11px] font-mono text-slate-500 font-normal">({items.length})</span>
              </h4>
              <button
                type="button"
                onClick={loadArtwork}
                disabled={isLoading}
                className="text-xs text-slate-400 hover:text-white flex items-center space-x-1 cursor-pointer transition-colors"
                title="Refresh artwork from SteamGridDB"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-purple-400' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 py-8">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <div 
                    key={n} 
                    className="rounded-xl bg-[#141822] animate-pulse border border-white/[0.04]"
                    style={{
                      aspectRatio: assetType === 'grid' ? '2/3' : assetType === 'hero' ? '16/9' : '1/1'
                    }}
                  />
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center space-y-3 bg-[#141822]/40 border border-white/[0.06] rounded-xl p-6">
                <ImageIcon className="w-10 h-10 text-slate-600" />
                <div className="space-y-1 max-w-sm">
                  <h4 className="text-sm font-bold text-white">No Artwork Candidates Found</h4>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {!hasApiKey 
                      ? 'Connect your free SteamGridDB API key above to load hundreds of community-crafted covers and banners.' 
                      : 'No items found for this game on SteamGridDB or Steam CDN. You can upload any local image or enter a direct URL.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleUploadLocalFile}
                  className="px-4 py-2 bg-[#1f2737] hover:bg-[#283246] border border-white/[0.1] text-xs font-semibold text-slate-200 rounded-lg transition-all flex items-center space-x-2 cursor-pointer shadow-sm"
                >
                  <Upload className="w-3.5 h-3.5 text-blue-400" />
                  <span>Upload from PC</span>
                </button>
              </div>
            ) : (
              <div className={`grid gap-3.5 ${
                assetType === 'grid' 
                  ? 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5' 
                  : assetType === 'hero'
                  ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
                  : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5'
              }`}>
                {items.map(item => {
                  const isSelected = activePreviewUrl === item.url;
                  return (
                    <div
                      key={item.id || item.url}
                      onClick={() => handleSelectArtwork(item.url)}
                      className={`group relative rounded-xl overflow-hidden bg-[#141822] border cursor-pointer transition-all duration-200 hover:shadow-xl hover:scale-[1.02] flex flex-col ${
                        isSelected 
                          ? 'border-purple-500 ring-2 ring-purple-500/40 shadow-purple-500/20' 
                          : 'border-white/[0.08] hover:border-purple-500/50'
                      }`}
                    >
                      {/* Image Box */}
                      <div 
                        className="relative overflow-hidden w-full"
                        style={{
                          aspectRatio: assetType === 'grid' ? '2/3' : assetType === 'hero' ? '16/9' : '1/1',
                          background: (assetType === 'logo' || assetType === 'icon') 
                            ? 'repeating-conic-gradient(#1e2533 0% 25%, #131722 0% 50%) 50% / 12px 12px' 
                            : '#0c0e14'
                        }}
                      >
                        <img
                          src={item.thumb || item.url}
                          alt={item.author || 'Artwork'}
                          loading="lazy"
                          className={`w-full h-full transition-transform duration-300 group-hover:scale-105 ${
                            (assetType === 'logo' || assetType === 'icon') ? 'object-contain p-3' : 'object-cover'
                          }`}
                        />

                        {/* Top Badges: Dimensions & Animated */}
                        <div className="absolute top-2 left-2 z-10 flex items-center space-x-1">
                          {item.width && item.height && (
                            <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/75 text-slate-200 border border-white/10 backdrop-blur-md">
                              {item.width}x{item.height}
                            </span>
                          )}
                          {item.isAnimated && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md animate-pulse">
                              ANIMATED
                            </span>
                          )}
                        </div>

                        {/* Selected Indicator */}
                        {isSelected && (
                          <div className="absolute top-2 right-2 z-10 w-6 h-6 rounded-full bg-purple-600 text-white flex items-center justify-center shadow-lg">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        )}

                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-2 z-20">
                          <span className="px-3.5 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-bold shadow-xl">
                            {isSelected ? 'Applied' : 'Apply Artwork'}
                          </span>
                        </div>
                      </div>

                      {/* Footer Info */}
                      <div className="p-2.5 bg-[#121620] flex items-center justify-between text-[10px] text-slate-400 border-t border-white/[0.04]">
                        <span className="truncate max-w-[120px]" title={item.author}>
                          {item.author || 'SteamGridDB'}
                        </span>
                        {item.score > 0 && (
                          <span className="font-mono text-purple-300 font-semibold shrink-0">
                            ★ {item.score}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SaveBackupModal({ game, isOpen, onClose, onShowToast }) {
  const [backups, setBackups] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [restoringFile, setRestoringFile] = useState(null);

  useEffect(() => {
    if (isOpen && game?.title && window.api) {
      loadBackups();
    }
  }, [isOpen, game?.title]);

  const loadBackups = async () => {
    setIsLoading(true);
    try {
      if (window.api?.listGameBackups) {
        const list = await window.api.listGameBackups(game.title);
        setBackups(list || []);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    if (!window.api?.backupGameSave || !game?.title) return;
    setIsBackingUp(true);
    try {
      const res = await window.api.backupGameSave({
        title: game.title,
        steamAppId: game.steamAppId || game.id,
        exePath: game.exePath
      });
      if (res.success) {
        await loadBackups();
        if (onShowToast) onShowToast(`Backup saved: ${res.filename} (${res.sizeFormatted})`);
      } else {
        if (onShowToast) onShowToast(res.error || 'Failed to create backup');
      }
    } catch (err) {
      if (onShowToast) onShowToast('Backup error: ' + err.message);
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestore = async (backup) => {
    if (!window.api?.restoreGameSave || !game?.title) return;
    if (!confirm(`Restore save backup from ${backup.dateFormatted}? Current progress will be updated.`)) return;
    setRestoringFile(backup.filename);
    try {
      const res = await window.api.restoreGameSave({
        title: game.title,
        backupPath: backup.fullPath,
        steamAppId: game.steamAppId || game.id,
        exePath: game.exePath
      });
      if (res.success) {
        if (onShowToast) onShowToast(`Save restored successfully into: ${res.targetDir}`);
      } else {
        if (onShowToast) onShowToast(res.error || 'Failed to restore save');
      }
    } catch (err) {
      if (onShowToast) onShowToast('Restore error: ' + err.message);
    } finally {
      setRestoringFile(null);
    }
  };

  const handleOpenFolder = () => {
    if (window.api?.openSaveLocation && game?.title) {
      window.api.openSaveLocation({
        title: game.title,
        steamAppId: game.steamAppId || game.id,
        exePath: game.exePath
      });
    }
  };

  if (!isOpen || !game) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#121620] border border-white/[0.1] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-5 border-b border-white/[0.08] flex items-center justify-between bg-[#151a26]">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
              <Save className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-bold text-white truncate">Save Game Backups</h3>
              <p className="text-xs text-slate-400 truncate">{game.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Hero */}
        <div className="p-5 border-b border-white/[0.06] bg-[#0e1117] flex items-center justify-between gap-4">
          <div>
            <span className="text-xs font-semibold text-slate-300 block">Automated 7-Zip Protection</span>
            <span className="text-[11px] text-slate-500">Fast compressed snapshot of all game progress & settings</span>
          </div>
          <button
            onClick={handleCreateBackup}
            disabled={isBackingUp}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg shadow-md transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50 shrink-0"
          >
            {isBackingUp ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>{isBackingUp ? 'Archiving...' : 'Backup Save Now'}</span>
          </button>
        </div>

        {/* Backup List */}
        <div className="p-5 flex-1 overflow-y-auto space-y-2.5">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span>Previous Backups ({backups.length})</span>
            <button
              onClick={handleOpenFolder}
              className="text-blue-400 hover:text-blue-300 flex items-center space-x-1 transition-colors cursor-pointer"
            >
              <FolderOpen className="w-3 h-3" />
              <span>Open in Explorer</span>
            </button>
          </div>

          {isLoading ? (
            <div className="py-12 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
            </div>
          ) : backups.length === 0 ? (
            <div className="py-10 text-center space-y-2 bg-[#151924]/40 rounded-xl border border-white/[0.04] p-6">
              <HardDrive className="w-8 h-8 text-slate-600 mx-auto" />
              <p className="text-xs font-semibold text-slate-400">No backups created yet for this game</p>
              <p className="text-[11px] text-slate-500">Click "Backup Save Now" above to create your first safe restore point.</p>
            </div>
          ) : (
            backups.map((b) => (
              <div
                key={b.filename}
                className="p-3 rounded-xl bg-[#151a24] border border-white/[0.06] hover:border-white/[0.12] flex items-center justify-between gap-3 transition-all"
              >
                <div className="min-w-0">
                  <div className="flex items-center space-x-2">
                    <span className="text-xs font-bold text-white truncate">{b.filename}</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.05] text-slate-400 border border-white/[0.06]">
                      {b.sizeFormatted}
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-400 block mt-0.5">{b.dateFormatted}</span>
                </div>

                <div className="flex items-center space-x-2 shrink-0">
                  <button
                    onClick={() => handleRestore(b)}
                    disabled={restoringFile === b.filename}
                    className="px-3 py-1.5 bg-[#1f2636] hover:bg-blue-600 hover:text-white border border-white/[0.08] text-blue-400 text-xs font-semibold rounded-lg transition-all cursor-pointer shadow-sm flex items-center space-x-1 disabled:opacity-50"
                  >
                    {restoringFile === b.filename ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <DownloadCloud className="w-3 h-3" />
                    )}
                    <span>{restoringFile === b.filename ? 'Restoring...' : 'Restore'}</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/[0.06] bg-[#0e1117] flex items-center justify-between text-[11px] text-slate-500">
          <span>Saved to: %USERPROFILE%\Charon Saves</span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white/[0.06] hover:bg-white/[0.12] text-slate-300 rounded-lg font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function AchievementToast({ achievement, onClose }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, 6000);
    return () => clearTimeout(timer);
  }, [achievement, onClose]);

  if (!achievement) return null;

  return (
    <div 
      onClick={onClose}
      className="fixed bottom-6 right-6 z-50 max-w-sm w-full bg-[#121622]/95 border border-amber-500/50 rounded-2xl p-4 shadow-[0_10px_35px_rgba(245,158,11,0.25)] backdrop-blur-xl flex items-center space-x-4 cursor-pointer animate-in fade-in slide-in-from-bottom-5 duration-300 hover:border-amber-400 group"
    >
      <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-900/30 border border-amber-500/40 p-1 flex items-center justify-center shrink-0 overflow-hidden shadow-lg group-hover:scale-105 transition-transform">
        {achievement.icon ? (
          <img src={achievement.icon} alt="" className="w-full h-full object-cover rounded-lg" />
        ) : (
          <Trophy className="w-7 h-7 text-amber-400" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center space-x-1.5 text-[10px] font-extrabold uppercase text-amber-400 tracking-wider">
          <Sparkles className="w-3 h-3 animate-spin" />
          <span>ACHIEVEMENT UNLOCKED!</span>
        </div>
        <h4 className="text-sm font-bold text-white truncate mt-0.5">{achievement.displayName}</h4>
        <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">{achievement.description || achievement.gameTitle}</p>
      </div>
      <button 
        onClick={(e) => { e.stopPropagation(); onClose(); }} 
        className="text-slate-400 hover:text-white p-1 rounded transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function AchievementsSection({ game }) {
  const [data, setData] = useState({ total: 0, unlockedCount: 0, achievements: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    let mounted = true;
    if (window.api?.getGameAchievements && game?.title) {
      setLoading(true);
      window.api.getGameAchievements({
        title: game.title,
        steamAppId: game.steamAppId || game.id,
        exePath: game.exePath,
        gameId: game.id
      }).then(res => {
        if (mounted && res) {
          setData(res);
        }
      }).catch(() => {}).finally(() => {
        if (mounted) setLoading(false);
      });
    } else {
      setLoading(false);
    }
    return () => { mounted = false; };
  }, [game?.title, game?.id, game?.exePath]);

  if (loading) {
    return (
      <div className="p-6 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-center space-x-3 py-10">
        <RefreshCw className="w-5 h-5 text-blue-400 animate-spin" />
        <span className="text-xs font-semibold text-slate-400">Loading Steam & emulator achievements...</span>
      </div>
    );
  }

  if (!data || data.total === 0) {
    return null;
  }

  const pct = data.total > 0 ? Math.round((data.unlockedCount / data.total) * 100) : 0;
  const filtered = data.achievements.filter(a => {
    if (filter === 'unlocked') return a.unlocked;
    if (filter === 'locked') return !a.unlocked;
    return true;
  });

  return (
    <div className="p-6 bg-[#121620] border border-white/[0.08] rounded-xl space-y-4 shadow-sm">
      {/* Header with Progress */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <Trophy className="w-5 h-5 text-amber-400" />
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Steam Achievements</h3>
            <span className="text-xs font-mono font-bold text-amber-400 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
              {data.unlockedCount} / {data.total} ({pct}%)
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">Real-time unlocked emulator tracking with public community badges</p>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center bg-[#0e1117] p-1 rounded-lg border border-white/[0.06]">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
              filter === 'all' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All ({data.total})
          </button>
          <button
            onClick={() => setFilter('unlocked')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
              filter === 'unlocked' ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Unlocked ({data.unlockedCount})
          </button>
          <button
            onClick={() => setFilter('locked')}
            className={`px-3 py-1 rounded text-xs font-semibold transition-all cursor-pointer ${
              filter === 'locked' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Locked ({data.total - data.unlockedCount})
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="space-y-1.5">
        <div className="w-full h-2.5 bg-[#0e1117] rounded-full overflow-hidden border border-white/[0.04]">
          <div 
            className="h-full bg-gradient-to-r from-amber-500 via-emerald-500 to-teal-400 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Badges Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
        {filtered.map(ach => (
          <div
            key={ach.name}
            className={`p-3 rounded-xl border flex items-center space-x-3 transition-all ${
              ach.unlocked 
                ? 'bg-[#151d2a]/90 border-amber-500/30 hover:border-amber-500/60 shadow-md' 
                : 'bg-[#10141d]/50 border-white/[0.04] opacity-50 grayscale hover:opacity-80'
            }`}
          >
            <div className="relative w-12 h-12 rounded-lg bg-black/40 overflow-hidden shrink-0 border border-white/[0.08] flex items-center justify-center">
              {ach.icon ? (
                <img src={ach.icon} alt="" className="w-full h-full object-cover" />
              ) : (
                <Trophy className="w-6 h-6 text-slate-500" />
              )}
              {ach.unlocked && (
                <div className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[9px] shadow">
                  ✓
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-bold text-white truncate">{ach.displayName}</h4>
              <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{ach.description || 'Hidden achievement'}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ==========================================================
// EXECUTABLE SETTINGS MODAL (Per-Game Exe Picker + Launch Args)
// ==========================================================
function ExecutableSettingsModal({ game, isOpen, onClose, onShowToast }) {
  const [candidates, setCandidates] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [selectedExe, setSelectedExe] = React.useState('');
  const [launchArgs, setLaunchArgs] = React.useState('');
  const [savedConfig, setSavedConfig] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen || !game) return;
    setLoading(true);
    setDropdownOpen(false);

    const loadData = async () => {
      try {
        const [exeResult, config] = await Promise.all([
          window.api?.getGameExecutables?.({ installDir: game.installDir, title: game.title }),
          window.api?.getGameConfig?.(game.id)
        ]);

        if (exeResult?.candidates) {
          setCandidates(exeResult.candidates);
        } else {
          setCandidates([]);
        }

        setSavedConfig(config);
        if (config?.customExePath) {
          setSelectedExe(config.customExePath);
        } else if (exeResult?.primary) {
          setSelectedExe(exeResult.primary);
        } else if (game.exePath) {
          setSelectedExe(game.exePath);
        } else {
          setSelectedExe('');
        }
        setLaunchArgs(config?.launchArgs || '');
      } catch (e) {
        console.warn('[ExeSettings] Load error:', e);
        setCandidates([]);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [isOpen, game?.id]);

  const handleSave = async () => {
    if (!game?.id) return;
    setSaving(true);
    try {
      const isAutoDetect = !savedConfig?.customExePath && candidates.length > 0 && selectedExe === candidates[0]?.path;
      const result = await window.api?.setGameConfig?.({
        gameId: game.id,
        customExePath: isAutoDetect ? null : (selectedExe || null),
        launchArgs: launchArgs.trim() || null
      });
      if (result?.success) {
        setSavedConfig(result.config);
        onShowToast?.('Executable & launch settings saved!');
        onClose?.();
      }
    } catch (e) {
      console.error('[ExeSettings] Save error:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!game?.id) return;
    setSaving(true);
    try {
      await window.api?.setGameConfig?.({ gameId: game.id, customExePath: null, launchArgs: null });
      setSavedConfig(null);
      setLaunchArgs('');
      if (candidates.length > 0) {
        setSelectedExe(candidates[0].path);
      } else if (game.exePath) {
        setSelectedExe(game.exePath);
      }
      onShowToast?.('Reset to auto-detect. Settings cleared.');
    } catch (e) {
      console.error('[ExeSettings] Reset error:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleBrowse = async () => {
    try {
      const result = await window.api?.browseGameExe?.({ installDir: game?.installDir });
      if (result?.path) {
        setSelectedExe(result.path);
        setDropdownOpen(false);
      }
    } catch (e) {
      console.warn('[ExeSettings] Browse error:', e);
    }
  };

  if (!isOpen || !game) return null;

  const selectedName = selectedExe ? selectedExe.split('\\').pop().split('/').pop() : 'None';
  const selectedCandidate = candidates.find(c => c.path === selectedExe);

  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#0f1219] border border-white/[0.12] rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-orange-500/20 rounded-lg">
              <Settings2 className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Executable & Launch Settings</h2>
              <p className="text-[11px] text-slate-400 mt-0.5 truncate max-w-[280px]">{game.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors cursor-pointer">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="w-5 h-5 text-slate-400 animate-spin" />
              <span className="ml-2 text-sm text-slate-400">Scanning executables...</span>
            </div>
          ) : (
            <>
              {/* Executable Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Game Executable</label>
                <div className="relative">
                  <button
                    onClick={() => setDropdownOpen(!dropdownOpen)}
                    className="w-full px-3.5 py-2.5 bg-[#171d29] border border-white/[0.1] hover:border-orange-500/40 rounded-lg text-left flex items-center justify-between transition-colors cursor-pointer"
                  >
                    <div className="flex items-center space-x-2 min-w-0">
                      {selectedCandidate?.isRecommended && <Star className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                      <span className="text-sm text-white font-medium truncate">{selectedName}</span>
                      {selectedCandidate && (
                        <span className="text-[10px] text-slate-400 font-mono shrink-0">({selectedCandidate.sizeFormatted})</span>
                      )}
                    </div>
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  {dropdownOpen && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-[#151922] border border-white/[0.12] rounded-lg shadow-xl z-50 max-h-52 overflow-y-auto">
                      {candidates.map((c, i) => (
                        <button
                          key={c.path}
                          onClick={() => { setSelectedExe(c.path); setDropdownOpen(false); }}
                          className={`w-full px-3.5 py-2.5 flex items-center justify-between text-left hover:bg-white/[0.06] transition-colors cursor-pointer ${
                            c.path === selectedExe ? 'bg-orange-500/10 border-l-2 border-orange-500' : 'border-l-2 border-transparent'
                          } ${i < candidates.length - 1 ? 'border-b border-white/[0.05]' : ''}`}
                        >
                          <div className="flex items-center space-x-2 min-w-0">
                            {c.isRecommended && <Star className="w-3 h-3 text-amber-400 shrink-0" />}
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-white truncate">{c.name}</p>
                              <p className="text-[10px] text-slate-400 truncate">{c.label} · Score: {c.score} · {c.sizeFormatted}</p>
                            </div>
                          </div>
                          {c.path === selectedExe && <Check className="w-3.5 h-3.5 text-orange-400 shrink-0" />}
                        </button>
                      ))}

                      {/* Browse Custom */}
                      <button
                        onClick={handleBrowse}
                        className="w-full px-3.5 py-2.5 flex items-center space-x-2 text-left hover:bg-white/[0.06] border-t border-white/[0.08] transition-colors cursor-pointer"
                      >
                        <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
                        <span className="text-xs font-semibold text-blue-300">Browse Custom .exe...</span>
                      </button>
                    </div>
                  )}
                </div>
                {/* Current path display */}
                {selectedExe && (
                  <p className="mt-1.5 text-[10px] text-slate-500 font-mono truncate" title={selectedExe}>{selectedExe}</p>
                )}
              </div>

              {/* Launch Arguments */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  <Terminal className="w-3.5 h-3.5 inline mr-1.5 text-emerald-400" />
                  Launch Arguments
                </label>
                <input
                  type="text"
                  value={launchArgs}
                  onChange={e => setLaunchArgs(e.target.value)}
                  placeholder="-dx11 -windowed -skipintro"
                  className="w-full px-3.5 py-2.5 bg-[#171d29] border border-white/[0.1] focus:border-emerald-500/50 rounded-lg text-sm text-white font-mono placeholder:text-slate-500 outline-none transition-colors"
                />
                <p className="mt-1.5 text-[10px] text-slate-500">Optional. Space-separated arguments passed to the executable on launch.</p>
              </div>

              {/* Info Badges */}
              {savedConfig && (
                <div className="flex items-center space-x-2">
                  <div className="px-2 py-1 bg-orange-500/10 border border-orange-500/20 rounded text-[10px] font-semibold text-orange-300">
                    Custom Config Active
                  </div>
                  {savedConfig.launchArgs && (
                    <div className="px-2 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded text-[10px] font-mono text-emerald-300 truncate max-w-[200px]">
                      Args: {savedConfig.launchArgs}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-white/[0.08] flex items-center justify-between">
          <button
            onClick={handleReset}
            disabled={saving || (!savedConfig && !launchArgs)}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/[0.06] rounded-lg transition-colors disabled:opacity-30 cursor-pointer flex items-center space-x-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to Auto-Detect</span>
          </button>
          <div className="flex items-center space-x-2.5">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.06] rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || loading}
              className="px-5 py-2 bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold rounded-lg transition-colors shadow-md disabled:opacity-50 cursor-pointer flex items-center space-x-1.5"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Saving...' : 'Save'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function GameDetailsPage({ game, onBack, onDownload, onOpenRepacks, onCancelDownload, onEnrich, playtime, runningGame, onOpenSaveBackups, onOpenArtworkPicker, onOpenExeSettings, onShowToast }) {
  const isExtracting = game.status === 'extracting';
  const isDownloading = !isExtracting && ((game.progress > 0 && game.progress < 100) || game.status === 'downloading');
  const isInstalled = !isExtracting && (game.progress === 100 || game.status === 'completed');
  
  const [bannerSrc, setBannerSrc] = useState(game.banner || game.header || game.cover || game.originalCover || '');
  const [bannerLoaded, setBannerLoaded] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);

  const [coverSrc, setCoverSrc] = useState(game.cover || game.coverFallback || game.header || game.originalCover || '');
  const [coverFailed, setCoverFailed] = useState(false);
  const [isAddingToSteam, setIsAddingToSteam] = useState(false);

  const handleAddToSteam = async () => {
    if (!window.api?.addToSteam) return;
    setIsAddingToSteam(true);
    try {
      const res = await window.api.addToSteam({
        title: game.title,
        exePath: game.exePath,
        installDir: game.installDir,
        coverImage: game.cover || game.originalCover,
        bannerImage: game.banner,
        steamAppId: game.steamAppId || game.id
      });
      if (res?.success) {
        if (onShowToast) onShowToast(`Added "${game.title}" to Steam with HD artwork! Restart Steam to see it.`);
      } else {
        if (onShowToast) onShowToast(res?.error || 'Failed to add to Steam');
      }
    } catch (e) {
      if (onShowToast) onShowToast('Error adding to Steam: ' + e.message);
    } finally {
      setIsAddingToSteam(false);
    }
  };

  const [gameConfig, setGameConfig] = useState(null);
  const [isCreatingShortcut, setIsCreatingShortcut] = useState(false);

  useEffect(() => {
    if (game?.id && window.api?.getGameConfig) {
      window.api.getGameConfig(game.id).then(cfg => {
        if (cfg) setGameConfig(cfg);
      }).catch(() => {});
    }
  }, [game?.id]);

  const handleCreateShortcut = async () => {
    if (!window.api?.createDesktopShortcut) return;
    setIsCreatingShortcut(true);
    try {
      const res = await window.api.createDesktopShortcut({ game, exePath: game.exePath });
      if (res?.success) {
        onShowToast?.(`Created Desktop & Start Menu shortcut for "${game.title}"!`);
      } else {
        onShowToast?.(res?.error || 'Failed to create shortcut');
      }
    } catch (e) {
      onShowToast?.('Failed to create shortcut: ' + e.message);
    } finally {
      setIsCreatingShortcut(false);
    }
  };

  useEffect(() => {
    setBannerSrc(game.banner || game.header || game.cover || game.originalCover || '');
    setBannerLoaded(false);
    setBannerFailed(false);
    setCoverSrc(game.cover || game.coverFallback || game.header || game.originalCover || '');
    setCoverFailed(false);
  }, [game.id, game.banner, game.header, game.cover, game.coverFallback, game.originalCover, game.customArtwork]);

  useEffect(() => {
    if (!bannerSrc) return;
    let active = true;
    const img = new Image();
    img.src = bannerSrc;
    img.onload = () => {
      if (active) setBannerLoaded(true);
    };
    img.onerror = () => {
      if (!active) return;
      if (game.header && bannerSrc !== game.header) {
        setBannerSrc(game.header);
      } else if (game.cover && bannerSrc !== game.cover) {
        setBannerSrc(game.cover);
      } else if (game.originalCover && bannerSrc !== game.originalCover) {
        setBannerSrc(game.originalCover);
      } else {
        setBannerFailed(true);
      }
    };
    return () => { active = false; };
  }, [bannerSrc, game.banner, game.header, game.cover, game.originalCover]);

  useEffect(() => {
    if (!game.enriched && (!game.cover || !game.banner) && window.api && window.api.fetchMetadata) {
      let mounted = true;
      let cleanTitle = (game.cleanTitle || game.title)
        .replace(/\(.*?\)/g, '')
        .replace(/\[.*?\]/g, '')
        .replace(/Free Download.*$/i, '')
        .replace(/\s+v?\d+\.\d+(?:\.\d+)*.*$/i, '')
        .replace(/\s+(?:build|patch|hotfix|update|release|v\d+)\s*.*$/i, '')
        .replace(/\s*(?:Версия|модификации).*$/i, '')
        .trim();
      window.api.fetchMetadata(cleanTitle).then(meta => {
        if (mounted && meta && onEnrich) {
          onEnrich(game.id, meta);
        }
      }).catch(() => {});
      return () => { mounted = false; };
    }
  }, [game.id, game.enriched, game.cover, game.banner, game.cleanTitle, game.title, onEnrich]);

  const handleCoverError = () => {
    if (game.coverFallback && coverSrc !== game.coverFallback) {
      setCoverSrc(game.coverFallback);
    } else if (game.header && coverSrc !== game.header) {
      setCoverSrc(game.header);
    } else if (game.originalCover && coverSrc !== game.originalCover) {
      setCoverSrc(game.originalCover);
    } else {
      setCoverFailed(true);
    }
  };

  return (
    <div className="flex flex-col min-h-full pb-16">
      {/* 1. Cinematic Hero Banner */}
      <div className="relative h-80 w-full overflow-hidden bg-[#0e1117] border-b border-white/[0.06]">
        {/* Banner Backdrop */}
        {!bannerFailed && bannerSrc ? (
          <div 
            className={`absolute inset-0 w-full h-full bg-cover bg-center transition-opacity duration-500 ${bannerLoaded ? 'opacity-40' : 'opacity-0'}`} 
            style={{ backgroundImage: `url("${bannerSrc}")` }}
          />
        ) : (() => {
          const palette = getCardPalette(game.title);
          return (
            <div className={`absolute inset-0 bg-gradient-to-r ${palette.bg} opacity-60 flex items-center justify-end overflow-hidden select-none pr-12`}>
              <div className={`w-96 h-96 rounded-full blur-3xl ${palette.glow} absolute -top-10 -right-10`} />
              <span className="text-8xl font-black text-white/[0.04] tracking-tighter uppercase whitespace-nowrap pointer-events-none">
                {game.title}
              </span>
            </div>
          );
        })()}

        {/* Clean vignettes */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d12] via-[#0b0d12]/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0b0d12] via-transparent to-transparent" />

        {/* Back Button */}
        <button 
          onClick={onBack} 
          className="absolute top-5 left-6 z-20 flex items-center space-x-2 px-3.5 py-1.5 bg-[#151922]/90 hover:bg-[#1e2433] border border-white/[0.1] rounded-lg text-xs font-semibold text-slate-200 transition-all shadow-sm cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Library</span>
        </button>

        {/* Customize Artwork Button in Hero */}
        <button 
          onClick={() => onOpenArtworkPicker?.(game)} 
          className="absolute top-5 right-6 z-20 flex items-center space-x-2 px-3.5 py-1.5 bg-[#151922]/90 hover:bg-[#1e2433] border border-white/[0.1] hover:border-purple-500/40 rounded-lg text-xs font-semibold text-slate-200 hover:text-white transition-all shadow-sm cursor-pointer"
          title="Customize Cover, Hero Banner, Logo & Icon (SteamGridDB)"
        >
          <ImageIcon className="w-3.5 h-3.5 text-purple-400" />
          <span>Change Artwork</span>
        </button>

        {/* Game Title & Release Meta in Hero */}
        <div className="absolute bottom-6 left-8 right-8 z-10 flex items-end justify-between gap-6">
          <div className="space-y-2 max-w-3xl">
            <div className="flex items-center space-x-2.5">
              <span className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border ${
                game.source === 'onlinefix' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' :
                game.source === 'fitgirl' ? 'bg-pink-500/20 text-pink-300 border-pink-500/40' :
                game.source === 'dodi' ? 'bg-purple-500/20 text-purple-300 border-purple-500/40' :
                game.source === 'steamunlocked' ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' :
                'bg-blue-500/20 text-blue-300 border-blue-500/40'
              }`}>
                {game.source === 'onlinefix' ? 'OnlineFix Multiplayer' : game.source === 'fitgirl' ? 'FitGirl Repack' : game.source === 'dodi' ? 'DODI Repack' : game.source === 'steamunlocked' ? 'SteamUnlocked' : 'SteamRIP'}
              </span>
              {game.uploadDate && (
                <span className="text-[11px] font-mono text-slate-400">Released {game.uploadDate}</span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white drop-shadow-md">
              {game.title}
            </h1>
          </div>

          <div className="text-right shrink-0">
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Required Storage</p>
            <p className="font-mono text-2xl font-bold text-white">{game.size || 'Pre-installed'}</p>
          </div>
        </div>
      </div>

      {/* 2. Main Content & Primary Actions Area */}
      <div className="px-8 pt-8 max-w-6xl mx-auto w-full space-y-8">
        {/* Action Panel Bar */}
        <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">Status</span>
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <div className={`w-2.5 h-2.5 rounded-full ${
                  runningGame ? 'bg-emerald-400 animate-ping' :
                  isInstalled ? 'bg-emerald-500' : 
                  isExtracting ? 'bg-purple-500 animate-pulse' : 
                  isDownloading ? 'bg-blue-500' : 'bg-slate-500'
                }`} />
                <span className="text-sm font-semibold text-white">
                  {runningGame ? `Playing Now (${formatPlaytime(runningGame.sessionSeconds)})` :
                   isInstalled ? 'Ready to Play' : 
                   isExtracting ? 'Decompressing Archive (7-Zip Multi-Threaded)...' : 
                   isDownloading ? 'Download in Progress' : 'Available for Download'}
                </span>
              </div>
              {playtime?.totalSeconds > 0 && (
                <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-md bg-white/[0.05] border border-white/[0.08] text-slate-300 text-xs font-mono">
                  <Clock className="w-3 h-3 text-blue-400" />
                  <span>{formatPlaytime(playtime.totalSeconds)}</span>
                </div>
              )}
            </div>
          </div>

          {/* Action Button Controls */}
          <div>
            {isInstalled ? (
              <div className="flex items-center space-x-2.5 flex-wrap gap-y-2">
                <button 
                  onClick={handleAddToSteam}
                  disabled={isAddingToSteam}
                  className="px-4 py-2.5 bg-[#171d29] hover:bg-[#222b3d] border border-blue-500/30 hover:border-blue-500/60 rounded-lg text-xs font-bold text-slate-200 hover:text-white transition-all flex items-center space-x-2 cursor-pointer shadow-sm disabled:opacity-50"
                  title="Add this game directly to Steam with custom vertical poster and hero grid artwork"
                >
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <span>{isAddingToSteam ? 'Adding to Steam...' : 'Add to Steam'}</span>
                </button>
                <button 
                  onClick={() => onOpenSaveBackups?.(game)}
                  className="px-4 py-2.5 bg-[#171d29] hover:bg-[#222b3d] border border-white/[0.1] hover:border-emerald-500/40 rounded-lg text-xs font-bold text-slate-200 hover:text-white transition-all flex items-center space-x-2 cursor-pointer shadow-sm"
                  title="Backup & Restore Game Saves with 7-Zip"
                >
                  <Save className="w-4 h-4 text-emerald-400" />
                  <span>Save Backups</span>
                </button>
                <button 
                  onClick={() => onOpenArtworkPicker?.(game)}
                  className="px-4 py-2.5 bg-[#171d29] hover:bg-[#222b3d] border border-white/[0.1] hover:border-purple-500/40 rounded-lg text-xs font-bold text-slate-200 hover:text-white transition-all flex items-center space-x-2 cursor-pointer shadow-sm"
                  title="Customize Cover, Hero Banner, Logo & Icon (SteamGridDB)"
                >
                  <ImageIcon className="w-4 h-4 text-purple-400" />
                  <span>Change Artwork</span>
                </button>
                <button 
                  onClick={() => onOpenExeSettings?.(game)}
                  className="px-4 py-2.5 bg-[#171d29] hover:bg-[#222b3d] border border-white/[0.1] hover:border-orange-500/40 rounded-lg text-xs font-bold text-slate-200 hover:text-white transition-all flex items-center space-x-2 cursor-pointer shadow-sm"
                  title="Configure Executable & Launch Arguments"
                >
                  <Settings2 className="w-4 h-4 text-orange-400" />
                  <span>Launch Settings</span>
                </button>
                <button 
                  onClick={handleCreateShortcut}
                  disabled={isCreatingShortcut}
                  className="px-4 py-2.5 bg-[#171d29] hover:bg-[#222b3d] border border-white/[0.1] hover:border-cyan-500/40 rounded-lg text-xs font-bold text-slate-200 hover:text-white transition-all flex items-center space-x-2 cursor-pointer shadow-sm disabled:opacity-50"
                  title="Create Windows Desktop and Start Menu .lnk shortcut with game icon"
                >
                  <Monitor className="w-4 h-4 text-cyan-400" />
                  <span>{isCreatingShortcut ? 'Creating...' : 'Shortcut'}</span>
                </button>
                {gameConfig?.discs && gameConfig.discs.length > 1 && (
                  <div className="flex items-center space-x-1.5 bg-[#141822] border border-cyan-500/40 px-3 py-2 rounded-lg text-xs" title="Select active ROM / Disc">
                    <Disc className="w-4 h-4 text-cyan-400 shrink-0" />
                    <select
                      value={gameConfig.selectedDisc || 0}
                      onChange={async (e) => {
                        const idx = parseInt(e.target.value, 10);
                        await window.api?.setSelectedDisc?.({ gameId: game.id, discIndex: idx });
                        setGameConfig(prev => ({ ...prev, selectedDisc: idx }));
                        onShowToast?.(`Active disc set to ${gameConfig.discs[idx]?.label}`);
                      }}
                      className="bg-transparent text-white font-semibold outline-none cursor-pointer max-w-[120px] truncate"
                    >
                      {gameConfig.discs.map((d, i) => (
                        <option key={d.path} value={i} className="bg-[#141822] text-white">
                          {d.label} {d.sku ? `(${d.sku})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <button 
                  onClick={() => window.api?.openFileLocation({ filename: game.filename, installDir: game.installDir })}
                  className="px-4 py-2.5 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.1] rounded-lg text-xs font-bold text-slate-200 transition-all flex items-center space-x-2 cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4 text-blue-400" />
                  <span>Show in Folder</span>
                </button>
                <button 
                  onClick={() => window.api?.openOrRunGame(game)}
                  className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-all flex items-center space-x-2 shadow-md active:scale-[0.98] cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>PLAY NOW</span>
                </button>
              </div>
            ) : isExtracting ? (
              <div className="flex items-center space-x-4">
                <div className="w-72 space-y-1.5">
                  <div className="flex justify-between text-xs font-mono font-semibold">
                    <span className="text-purple-400 flex items-center gap-1.5">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-purple-400" />
                      {game.speed || '7-Zip High-Speed Extraction'}
                    </span>
                    <span className="text-purple-200 font-bold">{game.progress || 0}%</span>
                  </div>
                  <div className="w-full h-2 bg-[#1a202c] rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-purple-600 to-indigo-500 rounded-full transition-all duration-200" style={{ width: `${Math.max(game.progress || 0, 2)}%` }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-purple-300/80 font-mono">
                    <span>Multi-Threaded SIMD Decompression</span>
                    <span>Auto-cleaning archive</span>
                  </div>
                </div>
                <button 
                  onClick={onCancelDownload}
                  className="px-3 py-2 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : isDownloading ? (
              <div className="flex items-center space-x-4">
                <div className="w-64 space-y-1.5">
                  <div className="flex justify-between text-xs font-mono font-semibold">
                    <span className="text-blue-400">{game.speed || 'Connecting...'}</span>
                    <span className="text-white">{game.progress || 0}%</span>
                  </div>
                  <div className="w-full h-2 bg-[#1a202c] rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${game.progress || 0}%` }} />
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                    <span>{game.downloaded || '0 MB'} / {game.totalSize || game.size}</span>
                    {game.eta && <span>ETA {game.eta}</span>}
                  </div>
                </div>
                <button 
                  onClick={onCancelDownload}
                  className="px-3 py-2 text-xs font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex items-center space-x-3">
                <button 
                  onClick={onDownload} 
                  className="px-7 py-3 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-bold rounded-lg transition-all flex items-center space-x-2.5 shadow-md active:scale-[0.98] cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>START DOWNLOAD</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenRepacks) {
                      onOpenRepacks(game);
                    } else if (onDownload) {
                      onDownload();
                    }
                  }}
                  className="px-4 py-3 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.1] rounded-lg text-xs font-bold text-slate-200 transition-all flex items-center space-x-2 shadow-sm cursor-pointer"
                  title="Browse alternative repacks and download providers"
                >
                  <Layers className="w-4 h-4 text-blue-400" />
                  <span>Repacks & Sources</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenArtworkPicker?.(game)}
                  className="px-4 py-3 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.1] hover:border-purple-500/40 rounded-lg text-xs font-bold text-slate-200 transition-all flex items-center space-x-2 shadow-sm cursor-pointer"
                  title="Customize Cover, Hero Banner, Logo & Icon (SteamGridDB)"
                >
                  <ImageIcon className="w-4 h-4 text-purple-400" />
                  <span>Artwork</span>
                </button>
                {(game.source === 'fitgirl' || game.source === 'onlinefix' || game.source === 'dodi') && game.uris && game.uris[0] && (
                  <button 
                    onClick={() => window.api?.openMagnetLink?.(game.uris[0])}
                    className="px-4 py-3 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.1] rounded-lg text-xs font-bold text-slate-200 transition-all flex items-center space-x-2 shadow-sm cursor-pointer"
                    title="Open magnet link in external client (qBittorrent, etc.)"
                  >
                    <ExternalLink className="w-4 h-4 text-emerald-400" />
                    <span>Open Magnet</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 3. Media Carousel: Screenshots & Video Trailers */}
        <div className="space-y-2">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Film className="w-3.5 h-3.5 text-blue-400" />
            <span>Media & Screenshots</span>
          </h3>
          <GallerySlider 
            screenshots={game.screenshots} 
            movies={game.movies} 
            banner={bannerSrc} 
            title={game.title} 
          />
        </div>

        {/* 4. Content Layout: Left Info & Description + Right Technical Sidebar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Left Column: Poster, Description & Genres */}
          <div className="md:col-span-2 space-y-6">
            {/* About This Game */}
            <div className="p-6 bg-[#121620] border border-white/[0.08] rounded-xl space-y-3 shadow-sm">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">About This Game</h3>
              <div 
                className="text-slate-300 text-xs sm:text-sm leading-relaxed whitespace-pre-line prose prose-invert max-w-none"
                dangerouslySetInnerHTML={{
                  __html: game.detailedDescription || game.description || 'Pre-installed build. Downloaded archives can be played immediately without additional setup.'
                }}
              />

              {/* Genres Pills */}
              {Array.isArray(game.genres) && game.genres.length > 0 && (
                <div className="pt-3 border-t border-white/[0.06] flex flex-wrap gap-1.5">
                  {game.genres.map(genre => (
                    <span key={genre} className="text-[10px] font-semibold px-2.5 py-1 rounded-full bg-white/[0.05] text-slate-300 border border-white/[0.08]">
                      {genre}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Steam Achievements Section */}
            <AchievementsSection game={game} />

            {/* Developers & Publishing Metadata */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 bg-[#121620] border border-white/[0.06] rounded-xl space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Developer</span>
                <p className="text-xs font-semibold text-slate-200">{game.developer || 'Verified Publisher'}</p>
              </div>
              <div className="p-4 bg-[#121620] border border-white/[0.06] rounded-xl space-y-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Publisher</span>
                <p className="text-xs font-semibold text-slate-200">
                  {Array.isArray(game.publishers) && game.publishers[0] ? game.publishers[0] : (game.developer || 'Official Release')}
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Metacritic, HLTB, Requirements & Tech Specs */}
          <div className="md:col-span-1 space-y-5">
            {/* Metacritic Score Card */}
            {game.metacritic?.score && (
              <div className="p-4 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-between shadow-sm">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Metacritic Score</span>
                  <span className="text-xs text-slate-300 font-medium">Critical Consensus</span>
                </div>
                <div className={`w-11 h-11 rounded-lg flex items-center justify-center font-black text-lg text-white shadow-md border ${
                  game.metacritic.score >= 75 ? 'bg-emerald-600/90 border-emerald-400/40' :
                  game.metacritic.score >= 50 ? 'bg-amber-600/90 border-amber-400/40' :
                  'bg-red-600/90 border-red-400/40'
                }`}>
                  {game.metacritic.score}
                </div>
              </div>
            )}

            {/* HowLongToBeat Stats */}
            <HowLongToBeatSection gameTitle={game.title} />

            {/* System Requirements */}
            <SystemRequirementsSection requirements={game.pc_requirements} gameTitle={game.title} />

            {/* Launch Specifications Strip */}
            <div className="p-4 bg-[#121620] border border-white/[0.06] rounded-xl space-y-2.5">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Technical Specifications</span>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">Package Format:</span>
                  <span className="font-semibold text-slate-200">Pre-installed Archive</span>
                </div>
                <div className="flex justify-between py-1 border-b border-white/[0.04]">
                  <span className="text-slate-400">Engine:</span>
                  <span className="font-semibold text-slate-200">Aria2 Multi-stream (16x)</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-400">Installer:</span>
                  <span className="font-semibold text-slate-200">Direct Extract & Launch</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function parseSizeToBytes(sizeStr) {
  if (!sizeStr || typeof sizeStr !== 'string') return 0;
  const match = sizeStr.match(/([\d.]+)\s*(GB|MB|KB|TB)?/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = (match[2] || 'GB').toUpperCase();
  if (unit === 'TB') return val * 1024 * 1024 * 1024 * 1024;
  if (unit === 'GB') return val * 1024 * 1024 * 1024;
  if (unit === 'MB') return val * 1024 * 1024;
  if (unit === 'KB') return val * 1024;
  return val;
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 GB';
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return gb.toFixed(1) + ' GB';
  const mb = bytes / (1024 ** 2);
  return mb.toFixed(0) + ' MB';
}

function LibraryGameCard({ game, playtime, isRunning, onOpenOrRun, onOpenFile, onSelectGame, onDeleteGame, onEnrich, onOpenSaveBackups, onOpenArtworkPicker, onOpenExeSettings, onShowToast }) {
  const [imgSrc, setImgSrc] = useState(game.cover || game.coverFallback || game.header || game.banner || '');
  const [imgFailed, setImgFailed] = useState(false);
  const [metaFetchAttempted, setMetaFetchAttempted] = useState(false);

  useEffect(() => {
    setImgSrc(game.cover || game.coverFallback || game.header || game.banner || '');
    setImgFailed(false);
    setMetaFetchAttempted(false);
  }, [game.cover, game.coverFallback, game.header, game.banner, game.customArtwork]);

  useEffect(() => {
    const isMissingCover = !game.cover || game.cover.length === 0 || game.cover.includes('blank.gif') || game.cover.startsWith('data:image');
    if (!game.enriched && isMissingCover && window.api?.fetchMetadata) {
      let mounted = true;
      const searchTitle = game.cleanTitle || game.title;
      window.api.fetchMetadata(searchTitle).then(meta => {
        if (mounted && meta && onEnrich) {
          onEnrich(game.id, meta);
        }
      }).catch(() => {});
      return () => { mounted = false; };
    }
  }, [game.id, game.enriched, game.cover, game.cleanTitle, game.title, onEnrich]);

  const handleImgError = () => {
    if (game.coverFallback && imgSrc !== game.coverFallback) {
      setImgSrc(game.coverFallback);
    } else if (game.header && imgSrc !== game.header) {
      setImgSrc(game.header);
    } else if (game.banner && imgSrc !== game.banner) {
      setImgSrc(game.banner);
    } else if (game.originalCover && imgSrc !== game.originalCover) {
      setImgSrc(game.originalCover);
    } else if (window.api?.fetchMetadata && !metaFetchAttempted) {
      setMetaFetchAttempted(true);
      const searchTitle = game.cleanTitle || game.title;
      window.api.fetchMetadata(searchTitle).then(meta => {
        if (meta?.cover && meta.cover !== imgSrc) {
          setImgSrc(meta.cover);
          if (onEnrich) onEnrich(game.id, meta);
        } else if (meta?.header && meta.header !== imgSrc) {
          setImgSrc(meta.header);
          if (onEnrich) onEnrich(game.id, meta);
        } else if (meta?.coverFallback && meta.coverFallback !== imgSrc) {
          setImgSrc(meta.coverFallback);
          if (onEnrich) onEnrich(game.id, meta);
        } else {
          setImgFailed(true);
        }
      }).catch(() => setImgFailed(true));
    } else {
      setImgFailed(true);
    }
  };

  const playtimeSeconds = playtime?.totalSeconds || 0;
  const lastPlayedTime = playtime?.lastPlayed || (game.date ? new Date(game.date).getTime() : 0);

  return (
    <div className="group flex flex-col bg-[#121620] border border-white/[0.08] hover:border-blue-500/50 rounded-xl overflow-hidden shadow-sm hover:shadow-xl transition-all duration-200">
      {/* 2:3 Poster Frame */}
      <div 
        onClick={() => onSelectGame(game.id)}
        className="relative aspect-[2/3] overflow-hidden bg-[#151922] cursor-pointer"
      >
        {imgSrc && !imgFailed ? (
          <img 
            src={imgSrc} 
            alt={game.title} 
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={handleImgError}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-gradient-to-br from-[#182030] to-[#0d111a] text-center">
            <Gamepad2 className="w-10 h-10 text-blue-400 mb-2 opacity-80" />
            <span className="text-xs font-bold text-white line-clamp-3">{game.title}</span>
          </div>
        )}

        {/* Source Badge */}
        <div className="absolute top-2 left-2 z-10">
          <span className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded shadow-sm backdrop-blur-md border ${
            game.source === 'onlinefix' ? 'bg-emerald-950/85 text-emerald-300 border-emerald-500/40' :
            game.source === 'fitgirl' ? 'bg-pink-950/85 text-pink-300 border-pink-500/40' :
            game.source === 'dodi' ? 'bg-purple-950/85 text-purple-300 border-purple-500/40' :
            game.source === 'steamunlocked' ? 'bg-amber-950/85 text-amber-300 border-amber-500/40' :
            game.source === 'local' ? 'bg-indigo-950/85 text-indigo-300 border-indigo-500/40' :
            'bg-blue-950/85 text-blue-300 border-blue-500/40'
          }`}>
            {game.source === 'onlinefix' ? 'OnlineFix' : game.source === 'fitgirl' ? 'FitGirl' : game.source === 'dodi' ? 'DODI' : game.source === 'steamunlocked' ? 'SteamUnlocked' : game.source === 'local' ? 'Local' : 'SteamRIP'}
          </span>
        </div>

        {/* Live Running Indicator or Playtime Pill */}
        <div className="absolute top-2 right-2 z-10">
          {isRunning ? (
            <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-md bg-emerald-600 text-white text-[9px] font-extrabold shadow-lg backdrop-blur-md animate-pulse">
              <span className="w-1.5 h-1.5 rounded-full bg-white inline-block animate-ping" />
              <span>PLAYING</span>
            </div>
          ) : playtimeSeconds > 0 ? (
            <div className="flex items-center space-x-1 px-1.5 py-0.5 rounded-md bg-black/85 text-slate-200 text-[9px] font-semibold border border-white/10 backdrop-blur-md shadow-md">
              <Clock className="w-2.5 h-2.5 text-blue-400" />
              <span>{formatPlaytime(playtimeSeconds)}</span>
            </div>
          ) : null}
        </div>

        {/* Hover Action Overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center p-3">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenOrRun(game);
            }}
            className="w-12 h-12 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white flex items-center justify-center shadow-xl hover:scale-110 active:scale-95 transition-all cursor-pointer"
            title="Launch Game"
          >
            <Play className="w-6 h-6 fill-current ml-0.5" />
          </button>
        </div>
      </div>

      {/* Info & Action Footer */}
      <div className="p-3 flex-1 flex flex-col justify-between space-y-2.5">
        <div>
          <h3 
            onClick={() => onSelectGame(game.id)}
            className="text-xs font-bold text-white hover:text-blue-400 transition-colors truncate cursor-pointer" 
            title={game.title}
          >
            {game.title}
          </h3>
          <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
            <span className="truncate">{formatLastPlayed(lastPlayedTime)}</span>
            <span className="font-mono shrink-0">{game.totalSize || game.size || ''}</span>
          </div>
        </div>

        <div className="space-y-1.5 pt-1 border-t border-white/[0.05]">
          {/* Main Launch Button */}
          {isRunning ? (
            <button
              disabled
              className="w-full py-1.5 px-3 rounded-lg bg-emerald-600/90 text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-lg animate-pulse"
            >
              <Play className="w-3.5 h-3.5 fill-current" />
              <span>RUNNING NOW</span>
            </button>
          ) : (
            <button
              onClick={() => onOpenOrRun(game)}
              className="w-full py-1.5 px-3 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-xs flex items-center justify-center space-x-1.5 shadow-md hover:shadow-blue-500/25 transition-all active:scale-[0.98] group/launch cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-current group-hover/launch:scale-110 transition-transform" />
              <span>PLAY NOW</span>
            </button>
          )}

          {/* Quick Action Icons Row */}
          <div className="flex items-center justify-between pt-0.5 px-0.5">
            <button
              onClick={() => onOpenFile({ filePath: game.filePath, installDir: game.installDir, exePath: game.exePath })}
              className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] rounded-md transition-colors cursor-pointer"
              title="Open Installation Folder"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onOpenSaveBackups?.(game)}
              className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-md transition-colors cursor-pointer"
              title="Backup & Restore Game Saves (7-Zip)"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenArtworkPicker?.(game);
              }}
              className="p-1.5 text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-md transition-colors cursor-pointer"
              title="Customize Cover & Artwork (SteamGridDB)"
            >
              <ImageIcon className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenExeSettings?.(game);
              }}
              className="p-1.5 text-slate-400 hover:text-orange-400 hover:bg-orange-500/10 rounded-md transition-colors cursor-pointer"
              title="Executable & Launch Settings"
            >
              <Settings2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!window.api?.createDesktopShortcut) return;
                const res = await window.api.createDesktopShortcut({ game, exePath: game.exePath });
                if (res?.success) {
                  onShowToast?.(`Desktop shortcut created for "${game.title}"!`);
                } else {
                  onShowToast?.(res?.error || 'Failed to create shortcut');
                }
              }}
              className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-md transition-colors cursor-pointer"
              title="Create Windows Desktop Shortcut (.lnk)"
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (!window.api?.addToSteam) return;
                const res = await window.api.addToSteam({
                  title: game.title,
                  exePath: game.exePath,
                  installDir: game.installDir,
                  coverImage: game.cover || game.originalCover,
                  bannerImage: game.banner,
                  steamAppId: game.steamAppId || game.id
                });
                if (res?.success) {
                  onShowToast?.(`Added "${game.title}" to Steam! Restart Steam to see it.`);
                } else {
                  onShowToast?.(res?.error || 'Failed to add to Steam');
                }
              }}
              className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors cursor-pointer"
              title="Add to Steam Client"
            >
              <Sparkles className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onSelectGame(game.id)}
              className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors cursor-pointer"
              title="View Screenshots, Achievements, HLTB & Specs"
            >
              <Info className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onDeleteGame(game)}
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors cursor-pointer"
              title="Uninstall / Delete Game"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LibraryGameRow({ game, playtime, isRunning, onOpenOrRun, onOpenFile, onSelectGame, onDeleteGame, onOpenSaveBackups, onOpenArtworkPicker, onOpenExeSettings, onShowToast }) {
  const playtimeSeconds = playtime?.totalSeconds || 0;
  const lastPlayedTime = playtime?.lastPlayed || (game.date ? new Date(game.date).getTime() : 0);
  const coverUrl = game.cover || game.header || game.coverFallback || game.banner;

  return (
    <div className="p-3 rounded-xl bg-[#121620] border border-white/[0.06] hover:border-white/[0.12] flex items-center justify-between gap-4 transition-all group">
      <div className="flex items-center space-x-3.5 min-w-0">
        <div 
          onClick={() => onSelectGame(game.id)}
          className="w-12 h-16 rounded-lg bg-[#151922] overflow-hidden shrink-0 cursor-pointer border border-white/[0.06]"
        >
          {coverUrl ? (
            <img src={coverUrl} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-800 text-slate-500">
              <Gamepad2 className="w-5 h-5" />
            </div>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center space-x-2">
            <h4 
              onClick={() => onSelectGame(game.id)}
              className="text-sm font-bold text-white hover:text-blue-400 cursor-pointer truncate"
            >
              {game.title}
            </h4>
            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-white/[0.06] text-slate-400 border border-white/[0.06]">
              {game.source || 'Installed'}
            </span>
          </div>
          <div className="flex items-center space-x-3 text-xs text-slate-400 mt-1">
            <span className="flex items-center space-x-1 font-mono">
              <Clock className="w-3 h-3 text-blue-400" />
              <span>{formatPlaytime(playtimeSeconds)}</span>
            </span>
            <span>•</span>
            <span>{formatLastPlayed(lastPlayedTime)}</span>
            <span>•</span>
            <span className="font-mono text-slate-500">{game.totalSize || game.size || ''}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center space-x-2 shrink-0">
        {isRunning ? (
          <span className="px-3 py-1.5 rounded-lg bg-emerald-600/90 text-white font-bold text-xs flex items-center space-x-1.5 animate-pulse">
            <span className="w-2 h-2 rounded-full bg-white animate-ping" />
            <span>PLAYING</span>
          </span>
        ) : (
          <button
            onClick={() => onOpenOrRun(game)}
            className="px-4 py-1.5 rounded-lg bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold text-xs flex items-center space-x-1.5 shadow-md cursor-pointer transition-all active:scale-[0.98]"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            <span>PLAY</span>
          </button>
        )}
        <button
          onClick={() => onOpenSaveBackups?.(game)}
          className="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-md transition-colors cursor-pointer"
          title="Backup & Restore Game Saves (7-Zip)"
        >
          <Save className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenArtworkPicker?.(game);
          }}
          className="p-1.5 text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-md transition-colors cursor-pointer"
          title="Customize Cover & Artwork (SteamGridDB)"
        >
          <ImageIcon className="w-4 h-4" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOpenExeSettings?.(game);
          }}
          className="p-1.5 text-slate-400 hover:text-orange-400 hover:bg-orange-500/10 rounded-md transition-colors cursor-pointer"
          title="Executable & Launch Settings"
        >
          <Settings2 className="w-4 h-4" />
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            if (!window.api?.createDesktopShortcut) return;
            const res = await window.api.createDesktopShortcut({ game, exePath: game.exePath });
            if (res?.success) {
              onShowToast?.(`Desktop shortcut created for "${game.title}"!`);
            } else {
              onShowToast?.(res?.error || 'Failed to create shortcut');
            }
          }}
          className="p-1.5 text-slate-400 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-md transition-colors cursor-pointer"
          title="Create Windows Desktop Shortcut (.lnk)"
        >
          <Monitor className="w-4 h-4" />
        </button>
        <button
          onClick={async (e) => {
            e.stopPropagation();
            if (!window.api?.addToSteam) return;
            const res = await window.api.addToSteam({
              title: game.title,
              exePath: game.exePath,
              installDir: game.installDir,
              coverImage: game.cover || game.originalCover,
              bannerImage: game.banner,
              steamAppId: game.steamAppId || game.id
            });
            if (res?.success) {
              onShowToast?.(`Added "${game.title}" to Steam! Restart Steam to see it.`);
            } else {
              onShowToast?.(res?.error || 'Failed to add to Steam');
            }
          }}
          className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors cursor-pointer"
          title="Add to Steam Client"
        >
          <Sparkles className="w-4 h-4" />
        </button>
        <button
          onClick={() => onOpenFile({ filePath: game.filePath, installDir: game.installDir, exePath: game.exePath })}
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] rounded-md transition-colors cursor-pointer"
          title="Open Folder"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
        <button
          onClick={() => onSelectGame(game.id)}
          className="p-1.5 text-slate-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-md transition-colors cursor-pointer"
          title="Details"
        >
          <Info className="w-4 h-4" />
        </button>
        <button
          onClick={() => onDeleteGame(game)}
          className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors cursor-pointer"
          title="Uninstall"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function LibraryPage({ 
  games = [], 
  playtimeMap = {}, 
  runningGames = [], 
  onOpenOrRun, 
  onOpenFile, 
  onOpenFolder, 
  onDeleteGame, 
  onSelectGame, 
  onExploreStore, 
  onAddLocalGame, 
  onVerifyDisk,
  onEnrich,
  onOpenSaveBackups,
  onOpenArtworkPicker,
  onOpenExeSettings,
  onShowToast
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState('playtime');
  const [viewMode, setViewMode] = useState('grid');
  const [isVerifying, setIsVerifying] = useState(false);

  const totalPlaytimeSeconds = games.reduce((acc, g) => {
    const sec = playtimeMap[g.id]?.totalSeconds || playtimeMap[g.title]?.totalSeconds || 0;
    return acc + sec;
  }, 0);

  const totalStorageBytes = games.reduce((acc, g) => {
    return acc + parseSizeToBytes(g.totalSize || g.size || '');
  }, 0);

  const handleVerify = async () => {
    if (!onVerifyDisk) return;
    setIsVerifying(true);
    try {
      await onVerifyDisk();
    } finally {
      setTimeout(() => setIsVerifying(false), 600);
    }
  };

  const filteredAndSortedGames = games
    .filter(g => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (g.title && g.title.toLowerCase().includes(q)) || 
             (g.source && g.source.toLowerCase().includes(q)) ||
             (g.filename && g.filename.toLowerCase().includes(q));
    })
    .sort((a, b) => {
      if (sortBy === 'playtime') {
        const secA = playtimeMap[a.id]?.totalSeconds || playtimeMap[a.title]?.totalSeconds || 0;
        const secB = playtimeMap[b.id]?.totalSeconds || playtimeMap[b.title]?.totalSeconds || 0;
        return secB - secA;
      }
      if (sortBy === 'recent') {
        const timeA = playtimeMap[a.id]?.lastPlayed || playtimeMap[a.title]?.lastPlayed || 0;
        const timeB = playtimeMap[b.id]?.lastPlayed || playtimeMap[b.title]?.lastPlayed || 0;
        return timeB - timeA;
      }
      if (sortBy === 'name') {
        return (a.title || '').localeCompare(b.title || '');
      }
      if (sortBy === 'size') {
        const bytesA = parseSizeToBytes(a.totalSize || a.size || '');
        const bytesB = parseSizeToBytes(b.totalSize || b.size || '');
        return bytesB - bytesA;
      }
      return 0;
    });

  const activeRunningNow = runningGames.length > 0;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* 1. STEAM/HYDRA STYLE LIBRARY METRICS HERO */}
      <div className="bg-[#121620] border border-white/[0.08] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="space-y-1.5">
          <div className="flex items-center space-x-3">
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center space-x-2">
              <Library className="w-5 h-5 text-blue-400" />
              <span>Installed Games</span>
            </h1>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
              {games.length} {games.length === 1 ? 'Release' : 'Releases'} Ready
            </span>
            {activeRunningNow && (
              <span className="flex items-center space-x-1.5 text-[11px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span>Session Active</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-4 text-xs text-slate-400">
            <span className="flex items-center space-x-1.5">
              <Clock className="w-3.5 h-3.5 text-blue-400" />
              <span>Total Playtime: <strong className="text-slate-200 font-mono">{formatPlaytime(totalPlaytimeSeconds)}</strong></span>
            </span>
            <span>•</span>
            <span className="flex items-center space-x-1.5">
              <HardDrive className="w-3.5 h-3.5 text-slate-400" />
              <span>Disk Footprint: <strong className="text-slate-200 font-mono">{formatBytes(totalStorageBytes)}</strong></span>
            </span>
          </div>
        </div>

        {/* Quick Library Actions */}
        <div className="flex items-center space-x-2 flex-wrap gap-y-2">
          <button
            onClick={onAddLocalGame}
            className="px-3 py-1.5 bg-[#171c26] hover:bg-[#202736] border border-white/[0.08] hover:border-blue-500/40 text-slate-200 hover:text-white text-xs font-semibold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
            title="Import an installed executable (.exe) or shortcut"
          >
            <Plus className="w-3.5 h-3.5 text-blue-400" />
            <span>Add Game (.exe)</span>
          </button>
          <button
            onClick={handleVerify}
            disabled={isVerifying}
            className="px-3 py-1.5 bg-[#171c26] hover:bg-[#202736] border border-white/[0.08] text-slate-300 hover:text-white text-xs font-semibold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm disabled:opacity-60"
            title="Verify integrity of installed files on disk"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${isVerifying ? 'animate-spin text-blue-400' : ''}`} />
            <span>{isVerifying ? 'Verifying...' : 'Verify Files'}</span>
          </button>
          <button
            onClick={() => onOpenFolder()}
            className="px-3 py-1.5 bg-[#171c26] hover:bg-[#202736] border border-white/[0.08] text-slate-300 hover:text-white text-xs font-semibold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer shadow-sm"
            title="Open default game install folder in Explorer"
          >
            <FolderOpen className="w-3.5 h-3.5 text-slate-400" />
            <span>Open Folder</span>
          </button>
          <button
            onClick={onExploreStore}
            className="px-3.5 py-1.5 bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs font-semibold rounded-lg transition-all flex items-center space-x-1.5 cursor-pointer shadow-md shadow-blue-500/20"
          >
            <Compass className="w-3.5 h-3.5" />
            <span>Explore Store</span>
          </button>
        </div>
      </div>

      {/* 2. FILTER & SORT TOOLBAR */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#0e1117] p-2.5 rounded-xl border border-white/[0.06]">
        {/* Search input */}
        <div className="relative w-full sm:w-80">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter installed games..."
            className="w-full bg-[#141822] border border-white/[0.08] focus:border-blue-500/80 focus:bg-[#181e2b] rounded-lg py-1.5 pl-8 pr-7 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 rounded cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Controls right: Actions, Sort dropdown & View switcher */}
        <div className="flex items-center space-x-2.5 w-full sm:w-auto justify-between sm:justify-end">
          <button
            onClick={onAddLocalGame}
            className="px-3 py-2 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.08] hover:border-white/[0.15] text-slate-200 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm"
            title="Import an existing installed game executable from your PC"
          >
            <Plus className="w-3.5 h-3.5 text-emerald-400" />
            <span>Add Local Game</span>
          </button>

          <button
            onClick={handleVerify}
            disabled={isVerifying}
            className="px-3 py-2 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.08] hover:border-white/[0.15] text-slate-200 text-xs font-semibold rounded-lg flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm disabled:opacity-50"
            title="Scan installation paths to verify game files exist on disk"
          >
            <FolderCheck className={`w-3.5 h-3.5 text-blue-400 ${isVerifying ? 'animate-spin' : ''}`} />
            <span>{isVerifying ? 'Verifying...' : 'Verify Files'}</span>
          </button>

          <div className="flex items-center space-x-1.5 text-xs text-slate-400">
            <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="bg-[#141822] border border-white/[0.08] text-slate-300 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              <option value="playtime">Most Played</option>
              <option value="recent">Recently Played</option>
              <option value="name">Alphabetical (A - Z)</option>
              <option value="size">Size (Largest)</option>
            </select>
          </div>

          <div className="flex items-center bg-[#141822] p-0.5 rounded-lg border border-white/[0.08]">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'grid' ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Grid View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-1.5 rounded-md transition-all cursor-pointer ${
                viewMode === 'list' ? 'bg-[#2563eb] text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
              title="List View"
            >
              <List className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. CONTENT: GRID OR LIST OR EMPTY */}
      {games.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4 bg-[#10141d]/50 border border-white/[0.06] rounded-2xl p-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-900/30 to-slate-800/40 border border-blue-500/20 flex items-center justify-center text-blue-400 shadow-xl">
            <Gamepad2 className="w-8 h-8" />
          </div>
          <div className="space-y-1.5 max-w-md">
            <h3 className="text-lg font-bold text-white">Your Game Library is Empty</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              You haven't installed any games yet. Browse thousands of pre-installed and repacked games across FitGirl, OnlineFix, DODI, SteamRIP, and SteamUnlocked in the Store to build your collection.
            </p>
          </div>
          <div className="flex items-center space-x-3 pt-2">
            <button
              onClick={onExploreStore}
              className="px-5 py-2.5 bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold text-xs rounded-xl shadow-lg shadow-blue-500/25 transition-all flex items-center space-x-2 cursor-pointer active:scale-[0.98]"
            >
              <Compass className="w-4 h-4" />
              <span>Browse Store Catalog</span>
            </button>
            <button
              onClick={onAddLocalGame}
              className="px-4 py-2.5 bg-[#171c26] hover:bg-[#202736] border border-white/[0.08] text-slate-300 hover:text-white font-semibold text-xs rounded-xl transition-all flex items-center space-x-1.5 cursor-pointer"
            >
              <Plus className="w-4 h-4 text-blue-400" />
              <span>Add Local Game (.exe)</span>
            </button>
          </div>
        </div>
      ) : filteredAndSortedGames.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-3 bg-[#10141d]/30 border border-white/[0.06] rounded-2xl p-6">
          <Library className="w-10 h-10 text-slate-600" />
          <p className="text-sm font-semibold text-slate-300">No installed games match "{searchQuery}"</p>
          <button
            onClick={() => setSearchQuery('')}
            className="px-4 py-1.5 bg-[#171c26] hover:bg-[#202736] border border-white/[0.08] text-xs font-semibold text-slate-200 rounded-lg transition-all cursor-pointer"
          >
            Clear Filter
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
          {filteredAndSortedGames.map(game => (
            <LibraryGameCard
              key={game.id}
              game={game}
              playtime={playtimeMap[game.id] || playtimeMap[game.title]}
              isRunning={runningGames.some(r => r.gameKey === game.id || r.gameKey === game.title)}
              onOpenOrRun={onOpenOrRun}
              onOpenFile={onOpenFile}
              onSelectGame={onSelectGame}
              onDeleteGame={onDeleteGame}
              onEnrich={onEnrich}
              onOpenSaveBackups={onOpenSaveBackups}
              onOpenArtworkPicker={onOpenArtworkPicker}
              onOpenExeSettings={onOpenExeSettings}
              onShowToast={onShowToast}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredAndSortedGames.map(game => (
            <LibraryGameRow
              key={game.id}
              game={game}
              playtime={playtimeMap[game.id] || playtimeMap[game.title]}
              isRunning={runningGames.some(r => r.gameKey === game.id || r.gameKey === game.title)}
              onOpenOrRun={onOpenOrRun}
              onOpenFile={onOpenFile}
              onSelectGame={onSelectGame}
              onDeleteGame={onDeleteGame}
              onOpenSaveBackups={onOpenSaveBackups}
              onOpenArtworkPicker={onOpenArtworkPicker}
              onOpenExeSettings={onOpenExeSettings}
              onShowToast={onShowToast}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DownloadsPage({ 
  downloads, 
  onCancel, 
  onRetry,
  onOpenFolder, 
  onOpenFile, 
  onOpenOrRun,
  onDeleteGame,
  onClearCompleted,
  onVerifyDisk,
  onSelectGame, 
  onExploreLibrary 
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState('all');
  const [isVerifying, setIsVerifying] = useState(false);

  const activeDownloads = downloads.filter(d => d.status !== 'completed');
  const completedDownloads = downloads.filter(d => d.status === 'completed');

  const activeSpeeds = activeDownloads.map(d => d.speed).filter(Boolean);
  const isAnyExtracting = activeDownloads.some(d => d.status === 'extracting');
  const aggregateSpeed = isAnyExtracting ? '7-Zip Unpacking Active' : (activeSpeeds.length > 0 ? activeSpeeds[0] : '0 B/s');

  const totalStorageBytes = completedDownloads.reduce((acc, curr) => {
    return acc + parseSizeToBytes(curr.totalSize || curr.size || '');
  }, 0);
  const totalStorageStr = formatBytes(totalStorageBytes);

  const handleManualVerify = async () => {
    setIsVerifying(true);
    try {
      if (onVerifyDisk) await onVerifyDisk();
    } finally {
      setTimeout(() => setIsVerifying(false), 500);
    }
  };

  const filteredCompleted = completedDownloads.filter(item => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (item.title && item.title.toLowerCase().includes(q)) || 
           (item.filename && item.filename.toLowerCase().includes(q));
  });

  const filteredActive = activeDownloads.filter(item => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (item.title && item.title.toLowerCase().includes(q)) || 
           (item.filename && item.filename.toLowerCase().includes(q));
  });

  const showActive = filterTab === 'all' || filterTab === 'active';
  const showCompleted = filterTab === 'all' || filterTab === 'completed';

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* 1. STEAM-STYLE METRICS & ACTIONS STRIP */}
      <div className="bg-[#121620] border border-white/[0.08] rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="space-y-1">
          <div className="flex items-center space-x-2.5">
            <h1 className="text-xl font-bold tracking-tight text-white">Downloads Manager</h1>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-500/15 text-blue-400 border border-blue-500/30">
              16x Parallel Engine
            </span>
          </div>
          <div className="flex items-center space-x-3 text-xs text-slate-400">
            <span className="flex items-center space-x-1.5 font-mono font-bold text-slate-200">
              <span className={`w-2 h-2 rounded-full ${isAnyExtracting ? 'bg-purple-400 animate-pulse' : activeDownloads.length > 0 ? 'bg-blue-400' : 'bg-emerald-500'}`} />
              <span>{activeDownloads.length > 0 ? aggregateSpeed : 'Engine Idle'}</span>
            </span>
            <span>•</span>
            <span>{totalStorageStr} on Disk</span>
            <span>•</span>
            <span>{completedDownloads.length} Installed Games</span>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex items-center space-x-2.5 shrink-0">
          <button 
            onClick={() => {
              const firstDir = downloads.find(d => d.installDir)?.installDir;
              onOpenFolder(firstDir);
            }}
            className="flex items-center space-x-2 px-3.5 py-2 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.1] text-white text-xs font-semibold rounded-lg transition-all"
            title="Open Charon Games Folder"
          >
            <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
            <span>Open Folder</span>
          </button>

          <button 
            onClick={handleManualVerify}
            disabled={isVerifying}
            className="p-2 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.1] text-slate-300 hover:text-white rounded-lg transition-all"
            title="Verify Disk Files"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin text-blue-400' : ''}`} />
          </button>

          {completedDownloads.length > 0 && (
            <button 
              onClick={onClearCompleted}
              className="flex items-center space-x-1.5 px-3 py-2 bg-[#1c2230] hover:bg-red-500/15 border border-white/[0.1] hover:border-red-500/30 text-slate-300 hover:text-red-400 text-xs font-semibold rounded-lg transition-all"
              title="Clear completed downloads from history"
            >
              <XCircle className="w-3.5 h-3.5" />
              <span>Clear Finished</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. FILTER TABS & SEARCH */}
      {downloads.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="inline-flex bg-[#121620] p-1 rounded-lg border border-white/[0.08]">
            <button
              onClick={() => setFilterTab('all')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                filterTab === 'all' 
                  ? 'bg-[#2563eb] text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({downloads.length})
            </button>
            <button
              onClick={() => setFilterTab('active')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                filterTab === 'active' 
                  ? 'bg-[#2563eb] text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Active ({activeDownloads.length})
            </button>
            <button
              onClick={() => setFilterTab('completed')}
              className={`px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                filterTab === 'completed' 
                  ? 'bg-[#2563eb] text-white shadow-sm' 
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Installed ({completedDownloads.length})
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input 
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter downloads..."
              className="w-full bg-[#121620] border border-white/[0.08] rounded-lg py-1.5 pl-8 pr-7 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. ACTIVE TRANSFERS QUEUE */}
      {showActive && filteredActive.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-2">
            <span>Downloads & Transfers ({filteredActive.length})</span>
          </h2>
          <div className="space-y-2.5">
            {filteredActive.map(item => {
              const isItemExtracting = item.status === 'extracting';
              const isFailed = item.status === 'failed' || item.status === 'error';
              return (
                <div 
                  key={item.id} 
                  className={`bg-[#121620] border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-4 transition-colors ${
                    isFailed ? 'border-red-500/30 hover:border-red-500/50' : 'border-white/[0.08]'
                  }`}
                >
                  {/* Thumbnail */}
                  <div 
                    className="w-14 h-20 rounded-lg overflow-hidden bg-[#181d28] shrink-0 border border-white/[0.08] cursor-pointer relative"
                    onClick={() => onSelectGame && onSelectGame(item.id)}
                  >
                    {item.cover ? (
                      <img src={item.cover} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        {isFailed ? <AlertTriangle className="w-5 h-5 text-red-400" /> : isItemExtracting ? <Zap className="w-5 h-5 text-purple-400" /> : <Download className="w-5 h-5" />}
                      </div>
                    )}
                    {isItemExtracting && (
                      <div className="absolute inset-0 bg-purple-950/40 backdrop-blur-[1px] flex items-center justify-center">
                        <RefreshCw className="w-5 h-5 text-purple-300 animate-spin" />
                      </div>
                    )}
                  </div>

                  {/* Info & Metrics */}
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center space-x-2">
                          <h3 
                            className="font-bold text-sm text-white truncate cursor-pointer hover:text-blue-400 transition-colors"
                            onClick={() => onSelectGame && onSelectGame(item.id)}
                          >
                            {item.title}
                          </h3>
                          {isFailed && (
                            <span className="px-2 py-0.5 rounded bg-red-500/20 border border-red-500/40 text-[10px] font-bold text-red-400 flex items-center gap-1">
                              FAILED
                            </span>
                          )}
                          {isItemExtracting && (
                            <span className="px-2 py-0.5 rounded bg-purple-500/20 border border-purple-500/40 text-[10px] font-bold text-purple-300 flex items-center gap-1">
                              <Zap className="w-2.5 h-2.5 text-purple-400" />
                              UNPACKING
                            </span>
                          )}
                        </div>
                        <div className="flex items-center space-x-2 text-[11px] text-slate-400 font-mono mt-0.5">
                          <span className="truncate max-w-xs">{item.filename || 'Downloading package...'}</span>
                          {item.installDir && (
                            <span>• {item.installDir}</span>
                          )}
                        </div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="flex items-center space-x-2 justify-end">
                          <span className={`text-sm font-mono font-bold ${
                            isFailed 
                              ? 'text-red-400' 
                              : isItemExtracting 
                                ? 'text-purple-400' 
                                : 'text-blue-400'
                          }`}>
                            {isFailed ? 'Failed' : (item.speed || (isItemExtracting ? 'Decompressing...' : 'Connecting...'))}
                          </span>
                          <span className="text-xs font-mono font-bold text-slate-200">{item.progress || 0}%</span>
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                          {isFailed ? (
                            <span className="text-red-400/90 font-sans">{item.eta || 'Click Retry to restart download'}</span>
                          ) : isItemExtracting ? (
                            <span className="text-purple-300/80">7-Zip Multi-Threaded Unpack</span>
                          ) : (
                            <>
                              {item.downloaded && item.totalSize ? `${item.downloaded} / ${item.totalSize}` : ''}
                              {item.eta ? ` • ETA ${item.eta}` : ''}
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-2 bg-[#1a202c] rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-200 ${
                          isFailed 
                            ? 'bg-red-500/70' 
                            : isItemExtracting 
                              ? 'bg-gradient-to-r from-purple-600 to-indigo-500' 
                              : 'bg-blue-500'
                        }`} 
                        style={{ width: `${Math.max(item.progress || 0, isFailed ? 100 : 1)}%` }} 
                      />
                    </div>
                  </div>

                  {/* Actions (Retry / Cancel) */}
                  <div className="shrink-0 self-end sm:self-center flex items-center space-x-2">
                    {isFailed && (
                      <button 
                        onClick={() => onRetry && onRetry(item)}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-all shadow-sm active:scale-95"
                        title="Retry Download"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    )}
                    <button 
                      onClick={() => onCancel(item.id)}
                      className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                      title={isFailed ? 'Dismiss / Clear' : 'Cancel'}
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 4. COMPLETED DOWNLOADS LIST */}
      {showCompleted && filteredCompleted.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center space-x-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              <span>Installed Games ({filteredCompleted.length})</span>
            </h2>
            <span className="text-[11px] text-slate-500">Live Disk Tracking Active</span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredCompleted.map(item => (
              <div 
                key={item.id} 
                className="bg-[#121620] border border-white/[0.08] hover:border-white/[0.14] rounded-xl p-3.5 flex items-center gap-3.5 transition-colors"
              >
                {/* Cover Thumbnail */}
                <div 
                  className="w-14 h-20 rounded-lg overflow-hidden bg-[#181d28] shrink-0 border border-white/[0.08] cursor-pointer"
                  onClick={() => onSelectGame && onSelectGame(item.id)}
                >
                  {item.cover ? (
                    <img src={item.cover} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                      <Library className="w-5 h-5" />
                    </div>
                  )}
                </div>

                {/* Game Info */}
                <div className="flex-1 min-w-0">
                  <h3 
                    className="font-bold text-sm text-white truncate cursor-pointer hover:text-blue-400 transition-colors"
                    onClick={() => onSelectGame && onSelectGame(item.id)}
                  >
                    {item.title}
                  </h3>
                  <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{item.filename || 'Game Package'}</p>

                  <div className="flex items-center space-x-2 mt-2">
                    <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-[10px] font-bold text-emerald-400">
                      ON DISK
                    </span>
                    {item.totalSize && (
                      <span className="text-[10px] font-mono text-slate-300">
                        {item.totalSize}
                      </span>
                    )}
                    {item.installDir && (
                      <span className="text-[10px] font-mono text-slate-400 truncate max-w-[130px]" title={item.installDir}>
                        • {item.installDir}
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions: PLAY, FOLDER, DELETE */}
                <div className="flex flex-col space-y-1.5 shrink-0">
                  <button 
                    onClick={() => onOpenOrRun && onOpenOrRun(item)}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-md transition-all flex items-center justify-center space-x-1.5 active:scale-[0.98]"
                    title="Launch / Open Game Package"
                  >
                    <Play className="w-3 h-3 fill-current" />
                    <span>PLAY</span>
                  </button>

                  <div className="flex items-center space-x-1">
                    <button 
                      onClick={() => onOpenFile({ filename: item.filename, installDir: item.installDir })}
                      className="px-2 py-1 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.08] text-[11px] font-semibold text-slate-300 hover:text-white rounded-md transition-all flex items-center space-x-1"
                      title="Show in Windows Explorer"
                    >
                      <FolderOpen className="w-3 h-3 text-blue-400" />
                      <span>Folder</span>
                    </button>

                    <button 
                      onClick={() => onDeleteGame && onDeleteGame(item)}
                      className="p-1 bg-[#1c2230] hover:bg-red-500/15 border border-white/[0.08] hover:border-red-500/30 text-slate-400 hover:text-red-400 rounded-md transition-all"
                      title="Delete game files from disk"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. EMPTY STATES */}
      {downloads.length === 0 && (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-3">
          <div className="w-14 h-14 rounded-2xl bg-[#121620] border border-white/[0.08] flex items-center justify-center text-slate-600">
            <Download className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-bold text-white">No Downloads Yet</h3>
            <p className="text-xs text-slate-400 max-w-sm">Browse the Store catalog to download games at 16x accelerated speeds.</p>
          </div>
          <button 
            onClick={onExploreLibrary}
            className="mt-2 px-5 py-2 bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-semibold text-xs rounded-lg transition-all cursor-pointer shadow-md"
          >
            Browse Store
          </button>
        </div>
      )}
    </div>
  );
}

function InstallModal({ game, isOpen, onClose, onConfirm }) {
  const [drives, setDrives] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedDrive, setSelectedDrive] = useState(null);
  const [saveAsDefault, setSaveAsDefault] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    let mounted = true;

    if (window.api && window.api.getSystemDrives) {
      window.api.getSystemDrives().then((list) => {
        if (!mounted) return;
        setDrives(list || []);
        
        const savedDrive = localStorage.getItem('charon_default_drive');
        let initial = list?.find(d => d.drive.toUpperCase() === (savedDrive || '').toUpperCase());
        if (!initial && list && list.length > 0) {
          initial = list[0];
        }
        setSelectedDrive(initial || null);
        setLoading(false);
      }).catch((err) => {
        console.error('Failed to query drives:', err);
        if (mounted) setLoading(false);
      });
    } else {
      setLoading(false);
    }

    return () => { mounted = false; };
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !game) return null;

  const reqBytes = parseSizeToBytes(game.size);
  const hasEnoughSpace = !selectedDrive || reqBytes === 0 || selectedDrive.freeBytes >= reqBytes;

  const handleInstallClick = () => {
    if (!selectedDrive) return;
    if (saveAsDefault) {
      localStorage.setItem('charon_default_drive', selectedDrive.drive);
    }
    onConfirm(selectedDrive.targetPath, saveAsDefault ? selectedDrive.drive : null);
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#121620] border border-white/[0.1] rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between bg-[#0e1117]">
          <div className="flex items-center space-x-2.5">
            <HardDrive className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-bold text-white">Install {game.title}</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* Storage comparison */}
          <div className="grid grid-cols-2 gap-3 p-3 bg-[#0c0e14] border border-white/[0.06] rounded-lg text-xs">
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Space Required</span>
              <span className="font-mono font-bold text-slate-200 text-sm">{game.size || 'Pre-installed'}</span>
            </div>
            <div>
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Space Available</span>
              <span className={`font-mono font-bold text-sm ${selectedDrive && !hasEnoughSpace ? 'text-red-400' : 'text-emerald-400'}`}>
                {selectedDrive ? selectedDrive.freeFormatted : '--'}
              </span>
            </div>
          </div>

          {/* Drive selector */}
          <div>
            <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-2">
              Select Installation Drive
            </label>

            {loading ? (
              <div className="py-6 flex flex-col items-center justify-center space-y-2 text-slate-400">
                <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs">Detecting system drives...</span>
              </div>
            ) : drives.length === 0 ? (
              <div className="p-3 bg-[#0c0e14] border border-white/[0.06] rounded-lg text-center text-xs text-slate-400">
                No storage drives detected.
              </div>
            ) : (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {drives.map((d) => {
                  const isSelected = selectedDrive?.drive === d.drive;
                  const isLow = d.usedPercent > 90;
                  return (
                    <div 
                      key={d.drive}
                      onClick={() => setSelectedDrive(d)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected 
                          ? 'bg-blue-600/10 border-blue-500' 
                          : 'bg-[#0c0e14] border-white/[0.06] hover:border-white/[0.14]'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center space-x-2">
                          <HardDrive className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-400' : 'text-slate-400'}`} />
                          <span className="font-bold text-xs text-white">{d.name}</span>
                          <span className="text-[11px] text-slate-400 font-mono">({d.freeFormatted} free)</span>
                        </div>
                        {isSelected && (
                          <span className="text-[10px] font-bold text-blue-400">Selected</span>
                        )}
                      </div>

                      {/* Storage Bar */}
                      <div className="w-full h-1.5 bg-[#1a202c] rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full ${isLow ? 'bg-amber-500' : isSelected ? 'bg-blue-500' : 'bg-slate-600'}`}
                          style={{ width: `${Math.min(100, d.usedPercent)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500 font-mono">
                        <span>Used: {d.usedPercent}%</span>
                        <span>Total: {d.totalFormatted}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Target Folder preview */}
          {selectedDrive && (
            <div className="p-2.5 bg-[#0c0e14] border border-white/[0.06] rounded-lg flex items-center justify-between text-xs">
              <div className="flex items-center space-x-2 truncate mr-2">
                <FolderOpen className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                <span className="text-slate-400">Target Folder:</span>
                <span className="font-mono text-slate-200 font-semibold truncate">{selectedDrive.targetPath}</span>
              </div>
              <span className="text-[10px] font-bold text-blue-400 shrink-0">
                {selectedDrive.folderExists ? 'Existing Directory' : 'Will Create Folder'}
              </span>
            </div>
          )}

          {/* Insufficient Storage Alert */}
          {selectedDrive && !hasEnoughSpace && (
            <div className="p-2.5 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center space-x-2 text-xs text-red-400">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Not enough free space on {selectedDrive.drive} for this game ({game.size}).</span>
            </div>
          )}

          {/* Remember Default Checkbox */}
          <div className="flex items-center space-x-2 pt-1">
            <input 
              type="checkbox"
              id="saveDefaultDrive"
              checked={saveAsDefault}
              onChange={(e) => setSaveAsDefault(e.target.checked)}
              className="rounded bg-[#0c0e14] border-white/[0.1] text-blue-600 focus:ring-0 cursor-pointer"
            />
            <label htmlFor="saveDefaultDrive" className="text-xs text-slate-400 cursor-pointer select-none">
              Remember this drive as default for future downloads
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.06] bg-[#0e1117] flex items-center justify-end space-x-2.5">
          <button 
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleInstallClick}
            disabled={!selectedDrive || !hasEnoughSpace}
            className="px-5 py-1.5 bg-[#2563eb] hover:bg-[#1d4ed8] disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-all flex items-center space-x-1.5 shadow-sm active:scale-[0.98]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Install</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteModal({ game, isOpen, onClose, onConfirm }) {
  const [deleteFromDisk, setDeleteFromDisk] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !game) return null;

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm(game, deleteFromDisk);
    } finally {
      setIsDeleting(false);
      onClose();
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#121620] border border-white/[0.1] rounded-xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between bg-[#0e1117]">
          <div className="flex items-center space-x-2.5">
            <Trash2 className="w-4 h-4 text-red-400" />
            <h2 className="text-sm font-bold text-white">Delete Download</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          <div className="p-3 bg-[#0c0e14] border border-white/[0.06] rounded-lg flex items-center space-x-3">
            {game.cover ? (
              <img src={game.cover} alt="" className="w-12 h-16 rounded object-cover bg-[#181d28] border border-white/[0.08] shrink-0" />
            ) : (
              <div className="w-12 h-16 rounded bg-[#181d28] border border-white/[0.08] flex items-center justify-center text-slate-600 shrink-0">
                <Library className="w-5 h-5" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-xs text-white truncate">{game.title}</h3>
              <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">{game.filename || 'Game package'}</p>
              <div className="text-[10px] text-slate-400 font-mono mt-1">
                <span>Size: <strong className="text-slate-200">{game.totalSize || game.size || 'Unknown'}</strong></span>
              </div>
            </div>
          </div>

          <p className="text-xs text-slate-300">
            Are you sure you want to remove <strong className="text-white">{game.title}</strong>?
          </p>

          <label className="flex items-start space-x-2.5 p-3 bg-red-500/10 border border-red-500/20 rounded-lg cursor-pointer select-none">
            <input 
              type="checkbox" 
              checked={deleteFromDisk}
              onChange={(e) => setDeleteFromDisk(e.target.checked)}
              className="mt-0.5 rounded bg-[#0c0e14] border-white/[0.1] text-red-500 focus:ring-0 cursor-pointer"
            />
            <div className="text-xs">
              <span className="font-bold text-red-300 block">Delete files permanently from drive</span>
              <span className="text-red-400/80 text-[11px]">Frees disk storage by removing the downloaded archive.</span>
            </div>
          </label>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.06] bg-[#0e1117] flex items-center justify-end space-x-2.5">
          <button 
            onClick={onClose}
            disabled={isDeleting}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleConfirm}
            disabled={isDeleting}
            className="px-5 py-1.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-bold text-xs rounded-lg transition-all flex items-center space-x-1.5 shadow-sm active:scale-[0.98]"
          >
            {isDeleting ? (
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
            <span>{isDeleting ? 'Deleting...' : 'Delete'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ChangelogModal({ isOpen, onClose, version, releaseNotes, status, onUpdate, onRestart }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#121620] border border-white/[0.1] rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/[0.06] flex items-center justify-between bg-[#0e1117]">
          <div className="flex items-center space-x-2.5">
            <Sparkles className="w-4 h-4 text-blue-400" />
            <h2 className="text-sm font-bold text-white">What's New in Charon v{version || '1.0.0'}</h2>
          </div>
          <button 
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs text-slate-300 leading-relaxed">
          {releaseNotes ? (
            <div className="p-3.5 bg-[#0c0e14] border border-white/[0.06] rounded-lg">
              <h4 className="font-bold text-white text-xs mb-2">Release Notes</h4>
              <div className="prose prose-invert max-w-none whitespace-pre-wrap font-sans text-slate-300 text-xs">
                {typeof releaseNotes === 'string' ? releaseNotes : JSON.stringify(releaseNotes, null, 2)}
              </div>
            </div>
          ) : null}

          {/* Highlights */}
          <div className="p-3.5 bg-blue-600/10 border border-blue-500/20 rounded-lg space-y-2">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">Key Highlights</span>
            </div>
            <ul className="list-disc list-inside space-y-1.5 text-slate-300 text-[11px]">
              <li><strong className="text-white">Smart In-App Updates:</strong> Silent background checks & instant differential updates.</li>
              <li><strong className="text-white">16-Connection Engine:</strong> Aria2 C++ turbo speed download acceleration.</li>
              <li><strong className="text-white">Drive Manager:</strong> Steam-style drive selector with disk space alerts & auto-tracker.</li>
              <li><strong className="text-white">Dual Catalogs:</strong> SteamRIP & SteamUnlocked verified index with rapid pagination.</li>
              <li><strong className="text-white">Storage Hygiene:</strong> Complete disk deletion and integrity verification.</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-white/[0.06] bg-[#0e1117] flex items-center justify-end space-x-2.5">
          <button 
            onClick={onClose}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            Close
          </button>
          {status === 'downloaded' ? (
            <button 
              onClick={() => { onClose(); onRestart(); }}
              className="px-5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-lg transition-all flex items-center space-x-1.5 shadow-sm active:scale-[0.98] cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Restart & Apply Update</span>
            </button>
          ) : status === 'available' ? (
            <button 
              onClick={() => { onClose(); onUpdate(); }}
              className="px-5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition-all flex items-center space-x-1.5 shadow-sm active:scale-[0.98] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Update Now</span>
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ==========================================================
// MEDIA GALLERY & SCREENSHOT SLIDER (HYDRA-PARITY)
// ==========================================================
function GallerySlider({ screenshots = [], movies = [], banner = '', title = '' }) {
  const mediaItems = [];
  
  // Add trailers
  if (Array.isArray(movies)) {
    movies.forEach((m, idx) => {
      const src = m.mp4 || m.webm;
      if (src) {
        mediaItems.push({
          id: `movie-${m.id || idx}`,
          type: 'video',
          src,
          poster: m.thumbnail || banner,
          title: m.name || `Trailer ${idx + 1}`
        });
      }
    });
  }

  // Add screenshots
  if (Array.isArray(screenshots) && screenshots.length > 0) {
    screenshots.forEach((s, idx) => {
      const full = s.full || s.path_full || s;
      const thumb = s.thumbnail || s.path_thumbnail || full;
      if (full) {
        mediaItems.push({
          id: `screen-${s.id || idx}`,
          type: 'image',
          src: full,
          thumbnail: thumb,
          title: `${title} Screenshot ${idx + 1}`
        });
      }
    });
  } else if (banner) {
    mediaItems.push({
      id: 'banner',
      type: 'image',
      src: banner,
      thumbnail: banner,
      title
    });
  }

  const [activeIndex, setActiveIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const activeMedia = mediaItems[activeIndex] || mediaItems[0];

  if (!mediaItems.length) return null;

  return (
    <div className="space-y-2.5">
      {/* Main Preview Screen */}
      <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-[#0c0e14] border border-white/[0.08] group">
        {activeMedia?.type === 'video' ? (
          <video 
            key={activeMedia.src}
            src={activeMedia.src} 
            poster={activeMedia.poster}
            controls
            autoPlay
            muted
            loop
            className="w-full h-full object-contain"
          />
        ) : (
          <div 
            onClick={() => setLightboxOpen(true)}
            className="w-full h-full cursor-zoom-in relative"
          >
            <img 
              src={activeMedia.src} 
              alt={activeMedia.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="px-3 py-1.5 rounded-lg bg-black/75 text-white text-xs font-semibold backdrop-blur-md border border-white/10 flex items-center space-x-1.5 shadow-lg">
                <Maximize2 className="w-3.5 h-3.5" />
                <span>View Fullscreen</span>
              </span>
            </div>
          </div>
        )}

        {/* Carousel Prev/Next Buttons */}
        {mediaItems.length > 1 && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveIndex(prev => (prev > 0 ? prev - 1 : mediaItems.length - 1));
              }}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 hover:bg-blue-600/80 text-white backdrop-blur-md border border-white/10 transition-all opacity-0 group-hover:opacity-100 cursor-pointer shadow-lg"
              title="Previous item"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setActiveIndex(prev => (prev < mediaItems.length - 1 ? prev + 1 : 0));
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 hover:bg-blue-600/80 text-white backdrop-blur-md border border-white/10 transition-all opacity-0 group-hover:opacity-100 cursor-pointer shadow-lg"
              title="Next item"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Counter Badge */}
        <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded bg-black/70 text-slate-300 text-[10px] font-mono border border-white/10 backdrop-blur-sm">
          {activeIndex + 1} / {mediaItems.length}
        </div>
      </div>

      {/* Thumbnail Bar */}
      {mediaItems.length > 1 && (
        <div className="flex items-center space-x-2 overflow-x-auto pb-1.5 pt-0.5 custom-scrollbar">
          {mediaItems.map((item, idx) => {
            const isSelected = idx === activeIndex;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveIndex(idx)}
                className={`relative aspect-video w-24 rounded-lg overflow-hidden border shrink-0 transition-all cursor-pointer ${
                  isSelected ? 'border-blue-500 ring-2 ring-blue-500/40 opacity-100' : 'border-white/[0.08] opacity-60 hover:opacity-90'
                }`}
              >
                <img 
                  src={item.type === 'video' ? (item.poster || banner) : (item.thumbnail || item.src)} 
                  alt="" 
                  className="w-full h-full object-cover"
                />
                {item.type === 'video' && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white">
                    <Play className="w-3.5 h-3.5 fill-current text-blue-400" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Lightbox Fullscreen Modal */}
      {lightboxOpen && (
        <div 
          onClick={() => setLightboxOpen(false)}
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4 cursor-zoom-out"
        >
          <div className="relative max-w-6xl max-h-[90vh] flex flex-col items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img 
              src={activeMedia.src} 
              alt={activeMedia.title}
              className="max-w-full max-h-[85vh] rounded-xl object-contain shadow-2xl border border-white/10" 
            />
            <div className="mt-3 flex items-center justify-between w-full text-slate-300 text-xs px-2">
              <span className="font-semibold">{activeMedia.title}</span>
              <div className="flex items-center space-x-3">
                <button 
                  onClick={() => setActiveIndex(prev => (prev > 0 ? prev - 1 : mediaItems.length - 1))}
                  className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white font-medium"
                >
                  Previous
                </button>
                <span className="font-mono text-slate-400">{activeIndex + 1} / {mediaItems.length}</span>
                <button 
                  onClick={() => setActiveIndex(prev => (prev < mediaItems.length - 1 ? prev + 1 : 0))}
                  className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-white font-medium"
                >
                  Next
                </button>
                <button 
                  onClick={() => setLightboxOpen(false)}
                  className="px-3 py-1 rounded bg-red-600/80 hover:bg-red-500 text-white font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================================
// HOWLONGTOBEAT SECTION (HYDRA-PARITY)
// ==========================================================
function HowLongToBeatSection({ gameTitle }) {
  const [hltb, setHltb] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameTitle || !window.api?.getHltbData) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    window.api.getHltbData(gameTitle)
      .then(res => {
        if (active) {
          setHltb(res);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [gameTitle]);

  if (loading) {
    return (
      <div className="p-4 bg-[#121620] border border-white/[0.08] rounded-xl space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-blue-400" />
            <span>HowLongToBeat</span>
          </span>
          <span className="text-[10px] text-slate-500 font-mono animate-pulse">Loading stats...</span>
        </div>
        <div className="grid grid-cols-3 gap-2 animate-pulse">
          <div className="h-14 bg-white/[0.04] rounded-lg" />
          <div className="h-14 bg-white/[0.04] rounded-lg" />
          <div className="h-14 bg-white/[0.04] rounded-lg" />
        </div>
      </div>
    );
  }

  if (!hltb || (!hltb.mainStory && !hltb.mainExtra && !hltb.completionist)) {
    return null;
  }

  return (
    <div className="p-4 bg-[#121620] border border-white/[0.08] rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-blue-400" />
          <span>HowLongToBeat</span>
        </span>
        <span className="text-[10px] text-blue-400/80 font-semibold uppercase tracking-wider">Estimated Playtime</span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {/* Main Story */}
        <div className="p-2.5 rounded-lg bg-[#181d2a] border border-blue-500/20 flex flex-col justify-between">
          <span className="text-[10px] font-semibold text-blue-300 uppercase tracking-wider">Main Story</span>
          <p className="text-sm font-bold text-white mt-1">
            {hltb.mainStory ? `${hltb.mainStory}h` : '–'}
          </p>
        </div>

        {/* Main + Extra */}
        <div className="p-2.5 rounded-lg bg-[#181d2a] border border-purple-500/20 flex flex-col justify-between">
          <span className="text-[10px] font-semibold text-purple-300 uppercase tracking-wider">Main + Extra</span>
          <p className="text-sm font-bold text-white mt-1">
            {hltb.mainExtra ? `${hltb.mainExtra}h` : '–'}
          </p>
        </div>

        {/* Completionist */}
        <div className="p-2.5 rounded-lg bg-[#181d2a] border border-emerald-500/20 flex flex-col justify-between">
          <span className="text-[10px] font-semibold text-emerald-300 uppercase tracking-wider">100% Complete</span>
          <p className="text-sm font-bold text-white mt-1">
            {hltb.completionist ? `${hltb.completionist}h` : '–'}
          </p>
        </div>
      </div>
    </div>
  );
}

// ==========================================================
// SYSTEM REQUIREMENTS SECTION (HYDRA-PARITY)
// ==========================================================
function SystemRequirementsSection({ requirements, gameTitle }) {
  const [activeReqTab, setActiveReqTab] = useState('minimum');

  if (!requirements || (typeof requirements !== 'object' && typeof requirements !== 'string')) {
    return null;
  }

  const minHtml = requirements?.minimum || (typeof requirements === 'string' ? requirements : null);
  const recHtml = requirements?.recommended || null;

  if (!minHtml && !recHtml) return null;

  return (
    <div className="p-4 bg-[#121620] border border-white/[0.08] rounded-xl space-y-3">
      <div className="flex items-center justify-between border-b border-white/[0.06] pb-2.5">
        <span className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
          <Cpu className="w-3.5 h-3.5 text-blue-400" />
          <span>System Requirements</span>
        </span>
        <div className="flex items-center space-x-1.5">
          {minHtml && (
            <button
              type="button"
              onClick={() => setActiveReqTab('minimum')}
              className={`px-2.5 py-1 text-[11px] font-bold uppercase rounded-md transition-all ${
                activeReqTab === 'minimum'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 bg-white/[0.04]'
              }`}
            >
              Minimum
            </button>
          )}
          {recHtml && (
            <button
              type="button"
              onClick={() => setActiveReqTab('recommended')}
              className={`px-2.5 py-1 text-[11px] font-bold uppercase rounded-md transition-all ${
                activeReqTab === 'recommended'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 bg-white/[0.04]'
              }`}
            >
              Recommended
            </button>
          )}
        </div>
      </div>

      <div 
        className="text-xs text-slate-300 leading-relaxed font-sans prose prose-invert max-w-none [&_ul]:list-disc [&_ul]:pl-4 [&_li]:mb-1 [&_strong]:text-white [&_strong]:font-semibold"
        dangerouslySetInnerHTML={{
          __html: activeReqTab === 'recommended' && recHtml ? recHtml : (minHtml || 'No explicit system requirements listed.')
        }}
      />
    </div>
  );
}

// ==========================================================
// DEDICATED SETTINGS PAGE (HYDRA-PARITY)
// ==========================================================
function SettingsPage({ onNotification }) {
  const [activeCategory, setActiveCategory] = useState('general');
  const [settings, setSettings] = useState({
    downloadsPath: 'C:\\Charon Games',
    maxDownloadSpeed: null,
    runAtStartup: false,
    startMinimized: false,
    minimizeToTray: true,
    launchToLibrary: false,
    extractByDefault: true,
    deleteArchiveAfterExtract: false,
    showSpeedInMB: true,
    steamGridDbApiKey: '',
    customSources: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [speedLimitInput, setSpeedLimitInput] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [isAddingSource, setIsAddingSource] = useState(false);
  const [isSyncingSources, setIsSyncingSources] = useState(false);
  const [appVer, setAppVer] = useState('1.0.0');

  useEffect(() => {
    if (window.api?.getSettings) {
      window.api.getSettings().then(s => {
        if (s) {
          setSettings(s);
          if (s.maxDownloadSpeed && s.maxDownloadSpeed > 0) {
            const mb = (s.maxDownloadSpeed / (1024 * 1024)).toFixed(1);
            setSpeedLimitInput(mb);
          }
        }
        setIsLoading(false);
      }).catch(() => setIsLoading(false));
    }
    if (window.api?.getAppVersion) {
      window.api.getAppVersion().then(setAppVer).catch(() => {});
    }
  }, []);

  const updateSetting = async (key, val) => {
    const next = { ...settings, [key]: val };
    setSettings(next);
    if (window.api?.updateSettings) {
      await window.api.updateSettings({ [key]: val });
    }
  };

  const handleSelectDownloadFolder = async () => {
    if (!window.api?.selectDownloadDir) return;
    const chosen = await window.api.selectDownloadDir();
    if (chosen) {
      setSettings(prev => ({ ...prev, downloadsPath: chosen }));
      onNotification?.(`Download location updated: ${chosen}`);
    }
  };

  const handleApplySpeedLimit = async (val) => {
    setSpeedLimitInput(val);
    const parsed = parseFloat(val);
    if (!val || isNaN(parsed) || parsed <= 0) {
      await updateSetting('maxDownloadSpeed', null);
      onNotification?.('Download speed limit disabled (Unlimited)');
    } else {
      const bytesPerSec = Math.round(parsed * 1024 * 1024);
      await updateSetting('maxDownloadSpeed', bytesPerSec);
      onNotification?.(`Max download speed set to ${parsed} MB/s`);
    }
  };

  const handleAddCustomSource = async (e) => {
    e.preventDefault();
    if (!newSourceUrl.trim() || !window.api?.addCustomSource) return;
    setIsAddingSource(true);
    try {
      const res = await window.api.addCustomSource(newSourceUrl.trim());
      if (res.success) {
        onNotification?.(`Source "${res.source?.name}" added with ${res.source?.count} releases!`);
        setNewSourceUrl('');
        const updated = await window.api.getCustomSources();
        setSettings(prev => ({ ...prev, customSources: updated }));
      } else {
        alert(res.error || 'Failed to add custom source');
      }
    } catch (err) {
      alert(err.message || 'Error adding custom source');
    } finally {
      setIsAddingSource(false);
    }
  };

  const handleRemoveSource = async (id) => {
    if (!window.api?.removeCustomSource) return;
    await window.api.removeCustomSource(id);
    setSettings(prev => ({
      ...prev,
      customSources: prev.customSources.filter(s => s.id !== id)
    }));
    onNotification?.('Custom source removed');
  };

  const handleSyncAllSources = async () => {
    if (!window.api?.syncCustomSources) return;
    setIsSyncingSources(true);
    try {
      const res = await window.api.syncCustomSources();
      onNotification?.(`Synced all sources! Updated ${res.count} sources.`);
      const updated = await window.api.getCustomSources();
      setSettings(prev => ({ ...prev, customSources: updated }));
    } finally {
      setIsSyncingSources(false);
    }
  };

  const categories = [
    { id: 'general', label: 'General', icon: <Sliders className="w-4 h-4" /> },
    { id: 'downloads', label: 'Downloads', icon: <Download className="w-4 h-4" /> },
    { id: 'behavior', label: 'Behavior & System', icon: <Cpu className="w-4 h-4" /> },
    { id: 'sources', label: 'Download Sources', icon: <Globe className="w-4 h-4" /> },
    { id: 'about', label: 'About & Updates', icon: <Info className="w-4 h-4" /> }
  ];

  return (
    <div className="flex h-full bg-[#0b0d12]">
      {/* Settings Sidebar */}
      <aside className="w-64 bg-[#10131a] border-r border-white/[0.06] p-4 flex flex-col space-y-1 select-none">
        <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider px-3 mb-2">Settings</h2>
        {categories.map(cat => {
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                isActive 
                  ? 'bg-blue-600 text-white shadow-sm' 
                  : 'text-slate-300 hover:text-white hover:bg-white/[0.04]'
              }`}
            >
              {cat.icon}
              <span>{cat.label}</span>
            </button>
          );
        })}
      </aside>

      {/* Settings Content Panel */}
      <section className="flex-1 overflow-y-auto p-8 max-w-4xl space-y-8">
        {/* GENERAL SETTINGS */}
        {activeCategory === 'general' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">General Preferences</h3>
              <p className="text-xs text-slate-400 mt-1">Configure default storage directories and display units.</p>
            </div>

            {/* Install Directory */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl space-y-3">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">Default Game Installation Directory</label>
              <p className="text-xs text-slate-400">All games, downloads, and unpacked binaries will be stored here by default.</p>
              <div className="flex items-center space-x-3 pt-1">
                <input 
                  type="text" 
                  readOnly 
                  value={settings.downloadsPath || ''} 
                  className="flex-1 px-3.5 py-2 rounded-lg bg-[#0c0e14] border border-white/[0.08] text-xs font-mono text-slate-300"
                />
                <button
                  type="button"
                  onClick={handleSelectDownloadFolder}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-all shrink-0 cursor-pointer"
                >
                  Browse Folder
                </button>
              </div>
            </div>

            {/* Speed Unit Toggle */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">Show Speed in Megabytes (MB/s)</h4>
                <p className="text-xs text-slate-400 mt-0.5">Toggle between MB/s (Megabytes) and Mbps (Megabits per second).</p>
              </div>
              <input 
                type="checkbox" 
                checked={settings.showSpeedInMB !== false}
                onChange={(e) => updateSetting('showSpeedInMB', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
              />
            </div>

            {/* SteamGridDB API Key Card */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">SteamGridDB Community Artwork API Key</label>
                  <p className="text-xs text-slate-400 mt-0.5">Enables searching over 500,000 community posters, animated covers, widescreen banners, and logos.</p>
                </div>
                <a
                  href="https://www.steamgriddb.com/profile/preferences/api"
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-semibold text-slate-300 hover:text-white transition-colors flex items-center space-x-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-purple-400" />
                  <span>Get Free Key</span>
                </a>
              </div>
              <div className="flex items-center space-x-3 pt-1">
                <input 
                  type="password" 
                  placeholder="Paste SteamGridDB API Key here..."
                  value={settings.steamGridDbApiKey || ''} 
                  onChange={(e) => updateSetting('steamGridDbApiKey', e.target.value)}
                  className="flex-1 px-3.5 py-2 rounded-lg bg-[#0c0e14] border border-white/[0.08] text-xs font-mono text-slate-200 focus:outline-none focus:border-purple-500"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (window.api?.saveSteamGridDbKey) {
                      await window.api.saveSteamGridDbKey(settings.steamGridDbApiKey || '');
                      onNotification?.('SteamGridDB API key saved successfully!');
                    }
                  }}
                  className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold rounded-lg transition-all shrink-0 cursor-pointer shadow-sm"
                >
                  Save Key
                </button>
              </div>
            </div>
          </div>
        )}

        {/* DOWNLOADS SETTINGS */}
        {activeCategory === 'downloads' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Download Engine & Archive Settings</h3>
              <p className="text-xs text-slate-400 mt-1">Configure bandwidth allocation and 7-Zip decompression rules.</p>
            </div>

            {/* Speed Limit */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl space-y-3">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">Maximum Download Speed Limit (MB/s)</label>
              <p className="text-xs text-slate-400">Cap download bandwidth per stream. Leave blank or 0 for unlimited speed.</p>
              <div className="flex items-center space-x-3 pt-1">
                <input 
                  type="number" 
                  min="0"
                  step="0.5"
                  placeholder="Unlimited (Max Throughput)"
                  value={speedLimitInput} 
                  onChange={(e) => setSpeedLimitInput(e.target.value)}
                  onBlur={(e) => handleApplySpeedLimit(e.target.value)}
                  className="w-64 px-3.5 py-2 rounded-lg bg-[#0c0e14] border border-white/[0.08] text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => handleApplySpeedLimit('')}
                  className="px-3.5 py-2 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-xs font-medium text-slate-300 transition-colors"
                >
                  Set Unlimited
                </button>
              </div>
            </div>

            {/* Auto Extract */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">Extract Archives Automatically</h4>
                <p className="text-xs text-slate-400 mt-0.5">Use bundled 7-Zip to extract game archives immediately when download completes.</p>
              </div>
              <input 
                type="checkbox" 
                checked={settings.extractByDefault !== false}
                onChange={(e) => updateSetting('extractByDefault', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
              />
            </div>

            {/* Delete Archive after extraction */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">Delete Compressed Archive After Extraction</h4>
                <p className="text-xs text-slate-400 mt-0.5">Automatically remove the original .zip/.rar archive once extraction succeeds to save disk space.</p>
              </div>
              <input 
                type="checkbox" 
                checked={Boolean(settings.deleteArchiveAfterExtract)}
                onChange={(e) => updateSetting('deleteArchiveAfterExtract', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* BEHAVIOR & SYSTEM SETTINGS */}
        {activeCategory === 'behavior' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">System & Startup Behavior</h3>
              <p className="text-xs text-slate-400 mt-1">Configure window events, system tray integration, and auto-launch.</p>
            </div>

            {/* Run At Startup */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">Launch Charon with Windows</h4>
                <p className="text-xs text-slate-400 mt-0.5">Automatically start Charon Game Launcher when your PC boots.</p>
              </div>
              <input 
                type="checkbox" 
                checked={Boolean(settings.runAtStartup)}
                onChange={(e) => updateSetting('runAtStartup', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
              />
            </div>

            {/* Start Minimized */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">Start Minimized to System Tray</h4>
                <p className="text-xs text-slate-400 mt-0.5">Launch quietly in the background without opening the main window.</p>
              </div>
              <input 
                type="checkbox" 
                checked={Boolean(settings.startMinimized)}
                onChange={(e) => updateSetting('startMinimized', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
              />
            </div>

            {/* Minimize To Tray */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">Minimize to Tray on Close</h4>
                <p className="text-xs text-slate-400 mt-0.5">Clicking the window X button hides Charon into the system tray instead of exiting.</p>
              </div>
              <input 
                type="checkbox" 
                checked={settings.minimizeToTray !== false}
                onChange={(e) => updateSetting('minimizeToTray', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
              />
            </div>

            {/* Launch To Library */}
            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-between">
              <div>
                <h4 className="text-sm font-semibold text-white">Always Open Directly to My Library</h4>
                <p className="text-xs text-slate-400 mt-0.5">Bypasses the Store and opens straight to your installed games library on launch.</p>
              </div>
              <input 
                type="checkbox" 
                checked={Boolean(settings.launchToLibrary)}
                onChange={(e) => updateSetting('launchToLibrary', e.target.checked)}
                className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
              />
            </div>
          </div>
        )}

        {/* CUSTOM DOWNLOAD SOURCES */}
        {activeCategory === 'sources' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-white">Custom Download Sources Manager</h3>
                <p className="text-xs text-slate-400 mt-1">Add third-party repack catalogs by URL (standard JSON catalog format).</p>
              </div>
              <button
                type="button"
                onClick={handleSyncAllSources}
                disabled={isSyncingSources || !settings.customSources?.length}
                className="px-3.5 py-1.5 bg-[#1c2230] hover:bg-[#252c3e] border border-white/[0.1] rounded-lg text-xs font-semibold text-slate-200 transition-all flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncingSources ? 'animate-spin text-blue-400' : ''}`} />
                <span>Sync All Sources</span>
              </button>
            </div>

            {/* Add Source Input Bar */}
            <form onSubmit={handleAddCustomSource} className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl space-y-3">
              <label className="text-xs font-bold text-slate-200 uppercase tracking-wider block">Add Custom Download Source URL</label>
              <div className="flex items-center space-x-3">
                <input 
                  type="url" 
                  placeholder="https://example.com/sources/repacks.json" 
                  value={newSourceUrl} 
                  onChange={(e) => setNewSourceUrl(e.target.value)}
                  className="flex-1 px-3.5 py-2 rounded-lg bg-[#0c0e14] border border-white/[0.08] text-xs font-mono text-slate-200 focus:outline-none focus:border-blue-500"
                  required
                />
                <button
                  type="submit"
                  disabled={isAddingSource || !newSourceUrl.trim()}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-all shrink-0 flex items-center space-x-1.5 cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isAddingSource ? 'Fetching...' : 'Add Source'}</span>
                </button>
              </div>
            </form>

            {/* Sources List */}
            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Custom Sources ({settings.customSources?.length || 0})</h4>
              {(!settings.customSources || settings.customSources.length === 0) ? (
                <div className="p-8 text-center bg-[#121620]/50 border border-white/[0.05] rounded-xl">
                  <Globe className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-400 font-medium">No custom sources added yet.</p>
                  <p className="text-[11px] text-slate-500 mt-0.5">Paste any public repack JSON catalog URL above to expand your search catalog.</p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {settings.customSources.map(src => (
                    <div key={src.id} className="p-4 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center justify-between gap-4">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center space-x-2">
                          <h5 className="text-sm font-bold text-white truncate">{src.name}</h5>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/30">
                            {src.count} titles
                          </span>
                        </div>
                        <p className="text-xs font-mono text-slate-400 truncate">{src.url}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveSource(src.id)}
                        className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                        title="Remove source"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ABOUT & UPDATES */}
        {activeCategory === 'about' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">About Charon Launcher</h3>
              <p className="text-xs text-slate-400 mt-1">Next-generation high-performance gaming launcher with multi-source repacks.</p>
            </div>

            <div className="p-6 bg-[#121620] border border-white/[0.08] rounded-xl flex items-center space-x-5">
              <img src={charonLogo} alt="Logo" className="w-16 h-16 object-contain rounded-2xl bg-white/[0.04] p-2" />
              <div className="space-y-1">
                <h4 className="text-base font-extrabold text-white">Charon Game Launcher</h4>
                <p className="text-xs font-mono text-blue-400">Version {appVer} (Ultimate Edition)</p>
                <p className="text-xs text-slate-400 pt-1">Equipped with 16-connection Aria2 download acceleration and 7-Zip SIMD auto-extraction.</p>
              </div>
            </div>

            <div className="p-5 bg-[#121620] border border-white/[0.08] rounded-xl space-y-3">
              <h5 className="text-xs font-bold text-slate-200 uppercase tracking-wider">Features Included</h5>
              <div className="grid grid-cols-2 gap-3 text-xs text-slate-300">
                <div className="flex items-center space-x-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Playtime Tracking & Process Monitor</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Screenshots & Trailer Media Gallery</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>HowLongToBeat Estimated Times</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>System Requirements (Min/Rec)</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Custom Repack Sources Manager</span>
                </div>
                <div className="flex items-center space-x-2">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>System Tray & Background Minimize</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
