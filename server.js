// grab the tool that lets us build web pages
const express = require('express');
// grab the tool that lets the computer talk over the network
const http = require('http');
// grab the tool that keeps the connection open like a live phone call
const WebSocket = require('ws');
// grab the tool that stops the browser from blocking our connection
const cors = require('cors');

// start up the web page builder
const app = express();
// tell the web page builder to use the anti-blocker tool
app.use(cors());

// build the actual server that listens to the network
const server = http.createServer(app);

// attach our live phone-call tool to the server we just built
const wss = new WebSocket.Server({ server });

// when a new device connects to our server, do this
wss.on('connection', (socket) => {
    // print a message to the terminal so we know someone joined
    console.log('a wild device has connected to the spatial drop');

    // wait for the device to actually send us a file or text
    socket.on('message', (message) => {
        // print out whatever the device sent us in the terminal
        console.log(`incoming transmission: ${message}`);
        
        // look at every single device that is currently connected
        wss.clients.forEach((client) => {
            // if the device is not the one who sent the message, and it is still connected
            if (client !== socket && client.readyState === WebSocket.OPEN) {
                // forward the message to them
                client.send(message.toString());
            }
        });
    });

    // if the device hangs up the connection
    socket.on('close', () => {
        // tell us they left
        console.log('a device disconnected');
    });
});

// pick the network door number our server will listen at
const port = 3000;
// turn the server on and open the door
server.listen(port, () => {
    // tell us it is finally running and ready
    console.log(`teleporter core online: listening on port ${port}`);
});