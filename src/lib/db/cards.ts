import { tx } from './idb';
import type { CardRow } from './types';

export async function listCards(): Promise<CardRow[]> {
  const rows = await tx<CardRow[]>('cards', 'readonly', (s) => s.getAll());
  return rows.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getCard(id: string): Promise<CardRow | null> {
  return (await tx<CardRow | undefined>('cards', 'readonly', (s) => s.get(id))) ?? null;
}

export interface NewCard {
  nickname: string;
  network: string;
  last4: string;
  color: string;
  payload: string;
}

export async function insertCard(card: NewCard): Promise<CardRow> {
  const row: CardRow = { id: crypto.randomUUID(), createdAt: Date.now(), ...card };
  await tx('cards', 'readwrite', (s) => s.put(row));
  return row;
}

export async function deleteCard(id: string): Promise<void> {
  await tx('cards', 'readwrite', (s) => s.delete(id));
}
