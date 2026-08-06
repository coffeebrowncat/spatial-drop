// ============================================================
// FILE: backend/models/User.js
// Spatial Drop — the user database schema.
//
// the user table, kept deliberately small. firebase auth already
// handles the actual security side (passwords, tokens, all of that) —
// this table only exists to remember the stuff firebase doesn't know
// about, like which avatar someone picked, keyed against their
// firebase uid.
// ============================================================

const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true }, // links back to the actual firebase auth account
  email: { type: String, default: null }, // stays null for guest accounts, they never gave one
  displayName: { type: String, default: 'node' },
  isGuest: { type: Boolean, default: false },
  avatarId: { type: String, default: 'comet' }, // matches the ids in AVATAR_PRESETS over in AvatarPicker.js
  theme: { type: String, enum: ['dark', 'light'], default: 'dark' },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model('User', userSchema);