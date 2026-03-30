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
  waitForConnections: true,
  connectionLimit: 5,
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
      if(user.avatar) await db.query('UPDATE users SET avatar=? WHERE id=?', [user.avatar, user.id]).catch(()=>{});
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
    const [rows] = await db.query('SELECT id, username, avatar, points, total_invites FROM users ORDER BY points DESC LIMIT 50');
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

app.post('/api/shop', async (req, res) => {
  try {
    const {name, description, cost, stock, icon, item_type, discord_role_id, role_color} = req.body;
    await db.query('INSERT INTO shop_items (name, description, cost, stock, icon, active, item_type, discord_role_id, role_color) VALUES (?,?,?,?,?,1,?,?,?)',
      [name, description||'', cost, stock||-1, icon||'', item_type||'reward', discord_role_id||null, role_color||'#3b82f6']);
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
    const {title, status, description, date, prizes, start_date, end_date} = req.body;
    await db.query('INSERT INTO events (title, status, description, date, prizes, start_date, end_date) VALUES (?,?,?,?,?,?,?)',
      [title, status, description||'', date||'TBA', JSON.stringify(prizes||[]), start_date||null, end_date||null]);
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

app.post('/api/claims', async (req, res) => {
  try {
    const {user_id, item_id, gifted_to_id, gifted_to_name} = req.body;
    const recipient_id = gifted_to_id || user_id;
    await db.query('INSERT INTO claims (user_id, item_id, gifted_to_id, gifted_to_name) VALUES (?,?,?,?)',
      [user_id, item_id, gifted_to_id||null, gifted_to_name||null]);
    const [[claimUser]] = await db.query('SELECT username, avatar FROM users WHERE id=?', [user_id]);
    const [[claimItem]] = await db.query('SELECT name, item_type, discord_role_id FROM shop_items WHERE id=?', [item_id]);
    if(claimUser && claimItem){
      await db.query('INSERT INTO activity_feed (type,user_id,username,avatar,message) VALUES (?,?,?,?,?)',
        ['claim', user_id, claimUser.username, claimUser.avatar||'',
          gifted_to_name ? claimUser.username+' gifted '+claimItem.name+' to '+gifted_to_name+' 🎁'
          : claimUser.username+' claimed '+claimItem.name+' 🎁']);
      if(claimItem.item_type==='role' && claimItem.discord_role_id){
        await db.query('INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
          ['pending_role_'+recipient_id,
           JSON.stringify({user_id:recipient_id, role_id:claimItem.discord_role_id, item:claimItem.name}),
           JSON.stringify({user_id:recipient_id, role_id:claimItem.discord_role_id, item:claimItem.name})]);
      }
    }
    res.json({success: true});
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
app.get('/api/users/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id=?', [req.params.id]);
    res.json(rows[0] || {});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.patch('/api/users/:id', async (req, res) => {
  try {
    if(req.body.points !== undefined) await db.query('UPDATE users SET points=? WHERE id=?', [req.body.points, req.params.id]);
    if(req.body.total_invites !== undefined) await db.query('UPDATE users SET total_invites=? WHERE id=?', [req.body.total_invites, req.params.id]);
    await checkAndAwardBadges(req.params.id);
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
    const [rows] = await db.query("SELECT * FROM settings WHERE key_name='theme'");
    res.json(rows[0] ? JSON.parse(rows[0].value) : {});
  } catch(e) {
    res.json({});
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
    res.status(500).json({error: e.message});
  }
});

// ─── Settings ────────────────────────────────────────────────────────────────
app.get('/api/settings/:key', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM settings WHERE key_name=?", [req.params.key]);
    res.json(rows[0] ? JSON.parse(rows[0].value) : {});
  } catch(e) {
    res.json({});
  }
});

app.post('/api/settings/:key', async (req, res) => {
  try {
    await db.query('INSERT INTO settings (key_name, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?', [req.params.key, JSON.stringify(req.body), JSON.stringify(req.body)]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ─── Announcements ────────────────────────────────────────────────────────────
app.get('/api/announcements', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM announcements ORDER BY created_at DESC LIMIT 20');
    res.json(rows);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.post('/api/announcements', async (req, res) => {
  try {
    const {title, content} = req.body;
    await db.query('INSERT INTO announcements (title, content) VALUES (?,?)', [title, content||'']);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.delete('/api/announcements/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM announcements WHERE id=?', [req.params.id]);
    res.json({success: true});
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

app.get('/api/claims/user/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT c.*, s.name as item_name, s.icon FROM claims c JOIN shop_items s ON c.item_id=s.id WHERE c.user_id=? ORDER BY c.claimed_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch(e) {
    res.status(500).json({error: e.message});
  }
});

// ─── BADGES & PROFILE ─────────────────────────────────────────────────────────
const BADGE_DEFS = [
  {key:'first_invite',label:'First Blood',desc:'Got your first invite',emoji:'🩸',req:function(u){return u.total_invites>=1;}},
  {key:'invites_5',label:'Getting Started',desc:'5 invites',emoji:'🌱',req:function(u){return u.total_invites>=5;}},
  {key:'invites_10',label:'Recruiter',desc:'10 invites',emoji:'📣',req:function(u){return u.total_invites>=10;}},
  {key:'invites_25',label:'Grinder',desc:'25 invites',emoji:'⚙️',req:function(u){return u.total_invites>=25;}},
  {key:'invites_50',label:'SNT Soldier',desc:'50 invites',emoji:'🎖️',req:function(u){return u.total_invites>=50;}},
  {key:'invites_100',label:'Legend',desc:'100 invites',emoji:'👑',req:function(u){return u.total_invites>=100;}},
  {key:'points_1000',label:'Stack Up',desc:'Reached 1,000 points',emoji:'💰',req:function(u){return u.points>=1000;}},
  {key:'points_5000',label:'Big Bag',desc:'Reached 5,000 points',emoji:'💎',req:function(u){return u.points>=5000;}},
  {key:'points_10000',label:'Whale',desc:'Reached 10,000 points',emoji:'🐋',req:function(u){return u.points>=10000;}},
  {key:'og',label:'OG',desc:'One of the first 10 members',emoji:'🏆',req:function(u){return false;}},
  {key:'donator',label:'Donator',desc:'Supported SNT with a donation',emoji:'💸',req:function(u){return false;}},
];

async function checkAndAwardBadges(userId){
  try {
    const [[user]] = await db.query('SELECT * FROM users WHERE id=?',[userId]);
    if(!user) return;
    for(const b of BADGE_DEFS){
      if(b.req(user)){
        const [result] = await db.query('INSERT IGNORE INTO badges (user_id,badge_key) VALUES (?,?)',[userId,b.key]);
        if(result.affectedRows>0){
          await db.query('INSERT INTO activity_feed (type,user_id,username,avatar,message) VALUES (?,?,?,?,?)',
            ['badge',userId,user.username,user.avatar||'',user.username+' unlocked the '+b.label+' badge '+b.emoji]);
        }
      }
    }
  } catch(e){}
}

app.get('/api/profile/:id', async (req, res) => {
  try {
    const [[user]] = await db.query('SELECT id,username,avatar,points,total_invites,joined_at,profile_public FROM users WHERE id=?',[req.params.id]);
    if(!user) return res.status(404).json({error:'User not found'});
    await checkAndAwardBadges(req.params.id);
    const [badges] = await db.query('SELECT badge_key,awarded_at FROM badges WHERE user_id=?',[req.params.id]);
    const [claims] = await db.query('SELECT c.*,s.name as item_name,s.icon FROM claims c JOIN shop_items s ON c.item_id=s.id WHERE c.user_id=? ORDER BY c.claimed_at DESC',[req.params.id]);
    const [allUsers] = await db.query('SELECT id FROM users ORDER BY total_invites DESC');
    const invRank = allUsers.findIndex(u=>u.id==req.params.id)+1;
    const [allPts] = await db.query('SELECT id FROM users ORDER BY points DESC');
    const ptsRank = allPts.findIndex(u=>u.id==req.params.id)+1;
    const [roles] = await db.query('SELECT role_name,color FROM user_roles WHERE user_id=?',[req.params.id]);
const [[equipped]] = await db.query('SELECT badge_keys FROM equipped_badges WHERE user_id=?',[req.params.id]);
res.json({user,badges:badges.map(b=>b.badge_key),claims,invRank,ptsRank,roles,equippedBadges:equipped?equipped.badge_keys:''});
  } catch(e){res.status(500).json({error:e.message});}
});

app.patch('/api/profile/:id/privacy', async (req, res) => {
  try {
    await db.query('UPDATE users SET profile_public=? WHERE id=?',[req.body.public?1:0,req.params.id]);
    res.json({success:true});
  } catch(e){res.status(500).json({error:e.message});}
});

// ─── ROLES ────────────────────────────────────────────────────────────────────
app.get('/api/roles/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM user_roles WHERE user_id=?', [req.params.id]);
    res.json(rows);
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/roles', async (req, res) => {
  try {
    const {user_id, role_name, color} = req.body;
    await db.query('INSERT IGNORE INTO user_roles (user_id, role_name, color) VALUES (?,?,?)', [user_id, role_name, color||'#3b82f6']);
    res.json({success: true});
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.delete('/api/roles/:userId/:roleName', async (req, res) => {
  try {
    await db.query('DELETE FROM user_roles WHERE user_id=? AND role_name=?', [req.params.userId, req.params.roleName]);
    res.json({success: true});
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ─── EQUIPPED BADGES ──────────────────────────────────────────────────────────
app.get('/api/equipped/:id', async (req, res) => {
  try {
    const [[row]] = await db.query('SELECT badge_keys FROM equipped_badges WHERE user_id=?', [req.params.id]);
    res.json({badge_keys: row ? row.badge_keys : ''});
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/equipped/:id', async (req, res) => {
  try {
    const keys = req.body.badge_keys||'';
    await db.query('INSERT INTO equipped_badges (user_id, badge_keys) VALUES (?,?) ON DUPLICATE KEY UPDATE badge_keys=?', [req.params.id, keys, keys]);
    res.json({success: true});
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ─── ACTIVITY FEED ────────────────────────────────────────────────────────────
app.get('/api/activity', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM activity_feed ORDER BY created_at DESC LIMIT 30');
    res.json(rows);
  } catch(e) { res.status(500).json({error: e.message}); }
});

app.post('/api/activity', async (req, res) => {
  try {
    const {type, user_id, username, avatar, message} = req.body;
    await db.query('INSERT INTO activity_feed (type, user_id, username, avatar, message) VALUES (?,?,?,?,?)', [type, user_id, username, avatar||'', message]);
    // keep only last 100 entries
    await db.query('DELETE FROM activity_feed WHERE id NOT IN (SELECT id FROM (SELECT id FROM activity_feed ORDER BY created_at DESC LIMIT 100) t)');
    res.json({success: true});
  } catch(e) { res.status(500).json({error: e.message}); }
});

// ─── BOT CONTROLS ─────────────────────────────────────────────────────────────
app.get('/api/bot/settings', async (req, res) => {
  try {
    const keys = ['bot_ai_enabled','bot_prompt','bot_welcome_enabled','bot_milestones_enabled','bot_allowed_channels'];
    const result = {};
    for(const k of keys){
      const [rows] = await db.query('SELECT value FROM settings WHERE key_name=?',[k]);
      result[k] = rows[0] ? JSON.parse(rows[0].value) : null;
    }
    res.json(result);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/bot/settings', async (req, res) => {
  try {
    const allowed = ['bot_ai_enabled','bot_prompt','bot_welcome_enabled','bot_milestones_enabled','bot_allowed_channels'];
    for(const k of allowed){
      if(req.body[k] !== undefined){
        await db.query('INSERT INTO settings (key_name,value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
          [k, JSON.stringify(req.body[k]), JSON.stringify(req.body[k])]);
      }
    }
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── DONATIONS ────────────────────────────────────────────────────────────────
app.get('/api/donations', async (req, res) => {
  try {
    const [crypto] = await db.query("SELECT * FROM donations WHERE donation_type='crypto' ORDER BY amount_usd DESC LIMIT 50");
    const [robux] = await db.query("SELECT * FROM donations WHERE donation_type='robux' ORDER BY amount_robux DESC LIMIT 50");
    res.json({crypto, robux});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/donations', async (req, res) => {
  try {
    const {user_id, username, amount_usd, amount_robux, crypto, tx_hash, note, donation_type} = req.body;
    await db.query('INSERT INTO donations (user_id, username, amount_usd, amount_robux, crypto, tx_hash, note, donation_type) VALUES (?,?,?,?,?,?,?,?)',
      [user_id||null, username, amount_usd||0, amount_robux||0, crypto||'', tx_hash||'', note||'', donation_type||'crypto']);
    if(user_id){
      await db.query('INSERT IGNORE INTO badges (user_id, badge_key) VALUES (?,?)', [user_id, 'donator']);
      await db.query('INSERT INTO activity_feed (type,user_id,username,avatar,message) VALUES (?,?,?,?,?)',
        ['donate', user_id, username, '', username+' made a donation 💸']);
    }
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.delete('/api/donations/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM donations WHERE id=?', [req.params.id]);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.get('/api/donation-addresses', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM donation_addresses ORDER BY id ASC');
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/donation-addresses', async (req, res) => {
  try {
    const {crypto, address, label} = req.body;
    await db.query('INSERT INTO donation_addresses (crypto, address, label) VALUES (?,?,?)', [crypto, address, label||crypto]);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.delete('/api/donation-addresses/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM donation_addresses WHERE id=?', [req.params.id]);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── EVENT LEADERBOARD ────────────────────────────────────────────────────────
app.get('/api/events/:id/leaderboard', async (req, res) => {
  try {
    const [[event]] = await db.query('SELECT * FROM events WHERE id=?', [req.params.id]);
    if(!event) return res.status(404).json({error:'Event not found'});
    let sql = 'SELECT u.id, u.username, u.avatar, COUNT(il.id) as invites FROM invite_log il JOIN users u ON il.inviter_id=u.id';
    const params = [];
    if(event.start_date && event.end_date){
      sql += ' WHERE il.invited_at BETWEEN ? AND ?';
      params.push(event.start_date, event.end_date);
    }
    sql += ' GROUP BY il.inviter_id ORDER BY invites DESC LIMIT 3';
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

// ─── PENDING ROLES ────────────────────────────────────────────────────────────
app.get('/api/pending-roles/:userId', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT key_name, value FROM settings WHERE key_name=?",
      ['pending_role_'+req.params.userId]);
    if(!rows.length) return res.json(null);
    const data = JSON.parse(rows[0].value);
    await db.query("DELETE FROM settings WHERE key_name=?", ['pending_role_'+req.params.userId]);
    res.json(data);
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`✅ Server running on http://localhost:${process.env.PORT || 3000}`);
});