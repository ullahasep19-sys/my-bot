import axios from 'axios';
import { MarketIntelligence } from '../scanner/MarketIntelligence';

export enum MarketRegime {
  DEFENSE = 'DEFENSE',   // High fear, BTC/ETH focus, tight SL
  WAR = 'WAR',           // Neutral market, swing trade strong alts
  PREDATOR = 'PREDATOR'  // Bullish/Altseason, aggressive on memes/lowcaps
}

export interface MacroMetrics {
  fearAndGreed: number;
  btcDominance: number;
  btcTrend: 'UP' | 'DOWN' | 'SIDEWAYS';
  ethTrend: 'UP' | 'DOWN' | 'SIDEWAYS';
  ethStrength: number;
  altcoinVolume: number;
}

export class MacroRegimeEngine {
  private static FNG_API = 'https://api.alternative.me/fng/';
  private static cachedResult: { regime: MarketRegime; metrics: MacroMetrics } | null = null;
  private static cacheExpiry: number = 0;
  private static readonly CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 jam (bukan 24 jam agar tetap responsif)

  public static async getCurrentRegime(): Promise<{ regime: MarketRegime; metrics: MacroMetrics }> {
    // Return cache jika masih valid
    if (this.cachedResult && Date.now() < this.cacheExpiry) {
      return this.cachedResult;
    }

    try {
      const metrics = await this.fetchMetrics();
      let regime = MarketRegime.WAR;

      // Logic for PREDATOR MODE
      if (metrics.fearAndGreed > 60 && metrics.btcTrend === 'UP') {
        regime = MarketRegime.PREDATOR;
      }
      
      // Logic for DEFENSE MODE
      if (metrics.fearAndGreed < 40 || metrics.btcTrend === 'DOWN') {
        regime = MarketRegime.DEFENSE;
      }

      // Overrides
      if (metrics.fearAndGreed < 25) regime = MarketRegime.DEFENSE; // Extreme Fear
      if (metrics.fearAndGreed > 75) regime = MarketRegime.PREDATOR; // Extreme Greed / Mooning

      const result = { regime, metrics };
      this.cachedResult = result;
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
      return result;
    } catch (error) {
      console.error('Error in MacroRegimeEngine:', error);
      // Fallback to WAR
      return { 
        regime: MarketRegime.WAR, 
        metrics: { 
          fearAndGreed: 50, 
          btcDominance: 50, 
          btcTrend: 'SIDEWAYS',
          ethTrend: 'SIDEWAYS',
          ethStrength: 1, 
          altcoinVolume: 1 
        } 
      };
    }
  }

  private static async fetchMetrics(): Promise<MacroMetrics> {
    const [fngRes, btcTrendRes, ethTrendRes, globalRes] = await Promise.allSettled([
      axios.get(this.FNG_API),
      MarketIntelligence.analyzeTrend('btc_idr'),
      MarketIntelligence.analyzeTrend('eth_idr'),
      axios.get('https://api.coingecko.com/api/v3/global', { timeout: 5000 })
    ]);

    const fearAndGreed = fngRes.status === 'fulfilled' 
      ? parseInt(fngRes.value.data.data[0].value) 
      : 50;

    const btcTrend = btcTrendRes.status === 'fulfilled' 
      ? btcTrendRes.value.trendDaily 
      : 'SIDEWAYS';

    const ethTrend = ethTrendRes.status === 'fulfilled'
      ? ethTrendRes.value.trendDaily
      : 'SIDEWAYS';

    // BTC dominance dari CoinGecko global endpoint
    let btcDominance = 52;
    let altcoinVolume = 1.0;
    if (globalRes.status === 'fulfilled') {
      btcDominance = globalRes.value.data.data?.market_cap_percentage?.btc || 52;
      // altcoin volume proxy: total volume / BTC volume ratio
      const totalVol = globalRes.value.data.data?.total_volume?.usd || 0;
      const btcVol = globalRes.value.data.data?.total_volume?.btc || 1;
      altcoinVolume = totalVol > 0 ? Math.min(3, totalVol / (btcVol * 50000)) : 1.0;
    }

    // ETH strength: ETH dominance relative to BTC dominance
    const ethDominance = globalRes.status === 'fulfilled'
      ? (globalRes.value.data.data?.market_cap_percentage?.eth || 15)
      : 15;
    const ethStrength = btcDominance > 0 ? ethDominance / btcDominance : 1.0;

    return {
      fearAndGreed,
      btcDominance,
      btcTrend,
      ethTrend,
      ethStrength,
      altcoinVolume
    };
  }
}
