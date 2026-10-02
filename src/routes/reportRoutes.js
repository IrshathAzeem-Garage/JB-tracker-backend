import { Router } from 'express';
import {
  getProfitLoss,
  getCashFlow,
  getSalesReport,
  getCategoryReport,
  getCustomerReport,
  getSupplierReport,
  getPartnerReport,
} from '../controllers/reportController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/profit-loss', getProfitLoss);
router.get('/cash-flow', getCashFlow);
router.get('/sales', getSalesReport);
router.get('/categories', getCategoryReport);
router.get('/customers', getCustomerReport);
router.get('/suppliers', getSupplierReport);
router.get('/partners', getPartnerReport);

export default router;
