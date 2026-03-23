require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;

const app = express();
app.use(cors({origin: true, credentials: true}));
app.use(express.json());

const db = mysql.createPool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl:      {rejectUnauthorized: false},
  charset:  'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
});

app.use(session({
  secret: process.env.SESSION_SECRET || 'snt_secret',
  resave: false,
  saveUninitialized: false,
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

passport.use(new DiscordStrategy({
  clientID:     process.env.DISCORD_CLIENT_ID,
  clientSecret: process.env.DISCORD_CLIENT_SECRET,
  callbackURL:  process.env.DISCORD_REDIRECT_URI,
  scope:        ['identify'],
}, async (accessToken, refreshToken, profile, done) => {
  return done(null, profile);
}));

// ─── Auth ─────────────────────────────────────────────────────────────────────
app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback',
  passport.authenticate('discord', { failureRedirect: process.env.FRONTEND_URL }),
  async (req, res) => {
    const user = req.user;
    try {
      const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [user.id]);
      const pts = rows[0] ? rows[0].points : 0;
      res.redirect(`${process.env.FRONTEND_URL}?discord_id=${user.id}&username=${encodeURIComponent(user.username)}&avatar=${user.avatar}&pts=${pts}`);
    } catch(e) {
      res.redirect(process.env.FRONTEND_URL);
    }
  }
);

app.get('/auth/logout', (req, res) => {
  req.logout(() => {});
  res.redirect(process.env.FRONTEND_URL);
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, username, points, total_invites FROM users ORDER BY points DESC LIMIT 50');
    res.json(rows);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ─── Stats ────────────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  try {
    const [[{total}]] = await db.query('SELECT SUM(total_invites) as total FROM users');
    const [[{members}]] = await db.query('SELECT COUNT(*) as members FROM users');
    const [[{claimed}]] = await db.query("SELECT COUNT(*) as claimed FROM claims WHERE status='delivered'");
    res.json({total_invites: total||0, active_inviters: members||0, rewards_claimed: claimed||0});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ─── Shop ─────────────────────────────────────────────────────────────────────
app.get('/api/shop', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM shop_items WHERE active=1 ORDER BY cost ASC');
    res.json(rows);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/theme', async (req, res) => {
  try {
    const cleanData = JSON.parse(JSON.stringify(req.body, (key, value) => {
      if(typeof value === 'string') return value.replace(/[^\x00-\x7F]/g, '');
      return value;
    }));
    await db.query('INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?', ['theme', JSON.stringify(cleanData), JSON.stringify(cleanData)]);
    res.json({success: true});
  } catch(e) {
    console.error('Theme save error:', e.message);
    res.status(500).json({error: e.message});
  }
});

app.delete('/api/shop/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM shop_items WHERE id=?', [req.params.id]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.patch('/api/shop/:id', async (req, res) => {
  try {
    await db.query('UPDATE shop_items SET active=? WHERE id=?', [req.body.active?1:0, req.params.id]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ─── Events ───────────────────────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM events ORDER BY id DESC');
    res.json(rows);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/events', async (req, res) => {
  try {
    const {title, status, description, date, prizes} = req.body;
    await db.query('INSERT INTO events (title, status, description, date, prizes) VALUES (?,?,?,?,?)', [title, status, description||'', date||'TBA', JSON.stringify(prizes||[])]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM events WHERE id=?', [req.params.id]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ─── Claims ───────────────────────────────────────────────────────────────────
app.get('/api/claims', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT c.*, u.username, s.name as item_name FROM claims c JOIN users u ON c.user_id=u.id JOIN shop_items s ON c.item_id=s.id ORDER BY c.claimed_at DESC');
    res.json(rows);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.patch('/api/claims/:id', async (req, res) => {
  try {
    await db.query('UPDATE claims SET status=? WHERE id=?', [req.body.status, req.params.id]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ─── Users ────────────────────────────────────────────────────────────────────
app.patch('/api/users/:id', async (req, res) => {
  try {
    await db.query('UPDATE users SET points=? WHERE id=?', [req.body.points, req.params.id]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id=?', [req.params.id]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ─── Theme ────────────────────────────────────────────────────────────────────
app.get('/api/theme', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM settings WHERE key_name="theme"');
    res.json(rows[0] ? JSON.parse(rows[0].value) : {});
  } catch(e) {
    res.json({});
  }
});

app.post('/api/theme', async (req, res) => {
  try {
    await db.query('INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?', ['theme', JSON.stringify(req.body), JSON.stringify(req.body)]);
    res.json({success: true});
  } catch(e) {
    console.error('Theme save error:', e.message);
    res.status(500).json({error: e.message});
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`✅ Server running on http://localhost:${process.env.PORT || 3000}`);
});