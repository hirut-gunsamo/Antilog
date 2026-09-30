import type { TranslationKey } from './i18n'
import type { Role } from './types'

export const ROLE_LABEL: Record<Role, string> = {
  OWNER: 'Owner',
  SUPERVISOR: 'Supervisor',
  SALES: 'Sales',
}

/** The same three as keys, so a role reads in the chosen language. */
export const ROLE_KEY: Record<Role, TranslationKey> = {
  OWNER: 'role.OWNER',
  SUPERVISOR: 'role.SUPERVISOR',
  SALES: 'role.SALES',
}

/** Two letters from the name, for the avatar disc. */
export function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

// A stable colour per person, so the same face keeps the same disc. Hue only —
// saturation and lightness stay fixed so every disc reads equally.
export function avatarHue(id: string) {
  let hash = 0
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) % 360
  }
  return hash
}
