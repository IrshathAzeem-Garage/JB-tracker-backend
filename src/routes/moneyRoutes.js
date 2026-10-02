import { Router } from 'express';
import { getTransactions } from '../controllers/moneyController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/', getTransactions);

export default router;
