"use client";

import type { Settings } from "@/lib/contracts";

export function PriorityControls({ settings, onChange }: { settings: Settings; onChange: (settings: Settings) => void }) {
  return <details className="priority-settings"><summary>Restaurant preferences <span>Adjust weights ↗</span></summary><div className="settings-grid">
    {([["ageWeight", "Order age"], ["urgencyWeight", "Target urgency"], ["courierWeight", "Courier wait"]] as const).map(([key, name]) => <label key={key}><span>{name}<strong>{settings[key]}</strong></span><input aria-label={name} type="range" min="0" max="10" step="1" value={settings[key]} onChange={event => onChange({ ...settings, [key]: Number(event.target.value) })} /></label>)}
    <label><span>Max wait (minutes)</span><input aria-label="Maximum wait minutes" type="number" min="5" max="120" value={settings.maxWaitMinutes} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 5 && value <= 120) onChange({ ...settings, maxWaitMinutes: value }); }} /></label>
  </div><p className="fine-print">Preferences are saved. Demo mode follows arrival order; these weights apply when prioritization is connected.</p></details>;
}
