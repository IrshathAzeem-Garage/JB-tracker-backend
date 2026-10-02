import { query } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const getCategories = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT 
        c.*,
        COUNT(p.id)::int as product_count
      FROM categories c
      LEFT JOIN products p ON c.id = p.category_id
      GROUP BY c.id
      ORDER BY c.name ASC;
    `);

    return successResponse(res, result.rows, 'Categories retrieved');
  } catch (err) {
    next(err);
  }
};

export const createCategory = async (req, res, next) => {
  try {
    const { name, description, is_active = true } = req.body;

    const result = await query(`
      INSERT INTO categories (name, description, is_active)
      VALUES ($1, $2, $3)
      RETURNING *;
    `, [name, description || null, is_active]);

    await logAudit({
      userId: req.user?.id,
      action: 'CATEGORY_CREATED',
      entityType: 'CATEGORY',
      entityId: result.rows[0].id,
      newValues: { name },
    });

    return successResponse(res, result.rows[0], 'Category created successfully', 201);
  } catch (err) {
    next(err);
  }
};

export const updateCategory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, is_active } = req.body;

    const result = await query(`
      UPDATE categories SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        is_active = COALESCE($3, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $4
      RETURNING *;
    `, [
      name !== undefined ? name : null,
      description !== undefined ? description : null,
      is_active !== undefined ? is_active : null,
      id
    ]);

    if (result.rows.length === 0) {
      return errorResponse(res, 'Category not found', 404);
    }

    return successResponse(res, result.rows[0], 'Category updated successfully');
  } catch (err) {
    next(err);
  }
};
