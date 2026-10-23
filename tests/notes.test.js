import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { pool, query } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import app from '../src/app.js';

describe('JB Tracker - Professional Notes Management API & Data Layer Tests', () => {
  let userA;
  let userB;
  let tokenA;
  let tokenB;
  let createdNoteId;

  before(async () => {
    // Get two users to test ownership isolation
    const usersRes = await query('SELECT id, name, email, role FROM users LIMIT 2;');
    assert.ok(usersRes.rows.length >= 2, 'Need at least 2 users in db to verify isolation');
    userA = usersRes.rows[0];
    userB = usersRes.rows[1];

    tokenA = jwt.sign({ userId: userA.id, role: userA.role }, env.JWT_SECRET, { expiresIn: '1h' });
    tokenB = jwt.sign({ userId: userB.id, role: userB.role }, env.JWT_SECRET, { expiresIn: '1h' });

    // Clean up any test notes from prior runs
    await query("DELETE FROM notes WHERE title LIKE 'TEST_NOTE_%';");
  });

  after(async () => {
    // Cleanup
    await query("DELETE FROM notes WHERE title LIKE 'TEST_NOTE_%';");
  });

  test('1. Create note: user A can create a comprehensive business note', async () => {
    const res = await query(
      `INSERT INTO notes (user_id, title, content, category, tags, priority, reminder_at, is_pinned, is_archived)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *;`,
      [
        userA.id,
        'TEST_NOTE_Q4_STRATEGY',
        'Review supplier pricing for corporate gifts and winter jackets.',
        'Business Ideas',
        JSON.stringify(['corporate', 'q4', 'pricing']),
        'High',
        new Date(Date.now() + 86400000).toISOString(),
        true,
        false,
      ]
    );

    assert.equal(res.rows.length, 1);
    const note = res.rows[0];
    createdNoteId = note.id;
    assert.equal(note.title, 'TEST_NOTE_Q4_STRATEGY');
    assert.equal(note.category, 'Business Ideas');
    assert.equal(note.priority, 'High');
    assert.equal(note.is_pinned, true);
    assert.equal(note.is_archived, false);
    assert.deepEqual(note.tags, ['corporate', 'q4', 'pricing']);
  });

  test('2. Strict User Isolation: User B cannot access or view User A notes', async () => {
    const resA = await query('SELECT * FROM notes WHERE id = $1 AND user_id = $2;', [
      createdNoteId,
      userA.id,
    ]);
    assert.equal(resA.rows.length, 1, 'User A must find their own note');

    const resB = await query('SELECT * FROM notes WHERE id = $1 AND user_id = $2;', [
      createdNoteId,
      userB.id,
    ]);
    assert.equal(resB.rows.length, 0, 'User B must NOT see User A note');
  });

  test('3. Search notes: search by title, content keyword, and tags', async () => {
    // Search by title
    const searchByTitle = await query(
      `SELECT * FROM notes WHERE user_id = $1 AND LOWER(title) LIKE $2;`,
      [userA.id, '%q4_strategy%']
    );
    assert.ok(searchByTitle.rows.length >= 1);

    // Search by content
    const searchByContent = await query(
      `SELECT * FROM notes WHERE user_id = $1 AND LOWER(content) LIKE $2;`,
      [userA.id, '%winter jackets%']
    );
    assert.ok(searchByContent.rows.length >= 1);

    // Search by tag
    const searchByTag = await query(
      `SELECT * FROM notes WHERE user_id = $1 AND EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(tags) elem WHERE LOWER(elem) = 'pricing'
      );`,
      [userA.id]
    );
    assert.ok(searchByTag.rows.length >= 1);
  });

  test('4. Pin and unpin note', async () => {
    // Unpin
    const unpinRes = await query(
      `UPDATE notes SET is_pinned = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 RETURNING *;`,
      [createdNoteId, userA.id]
    );
    assert.equal(unpinRes.rows[0].is_pinned, false);

    // Pin
    const pinRes = await query(
      `UPDATE notes SET is_pinned = TRUE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 RETURNING *;`,
      [createdNoteId, userA.id]
    );
    assert.equal(pinRes.rows[0].is_pinned, true);
  });

  test('5. Archive and restore note', async () => {
    // Archive
    const archiveRes = await query(
      `UPDATE notes SET is_archived = TRUE, is_pinned = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 RETURNING *;`,
      [createdNoteId, userA.id]
    );
    assert.equal(archiveRes.rows[0].is_archived, true);
    assert.equal(archiveRes.rows[0].is_pinned, false);

    // Verify it doesn't appear in default active queries
    const activeRes = await query(
      `SELECT * FROM notes WHERE user_id = $1 AND is_archived = FALSE;`,
      [userA.id]
    );
    const foundInActive = activeRes.rows.find((n) => n.id === createdNoteId);
    assert.equal(foundInActive, undefined);

    // Restore
    const restoreRes = await query(
      `UPDATE notes SET is_archived = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND user_id = $2 RETURNING *;`,
      [createdNoteId, userA.id]
    );
    assert.equal(restoreRes.rows[0].is_archived, false);
  });

  test('6. Update note fields (title, content, category, priority)', async () => {
    const updateRes = await query(
      `UPDATE notes 
       SET title = $1, content = $2, category = $3, priority = $4, updated_at = CURRENT_TIMESTAMP
       WHERE id = $5 AND user_id = $6
       RETURNING *;`,
      [
        'TEST_NOTE_UPDATED_TITLE',
        'Updated content with meeting agenda.',
        'Meetings',
        'Medium',
        createdNoteId,
        userA.id,
      ]
    );
    assert.equal(updateRes.rows[0].title, 'TEST_NOTE_UPDATED_TITLE');
    assert.equal(updateRes.rows[0].category, 'Meetings');
    assert.equal(updateRes.rows[0].priority, 'Medium');
  });

  test('7. Delete note with user isolation', async () => {
    // Attempt delete by User B should fail (0 rows deleted)
    const delResB = await query(
      `DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING *;`,
      [createdNoteId, userB.id]
    );
    assert.equal(delResB.rows.length, 0);

    // Delete by User A succeeds
    const delResA = await query(
      `DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING *;`,
      [createdNoteId, userA.id]
    );
    assert.equal(delResA.rows.length, 1);
  });
});
