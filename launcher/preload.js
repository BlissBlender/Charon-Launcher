const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  startDownload: (game) => ipcRenderer.send('start-download', game),
  cancelDownload: (gameId) => ipcRenderer.send('cancel-download', gameId),
  openDownloadsFolder: (folderPath) => ipcRenderer.send('open-downloads-folder', folderPath),
  openFileLocation: (opts) => ipcRenderer.send('open-file-location', opts),
  getSystemDrives: () => ipcRenderer.invoke('get-system-drives'),
  checkFilesExist: (items) => ipcRenderer.invoke('check-files-exist', items),
  deleteDownloadedGame: (opts) => ipcRenderer.invoke('delete-downloaded-game', opts),
  openOrRunGame: (opts) => ipcRenderer.invoke('open-or-run-game', opts),
  extractGameArchive: (opts) => ipcRenderer.invoke('extract-game-archive', opts),
  
  onDownloadProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('download-progress', listener);
    return () => ipcRenderer.removeListener('download-progress', listener);
  },
  
  // Fetch metadata from Steam API
  fetchMetadata: (searchQuery) => ipcRenderer.invoke('fetch-metadata', searchQuery),
  
  // Scraper & Search endpoints
  fetchSteamripPage: (params) => ipcRenderer.invoke('fetch-steamrip-page', params),
  fetchSteamunlockedPage: (params) => ipcRenderer.invoke('fetch-steamunlocked-page', params),
  fetchSource3Page: (params) => ipcRenderer.invoke('fetch-source3-page', params),
  fetchSource4Page: (params) => ipcRenderer.invoke('fetch-source4-page', params),
  fetchOnlinefixPage: (params) => ipcRenderer.invoke('fetch-source4-page', params),
  fetchSource5Page: (params) => ipcRenderer.invoke('fetch-source5-page', params),
  fetchDodiPage: (params) => ipcRenderer.invoke('fetch-dodi-page', params),
  quickSearch: (query) => ipcRenderer.invoke('quick-search', query),
  searchAllSources: (params) => ipcRenderer.invoke('search-all-sources', params),
  getGameRepacks: (gameParams) => ipcRenderer.invoke('get-game-repacks', gameParams),
  openMagnetLink: (uri) => ipcRenderer.send('open-magnet-link', uri),

  // In-App Auto Updater APIs
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  startDownloadUpdate: () => ipcRenderer.invoke('start-download-update'),
  restartAndApplyUpdate: (opts) => ipcRenderer.invoke('restart-and-apply-update', opts),
  verifyPatchIntegrity: (opts) => ipcRenderer.invoke('verify-patch-integrity', opts),
  signalRendererReady: () => ipcRenderer.send('renderer-ready'),
  onUpdaterEvent: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('updater-event', listener);
    return () => ipcRenderer.removeListener('updater-event', listener);
  },

  // Settings & System
  getSettings: () => ipcRenderer.invoke('get-settings'),
  updateSettings: (newSettings) => ipcRenderer.invoke('update-settings', newSettings),
  selectDownloadDir: () => ipcRenderer.invoke('select-download-dir'),
  selectGameExe: () => ipcRenderer.invoke('select-game-exe'),
  autoLaunch: (opts) => ipcRenderer.invoke('auto-launch', opts),
  onSwitchTab: (callback) => {
    const listener = (event, tab) => callback(tab);
    ipcRenderer.on('switch-tab', listener);
    return () => ipcRenderer.removeListener('switch-tab', listener);
  },

  // Playtime Tracking & Launch Stats
  getPlaytime: () => ipcRenderer.invoke('get-playtime'),
  getRunningGames: () => ipcRenderer.invoke('get-running-games'),
  onPlaytimeUpdate: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('playtime-update', listener);
    return () => ipcRenderer.removeListener('playtime-update', listener);
  },

  // HowLongToBeat Stats
  getHltbData: (gameTitle) => ipcRenderer.invoke('get-hltb-data', gameTitle),

  // Custom Download Sources Manager
  getCustomSources: () => ipcRenderer.invoke('get-custom-sources'),
  addCustomSource: (url) => ipcRenderer.invoke('add-custom-source', url),
  removeCustomSource: (id) => ipcRenderer.invoke('remove-custom-source', id),
  syncCustomSources: () => ipcRenderer.invoke('sync-custom-sources'),

  // Feature 1: Steam Integration ("Add to Steam")
  isSteamInstalled: () => ipcRenderer.invoke('is-steam-installed'),
  addToSteam: (opts) => ipcRenderer.invoke('add-to-steam', opts),

  // Feature 2: Save Game Backup & Restore
  backupGameSave: (opts) => ipcRenderer.invoke('backup-game-save', opts),
  listGameBackups: (title) => ipcRenderer.invoke('list-game-backups', title),
  restoreGameSave: (opts) => ipcRenderer.invoke('restore-game-save', opts),
  openSaveLocation: (opts) => ipcRenderer.invoke('open-save-location', opts),

  // Feature 3: Steam Achievements System
  getGameAchievements: (opts) => ipcRenderer.invoke('get-game-achievements', opts),
  onAchievementUnlocked: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('achievement-unlocked', listener);
    return () => ipcRenderer.removeListener('achievement-unlocked', listener);
  },

  // Feature 4: SteamGridDB & Custom Artwork Manager (Hydra-Parity)
  getGameArtwork: (opts) => ipcRenderer.invoke('get-game-artwork', opts),
  saveGameArtwork: (opts) => ipcRenderer.invoke('save-game-artwork', opts),
  getCustomArtwork: () => ipcRenderer.invoke('get-custom-artwork'),
  selectLocalImageFile: () => ipcRenderer.invoke('select-local-image-file'),
  saveSteamGridDbKey: (key) => ipcRenderer.invoke('save-steamgriddb-key', key),

  // Feature 5: Per-Game Executable & Launch Settings
  getGameExecutables: (opts) => ipcRenderer.invoke('get-game-executables', opts),
  getGameConfig: (gameId) => ipcRenderer.invoke('get-game-config', gameId),
  setGameConfig: (config) => ipcRenderer.invoke('set-game-config', config),
  browseGameExe: (opts) => ipcRenderer.invoke('browse-game-exe', opts),

  // Feature 6: Post-Extraction Actions & Integrations (Hydra-Parity)
  createDesktopShortcut: (opts) => ipcRenderer.invoke('create-desktop-shortcut', opts),
  exportAchievementMetadata: (opts) => ipcRenderer.invoke('export-achievement-metadata', opts),
  scanClassicsDiscs: (opts) => ipcRenderer.invoke('scan-classics-discs', opts),
  setSelectedDisc: (opts) => ipcRenderer.invoke('set-selected-disc', opts),
  syncCloudSave: (opts) => ipcRenderer.invoke('sync-cloud-save', opts),
  onCloudSaveSync: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('on-cloud-save-sync', listener);
    return () => ipcRenderer.removeListener('on-cloud-save-sync', listener);
  },
  onClassicsDiscsLinked: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('classics-discs-linked', listener);
    return () => ipcRenderer.removeListener('classics-discs-linked', listener);
  }
});
