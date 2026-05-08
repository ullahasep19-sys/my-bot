import { NextResponse } from 'next/server';
import { prisma } from '@/src/db/prisma';
import { IndodaxClient } from '@/src/core/IndodaxClient';
import { IndodaxPublicAPI } from '@/src/core/IndodaxPublicAPI';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const client = new IndodaxClient({
        apiKey: process.env.INDODAX_API_KEY || '',
        secretKey: process.env.INDODAX_SECRET_KEY || ''
    });

    const [info, summaries, openPositions, closedTrades, botSettings] = await Promise.all([
      client.getInfo().catch(() => null),
      IndodaxPublicAPI.getAllTickers().catch(() => ({})),
      (prisma as any).analysis.findMany({ where: { status: 'TRADING' }, orderBy: { createdAt: 'desc' } }),
      (prisma as any).analysis.findMany({ where: { status: { in: ['PROFIT', 'LOSS'] } }, orderBy: { updatedAt: 'desc' }, take: 20 }),
      (prisma as any).botSettings.findUnique({ where: { id: 'global' } }),
    ]);

    // Equity calculation
    let idrBalance = 0;
    let totalEquity = 0;
    const walletAssets: any[] = [];

    if (info) {
      const balances = info.balance || {};
      const holds = info.balance_hold || {};
      idrBalance = parseFloat(balances.idr || '0') + parseFloat(holds.idr || '0');
      totalEquity = idrBalance;

      const tickers: any = summaries || {};
      for (const coin of Object.keys(balances)) {
        if (coin === 'idr') continue;
        const total = parseFloat(balances[coin] || '0') + parseFloat(holds[coin] || '0');
        if (total > 0) {
          const price = parseFloat(tickers[`${coin}_idr`]?.last || '0');
          const value = total * price;
          if (value > 500) {
            walletAssets.push({ coin: coin.toUpperCase(), amount: total, price, value });
            totalEquity += value;
          }
        }
      }
    }

    // Floating PnL per open position
    const tickers: any = summaries || {};
    const positionsWithPnl = openPositions.map((pos: any) => {
      const ticker = tickers[pos.assetName];
      const currentPrice = parseFloat(ticker?.last || pos.currentPrice || pos.entryPrice);
      const pnlPct = pos.entryPrice > 0 ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0;
      return { ...pos, currentPrice, floatingPnlPct: pnlPct };
    });

    // Performance stats
    const winCount = closedTrades.filter((t: any) => t.status === 'PROFIT').length;
    const totalPnl = closedTrades.reduce((s: number, t: any) => s + (t.realizedPnlIdr || 0), 0);
    const winRate = closedTrades.length > 0 ? (winCount / closedTrades.length) * 100 : 0;

    return NextResponse.json({
      equity: { total: totalEquity, idr: idrBalance, assets: walletAssets },
      positions: positionsWithPnl,
      performance: { totalTrades: closedTrades.length, winRate, totalPnl, recentTrades: closedTrades.slice(0, 5) },
      botSettings,
      updatedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
