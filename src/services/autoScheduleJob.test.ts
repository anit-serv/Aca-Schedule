import { describe, expect, it } from 'vitest';
import { latestAutoScheduleJob, type AutoScheduleJob } from './autoScheduleJob';

describe('auto schedule job state', () => {
  const job = (runId: string, status: AutoScheduleJob['status']): AutoScheduleJob => ({ runId, status });

  it('does not reopen the progress lock when an older poll finishes after completion', () => {
    expect(latestAutoScheduleJob(job('run-1', 'completed'), job('run-1', 'running')).status).toBe('completed');
    expect(latestAutoScheduleJob(job('run-1', 'failed'), job('run-1', 'queued')).status).toBe('failed');
  });

  it('accepts a new run after a previous run completed', () => {
    expect(latestAutoScheduleJob(job('run-1', 'completed'), job('run-2', 'queued')).status).toBe('queued');
  });
});
