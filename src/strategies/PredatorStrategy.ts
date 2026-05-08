import { MarketRegime, MacroRegimeEngine } from '../predator/macro';
import { DynamicScanner } from '../predator/scanner';
import { SMCEngine } from '../predator/smc';
import { MemeRadar } from '../predator/memeRadar';
import { AIWarConsensus } from '../predator/aiWar';
import { SniperEntry } from '../predator/sniper';
import { ExitManager2 } from '../predator/exit2';
import { EmergencyShield } from '../predator/shield';
import { AIResult } from '../ai/AISentinel';
import { NarrativeEngine } from '../narrative/engine';
import { WhaleDetector } from '../modules/market/WhaleDetector';
import { MarketIntelligence } from '../scanner/MarketIntelligence';
import { ProbabilityEngine } from '../modules/ai/ProbabilityEngine';

export class PredatorStrategy {
  /**
   * Main Brain for Phase 4 Predator Mode
   */
  public async evaluateTrade(pair: string, aiResults: AIResult[], alphaHunterScore: number = 0): Promise<{
    shouldBuy: boolean;
    action: 'MARKET_BUY' | 'LIMIT_ENTRY' | 'SNIPER_WATCHLIST' | 'SKIP';
    reason: string;
    score: number;
    targets?: { sl: number; tp1: number; tp2: number; tp3: number };
    sizeMultiplier?: number;
  }> {
    // 1. Emergency Check
    const emergency = await EmergencyShield.checkGlobalEmergency();
    if (emergency.isEmergency) {
      return { shouldBuy: false, action: 'SKIP', reason: emergency.reason || 'Global Emergency', score: 0 };
    }

    // 2. Macro Regime
    const { regime } = await MacroRegimeEngine.getCurrentRegime();
    
    // 3. AI Consensus
    const consensus = AIWarConsensus.calculateConsensus(aiResults);
    
    // 4. Technical Analysis (SMC + Sniper)
    const [smc, sniper] = await Promise.all([
      SMCEngine.analyze(pair),
      SniperEntry.scan(pair)
    ]);
    
    // 5. Narrative, Whale, dan Orderbook Microstructure
    const [narrativeScore, whale, ob] = await Promise.all([
      NarrativeEngine.getNarrativeScore(pair),
      WhaleDetector.detect(pair),
      MarketIntelligence.analyzeOrderbook(pair)
    ]);

    // EXECUTION GUARD: Jika ada absorption atau spoof, skip entry
    if (ob.isAbsorbing && ob.hasSpoofWall) {
      return { shouldBuy: false, action: 'SKIP', reason: `🚨 Market Manipulation: Absorption + Spoof Wall terdeteksi`, score: 0 };
    }
    if (ob.hasSpoofWall) {
      return { shouldBuy: false, action: 'SKIP', reason: `🚨 Spoof Wall terdeteksi — kemungkinan trap`, score: 0 };
    }

    // 6. Meme Boost
    let memeBoost = 0;
    if (MemeRadar.isMeme(pair)) {
      const radar = await MemeRadar.analyzeMemeRotation();
      memeBoost = radar.boosts[pair] || 0;
    }

    // 7. Confidence Matrix — semua komponen dinormalisasi ke range 0-100 sebelum diberi bobot
    // smcScore max = 80 (20+15+25+10+10), bukan 100
    const SMC_MAX = 80;
    let confidenceScore = 0;
    confidenceScore += (consensus.finalScore / 100) * 25;   // AI Consensus: Increased to 25% (was 10%)
    confidenceScore += (Math.min(smc.smcScore, SMC_MAX) / SMC_MAX) * 10; // SMC: Reduced to 10% (was 25%)
    confidenceScore += (narrativeScore / 100) * 10;         // Narrative: 10%
    confidenceScore += (sniper.confidence / 100) * 10;      // Sniper: 10%
    confidenceScore += (whale.isWhaleActive ? 15 : 0);      // Whale: 15%
    confidenceScore += Math.min(memeBoost, 5);              // Meme Boost: 5%
    confidenceScore += (alphaHunterScore / 100) * 25;       // AlphaHunter: 25%
    confidenceScore += (ob.obScore / 20) * 10;              // OB Score: 10%
    
    // BONUS: Jika koin ini adalah kandidat utama AlphaHunter, beri booster +10
    if (alphaHunterScore > 60) confidenceScore += 10;

    let finalScore = Math.min(100, confidenceScore);
    // Regime bias: Lebih berani di kondisi apapun
    if (regime === MarketRegime.WAR) finalScore = Math.min(100, finalScore + 5);
    // Agresif di DEFENSE (was +2)
    if (regime === MarketRegime.DEFENSE) finalScore = Math.min(100, finalScore + 5); 

    // 8. TIERED EXECUTION ENGINE (Phase 5.2)
    const entryPrice = sniper.entryPrice || aiResults[0]?.precise_entry || 0;
    // Jika entry dari AI/sniper tidak valid, fetch harga live
    let resolvedEntry = entryPrice;
    if (!resolvedEntry || resolvedEntry <= 0) {
      try {
        const { IndodaxPublicAPI } = require('../core/IndodaxPublicAPI');
        const ticker = await IndodaxPublicAPI.getTicker(pair);
        resolvedEntry = parseFloat(ticker.ticker.last);
      } catch { resolvedEntry = 0; }
    }
    const plan = ExitManager2.calculateInitialPlan(resolvedEntry);

    // Threshold disesuaikan per regime (DIREVISI: Ultra Agresif)
    const isMemeManiaPhase = narrativeScore >= 75;
    const marketBuyThreshold = 65;   // Very Aggressive (was 70)
    const limitEntryThreshold = 55;  // Standard (was 60)
    const scoutEntryThreshold = 45;  // Minimum (was 50)

    if (finalScore >= marketBuyThreshold) {
      return {
        shouldBuy: true,
        action: 'MARKET_BUY',
        reason: `🦅 ELITE (100% size): High confidence | ${smc.summary}`,
        score: finalScore,
        targets: plan,
        sizeMultiplier: 1.0
      };
    }

    if (finalScore >= limitEntryThreshold) {
      return {
        shouldBuy: true,
        action: 'LIMIT_ENTRY',
        reason: `🎯 PRO (50% size): Good setup | ${smc.summary}`,
        score: finalScore,
        targets: plan,
        sizeMultiplier: 0.5
      };
    }

    // SCOUT ENTRY: khusus accumulation phase dengan narrative kuat
    if (finalScore >= scoutEntryThreshold && isMemeManiaPhase && smc.premiumDiscount === 'DISCOUNT') {
      return {
        shouldBuy: true,
        action: 'LIMIT_ENTRY',
        reason: `🔭 SCOUT (25% size): Accumulation + Narrative | ${smc.summary}`,
        score: finalScore,
        targets: plan,
        sizeMultiplier: 0.25
      };
    }

    if (finalScore >= 30) { // Aggressive Watchlist (was 40)
      return { 
        shouldBuy: false, 
        action: 'SNIPER_WATCHLIST',
        reason: `👀 WATCH: Score ${finalScore.toFixed(0)} | ${smc.summary}`, 
        score: finalScore 
      };
    }

    return { 
      shouldBuy: false, 
      action: 'SKIP',
      reason: `Score ${finalScore.toFixed(0)} < 30 (Weak Alpha)`, 
      score: finalScore 
    };
  }
}
