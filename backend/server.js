// firewall bypass
// grab the built-in node tool that lets us mess with your computer's dns settings
const { setServers } = require("node:dns/promises");
// force the app to use google's public internet phonebook (8.8.8.8 and 1.1.1.1)
// this tricks your strict corporate wifi into letting us talk to the external mongodb database
setServers(["8.8.8.8", "1.1.1.1"]);

const express = require('express');
const path = require('path');
const app = express();
const server = require('http').createServer(app);

// Tell Express to serve files from the current folder
app.use(express.static(path.join(__dirname, '.')));

// Explicitly send index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});
// tools
// load up the dotenv tool, which reads your hidden .env file so we dont leak passwords
require('dotenv').config();
// grab mongoose, which is the tool we use to talk to your mongodb database
const mongoose = require('mongoose');
// grab the pg client, which is the tool we will use later to talk to postgres
const { Client } = require('pg');

// db connection
// tell mongoose to try and connect using the secret link from your .env file
mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        // if it works, print this massive success message in the terminal so we know we are safe
        console.log('[stealth] mongo analytics firehose: ONLINE');
    })
    .catch((err) => {
        // if it fails, print the error so we know exactly why it broke instead of silently dying
        console.error('mongo connection failed:', err);
    });

// switchboard setup
// grab the ws tool, which is the engine that handles real-time websocket connections
const WebSocket = require('ws');
// create the actual server and tell it to listen for connections on port 3000
const wss = new WebSocket.Server({ server });
// create an empty 'map' (basically a super-fast javascript dictionary) to remember who is in what room right now
const activeRooms = new Map();

// connection loop
// whenever a new user connects (like your phone or your laptop), run this whole block
wss.on('connection', (ws) => {
    // give this specific user a blank nametag to start. they arent in a room yet.
    ws.roomId = null;

    // whenever this specific user sends us a message, run this block
    ws.on('message', (message) => {
        // try to run this code, but if it breaks, jump down to the 'catch' block so the server doesnt crash
        try {
            // try to read the message as standard json text (like "hello" or a pin code)
            const data = JSON.parse(message);

            // --- 1. THE HANDSHAKE (PAIRING DEVICES) ---
            // if the message is the user asking to join a room
            if (data.type === 'join') {
                // grab the 6-digit pin they sent us
                const pin = data.pin;

                // if this pin doesnt exist in our activeRooms map yet...
                if (!activeRooms.has(pin)) {
                    // create a new, empty room for this specific pin
                    activeRooms.set(pin, new Set());
                }

                // grab the specific room for this pin so we can look inside it
                const room = activeRooms.get(pin);

                // if there are already 2 people in the room, kick this new person out
                if (room.size >= 2) {
                    // send an error message back to the user
                    return ws.send(JSON.stringify({ error: 'room is full bro' }));
                }

                // add this user's websocket connection to the room
                room.add(ws);
                // write the pin on the user's nametag so the server remembers where they are
                ws.roomId = pin;
                // tell the user they successfully connected
                ws.send(JSON.stringify({ status: 'connected', pin: pin }));
                // log it to the terminal so we can see the magic happening
                console.log(`someone joined room: ${pin}`);
                return;
            }

            // --- 2. PASSING THE TEXT CHUNKS ---
            // if the message is a piece of a text file OR the metadata (like the file name/size)
            if (data.type === 'file_data') {
                if (!ws.roomId) return;

                const room = activeRooms.get(ws.roomId);

                // Only forward the original, stringified JSON message
                room.forEach(client => {
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        client.send(message.toString());
                        console.log("SUCCESS: Forwarded file data to laptop.");
                    }
                });
            } else {
                console.log("Server ignored message type:", data.type);
            }

            // --- 3. THE DONE SIGNAL (STEALTH LOGGING) ---
            // if the user says the file is completely finished sending
            if (data.type === 'done') {
                // if they arent in a room, ignore them
                if (!ws.roomId) return;

                // find their room
                const room = activeRooms.get(ws.roomId);

                // look at everyone in the room
                room.forEach(client => {
                    // if it's the other person...
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        // tell them the file is done so they can save it to their hard drive
                        client.send(message.toString());
                    }
                });

                // log to the terminal that we are about to hit the databases secretly
                console.log(`[stealth log] transfer complete in room ${ws.roomId}. logging to database...`);
                // (we will put your actual mongo/postgres logging code here later)
            }

            // --- THE CRASH SAVER (MASSIVE FILES) --- ///
        } catch (error) {
            // if JSON.parse fails, it means the message was RAW BINARY DATA (like a massive 4k video chunk)
            // if we didn't have this catch block, a 50mb video would literally kill the node server.
            // instead of crashing, we catch the error here and blindly pass the raw data across the pipe.

            // if the user is in a room...
            if (ws.roomId) {
                // find their room
                const room = activeRooms.get(ws.roomId);

                // look at everyone in the room
                room.forEach(client => {
                    // if it's the other person...
                    if (client !== ws && client.readyState === WebSocket.OPEN) {
                        // blindly throw the massive chunk of raw video data right at them
                        client.send(message.toString());
                    }
                });
            }
        }
    });

    // disconnect
    // whenever a user closes their app, refreshes the page, or loses wifi
    ws.on('close', () => {
        // if they were actually in a room when they disconnected...
        if (ws.roomId && activeRooms.has(ws.roomId)) {
            // find the room they were in
            const room = activeRooms.get(ws.roomId);
            // remove them from the room
            room.delete(ws);

            // if the room is totally empty now...
            if (room.size === 0) {
                // delete the room from the server memory so we dont waste server ram
                activeRooms.delete(ws.roomId);
            }
            // log that they left so we can track drop-offs
            console.log(`someone left room: ${ws.roomId}`);
        }
    });
});

// print this when the file first runs so we know the code actually executed
server.listen(3000, '0.0.0.0', () => {
    console.log("switchboard operator awake and listening on port 3000...");
});