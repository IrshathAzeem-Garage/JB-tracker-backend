import { Router } from 'express';
import {
  getOrders,
  getOrderById,
  createOrder,
  updateOrder,
  recordCustomerPayment,
  recordSupplierPayment,
} from '../controllers/orderController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import {
  orderCreateSchema,
  orderUpdateSchema,
  customerPaymentSchema,
  supplierPaymentSchema,
} from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/', getOrders);
router.post('/', validateRequest(orderCreateSchema), createOrder);
router.get('/:id', getOrderById);
router.put('/:id', validateRequest(orderUpdateSchema), updateOrder);

router.post('/:id/customer-payments', validateRequest(customerPaymentSchema), recordCustomerPayment);
router.post('/:id/supplier-payments', validateRequest(supplierPaymentSchema), recordSupplierPayment);

export default router;
