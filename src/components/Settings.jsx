export default function Settings() {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '—'

  return (
    <div>
      <div className="settings-section">
        <div className="settings-title">Connection</div>
        <div className="settings-row">
          <span>Supabase project</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>
            {supabaseUrl.replace('https://', '').split('.')[0]}
          </span>
        </div>
        <div className="settings-row">
          <span>Realtime</span>
          <span style={{ color: 'var(--success)', fontSize: 13, fontWeight: 500 }}>● Connected</span>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-title">About</div>
        <div className="settings-row">
          <span>Version</span>
          <span style={{ color: 'var(--muted)' }}>1.0.0</span>
        </div>
        <div className="settings-row">
          <span>Stack</span>
          <span style={{ color: 'var(--muted)' }}>Vite · React 18 · Supabase · Framer Motion</span>
        </div>
      </div>
    </div>
  )
}
