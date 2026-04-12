// Shared test setup. Loads .env so DATABASE_URL is available, then
// provides helpers for creating + cleaning up test fixtures. Every
// integration test imports from here instead of duplicating setup.
//
// IMPORTANT: This runs against the REAL Supabase database. Test data
// uses a unique workspace prefix so it doesn't collide with operator
// data, and the afterAll cleanup deletes everything with that prefix.
// Still — don't run against a production DB with real customer data.

import dotenv from 'dotenv';
dotenv.config();

// Re-export storage after .env is loaded (db.ts throws if DATABASE_URL
// is missing, so dotenv.config() MUST run before this import).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { storage } = require('../server/storage') as typeof import('../server/storage');
export { storage };

export const TEST_PREFIX = `test_${Date.now()}_`;

export function testId(suffix: string): string {
  return `${TEST_PREFIX}${suffix}`;
}

/** Clean up all test data created with the TEST_PREFIX. */
export async function cleanupTestData(): Promise<void> {
  const { db } = require('../server/db') as typeof import('../server/db');
  const { sql } = require('drizzle-orm') as typeof import('drizzle-orm');

  // Delete in dependency order (children first).
  const tables = [
    'send_queue',
    'send_log',
    'engagement_events',
    'outreach_emails',
    'campaign_enrollments',
    'campaign_steps',
    'prompt_versions',
    'knowledge_base',
    'campaigns',
    'gbp_profiles',
    'suppression_list',
    'audit_log',
    'notifications',
    'api_usage_log',
    'voc_insights',
    'unipile_accounts',
    'app_config',
    'leads',
    'users',
    'workspaces',
  ];

  for (const table of tables) {
    try {
      await db.execute(
        sql.raw(`DELETE FROM "${table}" WHERE id LIKE '${TEST_PREFIX}%' OR workspace_id LIKE '${TEST_PREFIX}%'`)
      );
    } catch {
      // Some tables may not have the right columns — skip silently.
    }
  }
}
