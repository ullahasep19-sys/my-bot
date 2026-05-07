export interface RiskConfig {
  maxPositionSizePercent: number; // e.g., 10 for 10% of total balance
  maxDrawdownDailyPercent: number; // e.g., 5 for 5% max loss per day
  defaultStopLossPercent?: number; // e.g., 2 for 2% SL
}

export class RiskManager {
  private config: RiskConfig;
  private dailyLoss: number = 0;
  private consecutiveLosses: number = 0;
  private lastLossTime: number = 0;
  private readonly STRIKE_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 jam cooldown // 3-Strike Rule
  private lastResetDate: string = new Date().toDateString();

  constructor(config: RiskConfig) {
    this.config = config;
  }

  private checkAndResetDailyLoss() {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.dailyLoss = 0;
      this.lastResetDate = today;
      console.log(`🔄 [RISK ENGINE] Daily Loss direset untuk hari baru (${today}).`);
    }
  }

  /**
   * Reality Engine: Execution Guard
   * Modal kecil sensitif terhadap fee dan spread.
   */
  public validateExecution(askPrice: number, bidPrice: number): boolean {
    const spread = ((askPrice - bidPrice) / bidPrice) * 100;
    if (spread > 0.8) {
      console.warn(`⚠️ [EXECUTION GUARD] Spread terlalu tinggi (${spread.toFixed(2)}% > 0.8%). Batal entry untuk mencegah slippage fatal.`);
      return false;
    }
    return true;
  }

  public validateTradeSize(totalBalance: number, tradeAmount: number): boolean {
    const maxAllowedSize = totalBalance * (this.config.maxPositionSizePercent / 100);
    
    if (tradeAmount > maxAllowedSize) {
      console.warn(`⚠️ Risk Manager: Trade size (${tradeAmount}) exceeds max allowed (${maxAllowedSize}).`);
      return false;
    }

    return true;
  }

  public calculatePositionSize(totalBalance: number, entryPrice: number, stopLoss: number, riskPercent: number = 1): number {
    const riskAmount = totalBalance * (riskPercent / 100);
    const slDistancePercent = Math.abs(entryPrice - stopLoss) / entryPrice;
    
    if (slDistancePercent <= 0) return 0;
    
    let optimalAllocationIdr = riskAmount / slDistancePercent;
    
    const maxAllowedSize = totalBalance * (this.config.maxPositionSizePercent / 100);
    if (optimalAllocationIdr > maxAllowedSize) {
      optimalAllocationIdr = maxAllowedSize;
    }
    
    return Math.floor(optimalAllocationIdr);
  }

  /**
   * KILL SWITCH (Tier 1 Wajib & 3-Strike Rule)
   */
  public isKillSwitchEngaged(totalBalance: number, btcDropPercent: number = 0, consecutiveApiErrors: number = 0): boolean {
    this.checkAndResetDailyLoss();

    // 1. Max Drawdown Check
    const maxLossAllowed = totalBalance * (this.config.maxDrawdownDailyPercent / 100);
    if (this.dailyLoss >= maxLossAllowed) {
      console.error('\n🛑 [KILL SWITCH] Max Daily Drawdown tercapai! Trading dihentikan sementara hari ini.');
      return true;
    }

    // 2. 3-Strike Rule dengan auto-reset setelah 2 jam cooldown
    if (this.consecutiveLosses >= 3) {
      const timeSinceLastLoss = Date.now() - this.lastLossTime;
      if (timeSinceLastLoss >= this.STRIKE_COOLDOWN_MS) {
        console.log(`✅ [3-STRIKE RESET] 2 jam telah berlalu. Strike counter direset, bot aktif kembali.`);
        this.consecutiveLosses = 0;
      } else {
        const remainingMin = Math.ceil((this.STRIKE_COOLDOWN_MS - timeSinceLastLoss) / 60000);
        console.error(`\n🛑 [3-STRIKE RULE] 3x Loss beruntun. Bot PAUSE. Reset dalam ${remainingMin} menit.`);
        return true;
      }
    }

    // 3. BTC Dump Check (Systemic Risk)
    if (btcDropPercent <= -3.0) {
      console.error(`\n🛑 [SYSTEMIC RISK] BTC Dump ekstrem (${btcDropPercent.toFixed(2)}%). Seluruh trading dihentikan untuk menghindari flash crash.`);
      return true;
    }

    // 4. API Error Streak Check
    if (consecutiveApiErrors >= 5) {
      console.error(`\n🛑 [INFRASTRUCTURE RISK] 5x API Error beruntun. Menghentikan trading untuk menghindari eksekusi membabi buta.`);
      return true;
    }

    return false;
  }

  public recordLoss(lossAmount: number): void {
    this.checkAndResetDailyLoss();
    this.dailyLoss += lossAmount;
    this.consecutiveLosses += 1;
    this.lastLossTime = Date.now();
    console.log(`📉 [RISK ENGINE] Loss tercatat. Streak Loss saat ini: ${this.consecutiveLosses}`);
  }

  public recordWin(): void {
    if (this.consecutiveLosses > 0) {
       console.log(`✅ [RISK ENGINE] Win tercatat. Streak Loss direset ke 0.`);
    }
    this.consecutiveLosses = 0;
  }

  /**
   * CORRELATION GUARD
   * Mencegah bot membeli terlalu banyak koin dari sektor yang sama secara bersamaan.
   */
  public validateCorrelation(pair: string, openPairs: string[]): boolean {
    const memeCoins = [
      'pepe_idr', 'doge_idr', 'shib_idr', 'floki_idr', 'bonk_idr', 'wif_idr',
      'fartcoin_idr', 'pippin_idr', 'zerebro_idr', 'moodeng_idr', 'pengu_idr',
      'brett_idr', 'popcat_idr', 'neiro_idr', 'turbo_idr', 'dogs_idr', 'jellyjelly_idr'
    ];
    const aiCoins = ['fet_idr', 'rndr_idr', 'agix_idr', 'ocean_idr', 'tao_idr', 'near_idr'];
    const l1Coins = ['btc_idr', 'eth_idr', 'sol_idr', 'bnb_idr', 'ada_idr', 'avax_idr'];

    let targetCategory: string[] = [];
    let categoryName = "";

    if (memeCoins.includes(pair)) { targetCategory = memeCoins; categoryName = "MEME"; }
    else if (aiCoins.includes(pair)) { targetCategory = aiCoins; categoryName = "AI"; }
    else if (l1Coins.includes(pair)) { targetCategory = l1Coins; categoryName = "LAYER-1"; }

    if (targetCategory.length > 0) {
      const sameCategoryCount = openPairs.filter(p => targetCategory.includes(p)).length;
      if (sameCategoryCount >= 2) {
        console.warn(`⚠️ [CORRELATION GUARD] Ditolak: Sudah memiliki 2 posisi aktif di sektor ${categoryName}. Diversifikasi diwajibkan.`);
        return false;
      }
    }

    return true;
  }
}
