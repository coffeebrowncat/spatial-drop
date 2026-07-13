// grab the tools needed to build a desktop app
const { app, BrowserWindow } = require('electron');
const path = require('path');

// this function builds the floating window
function createPortal() {
    const mainWindow = new BrowserWindow({
        width: 200,
        height: 200,
        transparent: true,     // This tells the OS the window is see-through
        frame: false,          // Removes the OS window border
        alwaysOnTop: true,     // Keeps it floating
        hasShadow: false,      // Removes the drop shadow for that clean look
        vibrancy: 'ultra-dark',// MacOS specific: makes it look like system-native glass
        visualEffectState: 'active',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    // load the UI file we are about to build
    mainWindow.loadFile('index.html');
}

// when electron is fully awake, trigger the window creation
app.whenReady().then(createPortal);

// if the user closes all windows, quit the app (standard behavior)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});