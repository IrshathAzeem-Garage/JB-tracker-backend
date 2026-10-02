import { Router } from 'express';
import {
  getExpenses,
  createExpense,
  updateExpense,
  deleteExpense,
} from '../controllers/expenseController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { expenseSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

router.get('/', getExpenses);
router.post('/', validateRequest(expenseSchema), createExpense);
router.put('/:id', validateRequest(expenseSchema.partial()), updateExpense);
router.delete('/:id', deleteExpense);

export default router;
