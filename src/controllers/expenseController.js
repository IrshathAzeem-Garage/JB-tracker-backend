import { query, withTransaction } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const getExpenses = async (req, res, next) => {
  try {
    const {
      page = 1,
      limit = 10,
      search = '',
      category = '',
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
        LOWER(e.description) LIKE $${params.length} OR 
        LOWER(e.expense_number) LIKE $${params.length} OR 
        LOWER(COALESCE(e.receipt_reference, '')) LIKE $${params.length}
      )`);
    }

    if (category) {
      params.push(category);
      conditions.push(`e.category = $${params.length}`);
    }

    if (paymentMethod) {
      params.push(paymentMethod);
      conditions.push(`e.payment_method = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      conditions.push(`e.expense_date >= $${params.length}`);
    }

    if (endDate) {
      params.push(endDate);
      conditions.push(`e.expense_date <= $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(`SELECT COUNT(e.id) as total FROM expenses e ${whereClause};`, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    params.push(parseInt(limit, 10));
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const dataSql = `
      SELECT 
        e.*,
        s.company_name as supplier_name,
        o.order_number,
        u.name as created_by_name
      FROM expenses e
      LEFT JOIN suppliers s ON e.supplier_id = s.id
      LEFT JOIN orders o ON e.order_id = o.id
      LEFT JOIN users u ON e.created_by = u.id
      ${whereClause}
      ORDER BY e.expense_date DESC, e.created_at DESC
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;
    const dataRes = await query(dataSql, params);

    // Summary statistics for expenses header
    const statsRes = await query(`
      SELECT 
        COALESCE(SUM(CASE WHEN date_trunc('month', expense_date) = date_trunc('month', CURRENT_DATE) THEN amount ELSE 0 END), 0)::numeric as month_expenses,
        COALESCE(SUM(CASE WHEN date_trunc('year', expense_date) = date_trunc('year', CURRENT_DATE) THEN amount ELSE 0 END), 0)::numeric as year_expenses,
        COALESCE(SUM(amount), 0)::numeric as total_expenses
      FROM expenses;
    `);

    const topCategoriesRes = await query(`
      SELECT 
        category,
        COALESCE(SUM(amount), 0)::numeric as total_amount
      FROM expenses
      GROUP BY category
      ORDER BY total_amount DESC
      LIMIT 5;
    `);

    return successResponse(res, {
      expenses: dataRes.rows,
      summary: {
        thisMonth: parseFloat(statsRes.rows[0].month_expenses),
        thisYear: parseFloat(statsRes.rows[0].year_expenses),
        total: parseFloat(statsRes.rows[0].total_expenses),
        topCategories: topCategoriesRes.rows,
      },
      pagination: {
        total: totalRecords,
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        totalPages: Math.ceil(totalRecords / parseInt(limit, 10)),
      },
    }, 'Expenses retrieved');
  } catch (err) {
    next(err);
  }
};

export const createExpense = async (req, res, next) => {
  try {
    const {
      category,
      description,
      amount,
      expense_date,
      payment_method = 'BANK_TRANSFER',
      supplier_id,
      order_id,
      receipt_reference,
      notes,
    } = req.body;

    const result = await withTransaction(async (client) => {
      // 1. Generate Expense Number: EXP-000001
      const lastExpRes = await client.query(`
        SELECT expense_number FROM expenses 
        WHERE expense_number LIKE 'EXP-%' 
        ORDER BY expense_number DESC 
        LIMIT 1 FOR UPDATE;
      `);

      let nextNum = 1;
      if (lastExpRes.rows.length > 0) {
        const lastNumStr = lastExpRes.rows[0].expense_number.replace('EXP-', '');
        const parsed = parseInt(lastNumStr, 10);
        if (!isNaN(parsed)) {
          nextNum = parsed + 1;
        }
      }
      const expenseNumber = `EXP-${String(nextNum).padStart(6, '0')}`;

      // 2. Insert into expenses
      const expRes = await client.query(`
        INSERT INTO expenses (
          expense_number, category, description, amount, expense_date, payment_method,
          supplier_id, order_id, receipt_reference, notes, created_by
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *;
      `, [
        expenseNumber,
        category,
        description,
        amount,
        expense_date || new Date(),
        payment_method,
        supplier_id || null,
        order_id || null,
        receipt_reference || null,
        notes || null,
        req.user?.id || null
      ]);
      const createdExpense = expRes.rows[0];

      // 3. Central cash ledger transaction (MONEY_OUT)
      await client.query(`
        INSERT INTO cash_transactions (
          transaction_type, source_type, source_id, amount, transaction_date, payment_method, description
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7);
      `, [
        'MONEY_OUT',
        'BUSINESS_EXPENSE',
        createdExpense.id,
        amount,
        expense_date || new Date(),
        payment_method,
        `Expense ${expenseNumber} (${category}): ${description}`
      ]);

      // 4. Audit Log
      await logAudit({
        userId: req.user?.id,
        action: 'EXPENSE_RECORDED',
        entityType: 'EXPENSE',
        entityId: createdExpense.id,
        newValues: { expense_number: expenseNumber, category, amount },
        client,
      });

      return createdExpense;
    });

    return successResponse(res, result, 'Expense recorded successfully and cash ledger updated', 201);
  } catch (err) {
    next(err);
  }
};

export const updateExpense = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      category,
      description,
      amount,
      expense_date,
      payment_method,
      supplier_id,
      order_id,
      receipt_reference,
      notes,
    } = req.body;

    const existingRes = await query('SELECT * FROM expenses WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return errorResponse(res, 'Expense not found', 404);
    }
    const existing = existingRes.rows[0];

    const updated = await withTransaction(async (client) => {
      const updRes = await client.query(`
        UPDATE expenses SET
          category = COALESCE($1, category),
          description = COALESCE($2, description),
          amount = COALESCE($3, amount),
          expense_date = COALESCE($4, expense_date),
          payment_method = COALESCE($5, payment_method),
          supplier_id = COALESCE($6, supplier_id),
          order_id = COALESCE($7, order_id),
          receipt_reference = COALESCE($8, receipt_reference),
          notes = COALESCE($9, notes),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $10
        RETURNING *;
      `, [
        category !== undefined ? category : null,
        description !== undefined ? description : null,
        amount !== undefined ? amount : null,
        expense_date !== undefined ? expense_date : null,
        payment_method !== undefined ? payment_method : null,
        supplier_id !== undefined ? supplier_id : null,
        order_id !== undefined ? order_id : null,
        receipt_reference !== undefined ? receipt_reference : null,
        notes !== undefined ? notes : null,
        id
      ]);

      const updatedExpense = updRes.rows[0];

      // Update cash transaction
      if (amount !== undefined || expense_date !== undefined || payment_method !== undefined || description !== undefined) {
        await client.query(`
          UPDATE cash_transactions SET
            amount = COALESCE($1, amount),
            transaction_date = COALESCE($2, transaction_date),
            payment_method = COALESCE($3, payment_method),
            description = $4
          WHERE source_type = 'BUSINESS_EXPENSE' AND source_id = $5;
        `, [
          amount !== undefined ? amount : null,
          expense_date !== undefined ? expense_date : null,
          payment_method !== undefined ? payment_method : null,
          `Expense ${updatedExpense.expense_number} (${updatedExpense.category}): ${updatedExpense.description}`,
          id
        ]);
      }

      await logAudit({
        userId: req.user?.id,
        action: 'EXPENSE_UPDATED',
        entityType: 'EXPENSE',
        entityId: id,
        oldValues: existing,
        newValues: updatedExpense,
        client,
      });

      return updatedExpense;
    });

    return successResponse(res, updated, 'Expense updated successfully');
  } catch (err) {
    next(err);
  }
};

export const deleteExpense = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existingRes = await query('SELECT * FROM expenses WHERE id = $1', [id]);
    if (existingRes.rows.length === 0) {
      return errorResponse(res, 'Expense not found', 404);
    }
    const existing = existingRes.rows[0];

    await withTransaction(async (client) => {
      // Delete cash transaction
      await client.query(`
        DELETE FROM cash_transactions 
        WHERE source_type = 'BUSINESS_EXPENSE' AND source_id = $1;
      `, [id]);

      // Delete expense
      await client.query('DELETE FROM expenses WHERE id = $1;', [id]);

      await logAudit({
        userId: req.user?.id,
        action: 'EXPENSE_DELETED',
        entityType: 'EXPENSE',
        entityId: id,
        oldValues: existing,
        client,
      });
    });

    return successResponse(res, {}, 'Expense and corresponding ledger entry deleted successfully');
  } catch (err) {
    next(err);
  }
};
