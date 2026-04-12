// Internal pub/sub for SSE events, keyed by workspace ID. Services
// call emit(workspaceId, event) after state changes; the SSE endpoint
// fans the event out to every connected client for that workspace.

import type { Response } from 'express';

export interface SSEEvent {
  type: string;
  data: unknown;
}

type SSEClient = {
  res: Response;
  userId: string;
};

const clients = new Map<string, SSEClient[]>();

export function addClient(workspaceId: string, userId: string, res: Response): void {
  const bucket = clients.get(workspaceId) ?? [];
  bucket.push({ res, userId });
  clients.set(workspaceId, bucket);

  res.on('close', () => {
    removeClient(workspaceId, res);
  });
}

export function removeClient(workspaceId: string, res: Response): void {
  const bucket = clients.get(workspaceId);
  if (!bucket) return;
  const filtered = bucket.filter((c) => c.res !== res);
  if (filtered.length === 0) clients.delete(workspaceId);
  else clients.set(workspaceId, filtered);
}

export function emit(workspaceId: string | null | undefined, event: SSEEvent): void {
  if (!workspaceId) return;
  const bucket = clients.get(workspaceId);
  if (!bucket || bucket.length === 0) return;
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const client of bucket) {
    try {
      client.res.write(payload);
    } catch {
      // Client disconnected — removeClient fires from the 'close' handler.
    }
  }
}

export function emitToUser(
  workspaceId: string,
  userId: string,
  event: SSEEvent
): void {
  const bucket = clients.get(workspaceId);
  if (!bucket) return;
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
  for (const client of bucket) {
    if (client.userId === userId) {
      try {
        client.res.write(payload);
      } catch {
        // Client disconnected.
      }
    }
  }
}

export function clientCount(workspaceId?: string): number {
  if (workspaceId) return clients.get(workspaceId)?.length ?? 0;
  let total = 0;
  for (const bucket of Array.from(clients.values())) total += bucket.length;
  return total;
}
