require('dotenv').config();
const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const db = mysql.createPool({
  host:     process.env.DB_HOST,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

// ─── Leaderboard ─────────────────────────────────────────────────────────────
app.get('/api/leaderboard', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, points, total_invites FROM users ORDER BY points DESC LIMIT 50'
    );
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

// ─── Shop items ───────────────────────────────────────────────────────────────
app.get('/api/shop', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM shop_items WHERE active=1 ORDER BY cost ASC');
    res.json(rows);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/shop', async (req, res) => {
  try {
    const {name, description, cost, stock, icon} = req.body;
    await db.query(
      'INSERT INTO shop_items (name, description, cost, stock, icon, active) VALUES (?,?,?,?,?,1)',
      [name, description||'', cost, stock||-1, icon||'🎁']
    );
    res.json({success: true});
  } catch(e) {
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
    await db.query(
      'INSERT INTO events (title, status, description, date, prizes) VALUES (?,?,?,?,?)',
      [title, status, description||'', date||'TBA', JSON.stringify(prizes||[])]
    );
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
    const [rows] = await db.query(
      'SELECT c.*, u.username, s.name as item_name FROM claims c JOIN users u ON c.user_id=u.id JOIN shop_items s ON c.item_id=s.id ORDER BY c.claimed_at DESC'
    );
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
    await db.query(
      'INSERT INTO settings (key_name, value) VALUES ("theme",?) ON DUPLICATE KEY UPDATE value=?',
      [JSON.stringify(req.body), JSON.stringify(req.body)]
    );
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.listen(process.env.PORT, () => {
  console.log(`✅ Server running on http://localhost:${process.env.PORT}`);
});