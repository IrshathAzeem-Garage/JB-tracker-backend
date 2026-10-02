import { Router } from 'express';
import {
  getCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
} from '../controllers/customerController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { customerSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/', getCustomers);
router.post('/', validateRequest(customerSchema), createCustomer);
router.get('/:id', getCustomerById);
router.put('/:id', validateRequest(customerSchema.partial()), updateCustomer);

export default router;
