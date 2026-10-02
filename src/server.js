import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import app from './app.js';
import { pool } from './config/db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const PORT = process.env.PORT || 5000;

// Test DB connection before starting server
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Failed to connect to PostgreSQL database:', err.message);
    process.exit(1);
  }
  console.log('✓ Connected to PostgreSQL database at:', res.rows[0].now);

  const server = app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`  JB Tracker API Server Running on port ${PORT}`);
    console.log(`  Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`  API Base URL: http://localhost:${PORT}/api`);
    console.log(`====================================================`);
  });

  const gracefulShutdown = () => {
    console.log('Received shutdown signal, terminating smoothly...');
    server.close(() => {
      pool.end(() => {
        console.log('PostgreSQL connection pool closed.');
        process.exit(0);
      });
    });
  };

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);
});
