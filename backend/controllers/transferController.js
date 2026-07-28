const crypto = require('crypto');
const WebSocket = require('ws');
const { activeRooms, trustedRooms, pendingTransfers, TRANSFER_TIMEOUT_MS, cleanupTransfer } = require('../utils/store');

// FIXED: this had gotten changed to `* 9000`, which only ever
// produces numbers from 100000-109000 (always starts with "10" —
// barely random at all). Back to a real 6-digit range.
const CONNECT_PIN = Math.floor(100000 + Math.random() * 900000).toString();

const getPin = (req, res) => {
    res.status(200).json({ pin: CONNECT_PIN });
};

const uploadFiles = (req, res) => {
    const roomId = req.body.roomId;
    const senderId = req.body.deviceId;
    const targetId = req.body.targetId || null;

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
            if (client.deviceId === senderId) return;
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

// this is what actually lets a phone pull real file bytes, instead of
// files only ever being able to land in the laptop's own Downloads
const downloadTransfer = (req, res) => {
    const transferId = req.params.id;
    const t = pendingTransfers.get(transferId);

    if (!t) {
        return res.status(404).json({ error: 'transfer not found, expired, or already downloaded' });
    }

    const file = t.files[0]; // single-file download for now — multi-file zip bundling is a real follow-up
    res.download(file.tempPath, file.originalName, (err) => {
        if (err) {
            console.error('download stream error:', err);
            return;
        }
        // clean up only after the download actually finished successfully
        clearTimeout(t.timeout);
        fs.unlink(file.tempPath, () => {});
        pendingTransfers.delete(transferId);
    });
};

const fs = require('fs');

module.exports = {
    getPin,
    uploadFiles,
    CONNECT_PIN,
    updateTransfer,
    deleteTransfer,
    downloadTransfer
};