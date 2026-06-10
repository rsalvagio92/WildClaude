// Shared authoring UI for YAML-defined resources (workflows, evals).
// Backed by REST: POST /api/<kind> (save), /validate, /generate; GET /raw/:name; DELETE /:name.
import { api } from './api.js';
import { el, mount, modal, toast, toastOk, toastErr, loading } from './ui.js';

// Open the YAML editor. opts: { kind, title, name?, content?, reload }
// If `name` is set it's an edit (name field hidden); otherwise a create.
export function openYamlEditor({ kind, title, name, content = '', reload }) {
  const isEdit = !!name;
  const nameIn = el('input', { type: 'text', placeholder: 'my-' + kind.replace(/s$/, ''), value: name || '' });
  const ta = el('textarea', { rows: 22, style: 'width:100%;font-family:monospace;font-size:12px', value: content });
  const status = el('div.muted', { style: 'font-size:12px;margin-top:6px' });

  const validate = async () => {
    try {
      const r = await api.post(`/api/${kind}/validate`, { content: ta.value });
      if (r.ok) { status.textContent = '✓ Valid'; status.style.color = 'var(--ok,#34d399)'; }
      else { status.textContent = '⚠ ' + (r.error || 'invalid'); status.style.color = 'var(--err,#f87171)'; }
      return r.ok;
    } catch (e) { status.textContent = '⚠ ' + e.message; status.style.color = 'var(--err,#f87171)'; return false; }
  };

  const m = modal({
    title: title || (isEdit ? `Edit ${name}` : `New ${kind.replace(/s$/, '')}`),
    wide: true,
    body: [
      isEdit ? null : el('div.field', {}, [el('label', { text: 'Name' }), nameIn]),
      el('div.field', {}, [el('label', { text: 'Definition (YAML)' }), ta]),
      status,
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-sm', { text: 'Validate', onclick: validate }),
      el('button.btn.btn-accent', {
        text: 'Save',
        onclick: async () => {
          if (!(await validate())) { toastErr('Fix validation errors first'); return; }
          try {
            await api.post(`/api/${kind}`, { content: ta.value, name: isEdit ? name : (nameIn.value.trim() || undefined) });
            toastOk('Saved');
            m.close();
            reload && reload();
          } catch (e) { toastErr(e.message); }
        },
      }),
    ],
  });
  return m;
}

// Open the "describe it" generator. opts: { kind, label, placeholder, reload }
export function openYamlGenerate({ kind, label, placeholder, reload }) {
  const ta = el('textarea', { rows: 3, style: 'width:100%', placeholder: placeholder || 'Describe what it should do…' });
  const m = modal({
    title: `✨ Describe ${label || 'it'}`,
    wide: true,
    body: [
      el('p.muted', { text: 'WildClaude will draft a valid definition you can review and tweak before saving.' }),
      el('div.field', {}, [el('label', { text: 'What should it do?' }), ta]),
    ],
    footer: [
      el('button.btn', { text: 'Cancel', onclick: () => m.close() }),
      el('button.btn.btn-accent', {
        text: 'Generate',
        onclick: async (ev) => {
          const prompt = ta.value.trim();
          if (!prompt) { toastErr('Describe it first'); return; }
          ev.target.disabled = true; ev.target.textContent = 'Designing…';
          try {
            const { content } = await api.post(`/api/${kind}/generate`, { prompt });
            m.close();
            // Hand off to the editor, prefilled, so the user reviews before saving.
            openYamlEditor({ kind, title: `Review generated ${kind.replace(/s$/, '')}`, content, reload });
          } catch (e) { toastErr(e.message); ev.target.disabled = false; ev.target.textContent = 'Generate'; }
        },
      }),
    ],
  });
  return m;
}
