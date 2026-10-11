import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export function kgToLb(kg: number): number {
  return kg * 2.2046226218;
}

export function lbToKg(lb: number): number {
  return lb / 2.2046226218;
}

export function cmToIn(cm: number): number {
  return cm / 2.54;
}

export function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

export function formatWeight(kg: number, units: "metric" | "imperial"): string {
  if (kg <= 0) return "BW";
  if (units === "imperial") {
    const lb = roundTo(kgToLb(kg), 0.5);
    return `${trimNum(lb)} lb`;
  }
  return `${trimNum(roundTo(kg, 0.5))} kg`;
}

export function formatWaist(inches: number, units: "metric" | "imperial"): string {
  if (units === "metric") {
    return `${trimNum(roundTo(inches * 2.54, 0.5))} cm`;
  }
  return `${trimNum(roundTo(inches, 0.1))} in`;
}

export function trimNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1).replace(/\.0$/, "");
}

export function todayISO(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
