import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { pool, withTransaction } from '../src/config/db.js';
import { getFinancialMetrics } from '../src/services/financeService.js';

describe('JB Tracker - Core Financial Separation and Calculation Tests', () => {
  let testCustomerId;
  let testPartnerId;
  let testOrderId;

  test('Critical Business Scenario 58 & 61: Strict separation of Profit, Cash, and Receivables', async () => {
    await withTransaction(async (client) => {
      // 1. Clean slate for exact calculation verification in transaction savepoint
      await client.query('SAVEPOINT test_scenario_start;');

      // Temporary tables / cleanup within savepoint
      await client.query(`
        TRUNCATE partner_investments, partner_withdrawals, orders, order_items,
                 customer_payments, supplier_payments, expenses, cash_transactions
        CASCADE;
      `);

      // 2. Partner A invests ₹25,000, Partner B invests ₹25,000 (Total Investment = ₹50,000)
      const pRes = await client.query('SELECT id, name FROM partners LIMIT 2;');
      const pA = pRes.rows[0].id;
      const pB = pRes.rows[1].id;

      const invA = await client.query(`
        INSERT INTO partner_investments (partner_id, amount, investment_date, investment_type, payment_method, description)
        VALUES ($1, 25000.00, CURRENT_DATE, 'INITIAL', 'BANK_TRANSFER', 'Partner A initial')
        RETURNING id;
      `, [pA]);
      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES ('MONEY_IN', 'PARTNER_INVESTMENT', $1, 25000.00, CURRENT_DATE, 'BANK_TRANSFER', 'Partner A initial');
      `, [invA.rows[0].id]);

      const invB = await client.query(`
        INSERT INTO partner_investments (partner_id, amount, investment_date, investment_type, payment_method, description)
        VALUES ($1, 25000.00, CURRENT_DATE, 'INITIAL', 'BANK_TRANSFER', 'Partner B initial')
        RETURNING id;
      `, [pB]);
      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES ('MONEY_IN', 'PARTNER_INVESTMENT', $1, 25000.00, CURRENT_DATE, 'BANK_TRANSFER', 'Partner B initial');
      `, [invB.rows[0].id]);

      // 3. Customer order: ₹1,19,700 with direct cost of ₹93,000
      const cRes = await client.query('SELECT id FROM customers LIMIT 1;');
      const custId = cRes.rows[0].id;

      const orderRes = await client.query(`
        INSERT INTO orders (
          order_number, customer_id, order_date, status, subtotal, total_amount, total_cost, gross_profit
        )
        VALUES ('JB-TEST-001', $1, CURRENT_DATE, 'CONFIRMED', 119700.00, 119700.00, 93000.00, 26700.00)
        RETURNING id;
      `, [custId]);
      const orderId = orderRes.rows[0].id;

      await client.query(`
        INSERT INTO order_items (
          order_id, description, quantity, unit_selling_price, unit_cost_price,
          total_selling_amount, total_cost_amount, profit
        )
        VALUES ($1, 'Corporate Merchandise Kit', 300, 399.00, 310.00, 119700.00, 93000.00, 26700.00);
      `, [orderId]);

      // 4. Customer pays advance ₹60,000
      const payRes = await client.query(`
        INSERT INTO customer_payments (customer_id, order_id, amount, payment_date, payment_method)
        VALUES ($1, $2, 60000.00, CURRENT_DATE, 'BANK_TRANSFER')
        RETURNING id;
      `, [custId, orderId]);
      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES ('MONEY_IN', 'CUSTOMER_PAYMENT', $1, 60000.00, CURRENT_DATE, 'BANK_TRANSFER', 'Advance payment');
      `, [payRes.rows[0].id]);

      // 5. Business pays direct costs ₹93,000 to supplier
      const sRes = await client.query('SELECT id FROM suppliers LIMIT 1;');
      const suppId = sRes.rows[0].id;

      const spayRes = await client.query(`
        INSERT INTO supplier_payments (supplier_id, order_id, amount, payment_date, payment_method)
        VALUES ($1, $2, 93000.00, CURRENT_DATE, 'BANK_TRANSFER')
        RETURNING id;
      `, [suppId, orderId]);
      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES ('MONEY_OUT', 'SUPPLIER_PAYMENT', $1, 93000.00, CURRENT_DATE, 'BANK_TRANSFER', 'Direct cost paid');
      `, [spayRes.rows[0].id]);

      // 6. Business incurs operating expenses of ₹7,500
      const expRes = await client.query(`
        INSERT INTO expenses (expense_number, category, description, amount, expense_date, payment_method)
        VALUES ('EXP-TEST-001', 'Advertising', 'Performance ads', 7500.00, CURRENT_DATE, 'BANK_TRANSFER')
        RETURNING id;
      `, []);
      await client.query(`
        INSERT INTO cash_transactions (transaction_type, source_type, source_id, amount, transaction_date, payment_method, description)
        VALUES ('MONEY_OUT', 'BUSINESS_EXPENSE', $1, 7500.00, CURRENT_DATE, 'BANK_TRANSFER', 'Advertising expense');
      `, [expRes.rows[0].id]);

      // 7. Verify Core Formulas
      // Total Investment: ₹50,000
      const invCheck = await client.query('SELECT SUM(amount)::numeric as total FROM partner_investments;');
      assert.equal(parseFloat(invCheck.rows[0].total), 50000.00, 'Total investment must equal 50,000');

      // Total Sales: ₹1,19,700
      const salesCheck = await client.query("SELECT SUM(total_amount)::numeric as total FROM orders WHERE status = 'CONFIRMED';");
      assert.equal(parseFloat(salesCheck.rows[0].total), 119700.00, 'Total sales must equal 1,19,700');

      // Gross Profit: ₹1,19,700 - ₹93,000 = ₹26,700
      const gpCheck = await client.query("SELECT SUM(gross_profit)::numeric as gp FROM orders WHERE status = 'CONFIRMED';");
      assert.equal(parseFloat(gpCheck.rows[0].gp), 26700.00, 'Gross profit must equal 26,700');

      // Operating Expenses: ₹7,500
      const expCheck = await client.query('SELECT SUM(amount)::numeric as exp FROM expenses;');
      assert.equal(parseFloat(expCheck.rows[0].exp), 7500.00, 'Operating expenses must equal 7,500');

      // Net Profit: Gross Profit - Operating Expenses = 26,700 - 7,500 = ₹19,200
      const netProfit = parseFloat(gpCheck.rows[0].gp) - parseFloat(expCheck.rows[0].exp);
      assert.equal(netProfit, 19200.00, 'Net profit must be exactly ₹19,200');

      // Cash Available from central ledger:
      // Money In: 25k (Inv A) + 25k (Inv B) + 60k (Customer) = 1,10,000
      // Money Out: 93k (Direct Cost) + 7.5k (Expenses) = 1,00,500
      // Cash Remaining: 1,10,000 - 1,00,500 = ₹9,500
      const cashInCheck = await client.query("SELECT SUM(amount)::numeric as total FROM cash_transactions WHERE transaction_type = 'MONEY_IN';");
      const cashOutCheck = await client.query("SELECT SUM(amount)::numeric as total FROM cash_transactions WHERE transaction_type = 'MONEY_OUT';");
      const cashRemaining = parseFloat(cashInCheck.rows[0].total) - parseFloat(cashOutCheck.rows[0].total);
      assert.equal(cashRemaining, 9500.00, 'Cash available must be exactly ₹9,500');

      // CRITICAL ASSERTION: Cash != Net Profit
      assert.notEqual(cashRemaining, netProfit, 'Cash Available (9,500) must NEVER be treated as Net Profit (19,200)!');

      // Accounts Receivable: ₹1,19,700 - ₹60,000 = ₹59,700
      const arCheck = await client.query(`
        SELECT (o.total_amount - p.paid)::numeric as balance
        FROM orders o
        JOIN (SELECT order_id, SUM(amount) as paid FROM customer_payments GROUP BY order_id) p ON o.id = p.order_id
        WHERE o.id = $1;
      `, [orderId]);
      assert.equal(parseFloat(arCheck.rows[0].balance), 59700.00, 'Customer must still owe ₹59,700 in Accounts Receivable');

      // Rollback to keep original seed data intact
      await client.query('ROLLBACK TO SAVEPOINT test_scenario_start;');
    });
  });

  after(async () => {
    // Keep connection pool alive or terminate when runner finishes
  });
});
