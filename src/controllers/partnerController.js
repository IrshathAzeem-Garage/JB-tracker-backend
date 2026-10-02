import { query, withTransaction } from '../config/db.js';
import { getFinancialMetrics, getCashBalance } from '../services/financeService.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const getPartners = async (req, res, next) => {
  try {
    const metrics = await getFinancialMetrics();
    const netProfit = metrics.netProfit;

    const partnersRes = await query(`
      SELECT 
        p.*,
        COALESCE(inv.initial_investment, 0)::numeric as initial_investment,
        COALESCE(inv.additional_investment, 0)::numeric as additional_investment,
        COALESCE(inv.total_investment, 0)::numeric as total_investment,
        COALESCE(wth.total_withdrawn, 0)::numeric as total_withdrawn
      FROM partners p
      LEFT JOIN (
        SELECT 
          partner_id,
          SUM(CASE WHEN investment_type = 'INITIAL' THEN amount ELSE 0 END) as initial_investment,
          SUM(CASE WHEN investment_type = 'ADDITIONAL' THEN amount ELSE 0 END) as additional_investment,
          SUM(amount) as total_investment
        FROM partner_investments
        GROUP BY partner_id
      ) inv ON p.id = inv.partner_id
      LEFT JOIN (
        SELECT 
          partner_id,
          SUM(amount) as total_withdrawn
        FROM partner_withdrawals
        GROUP BY partner_id
      ) wth ON p.id = wth.partner_id
      ORDER BY p.name ASC;
    `);

    const partnersWithCapital = partnersRes.rows.map(partner => {
      const totalInv = parseFloat(partner.total_investment);
      const totalWithdrawn = parseFloat(partner.total_withdrawn);
      const profitSharePct = parseFloat(partner.profit_share_percentage);
      const allocatedProfit = (netProfit * (profitSharePct / 100));
      const currentCapital = totalInv - totalWithdrawn + allocatedProfit;

      return {
        ...partner,
        total_investment: totalInv,
        initial_investment: parseFloat(partner.initial_investment),
        additional_investment: parseFloat(partner.additional_investment),
        total_withdrawn: totalWithdrawn,
        allocated_profit: parseFloat(allocatedProfit.toFixed(2)),
        current_capital: parseFloat(currentCapital.toFixed(2)),
      };
    });

    return successResponse(res, {
      partners: partnersWithCapital,
      companyNetProfit: netProfit,
      totalCapital: partnersWithCapital.reduce((sum, p) => sum + p.current_capital, 0),
    }, 'Partners retrieved');
  } catch (err) {
    next(err);
  }
};

export const getPartnerById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const partnerRes = await query('SELECT * FROM partners WHERE id = $1', [id]);
    if (partnerRes.rows.length === 0) {
      return errorResponse(res, 'Partner not found', 404);
    }
    const partner = partnerRes.rows[0];

    const investmentsRes = await query(`
      SELECT * FROM partner_investments 
      WHERE partner_id = $1 
      ORDER BY investment_date DESC;
    `, [id]);

    const withdrawalsRes = await query(`
      SELECT * FROM partner_withdrawals 
      WHERE partner_id = $1 
      ORDER BY withdrawal_date DESC;
    `, [id]);

    const metrics = await getFinancialMetrics();
    const allocatedProfit = metrics.netProfit * (parseFloat(partner.profit_share_percentage) / 100);
    const totalInvested = investmentsRes.rows.reduce((sum, i) => sum + parseFloat(i.amount), 0);
    const totalWithdrawn = withdrawalsRes.rows.reduce((sum, w) => sum + parseFloat(w.amount), 0);
    const currentCapital = totalInvested - totalWithdrawn + allocatedProfit;

    return successResponse(res, {
      partner,
      summary: {
        totalInvested,
        totalWithdrawn,
        profitSharePercentage: parseFloat(partner.profit_share_percentage),
        allocatedProfit: parseFloat(allocatedProfit.toFixed(2)),
        currentCapital: parseFloat(currentCapital.toFixed(2)),
      },
      investments: investmentsRes.rows,
      withdrawals: withdrawalsRes.rows,
    }, 'Partner details retrieved');
  } catch (err) {
    next(err);
  }
};

