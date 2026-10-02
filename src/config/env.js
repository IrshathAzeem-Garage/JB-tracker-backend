import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Priority list for finding a local .env file during development
const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'backend/.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env'),
  path.resolve(__dirname, '../.env'),
];

let loadedEnvPath = null;
for (const candidate of candidateEnvPaths) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    loadedEnvPath = candidate;
    break;
  }
}

if (loadedEnvPath) {
  console.log(`[Config] Loaded environment variables from local .env: ${loadedEnvPath}`);
} else {
  // When running on Render, Vercel, Railway, AWS, or Docker,
  // .env files are not checked in; environment variables are supplied directly by the platform
  console.log('[Config] No local .env file found. Falling back to host platform environment variables (Render / Vercel / Cloud).');
}

export const env = {
  PORT: process.env.PORT || 5000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://postgres:Pass@123@localhost:5432/jb_tracker',
  JWT_SECRET: process.env.JWT_SECRET || 'jb_tracker_super_secret_jwt_key_2026_production_ready',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',
  CORS_ORIGIN: process.env.CORS_ORIGIN || '',
  DATABASE_SSL: process.env.DATABASE_SSL,
};

export default env;
