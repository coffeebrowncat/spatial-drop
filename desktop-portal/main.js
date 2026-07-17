// grabbing the electron tools we need to build an actual desktop app
const { app, BrowserWindow, screen, globalShortcut } = require('electron');

// this makes the app automatically reload itself whenever you save a
// code change, so you don't have to manually restart it every time
// (only really useful while you're building it, not for the final version)
require('electron-reload')(__dirname);

// normally browsers block sounds from playing until you click something
// first (annoying autoplay rules). this switch tells electron "nah, let
// sounds play whenever, no click needed"
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// this function builds the actual invisible window that covers your screen
function createPortal() {
    // ask the computer how big your actual screen is
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    const mainWindow = new BrowserWindow({
        width: width,          // make the window exactly as wide as your screen
        height: height,        // and exactly as tall
        transparent: true,     // see-through background
        frame: false,          // no title bar, no borders, nothing
        alwaysOnTop: true,     // stays above every other window
        skipTaskbar: true,     // doesn't show up in your taskbar/dock
        hasShadow: false,      // no drop shadow around the window edges
        webPreferences: {
            nodeIntegration: true,      // lets desktop.html use node stuff like "require"
            contextIsolation: false,    // needed for nodeIntegration to actually work
            backgroundThrottling: false // stops electron from "slowing down" this window
                                         // when it thinks it's not being looked at -
                                         // important since this window is invisible 24/7
        }
    });

    // THIS is the magic line - it makes the window "click-through", meaning
    // your mouse clicks pass straight through it to whatever's actually
    // on your real desktop underneath. otherwise this invisible window
    // would just block you from clicking anything ever
    mainWindow.setIgnoreMouseEvents(true);

    // keeps this window visible even if you switch desktops/spaces or
    // go fullscreen on something else - it should always be there
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    // actually load our invisible glowing html file into this window
    mainWindow.loadFile('desktop.html');

    // pops open a separate devtools window so you can see console logs
    // and errors while you're testing. REMEMBER: turn this off before
    // you actually demo this to anyone, it looks messy
    mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// once electron has fully booted up, actually go build the window
// (this line was missing before, which is why nothing was showing up!)
app.whenReady().then(createPortal);

// also once electron's ready, set up a global keyboard shortcut that
// works system-wide, even if this window has no focus - since the
// window is click-through, this is the reliable way to test the buzz
app.whenReady().then(() => {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
        console.log("dev trigger fired from OS!");
        // reach into the window and manually run the haptic function
        // as if a message had actually come through the websocket
        BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('triggerHapticFeedback(null)');
    });
});

// standard electron cleanup - if every window closes, quit the whole
// app (except on mac, where apps are supposed to stay running in the
// background even with no windows open, that's just a mac thing)
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});