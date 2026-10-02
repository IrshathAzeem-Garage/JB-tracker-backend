import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../config/db.js';
import { env } from '../config/env.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const userRes = await query(
      'SELECT id, name, email, password_hash, role, is_active FROM users WHERE email = $1',
      [email.toLowerCase().trim()]
    );

    if (userRes.rows.length === 0) {
      return errorResponse(res, 'Invalid email or password credentials', 401);
    }

    const user = userRes.rows[0];

    if (!user.is_active) {
      return errorResponse(res, 'Your user account is inactive. Please contact administrator.', 403);
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return errorResponse(res, 'Invalid email or password credentials', 401);
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN || '7d' }
    );

    await logAudit({
      userId: user.id,
      action: 'USER_LOGIN',
      entityType: 'USER',
      entityId: user.id,
      newValues: { email: user.email, timestamp: new Date() },
    });

    return successResponse(res, {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    }, 'Login successful');
  } catch (err) {
    next(err);
  }
};

export const getMe = async (req, res, next) => {
  try {
    return successResponse(res, { user: req.user }, 'Current user retrieved');
  } catch (err) {
    next(err);
  }
};
