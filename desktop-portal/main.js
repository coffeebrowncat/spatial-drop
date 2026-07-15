const { app, BrowserWindow, screen } = require('electron');

function createPortal() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const mainWindow = new BrowserWindow({
        width: width,
        height: height,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        skipTaskbar: true, // Hides it from the bottom bar completely
        hasShadow: false,
        webPreferences: { nodeIntegration: true, contextIsolation: false }
    });

    // THIS IS THE MAGIC LINE: You can click right through the invisible window to your actual desktop
    mainWindow.setIgnoreMouseEvents(true);
    mainWindow.loadFile('index.html');
};