export const createPartner = async (req, res, next) => {
  try {
    const {
      name,
      email,
      phone,
      ownership_percentage = 50,
      profit_share_percentage = 50,
      status = 'ACTIVE',
    } = req.body;

    const result = await query(`
      INSERT INTO partners (
        name, email, phone, ownership_percentage, profit_share_percentage, status
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `, [
      name,
      email || null,
      phone || null,
      ownership_percentage,
      profit_share_percentage,
      status,
    ]);

    const newPartner = result.rows[0];

    await logAudit({
      userId: req.user?.id,
      action: 'PARTNER_CREATED',
      entityType: 'PARTNER',
      entityId: newPartner.id,
      newValues: { name, ownership_percentage, profit_share_percentage },
    });

    return successResponse(res, newPartner, 'Partner added successfully', 201);
  } catch (err) {
    next(err);
  }
};

export const recordInvestment = async (req, res, next) => {
  try {
    const { id } = req.params; // partner_id
    const {
      amount,
      investment_date,
      investment_type = 'ADDITIONAL',
      payment_method = 'BANK_TRANSFER',
      description,
      reference,
    } = req.body;

    const partnerRes = await query('SELECT name FROM partners WHERE id = $1', [id]);
    if (partnerRes.rows.length === 0) {
      return errorResponse(res, 'Partner not found', 404);
    }
    const partner = partnerRes.rows[0];

    const result = await withTransaction(async (client) => {
      // 1. Insert investment
      const invRes = await client.query(`
        INSERT INTO partner_investments (
          partner_id, amount, investment_date, investment_type, payment_method, description, reference
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING *;
      `, [
        id,
        amount,
        investment_date || new Date(),
        investment_type,
        payment_method,
        description || null,
        reference || null,
      ]);
      const investment = invRes.rows[0];

      // 2. Central cash transaction (MONEY_IN)
      await client.query(`
        INSERT INTO cash_transactions (
          transaction_type, source_type, source_id, amount, transaction_date, payment_method, description
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7);
      `, [
        'MONEY_IN',
        'PARTNER_INVESTMENT',
        investment.id,
        amount,
        investment_date || new Date(),
        payment_method,
        `${investment_type} investment from ${partner.name}${reference ? ` (Ref: ${reference})` : ''}`
      ]);

      // 3. Audit log
      await logAudit({
        userId: req.user?.id,
        action: 'PARTNER_INVESTMENT_RECORDED',
        entityType: 'PARTNER_INVESTMENT',
        entityId: investment.id,
        newValues: { partner_id: id, amount, investment_type },
        client,
      });

      return investment;
    });

    return successResponse(res, result, 'Partner investment recorded and cash updated', 201);
  } catch (err) {
    next(err);
  }
};

export const recordWithdrawal = async (req, res, next) => {
  try {
    const { id } = req.params; // partner_id
    const {
      amount,
      withdrawal_date,
      payment_method = 'BANK_TRANSFER',
      reason,
      description,
    } = req.body;

    const partnerRes = await query('SELECT name FROM partners WHERE id = $1', [id]);
    if (partnerRes.rows.length === 0) {
      return errorResponse(res, 'Partner not found', 404);
    }
    const partner = partnerRes.rows[0];

    const result = await withTransaction(async (client) => {
      // Check cash availability in business
      const availableCash = await getCashBalance(client);
      if (parseFloat(amount) > availableCash) {
        throw new Error(`Insufficient cash available in business. Current cash is ₹${availableCash.toLocaleString('en-IN')}, requested withdrawal is ₹${parseFloat(amount).toLocaleString('en-IN')}.`);
      }

      // 1. Insert withdrawal
      const wthRes = await client.query(`
        INSERT INTO partner_withdrawals (
          partner_id, amount, withdrawal_date, payment_method, reason, description
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *;
      `, [
        id,
        amount,
        withdrawal_date || new Date(),
        payment_method,
        reason || null,
        description || null,
      ]);
      const withdrawal = wthRes.rows[0];

      // 2. Central cash transaction (MONEY_OUT)
      await client.query(`
        INSERT INTO cash_transactions (
          transaction_type, source_type, source_id, amount, transaction_date, payment_method, description
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7);
      `, [
        'MONEY_OUT',
        'PARTNER_WITHDRAWAL',
        withdrawal.id,
        amount,
        withdrawal_date || new Date(),
        payment_method,
        `Partner withdrawal: ${partner.name}${reason ? ` (${reason})` : ''}`
      ]);

      // 3. Audit log
      await logAudit({
        userId: req.user?.id,
        action: 'PARTNER_WITHDRAWAL_RECORDED',
        entityType: 'PARTNER_WITHDRAWAL',
        entityId: withdrawal.id,
        newValues: { partner_id: id, amount, reason },
        client,
      });

      return withdrawal;
    });

    return successResponse(res, result, 'Partner withdrawal recorded and cash updated', 201);
  } catch (err) {
    next(err);
  }
};
