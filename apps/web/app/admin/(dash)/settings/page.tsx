'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Field } from '@/components/Field';
import { api, ApiError } from '@/lib/api';
import { isoToIstInput, istInputToIso } from '@/lib/ist';
import type { SettingsResponse } from '@/lib/types';

interface FormState {
  name: string;
  organiserName: string;
  venue: string;
  city: string;
  gatesOpenAt: string;
  startsAt: string;
  endsAt: string;
  logoUrl: string;
  brandColour: string;
  helplineNumber: string;
  termsText: string;
  maxPassesPerBooking: string;
}

interface GateRow {
  key: string;
  id?: string;
  name: string;
  active: boolean;
  pin: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  organiserName: '',
  venue: '',
  city: '',
  gatesOpenAt: '',
  startsAt: '',
  endsAt: '',
  logoUrl: '',
  brandColour: '#4f46e5',
  helplineNumber: '',
  termsText: '',
  maxPassesPerBooking: '10',
};

function toForm({ event }: SettingsResponse): FormState {
  if (!event) return EMPTY_FORM;
  return {
    name: event.name,
    organiserName: event.organiserName,
    venue: event.venue,
    city: event.city,
    gatesOpenAt: isoToIstInput(event.gatesOpenAt),
    startsAt: isoToIstInput(event.startsAt),
    endsAt: isoToIstInput(event.endsAt),
    logoUrl: event.logoUrl ?? '',
    brandColour: event.brandColour,
    helplineNumber: event.helplineNumber ?? '',
    termsText: event.termsText,
    maxPassesPerBooking: String(event.maxPassesPerBooking),
  };
}

function toGateRows({ gates }: SettingsResponse): GateRow[] {
  return gates.map((gate) => ({ key: gate.id, id: gate.id, name: gate.name, active: gate.active, pin: '' }));
}

