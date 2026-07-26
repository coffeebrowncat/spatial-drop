const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { activeRooms, trustedRooms, pendingTransfers, cleanupTransfer } = require('../utils/store');
const { logTransfer } = require('../config/db');

// --- 10. WEBSOCKET SWITCHBOARD (the walkie talkie) ---
// this is the part that keeps a live, always-open connection to both
// the phone and the laptop, so they can instantly ping each other
function setupWebSockets(server) {
    const wss = new WebSocket.Server({ server });

    // runs once every time SOMETHING (phone or laptop) connects to us
    wss.on('connection', (ws) => {
        ws.roomId = null; // this device hasn't joined a room yet, blank slate

        // runs every time that connected device sends us a message
        ws.on('message', (message) => {
            try {
                // try to understand the message as normal readable data (json)
                const data = JSON.parse(message);

                // --- THE HANDSHAKE: someone's trying to join a room ---
                if (data.type === 'join') {
                    const pin = data.pin; // the room code both devices agree on
                    ws.role = data.role || null; // NEW — 'mobile' or 'desktop'
                    ws.deviceId = data.deviceId || null; // NEW
                    // if this room doesn't exist yet, make a brand new empty one
                    if (!activeRooms.has(pin)) {
                        activeRooms.set(pin, new Set());
                    }
                    const room = activeRooms.get(pin);

                    // only 2 devices allowed per room (your phone + your laptop)
                    if (room.size >= 2) {
                        return ws.send(JSON.stringify({ error: 'room is full bro' }));
                    }

                    room.add(ws);       // add this device to the room
                    ws.roomId = pin;    // remember which room this device is in
                    ws.send(JSON.stringify({ status: 'connected', pin: pin }));
                    console.log(`someone joined room: ${pin}`);
                    return;
                }

                // --- SOMEONE HIT "ACCEPT" ON THE POPUP ---
                if (data.type === 'accept_transfer') {
                    const t = pendingTransfers.get(data.transferId);
                    if (!t) return; // transfer already expired or doesn't exist, ignore

                    clearTimeout(t.timeout); // cancel the self-destruct timer, we're keeping these files

                    const finalPaths = []; // will fill up with the "real" saved locations
                    let remaining = t.files.length; // countdown of how many files still need moving

                    // FIX: this used to use fs.rename(), which silently
                    // fails with an "EXDEV" error if the temp folder and
                    // your downloads folder happen to be on different
                    // drives - that was causing finalPaths to end up
                    // completely empty, which is why the glow was firing
                    // but nothing ever actually opened. fs.copyFile always
                    // works no matter which drive either folder is on, so
                    // now we copy the file over first, then delete the
                    // temp original as a separate step right after
                    function finishBatch() {
                        const room = activeRooms.get(t.room);
                        if (room) {
                            room.forEach(client => {
                                if (client.readyState === WebSocket.OPEN) {
                                    // tell the laptop "here's where they actually ended up"
                                    client.send(JSON.stringify({ type: 'file_caught', paths: finalPaths }));
                                }
                            });
                        }
                        trustedRooms.add(t.room);
                        logTransfer(t.files.length, 'accepted'); // write one row to the sql log
                        pendingTransfers.delete(data.transferId); // done, forget about this transfer
                    }

                    // go through every file in the batch and actually move it
                    // from the temp folder into the real downloads folder
                    t.files.forEach((f, i) => {
                        const finalPath = path.join(
                            os.homedir(), 'Downloads',
                            `Drop_${Date.now()}_${i}_${f.originalName}` // the "_i_" stops name clashes
                        );

                        fs.copyFile(f.tempPath, finalPath, (err) => {
                            if (err) {
                                console.error('copy failed:', err);
                                remaining--;
                                if (remaining === 0) finishBatch();
                                return;
                            }

                            finalPaths.push(finalPath); // copy worked, count it

                            // now that the copy is safely sitting in downloads,
                            // delete the leftover temp original
                            fs.unlink(f.tempPath, () => {
                                remaining--; // one less file left to move
                                if (remaining === 0) finishBatch();
                            });
                        });
                    });
                    return;
                }

                // --- SOMEONE HIT "DECLINE" ON THE POPUP ---
                if (data.type === 'decline_transfer') {
                    // grab it BEFORE cleanup deletes it, so we still know
                    // how many files were in it for the log entry below
                    const t = pendingTransfers.get(data.transferId);
                    if (t) logTransfer(t.files.length, 'declined'); // log the decline too, for a fuller picture

                    cleanupTransfer(data.transferId); // wipes the temp files, nothing gets kept

                    if (ws.roomId && activeRooms.has(ws.roomId)) {
                        activeRooms.get(ws.roomId).forEach(client => {
                            if (client.readyState === WebSocket.OPEN) {
                                client.send(JSON.stringify({ type: 'transfer_declined', transferId: data.transferId }));
                            }
                        });
                    }
                    return;
                }

            } catch (error) {
                // if the message wasn't readable json, we just quietly ignore it
                // instead of crashing the whole server over one weird message
                console.log("ignored non-json websocket message.");
            }
        });

        // runs when a device disconnects (closes the app, loses wifi, whatever)
        ws.on('close', () => {
            if (ws.roomId && activeRooms.has(ws.roomId)) {
                const room = activeRooms.get(ws.roomId);
                room.delete(ws); // take them out of the room

                // if literally nobody's left in the room, delete the room too
                // so we're not just hoarding empty rooms forever
                if (room.size === 0) {
                    activeRooms.delete(ws.roomId);
                    trustedRooms.delete(ws.roomId); // everyone's gone, next join is treated as a fresh pairing
                }
                console.log(`someone left room: ${ws.roomId}`);
            }
        });
    });
}

module.exports = { setupWebSockets };