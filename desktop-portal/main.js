// grabbing the electron tools we need to build an actual desktop app
const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const crypto = require('crypto');

require('electron-reload')(__dirname);

const { startServer } = require('../backend/server.js');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// NEW: one identity for this whole machine, shared by both windows.
// before this, desktop.html and dropzone.html each generated their
// own random id, so the server had no way to know they were actually
// the same physical laptop — which is why sending from dropzone.html
// still popped the accept dialog on desktop.html too.
const machineDeviceId = crypto.randomUUID();

let superhubWindow; // NEW — the top-bezel drawer

// NEW: the drawer sits mostly OFF-SCREEN above the display. only a
// thin 20px sliver pokes into view normally. "opening" it just means
// sliding the whole window down until it's fully on screen.
const SLIVER_HEIGHT = 20;
const DRAWER_HEIGHT = 240;
const DRAWER_WIDTH = 320;

// this window is the big invisible glow/haptics overlay - unchanged
// from before, still fully click-through, still full screen
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

    // still click-through, still full screen - this part never changes
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.loadFile('desktop.html', { search: `deviceId=${machineDeviceId}` }); // NEW — shared id
    mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// NEW — replaces the old corner dropzone. this is the actual
// interactive drop target now: mostly hidden, slides down from the
// top bezel when something's being dragged near it.
function createSuperHub() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width } = primaryDisplay.workAreaSize;
    const x = Math.round((width - DRAWER_WIDTH) / 2);

    superhubWindow = new BrowserWindow({
        width: DRAWER_WIDTH,
        height: DRAWER_HEIGHT,
        x,
        y: -(DRAWER_HEIGHT - SLIVER_HEIGHT), // only the bottom sliver is on-screen
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
        // not click-through — same reasoning as the old dropzone: real
        // OS drag-and-drop only works on a genuinely interactive window
    });

    superhubWindow.loadFile('superhub.html', { search: `deviceId=${machineDeviceId}` });
}

// NEW — electron has no built-in way to animate a window's position,
// so this just steps it manually, ~60fps, over ~200ms
function slideSuperHub(open) {
    if (!superhubWindow) return;
    const bounds = superhubWindow.getBounds();
    const startY = bounds.y;
    const targetY = open ? 0 : -(DRAWER_HEIGHT - SLIVER_HEIGHT);
    const steps = 12;
    let i = 0;

    const interval = setInterval(() => {
        i++;
        const progress = i / steps;
        const y = Math.round(startY + (targetY - startY) * progress);
        superhubWindow.setBounds({ x: bounds.x, y, width: bounds.width, height: bounds.height });
        if (i >= steps) clearInterval(interval);
    }, 16);
}

// NEW — superhub.html asks main.js to slide it open/closed
ipcMain.on('superhub-slide', (event, open) => slideSuperHub(open));

// NEW — desktop.html already has the live websocket connection and
// gets room_update messages. rather than give superhub.html its OWN
// websocket connection (which would eat a second room slot for the
// same physical laptop), desktop.html just forwards the peer list
// here, and we relay it onward to superhub.html.
ipcMain.on('peers-updated', (event, peers) => {
    if (superhubWindow) superhubWindow.webContents.send('peers-updated', peers);
});

app.whenReady().then(() => {
    startServer();
    createPortal();
    createSuperHub(); // NEW — replaces createDropZoneWindow()
});

app.whenReady().then(() => {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
        console.log("dev trigger fired from OS!");
        BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('triggerHapticFeedback(null)');
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});