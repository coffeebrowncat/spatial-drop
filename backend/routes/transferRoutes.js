const express = require('express');
const multer = require('multer');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getPin, uploadFiles, updateTransfer, deleteTransfer, downloadTransfer } = require('../controllers/transferController');

const router = express.Router();

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => cb(null, `${crypto.randomUUID()}_${file.originalname}`)
});
const upload = multer({ storage: storage });

router.get('/pin', getPin);
router.post('/upload', upload.array('files', 10), uploadFiles);
router.put('/transfer/:id', updateTransfer);
router.delete('/transfer/:id', deleteTransfer);
router.get('/download/:id', downloadTransfer); // NEW — this is what a phone actually calls to receive real bytes

module.exports = router;