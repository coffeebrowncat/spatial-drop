const crypto = require('crypto');
const WebSocket = require('ws');
const { activeRooms, trustedRooms, pendingTransfers, TRANSFER_TIMEOUT_MS, cleanupTransfer } = require('../utils/store');

// makes up a fresh random 4-digit code every time the server boots.
// this replaces the old hardcoded "magic-room" word from before
const CONNECT_PIN = Math.floor(1000 + Math.random() * 9000).toString();

// tiny local route so the widget (running on this same computer) can
// just ask "hey what's the pin right now" - since the widget itself
// starts this server, this is mostly for the pin badge to read from
const getPin = (req, res) => {
    res.status(200).json({ pin: CONNECT_PIN });
};

// --- 8. THE UPLOAD ROUTE (where files actually get sent to) ---
// upload.array('files', 10) = "accept up to 10 files at once, under the field name 'files'"
// no more accept="image/*" restriction on the phone side, so literally
// any file type lands here now, not just photos
const uploadFiles = (req, res) => {
    const roomId = req.body.roomId;

    // safety check: if somehow no files came through, don't crash, just bail out nicely
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'no files received' });
    }

    // give this whole batch of files one shared id so we can refer to
    // "all of these together" instead of tracking each file separately
    const transferId = crypto.randomUUID();

    // start the 30 second self-destruct countdown for this transfer
    const timeout = setTimeout(() => cleanupTransfer(transferId), TRANSFER_TIMEOUT_MS);

    // save this batch of files into our "waiting room" map
    pendingTransfers.set(transferId, {
        files: req.files.map(f => ({ tempPath: f.path, originalName: f.originalname })),
        room: roomId,
        timeout
    });

    // now poke everyone in the room and say "hey, files incoming, you want them?"
    // we do NOT send the actual files here, just the names and a count
    if (activeRooms.has(roomId)) {
        activeRooms.get(roomId).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({
                    type: 'incoming_files',
                    transferId,
                    count: req.files.length,
                    fileNames: req.files.map(f => f.originalname),
                    trusted: trustedRooms.has(roomId)
                }));
            }
        });
    }

    console.log(`[HTTP POST] holding ${req.files.length} file(s), waiting on accept/decline.`);
    res.status(201).json({ success: true, transferId });
};

module.exports = {
    getPin,
    uploadFiles,
    CONNECT_PIN
};