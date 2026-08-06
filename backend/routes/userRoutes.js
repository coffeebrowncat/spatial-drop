// ============================================================
// FILE: backend/routes/userRoutes.js
// Spatial Drop — sync a signed-in user's profile to Mongo.
//
// this is what actually saves a signed-in user's profile into mongo.
// call it once, right after sign-in or guest sign-in succeeds, with
// their firebase uid and whatever profile info you've got. it's an
// upsert, so it works exactly the same whether this is someone's very
// first login ever or their hundredth — one route, no separate create
// vs update branch to maintain.
//
// wire it in exactly like transferRoutes is already wired into
// server.js:
//   const userRoutes = require('./routes/userRoutes');
//   app.use('/api', userRoutes);
// ============================================================

const express = require('express');
const User = require('../models/User');

const router = express.Router();

// upsert — makes the user doc if it's new, quietly updates it if it
// already exists, same endpoint either way
router.post('/user/sync', async (req, res) => {
  const { firebaseUid, email, displayName, isGuest, avatarId, theme } = req.body;

  if (!firebaseUid) {
    return res.status(400).json({ error: 'firebaseUid is required' });
  }

  try {
    const user = await User.findOneAndUpdate(
      { firebaseUid },
      {
        $set: {
          email: email ?? null,
          displayName: displayName ?? 'node',
          isGuest: !!isGuest,
          ...(avatarId && { avatarId }),
          ...(theme && { theme }),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, user });
  } catch (err) {
    console.error('user sync failed:', err);
    res.status(500).json({ error: 'user sync failed' });
  }
});

// pulls back a user's saved avatar/theme by their firebase uid
router.get('/user/:firebaseUid', async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.params.firebaseUid });
    if (!user) return res.status(404).json({ error: 'user not found' });
    res.status(200).json({ user });
  } catch (err) {
    res.status(500).json({ error: 'lookup failed' });
  }
});

module.exports = router;