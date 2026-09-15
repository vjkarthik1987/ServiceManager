#!/usr/bin/env node
import process from 'node:process';
import { resolveMongoTarget, redactMongoUri, printDiscoveryError } from '../lib/v23-db-discovery.mjs';

function valueArg(name) {
  const p = `${name}=`;
  const v = process.argv.slice(2).find((x) => x.startsWith(p));
  return v ? v.slice(p.length) : '';
}

let mongoose;
try {
  const imported = await import('mongoose');
  mongoose = imported.default || imported;
} catch (error) {
  console.error(`v23 preflight failed: mongoose is not installed (${error.message}). Run npm install first.`);
  process.exit(1);
}

console.log('Service Manager v23 — PRE-FLIGHT');
console.log('No database writes are performed.');
console.log('Hard guard: normal/non-SaaS Incident Management is outside SUNTEC_SAAS_V23.');

try {
  const target = await resolveMongoTarget({ mongoose, root: process.cwd(), explicitUri: valueArg('--mongo-uri'), requireNonEmpty: true });
  console.log(`MongoDB: ${redactMongoUri(target.uri)}`);
  console.log(`Database: ${target.dbName}`);
  console.log(`Collections: ${target.collections.length}`);
  console.log('PRE-FLIGHT PASSED');
  console.log('Next: npm.cmd run v23:dry');
} catch (error) {
  printDiscoveryError(error, console.error);
  console.error('PRE-FLIGHT BLOCKED — do not run database apply.');
  process.exitCode = 2;
}
