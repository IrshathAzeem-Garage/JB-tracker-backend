import { Router } from 'express';
import { login, getMe } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { loginSchema } from '../validators/schemas.js';

const router = Router();

router.post('/login', validateRequest(loginSchema), login);
router.get('/me', authenticate, getMe);

export default router;
