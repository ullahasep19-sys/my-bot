/**
 * Script: Backfill data trade yang kosong (exitPrice, pnlPercent, realizedPnlIdr)
 * Jalankan: npx tsx scripts/backfill_trades.ts
 */
import { prisma } from '../lib/prisma';

async function backfill() {
  const trades = await (prisma as any).analysis.findMany({
    where: {
      status: { in: ['PROFIT', 'LOSS'] },
      OR: [
        { exitPrice: null },
        { pnlPercent: null },
        { realizedPnlIdr: null },
      ]
    }
  });

  console.log(`Found ${trades.length} trades with missing data`);

  for (const t of trades) {
    // Jika tidak ada exitPrice, estimasi dari entryPrice + pnlPercent yang ada
    // atau gunakan targetPrice1 untuk PROFIT, stopLoss untuk LOSS
    let exitPrice = t.exitPrice;
    let pnlPercent = t.pnlPercent;
    let realizedPnlIdr = t.realizedPnlIdr;

    if (!exitPrice) {
      if (t.status === 'PROFIT' && t.targetPrice1) {
        exitPrice = t.targetPrice1;
      } else if (t.status === 'LOSS' && t.stopLoss) {
        exitPrice = t.stopLoss;
      } else {
        console.log(`  SKIP ${t.assetName} - tidak ada data cukup untuk estimasi`);
        continue;
      }
    }

    if (!pnlPercent && t.entryPrice && exitPrice) {
      pnlPercent = ((exitPrice - t.entryPrice) / t.entryPrice) * 100;
    }

    // Estimasi modal dari rrRatio atau default 50000
    const estimatedCapital = 50000;
    if (!realizedPnlIdr && pnlPercent) {
      realizedPnlIdr = Math.round((pnlPercent / 100) * estimatedCapital);
    }

    await (prisma as any).analysis.update({
      where: { id: t.id },
      data: {
        exitPrice: exitPrice || undefined,
        pnlPercent: pnlPercent ? parseFloat(pnlPercent.toFixed(2)) : undefined,
        realizedPnlIdr: realizedPnlIdr || undefined,
      }
    });

    console.log(`  ✅ ${t.assetName} | ${t.status} | Exit: ${exitPrice} | PnL: ${pnlPercent?.toFixed(2)}%`);
  }

  console.log('\nBackfill selesai.');
  process.exit(0);
}

backfill().catch(e => { console.error(e); process.exit(1); });
