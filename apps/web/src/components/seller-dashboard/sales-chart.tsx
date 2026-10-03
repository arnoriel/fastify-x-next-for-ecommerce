"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SalesPoint } from "@ecommerce/shared";
import { formatDayMonth, formatRupiah, formatRupiahCompact } from "@/lib/format";

const TOOLTIP_STYLE = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  color: "var(--fg)",
  fontSize: 13,
} as const;

/** Grafik omzet harian (zero-filled dari API). Dimuat lazy & client-only oleh dashboard-view. */
export function SalesChart({ series }: { series: SalesPoint[] }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Grafik omzet harian">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.45} />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDayMonth}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={formatRupiahCompact}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            width={64}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelFormatter={(label, payload) => {
              const orders = (payload?.[0]?.payload as SalesPoint | undefined)?.orders ?? 0;
              return `${formatDayMonth(String(label))} · ${orders} pesanan`;
            }}
            formatter={(value) => [formatRupiah(Number(value)), "Omzet"]}
          />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="var(--brand)"
            strokeWidth={2}
            fill="url(#revenueFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
