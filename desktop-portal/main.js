// grabbing the electron tools we need to build an actual desktop app
const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const crypto = require('crypto');

require('electron-reload')(__dirname);

const { startServer } = require('../backend/server.js');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const machineDeviceId = crypto.randomUUID();

let superhubWindow;

const DRAWER_HEIGHT = 240;
const DRAWER_WIDTH = 320;

function createPortal() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const mainWindow = new BrowserWindow({
        width: width,
        height: height,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            backgroundThrottling: false
        }
    });

    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.loadFile('desktop.html', { search: `deviceId=${machineDeviceId}` });
    mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function createSuperHub() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;

    superhubWindow = new BrowserWindow({
        width: DRAWER_WIDTH,
        height: DRAWER_HEIGHT,
        x: width - 21, // only the 21px sliver is on-screen at rest
        y: 100,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        hasShadow: false,
        resizable: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    superhubWindow.loadFile('superhub.html', { search: `deviceId=${machineDeviceId}` });
}

let slideInterval = null;

// this is what physically moves the window between "just the sliver
// showing" and "fully open" — triggered by superhub.html sending
// 'superhub-slide' over IPC on hover/drag
function slideSuperHub(open) {
    if (!superhubWindow) return;

    if (slideInterval) clearInterval(slideInterval);

    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    const bounds = superhubWindow.getBounds();

    const startX = bounds.x;
    const targetX = open ? (width - DRAWER_WIDTH) : (width - 21);

    if (startX === targetX) return; // already where it needs to be

    const steps = 20;
    let i = 0;

    slideInterval = setInterval(() => {
        i++;
        const progress = i / steps;
        const x = Math.round(startX + (targetX - startX) * progress);

        superhubWindow.setBounds({ x, y: bounds.y, width: bounds.width, height: bounds.height });

        if (i >= steps) clearInterval(slideInterval);
    }, 8);
}

ipcMain.on('superhub-slide', (event, open) => slideSuperHub(open));

// desktop.html forwards the peer list here, we relay it to the
// drawer — no separate websocket connection for superhub.html, so one
// physical laptop only ever uses one room slot, not two
ipcMain.on('peers-updated', (event, peers) => {
    if (superhubWindow) superhubWindow.webContents.send('peers-updated', peers);
});

app.whenReady().then(() => {
    startServer();
    createPortal();
    createSuperHub();
});

app.whenReady().then(() => {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
        console.log("dev trigger fired from OS!");
        BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('triggerHapticFeedback(null)');
    });
});

// NEW — Electron's alwaysOnTop can silently drop after certain OS
// events on Windows (screenshots, focus changes, some background
// apps) even while the window is still technically running. instead
// of trusting Windows to keep it visible, this re-asserts it every
// few seconds, so it self-heals instead of vanishing until you notice
// and manually restart the whole app.
setInterval(() => {
    if (superhubWindow && !superhubWindow.isDestroyed()) {
        superhubWindow.setAlwaysOnTop(true, 'screen-saver');
        if (!superhubWindow.isVisible()) superhubWindow.showInactive();
    }
}, 3000);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});