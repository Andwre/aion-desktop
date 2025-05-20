// desktop/src/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('aionDesktop', {
  isElectron: true,

  /** Starta överförings‑EXE:n ('TakeCare' | 'PMO') */
  startTransfer(journalSystem) {
    ipcRenderer.send('transfer-start', journalSystem);
  },

  /** Stoppa överförings‑EXE:n manuellt eller vid utloggning */
  stopTransfer() {
    ipcRenderer.send('transfer-stop');
  }
});
