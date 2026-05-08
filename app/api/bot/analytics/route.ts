import { NextResponse } from 'next/server';
import { prisma } from '@/src/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [dailyPerf, allTrades] = await Promise.all([
    (prisma as any).dailyPerformance.findMany({
      orderBy: { date: 'asc' },
      take: 30,
    }).catch(() => []),
    (prisma as any).analysis.findMany({
      where: { status: { in: ['PROFIT', 'LOSS'] } },
      select: { assetName: true, status: true, realizedPnlIdr: true, pnlPercent: true, updatedAt: true },
    }),
  ]);

  // PnL per hari dari trade history (fallback jika DailyPerformance kosong)
  const pnlByDay: Record<string, number> = {};
  for (const t of allTrades) {
    const day = new Date(t.updatedAt).toISOString().split('T')[0];
    pnlByDay[day] = (pnlByDay[day] || 0) + (t.realizedPnlIdr || 0);
  }
  const dailyPnl = Object.entries(pnlByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-14)
    .map(([date, pnl]) => ({ date, pnl }));

  // Top pairs
  const pairMap: Record<string, { wins: number; losses: number; pnl: number }> = {};
  for (const t of allTrades) {
    const pair = t.assetName?.replace('_idr', '').toUpperCase() || 'UNKNOWN';
    if (!pairMap[pair]) pairMap[pair] = { wins: 0, losses: 0, pnl: 0 };
    if (t.status === 'PROFIT') pairMap[pair].wins++;
    else pairMap[pair].losses++;
    pairMap[pair].pnl += t.realizedPnlIdr || 0;
  }
  const topPairs = Object.entries(pairMap)
    .map(([pair, v]) => ({ pair, ...v, total: v.wins + v.losses }))
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 10);

  return NextResponse.json({ dailyPerf, dailyPnl, topPairs });
}
