import { NextResponse } from "next/server";
import { prisma } from "@/src/db/prisma";
import { TradingEngine } from "@bot/engine/TradingEngine";
import { IndodaxPublicAPI } from "@bot/core/IndodaxPublicAPI";
import { AlphaHunter } from "@bot/scanner/AlphaHunter";
import { AISentinel } from "@bot/ai/AISentinel";
import { CompoundingEngine } from "@bot/engine/Compounding";
import { GrowthStrategy } from "@bot/strategies/GrowthStrategy";

export const maxDuration = 60; // 60 seconds limit on Vercel
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const secretParam = searchParams.get('secret');
  const authHeader = req.headers.get('authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null;
  
  const providedSecret = bearerToken || secretParam;

  // Verifikasi CRON_SECRET Vercel untuk keamanan
  if (process.env.CRON_SECRET && providedSecret !== process.env.CRON_SECRET) {
    console.error(`[AUTH] Unauthorized attempt. Provided: ${providedSecret ? '***' : 'NONE'}`);
    return new NextResponse('Unauthorized', { status: 401 });
  }
  return executeScan();
}

export async function POST() {
  return executeScan();
}

async function executeScan() {
  try {
    const settings = await (prisma as any).botSettings.findUnique({ where: { id: "global" } });
    if (!settings || !settings.isBotEnabled) {
      return NextResponse.json({ success: false, message: "Bot is standby / disabled" });
    }

    // Initialize bot components
    const apiKey = process.env.INDODAX_API_KEY || 'mock_key';
    const secretKey = process.env.INDODAX_SECRET_KEY || 'mock_secret';
    const engine = new TradingEngine({
      api: { apiKey, secretKey },
      risk: { maxPositionSizePercent: 100, maxDrawdownDailyPercent: 5 },
      isDryRun: false, // Set sesuai environment produksi
    });

    const compounding = new CompoundingEngine();
    const growthStrategy = new GrowthStrategy();
    const hunter = new AlphaHunter();

    // 1. Ambil target market & manage posisi terbuka
    let huntResults = await hunter.hunt(5);
    let dynamicPairs = huntResults.length > 0 ? huntResults.map(r => r.pair) : ['fet_idr', 'btc_idr'];
    const sentinel = new AISentinel(engine, dynamicPairs);

    const info = await engine.client.getInfo();
    const summaries: any = await IndodaxPublicAPI.getAllTickers();

    let totalCapital = parseFloat(info.balance.idr) + parseFloat(info.balance_hold.idr || "0");
    const balances = info.balance;
    const holds = info.balance_hold;

    // Hitung total equity
    for (const coin of Object.keys(balances)) {
      if (coin === 'idr') continue;
      const totalCoin = parseFloat(balances[coin]) + parseFloat(holds[coin] || "0");
      if (totalCoin > 0) {
        const price = parseFloat(summaries[`${coin}_idr`]?.last || "0");
        totalCapital += totalCoin * price;
      }
    }

    compounding.autoAdjustRatios(totalCapital);

    // EXIT MANAGEMENT & ADOPTION
    const openPairs = Object.keys(engine.state.openPositions);
    if (openPairs.length > 0) {
      for (const pair of openPairs) {
        try {
          const pos = engine.state.openPositions[pair];
          const ticker = await IndodaxPublicAPI.getTicker(pair);
          const currentPrice = Number(ticker.ticker.last);

          // Trailing Stop Logic
          if (pos.sl && pos.entryPrice && pos.tp1) {
            const newSl = growthStrategy.getTrailingStop(pos.entryPrice, currentPrice, pos.sl, pos.tp1);
            if (newSl > pos.sl) {
              engine.state.openPositions[pair].sl = newSl;
            }
          }

          // Stop Loss / Hard Exit
          if (pos.sl && currentPrice <= pos.sl) {
            await engine.executeSell(pair, pos.amountCrypto);
            continue;
          }

          // Take Profit 2
          if (pos.tp2 && currentPrice >= pos.tp2) {
            await engine.executeSell(pair, pos.amountCrypto);
            continue;
          }

          // Partial Profit TP1
          if (pos.tp1 && currentPrice >= pos.tp1 && !(pos.tpHits || []).includes(1)) {
            await engine.executeSell(pair, pos.amountCrypto * 0.5);
            if (!engine.state.openPositions[pair].tpHits) engine.state.openPositions[pair].tpHits = [];
            engine.state.openPositions[pair].tpHits?.push(1);
          }
        } catch (e: any) {
          console.error(`Failed to manage ${pair}: ${e.message}`);
        }
      }
      (engine as any).saveState();
    }

    // 2. HUNTING BARU
    const aiResults = await sentinel.analyzeMarket();
    for (const ai of aiResults) {
      if (ai.is_held && ai.action === 'SELL') {
        const coin = ai.pair.split('_')[0];
        const amount = parseFloat(balances[coin] || "0");
        if (amount > 0) {
          await engine.executeSell(ai.pair, amount);
        }
        continue;
      }

      if (ai.action !== 'BUY' || ai.score < 60) continue;
      if (!ai.precise_entry || !ai.precise_sl || !ai.precise_tp) continue;
      if (!growthStrategy.validateSniperEntry(ai.precise_entry, ai.precise_sl, ai.precise_tp)) continue;

      const isLowCap = !['btc_idr', 'eth_idr', 'sol_idr', 'bnb_idr'].includes(ai.pair);
      const huntCoin = huntResults.find(r => r.pair === ai.pair);
      const ctoScore = huntCoin ? huntCoin.totalScore : ai.score;

      const slDistPercent = Math.abs((ai.precise_entry - ai.precise_sl) / ai.precise_entry) * 100;
      const sizeIdr = compounding.getOptimalPositionSize(totalCapital, isLowCap, ctoScore, settings.riskPerTrade || 2, slDistPercent);
      
      if (sizeIdr < 10000) continue;

      const ticker = await IndodaxPublicAPI.getTicker(ai.pair);
      const ask = Number(ticker.ticker.buy);
      const bid = Number(ticker.ticker.sell);
      if (!engine.riskManager.validateExecution(ask, bid)) continue;

      const exits = growthStrategy.calculateDynamicExits(ai.precise_entry);
      
      await engine.executeBuy(ai.pair, sizeIdr, ai.precise_entry, { 
        sl: ai.precise_sl, 
        tp1: exits.tp1, 
        tp2: exits.tp2 
      });

      break; // Hanya entry 1 koin per siklus
    }

    return NextResponse.json({ success: true, message: "Scan cycle complete" });
  } catch (error: any) {
    console.error("Scan API Error:", error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
