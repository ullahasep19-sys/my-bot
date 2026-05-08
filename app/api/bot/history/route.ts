import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/src/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get('filter') || 'all'; // all | profit | loss
  const page = parseInt(searchParams.get('page') || '1');
  const take = 20;
  const skip = (page - 1) * take;

  const where: any = { status: { in: ['PROFIT', 'LOSS', 'CANCELLED'] } };
  if (filter === 'profit') where.status = 'PROFIT';
  if (filter === 'loss')   where.status = 'LOSS';

  const [trades, total] = await Promise.all([
    (prisma as any).analysis.findMany({ where, orderBy: { updatedAt: 'desc' }, take, skip }),
    (prisma as any).analysis.count({ where }),
  ]);

  const allClosed = await (prisma as any).analysis.findMany({
    where: { status: { in: ['PROFIT', 'LOSS'] } },
    select: { realizedPnlIdr: true, status: true },
  });

  const wins = allClosed.filter((t: any) => t.status === 'PROFIT');
  const losses = allClosed.filter((t: any) => t.status === 'LOSS');
  const totalPnl = allClosed.reduce((s: number, t: any) => s + (t.realizedPnlIdr || 0), 0);
  const bestTrade = Math.max(...allClosed.map((t: any) => t.realizedPnlIdr || 0), 0);
  const worstTrade = Math.min(...allClosed.map((t: any) => t.realizedPnlIdr || 0), 0);

  return NextResponse.json({
    trades,
    pagination: { total, page, pages: Math.ceil(total / take) },
    summary: {
      totalTrades: allClosed.length,
      winCount: wins.length,
      lossCount: losses.length,
      winRate: allClosed.length > 0 ? (wins.length / allClosed.length) * 100 : 0,
      totalPnl,
      bestTrade,
      worstTrade,
    },
  });
}
