import pg from 'pg';
import { env } from './env.js';

const { Pool } = pg;

// Fetch connection string: Priority 1 is DATABASE_URL from .env or Render/Vercel platform settings
const connectionString = env.DATABASE_URL;

// Cloud hosted PostgreSQL (Render, Neon, Supabase, AWS, etc.) requires SSL
const isRemoteDb =
  connectionString.includes('render.com') ||
  connectionString.includes('neon.tech') ||
  connectionString.includes('supabase.co') ||
  connectionString.includes('amazonaws.com') ||
  env.DATABASE_SSL === 'true' ||
  (env.NODE_ENV === 'production' &&
    !connectionString.includes('localhost') &&
    !connectionString.includes('127.0.0.1'));

export const pool = new Pool({
  connectionString,
  ssl: isRemoteDb ? { rejectUnauthorized: false } : false,
});

// Helper for single query
export const query = (text, params) => pool.query(text, params);

// Helper for executing transactions safely
export const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export default {
  pool,
  query,
  withTransaction,
};
