// this file's job is narrow and specific: figure out this laptop's
// local ip address, and tell firebase "hey, this pin points here right
// now." pulled out of server.js so server.js doesn't have to know
// anything about HOW pin publishing works, just that it happens
const https = require('https');
const os = require('os');

// paste your own firebase realtime database url here, the one that
// looks like https://your-project-xxxxx-default-rtdb.firebaseio.com
const FIREBASE_DB_URL = process.env.FIREBASE_URL;

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

// NEW — WATCH FOR IP CHANGES. the old version of this file only ever
// published the ip ONCE, right when the server booted. if your laptop's
// local ip changes after that — dhcp lease renewal, router reboot,
// switching from wifi to ethernet, anything where you're still on the
// SAME network, just got handed a different address — firebase keeps
// pointing at the old dead ip forever, until you manually restart the
// app and it re-publishes at boot.
//
// this polls getLocalIp() every few seconds and only calls
// publishPinToFirebase again if the answer actually changed, so it's
// cheap and doesn't spam firebase every tick for no reason. call this
// once, right after your initial boot-time publish, and hang onto the
// returned interval id if you ever want to stop it (e.g. on shutdown).
//
// NOTE — this does NOT and CANNOT fix the laptop switching to a
// DIFFERENT network than the phone (different wifi, laptop on wifi
// while the phone's on cellular, laptop tethers to a hotspot, etc).
// local ips like 192.168.x.x only mean anything to other devices on
// that exact same router — there's no ip we could publish that would
// make that reachable from a different network. that case needs a
// relay/public server sitting in between, which is a bigger, separate
// project. this just keeps things correct as long as you're on the
// same network the whole time, which covers the vast majority of the
// actual "it randomly stopped working" cases.
function startIpWatcher(pin, currentIp, intervalMs = 5000) {
    let lastKnownIp = currentIp;

    return setInterval(() => {
        const freshIp = getLocalIp();

        if (!freshIp) {
            // network dropped entirely (wifi off, etc) — nothing useful
            // to publish, just wait for it to come back
            return;
        }

        if (freshIp !== lastKnownIp) {
            console.log(`local ip changed from ${lastKnownIp} to ${freshIp} — republishing to firebase.`);
            lastKnownIp = freshIp;
            publishPinToFirebase(pin, freshIp);
        }
    }, intervalMs);
}

module.exports = { getLocalIp, publishPinToFirebase, startIpWatcher, FIREBASE_DB_URL };