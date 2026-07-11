const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

wss.on('connection', (socket, req) => {
    // this tells us exactly which device is calling
    console.log(`connection request from: ${req.socket.remoteAddress}`);

    socket.on('message', (message) => {
        console.log(`received: ${message}`);
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message.toString());
            }
        });
    });

    socket.on('error', (err) => {
        console.error('socket error:', err);
    });
});

const port = 3000;
server.listen(port, '0.0.0.0', () => {
    console.log(`server is broadcasting on all network interfaces on port ${port}`);
});