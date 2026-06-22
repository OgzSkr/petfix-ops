/** Sync job progress → 0–100 yüzde (UI için). */
export function computeSyncPercent(progress) {
  if (!progress || typeof progress !== 'object') return 0;
  if (Number.isFinite(progress.percent)) {
    return Math.max(0, Math.min(100, Math.round(progress.percent)));
  }
  if (progress.phase === 'done') return 100;
  if (progress.phase === 'save') return 95;
  if (progress.phase === 'start') return 0;

  const page = Number(progress.page);
  const totalPages = Number(progress.totalPages);
  if (Number.isFinite(page) && Number.isFinite(totalPages) && totalPages > 0) {
    const slice = Number(progress.slicePercent) || 90;
    const base = Number(progress.basePercent) || 0;
    const ratio = Math.min(1, Math.max(0, page / totalPages));
    return Math.min(99, Math.round(base + ratio * slice));
  }

  if (progress.phase === 'fetch') return 5;
  return null;
}

export function enrichSyncJobStatus(job) {
  if (!job) {
    return { running: false, percent: 0, progress: null };
  }
  const percent = computeSyncPercent(job.progress);
  return {
    running: Boolean(job.running),
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    result: job.result || null,
    error: job.error || null,
    progress: job.progress || null,
    percent: percent == null ? null : percent
  };
}
