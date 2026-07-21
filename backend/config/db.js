const path = require('path');
const Database = require('better-sqlite3'); // npm install better-sqlite3
const mongoose = require('mongoose');

// --- 4. THE TRANSFER LOG (a real sql database) ---
// this is genuinely a sql database - just a single local file
// (transfers.db) sitting next to this server file, instead of a big
// database server somewhere. every time a transfer finishes (accepted
// OR declined), we write one row here. this is separate from the
// ephemeral file-transfer stuff itself, which we deliberately still
// never log - this table only ever knows "something happened", never
// what the file actually was or what was inside it
const db = new Database(path.join(__dirname, '..', 'transfers.db'));

// this only actually builds the table the very first time this ever
// runs - every time after that, this line quietly does nothing
db.exec(`
    CREATE TABLE IF NOT EXISTS transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        file_count INTEGER,
        status TEXT
    )
`);

// tiny helper - call this any time a transfer finishes, one way or another
function logTransfer(fileCount, status) {
    db.prepare('INSERT INTO transfers (timestamp, file_count, status) VALUES (?, ?, ?)')
      .run(new Date().toISOString(), fileCount, status);
}

// --- 9. DATABASE CONNECTION (mongo, separate from the sqlite log above) ---
// this just connects us to mongo so we can remember stuff like usernames
// later if we want. totally separate from the file transfer stuff
function connectMongo() {
    if (process.env.MONGO_URI) {
        mongoose.connect(process.env.MONGO_URI)
            .then(() => console.log('[stealth] mongo analytics firehose: ONLINE'))
            .catch((err) => console.error('mongo connection failed:', err));
    }
}

module.exports = {
    logTransfer,
    connectMongo
};