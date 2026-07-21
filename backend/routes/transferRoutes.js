const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getPin, uploadFiles } = require('../controllers/transferController');

const router = express.Router();

// --- 6. WHERE UPLOADED FILES GO WHILE THEY'RE "IN LIMBO" ---
// files do NOT go straight to downloads. they land in a temp folder
// first and just sit there, waiting for the laptop to say "yes i
// want this" before it actually gets kept. this is what makes the
// accept/decline popup possible
const storage = multer.diskStorage({
    // os.tmpdir() = the computer's built-in "junk drawer" folder, cleans itself
    // up automatically over time, perfect for stuff that might get deleted anyway
    destination: (req, file, cb) => cb(null, os.tmpdir()),

    // give every file a random unique name so two files can never collide
    // crypto.randomUUID() basically spits out a random id that'll never repeat
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}_${file.originalname}`)
});
const upload = multer({ storage: storage });

router.get('/pin', getPin);
router.post('/upload', upload.array('files', 10), uploadFiles);

module.exports = router;