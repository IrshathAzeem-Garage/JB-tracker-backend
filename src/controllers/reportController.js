import { query } from '../config/db.js';
import { getFinancialMetrics } from '../services/financeService.js';
import { successResponse } from '../utils/response.js';

// Helper for date filter conditions
const getDateRangeClause = (dateField, startDate, endDate, params) => {
  const conditions = [];
  if (startDate) {
    params.push(startDate);
    conditions.push(`${dateField} >= $${params.length}`);
  }
  if (endDate) {
    params.push(endDate);
    conditions.push(`${dateField} <= $${params.length}`);
  }
  return conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
};

export const getProfitLoss = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    const salesParams = [];
    const salesDateClause = getDateRangeClause('order_date', startDate, endDate, salesParams);
    
    // Revenue & Direct Costs
    const salesRes = await query(`
      SELECT 
        COALESCE(SUM(total_amount), 0)::numeric as revenue,
        COALESCE(SUM(total_cost), 0)::numeric as direct_costs,
        COALESCE(SUM(gross_profit), 0)::numeric as gross_profit,
        COUNT(id)::int as total_orders
      FROM orders
      WHERE status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')
      ${salesDateClause};
    `, salesParams);

    const revenue = parseFloat(salesRes.rows[0].revenue);
    const directCosts = parseFloat(salesRes.rows[0].direct_costs);
    const grossProfit = parseFloat(salesRes.rows[0].gross_profit);
    const grossMarginPct = revenue > 0 ? ((grossProfit / revenue) * 100).toFixed(2) : 0;

    // Expenses breakdown
    const expParams = [];
    const expDateClause = getDateRangeClause('expense_date', startDate, endDate, expParams);
    
    const expRes = await query(`
      SELECT 
        category,
        COALESCE(SUM(amount), 0)::numeric as amount
      FROM expenses
      WHERE 1=1 ${expDateClause}
      GROUP BY category
      ORDER BY amount DESC;
    `, expParams);

    const totalOperatingExpenses = expRes.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);
    const netProfit = grossProfit - totalOperatingExpenses;
    const netMarginPct = revenue > 0 ? ((netProfit / revenue) * 100).toFixed(2) : 0;

    return successResponse(res, {
      period: { startDate: startDate || 'All Time', endDate: endDate || 'Current' },
      revenue,
      directCosts,
      grossProfit,
      grossMarginPercentage: parseFloat(grossMarginPct),
      operatingExpenses: {
        total: totalOperatingExpenses,
        breakdown: expRes.rows.map(r => ({ category: r.category, amount: parseFloat(r.amount) })),
      },
      netProfit,
      netMarginPercentage: parseFloat(netMarginPct),
      ordersCount: parseInt(salesRes.rows[0].total_orders, 10),
    }, 'Profit & Loss report retrieved');
  } catch (err) {
    next(err);
  }
};

export const getCashFlow = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    // 1. Opening Cash (All transactions prior to startDate)
    let openingCash = 0;
    if (startDate) {
      const openRes = await query(`
        SELECT 
          COALESCE(SUM(CASE WHEN transaction_type = 'MONEY_IN' THEN amount ELSE -amount END), 0)::numeric as opening_balance
        FROM cash_transactions
        WHERE transaction_date < $1;
      `, [startDate]);
      openingCash = parseFloat(openRes.rows[0].opening_balance || 0);
    }

    // 2. Inflows and Outflows within period
    const params = [];
    const dateClause = getDateRangeClause('transaction_date', startDate, endDate, params);

    const flowRes = await query(`
      SELECT 
        source_type,
        transaction_type,
        COALESCE(SUM(amount), 0)::numeric as total_amount
      FROM cash_transactions
      WHERE 1=1 ${dateClause}
      GROUP BY source_type, transaction_type;
    `, params);

    let totalInflow = 0;
    let totalOutflow = 0;
    const inflows = {};
    const outflows = {};

    flowRes.rows.forEach(r => {
      const amt = parseFloat(r.total_amount);
      if (r.transaction_type === 'MONEY_IN') {
        totalInflow += amt;
        inflows[r.source_type] = amt;
      } else {
        totalOutflow += amt;
        outflows[r.source_type] = amt;
      }
    });

    const netCashFlow = totalInflow - totalOutflow;
    const closingCash = openingCash + netCashFlow;

    return successResponse(res, {
      period: { startDate: startDate || 'All Time', endDate: endDate || 'Current' },
      openingCash,
      inflows: {
        customerPayments: inflows['CUSTOMER_PAYMENT'] || 0,
        partnerInvestments: inflows['PARTNER_INVESTMENT'] || 0,
        otherIncome: inflows['OTHER_INCOME'] || 0,
        total: totalInflow,
      },
      outflows: {
        supplierPayments: outflows['SUPPLIER_PAYMENT'] || 0,
        operatingExpenses: outflows['BUSINESS_EXPENSE'] || 0,
        partnerWithdrawals: outflows['PARTNER_WITHDRAWAL'] || 0,
        otherExpenses: outflows['OTHER_EXPENSE'] || 0,
        total: totalOutflow,
      },
      netCashFlow,
      closingCash,
    }, 'Cash Flow report retrieved');
  } catch (err) {
    next(err);
  }
};

