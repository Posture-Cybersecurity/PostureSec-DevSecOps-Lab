require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const postRoutes = require('./routes/posts');
const commentRoutes = require('./routes/comments');
const authRoutes = require('./routes/auth');
const { attachUser } = require('./middleware/authenticate');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(cookieParser());
// Identity is resolved for every request; routes decide what to do with it.
app.use(attachUser);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'PostureSec API is operational 🛡️' });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/comments', commentRoutes);

// Initialize database and start server
async function start() {
  try {
    await db.initDB();
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 PostureSec backend running on port ${PORT}`);
    });
    // Listen failures arrive as an async 'error' event on the server, never as
    // a throw — so the catch below cannot see them. Without this handler the
    // most common startup failure, a port already in use, surfaces as a raw
    // stack trace that says nothing about what to do next.
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n✖ Port ${PORT} is already in use.`);
        console.error('  Something else is serving on this port — most often a');
        console.error('  previous run of this backend that was never stopped.');
        console.error('  Run ./demo-preflight.sh to see what owns it.');
        console.error('  The port is fixed at 5000: frontend/vite.config.js');
        console.error('  hardcodes it. Do not work around this by changing it.\n');
      } else {
        console.error('Failed to start server:', err);
      }
      process.exit(1);
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
