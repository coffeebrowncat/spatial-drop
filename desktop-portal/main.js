const { app, BrowserWindow, screen, globalShortcut } = require('electron');
require('electron-reload')(__dirname);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

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
        webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false }
    });

    mainWindow.setIgnoreMouseEvents(true);
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    mainWindow.loadFile('desktop.html');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(createPortal);
app.whenReady().then(() => {
    // createPortal is already being called, just register the shortcut next to it
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
        console.log("Dev trigger fired from OS!");
        // We tell the active window to execute the haptic function
        BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('triggerHapticFeedback(null)');
    });
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});