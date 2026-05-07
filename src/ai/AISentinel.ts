import axios from "axios";
import { IndodaxPublicAPI } from "../core/IndodaxPublicAPI";
import { BinancePublicAPI } from "../core/BinancePublicAPI";
import { TradingEngine } from "../engine/TradingEngine";
import { MarketIntelligence } from "../scanner/MarketIntelligence";
import { AIWarConsensus } from "../predator/aiWar";
import { PredatorStrategy } from "../strategies/PredatorStrategy";
import { MacroRegimeEngine } from "../predator/macro";
import { ProbabilityEngine } from "../modules/ai/ProbabilityEngine";
import { CompoundingEngine } from "../engine/Compounding";

export type AIResult = {
  pair: string; 
  is_held: boolean; 
  regime: string;
  structure: string; 
  volume_status: string; 
  momentum: string;
  liquidity: string;
  risk_assessment: string;
  support: number;
  resistance: number;
  precise_entry: number | null;
  precise_sl: number | null;
  precise_tp: number | null;
  action: string;
  score: number;
  confidence: string;
  edge_strength: "Weak" | "Good" | "Elite";
  why_now: string;
};

export class AISentinel {
  private isEnabled = false;
  private interval: NodeJS.Timeout | null = null;
  private targetPairs: string[];
  private engine: TradingEngine;
  private predatorStrategy: PredatorStrategy;
  private compounding: CompoundingEngine;
  
  // Sumopod Only System
  private sumopodKey: string;
  private sumopodBaseUrl: string;
  private freeModels: string[] = [];
  private fallbackModels: string[] = [];
  private currentModelIndex = 0;
  private currentFallbackIndex = 0;
  
  private previousVolumes: Record<string, number> = {};
  private aiMemory: Record<string, string[]> = {};
  public alphaScores: Record<string, number> = {}; // Diisi oleh AlphaHunter di cli.ts

  constructor(engine: TradingEngine, targetPairs: string[] = ["btc_idr", "eth_idr", "fet_idr"]) {
    this.engine = engine;
    this.targetPairs = targetPairs;
    this.predatorStrategy = new PredatorStrategy();
    this.compounding = new CompoundingEngine();

    this.sumopodKey = process.env.SUMOPOD_API_KEY || "";
    this.sumopodBaseUrl = process.env.SUMOPOD_BASE_URL || "https://ai.sumopod.com/v1";
    
    // TIER 1 — Scanner/Enrichment (ultra murah)
    const freeModelsEnv = process.env.SUMOPOD_FREE_MODELS || "qwen/qwen3-30b-a3b-instruct-2507,openai/gpt-oss-20b,MiniMax-M2.7-highspeed";
    this.freeModels = freeModelsEnv.split(',').map(m => m.trim());
    
    // TIER 2 — Consensus/Eksekusi (pintar, akurat) — ini yang dipakai untuk trading decision
    const fallbackEnv = process.env.SUMOPOD_FALLBACK_MODELS || "gemini/gemini-2.0-flash-lite,gpt-5-nano,deepseek-v4-flash";
    this.fallbackModels = fallbackEnv.split(',').map(m => m.trim());

    if (this.sumopodKey) {
      this.isEnabled = true;
      console.log(`🚀 [ALPHA OMEGA] Sumopod Engine Aktif`);
      console.log(`   - Tier 1 (Scanner): ${this.freeModels[0]}`);
      console.log(`   - Tier 2 (Consensus): ${this.fallbackModels[0]}`);
    } else {
      console.error("❌ [CRITICAL] SUMOPOD_API_KEY tidak ditemukan!");
    }
  }

  public start(intervalMs: number = 600000) {
    if (!this.isEnabled) return;
    console.log(`⚡ [SUMOPOD MODE] ONLINE | Interval: ${intervalMs / 60000} menit`);
    this.analyzeMarket();
    this.interval = setInterval(() => this.analyzeMarket(), intervalMs);
  }

  public stop() {
    if (this.interval) clearInterval(this.interval);
  }

