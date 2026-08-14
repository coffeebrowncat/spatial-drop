const path = require('path');
// CHANGED — was a top-level require, meaning mongoose (and its ~100
// nested helper files) had to be loaded and fully intact every single
// time this app started, even on machines that never touch Mongo at
// all. That's exactly what broke on a friend's machine — a packaged
// portable exe self-extracts to a temp folder on first run, and if
// antivirus/disk-space/extraction hiccups drop even one nested file
// out of a huge dependency tree, the whole app refuses to boot. Now
// mongoose is only required the moment connectMongo() actually runs
// AND MONGO_URI is set — so machines that don't use Mongo (which is
// every machine during a local PIN-based demo) never touch it at all.

// SQLite only makes sense for the local "transfers happened" log when
// this server runs on your own laptop. Render wipes its disk on every
// restart/redeploy, so a file there wouldn't persist anyway — and
// better-sqlite3 is a native module, which is the most likely reason
// the deploy is crashing. Skip it entirely when running on Render
// (Render auto-sets process.env.RENDER = 'true' on every service).
const isRenderDeploy = !!process.env.RENDER;

let db = null;
if (!isRenderDeploy) {
    const Database = require('better-sqlite3'); // npm install better-sqlite3
    db = new Database(path.join(__dirname, '..', 'transfers.db'));

    db.exec(`
        CREATE TABLE IF NOT EXISTS transfers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT,
            file_count INTEGER,
            status TEXT
        )
    `);
}

// tiny helper - call this any time a transfer finishes, one way or another
function logTransfer(fileCount, status) {
    if (!db) return; // running on Render — nothing to log to, just skip
    db.prepare('INSERT INTO transfers (timestamp, file_count, status) VALUES (?, ?, ?)')
      .run(new Date().toISOString(), fileCount, status);
}

// --- DATABASE CONNECTION (mongo, separate from the sqlite log above) ---
function connectMongo() {
    if (process.env.MONGO_URI) {
        const mongoose = require('mongoose');
        mongoose.connect(process.env.MONGO_URI)
            .then(() => console.log('[stealth] mongo analytics firehose: ONLINE'))
            .catch((err) => console.error('mongo connection failed:', err));
    }
}

module.exports = {
    logTransfer,
    connectMongo
};