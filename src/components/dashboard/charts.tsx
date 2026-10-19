"use client";

import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const rs = (v: number) => `Rs ${Math.round(v).toLocaleString("en-US")}`;
const compact = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v));

const trendConfig = {
  shared: { label: "Shared expenses", color: "var(--chart-1)" },
  collected: { label: "Payments approved", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function TrendChart({ data, sharedLabel }: { data: { month: string; shared: number; collected: number }[]; sharedLabel?: string }) {
  const config = { ...trendConfig, shared: { ...trendConfig.shared, label: sharedLabel ?? trendConfig.shared.label } };
  return (
    <ChartContainer config={config} className="aspect-auto h-64 w-full" role="img" aria-label="Monthly shared expenses compared with approved payments">
      <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 20, left: 0, right: 4 }}>
        <CartesianGrid vertical={false} strokeDasharray="0" stroke="var(--border)" />
        <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} fontSize={12} />
        <YAxis tickLine={false} axisLine={false} width={40} tickFormatter={compact} fontSize={12} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent formatter={(v, name) => (
          <div className="flex w-full items-center justify-between gap-4">
            <span className="text-muted-foreground">{config[name as keyof typeof config]?.label}</span>
            <span className="num font-medium text-foreground">{rs(Number(v))}</span>
          </div>
        )} />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="shared" fill="var(--color-shared)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="collected" fill="var(--color-collected)" radius={[4, 4, 0, 0]} maxBarSize={28}>
          <LabelList dataKey="collected" position="top" className="fill-muted-foreground" fontSize={10} formatter={(v: unknown) => (Number(v) > 0 ? compact(Number(v)) : "")} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}

const categoryConfig = { value: { label: "Amount", color: "var(--chart-1)" } } satisfies ChartConfig;

export function CategoryChart({ data }: { data: { name: string; value: number }[] }) {
  const height = Math.max(160, data.length * 34 + 16);
  return (
    <ChartContainer config={categoryConfig} className="aspect-auto w-full" style={{ height }} role="img" aria-label="Spending by category">
      <BarChart data={data} layout="vertical" margin={{ left: 0, right: 64, top: 0, bottom: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide />
        <YAxis type="category" dataKey="name" width={132} tickLine={false} axisLine={false} fontSize={12} />
        <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.6 }} content={<ChartTooltipContent hideLabel={false} formatter={(v) => <span className="num font-medium">{rs(Number(v))}</span>} />} />
        <Bar dataKey="value" fill="var(--color-value)" radius={[0, 4, 4, 0]} maxBarSize={22}>
          <LabelList dataKey="value" position="right" className="fill-foreground" fontSize={12} formatter={(v: unknown) => rs(Number(v))} />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
