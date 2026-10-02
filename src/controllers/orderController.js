import { query, withTransaction } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const getOrders = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      categoryId = '',
      customerId = '',
      startDate = '',
      endDate = '',
      sortBy = 'order_date',
      sortOrder = 'DESC',
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`(
        LOWER(o.order_number) LIKE $${params.length} OR 
        LOWER(c.company_name) LIKE $${params.length} OR 
        LOWER(COALESCE(c.contact_person, '')) LIKE $${params.length}
      )`);
    }

    if (status) {
      params.push(status);
      conditions.push(`o.status = $${params.length}`);
    }

    if (categoryId) {
      params.push(categoryId);
      conditions.push(`o.category_id = $${params.length}`);
    }

    if (customerId) {
      params.push(customerId);
      conditions.push(`o.customer_id = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      conditions.push(`o.order_date >= $${params.length}`);
    }

    if (endDate) {
      params.push(endDate);
      conditions.push(`o.order_date <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const allowedSortFields = ['order_date', 'order_number', 'total_amount', 'gross_profit', 'created_at'];
    const safeSortBy = allowedSortFields.includes(sortBy) ? `o.${sortBy}` : 'o.order_date';
    const safeSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Count query
    const countSql = `
      SELECT COUNT(o.id) as total
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN categories cat ON o.category_id = cat.id
      ${whereClause};
    `;
    const countRes = await query(countSql, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    // Data query with payments aggregate
    params.push(parseInt(limit, 10));
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const dataSql = `
      SELECT 
        o.id,
        o.order_number,
        o.order_date,
        o.expected_delivery_date,
        o.status,
        o.subtotal,
        o.discount,
        o.tax,
        o.total_amount,
        o.total_cost,
        o.gross_profit,
        CASE 
          WHEN o.total_amount > 0 THEN ROUND((o.gross_profit / o.total_amount) * 100, 2)
          ELSE 0
        END as margin_percentage,
        o.notes,
        o.created_at,
        c.id as customer_id,
        c.customer_code,
        c.company_name as customer_name,
        c.contact_person as customer_contact,
        cat.id as category_id,
        cat.name as category_name,
        COALESCE(p.paid_amount, 0)::numeric as paid_amount,
        (o.total_amount - COALESCE(p.paid_amount, 0))::numeric as balance_amount
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN categories cat ON o.category_id = cat.id
      LEFT JOIN (
        SELECT order_id, SUM(amount) as paid_amount
        FROM customer_payments
        GROUP BY order_id
      ) p ON o.id = p.order_id
      ${whereClause}
      ORDER BY ${safeSortBy} ${safeSortOrder}
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const dataRes = await query(dataSql, params);

    return successResponse(res, {
      orders: dataRes.rows,
      pagination: {
        total: totalRecords,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalRecords / parseInt(limit, 10)),
      },
    }, 'Orders list retrieved');
  } catch (err) {
    next(err);
  }
};

export const getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const orderRes = await query(`
      SELECT 
        o.*,
        c.customer_code,
        c.company_name as customer_name,
        c.contact_person as customer_contact,
        c.email as customer_email,
        c.phone as customer_phone,
        c.address as customer_address,
        c.gst_number as customer_gst,
        cat.name as category_name,
        u.name as created_by_name
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN categories cat ON o.category_id = cat.id
      LEFT JOIN users u ON o.created_by = u.id
      WHERE o.id = $1;
    `, [id]);

    if (orderRes.rows.length === 0) {
      return errorResponse(res, 'Order not found', 404);
    }

    const order = orderRes.rows[0];

    // Order items
    const itemsRes = await query(`
      SELECT 
        oi.*,
        p.name as product_name,
        p.sku as product_sku,
        p.unit as product_unit,
        s.company_name as supplier_name,
        s.supplier_code
      FROM order_items oi
      LEFT JOIN products p ON oi.product_id = p.id
      LEFT JOIN suppliers s ON oi.supplier_id = s.id
      WHERE oi.order_id = $1
      ORDER BY oi.created_at ASC;
    `, [id]);

    // Customer payments
    const paymentsRes = await query(`
      SELECT 
        cp.*,
        u.name as created_by_name
      FROM customer_payments cp
      LEFT JOIN users u ON cp.created_by = u.id
      WHERE cp.order_id = $1
      ORDER BY cp.payment_date ASC, cp.created_at ASC;
    `, [id]);

    // Supplier payments
    const supplierPaymentsRes = await query(`
      SELECT 
        sp.*,
        s.company_name as supplier_name,
        s.supplier_code,
        u.name as created_by_name
      FROM supplier_payments sp
      JOIN suppliers s ON sp.supplier_id = s.id
      LEFT JOIN users u ON sp.created_by = u.id
      WHERE sp.order_id = $1
      ORDER BY sp.payment_date ASC, sp.created_at ASC;
    `, [id]);

    const totalPaid = paymentsRes.rows.reduce((sum, p) => sum + parseFloat(p.amount), 0);
    const balance = parseFloat(order.total_amount) - totalPaid;
    const marginPct = parseFloat(order.total_amount) > 0 
      ? ((parseFloat(order.gross_profit) / parseFloat(order.total_amount)) * 100).toFixed(2)
      : 0;

    return successResponse(res, {
      ...order,
      items: itemsRes.rows,
      customerPayments: paymentsRes.rows,
      supplierPayments: supplierPaymentsRes.rows,
      financialSummary: {
        orderValue: parseFloat(order.total_amount),
        totalCost: parseFloat(order.total_cost),
        grossProfit: parseFloat(order.gross_profit),
        profitMargin: parseFloat(marginPct),
        amountPaid: totalPaid,
        balance: balance,
      }
    }, 'Order details retrieved');
  } catch (err) {
    next(err);
  }
};

export const createOrder = async (req, res, next) => {
  try {
    const {
      customer_id,
      category_id,
      order_date,
      expected_delivery_date,
      status = 'CONFIRMED',
      discount = 0,
      tax = 0,
      notes,
      items,
    } = req.body;

    const result = await withTransaction(async (client) => {
      // 1. Generate Order Number atomically
      const lastOrderRes = await client.query(`
        SELECT order_number FROM orders 
        WHERE order_number LIKE 'JB-%' 
        ORDER BY order_number DESC 
        LIMIT 1 FOR UPDATE;
      `);

      let nextNum = 1;
      if (lastOrderRes.rows.length > 0) {
        const lastNumStr = lastOrderRes.rows[0].order_number.replace('JB-', '');
        const parsed = parseInt(lastNumStr, 10);
        if (!isNaN(parsed)) {
          nextNum = parsed + 1;
        }
      }
      const orderNumber = `JB-${String(nextNum).padStart(6, '0')}`;

      // 2. Compute item totals & order totals
      let calculatedSubtotal = 0;
      let calculatedTotalCost = 0;

      const processedItems = items.map(item => {
        const qty = parseFloat(item.quantity);
        const sellPrice = parseFloat(item.unit_selling_price);
        const costPrice = parseFloat(item.unit_cost_price || 0);
        const itemDisc = parseFloat(item.discount || 0);
        const itemTax = parseFloat(item.tax || 0);

        const totalSelling = (qty * sellPrice) - itemDisc + itemTax;
        const totalCost = qty * costPrice;
        const profit = totalSelling - totalCost;

        calculatedSubtotal += totalSelling;
        calculatedTotalCost += totalCost;

        return {
          ...item,
          quantity: qty,
          unit_selling_price: sellPrice,
          unit_cost_price: costPrice,
          discount: itemDisc,
          tax: itemTax,
          total_selling_amount: totalSelling,
          total_cost_amount: totalCost,
          profit,
        };
      });

      const orderDiscount = parseFloat(discount || 0);
      const orderTax = parseFloat(tax || 0);
      const totalAmount = calculatedSubtotal - orderDiscount + orderTax;
      const grossProfit = totalAmount - calculatedTotalCost;

      // 3. Insert order
      const orderRes = await client.query(`
        INSERT INTO orders (
          order_number, customer_id, category_id, order_date, expected_delivery_date,
          status, subtotal, discount, tax, total_amount, total_cost, gross_profit,
          notes, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        RETURNING *;
      `, [
        orderNumber, customer_id, category_id || null, order_date, expected_delivery_date || null,
        status, calculatedSubtotal, orderDiscount, orderTax, totalAmount, calculatedTotalCost,
        grossProfit, notes || null, req.user?.id || null
      ]);

      const createdOrder = orderRes.rows[0];

      // 4. Insert items
      for (const item of processedItems) {
        await client.query(`
          INSERT INTO order_items (
            order_id, product_id, description, quantity, unit_selling_price, unit_cost_price,
            discount, tax, total_selling_amount, total_cost_amount, profit, supplier_id, notes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13);
        `, [
          createdOrder.id, item.product_id || null, item.description, item.quantity,
          item.unit_selling_price, item.unit_cost_price, item.discount, item.tax,
          item.total_selling_amount, item.total_cost_amount, item.profit, item.supplier_id || null,
          item.notes || null
        ]);
      }

      // 5. Audit Log
      await logAudit({
        userId: req.user?.id,
        action: 'ORDER_CREATED',
        entityType: 'ORDER',
        entityId: createdOrder.id,
        newValues: { order_number: orderNumber, total_amount: totalAmount, total_cost: calculatedTotalCost },
        client,
      });

      return createdOrder;
    });

    return successResponse(res, result, 'Order created successfully', 201);
  } catch (err) {
    next(err);
  }
};

export const updateOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, category_id, expected_delivery_date, notes, discount, tax } = req.body;

    const existingRes = await query('SELECT * FROM orders WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return errorResponse(res, 'Order not found', 404);
    }
    const existing = existingRes.rows[0];

    const updated = await withTransaction(async (client) => {
      let totalAmount = parseFloat(existing.total_amount);
      let grossProfit = parseFloat(existing.gross_profit);

      if (discount !== undefined || tax !== undefined) {
        const d = discount !== undefined ? parseFloat(discount) : parseFloat(existing.discount);
        const t = tax !== undefined ? parseFloat(tax) : parseFloat(existing.tax);
        totalAmount = parseFloat(existing.subtotal) - d + t;
        grossProfit = totalAmount - parseFloat(existing.total_cost);
      }

      const updRes = await client.query(`
        UPDATE orders SET
          status = COALESCE($1, status),
          category_id = COALESCE($2, category_id),
          expected_delivery_date = COALESCE($3, expected_delivery_date),
          notes = COALESCE($4, notes),
          discount = COALESCE($5, discount),
          tax = COALESCE($6, tax),
          total_amount = $7,
          gross_profit = $8,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $9
        RETURNING *;
      `, [
        status || null,
        category_id !== undefined ? category_id : null,
        expected_delivery_date !== undefined ? expected_delivery_date : null,
        notes !== undefined ? notes : null,
        discount !== undefined ? discount : null,
        tax !== undefined ? tax : null,
        totalAmount,
        grossProfit,
        id
      ]);

      await logAudit({
        userId: req.user?.id,
        action: 'ORDER_UPDATED',
        entityType: 'ORDER',
        entityId: id,
        oldValues: { status: existing.status, total_amount: existing.total_amount },
        newValues: { status: updRes.rows[0].status, total_amount: updRes.rows[0].total_amount },
        client,
      });

      return updRes.rows[0];
    });

    return successResponse(res, updated, 'Order updated successfully');
  } catch (err) {
    next(err);
  }
};

export const recordCustomerPayment = async (req, res, next) => {
  try {
    const { id } = req.params; // order_id
    const { customer_id, amount, payment_date, payment_method, reference_number, notes } = req.body;

    const ordRes = await query('SELECT order_number, total_amount, customer_id FROM orders WHERE id = $1', [id]);
    if (ordRes.rows.length === 0) {
      return errorResponse(res, 'Order not found', 404);
    }
    const order = ordRes.rows[0];

    const result = await withTransaction(async (client) => {
      // 1. Insert customer payment
      const payRes = await client.query(`
        INSERT INTO customer_payments (
          customer_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
      `, [
        customer_id || order.customer_id,
        id,
        amount,
        payment_date || new Date(),
        payment_method,
        reference_number || null,
        notes || null,
        req.user?.id || null
      ]);
      const payment = payRes.rows[0];

      // 2. Insert into cash_transactions (MONEY_IN)
      await client.query(`
        INSERT INTO cash_transactions (
          transaction_type, source_type, source_id, amount, transaction_date, payment_method, description
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7);
      `, [
        'MONEY_IN',
        'CUSTOMER_PAYMENT',
        payment.id,
        amount,
        payment_date || new Date(),
        payment_method,
        `Customer payment for ${order.order_number}${reference_number ? ` (Ref: ${reference_number})` : ''}`
      ]);

      // 3. Audit log
      await logAudit({
        userId: req.user?.id,
        action: 'CUSTOMER_PAYMENT_RECORDED',
        entityType: 'CUSTOMER_PAYMENT',
        entityId: payment.id,
        newValues: { order_id: id, amount, payment_method },
        client,
      });

      return payment;
    });

    return successResponse(res, result, 'Customer payment recorded and cash ledger updated', 201);
  } catch (err) {
    next(err);
  }
};

export const recordSupplierPayment = async (req, res, next) => {
  try {
    const { id } = req.params; // order_id
    const { supplier_id, amount, payment_date, payment_method, reference_number, notes } = req.body;

    const ordRes = await query('SELECT order_number FROM orders WHERE id = $1', [id]);
    if (ordRes.rows.length === 0) {
      return errorResponse(res, 'Order not found', 404);
    }
    const order = ordRes.rows[0];

    const result = await withTransaction(async (client) => {
      // 1. Insert supplier payment
      const spayRes = await client.query(`
        INSERT INTO supplier_payments (
          supplier_id, order_id, amount, payment_date, payment_method, reference_number, notes, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *;
      `, [
        supplier_id,
        id,
        amount,
        payment_date || new Date(),
        payment_method,
        reference_number || null,
        notes || null,
        req.user?.id || null
      ]);
      const payment = spayRes.rows[0];

      // 2. Insert into cash_transactions (MONEY_OUT)
      await client.query(`
        INSERT INTO cash_transactions (
          transaction_type, source_type, source_id, amount, transaction_date, payment_method, description
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7);
      `, [
        'MONEY_OUT',
        'SUPPLIER_PAYMENT',
        payment.id,
        amount,
        payment_date || new Date(),
        payment_method,
        `Supplier payment for ${order.order_number}${reference_number ? ` (Ref: ${reference_number})` : ''}`
      ]);

      // 3. Audit log
      await logAudit({
        userId: req.user?.id,
        action: 'SUPPLIER_PAYMENT_RECORDED',
        entityType: 'SUPPLIER_PAYMENT',
        entityId: payment.id,
        newValues: { order_id: id, supplier_id, amount, payment_method },
        client,
      });

      return payment;
    });

    return successResponse(res, result, 'Supplier payment recorded and cash ledger updated', 201);
  } catch (err) {
    next(err);
  }
};
