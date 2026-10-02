import { query } from '../config/db.js';
import { successResponse } from '../utils/response.js';

export const getTransactions = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 20,
      search = '',
      type = '', // 'MONEY_IN' | 'MONEY_OUT'
      sourceType = '',
      paymentMethod = '',
      startDate = '',
      endDate = '',
    } = req.query;

    const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const conditions = [];
    const params = [];

    if (search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      conditions.push(`(
        LOWER(ct.description) LIKE $${params.length} OR 
        LOWER(ct.source_type) LIKE $${params.length} OR 
        LOWER(ct.payment_method) LIKE $${params.length}
      )`);
    }

    if (type) {
      params.push(type);
      conditions.push(`ct.transaction_type = $${params.length}`);
    }

    if (sourceType) {
      params.push(sourceType);
      conditions.push(`ct.source_type = $${params.length}`);
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      conditions.push(`ct.payment_method = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      conditions.push(`ct.transaction_date >= $${params.length}`);
    }

    if (endDate) {
      params.push(endDate);
      conditions.push(`ct.transaction_date <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(ct.id) as total FROM cash_transactions ct ${whereClause};`, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    params.push(parseInt(limit, 10));
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const dataSql = `
      SELECT 
        ct.*,
        CASE 
          WHEN ct.source_type = 'CUSTOMER_PAYMENT' THEN (SELECT o.order_number FROM customer_payments cp JOIN orders o ON cp.order_id = o.id WHERE cp.id = ct.source_id)
          WHEN ct.source_type = 'SUPPLIER_PAYMENT' THEN (SELECT o.order_number FROM supplier_payments sp JOIN orders o ON sp.order_id = o.id WHERE sp.id = ct.source_id)
          WHEN ct.source_type = 'BUSINESS_EXPENSE' THEN (SELECT o.order_number FROM expenses e JOIN orders o ON e.order_id = o.id WHERE e.id = ct.source_id)
          ELSE NULL
        END as related_order_number
      FROM cash_transactions ct
      ${whereClause}
      ORDER BY ct.transaction_date DESC, ct.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;
    const dataRes = await query(dataSql, params);

    // Summary totals for all transactions in ledger
    const summaryRes = await query(`
      SELECT 
        COALESCE(SUM(CASE WHEN transaction_type = 'MONEY_IN' THEN amount ELSE 0 END), 0)::numeric as total_money_in,
        COALESCE(SUM(CASE WHEN transaction_type = 'MONEY_OUT' THEN amount ELSE 0 END), 0)::numeric as total_money_out
      FROM cash_transactions;
    `);

    const totalIn = parseFloat(summaryRes.rows[0].total_money_in || 0);
    const totalOut = parseFloat(summaryRes.rows[0].total_money_out || 0);
    const cashInHand = totalIn - totalOut;

    return successResponse(res, {
      transactions: dataRes.rows,
      summary: {
        totalMoneyIn: totalIn,
        totalMoneyOut: totalOut,
        cashInHand,
      },
      pagination: {
        total: totalRecords,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalRecords / parseInt(limit, 10)),
      },
    }, 'Transactions retrieved');
  } catch (err) {
    next(err);
  }
};
