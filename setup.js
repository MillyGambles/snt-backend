require('dotenv').config();
const mysql = require('mysql2/promise');

async function setup(){
  const db = mysql.createPool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT)||3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:      {rejectUnauthorized:false}
  });

  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(20) PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    points INT DEFAULT 0,
    total_invites INT DEFAULT 0,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS invite_log (
    id INT AUTO_INCREMENT PRIMARY KEY,
    inviter_id VARCHAR(20) NOT NULL,
    invitee_id VARCHAR(20) NOT NULL,
    invited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS shop_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    cost INT NOT NULL,
    stock INT DEFAULT -1,
    icon VARCHAR(20) DEFAULT '',
    active BOOLEAN DEFAULT TRUE
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS claims (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(20) NOT NULL,
    item_id INT NOT NULL,
    claimed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status ENUM('pending','delivered','rejected') DEFAULT 'pending'
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    status ENUM('live','upcoming','ended') DEFAULT 'upcoming',
    description TEXT,
    date VARCHAR(50),
    prizes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS settings (
    key_name VARCHAR(100) PRIMARY KEY,
    value TEXT
  )`);

  console.log('✅ All tables created!');
  process.exit();
}

setup().catch(console.error);