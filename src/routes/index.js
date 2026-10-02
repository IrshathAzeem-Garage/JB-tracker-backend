import { Router } from 'express';
import authRoutes from './authRoutes.js';
import dashboardRoutes from './dashboardRoutes.js';
import orderRoutes from './orderRoutes.js';
import customerRoutes from './customerRoutes.js';
import supplierRoutes from './supplierRoutes.js';
import productRoutes from './productRoutes.js';
import categoryRoutes from './categoryRoutes.js';
import expenseRoutes from './expenseRoutes.js';
import moneyRoutes from './moneyRoutes.js';
import partnerRoutes from './partnerRoutes.js';
import reportRoutes from './reportRoutes.js';
import settingsRoutes from './settingsRoutes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/orders', orderRoutes);
router.use('/customers', customerRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);
router.use('/expenses', expenseRoutes);
router.use('/transactions', moneyRoutes);
router.use('/partners', partnerRoutes);
router.use('/reports', reportRoutes);
router.use('/settings', settingsRoutes);

export default router;
