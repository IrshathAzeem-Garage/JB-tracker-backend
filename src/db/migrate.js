import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runMigration() {
  console.log('--- Starting Database Migration for jb_tracker ---');
  const schemaPath = path.resolve(__dirname, '../../../database/schema.sql');
  
  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found at ${schemaPath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(schemaPath, 'utf8');

  try {
    const client = await pool.connect();
    console.log('Connected to PostgreSQL successfully.');
    
    await client.query(sql);
    console.log('✓ All database tables, constraints, and indexes created successfully.');
    
    client.release();
    await pool.end();
    console.log('--- Migration Finished Successfully ---');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    await pool.end();
    process.exit(1);
  }
}

runMigration();
