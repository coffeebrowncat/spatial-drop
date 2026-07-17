// okay so this whole file is "the server" - think of it like the front desk guy
// at a hotel. phones and laptops both call the front desk (this file) and the
// front desk tells them where to go and passes messages between rooms.

// --- 1. FIREWALL BYPASS ---
// some wifi networks (like school or office wifi) block random connections.
// this line just tells your computer "hey when you look something up online,
// use google's dns instead of whatever sketchy one the network gave you"
// it's basically a workaround so things don't randomly fail to connect
const { setServers } = require("node:dns/promises");
setServers(["8.8.8.8", "1.1.1.1"]);

// --- 2. GRABBING OUR TOOLS ---
// "require" just means "go get this tool out of the toolbox so i can use it"
const express = require('express');   // the actual web server engine
const path = require('path');          // helps us build file paths correctly no matter what computer this runs on
const os = require('os');              // lets us ask the computer stuff like "hey where's the downloads folder"
const multer = require('multer');      // the tool that actually catches uploaded files
const fs = require('fs');              // "file system" - lets us move/delete files on the hard drive
const crypto = require('crypto');      // we use this for one thing: making random unique id codes

// spin up the actual server app
const app = express();
const server = require('http').createServer(app);

// --- 3. WHERE UPLOADED FILES GO WHILE THEY'RE "IN LIMBO" ---
// important: files do NOT go straight to downloads anymore.
// they land in a temp folder first and just sit there, waiting for
// the laptop to say "yes i want this" before it actually gets kept.
// this is what makes the accept/decline popup possible.
const storage = multer.diskStorage({
    // os.tmpdir() = the computer's built-in "junk drawer" folder, cleans itself
    // up automatically over time, perfect for stuff that might get deleted anyway
    destination: (req, file, cb) => cb(null, os.tmpdir()),

    // give every file a random unique name so two files can never collide
    // crypto.randomUUID() basically spits out a random id that'll never repeat
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}_${file.originalname}`)
});
const upload = multer({ storage: storage });

// this just means "if someone visits the website, hand them the files sitting
// in this same folder" (so index.html, css, whatever, just works normally)
app.use(express.static(path.join(__dirname, '.')));

// when someone loads the homepage, specifically hand them index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 4. THE ROOMS MAP ---
// this is basically a list of "who's paired with who". moved up here
// (it used to be way further down) because the upload route below needs
// to use it, and in javascript you have to declare a thing before you use it
const activeRooms = new Map();

// NEW: tracks which rooms (aka which pairing) already said "yes" once.
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

// --- 5. THE UPLOAD ROUTE (where files actually get sent to) ---
// upload.array('files', 10) = "accept up to 10 files at once, under the field name 'files'"
// this used to be upload.single('file') which only allowed exactly one file
app.post('/upload', upload.array('files', 10), (req, res) => {
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
    res.json({ success: true, transferId });
});

// --- 6. DATABASE CONNECTION ---
// this just connects us to mongo (a database) so we can remember stuff
// like usernames later if we want. totally separate from the file transfer stuff
require('dotenv').config(); // loads secret stuff (like passwords) from a hidden .env file
const mongoose = require('mongoose');
const { Client } = require('pg');

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('[stealth] mongo analytics firehose: ONLINE'))
    .catch((err) => console.error('mongo connection failed:', err));

// --- 7. WEBSOCKET SWITCHBOARD (the walkie talkie) ---
// this is the part that keeps a live, always-open connection to both
// the phone and the laptop, so they can instantly ping each other
const WebSocket = require('ws');
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
                const pin = data.pin; // the "room code" both devices agree on

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

                // go through every file in the batch and actually move it
                // from the temp folder into the real downloads folder
                t.files.forEach((f, i) => {
                    const finalPath = path.join(
                        os.homedir(), 'Downloads',
                        `Drop_${Date.now()}_${i}_${f.originalName}` // the "_i_" stops name clashes
                    );

                    // fs.rename = literally just "move this file from A to B"
                    fs.rename(f.tempPath, finalPath, (err) => {
                        remaining--; // one less file left to move

                        if (err) console.error('move failed:', err);
                        else finalPaths.push(finalPath); // only count it if it actually worked

                        // once EVERY file in the batch has finished moving...
                        if (remaining === 0) {
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
                            pendingTransfers.delete(data.transferId); // done, forget about this transfer
                        }
                    });
                });
                return;
            }

            // --- SOMEONE HIT "DECLINE" ON THE POPUP ---
            if (data.type === 'decline_transfer') {
                cleanupTransfer(data.transferId); // just wipes the temp files, nothing gets kept

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
                trustedRooms.delete(ws.roomId); // NEW: everyone's gone, next join is treated as a fresh pairing
            }
            console.log(`someone left room: ${ws.roomId}`);
        }
    });
});

// --- 8. IGNITION ---
// this is the line that actually turns the server ON and makes it start listening
server.listen(3000, '0.0.0.0', () => {
    console.log("switchboard operator awake and listening on port 3000...");
});