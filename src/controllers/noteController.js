import { query } from '../config/db.js';
import { successResponse, errorResponse } from '../utils/response.js';
import { logAudit } from '../utils/audit.js';

export const getNotes = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 24,
      search = '',
      category = '',
      priority = '',
      isPinned,
      isArchived = 'false',
      sortBy = 'updated',
    } = req.query;

    const offset = (Math.max(1, parseInt(page, 10)) - 1) * Math.max(1, parseInt(limit, 10));
    const conditions = ['n.user_id = $1'];
    const params = [userId];

    // Archive filter
    if (isArchived === 'true') {
      conditions.push('n.is_archived = TRUE');
    } else if (isArchived === 'all') {
      // no filter
    } else {
      conditions.push('n.is_archived = FALSE');
    }

    // Pinned filter
    if (isPinned === 'true') {
      conditions.push('n.is_pinned = TRUE');
    } else if (isPinned === 'false') {
      conditions.push('n.is_pinned = FALSE');
    }

    // Category filter
    if (category && category !== 'All' && category !== '') {
      params.push(category);
      conditions.push(`n.category = $${params.length}`);
    }

    // Priority filter
    if (priority && priority !== 'All' && priority !== '') {
      params.push(priority);
      conditions.push(`n.priority = $${params.length}`);
    }

    // Search filter across title, content, and tags
    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      const searchParamIdx = params.length;
      conditions.push(`(
        LOWER(n.title) LIKE $${searchParamIdx} OR
        LOWER(n.content) LIKE $${searchParamIdx} OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(n.tags) tag_elem
          WHERE LOWER(tag_elem) LIKE $${searchParamIdx}
        )
      )`);
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Get total count matching current filters
    const countSql = `SELECT COUNT(n.id) as total FROM notes n ${whereClause};`;
    const countRes = await query(countSql, params);
    const totalRecords = parseInt(countRes.rows[0].total, 10);

    // Sorting logic
    let orderClause = '';
    if (isArchived !== 'true') {
      orderClause = 'n.is_pinned DESC, ';
    }

    switch (sortBy) {
      case 'created':
        orderClause += 'n.created_at DESC';
        break;
      case 'title':
        orderClause += 'LOWER(n.title) ASC, n.updated_at DESC';
        break;
      case 'priority':
        orderClause += "CASE n.priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END ASC, n.updated_at DESC";
        break;
      case 'updated':
      default:
        orderClause += 'n.updated_at DESC';
        break;
    }

    params.push(Math.max(1, parseInt(limit, 10)));
    const limitIdx = params.length;
    params.push(offset);
    const offsetIdx = params.length;

    const dataSql = `
      SELECT 
        n.id,
        n.user_id,
        n.title,
        n.content,
        n.category,
        n.tags,
        n.priority,
        n.reminder_at,
        n.is_pinned,
        n.is_archived,
        n.created_at,
        n.updated_at
      FROM notes n
      ${whereClause}
      ORDER BY ${orderClause}
      LIMIT $${limitIdx} OFFSET $${offsetIdx};
    `;

    const notesRes = await query(dataSql, params);

    // Also get overall user stats for summary indicators
    const summarySql = `
      SELECT 
        COUNT(id) FILTER (WHERE is_archived = FALSE) as total_active,
        COUNT(id) FILTER (WHERE is_archived = FALSE AND is_pinned = TRUE) as total_pinned,
        COUNT(id) FILTER (WHERE is_archived = TRUE) as total_archived,
        COUNT(id) as total_all
      FROM notes
      WHERE user_id = $1;
    `;
    const summaryRes = await query(summarySql, [userId]);
    const summaryRow = summaryRes.rows[0] || {};

    const summary = {
      totalNotes: parseInt(summaryRow.total_active || 0, 10),
      pinnedNotes: parseInt(summaryRow.total_pinned || 0, 10),
      archivedNotes: parseInt(summaryRow.total_archived || 0, 10),
      allNotes: parseInt(summaryRow.total_all || 0, 10),
    };

    return successResponse(
      res,
      {
        notes: notesRes.rows,
        pagination: {
          total: totalRecords,
          page: parseInt(page, 10),
          limit: parseInt(limit, 10),
          totalPages: Math.ceil(totalRecords / parseInt(limit, 10)) || 1,
        },
        summary,
      },
      'Notes retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
};

