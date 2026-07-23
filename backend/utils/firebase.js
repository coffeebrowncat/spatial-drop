// this file's job is narrow and specific: figure out this laptop's
// local ip address, and tell firebase "hey, this pin points here right
// now." pulled out of server.js so server.js doesn't have to know
// anything about HOW pin publishing works, just that it happens
const https = require('https');
const os = require('os');

// paste your own firebase realtime database url here, the one that
// looks like https://your-project-xxxxx-default-rtdb.firebaseio.com
const FIREBASE_DB_URL = "https://spatial-drop-default-rtdb.firebaseio.com";

// figures out this computer's actual local wifi ip address (like
// 192.168.1.42) by asking the operating system directly, instead of
// us hardcoding it or you having to go look it up yourself
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            // we only want real wifi/ethernet addresses, not internal
            // loopback stuff like 127.0.0.1, and only the modern ipv4
            // kind, not the long ipv6 kind
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return null; // couldn't find one, shouldn't normally happen
}

// takes our pin + ip and writes them up to firebase, so the phone can
// look them up later. this uses a plain https PUT request straight to
// firebase's rest api - no special firebase library needed at all
function publishPinToFirebase(pin, ip) {
    const payload = JSON.stringify({ ip, createdAt: Date.now() });
    const url = `${FIREBASE_DB_URL}/pins/${pin}.json`;

    const req = https.request(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' } }, (res) => {
        if (res.statusCode === 200) {
            console.log(`pin ${pin} published to firebase, pointing at ${ip}`);
        } else {
            console.error(`firebase publish failed with status ${res.statusCode}`);
        }
    });

    req.on('error', (err) => console.error('couldnt reach firebase:', err));
    req.write(payload);
    req.end();
}

module.exports = { getLocalIp, publishPinToFirebase, FIREBASE_DB_URL };