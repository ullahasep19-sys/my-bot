"use server";

import { IndodaxClient } from "@/src/core/IndodaxClient";
import { IndodaxPublicAPI } from "@/src/core/IndodaxPublicAPI";
import { prisma } from "@/src/db/prisma";
import { revalidatePath } from "next/cache";

const clientConfig = {
  apiKey: process.env.INDODAX_API_KEY || '',
  secretKey: process.env.INDODAX_SECRET_KEY || ''
};

const getClient = () => new IndodaxClient(clientConfig);

export async function executeSniperAction(analysisId: string) {
  try {
    const analysis = await (prisma as any).analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) return { success: false, message: "Analysis not found" };

    const client = getClient();
    
    // Default: use 2% of equity or fixed amount for MVP
    const amount = 100000; 

    const result = await client.trade(analysis.assetName, 'buy', analysis.entryPrice, amount);
    
    // In src/core/IndodaxClient, if it doesn't throw, it was successful (success: 1)
    await (prisma as any).analysis.update({
      where: { id: analysisId },
      data: { status: 'TRADING' }
    });
    revalidatePath('/');
    return { success: true, message: "Sniper Entry Executed!" };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function panicSellAction(analysisId: string) {
  try {
    const analysis = await (prisma as any).analysis.findUnique({ where: { id: analysisId } });
    if (!analysis) return { success: false, message: "Analysis not found" };

    const client = getClient();
    const info = await client.getInfo();
    const coin = analysis.assetName.split('_')[0];
    const balance = info.balance || {};
    const amount = parseFloat(balance[coin] || "0");

    if (amount <= 0) return { success: false, message: "No balance to sell" };

    const ticker = await IndodaxPublicAPI.getTicker(analysis.assetName);
    const price = parseFloat(ticker.ticker.last);

    await client.trade(analysis.assetName, 'sell', price, amount);
    
    await (prisma as any).analysis.update({
      where: { id: analysisId },
      data: { status: 'PROFIT' } // Marking as finished
    });
    revalidatePath('/');
    return { success: true, message: "Panic Sell Executed!" };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function emergencyExitAll() {
  try {
    const client = getClient();
    const info = await client.getInfo();
    const balances = info.balance || {};
    const summaries = await IndodaxPublicAPI.getAllTickers();
    
    const results = [];
    for (const coin of Object.keys(balances)) {
      if (coin === 'idr') continue;
      const amount = parseFloat(balances[coin] as string);
      if (amount > 0) {
        const pair = `${coin}_idr`;
        const ticker = summaries[pair];
        const price = ticker ? parseFloat(ticker.last) : 0;
        if (price > 0) {
          try {
            await client.trade(pair, 'sell', price, amount);
            results.push({ coin, success: true });
          } catch (err) {
            results.push({ coin, success: false });
          }
        }
      }
    }
    revalidatePath('/');
    return { success: true, results };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function updateBotSettings(data: any) {
  try {
    const settings = await (prisma as any).botSettings.upsert({
      where: { id: "global" },
      update: data,
      create: { id: "global", ...data }
    });
    revalidatePath('/');
    return { success: true, settings };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function toggleBotPower() {
  try {
    const current = await (prisma as any).botSettings.findUnique({ where: { id: "global" } });
    const newState = current ? !current.isBotEnabled : false;
    
    await (prisma as any).botSettings.upsert({
      where: { id: "global" },
      update: { isBotEnabled: newState },
      create: { id: "global", isBotEnabled: newState }
    });
    revalidatePath('/');
    return { success: true, isEnabled: newState };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

export async function forceCloseAction(analysisId: string) {
  try {
    await (prisma as any).analysis.update({
      where: { id: analysisId },
      data: { status: 'CANCELLED' }
    });
    revalidatePath('/');
    return { success: true };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}
