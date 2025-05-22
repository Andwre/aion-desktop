/* -------------------------------------------------- */
/*  Aion Notes – Electron main-process                */
/*  Blockerande auto-update + TakeCare / PMO-starter  */
/* -------------------------------------------------- */
const {
  app, BrowserWindow, desktopCapturer,
  session, ipcMain
} = require('electron');
const { autoUpdater }  = require('electron-updater');
const path             = require('node:path');
const fs               = require('node:fs');
const { spawn, execSync } = require('node:child_process');

let win;
let transferProc = null;        // ChildProcess-referens
let wantedSystem = null;        // 'TakeCare' | 'PMO' | null

/* -------------------------------------------------- */
/* 1. Hjälpare för sökvägar och process-kontroll      */
/* -------------------------------------------------- */
function exePathFor (system) {
  const base = path.join(process.resourcesPath, 'tools');   // ligger i resources/tools/
  if (system === 'TakeCare') return path.join(base, 'aion_takecare.exe');
  if (system === 'PMO')      return path.join(base, 'aion_pmo.exe');
  return null;
}
function exeNameFor (system) {
  if (system === 'TakeCare') return 'aion_takecare.exe';
  if (system === 'PMO')      return 'aion_pmo.exe';
  return null;
}
function isProcessRunning (exeName) {
  try {
    const out = execSync(
      `tasklist /FI "IMAGENAME eq ${exeName}"`,
      { encoding: 'utf8' }
    );
    return out.toLowerCase().includes(exeName.toLowerCase());
  } catch { return false; }
}
function killProcessByExe (exeName) {
  try { execSync(`taskkill /F /IM ${exeName}`, { stdio: 'ignore' }); } catch {}
}

/* -------------------------------------------------- */
/* 2. Start / stop & autorestart-logik                */
/* -------------------------------------------------- */
function launchTransfer (system) {
  if (!system) return;

  const exePath = exePathFor(system);
  const exeName = exeNameFor(system);
  if (!exePath || !exeName) return;

  // —–– Verifiera att filen finns —––
  if (!fs.existsSync(exePath)) {
    console.error(`[transfer] Hittar inte filen: ${exePath}`);
    return;
  }

  // finns redan en levande process?
  if (isProcessRunning(exeName)) {
    console.log(`[transfer] ${exeName} redan igång`);
    return;
  }

  // döda ev. gammal referens
  if (transferProc && !transferProc.killed) transferProc.kill();

  // starta
  transferProc = spawn(exePath, [], { detached: true, windowsHide: true });
  transferProc.unref();
  console.log(`[transfer] startade ${system}`);

  // logga om spawn själv fallerar (t.ex. saknad DLL)
  transferProc.on('error', (err) =>
    console.error('[transfer] kunde inte starta processen:', err)
  );

  // hantera oväntad död
  transferProc.on('exit', (code, sig) => {
    console.error(`[transfer] processen dog (code=${code} sig=${sig})`);
    transferProc = null;
    if (wantedSystem) setTimeout(() => launchTransfer(wantedSystem), 1000);
  });
}

function stopTransfer () {
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
function createWindow () {
  const appVersion = app.getVersion();

  win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, '../resources/icon.png'),
    title: `Aion Notes v${appVersion}`,
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
function checkForUpdatesBlocking () {
  return new Promise((resolve) => {
    const splash = new BrowserWindow({
      width: 380, height: 160, frame: false, resizable: false,
      alwaysOnTop: true, modal: true, show: false,
      webPreferences: { contextIsolation: true }
    });

    splash.loadURL('data:text/html,' + encodeURIComponent(`
      <style>
        body{margin:0;font-family:sans-serif;
             display:flex;align-items:center;justify-content:center;height:100%;}
      </style>
      <h3>Hämtar uppdatering …</h3>`));

    splash.once('ready-to-show', () => splash.show());

    autoUpdater.autoDownload          = true;
    autoUpdater.autoInstallOnAppQuit  = false;

    autoUpdater.on('update-not-available', () => { splash.close(); resolve(false); });
    autoUpdater.on('error',               (e) => { console.error('[update]', e); splash.close(); resolve(false); });

    autoUpdater.on('update-downloaded', () => {
      splash.close();
      console.log('[update] Ny version nedladdad – installerar & startar om');
      autoUpdater.quitAndInstall();        // appen avslutas om det fanns uppdatering
    });

    autoUpdater.checkForUpdates();
  });
}

/* -------------------------------------------------- */
/* 6. Huvud-flöde                                     */
/* -------------------------------------------------- */
app.whenReady().then(async () => {
  // Hook för system-ljud
  session.defaultSession.setDisplayMediaRequestHandler(async (_req, cb) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'] });
    cb({ video: screen, audio: 'loopback' });
  });

  // Blockera tills ev. uppdatering är klar
  await checkForUpdatesBlocking();
  createWindow();
});

/* -------------------------------------------------- */
/* 7. Städa vid avslut                                */
/* -------------------------------------------------- */
app.on('before-quit', () => stopTransfer());
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
