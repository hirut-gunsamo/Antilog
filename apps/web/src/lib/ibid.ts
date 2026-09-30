import type { useT } from './i18n'

/** Ibid is printed by the carta: one carta holds 20 cards. */
export const CARDS_PER_CARTA = 20

/** "3 carta + 5 cards", "3 carta" or "5 cards", from a card count. */
export function cartaText(t: ReturnType<typeof useT>, cards: number) {
  const cartas = Math.floor(cards / CARDS_PER_CARTA)
  const loose = cards % CARDS_PER_CARTA

  if (cartas && loose) return t('ibid.cartaAndCards', { cartas, cards: loose })
  if (cartas) return t('ibid.nCarta', { n: cartas })
  return t('ibid.nCards', { n: loose })
}
