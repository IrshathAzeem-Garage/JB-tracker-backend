import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import http from 'node:http';
import app from '../src/app.js';
import { query } from '../src/config/db.js';
import { env } from '../src/config/env.js';

describe('JB Tracker - Notes REST API End-to-End Tests', () => {
  let server;
  let baseUrl;
  let userA;
  let userB;
  let tokenA;
  let tokenB;
  let createdNoteId;

  before(async () => {
    // Start express app on dynamic test port
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}/api`;
        resolve();
      });
    });

    const usersRes = await query('SELECT id, name, email, role FROM users LIMIT 2;');
    userA = usersRes.rows[0];
    userB = usersRes.rows[1];

    tokenA = jwt.sign({ userId: userA.id, role: userA.role }, env.JWT_SECRET, { expiresIn: '1h' });
    tokenB = jwt.sign({ userId: userB.id, role: userB.role }, env.JWT_SECRET, { expiresIn: '1h' });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await query("DELETE FROM notes WHERE title LIKE 'E2E_%';");
  });

  test('E2E-1: Reject unauthenticated requests with 401', async () => {
    const res = await fetch(`${baseUrl}/notes`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  test('E2E-2: Reject invalid payload validation (missing title and content)', async () => {
    const res = await fetch(`${baseUrl}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ category: 'General' }),
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.success, false);
  });

  test('E2E-3: User A creates note successfully via POST /api/notes', async () => {
    const res = await fetch(`${baseUrl}/notes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({
        title: 'E2E_NOTE_MEETING_MINUTES',
        content: '# Meeting with Apparel Supplier\n- [ ] Finalize fabric GSM\n- [ ] Request sample batch',
        category: 'Meetings',
        priority: 'High',
        tags: ['supplier', 'cotton', 'negotiation'],
        is_pinned: true,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(body.data.id);
    createdNoteId = body.data.id;
    assert.equal(body.data.title, 'E2E_NOTE_MEETING_MINUTES');
    assert.equal(body.data.category, 'Meetings');
    assert.equal(body.data.is_pinned, true);
    assert.equal(body.data.user_id, userA.id);
  });

  test('E2E-4: Strict Isolation: User B receives empty list, cannot see User A note', async () => {
    const resB = await fetch(`${baseUrl}/notes`, {
      headers: { Authorization: `Bearer ${tokenB}` },
    });
    assert.equal(resB.status, 200);
    const bodyB = await resB.json();
    assert.equal(bodyB.success, true);
    const foundInB = bodyB.data.notes.find((n) => n.id === createdNoteId);
    assert.equal(foundInB, undefined, 'User B must not see User A note');
  });

  test('E2E-5: Search and filter notes for User A', async () => {
    // Search by keyword
    const resSearch = await fetch(`${baseUrl}/notes?search=apparel`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const bodySearch = await resSearch.json();
    assert.equal(bodySearch.success, true);
    assert.ok(bodySearch.data.notes.some((n) => n.id === createdNoteId));

    // Filter by category
    const resCat = await fetch(`${baseUrl}/notes?category=Meetings`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const bodyCat = await resCat.json();
    assert.equal(bodyCat.success, true);
    assert.ok(bodyCat.data.notes.some((n) => n.id === createdNoteId));
  });

  test('E2E-6: Pin toggle via PATCH /api/notes/:id/pin', async () => {
    const res = await fetch(`${baseUrl}/notes/${createdNoteId}/pin`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ is_pinned: false }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.is_pinned, false);
  });

  test('E2E-7: Archive toggle via PATCH /api/notes/:id/archive', async () => {
    const res = await fetch(`${baseUrl}/notes/${createdNoteId}/archive`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenA}`,
      },
      body: JSON.stringify({ is_archived: true }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.data.is_archived, true);

    // Active list should no longer include it
    const activeRes = await fetch(`${baseUrl}/notes`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const activeBody = await activeRes.json();
    assert.ok(!activeBody.data.notes.some((n) => n.id === createdNoteId));

    // Archived list should include it
    const archivedRes = await fetch(`${baseUrl}/notes?isArchived=true`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    const archivedBody = await archivedRes.json();
    assert.ok(archivedBody.data.notes.some((n) => n.id === createdNoteId));
  });

  test('E2E-8: Summary endpoint GET /api/notes/summary', async () => {
    const res = await fetch(`${baseUrl}/notes/summary`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.ok(typeof body.data.totalNotes === 'number');
    assert.ok(typeof body.data.pinnedNotes === 'number');
    assert.ok(typeof body.data.archivedNotes === 'number');
    assert.ok(Array.isArray(body.data.byCategory));
  });

  test('E2E-9: Delete note via DELETE /api/notes/:id', async () => {
    const res = await fetch(`${baseUrl}/notes/${createdNoteId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);

    // Confirm it's gone
    const checkRes = await fetch(`${baseUrl}/notes/${createdNoteId}`, {
      headers: { Authorization: `Bearer ${tokenA}` },
    });
    assert.equal(checkRes.status, 404);
  });
});
