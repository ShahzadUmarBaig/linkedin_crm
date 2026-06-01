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
    <form action={formAction} className="space-y-8">
      <Section title="API keys" description="Stored encrypted at rest. Leave blank to keep the existing value.">
        <KeyField
          label="Anthropic (Claude)"
          name="anthropicKey"
          present={initial.hasAnthropicKey}
          masked={initial.anthropicKeyMasked}
          placeholder="sk-ant-…"
        />
        <KeyField
          label="Google (Gemini)"
          name="googleKey"
          present={initial.hasGoogleKey}
          masked={initial.googleKeyMasked}
          placeholder="AIza…"
        />
      </Section>

      <Section title="Default model" description="Used when a task does not specify its own model.">
        <div>
          <Label>Provider</Label>
          <select
            name="defaultProvider"
            defaultValue={initial.defaultProvider}
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="google">Google (Gemini)</option>
          </select>
        </div>
        <div>
          <Label>Model ID</Label>
          <input
            name="defaultModel"
            defaultValue={initial.defaultModel ?? ''}
            placeholder="e.g. claude-opus-4-7 or gemini-2.5-pro"
            className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </Section>

      <Section title="Monthly budget (USD)" description="Optional. Warn shows a banner; hard cap blocks further AI runs that month.">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Warn at</Label>
            <input
              name="monthlyBudgetWarnUsd"
              type="number"
              step="0.01"
              min="0"
              defaultValue={initial.monthlyBudgetWarnUsd ?? ''}
              placeholder="5"
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
          <div>
            <Label>Hard cap at</Label>
            <input
              name="monthlyBudgetHardUsd"
              type="number"
              step="0.01"
              min="0"
              defaultValue={initial.monthlyBudgetHardUsd ?? ''}
              placeholder="20"
              className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </div>
        </div>
      </Section>

      <div className="flex items-center justify-between border-t border-zinc-200 pt-4 dark:border-zinc-800">
        {state?.error && (
          <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
        )}
        {state?.ok && !state.error && (
          <p className="text-sm text-green-700 dark:text-green-300">Saved.</p>
        )}
        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {pending ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {description && <p className="mt-1 mb-4 text-xs text-zinc-500">{description}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">{children}</label>
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
      <Label>{label}</Label>
      <input
        name={name}
        type="password"
        autoComplete="off"
        placeholder={present ? `Saved (${masked}) — type to replace` : placeholder}
        className="block w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-mono dark:border-zinc-700 dark:bg-zinc-900"
      />
      {present && (
        <label className="mt-1 flex items-center gap-2 text-xs text-zinc-500">
          <input type="checkbox" name={name} value="__clear__" /> Clear this key
        </label>
      )}
    </div>
  )
}
