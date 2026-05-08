export interface ExitPlan {
  tp1: number; // +10%
  tp2: number; // +20%
  tp3: number; // +35%
  sl: number;  // -4% initial
}

export interface PositionUpdate {
  shouldClose: boolean;
  closeReason?: string;
  newSL?: number;
  tpHit?: number;
}

export class ExitManager2 {
  public static calculateInitialPlan(entry: number): ExitPlan {
    return {
      tp1: entry * 1.10,
      tp2: entry * 1.20,
      tp3: entry * 1.35,
      sl: entry * 0.96 
    };
  }

  public static monitor(
    currentPrice: number,
    entryPrice: number,
    currentSL: number,
    tpsHit: number[],
    entryTimestamp?: number,
    previousPrice?: number
  ): PositionUpdate {
    const profitPct = (currentPrice - entryPrice) / entryPrice;
    
    // 0. Flash Crash Protection: Jika harga drop > 4% dalam satu siklus
    if (previousPrice && currentPrice < previousPrice * 0.96) {
      return { shouldClose: true, closeReason: 'FLASH_CRASH_DETECTION' };
    }

    // 0.1 Time-based exit: jika posisi stuck > 48 jam tanpa profit, keluar
    if (entryTimestamp) {
      const ageHours = (Date.now() - entryTimestamp) / 3600000;
      if (ageHours > 48 && profitPct < 0.01) {
        return { shouldClose: true, closeReason: 'TIME_EXIT_48H_STUCK' };
      }
    }

    // 1. Check SL
    if (currentPrice <= currentSL) {
      return { shouldClose: true, closeReason: 'STOP_LOSS' };
    }

    // 2. BEP: profit +4% → geser SL ke entry + 0.3%
    if (profitPct >= 0.04 && currentSL < entryPrice) {
      return { shouldClose: false, newSL: entryPrice * 1.003, closeReason: 'MOVE_TO_BEP' };
    }

    // 3. Dynamic Trailing: 
    // Jika sudah TP1 (+10%), SL mengikuti di -5% dari High (currentPrice)
    if (tpsHit.includes(1)) {
      const dynamicSL = currentPrice * 0.95; 
      if (dynamicSL > currentSL) {
        return { shouldClose: false, newSL: dynamicSL, closeReason: 'DYNAMIC_TRAILING' };
      }
    } else if (profitPct >= 0.07 && currentSL < entryPrice * 1.02) {
      // Semi-Trailing sebelum TP1
      return { shouldClose: false, newSL: entryPrice * 1.02, closeReason: 'PRE_TP1_TRAIL' };
    }

    // 4. Tiered TP Logic
    const plan = this.calculateInitialPlan(entryPrice);
    if (currentPrice >= plan.tp1 && !tpsHit.includes(1)) {
      return { shouldClose: false, tpHit: 1, closeReason: 'TP1_HIT' };
    }
    if (currentPrice >= plan.tp2 && !tpsHit.includes(2)) {
      return { shouldClose: false, tpHit: 2, closeReason: 'TP2_HIT' };
    }
    if (currentPrice >= plan.tp3 && !tpsHit.includes(3)) {
      return { shouldClose: true, tpHit: 3, closeReason: 'TP3_FULL_EXIT' };
    }

    return { shouldClose: false };
  }
}
