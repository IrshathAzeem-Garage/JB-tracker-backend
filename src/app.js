import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import routes from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { errorResponse } from './utils/response.js';

const app = express();

// Security and utility middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
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
