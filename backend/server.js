// --- 1. FIREWALL BYPASS ---
const { setServers } = require("node:dns/promises");
setServers(["8.8.8.8", "1.1.1.1"]);

// --- 2. EXPRESS & MULTER SETUP (THE NEW ENGINE) ---
const express = require('express');
const path = require('path');
const os = require('os');
const multer = require('multer');

const app = express();
const server = require('http').createServer(app);

// Tell multer to stream the massive file directly into your laptop's Downloads folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(os.homedir(), 'Downloads')),
    filename: (req, file, cb) => cb(null, `Drop_${Date.now()}_${file.originalname}`)
});
const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, '.')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- 3. THE UNLIMITED UPLOAD ROUTE ---
app.post('/upload', upload.single('file'), (req, res) => {
    const roomId = req.body.roomId;

    // The file is already safely on your hard drive! 
    // Now we just tell the invisible Desktop app to "hum" and open it.
    if (activeRooms.has(roomId)) {
        activeRooms.get(roomId).forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                // We only send the path down the pipe, not the massive file!
                client.send(JSON.stringify({ 
                    type: 'file_caught', 
                    path: req.file.path 
                }));
            }
        });
    }

    console.log(`[HTTP POST] Safely caught massive file: ${req.file.originalname}`);
    res.json({ success: true });
});

// --- 4. DATABASE CONNECTION ---
require('dotenv').config();
const mongoose = require('mongoose');
const { Client } = require('pg');

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('[stealth] mongo analytics firehose: ONLINE'))
    .catch((err) => console.error('mongo connection failed:', err));

// --- 5. WEBSOCKET SWITCHBOARD (THE WALKIE-TALKIE) ---
const WebSocket = require('ws');
const wss = new WebSocket.Server({ server });
const activeRooms = new Map();

wss.on('connection', (ws) => {
    ws.roomId = null;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            // THE HANDSHAKE
            if (data.type === 'join') {
                const pin = data.pin;
                if (!activeRooms.has(pin)) {
                    activeRooms.set(pin, new Set());
                }
                const room = activeRooms.get(pin);
                if (room.size >= 2) {
                    return ws.send(JSON.stringify({ error: 'room is full bro' }));
                }

                room.add(ws);
                ws.roomId = pin;
                ws.send(JSON.stringify({ status: 'connected', pin: pin }));
                console.log(`someone joined room: ${pin}`);
                return;
            }

        } catch (error) {
            console.log("Ignored non-JSON websocket message.");
        }
    });

    ws.on('close', () => {
        if (ws.roomId && activeRooms.has(ws.roomId)) {
            const room = activeRooms.get(ws.roomId);
            room.delete(ws);
            if (room.size === 0) {
                activeRooms.delete(ws.roomId);
            }
            console.log(`someone left room: ${ws.roomId}`);
        }
    });
});

// --- 6. IGNITION ---
server.listen(3000, '0.0.0.0', () => {
    console.log("switchboard operator awake and listening on port 3000...");
});