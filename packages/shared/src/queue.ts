import { Queue, Worker } from 'bullmq';
import type { DefaultJobOptions, Processor } from 'bullmq';
import type { Redis } from 'ioredis';

export const QUEUE_NAMES = ['ingest-p0', 'ingest-p1', 'ingest-p2', 'mcp-dispatch'] as const;
export type QueueName = (typeof QUEUE_NAMES)[number];

const DEFAULT_JOB_OPTIONS: Record<QueueName, DefaultJobOptions> = {
  'ingest-p0': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
  'ingest-p1': {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
  'ingest-p2': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: false,
  },
  'mcp-dispatch': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: true,
    removeOnFail: false,
  },
};

function isKnownQueue(name: string): name is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(name);
}

/**
 * Create a BullMQ Queue. If the name is one of the well-known queue names,
 * per-queue defaults from the spec are applied automatically.
 */
export function createQueue<DataT = unknown, ReturnT = unknown, NameT extends string = string>(
  name: string,
  connection: Redis,
): Queue<DataT, ReturnT, NameT> {
  const defaults = isKnownQueue(name) ? DEFAULT_JOB_OPTIONS[name] : {};
  const queue = new Queue<DataT, ReturnT, NameT>(name, {
    connection,
    defaultJobOptions: defaults,
  });
  queue.on('error', (err: Error) => {
    console.error(`[queue:${name}] ${err.message}`);
  });
  return queue;
}

/**
 * Create a BullMQ Worker. The `processor` is invoked per job. Error events
 * are logged rather than thrown, so a bad job cannot crash the worker loop.
 */
export function createWorker<DataT = unknown, ReturnT = unknown, NameT extends string = string>(
  name: string,
  processor: Processor<DataT, ReturnT, NameT>,
  connection: Redis,
): Worker<DataT, ReturnT, NameT> {
  const worker = new Worker<DataT, ReturnT, NameT>(name, processor, {
    connection,
    concurrency: 1,
  });
  worker.on('error', (err: Error) => {
    console.error(`[worker:${name}] ${err.message}`);
  });
  worker.on('failed', (job, err) => {
    const id = job?.id ?? 'unknown';
    console.error(`[worker:${name}] job ${id} failed: ${err.message}`);
  });
  return worker;
}

export { DEFAULT_JOB_OPTIONS };
