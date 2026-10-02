import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes/index.js';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';
import { errorResponse } from './utils/response.js';

const app = express();

// Security and utility middleware
app.use(helmet());
// Dynamic CORS origin configuration for local development, Vercel, and Render
const allowedOrigins = env.CORS_ORIGIN
  ? env.CORS_ORIGIN.split(',').map((o) => o.trim())
  : ['http://localhost:5173', 'http://127.0.0.1:5173'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (like curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    
    // Check if origin matches or wildcard
    if (
      env.CORS_ORIGIN === '*' ||
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin.endsWith('.onrender.com') ||
      env.NODE_ENV !== 'production'
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy does not allow access from origin: ${origin}`));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'online',
    app: 'JB Tracker API',
    company: 'Just Business Things',
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use('/api', routes);

// 404 Not Found handler
app.use((req, res) => {
  return errorResponse(res, `Route not found: ${req.method} ${req.originalUrl}`, 404);
});

// Centralized error handler
app.use(errorHandler);

export default app;
