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
  await db.query('CREATE TABLE IF NOT EXISTS settings (key_name VARCHAR(100) PRIMARY KEY, value TEXT)');
  console.log('✅ Settings table created!');
  process.exit();
}

setup().catch(console.error);
