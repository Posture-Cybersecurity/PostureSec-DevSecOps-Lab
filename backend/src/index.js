require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const postRoutes = require('./routes/posts');
const commentRoutes = require('./routes/comments');
const authRoutes = require('./routes/auth');
const { attachUser } = require('./middleware/authenticate');
const db = require('./db');
// War Room (Sprint 1) scaffolding — completely inert unless WAR_ROOM_ENABLED.
const warroom = require('./warroom/config');
const warroomState = require('./warroom/state');
const { accessLogger } = require('./warroom/logger');
const incidentRoutes = require('./warroom/routes');
const { armIncidentTimer } = require('./warroom/timer');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.set('trust proxy', true);
// Identity is resolved for every request; routes decide what to do with it.
app.use(attachUser);

// Honest request logging is only mounted for the training exercise, so the
// plain lab keeps its original behaviour and schema.
if (warroom.enabled) {
  app.use(accessLogger);
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'PostureSec API is operational 🛡️' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);
// The incident api exists only during the exercise.
if (warroom.enabled) {
  app.use('/api/incident', incidentRoutes);
}

// Initialize database and start server
async function start() {
  try {
    await db.initDB();
    if (warroom.enabled) {
      await warroomState.initWarRoom();
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 PostureSec backend running on port ${PORT}`);
      // Arm the incident fuse only after the server is accepting connections —
      // the injector makes real requests to this same port.
      if (warroom.enabled) armIncidentTimer();
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Only listen when run directly (`node src/index.js`). When this module is
// imported — by the test suite, for example — the caller decides what to do
// with the app, so importing it must not bind a port.
if (require.main === module) {
  start();
}

module.exports = app;
