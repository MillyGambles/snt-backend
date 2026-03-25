require('dotenv').config();
const mysql = require('mysql2/promise');

async function setup(){
  const db = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT)||3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: {rejectUnauthorized:false}
  });
  await db.query('ALTER TABLE users ADD COLUMN avatar VARCHAR(100) DEFAULT NULL');
  console.log('✅ Avatar column added!');
  process.exit();
}

setup().catch(console.error);