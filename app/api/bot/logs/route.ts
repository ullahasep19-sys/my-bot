import { NextResponse } from 'next/server';
import { prisma } from '@/src/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const logs = await (prisma as any).activityLog.findMany({
      take: 50,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ logs });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
