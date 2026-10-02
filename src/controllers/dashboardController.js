import { query } from '../config/db.js';
import { getFinancialMetrics } from '../services/financeService.js';
import { successResponse } from '../utils/response.js';

export const getDashboardData = async (req, res, next) => {
  try {
    const metrics = await getFinancialMetrics();

    // 1. Monthly Sales & Profit (Last 6-12 months)
    const monthlyTrendsRes = await query(`
      WITH months AS (
        SELECT to_char(d, 'Mon YYYY') as month_label,
               date_trunc('month', d) as month_start
        FROM generate_series(
          date_trunc('month', CURRENT_DATE) - interval '5 months',
          date_trunc('month', CURRENT_DATE),
          '1 month'
        ) d
      ),
      m_sales AS (
        SELECT 
          date_trunc('month', order_date) as month_start,
          COALESCE(SUM(total_amount), 0)::numeric as sales,
          COALESCE(SUM(gross_profit), 0)::numeric as gross_profit
        FROM orders
        WHERE status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')
        GROUP BY date_trunc('month', order_date)
      ),
      m_expenses AS (
        SELECT 
          date_trunc('month', expense_date) as month_start,
          COALESCE(SUM(amount), 0)::numeric as expenses
        FROM expenses
        GROUP BY date_trunc('month', expense_date)
      )
      SELECT 
        m.month_label,
        COALESCE(s.sales, 0)::numeric as sales,
        COALESCE(s.gross_profit, 0)::numeric as gross_profit,
        COALESCE(e.expenses, 0)::numeric as expenses,
        (COALESCE(s.gross_profit, 0) - COALESCE(e.expenses, 0))::numeric as net_profit
      FROM months m
      LEFT JOIN m_sales s ON m.month_start = s.month_start
      LEFT JOIN m_expenses e ON m.month_start = e.month_start
      ORDER BY m.month_start ASC;
    `);

    // 2. Expenses by Category
    const expCatRes = await query(`
      SELECT 
        category,
        COALESCE(SUM(amount), 0)::numeric as amount,
        ROUND((SUM(amount) * 100.0 / NULLIF((SELECT SUM(amount) FROM expenses), 0)), 1)::numeric as percentage
      FROM expenses
      GROUP BY category
      ORDER BY amount DESC;
    `);

    // 3. Sales by Business Category
    const catSalesRes = await query(`
      SELECT 
        c.name as category_name,
        COALESCE(SUM(o.total_amount), 0)::numeric as sales,
        COALESCE(SUM(o.gross_profit), 0)::numeric as profit,
        COUNT(o.id)::int as orders_count
      FROM categories c
      LEFT JOIN orders o ON c.id = o.category_id AND o.status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')
      GROUP BY c.id, c.name
      HAVING COALESCE(SUM(o.total_amount), 0) > 0 OR COUNT(o.id) > 0
      ORDER BY sales DESC;
    `);

    // 4. Cash Flow (Monthly Money In vs Money Out)
    const cashFlowRes = await query(`
      WITH months AS (
        SELECT to_char(d, 'Mon YYYY') as month_label,
               date_trunc('month', d) as month_start
        FROM generate_series(
          date_trunc('month', CURRENT_DATE) - interval '5 months',
          date_trunc('month', CURRENT_DATE),
          '1 month'
        ) d
      )
      SELECT 
        m.month_label,
        COALESCE(SUM(CASE WHEN ct.transaction_type = 'MONEY_IN' THEN ct.amount ELSE 0 END), 0)::numeric as money_in,
        COALESCE(SUM(CASE WHEN ct.transaction_type = 'MONEY_OUT' THEN ct.amount ELSE 0 END), 0)::numeric as money_out
      FROM months m
      LEFT JOIN cash_transactions ct ON date_trunc('month', ct.transaction_date) = m.month_start
      GROUP BY m.month_label, m.month_start
      ORDER BY m.month_start ASC;
    `);

    // 5. Order Status Distribution
    const statusRes = await query(`
      SELECT 
        status,
        COUNT(id)::int as count,
        COALESCE(SUM(total_amount), 0)::numeric as total_amount
      FROM orders
      GROUP BY status;
    `);

    // 6. Real-Time Alerts
    // Overdue/Pending receivables
    const overdueCustRes = await query(`
      SELECT 
        o.id,
        o.order_number,
        c.company_name as customer_name,
        o.total_amount,
        COALESCE(p.paid, 0)::numeric as paid,
        (o.total_amount - COALESCE(p.paid, 0))::numeric as outstanding,
        o.expected_delivery_date
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN (
        SELECT order_id, SUM(amount) as paid FROM customer_payments GROUP BY order_id
      ) p ON o.id = p.order_id
      WHERE o.status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')
        AND (o.total_amount - COALESCE(p.paid, 0)) > 0
      ORDER BY (o.total_amount - COALESCE(p.paid, 0)) DESC
      LIMIT 5;
    `);

    // Pending supplier payments
    const pendingSuppRes = await query(`
      WITH item_supp AS (
        SELECT 
          oi.order_id,
          oi.supplier_id,
          s.company_name as supplier_name,
          o.order_number,
          SUM(oi.total_cost_amount) as total_committed
        FROM order_items oi
        JOIN suppliers s ON oi.supplier_id = s.id
        JOIN orders o ON oi.order_id = o.id
        WHERE o.status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')
        GROUP BY oi.order_id, oi.supplier_id, s.company_name, o.order_number
      ),
      spays AS (
        SELECT order_id, supplier_id, SUM(amount) as paid
        FROM supplier_payments
        GROUP BY order_id, supplier_id
      )
      SELECT 
        isup.order_id,
        isup.order_number,
        isup.supplier_name,
        isup.total_committed,
        COALESCE(sp.paid, 0)::numeric as paid,
        (isup.total_committed - COALESCE(sp.paid, 0))::numeric as outstanding
      FROM item_supp isup
      LEFT JOIN spays sp ON isup.order_id = sp.order_id AND isup.supplier_id = sp.supplier_id
      WHERE (isup.total_committed - COALESCE(sp.paid, 0)) > 0
      LIMIT 5;
    `);

    // Delivery due soon (Next 10 days)
    const upcomingDeliveriesRes = await query(`
      SELECT 
        o.id,
        o.order_number,
        c.company_name as customer_name,
        o.expected_delivery_date,
        o.status,
        o.total_amount
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.status NOT IN ('DELIVERED', 'CANCELLED', 'DRAFT')
        AND o.expected_delivery_date IS NOT NULL
        AND o.expected_delivery_date >= CURRENT_DATE
        AND o.expected_delivery_date <= CURRENT_DATE + interval '10 days'
      ORDER BY o.expected_delivery_date ASC
      LIMIT 5;
    `);

    // Negative margin or low margin (< 10%) orders
    const marginAlertsRes = await query(`
      SELECT 
        o.id,
        o.order_number,
        c.company_name as customer_name,
        o.total_amount,
        o.total_cost,
        o.gross_profit,
        CASE 
          WHEN o.total_amount > 0 THEN ROUND((o.gross_profit / o.total_amount) * 100, 2)
          ELSE 0
        END as margin_percentage,
        CASE 
          WHEN o.gross_profit < 0 THEN 'LOSS_MAKING'
          WHEN (o.gross_profit / NULLIF(o.total_amount, 0)) * 100 < 10 THEN 'LOW_MARGIN'
          ELSE 'NORMAL'
        END as alert_type
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.status NOT IN ('CANCELLED')
        AND (o.gross_profit < 0 OR (o.total_amount > 0 AND (o.gross_profit / o.total_amount) * 100 < 10))
      ORDER BY o.gross_profit ASC;
    `);

    // 7. Recent Cash & Business Activity (from cash transactions ledger)
    const recentActivityRes = await query(`
      SELECT 
        id,
        transaction_type,
        source_type,
        amount,
        transaction_date,
        payment_method,
        description,
        created_at
      FROM cash_transactions
      ORDER BY transaction_date DESC, created_at DESC
      LIMIT 8;
    `);

    // 8. Recent Orders
    const recentOrdersRes = await query(`
      SELECT 
        o.id,
        o.order_number,
        c.company_name as customer_name,
        o.total_amount,
        o.gross_profit,
        o.status,
        o.order_date
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      ORDER BY o.created_at DESC
      LIMIT 6;
    `);

    return successResponse(res, {
      metrics,
      charts: {
        monthlyTrends: monthlyTrendsRes.rows,
        expensesByCategory: expCatRes.rows,
        salesByCategory: catSalesRes.rows,
        cashFlow: cashFlowRes.rows,
        orderStatuses: statusRes.rows,
      },
      alerts: {
        overdueCustomers: overdueCustRes.rows,
        pendingSuppliers: pendingSuppRes.rows,
        upcomingDeliveries: upcomingDeliveriesRes.rows,
        marginAlerts: marginAlertsRes.rows,
      },
      recentOrders: recentOrdersRes.rows,
      recentActivity: {
        transactions: recentActivityRes.rows,
        orders: recentOrdersRes.rows,
      },
    }, 'Dashboard data retrieved successfully');
  } catch (err) {
    next(err);
  }
};
