import { query, withTransaction } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const getSuppliers = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      sortBy = 'created_at',
      sortOrder = 'DESC',
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`(
        LOWER(s.company_name) LIKE $${params.length} OR 
        LOWER(COALESCE(s.contact_person, '')) LIKE $${params.length} OR 
        LOWER(s.supplier_code) LIKE $${params.length} OR
        LOWER(COALESCE(s.email, '')) LIKE $${params.length}
      )`);
    }

    if (status) {
      params.push(status);
      conditions.push(`s.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(s.id) as total FROM suppliers s ${whereClause};`, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    params.push(parseInt(limit, 10));
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const sql = `
      WITH supp_costs AS (
        SELECT 
          oi.supplier_id,
          COUNT(DISTINCT oi.order_id) as total_orders,
          COALESCE(SUM(oi.total_cost_amount), 0) as total_purchase_cost
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')
        GROUP BY oi.supplier_id
      ),
      supp_payments AS (
        SELECT 
          supplier_id,
          COALESCE(SUM(amount), 0) as amount_paid
        FROM supplier_payments
        GROUP BY supplier_id
      )
      SELECT 
        s.*,
        COALESCE(sc.total_orders, 0)::int as total_orders,
        COALESCE(sc.total_purchase_cost, 0)::numeric as total_purchase_cost,
        COALESCE(sp.amount_paid, 0)::numeric as amount_paid,
        (COALESCE(sc.total_purchase_cost, 0) - COALESCE(sp.amount_paid, 0))::numeric as outstanding_balance
      FROM suppliers s
      LEFT JOIN supp_costs sc ON s.id = sc.supplier_id
      LEFT JOIN supp_payments sp ON s.id = sp.supplier_id
      ${whereClause}
      ORDER BY s.${sortBy === 'company_name' ? 'company_name' : 'created_at'} ${sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const dataRes = await query(sql, params);

    return successResponse(res, {
      suppliers: dataRes.rows,
      pagination: {
        total: totalRecords,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalRecords / parseInt(limit, 10)),
      },
    }, 'Suppliers retrieved');
  } catch (err) {
    next(err);
  }
};

export const getSupplierById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const suppRes = await query('SELECT * FROM suppliers WHERE id = $1', [id]);
    if (suppRes.rows.length === 0) {
      return errorResponse(res, 'Supplier not found', 404);
    }
    const supplier = suppRes.rows[0];

    // Procurement Items from Orders
    const itemsRes = await query(`
      SELECT 
        oi.*,
        o.order_number,
        o.order_date,
        o.status as order_status,
        c.company_name as customer_name,
        p.name as product_name
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE oi.supplier_id = $1
      ORDER BY o.order_date DESC;
    `, [id]);

    // Payments made to supplier
    const paymentsRes = await query(`
      SELECT 
        sp.*,
        o.order_number,
        u.name as created_by_name
      FROM supplier_payments sp
      LEFT JOIN orders o ON sp.order_id = o.id
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.supplier_id = $1
      ORDER BY sp.payment_date DESC;
    `, [id]);

    // Financial calculations
    const totalPurchases = itemsRes.rows
      .filter(i => ['CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED'].includes(i.order_status))
      .reduce((sum, i) => sum + parseFloat(i.total_cost_amount), 0);
    const totalPaid = paymentsRes.rows.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const outstanding = totalPurchases - totalPaid;

    // Supplier Statement (Chronological ledger)
    const statementItems = [
      ...itemsRes.rows
        .filter(i => ['CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED'].includes(i.order_status))
        .map(i => ({
          date: i.order_date,
          type: 'PURCHASE',
          reference: i.order_number,
          description: `Order ${i.order_number} - ${i.description} (${i.quantity} units)`,
          debit: parseFloat(i.total_cost_amount),
          credit: 0,
        })),
      ...paymentsRes.rows.map(p => ({
        date: p.payment_date,
        type: 'PAYMENT',
        reference: p.reference_number || 'Payment Disbursed',
        description: `Payment via ${p.payment_method} ${p.order_number ? `for ${p.order_number}` : ''}`,
        debit: 0,
        credit: parseFloat(p.amount),
      }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    let runningBalance = 0;
    const statementWithRunning = statementItems.map(item => {
      runningBalance += (item.debit - item.credit);
      return {
        ...item,
        runningBalance: parseFloat(runningBalance.toFixed(2)),
      };
    });

    return successResponse(res, {
      supplier,
      summary: {
        totalOrders: new Set(itemsRes.rows.map(i => i.order_id)).size,
        totalPurchases,
        totalPaid,
        outstanding,
      },
      procurementItems: itemsRes.rows,
      payments: paymentsRes.rows,
      statement: statementWithRunning,
    }, 'Supplier details retrieved');
  } catch (err) {
    next(err);
  }
};

export const createSupplier = async (req, res, next) => {
  try {
    const {
      company_name,
      contact_person,
      email,
      phone,
      address,
      gst_number,
      notes,
      status = 'ACTIVE',
    } = req.body;

    const result = await withTransaction(async (client) => {
      // Auto generate supplier_code: SUP-0001, SUP-0002...
      const lastCodeRes = await client.query(`
        SELECT supplier_code FROM suppliers 
        WHERE supplier_code LIKE 'SUP-%' 
        ORDER BY supplier_code DESC 
        LIMIT 1 FOR UPDATE;
      `);

      let nextNum = 1;
      if (lastCodeRes.rows.length > 0) {
        const lastNumStr = lastCodeRes.rows[0].supplier_code.replace('SUP-', '');
        const parsed = parseInt(lastNumStr, 10);
        if (!isNaN(parsed)) {
          nextNum = parsed + 1;
        }
      }
      const supplierCode = `SUP-${String(nextNum).padStart(4, '0')}`;

      const insertRes = await client.query(`
        INSERT INTO suppliers (
          supplier_code, company_name, contact_person, email, phone, address, gst_number, notes, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;
      `, [
        supplierCode,
        company_name,
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        gst_number || null,
        notes || null,
        status,
      ]);

      const newSupplier = insertRes.rows[0];

      await logAudit({
        userId: req.user?.id,
        action: 'SUPPLIER_CREATED',
        entityType: 'SUPPLIER',
        entityId: newSupplier.id,
        newValues: { supplier_code: supplierCode, company_name },
        client,
      });

      return newSupplier;
    });

    return successResponse(res, result, 'Supplier created successfully', 201);
  } catch (err) {
    next(err);
  }
};

export const updateSupplier = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      company_name,
      contact_person,
      email,
      phone,
      address,
      gst_number,
      notes,
      status,
    } = req.body;

    const existingRes = await query('SELECT * FROM suppliers WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return errorResponse(res, 'Supplier not found', 404);
    }
    const existing = existingRes.rows[0];

    const updRes = await query(`
      UPDATE suppliers SET
        company_name = COALESCE($1, company_name),
        contact_person = COALESCE($2, contact_person),
        email = COALESCE($3, email),
        phone = COALESCE($4, phone),
        address = COALESCE($5, address),
        gst_number = COALESCE($6, gst_number),
        notes = COALESCE($7, notes),
        status = COALESCE($8, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *;
    `, [
      company_name !== undefined ? company_name : null,
      contact_person !== undefined ? contact_person : null,
      email !== undefined ? email : null,
      phone !== undefined ? phone : null,
      address !== undefined ? address : null,
      gst_number !== undefined ? gst_number : null,
      notes !== undefined ? notes : null,
      status !== undefined ? status : null,
      id
    ]);

    await logAudit({
      userId: req.user?.id,
      action: 'SUPPLIER_UPDATED',
      entityType: 'SUPPLIER',
      entityId: id,
      oldValues: existing,
      newValues: updRes.rows[0],
    });

    return successResponse(res, updRes.rows[0], 'Supplier updated successfully');
  } catch (err) {
    next(err);
  }
};
