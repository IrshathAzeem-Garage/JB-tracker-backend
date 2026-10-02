import { errorResponse } from '../utils/response.js';

export const errorHandler = (err, req, res, next) => {
  console.error('Unhandled Server Error:', err);

  const statusCode = err.statusCode || 500;
  let message = err.message || 'An internal server error occurred.';

  // Avoid leaking sensitive database or crypto details
  if (err.code && typeof err.code === 'string' && err.code.startsWith('23')) {
    // Postgres integrity constraint violations
    if (err.code === '23505') {
      message = 'A record with matching unique identifier/code already exists.';
    } else if (err.code === '23503') {
      message = 'Referenced related record does not exist or is currently restricted.';
    }
  }

  const errors = process.env.NODE_ENV === 'development' ? [err.stack] : [];

  return errorResponse(res, message, statusCode, errors);
};
