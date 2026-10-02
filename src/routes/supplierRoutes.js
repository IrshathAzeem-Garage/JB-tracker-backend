import { Router } from 'express';
import {
  getSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
} from '../controllers/supplierController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { supplierSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/', getSuppliers);
router.post('/', validateRequest(supplierSchema), createSupplier);
router.get('/:id', getSupplierById);
router.put('/:id', validateRequest(supplierSchema.partial()), updateSupplier);

export default router;
