const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { activeRooms, trustedRooms, pendingTransfers, cleanupTransfer } = require('../utils/store');
const { logTransfer } = require('../config/db');

// NEW: tells everyone currently in a room who else is in it. this is
// what the mobile radar screen actually renders — without this, a
// phone joining a room has zero way to know another device is there.
function broadcastRoomList(pin) {
    const room = activeRooms.get(pin);
    if (!room) return;

    const peers = [...room].map((c) => ({
        deviceId: c.deviceId || null,
        label: c.label || 'unknown device',
        role: c.role || null,
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

                    if (room.size >= 2) {
                        return ws.send(JSON.stringify({ error: 'room is full bro' }));
                    }

                    // NEW: remember who this socket actually is, so the
                    // room list broadcast (and later, targeted sends)
                    // has something real to report
                    ws.role = data.role || null;
                    ws.deviceId = data.deviceId || null;
                    ws.label = data.label || 'unknown device';

                    room.add(ws);
                    ws.roomId = pin;
                    ws.send(JSON.stringify({ status: 'connected', pin: pin }));
                    console.log(`someone joined room: ${pin} (${ws.label})`);

                    broadcastRoomList(pin); // NEW — tell the whole room who's here now
                    return;
                }

                if (data.type === 'accept_transfer') {
                    const t = pendingTransfers.get(data.transferId);
                    if (!t) return;

                    clearTimeout(t.timeout);

                    const finalPaths = [];
                    let remaining = t.files.length;

                    function finishBatch() {
                        const room = activeRooms.get(t.room);
                        if (room) {
                            room.forEach((client) => {
                                if (client.readyState === WebSocket.OPEN) {
                                    client.send(JSON.stringify({ type: 'file_caught', paths: finalPaths }));
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
                    broadcastRoomList(ws.roomId); // NEW — tell whoever's left that someone dropped
                }
                console.log(`someone left room: ${ws.roomId}`);
            }
        });
    });
}

module.exports = { setupWebSockets };