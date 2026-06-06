'use client'

import { useActionState } from 'react'
import { updateSettings } from '@/app/actions/settings'
import type { SettingsView } from '@/lib/settings'

export function SettingsForm({ initial }: { initial: SettingsView }) {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string; ok?: true } | null, formData: FormData) => updateSettings(formData),
    null,
  )

  return (
    <form action={formAction} className="stack gap16">
      <Section title="API keys" description="Stored encrypted at rest. Leave blank to keep the existing value.">
        <KeyField label="Anthropic (Claude)" name="anthropicKey" present={initial.hasAnthropicKey} masked={initial.anthropicKeyMasked} placeholder="sk-ant-…" />
        <KeyField label="Google (Gemini)" name="googleKey" present={initial.hasGoogleKey} masked={initial.googleKeyMasked} placeholder="AIza…" />
      </Section>

      <Section title="Default model" description="Used when a task does not specify its own model.">
        <div>
          <label className="label">Provider</label>
          <select className="field" name="defaultProvider" defaultValue={initial.defaultProvider}>
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="google">Google (Gemini)</option>
          </select>
        </div>
        <div>
          <label className="label">Model ID</label>
          <input className="field mono" name="defaultModel" defaultValue={initial.defaultModel ?? ''} placeholder="e.g. claude-opus-4-8 or gemini-2.5-pro" />
        </div>
      </Section>

      <Section title="Monthly budget (USD)" description="Optional. Warn shows a banner; hard cap blocks further AI runs that month.">
        <div className="g2" style={{ gap: 12 }}>
          <div>
            <label className="label">Warn at</label>
            <input className="field" name="monthlyBudgetWarnUsd" type="number" step="0.01" min="0" defaultValue={initial.monthlyBudgetWarnUsd ?? ''} placeholder="5" />
          </div>
          <div>
            <label className="label">Hard cap at</label>
            <input className="field" name="monthlyBudgetHardUsd" type="number" step="0.01" min="0" defaultValue={initial.monthlyBudgetHardUsd ?? ''} placeholder="20" />
          </div>
        </div>
      </Section>

      <div className="row between center" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
        {state?.error && <span className="banner err">{state.error}</span>}
        {state?.ok && !state.error && <span className="banner ok">Saved.</span>}
        <button type="submit" disabled={pending} className="btn primary" style={{ marginLeft: 'auto' }}>
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <div className="box pad-lg">
      <span className="eyebrow">{title}</span>
      {description && <p style={{ fontSize: 12, color: 'var(--muted)', margin: '6px 0 0' }}>{description}</p>}
      <div className="stack gap12 mt12">{children}</div>
    </div>
  )
}

function KeyField({
  label,
  name,
  present,
  masked,
  placeholder,
}: {
  label: string
  name: string
  present: boolean
  masked: string
  placeholder: string
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="field mono"
        name={name}
        type="password"
        autoComplete="off"
        placeholder={present ? `Saved (${masked}) — type to replace` : placeholder}
      />
      {present && (
        <label className="row gap8" style={{ marginTop: 6, fontSize: 12, color: 'var(--muted)' }}>
          <input type="checkbox" name={name} value="__clear__" /> Clear this key
        </label>
      )}
    </div>
  )
}
