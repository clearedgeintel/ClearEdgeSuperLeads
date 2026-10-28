// The public site server must stay independent of the admin app: no sessions,
// routes.ts, scheduler, queues or outreach services, directly or transitively.
// Bundles server/public.ts with esbuild and checks every module that lands in it.

import { build } from 'esbuild';
import path from 'path';

const root = path.join(__dirname, '..', '..');

// Every first-party module the public bundle may contain.
const ALLOWED = [
  /^server\/public\.ts$/,
  /^server\/db\.ts$/,
  /^server\/sites\/(?!routes\.ts$|service\.ts$|generator\.ts$|enrich\/|photos\.ts$)[\w/.-]+\.ts$/,
  /^server\/services\/emailService\.ts$/,
  /^server\/lib\/(logger|signedToken)\.ts$/,
  // emailService's own dependencies (suppression/plan bookkeeping, no sending of outreach):
  /^server\/storage\.ts$/,
  /^server\/lib\/(unsubscribe|planLimits|eventEmitter)\.ts$/,
  /^shared\/(schema|sites|plans)\.ts$/,
];

// Packages that would mean admin-app machinery leaked in.
const FORBIDDEN_PACKAGES = ['express-session', 'connect-pg-simple', 'memorystore', 'node-cron', 'passport', 'multer'];

let inputs: string[] = [];
let externals: string[] = [];

beforeAll(async () => {
  const result = await build({
    entryPoints: [path.join(root, 'server/public.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    write: false,
    metafile: true,
    logLevel: 'silent',
    absWorkingDir: root,
    tsconfig: path.join(root, 'tsconfig.json'),
  });
  inputs = Object.keys(result.metafile!.inputs).map((p) => p.replace(/\\/g, '/'));
  externals = Object.values(result.metafile!.outputs).flatMap((o) =>
    o.imports.filter((i) => i.external).map((i) => i.path)
  );
}, 60_000);

test('bundles only allowed first-party modules', () => {
  expect(inputs.length).toBeGreaterThan(5);
  const unexpected = inputs.filter((p) => !ALLOWED.some((re) => re.test(p)));
  expect(unexpected).toEqual([]);
});

test.each([
  'server/routes.ts',
  'server/index.ts',
  'server/fallbackAuth.ts',
  'server/jobs/scheduler.ts',
  'server/services/queueGenerationService.ts',
  'server/services/unipileDispatchService.ts',
  'server/services/instantSiteService.ts',
  'server/sites/routes.ts',
  'server/sites/enrich/webSearch.ts',
])('does not include %s', (mod) => {
  expect(inputs).not.toContain(mod);
});

test('pulls in no session, cron or upload packages', () => {
  for (const pkg of FORBIDDEN_PACKAGES) {
    expect(externals.filter((e) => e === pkg || e.startsWith(`${pkg}/`))).toEqual([]);
  }
});