export const getSalesReport = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const params = [];
    const dateClause = getDateRangeClause('order_date', startDate, endDate, params);

    const overallRes = await query(`
      SELECT 
        COUNT(id)::int as total_orders,
        COALESCE(SUM(total_amount), 0)::numeric as total_sales,
        COALESCE(AVG(total_amount), 0)::numeric as average_order_value,
        COALESCE(SUM(gross_profit), 0)::numeric as total_profit
      FROM orders
      WHERE status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')
      ${dateClause};
    `, params);

    const byStatusRes = await query(`
      SELECT 
        status,
        COUNT(id)::int as count,
        COALESCE(SUM(total_amount), 0)::numeric as amount
      FROM orders
      WHERE 1=1 ${dateClause}
      GROUP BY status;
    `, params);

    return successResponse(res, {
      summary: {
        totalOrders: parseInt(overallRes.rows[0].total_orders, 10),
        totalSales: parseFloat(overallRes.rows[0].total_sales),
        averageOrderValue: parseFloat(overallRes.rows[0].average_order_value),
        totalProfit: parseFloat(overallRes.rows[0].total_profit),
      },
      byStatus: byStatusRes.rows,
    }, 'Sales report retrieved');
  } catch (err) {
    next(err);
  }
};

export const getCategoryReport = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const params = [];
    const dateClause = getDateRangeClause('o.order_date', startDate, endDate, params);

    const resData = await query(`
      SELECT 
        c.name as category_name,
        COUNT(o.id)::int as total_orders,
        COALESCE(SUM(o.total_amount), 0)::numeric as total_sales,
        COALESCE(SUM(o.total_cost), 0)::numeric as total_cost,
        COALESCE(SUM(o.gross_profit), 0)::numeric as gross_profit,
        CASE 
          WHEN SUM(o.total_amount) > 0 THEN ROUND((SUM(o.gross_profit) / SUM(o.total_amount)) * 100, 2)
          ELSE 0
        END as margin_percentage
      FROM categories c
      LEFT JOIN orders o ON c.id = o.category_id 
        AND o.status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')
        ${dateClause}
      GROUP BY c.id, c.name
      ORDER BY total_sales DESC;
    `, params);

    return successResponse(res, resData.rows, 'Category performance report retrieved');
  } catch (err) {
    next(err);
  }
};

export const getCustomerReport = async (req, res, next) => {
  try {
    const resData = await query(`
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
        c.customer_code,
        c.company_name as customer_name,
        c.contact_person,
        COALESCE(co.total_orders, 0)::int as total_orders,
        COALESCE(co.total_sales, 0)::numeric as total_sales,
        COALESCE(cp.amount_paid, 0)::numeric as amount_paid,
        (COALESCE(co.total_sales, 0) - COALESCE(cp.amount_paid, 0))::numeric as outstanding_balance,
        COALESCE(co.profit_generated, 0)::numeric as profit_generated
      FROM customers c
      LEFT JOIN cust_orders co ON c.id = co.customer_id
      LEFT JOIN cust_payments cp ON c.id = cp.customer_id
      ORDER BY total_sales DESC;
    `);

    return successResponse(res, resData.rows, 'Customer report retrieved');
  } catch (err) {
    next(err);
  }
};

export const getSupplierReport = async (req, res, next) => {
  try {
    const resData = await query(`
      WITH supp_costs AS (
        SELECT 
          oi.supplier_id,
          COUNT(DISTINCT oi.order_id) as total_orders,
          COALESCE(SUM(oi.total_cost_amount), 0) as purchase_cost
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
        s.supplier_code,
        s.company_name as supplier_name,
        s.contact_person,
        COALESCE(sc.total_orders, 0)::int as total_orders,
        COALESCE(sc.purchase_cost, 0)::numeric as purchase_cost,
        COALESCE(sp.amount_paid, 0)::numeric as amount_paid,
        (COALESCE(sc.purchase_cost, 0) - COALESCE(sp.amount_paid, 0))::numeric as outstanding_balance
      FROM suppliers s
      LEFT JOIN supp_costs sc ON s.id = sc.supplier_id
      LEFT JOIN supp_payments sp ON s.id = sp.supplier_id
      ORDER BY purchase_cost DESC;
    `);

    return successResponse(res, resData.rows, 'Supplier report retrieved');
  } catch (err) {
    next(err);
  }
};

export const getPartnerReport = async (req, res, next) => {
  try {
    const metrics = await getFinancialMetrics();
    return successResponse(res, {
      netProfit: metrics.netProfit,
      partners: metrics.partnerBreakdown,
      totalCapital: metrics.totalPartnerCapital,
    }, 'Partner equity report retrieved');
  } catch (err) {
    next(err);
  }
};
