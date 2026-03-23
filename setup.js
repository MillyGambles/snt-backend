require('dotenv').config();
const mysql = require('mysql2/promise');

async function setup(){
  const db = mysql.createPool({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT)||3306,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl:      {rejectUnauthorized:false},
    charset:  'utf8mb4'
  });
  await db.query('ALTER TABLE settings CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  await db.query('ALTER TABLE settings MODIFY value LONGTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci');
  console.log('✅ Fixed!');
  process.exit();
}

setup().catch(console.error);