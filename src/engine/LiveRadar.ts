import { BaseStrategy } from '../strategies/BaseStrategy';
import { IndodaxPublicAPI } from '../core/IndodaxPublicAPI';

export class LiveRadar {
  private activeStrategies: BaseStrategy[] = [];
  private activePairs: Set<string> = new Set();
  private intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  
  // Track previous prices for Event-Based Spike Detection (Whale Detection)
  private previousPrices: Record<string, number> = {};

  /**
   * @param intervalMs Interval pengecekan dalam milidetik (Default: 5000ms = 5 detik)
   */
  constructor(intervalMs: number = 5000) {
    this.intervalMs = intervalMs;
  }

  public registerStrategy(strategy: BaseStrategy, pair: string) {
    this.activeStrategies.push(strategy);
    this.activePairs.add(pair);
    console.log(`📡 Registered Strategy: ${strategy.name} for pair ${pair}`);
  }

  public start() {
    if (this.activeStrategies.length === 0) {
      // console.warn('⚠️ Tidak ada strategy yang diregister ke Radar. Radar tidak diaktifkan.');
      return;
    }

    console.log(`\n======================================`);
    console.log(`👁️  LIVE RADAR & EVENT LISTENER DIAKTIFKAN`);
    console.log(`⏱️  Memindai & Melacak Anomali Harga setiap ${this.intervalMs / 1000} detik`);
    console.log(`======================================\n`);

    this.timer = setInterval(() => this.scan(), this.intervalMs);
    // Run first scan immediately
    this.scan();
  }

  public stop() {
    if (this.timer) {
      clearInterval(this.timer);
      console.log('🛑 Live Radar Dihentikan.');
    }
  }

  private async scan() {
    for (const pair of this.activePairs) {
      try {
        const ticker = await IndodaxPublicAPI.getTicker(pair);
        const currentSellPrice = parseInt(ticker.ticker.sell); // Harga kita beli
        const currentBuyPrice = parseInt(ticker.ticker.buy);   // Harga kita jual

        const time = new Date().toLocaleTimeString();

        // 🔥 EVENT-BASED TRADING: Whale Spike Detection
        if (this.previousPrices[pair]) {
          const prevPrice = this.previousPrices[pair];
          const priceChangePercent = ((currentSellPrice - prevPrice) / prevPrice) * 100;
          
          if (priceChangePercent >= 1.0) {
            console.log(`\n🚨 [WHALE ALERT] ${pair.toUpperCase()} Melonjak +${priceChangePercent.toFixed(2)}% dalam ${this.intervalMs/1000} detik!`);
            console.log(`💡 Event Triggered: Menyiapkan protokol Breakout...`);
          } else if (priceChangePercent <= -1.0) {
            console.log(`\n🩸 [PANIC DUMP ALERT] ${pair.toUpperCase()} Anjlok ${priceChangePercent.toFixed(2)}% dalam ${this.intervalMs/1000} detik!`);
            console.log(`💡 Event Triggered: Menyiapkan protokol Buy The Dip / Cutloss darurat...`);
          }
        }
        this.previousPrices[pair] = currentSellPrice;

        // Output "Heartbeat" normal
        console.log(`[${time}] 👁️ RADAR: ${pair.toUpperCase()} | Beli: Rp${currentSellPrice.toLocaleString()} | Jual: Rp${currentBuyPrice.toLocaleString()}`);

        // Check all strategies waiting for this pair
        for (const strategy of this.activeStrategies) {
          // Pass `currentSellPrice` as approximation for current market eval
          const signal = await strategy.evaluate(pair, currentSellPrice);
          if (signal.action !== 'HOLD') {
            process.stdout.write('\n'); // Clear current line
            await strategy.executeSignal(signal);
            
            // Note: After execution, you might want to remove strategy if COMPLETED
          }
        }
      } catch (e: any) {
        console.error(`\n[RADAR ERROR] Gagal scan ${pair}: ${e.message}`);
      }
    }
  }
}
