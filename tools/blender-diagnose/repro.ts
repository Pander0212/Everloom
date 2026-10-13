/**
 * Reproduces a .blend import exactly as the server does it, and compares the result with Blender's
 * own data. For each file:
 *   1. inspect_blend.py records the ground truth (truth.json);
 *   2. the server's worker.py runs `convert` with the server's arguments and time limit (log, result);
 *   3. the server's inspectModel reads the GLB (what the app stores: bone map, roles, warnings);
 *   4. joints are compared with Blender's bones: names, parents and rest positions.
 *
 *   npx tsx tools/blender-diagnose/repro.ts --blender <blender.exe> --out <dir> file.blend…
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGlb } from '../../apps/server/src/services/avatars/glb.js';
import { inspectModel, nodeParents, worldMatrices } from '../../apps/server/src/services/avatars/inspect.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const worker = path.join(root, 'apps/server/src/blender/worker.py');
const inspector = path.join(here, 'inspect_blend.py');

const argv = process.argv.slice(2);
const opt = (k: string) => {
  const i = argv.indexOf(k);
  if (i < 0) return null;
  const v = argv[i + 1]!;
  argv.splice(i, 2);
  return v;
};
const blender = opt('--blender') ?? process.env.EVERLOOM_BLENDER ?? 'blender';
const outRoot = path.resolve(opt('--out') ?? 'blend-repro');
const timeoutMs = Number(opt('--timeout') ?? 8 * 60_000);
const files = argv;

interface Truth {
  savedWith: string;
  armatures: Array<{ object: string; bonesList: Array<{ name: string; parent: string | null; head: number[]; deform: boolean }> }>;
  objects: Array<{ name: string; worldMatrix: number[][] }>;
  summary: Record<string, number>;
}

function blenderRun(args: string[], cwd: string, timeout: number) {
  const t0 = Date.now();
  const r = spawnSync(blender, ['--background', '--factory-startup', '--disable-autoexec', '--python-exit-code', '3', ...args], { cwd, timeout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { code: r.status, signal: r.signal, ms: Date.now() - t0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`, timedOut: r.error?.message.includes('ETIMEDOUT') ?? false };
}

const toYUp = (v: number[]) => [v[0]!, v[2]!, -v[1]!];
const mul = (m: number[][], v: number[]) => [0, 1, 2].map((i) => m[i]![0]! * v[0]! + m[i]![1]! * v[1]! + m[i]![2]! * v[2]! + m[i]![3]!);

async function one(file: string) {
  const name = path.basename(file).replace(/\.blend1?$/i, '');
  const dir = path.join(outRoot, name.replace(/[^\w.-]+/g, '_'));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const report: Record<string, unknown> = { file: path.basename(file) };

  // 1. Ground truth.
  const truthPath = path.join(dir, 'truth.json');
  const ins = blenderRun(['--python', inspector, '--', path.resolve(file), truthPath], dir, 15 * 60_000);
  writeFileSync(path.join(dir, 'inspect.log'), ins.out);
  const truth: Truth | null = existsSync(truthPath) ? JSON.parse(readFileSync(truthPath, 'utf8')) : null;
  report.inspect = { code: ins.code, ms: ins.ms, ok: !!truth };
  if (truth) report.truth = { savedWith: truth.savedWith, ...truth.summary };

  // 2. The server's conversion, same arguments, same job layout.
  const job = path.join(dir, 'job');
  mkdirSync(job, { recursive: true });
  copyFileSync(file, path.join(job, 'input.blend'));
  writeFileSync(path.join(job, 'job.json'), JSON.stringify({ op: 'convert', input: 'input.blend', output: 'output.glb' }));
  const conv = blenderRun(['--python', worker, '--', path.join(job, 'job.json')], job, timeoutMs);
  writeFileSync(path.join(dir, 'convert.log'), conv.out);
  const result = existsSync(path.join(job, 'result.json')) ? JSON.parse(readFileSync(path.join(job, 'result.json'), 'utf8')) : null;
  report.convert = { code: conv.code, ms: conv.ms, timedOut: conv.timedOut || conv.signal === 'SIGTERM', result };
  const glbPath = path.join(job, 'output.glb');
  rmSync(path.join(job, 'input.blend'), { force: true });
  if (!result?.ok || !existsSync(glbPath)) {
    writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1));
    return report;
  }
  const glb = readFileSync(glbPath);
  report.glbBytes = glb.length;

  // 3. What the app makes of it.
  try {
    const info = await inspectModel(glb);
    const roles: Record<string, number> = {};
    for (const c of info.rig.roles ?? []) roles[c.role] = (roles[c.role] ?? 0) + 1;
    report.app = {
      joints: info.joints, triangles: info.triangles, height: +info.height.toFixed(3), unitScale: info.unitScale,
      boneMap: info.boneMap, missingBones: info.missingBones, roles, spine: info.rig.spine, ignored: info.rig.ignore?.length ?? 0,
      review: info.rigReview.length, morphs: info.morphs.length, faceRig: info.faceRig, animations: info.animations,
      warnings: info.warnings.map((w) => `${w.level}:${w.code}: ${w.message}`),
    };
  } catch (e) {
    report.app = { error: (e as Error).message };
  }

  // 4. Joints against Blender's bones.
  if (truth) {
    const { json } = parseGlb(glb);
    const nodes = json.nodes ?? [];
    const world = worldMatrices(json);
    const parent = nodeParents(json);
    const jointIdx = new Set((json.skins ?? []).flatMap((s) => s.joints));
    const byName = new Map<string, number>();
    nodes.forEach((n, i) => n.name && byName.set(n.name, i));
    let compared = 0;
    let missing: string[] = [];
    let parentMismatch: string[] = [];
    let worst = 0;
    let worstBone = '';
    const errs: number[] = [];
    for (const a of truth.armatures) {
      const aw = truth.objects.find((o) => o.name === a.object)?.worldMatrix;
      if (!aw) continue;
      for (const b of a.bonesList) {
        const i = byName.get(b.name);
        if (i === undefined || !jointIdx.has(i)) {
          if (b.deform) missing.push(b.name);
          continue;
        }
        compared++;
        const want = toYUp(mul(aw, b.head));
        const m = world[i]!;
        const got = [m[12]!, m[13]!, m[14]!];
        const d = Math.hypot(want[0]! - got[0]!, want[1]! - got[1]!, want[2]! - got[2]!);
        errs.push(d);
        if (d > worst) [worst, worstBone] = [d, b.name];
        let p = parent[i]!;
        while (p >= 0 && !jointIdx.has(p)) p = parent[p]!;
        const gotParent = p >= 0 ? nodes[p]!.name : null;
        if (b.parent && gotParent !== b.parent) parentMismatch.push(`${b.name}: blender ${b.parent} → glb ${gotParent}`);
      }
    }
    errs.sort((x, y) => x - y);
    report.compare = {
      compared, deformBonesMissing: missing.length, missingSample: missing.slice(0, 15),
      parentMismatches: parentMismatch.length, parentSample: parentMismatch.slice(0, 15),
      medianHeadError: +(errs[errs.length >> 1] ?? 0).toFixed(5), worstHeadError: +worst.toFixed(5), worstBone,
    };
    missing = [];
    parentMismatch = [];
  }
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 1));
  return report;
}

mkdirSync(outRoot, { recursive: true });
const all = [];
for (const f of files) {
  process.stdout.write(`== ${path.basename(f)}\n`);
  const r = await one(f);
  all.push(r);
  process.stdout.write(JSON.stringify(r, null, 1).slice(0, 6000) + '\n');
}
writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify(all, null, 1));
