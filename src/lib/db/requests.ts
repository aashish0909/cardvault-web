import { tx } from './idb';
import type { RequestRow, RequestStatus } from './types';

export async function insertRequest(
  request: Omit<RequestRow, 'createdAt' | 'resolvedAt' | 'windowExpiresAt' | 'amount' | 'merchant'> & {
    amount?: string | null;
    merchant?: string | null;
    createdAt?: number;
  }
): Promise<RequestRow> {
  const row: RequestRow = {
    ...request,
    amount: request.amount ?? null,
    merchant: request.merchant ?? null,
    createdAt: request.createdAt ?? Date.now(),
    windowExpiresAt: null,
    resolvedAt: null,
  };
  await tx('requests', 'readwrite', (s) => s.put(row));
  return row;
}

export async function listRequests(): Promise<RequestRow[]> {
  const rows = await tx<RequestRow[]>('requests', 'readonly', (s) => s.getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getRequest(id: string): Promise<RequestRow | null> {
  return (await tx<RequestRow | undefined>('requests', 'readonly', (s) => s.get(id))) ?? null;
}

export async function setRequestStatus(
  id: string,
  status: RequestStatus,
  windowExpiresAt: number | null = null
): Promise<void> {
  const row = await getRequest(id);
  if (row) {
    await tx('requests', 'readwrite', (s) =>
      s.put({
        ...row,
        status,
        windowExpiresAt,
        resolvedAt: status === 'pending' ? null : Date.now(),
      })
    );
  }
}

export async function clearRequestHistory(): Promise<void> {
  const rows = await tx<RequestRow[]>('requests', 'readonly', (s) => s.getAll());
  await Promise.all(
    rows
      .filter((r) => r.status !== 'pending')
      .map((r) => tx('requests', 'readwrite', (s) => s.delete(r.id)))
  );
}
