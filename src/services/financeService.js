import { query } from '../config/db.js';

export const getFinancialMetrics = async (filters = {}) => {
  // 1. Total Investment
  const invRes = await query(`
    SELECT COALESCE(SUM(amount), 0)::numeric AS total_investment
    FROM partner_investments;
  `);
  const totalInvestment = parseFloat(invRes.rows[0].total_investment || 0);

  // 2. Orders & Sales (Status IN ('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED'))
  const validStatuses = "('CONFIRMED', 'PROCUREMENT', 'CUSTOMIZATION', 'READY', 'DELIVERED')";
  
  const salesRes = await query(`
    SELECT 
      COALESCE(SUM(total_amount), 0)::numeric AS total_sales,
      COALESCE(SUM(total_cost), 0)::numeric AS direct_costs,
      COALESCE(SUM(gross_profit), 0)::numeric AS gross_profit,
      COUNT(id)::int AS total_orders
    FROM orders
    WHERE status IN ${validStatuses};
  `);
  const totalSales = parseFloat(salesRes.rows[0].total_sales || 0);
  const directCosts = parseFloat(salesRes.rows[0].direct_costs || 0);
  const grossProfit = parseFloat(salesRes.rows[0].gross_profit || 0);
  const validOrdersCount = parseInt(salesRes.rows[0].total_orders || 0, 10);

  // 3. Customer Payments & Accounts Receivable
  // Accounts Receivable = SUM of (order.total_amount - order.paid) for active orders where balance > 0
  const arRes = await query(`
    SELECT 
      COALESCE(SUM(GREATEST(0, o.total_amount - COALESCE(p.paid_amount, 0))), 0)::numeric AS accounts_receivable,
      COALESCE(SUM(p.paid_amount), 0)::numeric AS total_customer_payments
    FROM orders o
    LEFT JOIN (
      SELECT order_id, SUM(amount) AS paid_amount
      FROM customer_payments
      GROUP BY order_id
    ) p ON o.id = p.order_id
    WHERE o.status IN ${validStatuses};
  `);
  const accountsReceivable = parseFloat(arRes.rows[0].accounts_receivable || 0);
  
  const allCustPaymentsRes = await query(`
    SELECT COALESCE(SUM(amount), 0)::numeric AS total_customer_payments
    FROM customer_payments;
  `);
  const totalCustomerPayments = parseFloat(allCustPaymentsRes.rows[0].total_customer_payments || 0);

  // 4. Supplier Payments & Accounts Payable
  // Payable = Total supplier costs on valid orders minus total supplier payments made
  const apRes = await query(`
    WITH order_suppliers AS (
      SELECT 
        oi.supplier_id,
        oi.order_id,
        SUM(oi.total_cost_amount) AS supplier_committed_cost
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.status IN ${validStatuses} AND oi.supplier_id IS NOT NULL
      GROUP BY oi.supplier_id, oi.order_id
    ),
    order_spays AS (
      SELECT 
        supplier_id,
        order_id,
        SUM(amount) AS supplier_paid_amount
      FROM supplier_payments
      GROUP BY supplier_id, order_id
    )
    SELECT 
      COALESCE(SUM(GREATEST(0, os.supplier_committed_cost - COALESCE(sp.supplier_paid_amount, 0))), 0)::numeric AS accounts_payable
    FROM order_suppliers os
    LEFT JOIN order_spays sp ON os.supplier_id = sp.supplier_id AND os.order_id = sp.order_id;
  `);
  const accountsPayable = parseFloat(apRes.rows[0].accounts_payable || 0);

  const allSuppPaymentsRes = await query(`
    SELECT COALESCE(SUM(amount), 0)::numeric AS total_supplier_payments
    FROM supplier_payments;
  `);
  const totalSupplierPayments = parseFloat(allSuppPaymentsRes.rows[0].total_supplier_payments || 0);

  // 5. Operating Expenses
  const expRes = await query(`
    SELECT COALESCE(SUM(amount), 0)::numeric AS total_expenses
    FROM expenses;
  `);
  const operatingExpenses = parseFloat(expRes.rows[0].total_expenses || 0);

  // 6. Net Profit
  const netProfit = grossProfit - operatingExpenses;
  const overallMarginPercentage = totalSales > 0 ? ((grossProfit / totalSales) * 100) : 0;
  const netMarginPercentage = totalSales > 0 ? ((netProfit / totalSales) * 100) : 0;

  // 7. Cash Balance from CENTRAL CASH LEDGER
  const cashRes = await query(`
    SELECT 
      COALESCE(SUM(CASE WHEN transaction_type = 'MONEY_IN' THEN amount ELSE 0 END), 0)::numeric AS money_in,
      COALESCE(SUM(CASE WHEN transaction_type = 'MONEY_OUT' THEN amount ELSE 0 END), 0)::numeric AS money_out
    FROM cash_transactions;
  `);
  const moneyIn = parseFloat(cashRes.rows[0].money_in || 0);
  const moneyOut = parseFloat(cashRes.rows[0].money_out || 0);
  const cashAvailable = moneyIn - moneyOut;

  // 8. Partner Capital
  const partnerCapitalRes = await query(`
    SELECT 
      p.id,
      p.name,
      p.profit_share_percentage,
      COALESCE(inv.total_invested, 0)::numeric AS total_invested,
      COALESCE(wth.total_withdrawn, 0)::numeric AS total_withdrawn
    FROM partners p
    LEFT JOIN (
      SELECT partner_id, SUM(amount) AS total_invested
      FROM partner_investments
      GROUP BY partner_id
    ) inv ON p.id = inv.partner_id
    LEFT JOIN (
      SELECT partner_id, SUM(amount) AS total_withdrawn
      FROM partner_withdrawals
      GROUP BY partner_id
    ) wth ON p.id = wth.partner_id
    WHERE p.status = 'ACTIVE';
  `);

  let totalPartnerCapital = 0;
  const partnerBreakdown = partnerCapitalRes.rows.map(row => {
    const invested = parseFloat(row.total_invested || 0);
    const withdrawn = parseFloat(row.total_withdrawn || 0);
    const profitSharePct = parseFloat(row.profit_share_percentage || 0);
    const allocatedProfit = netProfit > 0 ? (netProfit * (profitSharePct / 100)) : (netProfit * (profitSharePct / 100));
    const currentCapital = invested - withdrawn + allocatedProfit;
    totalPartnerCapital += currentCapital;

    return {
      partnerId: row.id,
      name: row.name,
      profitSharePercentage: profitSharePct,
      invested,
      withdrawn,
      allocatedProfit,
      currentCapital,
    };
  });

  return {
    totalInvestment,
    totalSales,
    directCosts,
    grossProfit,
    operatingExpenses,
    netProfit,
    overallMarginPercentage: parseFloat(overallMarginPercentage.toFixed(2)),
    netMarginPercentage: parseFloat(netMarginPercentage.toFixed(2)),
    cashAvailable,
    moneyIn,
    moneyOut,
    accountsReceivable,
    accountsPayable,
    totalCustomerPayments,
    totalSupplierPayments,
    totalOrders: validOrdersCount,
    totalPartnerCapital,
    partnerBreakdown,
  };
};

export const getCashBalance = async (client = null) => {
  const runner = client ? client.query.bind(client) : query;
  const res = await runner(`
    SELECT 
      COALESCE(SUM(CASE WHEN transaction_type = 'MONEY_IN' THEN amount ELSE 0 END), 0)::numeric AS money_in,
      COALESCE(SUM(CASE WHEN transaction_type = 'MONEY_OUT' THEN amount ELSE 0 END), 0)::numeric AS money_out
    FROM cash_transactions;
  `);
  const moneyIn = parseFloat(res.rows[0].money_in || 0);
  const moneyOut = parseFloat(res.rows[0].money_out || 0);
  return moneyIn - moneyOut;
};
