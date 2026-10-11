// The "assist bar": dictate with Groq Whisper and condense with an LLM.
// It works on a pluggable target so the book and the quick editor can share it.
//   target = { key, label, get(): string, set(text, {raw}): void }
import { h, icon, toast } from './ui.js';
import * as store from './store.js';
import { transcribe, summarize } from './ai.js';

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const MAX_SECONDS = 300;

export function createAssist({ openSettings, onDone } = {}) {
  let target = null;
  let rec = null;
  let busy = null; // 'transcribing' | 'summarizing' | null

  const label = h('div.assist-label');
  const micLabel = h('span', 'Dictate');
  const mic = h('button.abtn.mic', { type: 'button', title: 'Dictate with Whisper', onclick: toggleMic }, icon('mic', 18), micLabel);
  const sumLabel = h('span', 'Summarize');
  const sum = h('button.abtn.sum', { type: 'button', title: 'Condense with AI', onclick: () => runSummarize() }, icon('sparkles', 18), sumLabel);
  const restore = h('button.abtn.restore', { type: 'button', title: 'Put back what you originally wrote', onclick: restoreOriginal }, icon('undo', 18), h('span', 'Original'));
  const done = h('button.abtn.done', { type: 'button', title: 'Done', onclick: () => onDone?.() }, icon('check', 18), h('span', 'Done'));
  const el = h('div.assist', { role: 'toolbar', 'aria-label': 'Writing tools' }, label, h('div.assist-btns', mic, sum, restore, done));

  // Keep the keyboard / caret where it is when a button is pressed.
  el.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  el.addEventListener('pointerdown', (e) => { if (e.target.closest('button') && e.pointerType !== 'mouse') e.preventDefault(); });

  function render() {
    label.textContent = target?.label || '';
    mic.classList.toggle('rec', !!rec);
    mic.classList.toggle('busy', busy === 'transcribing');
    sum.classList.toggle('busy', busy === 'summarizing');
    micLabel.textContent = rec ? `Stop ${fmtTime(rec.seconds)}` : busy === 'transcribing' ? 'Listening…' : 'Dictate';
    sumLabel.textContent = busy === 'summarizing' ? 'Condensing…' : 'Summarize';
    mic.disabled = busy === 'transcribing' || busy === 'summarizing';
    sum.disabled = !!rec || !!busy;
    restore.hidden = !(target && store.getRaw(target.key));
    done.hidden = !onDone;
  }

  function needKey(what, which) {
    toast(`Add your ${what} API key in Settings to use this.`, { action: 'Settings', onAction: () => openSettings?.(which) });
  }

  async function toggleMic() {
    if (rec) return stopRec();
    if (!target || busy) return;
    if (!store.getSettings().keys.groq) return needKey('Groq', 'voice');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return toast('This browser can’t record audio.');
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      return toast('Microphone access was blocked. Allow it in your browser’s site settings.');
    }
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported?.(t));
    const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    const t = target;
    rec = { mr, stream, chunks, seconds: 0, target: t, timer: null };
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => finishRec(rec);
    mr.start(250);
    rec.timer = setInterval(() => {
      rec.seconds++;
      if (rec.seconds >= MAX_SECONDS) stopRec();
      render();
    }, 1000);
    navigator.vibrate?.(15);
    render();
  }

  function stopRec() {
    if (!rec) return;
    clearInterval(rec.timer);
    try { rec.mr.stop(); } catch { /* already stopped */ }
    rec.stream.getTracks().forEach((tr) => tr.stop());
  }

  async function finishRec(r) {
    rec = null;
    if (!r.chunks.length || r.seconds < 1) { render(); return toast('That was too short — hold on a little longer.'); }
    busy = 'transcribing';
    render();
    try {
      const blob = new Blob(r.chunks, { type: r.mr.mimeType || 'audio/webm' });
      const said = await transcribe(blob);
      if (!said) { toast('I didn’t catch anything. Try again a bit closer to the mic.'); return; }
      const cur = r.target.get();
      r.target.set(cur ? `${cur}${/\s$/.test(cur) ? '' : ' '}${said}` : said);
      busy = null;
      const s = store.getSettings();
      if (s.autoSummarize && s.ai.model && s.keys[s.ai.provider]) await runSummarize(r.target);
    } catch (err) {
      toast(`Transcription failed: ${err.message}`, { ms: 6000 });
    } finally {
      busy = null;
      render();
    }
  }

  async function runSummarize(t = target) {
    if (!t || busy || rec) return;
    const text = t.get();
    if (!text.trim()) return toast('Write or dictate something first, then summarize it.');
    const { ai, keys } = store.getSettings();
    if (!keys[ai.provider]) return needKey(ai.provider === 'openrouter' ? 'OpenRouter' : 'DeepInfra', 'ai');
    if (!ai.model) { toast('Pick a model for summaries in Settings.', { action: 'Settings', onAction: () => openSettings?.('ai') }); return; }
    busy = 'summarizing';
    render();
    try {
      const out = await summarize(text);
      const raw = store.getRaw(t.key) || text;
      t.set(out, { raw });
      toast('Condensed.', { action: 'Undo', onAction: () => t.set(text, { raw: store.getRaw(t.key) === text ? '' : raw }) });
    } catch (err) {
      toast(`Summarize failed: ${err.message}`, { ms: 6500 });
    } finally {
      busy = null;
      render();
    }
  }

  function restoreOriginal() {
    if (!target) return;
    const raw = store.getRaw(target.key);
    if (raw) target.set(raw, { raw: '' });
    render();
  }

  store.onChange(() => render());
  render();

  return {
    el,
    setTarget(t) { target = t; render(); },
    refresh: render,
    get recording() { return !!rec; },
    cancel() { if (rec) { rec.mr.onstop = null; stopRec(); rec = null; render(); } },
  };
}
