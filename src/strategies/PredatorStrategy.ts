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
    
    // 5. Narrative & Whale Action
    const [narrativeScore, whale] = await Promise.all([
      NarrativeEngine.getNarrativeScore(pair),
      WhaleDetector.detect(pair)
    ]);

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
    confidenceScore += (consensus.finalScore / 100) * 25;        // AI Consensus  (Max 25) — diturunkan dari 30
    confidenceScore += (Math.min(smc.smcScore, SMC_MAX) / SMC_MAX) * 15; // SMC (Max 15)
    confidenceScore += (narrativeScore / 100) * 15;              // Narrative     (Max 15) — diturunkan dari 20
    confidenceScore += (sniper.confidence / 100) * 15;           // Sniper        (Max 15)
    confidenceScore += (whale.isWhaleActive ? 15 : 0);           // Whale Bonus   (Max 15)
    confidenceScore += Math.min(memeBoost, 10);                  // Meme Bonus    (Max 10)
    confidenceScore += (alphaHunterScore / 100) * 20;            // AlphaHunter Technical (Max 20)
    // Total max = 25+15+15+15+15+10+20 = 115 → capped 100

    let finalScore = Math.min(100, confidenceScore);
    // Regime bias: hanya ±3 agar tidak mendistorsi terlalu jauh
    if (regime === MarketRegime.WAR) finalScore = Math.min(100, finalScore + 3);
    if (regime === MarketRegime.DEFENSE) finalScore = Math.max(0, finalScore - 3);

    // 8. TIERED EXECUTION ENGINE (Phase 5.2)
    const entryPrice = sniper.entryPrice || aiResults[0]?.precise_entry || 0;
    const plan = ExitManager2.calculateInitialPlan(entryPrice);

    // Threshold disesuaikan per regime
    const isMemeManiaPhase = narrativeScore >= 70;
    const marketBuyThreshold = regime === MarketRegime.PREDATOR ? 75 : 68;
    const limitEntryThreshold = isMemeManiaPhase ? 50 :   // naik dari 42
                                regime === MarketRegime.PREDATOR ? 68 :
                                regime === MarketRegime.WAR ? 55 : 60; // naik dari 50/55
    const scoutEntryThreshold = 45; // naik dari 38

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

    return { 
      shouldBuy: false, 
      action: 'SNIPER_WATCHLIST',
      reason: `👀 WATCH: Score ${finalScore.toFixed(0)} | ${smc.summary}`, 
      score: finalScore 
    };

    return { 
      shouldBuy: false, 
      action: 'SKIP',
      reason: `Score ${finalScore.toFixed(0)} < 60 (Weak Alpha)`, 
      score: finalScore 
    };
  }
}
