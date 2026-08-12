const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { activeRooms, trustedRooms, pendingTransfers, TRANSFER_TIMEOUT_MS, cleanupTransfer } = require('../utils/store');
const { logTransfer } = require('../config/db');

function broadcastRoomList(pin) {
    const room = activeRooms.get(pin);
    if (!room) return;

    const peers = [...room].map((c) => ({
        deviceId: c.deviceId || null,
        label: c.label || 'unknown device',
        role: c.role || null,
        avatarId: c.avatarId || null, // NEW — passed through so superhub.html can render the sender's real chosen avatar instead of a blank grey orb
    }));

    room.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ type: 'room_update', peers }));
        }
    });
}

function setupWebSockets(server) {
    const wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
        ws.roomId = null;

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);

                if (data.type === 'join') {
                    const pin = data.pin;

                    if (!activeRooms.has(pin)) {
                        activeRooms.set(pin, new Set());
                    }
                    const room = activeRooms.get(pin);

                    // CHANGED — friendlier copy. App.js already reads
                    // data.error and triggers the wrong-pin shake for it
                    // (see handleIncoming), it just never actually displayed
                    // the text anywhere — that's fixed on the App.js side.
                    if (room.size >= 5) {
                        return ws.send(JSON.stringify({ error: 'too many people in this room rn, sorry — try again in a sec' }));
                    }

                    ws.role = data.role || null;
                    ws.deviceId = data.deviceId || null;
                    ws.label = data.label || 'unknown device';
                    ws.avatarId = data.avatarId || null; // NEW — mobile's App.js already sends this on join, we just weren't storing it. see broadcastRoomList above for where it goes next.

                    room.add(ws);
                    ws.roomId = pin;
                    ws.send(JSON.stringify({ status: 'connected', pin: pin }));
                    console.log(`someone joined room: ${pin} (${ws.label})`);

                    broadcastRoomList(pin);
                    return;
                }

                // FIXED — this used to unconditionally copy every accepted
                // file into THIS machine's (the laptop's) Downloads folder,
                // no matter who actually accepted it. that's why files kept
                // ending up back on the laptop even when a phone accepted:
                // "accepting" and "the file physically lands on the server
                // machine's disk" were wrongly treated as the same thing.
                //
                // now: if the ACCEPTING device is the desktop widget itself,
                // keep the old behavior exactly (copy straight to Downloads
                // — this is still correct for phone-to-laptop transfers).
                // if the accepting device is a phone, don't touch the
                // laptop's disk at all — just mark it accepted and leave
                // the file in temp storage for the phone to pull via
                // GET /api/download/:id.
                // NEW — App.js only sent avatarId ONCE before, in the join
                // message. if someone changes their avatar in Settings
                // while already sitting in a room, this is what actually
                // updates it for everyone else looking at the peer list
                // (superhub.html's orbs, etc) instead of them being stuck
                // showing whatever avatar was picked at join time.
                if (data.type === 'avatar_update') {
                    ws.avatarId = data.avatarId || null;
                    if (ws.roomId) broadcastRoomList(ws.roomId);
                    return;
                }

                if (data.type === 'accept_transfer') {
                    const t = pendingTransfers.get(data.transferId);
                    if (!t) return;

                    clearTimeout(t.timeout);

                    if (ws.role === 'desktop') {
                        const finalPaths = [];
                        let remaining = t.files.length;

                        function finishBatch() {
                            const room = activeRooms.get(t.room);
                            if (room) {
                                room.forEach((client) => {
                                    if (client.readyState === WebSocket.OPEN) {
                                        client.send(JSON.stringify({ type: 'file_caught', paths: finalPaths, transferId: data.transferId }));
                                    }
                                });
                            }
                            trustedRooms.add(t.room);
                            logTransfer(t.files.length, 'accepted');
                            pendingTransfers.delete(data.transferId);
                        }

                        t.files.forEach((f, i) => {
                            const finalPath = path.join(
                                os.homedir(), 'Downloads',
                                `Drop_${Date.now()}_${i}_${f.originalName}`
                            );

                            fs.copyFile(f.tempPath, finalPath, (err) => {
                                if (err) {
                                    console.error('copy failed:', err);
                                    remaining--;
                                    if (remaining === 0) finishBatch();
                                    return;
                                }

                                finalPaths.push(finalPath);

                                fs.unlink(f.tempPath, () => {
                                    remaining--;
                                    if (remaining === 0) finishBatch();
                                });
                            });
                        });
                    } else {
                        // NEW — a phone accepted. don't write to the
                        // laptop's disk at all. tell the room it was
                        // accepted (so the sender's UI updates), but keep
                        // the temp file alive so the phone can download it.
                        const room = activeRooms.get(t.room);
                        if (room) {
                            room.forEach((client) => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'file_caught', paths: [], transferId: data.transferId }));
                                }
                            });
                        }
                        trustedRooms.add(t.room);
                        logTransfer(t.files.length, 'accepted');

                        // safety net: if the phone never actually calls
                        // /api/download (crashed, closed the app, whatever),
                        // this still cleans the temp file up eventually
                        // instead of leaking it forever
                        t.timeout = setTimeout(() => cleanupTransfer(data.transferId), TRANSFER_TIMEOUT_MS);
                    }
                    return;
                }

                if (data.type === 'decline_transfer') {
                    const t = pendingTransfers.get(data.transferId);
                    if (t) logTransfer(t.files.length, 'declined');

                    cleanupTransfer(data.transferId);

                    if (ws.roomId && activeRooms.has(ws.roomId)) {
                        activeRooms.get(ws.roomId).forEach((client) => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'transfer_declined', transferId: data.transferId }));
                            }
                        });
                    }
                    return;
                }

            } catch (error) {
                console.log("ignored non-json websocket message.");
            }
        });

        ws.on('close', () => {
            if (ws.roomId && activeRooms.has(ws.roomId)) {
                const room = activeRooms.get(ws.roomId);
                room.delete(ws);

                if (room.size === 0) {
                    activeRooms.delete(ws.roomId);
                    trustedRooms.delete(ws.roomId);
                } else {
                    broadcastRoomList(ws.roomId);
                }
                console.log(`someone left room: ${ws.roomId}`);
            }
        });
    });
}

module.exports = { setupWebSockets };