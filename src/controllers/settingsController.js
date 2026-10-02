import bcrypt from 'bcryptjs';
import { query } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const getCompanySettings = async (req, res, next) => {
  try {
    let result = await query('SELECT * FROM company_settings LIMIT 1;');
    if (result.rows.length === 0) {
      // Auto-initialize default company settings if table is empty
      result = await query(`
        INSERT INTO company_settings (company_name, business_name, currency, timezone, financial_year_start)
        VALUES ('Just Business Things', 'Just Business Things', 'INR', 'Asia/Kolkata', '04-01')
        RETURNING *;
      `);
    }
    return successResponse(res, result.rows[0], 'Company settings retrieved');
  } catch (err) {
    next(err);
  }
};

export const updateCompanySettings = async (req, res, next) => {
  try {
    const { company_name, business_name, currency, timezone, financial_year_start } = req.body;

    const result = await query(`
      UPDATE company_settings SET
        company_name = COALESCE($1, company_name),
        business_name = COALESCE($2, business_name),
        currency = COALESCE($3, currency),
        timezone = COALESCE($4, timezone),
        financial_year_start = COALESCE($5, financial_year_start),
        updated_at = CURRENT_TIMESTAMP
      RETURNING *;
    `, [company_name, business_name, currency, timezone, financial_year_start]);

    await logAudit({
      userId: req.user?.id,
      action: 'COMPANY_SETTINGS_UPDATED',
      entityType: 'COMPANY_SETTINGS',
      entityId: result.rows[0].id,
      newValues: result.rows[0],
    });

    return successResponse(res, result.rows[0], 'Company settings updated successfully');
  } catch (err) {
    next(err);
  }
};

export const getUsers = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT id, name, email, role, is_active, created_at, updated_at
      FROM users
      ORDER BY created_at ASC;
    `);
    return successResponse(res, result.rows, 'Users list retrieved');
  } catch (err) {
    next(err);
  }
};

export const createUser = async (req, res, next) => {
  try {
    const { name, email, password, role = 'STAFF' } = req.body;

    const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing.rows.length > 0) {
      return errorResponse(res, 'User with this email already exists', 400);
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await query(`
      INSERT INTO users (name, email, password_hash, role)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, email, role, is_active, created_at;
    `, [name, email.toLowerCase().trim(), passwordHash, role]);

    await logAudit({
      userId: req.user?.id,
      action: 'USER_CREATED',
      entityType: 'USER',
      entityId: result.rows[0].id,
      newValues: { email, role },
    });

    return successResponse(res, result.rows[0], 'User account created', 201);
  } catch (err) {
    next(err);
  }
};

export const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, role, is_active, password } = req.body;

    let passwordHash = null;
    if (password) {
      passwordHash = await bcrypt.hash(password, 10);
    }

    const result = await query(`
      UPDATE users SET
        name = COALESCE($1, name),
        role = COALESCE($2, role),
        is_active = COALESCE($3, is_active),
        password_hash = COALESCE($4, password_hash),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING id, name, email, role, is_active, created_at, updated_at;
    `, [
      name !== undefined ? name : null,
      role !== undefined ? role : null,
      is_active !== undefined ? is_active : null,
      passwordHash,
      id
    ]);

    if (result.rows.length === 0) {
      return errorResponse(res, 'User not found', 404);
    }

    return successResponse(res, result.rows[0], 'User updated successfully');
  } catch (err) {
    next(err);
  }
};

export const getAuditLogs = async (req, res, next) => {
  try {
    const { page = 1, limit = 30 } = req.query;
    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);

    const countRes = await query('SELECT COUNT(id) as total FROM audit_logs;');
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    const result = await query(`
      SELECT 
        a.*,
        u.name as user_name,
        u.email as user_email
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT $1 OFFSET $2;
    `, [parseInt(limit, 10), offset]);

    return successResponse(res, {
      logs: result.rows,
      pagination: {
        total: totalRecords,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalRecords / parseInt(limit, 10)),
      },
    }, 'Audit logs retrieved');
  } catch (err) {
    next(err);
  }
};
