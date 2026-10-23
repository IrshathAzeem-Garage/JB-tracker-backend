import { Router } from 'express';
import {
  getNotes,
  getNotesSummary,
  getNoteById,
  createNote,
  updateNote,
  togglePin,
  toggleArchive,
  deleteNote,
} from '../controllers/noteController.js';
import { authenticate } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validator.js';
import { noteCreateSchema, noteUpdateSchema } from '../validators/schemas.js';

const router = Router();

// All note operations require valid authentication
router.use(authenticate);

router.get('/', getNotes);
router.get('/summary', getNotesSummary);
router.get('/:id', getNoteById);
router.post('/', validateRequest(noteCreateSchema), createNote);
router.put('/:id', validateRequest(noteUpdateSchema), updateNote);
router.patch('/:id/pin', togglePin);
router.patch('/:id/archive', toggleArchive);
router.delete('/:id', deleteNote);

export default router;
