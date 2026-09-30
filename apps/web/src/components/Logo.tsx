// The app mark: the AntiLog "A", the same artwork the installed app shows on
// a home screen. A PNG rather than drawn paths, because it carries gradients
// and folds that only the original artwork has.
//
// The tile reads `--logo-tile` first, so a surface can hand the mark its own
// background. Black by default: the same tile the installed app's icon uses,
// so the mark looks the same on a home screen and inside the app.
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.28,
        background: 'var(--logo-tile, #0b0b0b)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      <img
        src="/logo-mark.png"
        alt=""
        width={Math.round(size * 0.84)}
        height={Math.round(size * 0.84)}
        style={{ display: 'block', objectFit: 'contain' }}
      />
    </span>
  )
}
