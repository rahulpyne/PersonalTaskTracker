export function Icon({ d, size = 16, fill = 'none', stroke = 'currentColor', sw = 1.6, children }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={fill} stroke={stroke} strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children || <path d={d} />}
    </svg>
  )
}

export const IconCheck    = (p) => <Icon {...p} d="M5 12.5l4.5 4.5L19 7" sw={2.2} />
export const IconPlus     = (p) => <Icon {...p} d="M12 5v14M5 12h14" />
export const IconTrash    = (p) => <Icon {...p}><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" /></Icon>
export const IconPencil   = (p) => <Icon {...p}><path d="M4 20l4-1L20 7l-3-3L5 16l-1 4z" /></Icon>
export const IconList     = (p) => <Icon {...p}><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></Icon>
export const IconBars     = (p) => <Icon {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></Icon>
export const IconBriefcase = (p) => <Icon {...p}><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 12h18" /></Icon>
export const IconHeart    = (p) => <Icon {...p}><path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" /></Icon>
export const IconFlame    = (p) => <Icon {...p}><path d="M12 3c1 4 5 5 5 9a5 5 0 1 1-10 0c0-2 1-3 2-4-.5 2 .5 3 2 3 0-3-1-5 1-8z" /></Icon>

export function CatIcon({ cat, size = 14 }) {
  if (cat === 'work')     return <span className="gicon work"><IconBriefcase size={size} /></span>
  if (cat === 'personal') return <span className="gicon personal"><IconHeart size={size} /></span>
  return (
    <span className="gicon all">
      <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
        <circle cx="12" cy="12" r="4" />
      </svg>
    </span>
  )
}

export function Flame({ alive, size = 14 }) {
  return (
    <span className={`flame ${alive ? 'alive' : ''}`} aria-label={alive ? 'streak active' : 'no streak'}>
      <IconFlame size={size} fill={alive ? 'currentColor' : 'none'} sw={alive ? 1.2 : 1.6} />
    </span>
  )
}
