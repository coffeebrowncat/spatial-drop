// grabbing the electron tools we need to build an actual desktop app
const { app, BrowserWindow, screen, globalShortcut } = require('electron');

require('electron-reload')(__dirname);

const { startServer } = require('../backend/server.js');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
    mainWindow.loadFile('desktop.html');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// NEW: this is the second, small, GENUINELY interactive window that
// actually accepts drag-and-drop. it's not click-through at all - it's
// a completely normal window, just small and frameless, sitting in the
// corner. windows' native file-drag system only works on real windows
// like this, which is why the old "fake drop zone inside the invisible
// overlay" approach could never have worked, no matter what code we
// tried in desktop.html
function createDropZoneWindow() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const dropWindow = new BrowserWindow({
        width: 140,
        height: 90,
        x: width - 160,   // bottom-right corner, roughly where the old fake one sat
        y: height - 110,
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
        // deliberately NOT calling setIgnoreMouseEvents here at all -
        // that's the entire point, this window stays fully interactive
    });

    dropWindow.loadFile('dropzone.html');
    dropWindow.webContents.openDevTools({ mode: 'detach' }); // NEW: so we can actually see its console
}

app.whenReady().then(() => {
    startServer();
    createPortal();
    createDropZoneWindow(); // NEW
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