import os from 'node:os';

export class TelemetryCollector {
  static getSystemMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memoryPercent = (usedMem / totalMem) * 100;

    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    const cpuUsage = Math.min(100, Math.max(0, 100 - (totalIdle / totalTick) * 100));

    return {
      hostname: os.hostname(),
      platform: os.platform(),
      cpuUsage: parseFloat(cpuUsage.toFixed(1)),
      memoryUsage: parseFloat(memoryPercent.toFixed(1)),
      uptimeSeconds: os.uptime()
    };
  }

  static async getObsMetrics(obsAdapter) {
    if (!obsAdapter || !obsAdapter.isConnected) {
      return {
        fps: 0,
        cpuUsage: 0,
        droppedFrames: 0,
        outputActive: false
      };
    }

    try {
      const stats = await obsAdapter.getStats();
      return {
        fps: stats.activeFps || 0,
        cpuUsage: stats.cpuUsage || 0,
        droppedFrames: stats.outputSkippedFrames || 0,
        renderTotalFrames: stats.renderTotalFrames || 0
      };
    } catch {
      return {
        fps: 0,
        cpuUsage: 0,
        droppedFrames: 0
      };
    }
  }
}
