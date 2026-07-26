const crypto = require('crypto');
const WebSocket = require('ws');
const { activeRooms, trustedRooms, pendingTransfers, TRANSFER_TIMEOUT_MS, cleanupTransfer } = require('../utils/store');

const CONNECT_PIN = Math.floor(100000 + Math.random() * 9000).toString();

const getPin = (req, res) => {
    res.status(200).json({ pin: CONNECT_PIN });
};

const uploadFiles = (req, res) => {
    const roomId = req.body.roomId;
    const senderId = req.body.deviceId;
    const targetId = req.body.targetId || null; // NEW — a specific peer, or null for a mass send

    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'no files received' });
    }

    const transferId = crypto.randomUUID();
    const timeout = setTimeout(() => cleanupTransfer(transferId), TRANSFER_TIMEOUT_MS);

    pendingTransfers.set(transferId, {
        files: req.files.map(f => ({ tempPath: f.path, originalName: f.originalname })),
        room: roomId,
        timeout
    });

    if (activeRooms.has(roomId)) {
        activeRooms.get(roomId).forEach(client => {
            if (client.readyState !== WebSocket.OPEN) return;
            if (client.deviceId === senderId) return; // never notify the sender itself

            // NEW: if a specific target was chosen, only THAT device
            // gets notified. no target chosen = everyone else in the
            // room gets it (mass send).
            if (targetId && client.deviceId !== targetId) return;

            client.send(JSON.stringify({
                type: 'incoming_files',
                transferId,
                count: req.files.length,
                fileNames: req.files.map(f => f.originalname),
                trusted: trustedRooms.has(roomId)
            }));
        });
    }

    console.log(`[HTTP POST] holding ${req.files.length} file(s), waiting on accept/decline. target: ${targetId || 'everyone'}`);
    res.status(201).json({ success: true, transferId });
};

const updateTransfer = (req, res) => {
    const transferId = req.params.id;
    const t = pendingTransfers.get(transferId);

    if (!t) {
        return res.status(404).json({ error: 'transfer not found or already resolved' });
    }

    clearTimeout(t.timeout);
    t.timeout = setTimeout(() => cleanupTransfer(transferId), TRANSFER_TIMEOUT_MS);

    console.log(`[HTTP PUT] extended timeout for transfer ${transferId}`);
    res.status(200).json({ success: true, message: `transfer ${transferId} timeout extended.` });
};

const deleteTransfer = (req, res) => {
    const transferId = req.params.id;
    const t = pendingTransfers.get(transferId);

    if (!t) {
        return res.status(404).json({ error: 'transfer not found or already resolved' });
    }

    const roomId = t.room;
    cleanupTransfer(transferId);

    if (activeRooms.has(roomId)) {
        activeRooms.get(roomId).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'transfer_declined', transferId }));
            }
        });
    }

    console.log(`[HTTP DELETE] canceled transfer ${transferId}`);
    res.status(200).json({ success: true, message: `transfer ${transferId} canceled and cleaned up.` });
};

module.exports = {
    getPin,
    uploadFiles,
    CONNECT_PIN,
    updateTransfer,
    deleteTransfer
};