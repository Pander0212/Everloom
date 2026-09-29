import { Bell, Heart, MoreHorizontal, Plus, Settings, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Logo } from '@/app/Logo';
import { applyTheme } from '@/lib/theme';
import { toast } from '@/lib/store';
import {
  Avatar, Badge, Button, Checkbox, confirm, Dialog, EmptyState, Field, IconButton, Input, Kbd, ListRow, Menu, Segmented, Select, Sheet, Slider, Spinner, StatBar, Switch, TabPanel, Tabs, Textarea, ToggleRow, Tooltip, Typing,
} from '@/ui';

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="hairline-t py-6">
      <h2 className="mb-4 text-sm font-semibold text-fg-2">{title}</h2>
      {children}
    </section>
  );
}

const SWATCHES = ['bg', 'surface', 'surface-2', 'surface-3', 'border', 'text', 'text-2', 'text-3', 'accent', 'accent-text', 'accent-soft', 'danger', 'success', 'warning'];

/** Every component, in both themes. Used for design QA. */
export default function DesignPage() {
  const [sw, setSw] = useState(true);
  const [cb, setCb] = useState(true);
  const [seg, setSeg] = useState<'a' | 'b' | 'c'>('a');
  const [tab, setTab] = useState('one');
  const [slider, setSlider] = useState(40);
  const [hp, setHp] = useState(72);
  const [sheet, setSheet] = useState(false);
  const [dialog, setDialog] = useState(false);
  return (
    <div className="mx-auto max-w-[900px] px-4 pb-24 pt-[calc(var(--safe-top)+16px)] sm:px-6">
      <header className="flex items-center gap-3 pb-6">
        <Logo size={32} />
        <h1 className="flex-1 text-xl font-semibold tracking-tight">Design system</h1>
        <Segmented
          label="Theme"
          size="sm"
          value={document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'}
          onChange={(v) => {
            applyTheme(v as 'dark' | 'light');
            setSeg((s) => s);
          }}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
        <Link to="/" className="text-sm text-accent-text">
          App
        </Link>
      </header>

      <Block title="Color tokens">
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-7">
          {SWATCHES.map((s) => (
            <div key={s} className="flex flex-col gap-1.5">
              <div className="h-12 rounded-md border border-line" style={{ background: `var(--${s})` }} />
              <span className="text-xs text-fg-2">{s}</span>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Type scale — 12 / 14 / 16 / 20 / 28">
        <p className="text-xl font-semibold tracking-tight">Title 28</p>
        <p className="text-lg font-semibold">Heading 20</p>
        <p className="text-base">Body 16 — the quick brown fox.</p>
        <p className="text-sm text-fg-2">Secondary 14 — helper text and metadata.</p>
        <p className="text-xs text-fg-3">Caption 12</p>
        <div className="story mt-4 max-w-[70ch]">
          <p>
            <em>Iris slides the glass across the bar.</em> <span className="speech">“Iced lemon tea, on the house,”</span> she says. The market hums outside as rain taps against the window.
          </p>
        </div>
      </Block>

      <Block title="Buttons">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger" icon={Trash2}>
            Delete
          </Button>
          <Button variant="primary" loading>
            Saving
          </Button>
          <Button size="sm" icon={Plus}>
            Small
          </Button>
          <IconButton icon={Settings} label="Settings" />
          <IconButton icon={Heart} label="Active" active />
          <IconButton icon={Plus} label="Accent" tone="accent" />
          <Tooltip content="Tooltip text">
            <IconButton icon={Bell} label="Has a tooltip" />
          </Tooltip>
          <Menu trigger={<IconButton icon={MoreHorizontal} label="Menu" />} items={[{ label: 'Edit', onSelect: () => {} }, { label: 'Delete', danger: true, separatorBefore: true, onSelect: () => {} }]} />
        </div>
      </Block>

      <Block title="Inputs">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Text" htmlFor="d1" hint="Helper text">
            <Input id="d1" placeholder="Placeholder" />
          </Field>
          <Field label="With error" htmlFor="d2" error="Something is wrong">
            <Input id="d2" invalid defaultValue="Bad value" />
          </Field>
          <Field label="Select" htmlFor="d3">
            <Select id="d3">
              <option>One</option>
              <option>Two</option>
            </Select>
          </Field>
          <Field label={`Slider ${slider}`}>
            <Slider label="Slider" value={slider} onChange={setSlider} />
          </Field>
          <Field label="Textarea" htmlFor="d4" className="sm:col-span-2">
            <Textarea id="d4" rows={3} placeholder="Grows as you type" />
          </Field>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-6">
          <span className="flex items-center gap-2 text-sm">
            <Switch checked={sw} onChange={setSw} label="Switch" /> Switch
          </span>
          <span className="flex items-center gap-2 text-sm">
            <Checkbox checked={cb} onChange={setCb} label="Checkbox" /> Checkbox
          </span>
          <Segmented label="Segmented" value={seg} onChange={setSeg} options={[{ value: 'a', label: 'Chat' }, { value: 'b', label: 'Stage' }, { value: 'c', label: 'Both' }]} />
        </div>
        <div className="mt-2 max-w-[420px]">
          <ToggleRow label="Toggle row" description="A setting with an explanation." checked={sw} onChange={setSw} />
        </div>
      </Block>

      <Block title="Tabs">
        <Tabs value={tab} onChange={setTab} tabs={[{ value: 'one', label: 'Info' }, { value: 'two', label: 'Members', count: 4 }, { value: 'three', label: 'Rules' }]}>
          <TabPanel value="one" className="pt-4 text-sm text-fg-2">
            First panel
          </TabPanel>
          <TabPanel value="two" className="pt-4 text-sm text-fg-2">
            Second panel
          </TabPanel>
          <TabPanel value="three" className="pt-4 text-sm text-fg-2">
            Third panel
          </TabPanel>
        </Tabs>
      </Block>

      <Block title="Stat bars">
        <div className="grid max-w-[520px] gap-4">
          <StatBar label="HP" value={hp} max={100} tone="danger" />
          <StatBar label="Energy" value={64} max={100} tone="accent" />
          <StatBar label="Hunger" value={30} max={100} tone="warning" compact />
        </div>
        <div className="mt-4 flex gap-2">
          <Button size="sm" onClick={() => setHp((h) => Math.max(0, h - 12))}>
            Take a hit
          </Button>
          <Button size="sm" onClick={() => setHp((h) => Math.min(100, h + 20))}>
            Heal
          </Button>
        </div>
      </Block>

      <Block title="Lists, avatars, badges">
        <div className="max-w-[520px]">
          <ListRow title="Iris Thorne" subtitle="Community regular · Northcrest Woods" leading={<Avatar name="Iris Thorne" />} trailing={<Badge tone="accent">Friendly</Badge>} chevron onClick={() => {}} />
          <ListRow title="Tobias Moreno" subtitle="Local coordinator" leading={<Avatar name="Tobias Moreno" />} trailing={<Badge tone="danger">Hostile</Badge>} chevron onClick={() => {}} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Badge>Neutral</Badge>
          <Badge tone="accent">Accent</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
          <Kbd>⌘K</Kbd>
          <Spinner />
          <Typing />
        </div>
      </Block>

      <Block title="Overlays">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSheet(true)}>Open sheet</Button>
          <Button onClick={() => setDialog(true)}>Open dialog</Button>
          <Button onClick={() => void confirm({ title: 'Delete this item?', description: 'This cannot be undone.', confirmLabel: 'Delete', danger: true })}>Confirm</Button>
          <Button onClick={() => toast({ title: 'Story update', lines: ['+1 Iced Lemon Tea', '20 min passed', 'Hunger −10'] })}>Toast</Button>
          <Button onClick={() => toast({ title: 'Level 5', tone: 'reward' })}>Reward toast</Button>
          <Button onClick={() => toast({ title: 'Could not reach the server', tone: 'danger' })}>Error toast</Button>
        </div>
      </Block>

      <Block title="Empty state">
        <EmptyState icon={Bell} title="Nothing here yet" body="One sentence that says what to do next." action={<Button variant="primary">Do the thing</Button>} />
      </Block>

      <Sheet open={sheet} onOpenChange={setSheet} title="Bottom sheet" description="Drag the handle down to dismiss." footer={<Button variant="primary" size="lg" block onClick={() => setSheet(false)}>Done</Button>}>
        <p className="text-sm text-fg-2">Sheets slide up on phones and open as a side panel on desktop.</p>
        <div className="mt-4 flex flex-col gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <ListRow key={i} title={`Row ${i + 1}`} subtitle="Scrollable content" />
          ))}
        </div>
      </Sheet>
      <Dialog open={dialog} onOpenChange={setDialog} title="Dialog" description="For short, focused decisions." footer={<Button variant="primary" onClick={() => setDialog(false)}>Okay</Button>} />
    </div>
  );
}
