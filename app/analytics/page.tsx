"use client";

import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend
} from "recharts";
import { TrendingUp, TrendingDown, Target, BarChart3, Trophy, AlertTriangle } from "lucide-react";

export default function AnalyticsPage() {
  const [data, setData] = useState<any>(null);
  const [histData, setHistData] = useState<any>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/bot/analytics').then(r => r.json()),
      fetch('/api/bot/history?filter=all&page=1').then(r => r.json()),
    ]).then(([a, h]) => { setData(a); setHistData(h); });
  }, []);

  if (!data || !histData) {
    return <div className="flex items-center justify-center h-64 text-zinc-600 text-sm">Memuat analytics...</div>;
  }

  const { dailyPnl, topPairs } = data;
  const s = histData.summary;

  const pieData = s?.totalTrades > 0 ? [
    { name: 'Profit', value: s.winCount, fill: '#22c55e' },
    { name: 'Loss', value: s.lossCount, fill: '#ef4444' },
  ] : [];

  const avgWin = s?.winCount > 0
    ? histData.trades?.filter((t: any) => t.status === 'PROFIT').reduce((sum: number, t: any) => sum + (t.realizedPnlIdr || 0), 0) / s.winCount
    : 0;
  const avgLoss = s?.lossCount > 0
    ? Math.abs(histData.trades?.filter((t: any) => t.status === 'LOSS').reduce((sum: number, t: any) => sum + (t.realizedPnlIdr || 0), 0) / s.lossCount)
    : 0;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-black uppercase tracking-tight">Analytics</h1>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Trades" value={s?.totalTrades || 0} icon={<BarChart3 className="w-4 h-4" />} />
        <StatCard label="Win Rate" value={`${(s?.winRate || 0).toFixed(1)}%`}
          icon={<Target className="w-4 h-4" />}
          accent={(s?.winRate || 0) >= 50 ? 'green' : 'red'} />
        <StatCard label="Avg Win" value={`Rp ${Math.round(avgWin).toLocaleString('id-ID')}`}
          icon={<TrendingUp className="w-4 h-4" />} accent="green" />
        <StatCard label="Avg Loss" value={`-Rp ${Math.round(avgLoss).toLocaleString('id-ID')}`}
          icon={<TrendingDown className="w-4 h-4" />} accent="red" />
      </div>

      {/* PnL Chart + Pie */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* Bar Chart PnL Harian */}
        <div className="md:col-span-2 rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-black uppercase tracking-widest text-zinc-400">PnL Harian</h2>
            <span className={`text-xs font-black ${(s?.totalPnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              Total: {(s?.totalPnl || 0) >= 0 ? '+' : ''}Rp {Math.round(s?.totalPnl || 0).toLocaleString('id-ID')}
            </span>
          </div>
          {dailyPnl?.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dailyPnl} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#52525b' }} tickFormatter={d => d.slice(5)} />
                <YAxis tick={{ fontSize: 9, fill: '#52525b' }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 11 }}
                  formatter={(v: any) => [`Rp ${Math.round(v).toLocaleString('id-ID')}`, 'PnL']}
                  labelFormatter={l => `Tanggal: ${l}`}
                />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {dailyPnl.map((e: any, i: number) => <Cell key={i} fill={e.pnl >= 0 ? '#22c55e' : '#ef4444'} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-44 text-zinc-600 text-xs">Belum ada data trade</div>
          )}
        </div>

        {/* Pie Chart Win/Loss */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-4">Win vs Loss</h2>
          {pieData.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65}
                    dataKey="value" paddingAngle={3}>
                    {pieData.map((e: any, i: number) => <Cell key={i} fill={e.fill} />)}
                  </Pie>
                  <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 8, fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex justify-center gap-4 mt-2">
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-zinc-400">Profit <span className="text-white font-bold">{s.winCount}</span></span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px]">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-zinc-400">Loss <span className="text-white font-bold">{s.lossCount}</span></span>
                </div>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-44 text-zinc-600 text-xs">Belum ada data</div>
          )}
        </div>
      </div>

      {/* Top Pairs */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
        <h2 className="text-xs font-black uppercase tracking-widest text-zinc-400 mb-4 flex items-center gap-2">
          <Trophy className="w-3.5 h-3.5" /> Performa Per Koin
        </h2>
        {topPairs?.length > 0 ? (
          <div className="space-y-3">
            {topPairs.map((p: any) => {
              const wr = p.total > 0 ? (p.wins / p.total) * 100 : 0;
              return (
                <div key={p.pair} className="grid grid-cols-12 items-center gap-2 text-xs">
                  <span className="col-span-2 font-black uppercase text-zinc-200">{p.pair}</span>
                  <div className="col-span-5 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${p.pnl >= 0 ? 'bg-green-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(100, Math.abs(p.pnl) / Math.max(...topPairs.map((x: any) => Math.abs(x.pnl)), 1) * 100)}%` }} />
                  </div>
                  <span className={`col-span-3 font-bold text-right ${p.pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {p.pnl >= 0 ? '+' : ''}Rp {Math.round(p.pnl).toLocaleString('id-ID')}
                  </span>
                  <span className="col-span-2 text-[9px] text-zinc-500 text-right">
                    {p.wins}W/{p.losses}L ({wr.toFixed(0)}%)
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-zinc-600 text-xs text-center py-6">Belum ada data</p>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, accent = 'zinc' }: { label: string; value: any; icon: any; accent?: string }) {
  const colors: Record<string, string> = {
    green: 'text-green-400 border-green-500/20 bg-green-500/5',
    red: 'text-red-400 border-red-500/20 bg-red-500/5',
    zinc: 'text-zinc-300 border-zinc-800 bg-zinc-900',
  };
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${colors[accent]}`}>
      <div className="flex items-center justify-between opacity-60">{icon}
        <span className="text-[9px] uppercase tracking-widest">{label}</span>
      </div>
      <div className="font-black text-sm text-white">{value}</div>
    </div>
  );
}
