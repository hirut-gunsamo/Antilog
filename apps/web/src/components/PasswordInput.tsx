import { useState, type InputHTMLAttributes } from 'react'

import { useT } from '../lib/i18n'
import { icons } from './icons'
import styles from './PasswordInput.module.css'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

/**
 * A password field with an eye button that shows or hides what was typed.
 *
 * Drop-in for `<input type="password">`: it takes the same props, and the
 * input stays a descendant of the surrounding `.field` label, so each page's
 * own input styling still applies.
 */
export function PasswordInput({ className, ...props }: Props) {
  const t = useT()
  const [visible, setVisible] = useState(false)
  const label = visible ? t('common.hidePassword') : t('common.showPassword')

  return (
    <span className={styles.wrap}>
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={[styles.input, className].filter(Boolean).join(' ')}
        // Stops phones capitalising or "correcting" the first letter while
        // the password is shown as plain text.
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setVisible((shown) => !shown)}
        aria-label={label}
        aria-pressed={visible}
        title={label}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          {(visible ? icons.eyeOff : icons.eye).map((d) => (
            <path key={d} d={d} />
          ))}
        </svg>
      </button>
    </span>
  )
}
