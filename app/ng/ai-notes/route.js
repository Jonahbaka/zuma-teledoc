import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json({
    error: 'This legacy unscoped AI endpoint is retired. Use the authenticated programme-scoped clinical AI workflow.',
    code: 'LEGACY_CLINICAL_AI_RETIRED',
  }, { status: 410 });
}
