import { Router } from 'express';
import { getDashboardData } from '../controllers/dashboardController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, getDashboardData);

export default router;
