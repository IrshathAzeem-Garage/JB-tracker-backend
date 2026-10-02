import { Router } from 'express';
import {
  getProducts,
  createProduct,
  updateProduct,
} from '../controllers/productController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { productSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/', getProducts);
router.post('/', validateRequest(productSchema), createProduct);
router.put('/:id', validateRequest(productSchema.partial()), updateProduct);

export default router;
