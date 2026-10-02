import { query, withTransaction } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const getCustomers = async (req, res, next) => {
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
        LOWER(c.company_name) LIKE $${params.length} OR 
        LOWER(COALESCE(c.contact_person, '')) LIKE $${params.length} OR 
        LOWER(c.customer_code) LIKE $${params.length} OR
        LOWER(COALESCE(c.email, '')) LIKE $${params.length}
      )`);
    }

    if (status) {
      params.push(status);
      conditions.push(`c.status = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(c.id) as total FROM customers c ${whereClause};`, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    params.push(parseInt(limit, 10));
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const sql = `
      WITH cust_orders AS (
        SELECT 
          customer_id,
          COUNT(id) as total_orders,
          COALESCE(SUM(total_amount), 0) as total_sales,
          COALESCE(SUM(gross_profit), 0) as profit_generated
        FROM orders
        WHERE status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')
        GROUP BY customer_id
      ),
      cust_payments AS (
        SELECT 
          customer_id,
          COALESCE(SUM(amount), 0) as amount_paid
        FROM customer_payments
        GROUP BY customer_id
      )
      SELECT 
        c.*,
        COALESCE(co.total_orders, 0)::int as total_orders,
        COALESCE(co.total_sales, 0)::numeric as total_sales,
        COALESCE(cp.amount_paid, 0)::numeric as amount_paid,
        (COALESCE(co.total_sales, 0) - COALESCE(cp.amount_paid, 0))::numeric as outstanding_balance,
        COALESCE(co.profit_generated, 0)::numeric as profit_generated
      FROM customers c
      LEFT JOIN cust_orders co ON c.id = co.customer_id
      LEFT JOIN cust_payments cp ON c.id = cp.customer_id
      ${whereClause}
      ORDER BY c.${sortBy === 'company_name' ? 'company_name' : 'created_at'} ${sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC'}
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const dataRes = await query(sql, params);

    return successResponse(res, {
      customers: dataRes.rows,
      pagination: {
        total: totalRecords,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalRecords / parseInt(limit, 10)),
      },
    }, 'Customers retrieved');
  } catch (err) {
    next(err);
  }
};

export const getCustomerById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const custRes = await query('SELECT * FROM customers WHERE id = $1', [id]);
    if (custRes.rows.length === 0) {
      return errorResponse(res, 'Customer not found', 404);
    }
    const customer = custRes.rows[0];

    // Orders
    const ordersRes = await query(`
      SELECT 
        o.id,
        o.order_number,
        o.order_date,
        o.expected_delivery_date,
        o.status,
        o.total_amount,
        o.total_cost,
        o.gross_profit,
        cat.name as category_name,
        COALESCE(p.paid_amount, 0)::numeric as paid_amount,
        (o.total_amount - COALESCE(p.paid_amount, 0))::numeric as balance
      FROM orders o
      LEFT JOIN categories cat ON o.category_id = cat.id
      LEFT JOIN (
        SELECT order_id, SUM(amount) as paid_amount
        FROM customer_payments
        GROUP BY order_id
      ) p ON o.id = p.order_id
      WHERE o.customer_id = $1
      ORDER BY o.order_date DESC;
    `, [id]);

    // Payments
    const paymentsRes = await query(`
      SELECT 
        cp.*,
        o.order_number,
        u.name as created_by_name
      FROM customer_payments cp
      LEFT JOIN orders o ON cp.order_id = o.id
      LEFT JOIN users u ON cp.created_by = u.id
      WHERE cp.customer_id = $1
      ORDER BY cp.payment_date DESC;
    `, [id]);

    // Financial calculations
    const totalSales = ordersRes.rows
      .filter(o => ['CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED'].includes(o.status))
      .reduce((sum, o) => sum + parseFloat(o.total_amount), 0);
    const totalPaid = paymentsRes.rows.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const outstanding = totalSales - totalPaid;
    const profit = ordersRes.rows
      .filter(o => ['CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED'].includes(o.status))
      .reduce((sum, o) => sum + parseFloat(o.gross_profit), 0);

    // Customer Statement line items (chronological ledger)
    const statementItems = [
      ...ordersRes.rows
        .filter(o => ['CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED'].includes(o.status))
        .map(o => ({
          date: o.order_date,
          type: 'INVOICE',
          reference: o.order_number,
          description: `Order ${o.order_number} (${o.category_name || 'General'})`,
          debit: parseFloat(o.total_amount),
          credit: 0,
        })),
      ...paymentsRes.rows.map(p => ({
        date: p.payment_date,
        type: 'PAYMENT',
        reference: p.reference_number || 'Payment Received',
        description: `Payment via ${p.payment_method} ${p.order_number ? `for ${p.order_number}` : ''}`,
        debit: 0,
        credit: parseFloat(p.amount),
      }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate running balance
    let runningBalance = 0;
    const statementWithRunning = statementItems.map(item => {
      runningBalance += (item.debit - item.credit);
      return {
        ...item,
        runningBalance: parseFloat(runningBalance.toFixed(2)),
      };
    });

    return successResponse(res, {
      customer,
      summary: {
        totalOrders: ordersRes.rows.length,
        totalSales,
        totalPaid,
        outstanding,
        profit,
      },
      orders: ordersRes.rows,
      payments: paymentsRes.rows,
      statement: statementWithRunning,
    }, 'Customer details retrieved');
  } catch (err) {
    next(err);
  }
};

export const createCustomer = async (req, res, next) => {
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
      // Generate customer code: CUS-0001, CUS-0002...
      const lastCodeRes = await client.query(`
        SELECT customer_code FROM customers 
        WHERE customer_code LIKE 'CUS-%' 
        ORDER BY customer_code DESC 
        LIMIT 1 FOR UPDATE;
      `);

      let nextNum = 1;
      if (lastCodeRes.rows.length > 0) {
        const lastNumStr = lastCodeRes.rows[0].customer_code.replace('CUS-', '');
        const parsed = parseInt(lastNumStr, 10);
        if (!isNaN(parsed)) {
          nextNum = parsed + 1;
        }
      }
      const customerCode = `CUS-${String(nextNum).padStart(4, '0')}`;

      const insertRes = await client.query(`
        INSERT INTO customers (
          customer_code, company_name, contact_person, email, phone, address, gst_number, notes, status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;
      `, [
        customerCode,
        company_name,
        contact_person || null,
        email || null,
        phone || null,
        address || null,
        gst_number || null,
        notes || null,
        status,
      ]);

      const newCustomer = insertRes.rows[0];

      await logAudit({
        userId: req.user?.id,
        action: 'CUSTOMER_CREATED',
        entityType: 'CUSTOMER',
        entityId: newCustomer.id,
        newValues: { customer_code: customerCode, company_name },
        client,
      });

      return newCustomer;
    });

    return successResponse(res, result, 'Customer created successfully', 201);
  } catch (err) {
    next(err);
  }
};

export const updateCustomer = async (req, res, next) => {
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

    const existingRes = await query('SELECT * FROM customers WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return errorResponse(res, 'Customer not found', 404);
    }
    const existing = existingRes.rows[0];

    const updRes = await query(`
      UPDATE customers SET
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
      action: 'CUSTOMER_UPDATED',
      entityType: 'CUSTOMER',
      entityId: id,
      oldValues: existing,
      newValues: updRes.rows[0],
    });

    return successResponse(res, updRes.rows[0], 'Customer updated successfully');
  } catch (err) {
    next(err);
  }
};