export const getNoteById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      `SELECT * FROM notes WHERE id = $1 AND user_id = $2;`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 'Note not found', 404);
    }

    return successResponse(res, result.rows[0], 'Note retrieved successfully');
  } catch (error) {
    next(error);
  }
};

export const createNote = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const {
      title,
      content,
      category = 'General',
      tags = [],
      priority = 'Medium',
      reminder_at = null,
      is_pinned = false,
      is_archived = false,
    } = req.body;

    const insertSql = `
      INSERT INTO notes (
        user_id,
        title,
        content,
        category,
        tags,
        priority,
        reminder_at,
        is_pinned,
        is_archived
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const values = [
      userId,
      title.trim(),
      content.trim(),
      category,
      JSON.stringify(Array.isArray(tags) ? tags : []),
      priority,
      reminder_at || null,
      Boolean(is_pinned),
      Boolean(is_archived),
    ];

    const result = await query(insertSql, values);
    const newNote = result.rows[0];

    await logAudit({
      userId,
      action: 'CREATE',
      entityType: 'NOTE',
      entityId: newNote.id,
      newValues: newNote,
    });

    return successResponse(res, newNote, 'Note created successfully', 201);
  } catch (error) {
    next(error);
  }
};

export const updateNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const existingRes = await query(
      `SELECT * FROM notes WHERE id = $1 AND user_id = $2;`,
      [id, userId]
    );

    if (existingRes.rows.length === 0) {
      return errorResponse(res, 'Note not found', 404);
    }

    const currentNote = existingRes.rows[0];
    const {
      title = currentNote.title,
      content = currentNote.content,
      category = currentNote.category,
      tags = currentNote.tags,
      priority = currentNote.priority,
      reminder_at = currentNote.reminder_at,
      is_pinned = currentNote.is_pinned,
      is_archived = currentNote.is_archived,
    } = req.body;

    const updateSql = `
      UPDATE notes
      SET 
        title = $1,
        content = $2,
        category = $3,
        tags = $4,
        priority = $5,
        reminder_at = $6,
        is_pinned = $7,
        is_archived = $8,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9 AND user_id = $10
      RETURNING *;
    `;

    const values = [
      typeof title === 'string' ? title.trim() : currentNote.title,
      typeof content === 'string' ? content.trim() : currentNote.content,
      category,
      JSON.stringify(Array.isArray(tags) ? tags : currentNote.tags),
      priority,
      reminder_at !== undefined ? (reminder_at || null) : currentNote.reminder_at,
      is_pinned !== undefined ? Boolean(is_pinned) : currentNote.is_pinned,
      is_archived !== undefined ? Boolean(is_archived) : currentNote.is_archived,
      id,
      userId,
    ];

    const updateRes = await query(updateSql, values);
    const updatedNote = updateRes.rows[0];

    await logAudit({
      userId,
      action: 'UPDATE',
      entityType: 'NOTE',
      entityId: updatedNote.id,
      oldValues: currentNote,
      newValues: updatedNote,
    });

    return successResponse(res, updatedNote, 'Note updated successfully');
  } catch (error) {
    next(error);
  }
};

export const togglePin = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { is_pinned } = req.body;

    let updateSql;
    let values;

    if (is_pinned !== undefined) {
      updateSql = `
        UPDATE notes
        SET is_pinned = $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND user_id = $3
        RETURNING *;
      `;
      values = [Boolean(is_pinned), id, userId];
    } else {
      updateSql = `
        UPDATE notes
        SET is_pinned = NOT is_pinned, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2
        RETURNING *;
      `;
      values = [id, userId];
    }

    const result = await query(updateSql, values);

    if (result.rows.length === 0) {
      return errorResponse(res, 'Note not found', 404);
    }

    const note = result.rows[0];
    return successResponse(
      res,
      note,
      note.is_pinned ? 'Note pinned to top' : 'Note unpinned'
    );
  } catch (error) {
    next(error);
  }
};

export const toggleArchive = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;
    const { is_archived } = req.body;

    let updateSql;
    let values;

    if (is_archived !== undefined) {
      const willArchive = Boolean(is_archived);
      updateSql = `
        UPDATE notes
        SET 
          is_archived = $1,
          is_pinned = CASE WHEN $1 = TRUE THEN FALSE ELSE is_pinned END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND user_id = $3
        RETURNING *;
      `;
      values = [willArchive, id, userId];
    } else {
      updateSql = `
        UPDATE notes
        SET 
          is_archived = NOT is_archived,
          is_pinned = CASE WHEN is_archived = FALSE THEN FALSE ELSE is_pinned END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2
        RETURNING *;
      `;
      values = [id, userId];
    }

    const result = await query(updateSql, values);

    if (result.rows.length === 0) {
      return errorResponse(res, 'Note not found', 404);
    }

    const note = result.rows[0];
    return successResponse(
      res,
      note,
      note.is_archived ? 'Note moved to archive' : 'Note restored from archive'
    );
  } catch (error) {
    next(error);
  }
};

export const deleteNote = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await query(
      `DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING *;`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return errorResponse(res, 'Note not found', 404);
    }

    const deletedNote = result.rows[0];

    await logAudit({
      userId,
      action: 'DELETE',
      entityType: 'NOTE',
      entityId: deletedNote.id,
      oldValues: deletedNote,
    });

    return successResponse(res, { id: deletedNote.id }, 'Note deleted successfully');
  } catch (error) {
    next(error);
  }
};

export const getNotesSummary = async (req, res, next) => {
  try {
    const userId = req.user.id;

    const statsSql = `
      SELECT 
        COUNT(id) FILTER (WHERE is_archived = FALSE) as total_active,
        COUNT(id) FILTER (WHERE is_archived = FALSE AND is_pinned = TRUE) as total_pinned,
        COUNT(id) FILTER (WHERE is_archived = TRUE) as total_archived,
        COUNT(id) FILTER (WHERE reminder_at IS NOT NULL AND reminder_at > CURRENT_TIMESTAMP) as upcoming_reminders,
        COUNT(id) as total_all
      FROM notes
      WHERE user_id = $1;
    `;

    const catSql = `
      SELECT category, COUNT(id) as count
      FROM notes
      WHERE user_id = $1 AND is_archived = FALSE
      GROUP BY category;
    `;

    const prioSql = `
      SELECT priority, COUNT(id) as count
      FROM notes
      WHERE user_id = $1 AND is_archived = FALSE
      GROUP BY priority;
    `;

    const [statsRes, catRes, prioRes] = await Promise.all([
      query(statsSql, [userId]),
      query(catSql, [userId]),
      query(prioSql, [userId]),
    ]);

    const statsRow = statsRes.rows[0] || {};

    return successResponse(res, {
      totalNotes: parseInt(statsRow.total_active || 0, 10),
      pinnedNotes: parseInt(statsRow.total_pinned || 0, 10),
      archivedNotes: parseInt(statsRow.total_archived || 0, 10),
      upcomingReminders: parseInt(statsRow.upcoming_reminders || 0, 10),
      allNotes: parseInt(statsRow.total_all || 0, 10),
      byCategory: catRes.rows,
      byPriority: prioRes.rows,
    });
  } catch (error) {
    next(error);
  }
};
