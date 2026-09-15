import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { configuredMongoCandidates, redactMongoUri } from '../lib/v23-db-discovery.mjs';

test('Mongo URI redaction hides credentials', () => {
  const value = redactMongoUri('mongodb://user:secret@127.0.0.1:27017/service_desk');
  assert.equal(value.includes('secret'), false);
  assert.equal(value.includes('user'), false);
  assert.equal(value.includes('service_desk'), true);
});

test('database discovery reads MONGO_URI from project .env without guessing names', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v23-db-'));
  try {
    fs.writeFileSync(path.join(dir, '.env'), 'MONGO_URI=mongodb://127.0.0.1:27017/actual_service_db\n');
    const old = process.env.MONGO_URI;
    delete process.env.MONGO_URI;
    try {
      const rows = configuredMongoCandidates(dir, '');
      assert.equal(rows.some((row) => row.uri.endsWith('/actual_service_db')), true);
      assert.equal(rows.some((row) => row.uri.endsWith('/service_desk_v21')), false);
    } finally {
      if (old === undefined) delete process.env.MONGO_URI; else process.env.MONGO_URI = old;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('explicit Mongo URI is kept as a candidate', () => {
  const rows = configuredMongoCandidates(process.cwd(), 'mongodb://127.0.0.1:27017/explicit_v23_test');
  assert.equal(rows[0].uri, 'mongodb://127.0.0.1:27017/explicit_v23_test');
});
