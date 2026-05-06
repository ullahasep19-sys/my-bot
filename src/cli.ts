import * as dotenv from 'dotenv';
import { prisma } from './db/prisma';
import { TradingEngine } from './engine/TradingEngine';
import { IndodaxPublicAPI } from './core/IndodaxPublicAPI';
import { DBBridge } from './db/DBBridge';
import { DCAStrategy } from './strategies/DCAStrategy';
import { SwingStrategy, TradingPlan } from './strategies/SwingStrategy';
import { LiveRadar } from './engine/LiveRadar';
import { AISentinel } from './ai/AISentinel';
import { AlphaHunter } from './scanner/AlphaHunter';
import { ExitManager2 } from './predator/exit2';
import { MacroRegimeEngine } from './predator/macro';
import { NarrativeEngine } from './narrative/engine';
import { RiskDomain } from './modules/risk/RiskDomain';
import { LoggerDomain, LogLevel } from './modules/system/LoggerDomain';
import { PerformanceTracker } from './modules/system/PerformanceTracker';

dotenv.config();

async function runCLI() {

  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  console.log('🤖 Indodax Advanced CLI');
  console.log('========================\n');

  if (command === 'help') {
    console.log('Available Commands:');
    console.log('  npm run bot -- price <pair>       - Get current price');
    console.log('  npm run bot -- hunt               - 🦅 Alpha Hunter: Scan semua koin, output Top 10 Peluang');
    console.log('  npm run bot -- hunt --top=20      - Alpha Hunter dengan output Top 20');
    console.log('  npm run bot -- sync --safe        - 🚀 START AUTOPILOT (Paper Trading)');
    console.log('  npm run bot -- sync               - 🚀 START AUTOPILOT (LIVE - Real Money)');
    console.log('  npm run bot -- check-api          - Test API Key connection');
    process.exit(0);
  }

  // 1. PUBLIC ENDPOINTS (Does not require API Keys)
  if (command === 'price') {
    const pair = args[1] || 'btc_idr';
    try {
      const ticker = await IndodaxPublicAPI.getTicker(pair);
      console.log(`📈 ${pair.toUpperCase()} Price: Rp ${parseInt(ticker.ticker.last).toLocaleString('id-ID')}`);
      console.log(`   High: Rp ${parseInt(ticker.ticker.high).toLocaleString('id-ID')} | Low: Rp ${parseInt(ticker.ticker.low).toLocaleString('id-ID')}`);
    } catch (e: any) {
      console.error('Failed to get price:', e.message);
    }
    process.exit(0);
  }

  // ============================================================
  // ALPHA HUNTER: Scan seluruh Indodax → Top Opportunities
  // ============================================================
  if (command === 'hunt') {
    const topArg = args.find(a => a.startsWith('--top='));
    const topN = topArg ? parseInt(topArg.split('=')[1]) : 10;

    const hunter = new AlphaHunter();
    const results = await hunter.hunt(topN);

    if (results.length === 0) {
      console.log('\n❌ Tidak ada peluang yang memenuhi filter hari ini. Market mungkin sedang RISK-OFF.');
      process.exit(0);
    }


    console.log('\n✅ Scan selesai. Gunakan sinyal di atas sebagai referensi entry.');
    console.log('⚡ Jalankan `npm run bot -- sync --safe` untuk paper trade otomatis.\n');
    process.exit(0);
  }

  // Engine Setup (With mock keys if empty)
  const apiKey = process.env.INDODAX_API_KEY || 'mock_key';
  const secretKey = process.env.INDODAX_SECRET_KEY || 'mock_secret';

  const isMockKey = apiKey === 'mock_key' || apiKey === 'mock_data' || apiKey === 'your_api_key_here';
  const isSafeMode = args.includes('--safe') || isMockKey;

  // Custom Arguments Parser untuk Growth Machine
  const mode = args.find(a => a.startsWith('--mode='))?.split('=')[1] || 'survival';
  const riskPercent = parseFloat(args.find(a => a.startsWith('--risk='))?.split('=')[1] || '2');
  const maxTrades = parseInt(args.find(a => a.startsWith('--maxTrades='))?.split('=')[1] || '3');
  const isSniperActive = args.includes('--sniper=true');

  console.log(`\n⚙️  ACTIVE SETTINGS:`);
  console.log(`   ► Mode       : ${mode.toUpperCase()}`);
  console.log(`   ► Risk/Trade : ${riskPercent}%`);
  console.log(`   ► Max Trades : ${maxTrades} per hari`);
  console.log(`   ► Sniper     : ${isSniperActive ? 'ON' : 'OFF'}\n`);

  const engine = new TradingEngine({
    api: { apiKey, secretKey },
    risk: { maxPositionSizePercent: 100, maxDrawdownDailyPercent: 10 }, // Naikkan daily loss limit ke 10%
    isDryRun: isSafeMode,
    maxPortfolioExposurePercent: 95,
    maxOpenPositions: 7
  });
  
  // Inject parameter tambahan ke state/risk engine jika diperlukan
  engine.state.maxTradesPerDay = maxTrades;
  engine.state.activeMode = mode;

  // 2. STRATEGY TEST
  if (command === 'test-dca') {
    const pair = args[1] || 'btc_idr';
    console.log(`🔄 Running Simulated DCA Strategy for ${pair}...`);

    // Simulate buying Rp 50.000
    const dca = new DCAStrategy(engine, 50000);
    const signal = await dca.evaluate(pair);

    // This will hit the TradingEngine's DryRun block and output the simulation
    await dca.executeSignal(signal);
    process.exit(0);
  }

  // 4. LIVE RADAR TEST (SWING VISION AI SIMULATION)
  if (command === 'radar') {
    const pair = args[1] || 'btc_idr';

    // Simulate getting a plan from your my-trade AI
    const mockCurrentPrice = parseInt((await IndodaxPublicAPI.getTicker(pair)).ticker.sell);

    // Create a mock plan: Entry is current price (to trigger immediately) or slightly below
    const mockPlan: TradingPlan = {
      pair: pair,
      sentiment: 'Bullish',
      entryPrice: mockCurrentPrice + 50000, // Sengaja di-set sedikit lebih tinggi agar langsung kena untuk test
      targetPrice1: mockCurrentPrice + 500000, // TP1
      targetPrice2: mockCurrentPrice + 1000000, // TP2
      stopLoss: mockCurrentPrice - 200000, // SL
      allocatedIdr: 100000 // Uang simulasi
    };

    console.log(`\n🧠 Menerima Trading Plan dari SwingVision AI untuk ${pair}...`);
    console.log(`- Entry Target: Rp ${mockPlan.entryPrice.toLocaleString('id-ID')}`);
    console.log(`- Take Profit: Rp ${mockPlan.targetPrice1.toLocaleString('id-ID')}`);
    console.log(`- Stop Loss: Rp ${mockPlan.stopLoss.toLocaleString('id-ID')}`);

    const swingStrategy = new SwingStrategy(engine, mockPlan);
    const radar = new LiveRadar(3000); // Scan tiap 3 detik

    radar.registerStrategy(swingStrategy, pair);
    radar.start();

    // Biarkan proses menyala, tidak di-exit
    return;
  }

  // 5. THE REAL DEAL: INSTITUTIONAL AUTOPILOT (MODAL KECIL)
  if (command === 'sync' || command === 'autopilot') {
    console.log('🚀 INITIALIZING CAPITAL GROWTH MACHINE...');

    if (isSafeMode) {
      console.log('⚠️ PERINGATAN: Bot berjalan di mode --safe (PAPER TRADING ONLY).');
    } else {
      console.log('⚠️ PERHATIAN: Bot berjalan di mode --live (ORDER ASLI INDODAX).');
    }

    const { CompoundingEngine } = require('./engine/Compounding');
    const { GrowthStrategy } = require('./strategies/GrowthStrategy');
    const { IndodaxPublicAPI } = require('./core/IndodaxPublicAPI');

    const compounding = new CompoundingEngine();
    const growthStrategy = new GrowthStrategy();
    const hunter = new AlphaHunter();

    // State tracking untuk anti-overtrade
    let dailyTradeCount = 0;
    const lastTradeReset = new Date().toDateString();

    console.log('\n🔍 [ALPHA HUNTER] Scan pasar awal...');
    let huntResults = await hunter.hunt(10);
    let dynamicPairs = huntResults.length > 0
      ? huntResults.map(r => r.pair)
      : ['btc_idr', 'eth_idr', 'sol_idr']; // Use high-liquidity bluechips as emergency fallback only

    console.log(`🎯 Target pairs hari ini: ${dynamicPairs.join(', ').toUpperCase()}`);

    const sentinel = new AISentinel(engine, dynamicPairs);
    // Inject AlphaHunter scores ke sentinel untuk dipakai di PredatorStrategy
    for (const r of huntResults) sentinel.alphaScores[r.pair] = r.totalScore;

    // Re-scan market setiap 30 menit untuk update target pairs
    setInterval(async () => {
      console.log('\n🔄 [ALPHA HUNTER] Re-scan pasar untuk update target...');
      huntResults = await hunter.hunt(10);
      if (huntResults.length > 0) {
        dynamicPairs = huntResults.map(r => r.pair);
        console.log(`🎯 Target pairs diperbarui: ${dynamicPairs.join(', ')}`);
        (sentinel as any).targetPairs = dynamicPairs;
        for (const r of huntResults) sentinel.alphaScores[r.pair] = r.totalScore;
      }
    }, 30 * 60 * 1000);
    
    // Initializing radar and bridge for dashboard sync
    const radar = new LiveRadar(30000); 
    const bridge = new DBBridge(radar, engine);
    bridge.startSync();
    radar.start();

    // ===== DATABASE CLEANUP & RECOVERY =====
    console.log(`\n💾 [CLOUD-SYNC] Menghubungkan ke Supabase & Membersihkan koin rusak...`);
    try {
      // 1. Force Cleanup koin macet agar tidak loop lagi
      await (prisma as any).analysis.deleteMany({ 
        where: { assetName: { in: ['molt_idr', 'beat_idr'] }, status: 'TRADING' } 
      });

      // 2. Recover Open Positions
      const dbPositions = await (prisma as any).analysis.findMany({ where: { status: 'TRADING' } });
      for (const pos of dbPositions) {
        if (!engine.state.openPositions[pos.assetName]) {
          console.log(`   ✅ Recovered ${pos.assetName.toUpperCase()}: SL ${pos.stopLoss}, TP1 ${pos.targetPrice1}`);
          
          // Sync real balance from Indodax
          const currentInfo = await engine.client.getInfo();
          const coin = pos.assetName.split('_')[0];
          const balances = currentInfo.balance || {};
          const amountCrypto = parseFloat(balances[coin] || "0");
          
          if (amountCrypto > 0) {
            engine.state.openPositions[pos.assetName] = {
              amountIdr: amountCrypto * pos.entryPrice,
              amountCrypto: amountCrypto,
              entryPrice: pos.entryPrice,
              sl: pos.stopLoss,
              tp1: pos.targetPrice1,
              tp2: pos.targetPrice2,
              tpHits: []
            };
          } else {
            // Jika di DB ada tapi di wallet 0, tandai selesai di DB
            await (prisma as any).analysis.updateMany({
              where: { id: pos.id },
              data: { status: 'PROFIT' } // Anggap sudah terjual manual
            });
          }
        }
      }

      // 3. Recover PnL Stats from History
      const history = await (prisma as any).analysis.findMany({ 
        where: { status: { in: ['PROFIT', 'LOSS'] } } 
      });
      engine.state.totalTrades = history.length;
      engine.state.winningTrades = history.filter((h: any) => h.status === 'PROFIT').length;
      engine.state.totalPnL = history.reduce((sum: number, h: any) => sum + (h.realizedPnlIdr || 0), 0);
      
      console.log(`   📊 Stats Sync: ${engine.state.totalTrades} trades, PnL: Rp ${Math.round(engine.state.totalPnL).toLocaleString()}`);

    } catch (e: any) {
      console.error(`❌ [CLOUD-SYNC] Gagal sinkronisasi database: ${e.message}`);
    }

    const runAutopilotCycle = async () => {
      try {
        // --- MAY 1M TARGET INITIALIZATION (FORCED SYNC) ---
        await (prisma as any).botSettings.upsert({
          where: { id: "global" },
          update: { riskPerTrade: 5, maxOpenPositions: 7, strategyMode: 'WAR' },
          create: { id: "global", riskPerTrade: 5, maxOpenPositions: 7, strategyMode: 'WAR', isBotEnabled: true }
        });

        // --- SYNC SETTINGS FROM DASHBOARD ---
        const settings = await (prisma as any).botSettings.findUnique({ where: { id: "global" } });
        const isBotEnabled = settings ? settings.isBotEnabled : true;
        const currentMode = settings ? settings.strategyMode : mode;
        const currentRisk = settings ? settings.riskPerTrade : riskPercent;
        const currentMaxTrades = settings ? settings.maxOpenPositions : maxTrades;
        
        if (!isBotEnabled) {
          console.log(`\n💤 [AUTOPILOT] Bot is STANDBY (Disabled via Dashboard). Waiting...`);
          await DBBridge.logActivity('SYSTEM', 'Bot is STANDBY (Disabled via Dashboard)');
          return;
        }

        const { regime, metrics } = await MacroRegimeEngine.getCurrentRegime();
        const narrativeReport = await NarrativeEngine.generateReport();

        await LoggerDomain.log(LogLevel.SYSTEM, `Cycle Started | Regime: ${regime} | Phase: ${narrativeReport.marketPhase}`);
        
        console.log(`\n🔄 [AUTOPILOT] Siklus dimulai | Mode: ${currentMode.toUpperCase()} | Regime: ${regime}`);
        console.log(`🧠 [NARRATIVE] Phase: ${narrativeReport.marketPhase} | Hot: ${narrativeReport.hotNow.slice(0, 2).map(n => n.type).join(', ')}`);
        
        // --- PHASE D: PERFORMANCE TRACKING ---
        const totalCapital = await engine.calculateTotalEquity();
        await PerformanceTracker.recordDaily(totalCapital, engine.state.totalPnL, (engine.state.totalPnL / totalCapital) * 100);

        // Reset daily trade count jika hari baru
        if (new Date().toDateString() !== lastTradeReset) {
          dailyTradeCount = 0;
        }

        // Anti-overtrade check
        if (dailyTradeCount >= maxTrades) {
          console.log(`\n⛔ [ANTI-OVERTRADE] Batas ${maxTrades} trade/hari tercapai. Bot istirahat.`);
          return;
        }

        const info = await engine.client.getInfo();
        const summaries = await IndodaxPublicAPI.getAllTickers();
        
        const balances = info.balance || {};
        const holds = info.balance_hold || {};

        // ===== CRITICAL: Reconcile Exposure from Real Indodax Data =====
        let realExposure = 0;
        for (const coin of Object.keys(balances)) {
          if (coin === 'idr') continue;
          const amount = parseFloat(balances[coin]) + parseFloat(holds[coin] || "0");
          if (amount > 0) {
            const pair = `${coin}_idr`;
            const price = parseFloat(summaries[pair]?.last || "0");
            realExposure += amount * price;
          }
        }
        if (Math.abs(engine.state.totalExposureIdr - realExposure) > 50000) {
          console.log(`🔧 [RECONCILE] Exposure drift detected: Rp ${Math.round(engine.state.totalExposureIdr).toLocaleString()} → Rp ${Math.round(realExposure).toLocaleString()}`);
          engine.state.totalExposureIdr = realExposure;
        }

        compounding.autoAdjustRatios(totalCapital);
        
        // --- PHASE B: RISK DOMAIN MONITORING ---
        const startingEquity = settings?.startingEquity || totalCapital; // We should track this in DB
        if (RiskDomain.monitor(totalCapital, startingEquity)) {
          await DBBridge.logActivity('SYSTEM', '🚨 CIRCUIT BREAKER TRIGGERED: Daily Drawdown Limit Hit!');
          return;
        }

        if (engine.riskManager.isKillSwitchEngaged(totalCapital)) return;

        // --- MANAGE OPEN POSITIONS (Trailing Stop & Exit) ---
        const openAnalyses = await (prisma as any).analysis.findMany({ where: { status: 'TRADING' } });
        const managedPairs = openAnalyses.map((a: any) => a.assetName);
        
        // 1. ADOPT UNTRACKED COINS (Manual Purchases)
        console.log(`\n🔍 [ADOPTION] Memeriksa koin manual di portofolio...`);
        const firstUser = await (prisma as any).user.findFirst();
        const validUserId = firstUser ? firstUser.id : 'default_system_user';

        for (const coin of Object.keys(balances)) {
          if (coin === 'idr') continue;
          const pair = `${coin}_idr`;
          const totalCoin = parseFloat(balances[coin]) + parseFloat(holds[coin] || "0");
          
          if (totalCoin > 0 && !managedPairs.includes(pair)) {
            const price = parseFloat(summaries[pair]?.last || "0");
            if (totalCoin * price > 20000) { // Hanya adopsi jika nilai > 20rb
              console.log(`\n📦 [ADOPTION] Mengadopsi ${pair.toUpperCase()} (Manual Purchase detected)`);
              try {
                // Minta AI buatkan strategi Exit darurat
                const ai = await sentinel.analyzePair(pair); 
                
                if (!ai) {
                  console.log(`   ⚠️ AI gagal menganalisa ${pair}, menggunakan setting standar (SL 5%, TP 10%)`);
                }
                
                // 2. Add to Engine State Memory (so it's managed immediately)
                const posAmountIdr = totalCoin * price;
                engine.state.openPositions[pair] = {
                  amountIdr: posAmountIdr,
                  amountCrypto: totalCoin,
                  entryPrice: price,
                  sl: ai?.precise_sl || price * 0.95,
                  tp1: ai?.precise_tp || price * 1.1,
                  tpHits: []
                };
                engine.state.totalExposureIdr += posAmountIdr;

                await (prisma as any).analysis.create({
                  data: {
                    userId: validUserId, 
                    assetName: pair,
                    entryPrice: price,
                    targetPrice1: ai?.precise_tp || price * 1.05,
                    targetPrice2: ai?.precise_tp || price * 1.1,
                    stopLoss: ai?.precise_sl || price * 0.95,
                    status: 'TRADING',
                    analysisText: `ADOPTED: ${ai?.why_now || 'Manual trade management taken over by AI'}`
                  }
                });
                
                await DBBridge.logActivity('SYSTEM', `📦 ADOPTED: ${pair.toUpperCase()} has been integrated into AI management.`);
              } catch (adoptErr) {
                console.error(`❌ Gagal mengadopsi ${pair}:`, adoptErr);
              }
            }
          }
        }

        const openPairs = Object.keys(engine.state.openPositions);
        if (openPairs.length > 0) {
          console.log(`\n🛡️ [EXIT MANAGER] Mengecek ${openPairs.length} posisi terbuka...`);
          for (const pair of openPairs) {
            try {
              const pos = engine.state.openPositions[pair];
              const ticker = await IndodaxPublicAPI.getTicker(pair);
              const currentPrice = Number(ticker.ticker.last);

              // ===== DETEKSI JUAL MANUAL =====
              // Jika koin tidak ada di wallet tapi masih tercatat di openPositions
              const coin = pair.split('_')[0];
              const walletAmount = parseFloat(balances[coin] || '0') + parseFloat(holds[coin] || '0');
              const expectedMinAmount = pos.amountCrypto * 0.05; // toleransi 5% (dust)
              if (walletAmount < expectedMinAmount && pos.amountCrypto > 0) {
                console.log(`\n📤 [MANUAL SELL DETECTED] ${pair.toUpperCase()} tidak ada di wallet (${walletAmount}). Kemungkinan dijual manual.`);
                const pnlPercent = pos.entryPrice > 0 ? ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100 : 0;
                const realizedPnlIdr = (pnlPercent / 100) * pos.amountIdr;
                const newStatus = pnlPercent > 0 ? 'PROFIT' : 'LOSS';
                await (prisma as any).analysis.updateMany({
                  where: { assetName: pair, status: 'TRADING' },
                  data: { status: newStatus, exitPrice: currentPrice, pnlPercent: parseFloat(pnlPercent.toFixed(2)), realizedPnlIdr: Math.round(realizedPnlIdr) }
                });
                engine.state.totalExposureIdr -= pos.amountIdr;
                delete engine.state.openPositions[pair];
                await DBBridge.logActivity('TRADE', `📤 MANUAL SELL: ${pair.toUpperCase()} @ Rp ${currentPrice.toLocaleString()} | ${newStatus} ${pnlPercent.toFixed(2)}%`);
                console.log(`✅ [MANUAL SELL] Posisi ${pair.toUpperCase()} ditutup. PnL: ${pnlPercent.toFixed(2)}%`);
                continue;
              }
              
              // 1. Trailing Stop via ExitManager2
              const tpsHit = pos.tpHits || [];
              const exitUpdate = ExitManager2.monitor(currentPrice, pos.entryPrice, pos.sl || pos.entryPrice * 0.96, tpsHit, pos.entryTimestamp);

              if (exitUpdate.newSL && exitUpdate.newSL > (pos.sl || 0)) {
                engine.state.openPositions[pair].sl = exitUpdate.newSL;
                console.log(`🛡️ [EXIT MGR] SL ${pair.toUpperCase()} naik ke Rp ${exitUpdate.newSL.toLocaleString()} (${exitUpdate.closeReason})`);
                await DBBridge.logActivity('SYSTEM', `🛡️ [TRAILING] SL ${pair.toUpperCase()} → Rp ${exitUpdate.newSL.toLocaleString()}`);
              }

              if (exitUpdate.tpHit && !tpsHit.includes(exitUpdate.tpHit)) {
                engine.state.openPositions[pair].tpHits = [...tpsHit, exitUpdate.tpHit];
              }

              // 2. Hard Exit Check via ExitManager2
              if (exitUpdate.shouldClose) {
                console.log(`\n⚠️ [EXIT MGR] ${pair.toUpperCase()} → ${exitUpdate.closeReason} @ Rp ${currentPrice.toLocaleString()}`);
                await engine.executeSell(pair, pos.amountCrypto);
                await DBBridge.logActivity('TRADE', `EXIT ${exitUpdate.closeReason}: ${pair.toUpperCase()} @ Rp ${currentPrice.toLocaleString()}`);
                const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
                const realizedPnlIdr = (pnlPercent / 100) * pos.amountIdr;
                const newStatus = pnlPercent > 0 ? 'PROFIT' : 'LOSS';
                await (prisma as any).analysis.updateMany({
                  where: { assetName: pair, status: 'TRADING' },
                  data: { status: newStatus, pnlPercent: parseFloat(pnlPercent.toFixed(2)), realizedPnlIdr: Math.round(realizedPnlIdr), exitPrice: currentPrice }
                });
                continue;
              }

              // 3. Legacy Trailing Stop via GrowthStrategy (sebagai backup)
              if (pos.sl && pos.entryPrice && pos.tp1) {
                const newSl = growthStrategy.getTrailingStop(pos.entryPrice, currentPrice, pos.sl, pos.tp1);
                if (newSl > (engine.state.openPositions[pair]?.sl || 0)) {
                  engine.state.openPositions[pair].sl = newSl;
                  await DBBridge.logActivity('SYSTEM', `🛡️ [TRAILING] SL ${pair.toUpperCase()} naik ke Rp ${newSl.toLocaleString()}`);
                }
              }

            } catch (e: any) {
              const msg = e.message || '';
              console.error(`❌ [MICRO-CYCLE] Gagal menjual ${pair}: ${msg}`);
              
              // LOOP PROTECTOR AGRESSIVE: Bersihkan koin jika ada error API Indodax yang permanen
              if (msg.includes('Minimum price') || msg.includes('Insufficient balance') || msg.includes('API Error')) {
                console.log(`   🛡️ [AUTO-CLEANUP] Menghapus ${pair} secara paksa karena error API permanen.`);
                delete engine.state.openPositions[pair];
                (engine as any).saveState();
              }
            }
          }
          (engine as any).saveState(); // Save updated SLs
        }


        const aiResults = await sentinel.analyzeMarket();

        for (const ai of aiResults) {
          const sep = '─'.repeat(52);
          console.log(`\n┌${sep}┐`);
          console.log(`│  ALPHA SIGNAL: ${(ai.pair || 'UNKNOWN').toUpperCase().padEnd(35)}│`);
          console.log(`│  REGIME      : ${(ai.regime || 'NEUTRAL').padEnd(35)}│`);
          console.log(`│  CONFIDENCE  : ${String(ai.score || 0).padEnd(5)} (${ai.confidence || 'MID'})${' '.repeat(20)}│`);
          console.log(`│  EDGE        : ${(ai.edge_strength || 'Normal').padEnd(35)}│`);
          console.log(`│  WHY NOW     : ${(ai.why_now || 'No reason provided').substring(0, 35).padEnd(35)}│`);

          // Cek Hold/Sell untuk koin yang sudah dipegang
          if (ai.is_held && ai.action === 'SELL') {
            console.log(`│  STATUS : ⚠️  EXIT SIGNAL — EXECUTING SELL...       │`);
            console.log(`└${sep}┘`);
            try {
              const balances = info.balance || {};
              const coin = ai.pair.split('_')[0];
              const amount = parseFloat(balances[coin]);
              if (amount > 0) {
                const pos = engine.state.openPositions[ai.pair];
                const ticker = await IndodaxPublicAPI.getTicker(ai.pair);
                const currentPrice = parseFloat(ticker.ticker.last);
                
                await engine.executeSell(ai.pair, amount);
                await DBBridge.logActivity('TRADE', `🔴 EXECUTING SELL: ${ai.pair.toUpperCase()} (AI Signal)`);
                
                if (pos) {
                  const pnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
                  const realizedPnlIdr = (pnlPercent / 100) * pos.amountIdr;
                  const newStatus = pnlPercent > 0 ? 'PROFIT' : 'LOSS';
                  await (prisma as any).analysis.updateMany({
                    where: { assetName: ai.pair, status: 'TRADING' },
                    data: { status: newStatus, pnlPercent: parseFloat(pnlPercent.toFixed(2)), realizedPnlIdr: Math.round(realizedPnlIdr), exitPrice: currentPrice }
                  });
                } else {
                  await (prisma as any).analysis.updateMany({
                    where: { assetName: ai.pair, status: 'TRADING' },
                    data: { status: 'PROFIT' }
                  });
                }
              }
            } catch (sellErr: any) {
              console.error(`❌ Gagal auto-sell: ${sellErr.message}`);
            }
            continue;
          }

          // Filter dasar
          if (ai.action !== 'BUY') {
            console.log(`│  STATUS : REJECTED — Bukan sinyal BUY              │`);
            console.log(`└${sep}┘`);
            await DBBridge.logActivity('SCAN', `${ai.pair.toUpperCase()}: Rejected (Bukan sinyal BUY)`);
            continue;
          }
          if (ai.score < 42) {
            console.log(`│  STATUS : REJECTED — Score ${ai.score} < 42${' '.repeat(20)}│`);
            console.log(`└${sep}┘`);
            await DBBridge.logActivity('SCAN', `${ai.pair.toUpperCase()}: Rejected (Score ${ai.score} < 42)`);
            continue;
          }
          if (!ai.precise_entry || !ai.precise_sl || !ai.precise_tp) {
            console.log(`│  STATUS : REJECTED — AI tidak berikan target presisi│`);
            console.log(`└${sep}┘`);
            continue;
          }

          // ===== CRITICAL GUARD #1: Duplicate Order Protection =====
          if (engine.state.openPositions[ai.pair]) {
            console.log(`│  STATUS : REJECTED — Sudah ada posisi terbuka       │`);
            console.log(`└${sep}┘`);
            continue;
          }

          // ===== CRITICAL GUARD #2: AI Price Sanity Check =====
          const liveTicker = await IndodaxPublicAPI.getTicker(ai.pair);
          const livePrice = parseFloat(liveTicker.ticker.last);
          // Jika AI entry menyimpang > 10%, gunakan harga live (bukan reject)
          // Ini menangani kasus AI mengembalikan harga dalam satuan berbeda
          const entryDeviation = livePrice > 0 ? Math.abs(ai.precise_entry - livePrice) / livePrice : 1;
          const safeEntry = entryDeviation > 0.10 ? livePrice : (ai.precise_entry || livePrice);
          if (entryDeviation > 0.10) {
            console.log(`│  ⚠️ Entry AI menyimpang ${(entryDeviation * 100).toFixed(0)}%, pakai harga live: Rp ${livePrice.toLocaleString()} │`);
          }

          // ===== CRITICAL GUARD #3: SL Sanitization =====
          // SL harus di BAWAH entry untuk BUY. Jika tidak, gunakan fallback 5%.
          let safeSl = (ai.precise_sl && ai.precise_sl < safeEntry) ? ai.precise_sl : safeEntry * 0.95;
          if (ai.precise_sl && ai.precise_sl >= safeEntry) {
            console.log(`│  ⚠️ SL AI di atas entry! Auto-fix ke Rp ${safeSl.toLocaleString()} │`);
          }

          // Sniper Formula (RR Check)
          const safeTP = (ai.precise_tp && ai.precise_tp > safeEntry) ? ai.precise_tp : safeEntry * 1.10;
          if (!growthStrategy.validateSniperEntry(safeEntry, safeSl, safeTP)) {
            console.log(`│  STATUS : REJECTED — RR < 1:2                      │`);
            console.log(`└${sep}┘`);
            continue;
          }

          // Sizing via Compounding Engine
          const MIDCAP = ['btc_idr','eth_idr','sol_idr','bnb_idr','xrp_idr','ada_idr','avax_idr','op_idr','sui_idr','hype_idr'];
          const isLowCapCli = !MIDCAP.includes(ai.pair);
          const huntCoin = huntResults.find(r => r.pair === ai.pair);
          const ctoScore = huntCoin ? huntCoin.totalScore : ai.score;
          
          const slDistPercent = Math.abs((safeEntry - safeSl) / safeEntry) * 100;
          const sizeIdr = compounding.getOptimalPositionSize(totalCapital, isLowCapCli, ctoScore, currentRisk, slDistPercent, engine.state.recentResults);
          if (sizeIdr < 10000) {
            console.log(`│  STATUS : REJECTED — Size Rp${sizeIdr.toLocaleString()} terlalu kecil │`);
            console.log(`└${sep}┘`);
            continue;
          }

          // Reality Engine (Spread Check)
          const ticker = await IndodaxPublicAPI.getTicker(ai.pair);
          const ask = Number(ticker.ticker.buy);
          const bid = Number(ticker.ticker.sell);
          if (!engine.riskManager.validateExecution(ask, bid)) {
            console.log(`│  STATUS : REJECTED — Spread terlalu tinggi          │`);
            console.log(`└${sep}┘`);
            continue;
          }

          // Full output (ALPHA OMEGA Architecture)
          const exits = growthStrategy.calculateDynamicExits(safeEntry, safeSl);
          console.log(`│  THESIS : ${ai.why_now.substring(0, 41).padEnd(42)}│`);
          console.log(`│  ENTRY  : Rp ${ai.precise_entry.toLocaleString('id-ID').padEnd(38)}│`);
          console.log(`│  SL     : Rp ${safeSl.toLocaleString('id-ID').padEnd(38)}│`);
          console.log(`│  TP1    : Rp ${exits.tp1.toLocaleString('id-ID')} (+10%)${' '.repeat(26)}│`);
          console.log(`│  TP2    : Rp ${exits.tp2.toLocaleString('id-ID')} (+25%)${' '.repeat(26)}│`);
          console.log(`│  SIZE   : Rp ${sizeIdr.toLocaleString('id-ID').padEnd(38)}│`);
          console.log(`│  STATUS : ✅ ELITE EDGE — EXECUTING ORDER...         │`);
          console.log(`└${sep}┘`);
          await DBBridge.logActivity('TRADE', `✅ EXECUTING BUY: ${ai.pair.toUpperCase()} @ Rp ${safeEntry.toLocaleString()}`);

          // EXECUTE ORDER
          await engine.executeBuy(ai.pair, sizeIdr, safeEntry, { 
            sl: safeSl, 
            tp1: exits.tp1, 
            tp2: exits.tp2 
          });
          dailyTradeCount++;

          // 1 posisi saja per siklus — break setelah 1 eksekusi sukses
          break;
        }

      } catch (e: any) {
        console.error("❌ Cycle error:", e.message);
      }
    };

    // ===== MICRO-CYCLE: Rapid SL/TP Guardian (Every 30 seconds) =====
    const runMicroCycle = async () => {
      const openPositions = engine.state.openPositions;
      const openPairs = Object.keys(openPositions);
      if (openPairs.length === 0) return;

      try {
        const summaries = await IndodaxPublicAPI.getAllTickers();
        const info = await engine.client.getInfo();
        const balances = info.balance || {};

        for (const pair of openPairs) {
          const pos = openPositions[pair];
          if (!pos) continue;
          
          const ticker = summaries[pair];
          if (!ticker) continue;
          const currentPrice = Number(ticker.last);

          // PREDATOR EXIT MANAGER 2.0
          const update = ExitManager2.monitor(currentPrice, pos.entryPrice, pos.sl || pos.entryPrice * 0.95, pos.tpHits || []);

          if (update.shouldClose) {
            const coin = pair.split('_')[0];
            const realAmount = parseFloat(balances[coin] || "0");
            if (realAmount <= 0) {
              delete engine.state.openPositions[pair];
              continue;
            }

            console.log(`\n🚨 [PREDATOR EXIT] ${pair.toUpperCase()} Reason: ${update.closeReason} @ Rp ${currentPrice.toLocaleString()}`);
            await engine.executeSell(pair, realAmount);
            await DBBridge.logActivity('TRADE', `🔴 PREDATOR EXIT: ${pair.toUpperCase()} @ Rp ${currentPrice.toLocaleString()} (${update.closeReason})`);
            
            const grossPnlPercent = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
            const realizedPnlIdr = (grossPnlPercent / 100) * pos.amountIdr;
            await (prisma as any).analysis.updateMany({
              where: { assetName: pair, status: 'TRADING' },
              data: { status: grossPnlPercent > 0 ? 'PROFIT' : 'LOSS', pnlPercent: parseFloat(grossPnlPercent.toFixed(2)), realizedPnlIdr: Math.round(realizedPnlIdr), exitPrice: currentPrice }
            });
            continue;
          }

          if (update.newSL) {
            engine.state.openPositions[pair].sl = update.newSL;
            console.log(`🛡️ [PREDATOR SL] ${pair.toUpperCase()} Moved to Rp ${update.newSL.toLocaleString()} (${update.closeReason})`);
          }

          if (update.tpHit) {
            const coin = pair.split('_')[0];
            const realAmount = parseFloat(balances[coin] || "0");
            
            if (update.tpHit === 1 && !(pos.tpHits || []).includes(1)) {
              console.log(`💵 [PREDATOR TP1] ${pair.toUpperCase()} Hit! Selling 50%...`);
              await engine.executeSell(pair, realAmount * 0.5);
              // Guard: posisi mungkin sudah dihapus oleh executeSell jika amount terlalu kecil
              if (engine.state.openPositions[pair]) {
                if (!engine.state.openPositions[pair].tpHits) engine.state.openPositions[pair].tpHits = [];
                engine.state.openPositions[pair].tpHits?.push(1);
              }
            } else if (update.tpHit === 2 && !(pos.tpHits || []).includes(2)) {
              console.log(`💵 [PREDATOR TP2] ${pair.toUpperCase()} Hit! Selling 50% of remaining...`);
              await engine.executeSell(pair, realAmount * 0.5);
              if (engine.state.openPositions[pair]) {
                if (!engine.state.openPositions[pair].tpHits) engine.state.openPositions[pair].tpHits = [];
                engine.state.openPositions[pair].tpHits?.push(2);
              }
            }
          }
        }
      } catch (e: any) {
        console.error(`⚠️ [MICRO-CYCLE] Predator Monitor Error: ${e.message}`);
      }
      (engine as any).saveState();
    };

    // Jalankan siklus pertama
    runAutopilotCycle();

    // Jalankan AI Cycle setiap 30 menit
    setInterval(runAutopilotCycle, 1800000);
    
    // Jalankan Micro-Cycle setiap 30 detik (Flash Crash Guardian)
    setInterval(runMicroCycle, 30000);
    console.log(`⚡ [MICRO-CYCLE] Flash Crash Guardian aktif — memantau SL/TP setiap 30 detik.`);

    return;
  }

  // 6. MANUAL BUY COMMAND
  if (command === 'buy') {
    const pair = args[1];
    const amount = parseInt(args[2]);

    if (!pair || !amount) {
      console.log('❌ Penggunaan: npm run bot -- buy <pair> <amount_idr>');
      console.log('Contoh: npm run bot -- buy fet_idr 20000');
      process.exit(1);
    }

    console.log(`🚀 Memulai eksekusi beli manual untuk ${pair} sebesar Rp ${amount.toLocaleString()}...`);
    try {
      await engine.executeBuy(pair, amount);
    } catch (err) {
      // Error sudah di-log di executeBuy
    }
    process.exit(0);
  }


  // 3. PRIVATE API TEST (Requires real keys)
  if (command === 'check-api') {
    if (apiKey === 'mock_key' || apiKey === 'your_api_key_here') {
      console.log('❌ Keys not found. Please fill in INDODAX_API_KEY in .env');
      process.exit(1);
    }
    console.log('📡 Testing Private API connection...');
    try {
      const info = await engine.client.getInfo();
      console.log('✅ Connection Successful!');
      
      let totalIdr = parseInt(info.balance.idr || '0');
      let holdIdr = parseInt(info.balance_hold?.idr || '0');
      let totalAssetValueIdr = totalIdr + holdIdr;
      
      console.log('💰 Saldo Rupiah Tunai (IDR): Rp', totalIdr.toLocaleString('id-ID'));
      if (holdIdr > 0) {
        console.log('⏳ Saldo Rupiah Tertahan (Open Order): Rp', holdIdr.toLocaleString('id-ID'));
      }
      
      console.log('\n📊 Rincian Aset Koin Anda:');
      
      const allCoins = new Set([...Object.keys(info.balance), ...Object.keys(info.balance_hold || {})]);
      
      for (const coin of allCoins) {
        if (coin === 'idr') continue;
        
        const available = parseFloat((info.balance[coin] as string) || '0');
        const hold = parseFloat((info.balance_hold?.[coin] as string) || '0');
        const totalCoin = available + hold;
        
        if (totalCoin > 0) {
          try {
            const ticker = await IndodaxPublicAPI.getTicker(`${coin}_idr`);
            const currentPrice = parseInt(ticker.ticker.last);
            const estimatedValue = currentPrice * totalCoin;
            
            totalAssetValueIdr += estimatedValue;
            
            let holdText = hold > 0 ? ` (+${hold} sedang di antrean)` : '';
            console.log(`- ${coin.toUpperCase()}: ${available} koin${holdText} | Harga: Rp ${currentPrice.toLocaleString('id-ID')} -> Nilai: Rp ${Math.round(estimatedValue).toLocaleString('id-ID')}`);
          } catch (e) {
            let holdText = hold > 0 ? ` (+${hold} sedang di antrean)` : '';
            console.log(`- ${coin.toUpperCase()}: ${available} koin${holdText} (Tidak ada market IDR)`);
          }
        }
      }

      console.log(`\n💎 ESTIMASI TOTAL ASET (Semua Koin + IDR): Rp ${Math.round(totalAssetValueIdr).toLocaleString('id-ID')}`);
      
    } catch (e: any) {
      console.log('❌ Connection Failed:', e.message);
    }
    process.exit(0);
  }

  console.log(`Unknown command: ${command}. Type 'npm run bot -- help'`);
}

runCLI();
