// grabbing the electron tools we need to build an actual desktop app
const { app, BrowserWindow, screen, globalShortcut, ipcMain, Tray, Menu, nativeImage } = require('electron');
const crypto = require('crypto');
const path = require('path');

require('electron-reload')(__dirname);

const { startServer } = require('../backend/server.js');

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// NEW — SINGLE INSTANCE LOCK. without this, every time you (or an installer,
// or a login-item auto-launch) opened the app again, you'd get a second
// full copy running — second server trying to bind the same port, second
// portal/superhub window pair stacked on top of the first, etc. this makes
// the 2nd launch attempt just quit itself immediately instead. must run
// before anything else touches app.whenReady().
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
    // FIXED — app.quit() only SCHEDULES a quit, it doesn't stop this file
    // from continuing to run top-to-bottom. without the line below, the
    // 2nd instance kept going anyway, hit app.whenReady().then(startServer),
    // and tried to bind port 3000 while the 1st instance was still holding
    // it — that's the EADDRINUSE crash. process.exit(0) actually halts
    // execution immediately, so none of that code below ever runs.
    app.quit();
    process.exit(0);
} else {
    // someone tried to open a second copy while this one's already running —
    // treat that as "show me the app" instead of silently doing nothing
    app.on('second-instance', () => {
        slideSuperHub(true);
    });
}

const machineDeviceId = crypto.randomUUID();

let tray; // NEW — see createTray() below
let superhubWindow;
let portalWindow; // NEW — this used to be a local variable inside createPortal(), invisible to
// everything outside that function. lifted to module scope so the self-healing
// interval below can actually reach it, same as superhubWindow already could.

const DRAWER_HEIGHT = 240;
const DRAWER_WIDTH = 320;

function createPortal() {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.workAreaSize;

    portalWindow = new BrowserWindow({
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

    portalWindow.setIgnoreMouseEvents(true, { forward: true });
    portalWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    portalWindow.loadFile('desktop.html', { search: `deviceId=${machineDeviceId}` });
    portalWindow.webContents.openDevTools({ mode: 'detach' });
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

// NEW — TRAY ICON. this is the actual fix for "there's no way to quit the
// app" — frameless + skipTaskbar means there was never anything to
// right-click before. left-click flashes the drawer open (so it also
// doubles as a "yep, I'm running" signal), right-click gives you Quit.
//
// expects an icon file sitting right next to main.js/desktop.html/
// superhub.html named 'tray-icon.png' — drop spatial_drop_icon_512.png
// in there and rename it (or change the filename below to match whatever
// you call it). a 512px source is fine, it gets resized down to actual
// tray size below.
function createTray() {
    const iconPath = path.join(__dirname, 'tray-icon.png');
    let icon = nativeImage.createFromPath(iconPath);

    if (icon.isEmpty()) {
        console.warn(`tray icon not found at ${iconPath} — tray will show a blank/default icon until it's added.`);
    } else {
        // FIXED — this was resizing down to a hard 16x16 pixels, which is
        // fine on a plain 100%-scale display, but on anything with Windows
        // display scaling turned up (125%/150%/200%, common on most modern
        // laptops) Windows then has to stretch that already-tiny 16px
        // bitmap back up to fit the real tray icon slot — that's what was
        // making it look smaller and softer than every other icon sitting
        // next to it, since those are supplying properly-sized source art
        // for their icon and letting Windows pick the right scale itself.
        // 32x32 gives Windows enough real pixels to downscale OR upscale
        // cleanly depending on your actual display scaling.
        icon = icon.resize({ width: 64, height: 64 });
    }

    tray = new Tray(icon);
    tray.setToolTip('Spatial Drop');

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Open Spatial Drop',
            click: () => slideSuperHub(true),
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => app.quit(),
        },
    ]);

    tray.setContextMenu(contextMenu);

    // left-click (Windows/Linux) — right-click already opens the menu above
    tray.on('click', () => slideSuperHub(true));
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
    createTray();

    // NEW — AUTO-START AT LOGIN. only turned on for a real packaged build
    // (app.isPackaged), not while you're running it from source with
    // electron-reload — otherwise every dev session would also silently
    // register itself to auto-launch on login, which you don't want while
    // you're still actively changing code.
    if (app.isPackaged) {
        app.setLoginItemSettings({
            openAtLogin: true,
            openAsHidden: true, // mac-only flag, harmless no-op on Windows
        });
    }
});

app.whenReady().then(() => {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
        console.log("dev trigger fired from OS!");
        BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('triggerHapticFeedback(null)');
    });
});

// Electron's alwaysOnTop can silently drop after certain OS events on
// Windows (screenshots, focus changes, some background apps) even while
// a window is still technically running. instead of trusting Windows to
// keep it visible, this re-asserts it every few seconds so it self-heals
// instead of vanishing until you notice and manually restart the app.
//
// FIXED — this used to only cover superhubWindow. portalWindow (the
// full-screen glow overlay desktop.html paints onto) never got the same
// treatment, so after enough drops/OS focus churn it could silently drop
// alwaysOnTop and sit BEHIND other windows — the .buzzing class was still
// toggling correctly in the DOM the whole time, the glow was genuinely
// firing, you just couldn't see it anymore because something else was
// drawn on top of it. that's almost certainly the "haptic stops working
// after a bunch of drops" bug — now both windows self-heal the same way.
setInterval(() => {
    if (superhubWindow && !superhubWindow.isDestroyed()) {
        superhubWindow.setAlwaysOnTop(true, 'screen-saver');
        if (!superhubWindow.isVisible()) superhubWindow.showInactive();
    }
    if (portalWindow && !portalWindow.isDestroyed()) {
        portalWindow.setAlwaysOnTop(true, 'screen-saver');
        if (!portalWindow.isVisible()) portalWindow.showInactive();
    }
}, 3000);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});