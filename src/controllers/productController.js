import { query } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const getProducts = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      categoryId = '',
      isActive = '',
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`(
        LOWER(p.name) LIKE $${params.length} OR 
        LOWER(COALESCE(p.sku, '')) LIKE $${params.length} OR 
        LOWER(COALESCE(p.description, '')) LIKE $${params.length}
      )`);
    }

    if (categoryId) {
      params.push(categoryId);
      conditions.push(`p.category_id = $${params.length}`);
    }

    if (isActive !== '') {
      params.push(isActive === 'true');
      conditions.push(`p.is_active = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(p.id) as total FROM products p ${whereClause};`, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    params.push(parseInt(limit, 10));
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const sql = `
      SELECT 
        p.*,
        c.name as category_name,
        (p.default_selling_price - p.default_cost_price)::numeric as default_margin,
        CASE 
          WHEN p.default_selling_price > 0 THEN ROUND(((p.default_selling_price - p.default_cost_price) / p.default_selling_price) * 100, 2)
          ELSE 0
        END as default_margin_percentage
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ${whereClause}
      ORDER BY p.name ASC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const dataRes = await query(sql, params);

    return successResponse(res, {
      products: dataRes.rows,
      pagination: {
        total: totalRecords,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalRecords / parseInt(limit, 10)),
      },
    }, 'Products retrieved');
  } catch (err) {
    next(err);
  }
};

export const createProduct = async (req, res, next) => {
  try {
    const {
      category_id,
      name,
      description,
      sku,
      unit = 'pcs',
      default_selling_price = 0,
      default_cost_price = 0,
      is_active = true,
    } = req.body;

    const result = await query(`
      INSERT INTO products (
        category_id, name, description, sku, unit, default_selling_price, default_cost_price, is_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;
    `, [
      category_id || null,
      name,
      description || null,
      sku || null,
      unit,
      default_selling_price,
      default_cost_price,
      is_active,
    ]);

    const newProd = result.rows[0];

    await logAudit({
      userId: req.user?.id,
      action: 'PRODUCT_CREATED',
      entityType: 'PRODUCT',
      entityId: newProd.id,
      newValues: { name, sku, default_selling_price, default_cost_price },
    });

    return successResponse(res, newProd, 'Product created successfully', 201);
  } catch (err) {
    next(err);
  }
};

export const updateProduct = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      category_id,
      name,
      description,
      sku,
      unit,
      default_selling_price,
      default_cost_price,
      is_active,
    } = req.body;

    const existingRes = await query('SELECT * FROM products WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return errorResponse(res, 'Product not found', 404);
    }

    const updRes = await query(`
      UPDATE products SET
        category_id = COALESCE($1, category_id),
        name = COALESCE($2, name),
        description = COALESCE($3, description),
        sku = COALESCE($4, sku),
        unit = COALESCE($5, unit),
        default_selling_price = COALESCE($6, default_selling_price),
        default_cost_price = COALESCE($7, default_cost_price),
        is_active = COALESCE($8, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *;
    `, [
      category_id !== undefined ? category_id : null,
      name !== undefined ? name : null,
      description !== undefined ? description : null,
      sku !== undefined ? sku : null,
      unit !== undefined ? unit : null,
      default_selling_price !== undefined ? default_selling_price : null,
      default_cost_price !== undefined ? default_cost_price : null,
      is_active !== undefined ? is_active : null,
      id
    ]);

    await logAudit({
      userId: req.user?.id,
      action: 'PRODUCT_UPDATED',
      entityType: 'PRODUCT',
      entityId: id,
      newValues: updRes.rows[0],
    });

    return successResponse(res, updRes.rows[0], 'Product updated successfully');
  } catch (err) {
    next(err);
  }
};
