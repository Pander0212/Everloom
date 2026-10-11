import type { CharacterDTO } from '@everloom/engine';
import { useQueries } from '@tanstack/react-query';
import { ExternalLink, UserPlus, Users } from 'lucide-react';
import { useNavigate } from 'react-router';
import { get, post } from '@/lib/api';
import { qk, useGroups } from '@/lib/queries';
import { toast, toastError } from '@/lib/store';
import { Avatar, Badge, Button, EmptyState } from '@/ui';
import { useGame } from '../context';
import { ToolSheet } from './ToolSheet';

/** The cast of this chat: character cards, with shortcuts to edit them or track them as NPCs. */
export default function CharactersTool() {
  const { chat, state: s, close } = useGame();
  const groups = useGroups();
  const navigate = useNavigate();
  const group = chat.groupId ? groups.data?.find((g) => g.id === chat.groupId) : null;
  const ids = group ? group.members.map((m) => m.characterId) : chat.characterId ? [chat.characterId] : [];
  const cards = useQueries({ queries: ids.map((id) => ({ queryKey: qk.character(id), queryFn: () => get<CharacterDTO>(`/api/characters/${id}`) })) })
    .map((q) => q.data)
    .filter(Boolean) as CharacterDTO[];

  return (
    <ToolSheet title="Story cast" description={group ? group.name : undefined}>
      {cards.length ? (
        <div className="flex flex-col gap-3">
          {cards.map((c) => {
            const npc = s ? Object.values(s.npcs).find((n) => n.characterId === c.id) : null;
            const muted = group?.members.find((m) => m.characterId === c.id)?.muted;
            return (
              <div key={c.id} className="flex flex-col gap-3 rounded-md border border-line p-3">
                <div className="flex items-center gap-3">
                  <Avatar src={c.avatar} name={c.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2">
                      <span className="truncate font-semibold">{c.name}</span>
                      {muted ? <Badge>Muted</Badge> : null}
                      {npc ? <Badge tone="accent">Tracked</Badge> : null}
                    </p>
                    <p className="line-clamp-2 text-sm text-fg-2">{c.card.creator_notes || c.card.description || 'No description'}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={ExternalLink}
                    className="flex-1"
                    onClick={() => {
                      close();
                      navigate(`/characters/${c.id}`);
                    }}
                  >
                    Edit card
                  </Button>
                  {s && !npc ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={UserPlus}
                      className="flex-1"
                      onClick={async () => {
                        try {
                          await post(`/api/campaigns/${chat.campaignId}/npcs/from-character`, { chatId: chat.id, characterId: c.id });
                          toast({ title: `${c.name} is now tracked`, tone: 'success' });
                        } catch (e) {
                          toastError(e);
                        }
                      }}
                    >
                      Track in game
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={Users} title="No character card" body="This chat isn't tied to a character." />
      )}
    </ToolSheet>
  );
}
