import { Router } from 'express';
import {
  getCategories,
  createCategory,
  updateCategory,
} from '../controllers/categoryController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { categorySchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/', getCategories);
router.post('/', validateRequest(categorySchema), createCategory);
router.put('/:id', validateRequest(categorySchema.partial()), updateCategory);

export default router;
