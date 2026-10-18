/**
 * This server process's own vital signs, for the admin Streaming tab.
 *
 * Streamy runs on a two-vCPU Lightsail box and pipes every viewer's video
 * through this Node process, so when playback is rough the proxy is one of
 * the suspects. Nothing here needs a cloud API: CPU and memory come from the
 * process, event-loop lag from perf_hooks, and the host's load from os.
 *
 * Readings are over the interval since the previous read, so a panel polling
 * every ten seconds sees the last ten seconds. The first read after start-up
 * has no interval and reports CPU as null.
 */

import os from "node:os";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

export type NodeHealth = {
  /** CPU of one core this process used since the previous read. */
  cpuPct: number | null;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  /** Event-loop delay since the previous read, ms. The p99 is what a stalled proxy chunk feels like. */
  eventLoopP50Ms: number;
  eventLoopP99Ms: number;
  eventLoopMaxMs: number;
  uptimeSeconds: number;
  load1: number;
  hostCores: number;
  hostTotalBytes: number;
  hostFreeBytes: number;
  nodeVersion: string;
};

type State = {
  histogram: ReturnType<typeof monitorEventLoopDelay>;
  lastCpu: NodeJS.CpuUsage | null;
  lastAt: number;
};

const g = globalThis as unknown as { __nodeHealth?: State };

function state(): State {
  if (!g.__nodeHealth) {
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    histogram.enable();
    g.__nodeHealth = { histogram, lastCpu: null, lastAt: performance.now() };
  }
  return g.__nodeHealth;
}

// Touch it at import so the histogram is already running by the first read.
state();

const ns = (v: number) => Math.round(v / 1e4) / 100; // nanoseconds -> ms, two decimals

export function readNodeHealth(): NodeHealth {
  const s = state();
  const now = performance.now();
  const cpu = process.cpuUsage();
  let cpuPct: number | null = null;
  if (s.lastCpu) {
    const elapsedUs = (now - s.lastAt) * 1000;
    const usedUs = cpu.user - s.lastCpu.user + cpu.system - s.lastCpu.system;
    cpuPct = elapsedUs > 0 ? Math.round((usedUs / elapsedUs) * 1000) / 10 : null;
  }
  s.lastCpu = cpu;
  s.lastAt = now;

  const h = s.histogram;
  const out: NodeHealth = {
    cpuPct,
    rssBytes: process.memoryUsage.rss(),
    heapUsedBytes: process.memoryUsage().heapUsed,
    heapTotalBytes: process.memoryUsage().heapTotal,
    eventLoopP50Ms: h.count > 0 ? ns(h.percentile(50)) : 0,
    eventLoopP99Ms: h.count > 0 ? ns(h.percentile(99)) : 0,
    eventLoopMaxMs: h.count > 0 ? ns(h.max) : 0,
    uptimeSeconds: Math.round(process.uptime()),
    load1: Math.round(os.loadavg()[0] * 100) / 100,
    hostCores: os.cpus().length,
    hostTotalBytes: os.totalmem(),
    hostFreeBytes: os.freemem(),
    nodeVersion: process.version,
  };
  h.reset();
  return out;
}
