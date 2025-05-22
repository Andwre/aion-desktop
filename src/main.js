/* -------------------------------------------------- */
/*  Aion Notes – Electron main-process                */
/*  Blockerande auto-update + TakeCare / PMO-starter   */
/* -------------------------------------------------- */
const {
  app, BrowserWindow, desktopCapturer,
  session, ipcMain
} = require('electron');
const { autoUpdater }  = require('electron-updater');
const path             = require('node:path');
const { spawn, execSync } = require('node:child_process');

let win;
let transferProc = null;   // ChildProcess-referens
let wantedSystem = null;   // 'TakeCare' | 'PMO' | null

/* -------------------------------------------------- */
/* 1. Hjälpare för sökvägar och process-kontroll      */
/* -------------------------------------------------- */
function exePathFor (system) {
  const base = path.join(process.resourcesPath, 'tools');   // pekar inuti app.asar
  if (system === 'TakeCare') return path.join(base, 'aion_takecare.exe');
  if (system === 'PMO')      return path.join(base, 'aion_pmo.exe');
  return null;
}
function exeNameFor(system) {
  if (system === 'TakeCare') return 'aion_takecare.exe';
  if (system === 'PMO')      return 'aion_pmo.exe';
  return null;
}
function isProcessRunning(exeName) {
  try {
    const out = execSync(`tasklist /FI "IMAGENAME eq ${exeName}"`, { encoding: 'utf8' });
    return out.toLowerCase().includes(exeName.toLowerCase());
  } catch { return false; }
}
function killProcessByExe(exeName) {
  try { execSync(`taskkill /F /IM ${exeName}`, { stdio: 'ignore' }); } catch {}
}

/* -------------------------------------------------- */
/* 2. Start / stop & autorestart-logik                */
/* -------------------------------------------------- */
function launchTransfer(system) {
  if (!system) return;
  const exePath = exePathFor(system);
  const exeName = exeNameFor(system);
  if (!exePath || !exeName) return;

  if (isProcessRunning(exeName)) {
    console.log(`[transfer] ${exeName} redan igång`);
    return;
  }

  if (transferProc && !transferProc.killed) transferProc.kill();
  transferProc = spawn(exePath, [], { detached: true, windowsHide: true, stdio: 'ignore' });
  transferProc.unref();
  console.log(`[transfer] startade ${system}`);

  transferProc.on('exit', () => {
    console.log('[transfer] dog – försöker återstarta');
    transferProc = null;
    if (wantedSystem) setTimeout(() => launchTransfer(wantedSystem), 1000);
  });
}
function stopTransfer() {
  if (!wantedSystem) return;
  const exeName = exeNameFor(wantedSystem);
  wantedSystem  = null;

  if (transferProc && !transferProc.killed) transferProc.kill();
  if (exeName) killProcessByExe(exeName);
  console.log('[transfer] stoppad');
}

/* -------------------------------------------------- */
/* 3. IPC-lyssnare från preload                       */
/* -------------------------------------------------- */
ipcMain.on('transfer-start', (_e, system) => {
  if (system !== 'TakeCare' && system !== 'PMO') return;
  wantedSystem = system;
  launchTransfer(system);
});
ipcMain.on('transfer-stop', () => stopTransfer());

/* -------------------------------------------------- */
/* 4. Fönster + media-hook                            */
/* -------------------------------------------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../resources/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  const frontendURL = process.env.FRONTEND_URL || 'https://aionnotes.io';
  win.loadURL(frontendURL);
}

/* -------------------------------------------------- */
/* 5. Blockerande auto-update vid start               */
/* -------------------------------------------------- */
async function checkForUpdatesBlocking() {
  return new Promise((resolve) => {
    const splash = new BrowserWindow({
      width: 380, height: 160, frame: false, resizable: false,
      alwaysOnTop: true, modal: true, show: false,
      webPreferences: { contextIsolation: true }
    });
    splash.loadURL(
      'data:text/html,' + encodeURIComponent(`
        <style>
          body{margin:0;font-family:sans-serif;
               display:flex;align-items:center;justify-content:center;height:100%;}
        </style>
        <h3>Hämtar uppdatering …</h3>`));
    splash.once('ready-to-show', () => splash.show());

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on('update-not-available', () => { splash.close(); resolve(false); });
    autoUpdater.on('error',               () => { splash.close(); resolve(false); });

    autoUpdater.on('update-downloaded', () => {
      splash.close();
      console.log('[auto-update] Ny version nedladdad – installerar & startar om');
      autoUpdater.quitAndInstall();   // appen avslutas här om uppdatering fanns
    });

    autoUpdater.checkForUpdates();
  });
}

/* -------------------------------------------------- */
/* 6. Huvud-flöde                                     */
/* -------------------------------------------------- */
app.whenReady().then(async () => {
  /* Hook för system-ljud */
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: screen, audio: 'loopback' });
  });

  /* Blockera tills ev. uppdatering är klar */
  await checkForUpdatesBlocking();
  createWindow();
});

/* -------------------------------------------------- */
/* 7. Städa vid avslut                                */
/* -------------------------------------------------- */
app.on('before-quit', () => stopTransfer());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
