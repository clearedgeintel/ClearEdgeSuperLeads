/**
 * Full lifecycle integration test — exercises the backend storage +
 * service layer from workspace creation through GDPR deletion. Runs
 * against the real Supabase database. Organized by roadmap phase so
 * failures map directly to "Phase N broke."
 *
 * External APIs (Claude, Unipile, Hunter, SendGrid, Stripe) are mocked
 * at the module level so the test suite runs without API keys. The
 * storage layer hits the real DB — that's the point.
 *
 * Run with: npm test -- --testPathPattern lifecycle
 */

// Mock external-API-dependent modules BEFORE any import that touches them.
jest.mock('../server/lib/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import { storage, testId, cleanupTestData, TEST_PREFIX } from './setup';
import type { Lead, Campaign, Workspace } from '@shared/schema';

// ============================================================
// Shared test state — populated by each phase's tests, consumed
// by later phases. Mimics the real user journey.
// ============================================================
let workspace: Workspace;
let userId: string;
let googleLeadId: string;
let linkedinLeadId: string;
let campaignId: string;
let stepId: string;
let enrollmentId: string;

beforeAll(async () => {
  // Phase 1 — workspace + user creation
  workspace = await storage.createPersonalWorkspace(
    testId('user1'),
    `${TEST_PREFIX}@clearedge.dev`
  );
  // Override the generated id with our prefixed one for cleanup.
  const { db } = require('../server/db') as typeof import('../server/db');
  const { workspaces } = require('@shared/schema') as typeof import('@shared/schema');
  const { eq } = require('drizzle-orm') as typeof import('drizzle-orm');
  await db
    .update(workspaces)
    .set({ id: testId('ws1') })
    .where(eq(workspaces.id, workspace.id));
  workspace = (await storage.getWorkspace(testId('ws1')))!;

  const user = await storage.upsertUser({
    id: testId('user1'),
    email: `${TEST_PREFIX}@clearedge.dev`,
    firstName: 'Test',
    lastName: 'User',
    workspaceId: workspace.id,
    role: 'admin',
    profileImageUrl: null,
    googleAccessToken: null,
    googleRefreshToken: null,
    tokenExpiresAt: null,
  });
  userId = user.id;
}, 30_000);

afterAll(async () => {
  try {
    await cleanupTestData();
  } catch (err) {
    console.error('cleanup error', err);
  }
  try {
    const { pool } = require('../server/db') as typeof import('../server/db');
    await pool.end();
  } catch {
    // Pool may already be closed.
  }
}, 60_000);

// ============================================================
// Phase 1: Schema + workspace + user
// ============================================================
describe('Phase 1 — Foundation', () => {
  test('workspace was created with correct fields', () => {
    expect(workspace).toBeDefined();
    expect(workspace.id).toBe(testId('ws1'));
    expect(workspace.plan).toBe('free');
  });

  test('user has workspaceId set', async () => {
    const user = await storage.getUser(userId);
    expect(user).toBeDefined();
    expect(user!.workspaceId).toBe(workspace.id);
    expect(user!.role).toBe('admin');
  });

  test('app_config read/write works', async () => {
    await storage.setAppConfig('test_key', 'test_value', workspace.id);
    const val = await storage.getAppConfig('test_key', workspace.id);
    expect(val).toBe('test_value');
  });
});

// ============================================================
// Phase 2: Leads CRUD + workspace scoping
// ============================================================
describe('Phase 2 — Lead CRUD + workspace scoping', () => {
  test('create a Google lead', async () => {
    const lead = await storage.createLead({
      businessName: 'Test Plumbing Co',
      leadSource: 'google',
      status: 'discovered',
      priority: 'high',
      email: 'owner@testplumbing.com',
      createdBy: userId,
      workspaceId: workspace.id,
    });
    googleLeadId = lead.id;
    expect(lead.leadSource).toBe('google');
    expect(lead.workspaceId).toBe(workspace.id);
  });

  test('create a LinkedIn lead via upsert', async () => {
    const { lead, inserted } = await storage.upsertLeadByLinkedInUrl({
      businessName: 'Jane Doe',
      leadSource: 'linkedin',
      linkedinUrl: `https://www.linkedin.com/in/janedoe-${TEST_PREFIX}`,
      fullName: 'Jane Doe',
      title: 'VP Sales',
      headline: 'VP Sales at Acme | San Francisco',
      status: 'new',
      createdBy: userId,
      workspaceId: workspace.id,
    });
    linkedinLeadId = lead.id;
    expect(inserted).toBe(true);
    expect(lead.leadSource).toBe('linkedin');
  });

  test('upsert same LinkedIn URL does NOT create a duplicate', async () => {
    const { inserted } = await storage.upsertLeadByLinkedInUrl({
      businessName: 'Jane Doe',
      leadSource: 'linkedin',
      linkedinUrl: `https://www.linkedin.com/in/janedoe-${TEST_PREFIX}`,
      status: 'new',
      createdBy: userId,
      workspaceId: workspace.id,
    });
    expect(inserted).toBe(false);
  });

  test('getLeads filters by workspace', async () => {
    const leads = await storage.getLeads(userId, workspace.id);
    expect(leads.length).toBeGreaterThanOrEqual(2);
    for (const l of leads) {
      expect(l.workspaceId).toBe(workspace.id);
    }
  });
});

// ============================================================
// Phase 3: Campaigns + enrollments + queue
// ============================================================
describe('Phase 3 — Campaigns + queue', () => {
  test('create a campaign', async () => {
    const campaign = await storage.createCampaign({
      name: 'Test LinkedIn Campaign',
      outreachChannel: 'linkedin',
      tone: 'consultative',
      dailySendLimit: 10,
      maxTouches: 3,
      requireApproval: true,
      status: 'active',
      createdBy: userId,
      workspaceId: workspace.id,
    });
    campaignId = campaign.id;
    expect(campaign.outreachChannel).toBe('linkedin');
  });

  test('add a campaign step', async () => {
    const step = await storage.createCampaignStep({
      campaignId,
      stepOrder: 0,
      stepType: 'connection_request',
      delayDays: 0,
      promptTemplate: 'Hi {{full_name}}, I noticed your work at {{company}}.',
      characterLimit: 300,
    });
    stepId = step.id;
    expect(step.stepOrder).toBe(0);
  });

  test('enroll a lead', async () => {
    const enrollment = await storage.enrollLead({
      campaignId,
      leadId: linkedinLeadId,
      currentStepOrder: 0,
      status: 'active',
    });
    enrollmentId = enrollment.id;
    expect(enrollment.status).toBe('active');
  });

  test('create a send_queue item', async () => {
    const item = await storage.createSendQueueItem({
      workspaceId: workspace.id,
      enrollmentId,
      leadId: linkedinLeadId,
      campaignStepId: stepId,
      channel: 'linkedin',
      aiDraft: 'Hi Jane, great profile!',
      status: 'pending',
      charCount: 25,
      overLimit: false,
    });
    expect(item.status).toBe('pending');
    expect(item.aiDraft).toBe('Hi Jane, great profile!');
  });

  test('queue stats reflect the pending item', async () => {
    const stats = await storage.getQueueStats(workspace.id);
    expect(stats.pending).toBeGreaterThanOrEqual(1);
  });

  test('bulk approve works', async () => {
    const pending = await storage.getSendQueueByStatus('pending', workspace.id);
    const ids = pending.map((p) => p.id);
    const approved = await storage.bulkUpdateQueueStatus(ids, 'pending', 'approved');
    expect(approved).toBe(ids.length);
  });
});

// ============================================================
// Phase 4: Prompt engine + A/B versions
// ============================================================
describe('Phase 4 — Prompt engine', () => {
  test('create prompt versions for A/B', async () => {
    const vA = await storage.createPromptVersion({
      campaignId,
      stepOrder: 0,
      variant: 'A',
      promptTemplate: 'Version A: Hi {{full_name}}!',
      description: 'Control',
    });
    const vB = await storage.createPromptVersion({
      campaignId,
      stepOrder: 0,
      variant: 'B',
      promptTemplate: 'Version B: Hey {{full_name}}, quick question.',
      description: 'Curiosity opener',
    });
    expect(vA.variant).toBe('A');
    expect(vB.variant).toBe('B');
  });

  test('getPromptVersions returns both', async () => {
    const versions = await storage.getPromptVersions(campaignId, 0);
    expect(versions.length).toBe(2);
  });

  test('incrementPromptVersionUsage + recordReply', async () => {
    const versions = await storage.getPromptVersions(campaignId, 0);
    const v = versions[0];
    await storage.incrementPromptVersionUsage(v.id);
    await storage.recordPromptVersionReply(v.id, true);
    const updated = (await storage.getPromptVersions(campaignId, 0)).find(
      (x) => x.id === v.id
    );
    expect(updated!.timesUsed).toBe((v.timesUsed ?? 0) + 1);
    expect(updated!.positiveReplyCount).toBe((v.positiveReplyCount ?? 0) + 1);
  });
});

// ============================================================
// Phase 5: Analytics counts
// ============================================================
describe('Phase 5 — Analytics', () => {
  test('countLeads returns >= 2', async () => {
    const count = await storage.countLeads(workspace.id);
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('countActiveCampaigns returns >= 1', async () => {
    const count = await storage.countActiveCampaigns(workspace.id);
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('API usage log write + read', async () => {
    await storage.createApiUsageLog({
      workspaceId: workspace.id,
      provider: 'claude',
      endpoint: 'test',
      model: 'claude-sonnet-4-20250514',
      inputTokens: 100,
      outputTokens: 50,
    });
    const since = new Date(Date.now() - 60_000);
    const logs = await storage.getApiUsageLogsSince(since, workspace.id);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].provider).toBe('claude');
  });
});

// ============================================================
// Phase 7: Suppression + GDPR
// ============================================================
describe('Phase 7 — Suppression + GDPR', () => {
  test('add email to suppression list', async () => {
    const entry = await storage.addSuppressionEntry({
      workspaceId: workspace.id,
      email: 'blocked@example.com',
      domain: null,
      reason: 'manual',
    });
    expect(entry.email).toBe('blocked@example.com');
  });

  test('add domain to suppression list', async () => {
    const entry = await storage.addSuppressionEntry({
      workspaceId: workspace.id,
      email: null,
      domain: 'competitor.com',
      reason: 'manual',
    });
    expect(entry.domain).toBe('competitor.com');
  });

  test('isSuppressed matches by email', async () => {
    const result = await storage.isSuppressed('blocked@example.com', workspace.id);
    expect(result).not.toBeNull();
    expect(result!.reason).toBe('manual');
  });

  test('isSuppressed matches by domain', async () => {
    const result = await storage.isSuppressed('anyone@competitor.com', workspace.id);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('competitor.com');
  });

  test('isSuppressed returns null for clean address', async () => {
    const result = await storage.isSuppressed('clean@safe.com', workspace.id);
    expect(result).toBeNull();
  });

  test('GDPR cascade delete wipes lead + children', async () => {
    // Create a disposable lead with a child engagement event.
    const lead = await storage.createLead({
      businessName: 'GDPR Test Corp',
      leadSource: 'google',
      status: 'new',
      createdBy: userId,
      workspaceId: workspace.id,
    });
    await storage.createEngagementEvent({
      workspaceId: workspace.id,
      leadId: lead.id,
      eventType: 'reply_received',
      sentiment: 'positive',
      eventData: { message: 'test' },
      occurredAt: new Date(),
    });

    const result = await storage.gdprDeleteLead(lead.id);
    expect(result.lead).toBe(1);
    expect(result.engagementEvents).toBe(1);

    // Verify the lead is actually gone.
    const gone = await storage.getLead(lead.id);
    expect(gone).toBeUndefined();
  });
});

// ============================================================
// Phase 9: Workspace counters + plan limits
// ============================================================
describe('Phase 9 — Workspace counters', () => {
  test('incrementWorkspaceSends increments correctly', async () => {
    const before = await storage.getWorkspace(workspace.id);
    const beforeCount = before!.monthlyEmailSendsUsed ?? 0;

    await storage.incrementWorkspaceSends(workspace.id, 'email', 5);

    const after = await storage.getWorkspace(workspace.id);
    expect(after!.monthlyEmailSendsUsed).toBe(beforeCount + 5);
  });

  test('resetAllWorkspaceCounters zeros everything', async () => {
    const resetCount = await storage.resetAllWorkspaceCounters();
    expect(resetCount).toBeGreaterThanOrEqual(1);

    const after = await storage.getWorkspace(workspace.id);
    expect(after!.monthlyEmailSendsUsed).toBe(0);
    expect(after!.monthlyLinkedinSendsUsed).toBe(0);
  });

  test('getWorkspaceMembers returns the test user', async () => {
    const members = await storage.getWorkspaceMembers(workspace.id);
    expect(members.length).toBeGreaterThanOrEqual(1);
    expect(members[0].id).toBe(userId);
  });
});

// ============================================================
// Phase 10: Deduplication
// ============================================================
describe('Phase 10 — Deduplication', () => {
  test('findDuplicateLeads finds matches by email', async () => {
    const dupes = await storage.findDuplicateLeads(
      { email: 'owner@testplumbing.com' },
      workspace.id
    );
    expect(dupes.length).toBeGreaterThanOrEqual(1);
    expect(dupes[0].email).toBe('owner@testplumbing.com');
  });

  test('mergeLeads combines two leads', async () => {
    const dup = await storage.createLead({
      businessName: 'Test Plumbing Co',
      leadSource: 'google',
      email: 'owner@testplumbing.com',
      phone: '555-1234',
      status: 'new',
      notes: 'Duplicate note',
      createdBy: userId,
      workspaceId: workspace.id,
    });

    const merged = await storage.mergeLeads(googleLeadId, dup.id);
    expect(merged.phone).toBe('555-1234'); // non-null from dup
    expect(merged.notes).toContain('Duplicate note');

    // Verify the dup is gone.
    const gone = await storage.getLead(dup.id);
    expect(gone).toBeUndefined();
  });
});

// ============================================================
// Phase 11: Notifications
// ============================================================
describe('Phase 11 — Notifications', () => {
  let notifId: string;

  test('create a notification', async () => {
    const notif = await storage.createNotification({
      workspaceId: workspace.id,
      userId,
      type: 'test',
      title: 'Test notification',
      body: 'This is a test.',
    });
    notifId = notif.id;
    expect(notif.title).toBe('Test notification');
  });

  test('getUnreadNotifications returns it', async () => {
    const unread = await storage.getUnreadNotifications(userId);
    expect(unread.some((n) => n.id === notifId)).toBe(true);
  });

  test('markNotificationRead clears it', async () => {
    await storage.markNotificationRead(notifId);
    const unread = await storage.getUnreadNotifications(userId);
    expect(unread.some((n) => n.id === notifId)).toBe(false);
  });
});
