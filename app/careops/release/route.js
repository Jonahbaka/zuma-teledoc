import fs from 'node:fs';
import path from 'node:path';
import { resolveDeploymentProfile } from '@/lib/deploymentProfile.cjs';

export const dynamic = 'force-dynamic';
export function GET() {
  const profile = resolveDeploymentProfile(); let buildId = null;
  try { buildId = fs.readFileSync(path.resolve(profile.distDir, 'BUILD_ID'), 'utf8').trim(); } catch { /* Development has no built release. */ }
  return Response.json({ product: profile.careops ? 'careops' : 'main', deploymentId: profile.deploymentId, buildId }, { headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}
