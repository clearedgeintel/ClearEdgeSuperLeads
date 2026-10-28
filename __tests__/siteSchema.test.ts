// The sites / site_submissions / site_views definitions were adopted from the
// live database (drizzle-kit pull). Names here are the live ones; if Drizzle
// generated its own, a future push would drop and recreate constraints.

import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  sites,
  siteSubmissions,
  siteViews,
  insertSiteSchema,
  sitePhotoSchema,
} from '../shared/schema';

const columnsOf = (t: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(t)
    .columns.map((c) => c.name)
    .sort();

describe('sites table mirrors production', () => {
  const cfg = getTableConfig(sites);

  test('columns', () => {
    expect(columnsOf(sites)).toEqual(
      [
        'id',
        'slug',
        'business_name',
        'maps_url',
        'theme',
        'status',
        'data',
        'created_at',
        'updated_at',
        'workspace_id',
        'lead_id',
        'created_by',
        'deleted_at',
        // Phase 1 additive columns
        'custom_domain',
        'photos',
        'notify_email',
        'notify_phone',
        'published_at',
        'client_id',
      ].sort()
    );
  });

  test('keeps live constraint and index names', () => {
    expect(cfg.foreignKeys.map((fk) => fk.getName()).sort()).toEqual([
      'sites_lead_id_fkey',
      'sites_workspace_id_fkey',
    ]);
    expect(cfg.uniqueConstraints.map((u) => u.name)).toEqual(['sites_slug_key']);
    expect(cfg.indexes.map((i) => i.config.name).sort()).toEqual([
      'sites_created_at_idx',
      'sites_custom_domain_key',
      'sites_deleted_at_idx',
      'sites_lead_id_idx',
      'sites_workspace_id_idx',
    ]);
    expect(cfg.checks.map((c) => c.name)).toEqual(['sites_custom_domain_normalized']);
  });

  test('foreign keys set null on delete', () => {
    for (const fk of cfg.foreignKeys) expect(fk.onDelete).toBe('set null');
  });

  test('RLS stays enabled', () => {
    expect(cfg.enableRLS).toBe(true);
  });

  test('client_id is unconstrained until Phase 5', () => {
    const fkColumns = cfg.foreignKeys.flatMap((fk) => fk.reference().columns.map((c) => c.name));
    expect(fkColumns).not.toContain('client_id');
  });
});

describe.each([
  [
    'site_submissions',
    siteSubmissions,
    ['id', 'site_id', 'lead_id', 'workspace_id', 'name', 'email', 'phone', 'message', 'created_at', 'notified_at', 'notify_attempts'],
  ],
  ['site_views', siteViews, ['id', 'site_id', 'referrer', 'user_agent', 'created_at']],
] as const)('%s mirrors production', (name, table, columns) => {
  const cfg = getTableConfig(table);

  test('columns', () => {
    expect(columnsOf(table)).toEqual([...columns].sort());
  });

  test('cascades from sites under the live FK name', () => {
    expect(cfg.foreignKeys).toHaveLength(1);
    expect(cfg.foreignKeys[0].getName()).toBe(`${name}_site_id_fkey`);
    expect(cfg.foreignKeys[0].onDelete).toBe('cascade');
  });

  test('RLS stays enabled', () => {
    expect(cfg.enableRLS).toBe(true);
  });
});

describe('site zod schemas', () => {
  const base = { slug: 'acme-plumbing', businessName: 'Acme Plumbing', data: {} };

  test('accepts a minimal insert', () => {
    expect(insertSiteSchema.safeParse(base).success).toBe(true);
  });

  test('accepts valid photos', () => {
    const photos = [
      { url: 'https://example.com/hero.jpg', alt: 'Storefront', role: 'hero' },
      { url: 'https://example.com/1.jpg', alt: 'Work sample', role: 'gallery' },
    ];
    expect(insertSiteSchema.safeParse({ ...base, photos }).success).toBe(true);
  });

  test('rejects a photo with an unknown role', () => {
    const photos = [{ url: 'https://example.com/x.jpg', alt: 'x', role: 'banner' }];
    expect(insertSiteSchema.safeParse({ ...base, photos }).success).toBe(false);
  });

  test('rejects a photo without a valid url', () => {
    expect(sitePhotoSchema.safeParse({ url: 'not a url', alt: 'x', role: 'hero' }).success).toBe(
      false
    );
  });

  test('requires slug and business name', () => {
    expect(insertSiteSchema.safeParse({ data: {} }).success).toBe(false);
  });
});
