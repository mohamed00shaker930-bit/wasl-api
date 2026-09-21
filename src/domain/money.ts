/** numeric(10,2) columns travel as strings through node-postgres; keep the conversion explicit and in one place. */
export const num = (v: string | number | null | undefined): number => (v == null ? 0 : typeof v === "number" ? v : Number(v));
export const money = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);
export const isPositiveMoney = (n: number): boolean => Number.isFinite(n) && n > 0 && Math.round(n * 100) === n * 100;
