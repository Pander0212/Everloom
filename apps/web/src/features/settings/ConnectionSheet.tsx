import type { ConnectionDTO, ProviderId } from '@everloom/engine';
import { INSTRUCT_TEMPLATES } from '@everloom/engine';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { del, get, post, put } from '@/lib/api';
import { toastError } from '@/lib/store';
import { Button, confirm, Field, Icon, Input, Select, Sheet, Textarea, ToggleRow } from '@/ui';

export interface ProviderPreset {
  key: string;
  label: string;
  provider: ProviderId;
  baseUrl: string;
  needsKey: boolean;
  group: 'llm' | 'tts' | 'image' | 'model3d' | 'layers';
  hint?: string;
  params?: Record<string, unknown>;
  /** The model the preset is for (NanoGPT image models). */
  model?: string;
}

export const PRESETS: ProviderPreset[] = [
  { key: 'openrouter', label: 'OpenRouter', provider: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, group: 'llm', hint: 'Hundreds of models, several free ones.' },
  { key: 'openai', label: 'OpenAI', provider: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true, group: 'llm' },
  { key: 'anthropic', label: 'Anthropic (Claude)', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true, group: 'llm' },
  { key: 'gemini', label: 'Google Gemini', provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', needsKey: true, group: 'llm' },
  { key: 'deepseek', label: 'DeepSeek', provider: 'openai', baseUrl: 'https://api.deepseek.com/v1', needsKey: true, group: 'llm' },
  { key: 'groq', label: 'Groq', provider: 'openai', baseUrl: 'https://api.groq.com/openai/v1', needsKey: true, group: 'llm' },
  { key: 'together', label: 'Together', provider: 'openai', baseUrl: 'https://api.together.xyz/v1', needsKey: true, group: 'llm' },
  { key: 'mistral', label: 'Mistral', provider: 'openai', baseUrl: 'https://api.mistral.ai/v1', needsKey: true, group: 'llm' },
  { key: 'nanogpt', label: 'NanoGPT', provider: 'openai', baseUrl: 'https://nano-gpt.com/api/v1', needsKey: true, group: 'llm' },
  { key: 'xai', label: 'xAI', provider: 'openai', baseUrl: 'https://api.x.ai/v1', needsKey: true, group: 'llm' },
  { key: 'ollama', label: 'Ollama (local)', provider: 'openai', baseUrl: 'http://127.0.0.1:11434/v1', needsKey: false, group: 'llm' },
  { key: 'lmstudio', label: 'LM Studio (local)', provider: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', needsKey: false, group: 'llm' },
  { key: 'vllm', label: 'vLLM / llama.cpp / KoboldCpp (OpenAI mode)', provider: 'openai', baseUrl: 'http://127.0.0.1:8000/v1', needsKey: false, group: 'llm' },
  { key: 'custom', label: 'Other OpenAI-compatible', provider: 'openai', baseUrl: '', needsKey: false, group: 'llm' },
  { key: 'textgen', label: 'Text completion (llama.cpp / KoboldCpp)', provider: 'textgen', baseUrl: 'http://127.0.0.1:8080', needsKey: false, group: 'llm', params: { text_backend: 'llamacpp', instruct_template: 'ChatML' } },
  { key: 'tts-openai', label: 'OpenAI TTS', provider: 'tts-openai', baseUrl: 'https://api.openai.com/v1', needsKey: true, group: 'tts', params: { voice: 'alloy' } },
  { key: 'tts-kokoro', label: 'OpenAI-compatible speech (Kokoro, AllTalk…)', provider: 'tts-openai', baseUrl: 'http://127.0.0.1:8880/v1', needsKey: false, group: 'tts', params: { voice: 'af_heart' } },
  { key: 'tts-elevenlabs', label: 'ElevenLabs', provider: 'tts-elevenlabs', baseUrl: 'https://api.elevenlabs.io', needsKey: true, group: 'tts' },
  { key: 'img-openai', label: 'OpenAI-compatible images', provider: 'img-openai', baseUrl: 'https://api.openai.com/v1', needsKey: true, group: 'image', params: { image_size: '1024x1024' } },
  { key: 'img-openrouter', label: 'OpenRouter image models', provider: 'img-openrouter', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true, group: 'image' },
  // NanoGPT image models, with the prompt style each one wants (docs/art/PROMPTING.md).
  { key: 'img-nano-hidream', label: 'NanoGPT · HiDream I1', provider: 'img-openai', baseUrl: 'https://nano-gpt.com/api/v1', needsKey: true, group: 'image', model: 'hidream', hint: 'Strong composition and anime; full sentences, medium first.', params: { image_size: '1024x1024', prompt_prefix: 'Illustration:', prompt_suffix: 'Clean plain background, no text or lettering anywhere, no signature.' } },
  { key: 'img-nano-chroma', label: 'NanoGPT · Chroma', provider: 'img-openai', baseUrl: 'https://nano-gpt.com/api/v1', needsKey: true, group: 'image', model: 'chroma', hint: 'Painterly scenes; describe style and lighting.', params: { image_size: '1024x1024', prompt_suffix: 'No text, no watermark.' } },
  { key: 'img-nano-zimage', label: 'NanoGPT · Z Image Turbo', provider: 'img-openai', baseUrl: 'https://nano-gpt.com/api/v1', needsKey: true, group: 'image', model: 'z-image-turbo', hint: 'Fast and sharp; leans photographic, so the style is named twice.', params: { image_size: '1024x1024', prompt_prefix: 'Anime cel-shaded illustration, flat colors, clean line art:', prompt_suffix: 'Flat colors, clean line art, sharp focus, no writing or symbols.' } },
  { key: 'img-nano-qwen', label: 'NanoGPT · Qwen Image', provider: 'img-openai', baseUrl: 'https://nano-gpt.com/api/v1', needsKey: true, group: 'image', model: 'qwen-image', hint: 'Best at layouts, grids and tiles; say exactly what goes where.', params: { image_size: '1024x1024', prompt_suffix: 'No text, no labels, no numbers.' } },
  { key: 'img-nano-step', label: 'NanoGPT · Step Image Edit 2 (edits)', provider: 'img-openai', baseUrl: 'https://nano-gpt.com/api/v1', needsKey: true, group: 'image', model: 'step-image-edit-2', hint: 'Edits a picture you give it (variants of a texture); keeps its size.', params: { edit: true } },
  { key: 'img-pollinations', label: 'Pollinations (free)', provider: 'img-pollinations', baseUrl: 'https://image.pollinations.ai', needsKey: false, group: 'image' },
  { key: 'img-comfyui', label: 'ComfyUI', provider: 'img-comfyui', baseUrl: 'http://127.0.0.1:8188', needsKey: false, group: 'image' },
  { key: '3d-meshy', label: 'Meshy', provider: '3d-meshy', baseUrl: 'https://api.meshy.ai', needsKey: true, group: 'model3d', hint: 'Text or picture to 3D, textured. Paid per model.' },
  { key: '3d-fal-hunyuan', label: 'fal.ai · Hunyuan3D 2', provider: '3d-fal', baseUrl: 'https://queue.fal.run', needsKey: true, group: 'model3d', model: 'fal-ai/hunyuan3d/v2', hint: 'Picture to 3D (text is drawn first with your image connection).' },
  { key: '3d-fal-trellis', label: 'fal.ai · TRELLIS', provider: '3d-fal', baseUrl: 'https://queue.fal.run', needsKey: true, group: 'model3d', model: 'fal-ai/trellis', hint: 'Picture to 3D, fast.' },
  { key: 'layers-seethrough', label: 'See-through worker', provider: 'layers-seethrough', baseUrl: 'http://127.0.0.1:8000', needsKey: true, group: 'layers', hint: 'tools/see-through-worker (Docker on a 16 GB+ GPU, or a RunPod pod); the key is its WORKER_TOKEN.' },
  { key: 'img-a1111', label: 'AUTOMATIC1111 / Forge', provider: 'img-a1111', baseUrl: 'http://127.0.0.1:7860', needsKey: false, group: 'image' },
];

const isLlm = (p: string) => ['openai', 'anthropic', 'gemini', 'textgen'].includes(p);

type Draft = { name: string; provider: ProviderId; baseUrl: string; model: string; apiKey: string | undefined; params: Record<string, any> };

export function ConnectionSheet({ open, onOpenChange, connection, group }: { open: boolean; onOpenChange: (o: boolean) => void; connection: ConnectionDTO | null; group: 'llm' | 'tts' | 'image' | 'model3d' | 'layers' }) {
  const qc = useQueryClient();
  const [presetKey, setPresetKey] = useState('');
  const [d, setD] = useState<Draft | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setTest(null);
    setModels([]);
    setSavedId(connection?.id ?? null);
    if (connection) {
      setD({ name: connection.name, provider: connection.provider, baseUrl: connection.baseUrl, model: connection.model, apiKey: undefined, params: { ...connection.params } });
      setPresetKey(PRESETS.find((p) => p.provider === connection.provider && p.baseUrl === connection.baseUrl && (!p.model || p.model === connection.model))?.key ?? PRESETS.find((p) => p.provider === connection.provider && p.baseUrl === connection.baseUrl)?.key ?? '');
    } else {
      const first = PRESETS.find((p) => p.group === group)!;
      setPresetKey(first.key);
      setD({ name: first.label, provider: first.provider, baseUrl: first.baseUrl, model: '', apiKey: '', params: defaults(first) });
    }
  }, [open, connection, group]);
  if (!d) return null;
  const preset = PRESETS.find((p) => p.key === presetKey);
  const set = (p: Partial<Draft>) => setD((x) => (x ? { ...x, ...p } : x));
  const setP = (p: Record<string, unknown>) => setD((x) => (x ? { ...x, params: { ...x.params, ...p } } : x));
  const choosePreset = (key: string) => {
    const p = PRESETS.find((x) => x.key === key)!;
    setPresetKey(key);
    set({ provider: p.provider, baseUrl: p.baseUrl, name: connection ? d.name : p.label, ...(p.model ? { model: p.model } : {}), params: { ...defaults(p), ...(connection ? d.params : {}) } });
  };
  const persist = async (): Promise<string | null> => {
    const body = { name: d.name.trim() || preset?.label || 'Connection', provider: d.provider, baseUrl: d.baseUrl.trim(), model: d.model.trim(), params: d.params, ...(d.apiKey !== undefined && d.apiKey !== '' ? { apiKey: d.apiKey } : {}) };
    const saved = savedId ? await put<ConnectionDTO>(`/api/connections/${savedId}`, body) : await post<ConnectionDTO>('/api/connections', body);
    setSavedId(saved.id);
    set({ apiKey: undefined });
    await qc.invalidateQueries({ queryKey: ['connections'] });
    return saved.id;
  };
  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const id = await persist();
      const r = await get<{ models: string[] }>(`/api/connections/${id}/models`);
      setModels(r.models);
      if (!d.model && r.models.length) set({ model: r.models[0] });
    } catch (e) {
      toastError(e);
    } finally {
      setLoadingModels(false);
    }
  };
  const runTest = async () => {
    setBusy(true);
    setTest(null);
    try {
      const id = await persist();
      setTest(await post(`/api/connections/${id}/test`));
    } catch (e) {
      setTest({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    try {
      await persist();
      onOpenChange(false);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!savedId || !(await confirm({ title: 'Delete connection?', description: 'The stored API key is deleted too.', confirmLabel: 'Delete', danger: true }))) return;
    await del(`/api/connections/${savedId}`);
    await qc.invalidateQueries({ queryKey: ['connections'] });
    onOpenChange(false);
  };
  const num = (k: string, label: string, step = 0.05, hint?: string) => (
    <Field label={label} htmlFor={`p-${k}`} hint={hint}>
      <Input id={`p-${k}`} type="number" step={step} value={d.params[k] ?? ''} onChange={(e) => setP({ [k]: e.target.value === '' ? undefined : Number(e.target.value) })} />
    </Field>
  );
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={connection ? 'Edit connection' : 'Add connection'}
      size="lg"
      footer={
        <>
          {savedId ? <Button variant="quiet" icon={Trash2} aria-label="Delete connection" onClick={remove} /> : null}
          {isLlm(d.provider) ? (
            <Button variant="secondary" loading={busy && !!test === false} onClick={runTest}>
              Test
            </Button>
          ) : null}
          <Button variant="primary" size="lg" className="flex-1" loading={busy} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Service" htmlFor="c-preset">
          <Select id="c-preset" value={presetKey} onChange={(e) => choosePreset(e.target.value)}>
            {PRESETS.filter((p) => p.group === group).map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        {preset?.hint ? <p className="-mt-2 text-xs text-fg-2">{preset.hint}</p> : null}
        <Field label="Name" htmlFor="c-name">
          <Input id="c-name" value={d.name} onChange={(e) => set({ name: e.target.value })} />
        </Field>
        <Field label="Endpoint URL" htmlFor="c-url" hint="The server calls this address; your browser never does.">
          <Input id="c-url" inputMode="url" value={d.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://…/v1" />
        </Field>
        <Field label="API key" htmlFor="c-key" hint={connection?.hasKey ? 'A key is saved. Leave empty to keep it.' : preset?.needsKey ? 'Stored encrypted on your server.' : 'Optional for local servers.'}>
          <Input id="c-key" type="password" autoComplete="off" value={d.apiKey ?? ''} onChange={(e) => set({ apiKey: e.target.value })} placeholder={connection?.hasKey ? '••••••••' : ''} />
        </Field>
        {d.provider !== 'img-pollinations' ? (
          <Field
            label={group === 'tts' ? 'Model' : group === 'image' ? 'Image model' : 'Model'}
            htmlFor="c-model"
            trailing={
              isLlm(d.provider) ? (
                <Button size="sm" variant="quiet" icon={RefreshCw} loading={loadingModels} onClick={fetchModels}>
                  Fetch list
                </Button>
              ) : null
            }
          >
            {models.length ? (
              <Select id="c-model" value={d.model} onChange={(e) => set({ model: e.target.value })}>
                {!models.includes(d.model) && d.model ? <option value={d.model}>{d.model}</option> : null}
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            ) : (
              <Input id="c-model" value={d.model} onChange={(e) => set({ model: e.target.value })} placeholder={group === 'tts' ? 'tts-1' : group === 'image' ? 'dall-e-3' : 'e.g. deepseek-chat'} />
            )}
          </Field>
        ) : null}
        {test ? (
          <div className={`flex items-start gap-2 rounded-md px-3 py-2.5 text-sm ${test.ok ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger'}`}>
            <Icon icon={test.ok ? CheckCircle2 : TriangleAlert} size={18} className="mt-0.5 flex-none" />
            <span>{test.ok ? `Connected. ${test.message}` : test.message}</span>
          </div>
        ) : null}

        {isLlm(d.provider) ? (
          <>
            <h3 className="pt-3 text-sm font-semibold text-fg-2">Sampling</h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {num('temperature', 'Temperature')}
              {num('top_p', 'Top P')}
              {num('top_k', 'Top K', 1)}
              {num('min_p', 'Min P', 0.01)}
              {num('repetition_penalty', 'Repetition pen.', 0.01)}
              {num('frequency_penalty', 'Frequency pen.')}
              {num('presence_penalty', 'Presence pen.')}
              {num('max_tokens', 'Max reply tokens', 1)}
              {num('context_size', 'Context size', 256)}
            </div>
            <Field label="Stop strings" htmlFor="c-stop" hint="One per line.">
              <Textarea id="c-stop" rows={2} value={(d.params.stop ?? []).join('\n')} onChange={(e) => setP({ stop: e.target.value.split('\n').filter(Boolean) })} />
            </Field>
            <div className="flex flex-col divide-y divide-line">
              <ToggleRow label="Stream replies" checked={d.params.stream !== false} onChange={(v) => setP({ stream: v })} />
              <ToggleRow label="Reasoning / thinking" description="For models that support it. The thoughts appear collapsed above the reply." checked={!!d.params.reasoning} onChange={(v) => setP({ reasoning: v })} />
            </div>
            {d.params.reasoning ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Effort" htmlFor="c-eff">
                  <Select id="c-eff" value={d.params.reasoning_effort ?? 'medium'} onChange={(e) => setP({ reasoning_effort: e.target.value })}>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </Select>
                </Field>
                {num('reasoning_budget', 'Budget (tokens)', 256)}
              </div>
            ) : null}
            {d.provider === 'textgen' ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Backend" htmlFor="c-tb">
                  <Select id="c-tb" value={d.params.text_backend ?? 'llamacpp'} onChange={(e) => setP({ text_backend: e.target.value })}>
                    <option value="llamacpp">llama.cpp server</option>
                    <option value="koboldcpp">KoboldCpp</option>
                    <option value="openai">OpenAI /completions</option>
                  </Select>
                </Field>
                <Field label="Instruct template" htmlFor="c-it">
                  <Select id="c-it" value={d.params.instruct_template ?? 'ChatML'} onChange={(e) => setP({ instruct_template: e.target.value })}>
                    {INSTRUCT_TEMPLATES.map((t) => (
                      <option key={t.name}>{t.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            ) : null}
            {d.provider === 'openai' || d.provider === 'gemini' ? (
              <Field label="Embeddings model" htmlFor="c-emb" hint="Only needed for semantic lorebook retrieval.">
                <Input id="c-emb" value={d.params.embeddings_model ?? ''} onChange={(e) => setP({ embeddings_model: e.target.value })} placeholder={d.provider === 'gemini' ? 'text-embedding-004' : 'text-embedding-3-small'} />
              </Field>
            ) : null}
          </>
        ) : null}
        {group === 'tts' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Default voice" htmlFor="c-voice">
              <Input id="c-voice" value={d.params.voice ?? ''} onChange={(e) => setP({ voice: e.target.value })} />
            </Field>
            {num('speed', 'Speed', 0.05)}
            {d.provider === 'tts-openai' ? (
              <div className="col-span-2">
                <ToggleRow label="Accepts reference audio" description="For servers that clone a voice from a short sample (XTTS, F5 and similar). Only then are your reference voices sent to it." checked={d.params.referenceAudio === true} onChange={(v) => setP({ referenceAudio: v })} />
              </div>
            ) : null}
          </div>
        ) : null}
        {group === 'image' ? (
          <>
            <ToggleRow label="Allows adult content" description="Only turn this on if your provider's terms allow adult image generation. 18+ textures are never made for a character under 18 or described as a child." checked={d.params.allowAdult === true} onChange={value => setP({ allowAdult: value })} />
            {d.provider !== 'img-comfyui' ? (
              <Field label="Size" htmlFor="c-size">
                <Input id="c-size" value={d.params.image_size ?? '1024x1024'} onChange={(e) => setP({ image_size: e.target.value })} />
              </Field>
            ) : null}
            <Field label="Negative prompt" htmlFor="c-neg">
              <Input id="c-neg" value={d.params.negative_prompt ?? ''} onChange={(e) => setP({ negative_prompt: e.target.value })} />
            </Field>
            {d.provider === 'img-comfyui' ? (
              <Field label="Workflow (API JSON)" htmlFor="c-wf" hint="Export from ComfyUI with “Save (API)”. Use %prompt%, %negative_prompt%, %seed%, %width%, %height% as placeholders.">
                <Textarea
                  id="c-wf"
                  rows={6}
                  className="font-mono text-xs"
                  value={typeof d.params.workflow === 'string' ? d.params.workflow : d.params.workflow ? JSON.stringify(d.params.workflow, null, 2) : ''}
                  onChange={(e) => setP({ workflow: e.target.value })}
                />
              </Field>
            ) : null}
          </>
        ) : null}
        <details className="group">
          <summary className="cursor-pointer py-2 text-sm font-medium text-fg-2">Advanced</summary>
          <div className="flex flex-col gap-4 pt-2">
            <Field label="Extra headers (JSON)" htmlFor="c-h">
              <JsonInput id="c-h" value={d.params.headers} onChange={(v) => setP({ headers: v })} />
            </Field>
            <Field label="Extra body fields (JSON)" htmlFor="c-b" hint="Merged into every request, e.g. provider routing.">
              <JsonInput id="c-b" value={d.params.extra_body} onChange={(v) => setP({ extra_body: v })} />
            </Field>
          </div>
        </details>
      </div>
    </Sheet>
  );
}

function defaults(p: ProviderPreset): Record<string, unknown> {
  if (p.group !== 'llm') return { ...(p.params ?? {}) };
  return { temperature: 0.9, top_p: 1, max_tokens: 500, context_size: 16384, stream: true, ...(p.params ?? {}) };
}

function JsonInput({ id, value, onChange }: { id: string; value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(value ? JSON.stringify(value, null, 2) : '');
  const [err, setErr] = useState(false);
  return (
    <Textarea
      id={id}
      rows={2}
      className="font-mono text-xs"
      aria-invalid={err}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        if (!e.target.value.trim()) {
          setErr(false);
          onChange(undefined);
          return;
        }
        try {
          onChange(JSON.parse(e.target.value));
          setErr(false);
        } catch {
          setErr(true);
        }
      }}
    />
  );
}
