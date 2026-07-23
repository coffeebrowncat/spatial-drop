// okay so this whole file is "the server" - think of it like the front desk guy
// at a hotel. phones and laptops both call the front desk (this file) and the
// front desk tells them where to go and passes messages between rooms.
require('dotenv').config();

// --- 1. FIREWALL BYPASS ---
// some wifi networks (like school or office wifi) block random connections.
// this line just tells your computer "hey when you look something up online,
// use google's dns instead of whatever sketchy one the network gave you"
// it's basically a workaround so things don't randomly fail to connect
const { setServers } = require("node:dns/promises");
setServers(["8.8.8.8", "1.1.1.1"]);

// --- 2. GRABBING OUR TOOLS ---
const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Import Modular Components
const { connectMongo } = require('./config/db');
const transferRoutes = require('./routes/transferRoutes');
const { setupWebSockets } = require('./websockets/socket');
const { CONNECT_PIN } = require('./controllers/transferController');
const { getLocalIp, publishPinToFirebase } = require('./utils/firebase');

// spin up the actual server app
const app = express();
const server = require('http').createServer(app);

// lets the phone/widget send us plain json (used by a couple small routes)
app.use(express.json());

// --- 3. CLEAN UP LEFTOVER TEMP FILES FROM OLD/CRASHED SESSIONS ---
// if the server ever got force-quit or crashed mid-transfer, whatever
// files were sitting in the temp folder waiting on accept/decline never
// got cleaned up. this runs once, right when the server boots, and wipes
// out any of THOSE leftovers so your hard drive doesn't slowly fill up
function cleanupOldTempFiles() {
    const ourFilePattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_/i;
    fs.readdir(os.tmpdir(), (err, files) => {
        if (err) return console.error('couldnt scan temp folder on boot:', err);
        files.forEach(filename => {
            if (ourFilePattern.test(filename)) {
                fs.unlink(path.join(os.tmpdir(), filename), () => {});
            }
        });
    });
}
cleanupOldTempFiles(); // actually run it, right now, once, on boot

// Initialize Databases
connectMongo();

// this just means "if someone visits the website, hand them the files sitting
// in this same folder" (so index.html, css, whatever, just works normally)
app.use(express.static(path.join(__dirname, '.')));

// Mount our external API routes
app.use('/api', transferRoutes);

// when someone loads the homepage, specifically hand them index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize our WebSocket logic
setupWebSockets(server);

// --- 11. IGNITION ---
// this used to just call server.listen() directly at the bottom of
// the file. now it's wrapped in a function we can export, so main.js
// (the widget) can start the server itself instead of you needing to
// open a second terminal and type "node server.js" by hand every time
function startServer() {
    server.listen(3000, '0.0.0.0', () => {
        console.log("switchboard operator awake and listening on port 3000...");
        console.log(`\n🔑  CONNECT PIN: ${CONNECT_PIN}\n`); // big and obvious in the terminal

        const ip = getLocalIp();
        if (ip) {
            publishPinToFirebase(CONNECT_PIN, ip); // tell firebase where we are
        } else {
            console.error("couldn't figure out local ip, firebase pin lookup won't work — fall back to typing the ip manually.");
        }
    });
}

// this lets you STILL run "node server.js" directly by itself while
// testing/developing, without the widget - it only auto-starts if this
// exact file is the one you ran, not when some other file requires it
if (require.main === module) {
    startServer();
}

// this is the part that lets main.js do: const { startServer } = require('./server.js')
module.exports = { startServer };