export default function SettingsPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [gates, setGates] = useState<GateRow[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const nextKey = useRef(0);

  useEffect(() => {
    api<SettingsResponse>('/api/event')
      .then((settings) => {
        setForm(toForm(settings));
        setGates(toGateRows(settings));
      })
      .catch((err: unknown) =>
        setBanner({ kind: 'error', text: err instanceof Error ? err.message : 'Something went wrong' }),
      )
      .finally(() => setLoading(false));
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const setGate = (key: string, patch: Partial<GateRow>) =>
    setGates((current) => current.map((gate) => (gate.key === key ? { ...gate, ...patch } : gate)));

  const addGate = () =>
    setGates((current) => [...current, { key: `new-${nextKey.current++}`, name: '', active: true, pin: '' }]);

  const removeGate = (key: string) => setGates((current) => current.filter((gate) => gate.key !== key));

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setErrors({});
    setBanner(null);
    try {
      const saved = await api<SettingsResponse>('/api/event', {
        method: 'PUT',
        body: {
          ...form,
          gatesOpenAt: istInputToIso(form.gatesOpenAt),
          startsAt: istInputToIso(form.startsAt),
          endsAt: istInputToIso(form.endsAt),
          maxPassesPerBooking: Number(form.maxPassesPerBooking),
          gates: gates.map((gate) => ({
            id: gate.id,
            name: gate.name,
            active: gate.active,
            pin: gate.pin || undefined,
          })),
        },
      });
      setForm(toForm(saved));
      setGates(toGateRows(saved));
      setBanner({ kind: 'ok', text: 'Settings saved.' });
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(Object.fromEntries(err.details.map((detail) => [detail.path, detail.message])));
        setBanner({
          kind: 'error',
          text: err.details.length > 0 ? 'Please fix the highlighted fields.' : err.message,
        });
      } else {
        setBanner({ kind: 'error', text: 'Something went wrong' });
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-zinc-500">Loading settings…</p>;
  }

  const inputClass = (path: string) => `input ${errors[path] ? 'input-error' : ''}`;

  return (
    <form onSubmit={onSubmit} className="space-y-6" noValidate>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Event settings</h1>
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {banner && (
        <p
          role={banner.kind === 'error' ? 'alert' : 'status'}
          className={`rounded-lg px-3 py-2 text-sm ${
            banner.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'
          }`}
        >
          {banner.text}
        </p>
      )}

      <section className="card space-y-4">
        <h2 className="font-semibold">Event</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Event name" htmlFor="name" error={errors.name}>
            <input id="name" className={inputClass('name')} value={form.name} maxLength={120}
              onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Organiser name" htmlFor="organiserName" error={errors.organiserName}
            hint="Shown at the end of the WhatsApp message.">
            <input id="organiserName" className={inputClass('organiserName')} value={form.organiserName}
              maxLength={120} onChange={(e) => set('organiserName', e.target.value)} />
          </Field>
          <Field label="Venue" htmlFor="venue" error={errors.venue}>
            <input id="venue" className={inputClass('venue')} value={form.venue} maxLength={160}
              onChange={(e) => set('venue', e.target.value)} />
          </Field>
          <Field label="City" htmlFor="city" error={errors.city}>
            <input id="city" className={inputClass('city')} value={form.city} maxLength={80}
              onChange={(e) => set('city', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Timing</h2>
          <p className="text-sm text-zinc-500">India Standard Time (IST).</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Gates open" htmlFor="gatesOpenAt" error={errors.gatesOpenAt}>
            <input id="gatesOpenAt" type="datetime-local" className={inputClass('gatesOpenAt')}
              value={form.gatesOpenAt} onChange={(e) => set('gatesOpenAt', e.target.value)} />
          </Field>
          <Field label="Event starts" htmlFor="startsAt" error={errors.startsAt}>
            <input id="startsAt" type="datetime-local" className={inputClass('startsAt')}
              value={form.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          </Field>
          <Field label="Event ends" htmlFor="endsAt" error={errors.endsAt}
            hint="Passes stop showing QR codes after this.">
            <input id="endsAt" type="datetime-local" className={inputClass('endsAt')}
              value={form.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="font-semibold">Branding and support</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Logo URL" htmlFor="logoUrl" error={errors.logoUrl} hint="Optional. A link to a PNG or SVG.">
            <input id="logoUrl" type="url" inputMode="url" className={inputClass('logoUrl')}
              placeholder="https://…" value={form.logoUrl} maxLength={500}
              onChange={(e) => set('logoUrl', e.target.value)} />
          </Field>
          <Field label="Brand colour" htmlFor="brandColour" error={errors.brandColour}>
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Pick brand colour"
                className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border border-zinc-300 bg-white p-1"
                value={/^#[0-9a-fA-F]{6}$/.test(form.brandColour) ? form.brandColour : '#4f46e5'}
                onChange={(e) => set('brandColour', e.target.value)} />
              <input id="brandColour" className={inputClass('brandColour')} value={form.brandColour}
                maxLength={7} onChange={(e) => set('brandColour', e.target.value)} />
            </div>
          </Field>
          <Field label="Helpline number" htmlFor="helplineNumber" error={errors.helplineNumber}
            hint="Optional. Shown on pass pages.">
            <input id="helplineNumber" type="tel" inputMode="tel" className={inputClass('helplineNumber')}
              value={form.helplineNumber} maxLength={20}
              onChange={(e) => set('helplineNumber', e.target.value)} />
          </Field>
          <Field label="Max passes per booking" htmlFor="maxPassesPerBooking"
            error={errors.maxPassesPerBooking} hint="Spreadsheet rows above this are rejected.">
            <input id="maxPassesPerBooking" type="number" inputMode="numeric" min={1} max={50}
              className={inputClass('maxPassesPerBooking')} value={form.maxPassesPerBooking}
              onChange={(e) => set('maxPassesPerBooking', e.target.value)} />
          </Field>
        </div>
        <Field label="Terms and conditions" htmlFor="termsText" error={errors.termsText}
          hint="Shown at the bottom of every pass page.">
          <textarea id="termsText" rows={5} className={inputClass('termsText')} value={form.termsText}
            maxLength={5000} onChange={(e) => set('termsText', e.target.value)} />
        </Field>
      </section>

      <section className="card space-y-4">
        <div>
          <h2 className="font-semibold">Entry gates</h2>
          <p className="text-sm text-zinc-500">
            Volunteers open the scanner page (this site&apos;s address followed by <code>/scan</code>) on their
            phone and sign in with a gate&apos;s PIN (6 to 8 digits). PINs are stored
            hashed and cannot be viewed later, so note each one when you set it.
          </p>
        </div>

        {gates.length === 0 && <p className="text-sm text-zinc-500">No gates yet.</p>}

        <ul className="space-y-3">
          {gates.map((gate, index) => (
            <li key={gate.key} className="rounded-lg border border-zinc-200 p-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
                <Field label="Gate name" htmlFor={`gate-name-${gate.key}`} error={errors[`gates.${index}.name`]}>
                  <input id={`gate-name-${gate.key}`} className={inputClass(`gates.${index}.name`)}
                    placeholder="Gate A" value={gate.name} maxLength={40}
                    onChange={(e) => setGate(gate.key, { name: e.target.value })} />
                </Field>
                <Field label={gate.id ? 'New PIN' : 'PIN'} htmlFor={`gate-pin-${gate.key}`}
                  error={errors[`gates.${index}.pin`] ?? errors[`gates.${index}.id`]}
                  hint={gate.id ? 'Leave blank to keep the current PIN.' : undefined}>
                  <input id={`gate-pin-${gate.key}`} className={inputClass(`gates.${index}.pin`)}
                    inputMode="numeric" autoComplete="off" pattern="\d{6,8}" maxLength={8}
                    value={gate.pin}
                    onChange={(e) => setGate(gate.key, { pin: e.target.value.replace(/\D/g, '') })} />
                </Field>
                <div className="flex items-center gap-3 sm:pt-7">
                  <label className="flex items-center gap-2 text-sm text-zinc-700">
                    <input type="checkbox" className="h-4 w-4 accent-zinc-900"
                      checked={gate.active} onChange={(e) => setGate(gate.key, { active: e.target.checked })} />
                    Active
                  </label>
                  <button type="button" className="btn-danger px-3 py-1.5" onClick={() => removeGate(gate.key)}>
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {errors.gates && <p className="text-xs font-medium text-red-600">{errors.gates}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn-secondary" onClick={addGate}>
            Add gate
          </button>
          <span className="text-xs text-zinc-500">Gate changes, including removals, apply when you save.</span>
        </div>
      </section>

      <div className="flex justify-end">
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>
    </form>
  );
}