  public async analyzePair(pair: string): Promise<AIResult | null> {
    try {
      const isHeld = !!this.engine.state.openPositions[pair];
      const marketData = await this.buildMarketDataForPair(pair);
      
      let result: AIResult | null = null;
      
      // FASE 1: PAID MODELS (FAST)
      let retryPaid = 0;
      while (!result && retryPaid < this.fallbackModels.length) {
        const model = this.fallbackModels[this.currentFallbackIndex];
        try {
          const raw = await this.callSumopodAI(marketData, isHeld, pair, model);
          result = this.parseAI(raw, model);
          if (result) result.pair = pair;
        } catch (e: any) {
          this.rotateFallbackModel();
          retryPaid++;
        }
      }

      // FASE 2: FREE MODELS (FALLBACK)
      if (!result) {
        let retryCount = 0;
        while (!result && retryCount < this.freeModels.length) {
          const model = this.freeModels[this.currentModelIndex];
          try {
            const raw = await this.callSumopodAI(marketData, isHeld, pair, model);
            result = this.parseAI(raw, model);
            if (result) result.pair = pair;
          } catch (e: any) {
            this.rotateFreeModel();
            retryCount++;
          }
        }
      }

      return result;
    } catch (e) {
      return null;
    }
  }

  public async analyzeMarket(): Promise<AIResult[]> {
    const { regime } = await MacroRegimeEngine.getCurrentRegime();
    // Batasi ke top 5 pair per siklus untuk hindari rate limit
    const pairsToAnalyze = this.targetPairs.slice(0, 5);
    console.log(`\n🦅 [PREDATOR MODE] ON | Regime: ${regime} | Target Count: ${pairsToAnalyze.length}`);
    
    const results: AIResult[] = [];
    
    const withTimeout = (promise: Promise<any>, ms: number) => {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms));
      return Promise.race([promise, timeout]);
    };

    const analysisPromises = pairsToAnalyze.map(async (pair, index) => {
      try {
        // Stagger requests: delay 2 detik per pair untuk hindari rate limit
        await new Promise(r => setTimeout(r, index * 2000));
        const isHeld = !!this.engine.state.openPositions[pair];
        const marketData = await this.buildMarketDataForPair(pair);
        
        console.log(`   🤝 [CONSENSUS] Fetching signals for ${pair.toUpperCase()}...`);
        
        const [modelA, modelB] = this.fallbackModels.length >= 2 
          ? [this.fallbackModels[0], this.fallbackModels[1]]
          : [this.fallbackModels[0], this.freeModels[0]];

        const consensusResults = await Promise.allSettled([
          withTimeout(this.callSumopodAI(marketData, isHeld, pair, modelA), 25000),
          withTimeout(this.callSumopodAI(marketData, isHeld, pair, modelB), 25000)
        ]);

        const rawA = consensusResults[0].status === 'fulfilled' ? consensusResults[0].value :
          // Fallback ke free model jika paid timeout
          await this.callSumopodAI(marketData, isHeld, pair, this.freeModels[0]).catch(() => "");
        const rawB = consensusResults[1].status === 'fulfilled' ? consensusResults[1].value :
          await this.callSumopodAI(marketData, isHeld, pair, this.freeModels[1] || this.freeModels[0]).catch(() => "");

        const resA = this.parseAI(rawA as string, modelA);
        const resB = this.parseAI(rawB as string, modelB);
        const aiSignals = [resA, resB].filter(Boolean) as AIResult[];

        if (aiSignals.length === 0) {
          console.log(`   ⚠️ [CONSENSUS] ${pair.toUpperCase()}: Kedua model AI gagal/timeout. Skip pair ini.`);
          return null;
        }
        console.log(`   ✅ [CONSENSUS] ${pair.toUpperCase()}: ${aiSignals.length} sinyal diterima | Avg Score: ${(aiSignals.reduce((s,r)=>s+r.score,0)/aiSignals.length).toFixed(0)}`);

        if (aiSignals.length > 0) {
          const evaluation = await this.predatorStrategy.evaluateTrade(pair, aiSignals, this.alphaScores[pair] || 0);
          
          const sep = '━'.repeat(52);
          const bias = (await MarketIntelligence.analyzeTrend(pair)).alignment;

          console.log(`\n🦅 ${pair.toUpperCase()}`);
          console.log(`   ${sep}`);
          console.log(`   Bias  : ${bias.padEnd(41)}`);
          console.log(`   Tier  : ${evaluation.action.padEnd(41)}`);
          console.log(`   Score : ${evaluation.score.toFixed(1).padEnd(41)}`);
          
          if (evaluation.shouldBuy && evaluation.targets) {
            const t = evaluation.targets;
            const entry = (aiSignals[0]?.precise_entry && aiSignals[0].precise_entry > 0)
          ? aiSignals[0].precise_entry
          : parseFloat((await IndodaxPublicAPI.getTicker(pair)).ticker.last);
            console.log(`   Entry : ${Math.round(entry).toLocaleString().padEnd(41)}`);
            console.log(`   SL    : ${Math.round(t.sl).toLocaleString().padEnd(41)}`);
            console.log(`   TP1   : ${Math.round(t.tp1).toLocaleString().padEnd(41)}`);
            console.log(`   TP2   : ${Math.round(t.tp2).toLocaleString().padEnd(41)}`);
            console.log(`   Status: 💥 ${evaluation.action} — EXECUTING...`.padEnd(42));
            
            if (!isHeld) {
              // Midcap = rank 50-250 (SOL, ADA, XRP, DOGE, AVAX, dll) → Safe Wallet 60%
              // Lowcap = rank 251+ atau meme → Sniper Wallet 40%
              const MIDCAP_PAIRS = ['btc_idr','eth_idr','sol_idr','bnb_idr','xrp_idr','ada_idr',
                                    'avax_idr','dot_idr','matic_idr','link_idr','uni_idr','atom_idr',
                                    'near_idr','op_idr','arb_idr','sui_idr','apt_idr','hype_idr'];
              const isLowCap = !MIDCAP_PAIRS.includes(pair);
              const slDistPct = entry > 0 && t.sl > 0 ? Math.abs((entry - t.sl) / entry) * 100 : 5;
              const totalCapital = await this.engine.calculateTotalEquity();
              const baseSize = this.compounding.getOptimalPositionSize(
                totalCapital, isLowCap, evaluation.score, 2, slDistPct, this.engine.state.recentResults
              );
              const amountIdr = Math.floor(baseSize * (evaluation.sizeMultiplier || 1.0));
              // Eksekusi dilakukan oleh cli.ts untuk menghindari double-buy
              console.log(`   Size  : Rp ${amountIdr.toLocaleString()} (dieksekusi via cli)`.padEnd(42));
            }
          } else {
            console.log(`   Status: ⚖️ ${evaluation.action} — ${evaluation.reason.substring(0, 30)}`);
          }
          console.log(`   ${sep}`);

          if (evaluation.shouldBuy) {
            const finalRes = aiSignals[0];
            finalRes.score = evaluation.score;
            finalRes.pair = pair;
            return finalRes;
          }
        }
        return null;
      } catch (e: any) {
        console.error(`   ❌ Error menganalisa ${pair}:`, e.message);
        return null;
      }
    });

    const settledResults = await Promise.all(analysisPromises);
    for (const res of settledResults) {
      if (res) results.push(res);
    }
    
    return results;
  }

  private rotateFreeModel() {
    this.currentModelIndex = (this.currentModelIndex + 1) % this.freeModels.length;
  }

  private rotateFallbackModel() {
    this.currentFallbackIndex = (this.currentFallbackIndex + 1) % this.fallbackModels.length;
  }

  private async callSumopodAI(marketData: string, isHeld: boolean, pair: string, model: string): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await axios.post(
          `${this.sumopodBaseUrl}/chat/completions`,
          {
            model: model,
            messages: [{ role: "user", content: this.buildPrompt(marketData, isHeld, pair) }],
            temperature: 0.2
          },
          { 
            headers: { 'Authorization': `Bearer ${this.sumopodKey}` },
            timeout: 45000 
          }
        );
        return res.data.choices?.[0]?.message?.content || "";
      } catch (e: any) {
        if (e?.response?.status === 429 && attempt < 2) {
          await new Promise(r => setTimeout(r, (attempt + 1) * 5000)); // 5s, 10s backoff
          continue;
        }
        throw e;
      }
    }
    return "";
  }

  private async processAIResult(res: AIResult) {
    const score = res.score;
    const action = res.action;
    
    console.log(`\n┌────────────────────────────────────────────────────┐`);
    console.log(`│  ALPHA SIGNAL: ${res.pair.toUpperCase().padEnd(35)} │`);
    console.log(`│  REGIME      : ${res.regime.padEnd(35)} │`);
    console.log(`│  CONFIDENCE  : ${res.confidence.padEnd(35)} │`);
    console.log(`│  SCORE       : ${score.toString().padEnd(35)} │`);
    
    if (action === 'BUY' && score >= 42) {
      console.log(`│  STATUS : 🟢 HIGH CONVICTION BUY                     │`);
      const totalCapital = await this.engine.calculateTotalEquity();
      const MIDCAP_PAIRS = ['btc_idr','eth_idr','sol_idr','bnb_idr','xrp_idr','ada_idr',
                            'avax_idr','dot_idr','matic_idr','link_idr','uni_idr','atom_idr',
                            'near_idr','op_idr','arb_idr','sui_idr','apt_idr','hype_idr'];
      const isLowCap = !MIDCAP_PAIRS.includes(res.pair);
      const entry = res.precise_entry || 0;
      const sl = res.precise_sl || entry * 0.95;
      const slDistPct = entry > 0 ? Math.abs((entry - sl) / entry) * 100 : 5;
      const amountIdr = this.compounding.getOptimalPositionSize(
        totalCapital, isLowCap, score, 2, slDistPct, this.engine.state.recentResults
      );
      if (amountIdr >= 10000) {
        await this.engine.executeBuy(res.pair, amountIdr, entry, {
          sl,
          tp1: res.precise_tp || entry * 1.1,
          tp2: (res.precise_tp || entry * 1.1) * 1.5
        });
      }
    } else {
      console.log(`│  STATUS : ⚖️  ${action.padEnd(38)} │`);
    }
    console.log(`└────────────────────────────────────────────────────┘`);
  }

  private async buildMarketDataForPair(pair: string): Promise<string> {
    const ticker = await IndodaxPublicAPI.getTicker(pair);
    const trend = await MarketIntelligence.analyzeTrend(pair);
    const ob = await MarketIntelligence.analyzeOrderbook(pair);
    
    return `
      Pair: ${pair.toUpperCase()}
      Price: Rp ${ticker.ticker.last}
      24h High/Low: ${ticker.ticker.high} / ${ticker.ticker.low}
      Spread: ${((Number(ticker.ticker.sell) - Number(ticker.ticker.buy)) / Number(ticker.ticker.sell) * 100).toFixed(2)}%
      Trend: ${trend.alignment} (Score: ${trend.trendScore})
      RSI: ${trend.rsiRegime}
      Orderbook: ${ob.summary} (Score: ${ob.obScore})
    `.trim();
  }

  private buildPrompt(data: string, isHeld: boolean, pair: string): string {
    const isMemeOrAI = pair.includes('doge') || pair.includes('pepe') || pair.includes('fet') || pair.includes('pippin') || pair.includes('fartcoin') || pair.includes('zerebro');
    const booster = isMemeOrAI ? "Koin ini berada dalam narasi panas (Meme/AI). Cari alasan untuk BUY jika setup teknikal mendukung (Bullish/Lean Bullish/Mixed)." : "";

    return `
      Kamu adalah Alpha Hunter AI, spesialis Quant Trading.
      Tugas: Berikan analisa trading presisi untuk ${pair.toUpperCase()}.
      
      DATA PASAR:
      ${data}
      
      ${booster}
      
      ATURAN SKORING:
      - 80-100: Setup Elite (High Probability).
      - 60-79: Setup Valid (Good R:R).
      - 40-59: Konsolidasi/Wait.
      - 0-39: Bearish/Berisiko.
      
      RESPON DALAM JSON SAJA:
      {
        "action": "BUY" | "SELL" | "AVOID",
        "score": number,
        "regime": "BULLISH" | "SIDEWAYS" | "BEARISH",
        "confidence": "HIGH" | "MID" | "LOW",
        "precise_entry": number,
        "precise_sl": number,
        "precise_tp": number,
        "why_now": "alasan singkat 1 kalimat"
      }
    `.trim();
  }

  private parseAI(raw: string, modelName: string): AIResult | null {
    try {
      const clean = raw.replace(/```json/g, '').replace(/```/g, '').trim();
      const match = clean.match(/\{[\s\S]*\}/);
      return match ? JSON.parse(match[0]) : null;
    } catch {
      return null;
    }
  }
}
