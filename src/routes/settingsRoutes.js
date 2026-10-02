import { Router } from 'express';
import {
  getCompanySettings,
  updateCompanySettings,
  getUsers,
  createUser,
  updateUser,
  getAuditLogs,
} from '../controllers/settingsController.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { companySettingsSchema, userCreateSchema } from '../validators/schemas.js';

const router = Router();

router.use(authenticate);

// Company settings
router.get('/company', getCompanySettings);
router.put('/company', requireRole(['ADMIN']), validateRequest(companySettingsSchema), updateCompanySettings);

// User management (Admin only)
router.get('/users', requireRole(['ADMIN']), getUsers);
router.post('/users', requireRole(['ADMIN']), validateRequest(userCreateSchema), createUser);
router.put('/users/:id', requireRole(['ADMIN']), updateUser);

// Audit logs
router.get('/audit-logs', requireRole(['ADMIN', 'MANAGER']), getAuditLogs);

export default router;
