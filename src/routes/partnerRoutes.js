import { Router } from 'express';
import {
  getPartners,
  getPartnerById,
  createPartner,
  recordInvestment,
  recordWithdrawal,
} from '../controllers/partnerController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import {
  partnerSchema,
  partnerInvestmentSchema,
  partnerWithdrawalSchema,
} from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/', getPartners);
router.post('/', validateRequest(partnerSchema), createPartner);
router.get('/:id', getPartnerById);
router.post('/:id/investments', validateRequest(partnerInvestmentSchema), recordInvestment);
router.post('/:id/withdrawals', validateRequest(partnerWithdrawalSchema), recordWithdrawal);

export default router;
