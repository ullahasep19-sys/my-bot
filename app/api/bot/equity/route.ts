import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const period = searchParams.get('period') || '30'; // 7, 14, 30, 90, 'all'

  const days = period === 'all' ? 365 : parseInt(period);
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);

  const daily = await (prisma as any).dailyPerformance.findMany({
    where: { date: { gte: since } },
    orderBy: { date: 'asc' },
  }).catch(() => []);

  if (daily.length > 0) {
    const curve = daily.map((d: any) => ({
      date: new Date(d.date).toISOString().split('T')[0],
      equity: d.endEquity,
      pnl: d.totalPnlIdr,
    }));
    return NextResponse.json({ curve });
  }

  // Fallback dari trade history
  const trades = await (prisma as any).analysis.findMany({
    where: { status: { in: ['PROFIT', 'LOSS'] }, updatedAt: { gte: since } },
    orderBy: { updatedAt: 'asc' },
    select: { updatedAt: true, realizedPnlIdr: true },
  });

  let equity = 500000;
  const byDay: Record<string, number> = {};
  for (const t of trades) {
    const day = new Date(t.updatedAt).toISOString().split('T')[0];
    equity += (t.realizedPnlIdr || 0);
    byDay[day] = equity;
  }

  const curve = Object.entries(byDay).map(([date, eq]) => ({ date, equity: eq, pnl: 0 }));
  return NextResponse.json({ curve });
}
