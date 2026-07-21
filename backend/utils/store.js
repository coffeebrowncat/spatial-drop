const fs = require('fs');

// --- 7. THE ROOMS MAP ---
// this is basically a list of "who's paired with who". needs to sit
// up here because the upload route below uses it, and in javascript
// you have to declare a thing before you use it
const activeRooms = new Map();

// tracks which rooms (aka which pairing) already said "yes" once.
// once a room's pin shows up in here, every transfer after that just
// auto-accepts with no popup - that's what makes it feel seamless.
// it's a plain Set because we only ever ask "is this pin in here or not"
const trustedRooms = new Set();

// this is where we keep files that are "waiting for a yes/no answer".
// it's just sitting in the computer's memory (ram), nothing is written
// to a database - the second the app restarts, this is all gone. on purpose.
const pendingTransfers = new Map(); // transferId -> { files, room, timeout }

// how long we wait before we just give up and delete an unanswered transfer
const TRANSFER_TIMEOUT_MS = 30000; // 30,000 milliseconds = 30 seconds

// little helper function: deletes a pending transfer completely.
// used both when someone hits decline, AND when the 30 second timer runs out
function cleanupTransfer(transferId) {
    const t = pendingTransfers.get(transferId);
    if (!t) return; // already gone, nothing to do

    clearTimeout(t.timeout); // stop the countdown timer, we don't need it anymore

    // go through every file in this transfer and delete it from the temp folder
    // fs.unlink = "delete this file". the empty () => {} at the end just means
    // "if it fails to delete, don't crash the app, just shrug and move on"
    t.files.forEach(f => fs.unlink(f.tempPath, () => {}));

    pendingTransfers.delete(transferId); // remove it from our tracking list
}

module.exports = {
    activeRooms,
    trustedRooms,
    pendingTransfers,
    TRANSFER_TIMEOUT_MS,
    cleanupTransfer
};