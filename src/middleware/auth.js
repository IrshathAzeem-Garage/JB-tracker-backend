import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { errorResponse } from '../utils/response.js';

export const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse(res, 'Authentication required. No token provided.', 401);
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'jb_tracker_super_secret_jwt_key_2026_production_ready');

    const result = await query(
      'SELECT id, name, email, role, is_active FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0 || !result.rows[0].is_active) {
      return errorResponse(res, 'Invalid or inactive user session.', 401);
    }

    req.user = result.rows[0];
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return errorResponse(res, 'Session token expired. Please login again.', 401);
    }
    return errorResponse(res, 'Invalid authentication token.', 401);
  }
};

export const requireRole = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return errorResponse(res, 'Unauthorized.', 401);
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return errorResponse(
        res,
        `Access denied. Requires one of roles: ${allowedRoles.join(', ')}.`,
        403
      );
    }
    next();
  };
};
