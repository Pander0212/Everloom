import { useState } from 'react';
import { post } from './api';
import { toast, toastError } from './store';

export interface GenImageBody {
  kind: 'portrait' | 'expression' | 'background' | 'item' | 'photo' | 'scene' | 'npc';
  prompt?: string;
  characterId?: string;
  chatId?: string;
  npcId?: string;
  itemName?: string;
  emotion?: string;
  apply?: boolean;
}

export interface GenImageResult {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  prompt: string;
  applied: string | null;
}

/** Ask the image connection for a picture; errors become toasts (with a hint when no connection is set). */
export function useImageGen() {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (body: GenImageBody, key: string = body.kind): Promise<GenImageResult | null> => {
    setBusy(key);
    try {
      return await post<GenImageResult>('/api/images/generate', body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/image connection/i.test(msg)) toast({ title: 'No image connection', lines: ['Add one in Settings → Connections → Images.'], tone: 'danger' });
      else toastError(e);
      return null;
    } finally {
      setBusy(null);
    }
  };
  return { busy, run };
}
