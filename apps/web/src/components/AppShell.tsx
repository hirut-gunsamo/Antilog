import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../auth/context'
import { Logo } from './Logo'
import { icons } from './icons'
import type { Role } from '../lib/types'
import { useT, type TranslationKey } from '../lib/i18n'
import {
  useArrivalAlerts,
  useNotifications,
  type Arrival,
} from '../lib/notifications'
import { promptInstall, usePwa } from '../lib/pwa'
import { disablePush } from '../lib/push'
import { useSettings } from '../lib/settings'
import { useToasts } from '../lib/toasts'
import { startSync, stopSync } from '../lib/sync'
import { AppStatus } from './AppStatus'
import { InstallHelp } from './InstallHelp'
import { RemoveAppHelp } from './RemoveAppHelp'
import { SignOutDialog } from './SignOutDialog'
import { LanguageToggle } from './LanguageToggle'
import { NotificationBell } from './NotificationBell'
import { RefreshButton } from './RefreshButton'
import { ThemeToggle } from './ThemeToggle'
import { Toasts } from './Toasts'
import styles from './AppShell.module.css'

type NavItem = {
  to: string
  /** Looked up at render so the sidebar follows the chosen language. */
  labelKey: TranslationKey
  noteKey?: TranslationKey
  icon: keyof typeof icons
  roles: Role[]
  /** Shown in the mobile tab bar rather than behind "More". */
  primary?: boolean
  /** Collapsed under this item until it is opened, or until you are inside it. */
  children?: NavItem[]
}

const NAV: NavItem[] = [
  { to: '/dashboard', labelKey: 'nav.dashboard', icon: 'home', roles: ['OWNER', 'SUPERVISOR', 'SALES'], primary: true },
  // The catalogue behind the stock, one click away because the Owner sets it
  // up before anything else. Owner only: a product is a business decision,
  // not a branch one.
  {
    to: '/products',
    labelKey: 'nav.products',
    noteKey: 'prod.note',
    icon: 'ticket',
    roles: ['OWNER'],
    children: [
      { to: '/categories', labelKey: 'nav.categories', noteKey: 'cat.note', icon: 'clipboard', roles: ['OWNER'] },
      { to: '/product-types', labelKey: 'nav.productTypes', noteKey: 'types.note', icon: 'box', roles: ['OWNER'] },
      { to: '/products', labelKey: 'nav.productList', noteKey: 'prod.note', icon: 'ticket', roles: ['OWNER'] },
      { to: '/voucher', labelKey: 'nav.voucher', noteKey: 'vp.note', icon: 'ticket', roles: ['OWNER'] },
      { to: '/ibid', labelKey: 'nav.ibid', noteKey: 'ibid.note', icon: 'cart', roles: ['OWNER'] },
      { to: '/telebirr', labelKey: 'nav.telebirr', noteKey: 'tb.note', icon: 'phone', roles: ['OWNER'] },
    ],
  },
  // What the Owner pays: salaries, and commission on sales.
  {
    to: '/payroll',
    labelKey: 'nav.payroll',
    noteKey: 'pay.note',
    icon: 'cash',
    roles: ['OWNER'],
    children: [
      { to: '/payroll', labelKey: 'nav.salaries', noteKey: 'pay.note', icon: 'cash', roles: ['OWNER'] },
      { to: '/commission', labelKey: 'nav.commission', noteKey: 'com.note', icon: 'chart', roles: ['OWNER'] },
    ],
  },
  // Supervisors record the Ibid their branch prints, but have no Products.
  { to: '/ibid', labelKey: 'nav.ibid', noteKey: 'ibid.note', icon: 'cart', roles: ['SUPERVISOR'] },
  // Sellers and supervisors record the cash-ins and airtime they do on Telebirr.
  { to: '/telebirr', labelKey: 'nav.telebirr', noteKey: 'tb.note', icon: 'phone', roles: ['SUPERVISOR', 'SALES'] },
  {
    to: '/inventory',
    labelKey: 'nav.inventory',
    noteKey: 'inv.note',
    icon: 'box',
    roles: ['OWNER', 'SUPERVISOR', 'SALES'],
    primary: true,
    children: [
      { to: '/transfers', labelKey: 'nav.transfers', noteKey: 'tr.note', icon: 'sync', roles: ['OWNER', 'SUPERVISOR'] },
      { to: '/holdings', labelKey: 'hold.title', noteKey: 'hold.note', icon: 'users', roles: ['OWNER', 'SUPERVISOR', 'SALES'] },
      { to: '/damage-loss', labelKey: 'nav.damageLoss', noteKey: 'loss.note', icon: 'warning', roles: ['OWNER', 'SUPERVISOR', 'SALES'] },
    ],
  },
  { to: '/sales', labelKey: 'nav.sales', noteKey: 'sales.note', icon: 'cart', roles: ['OWNER', 'SUPERVISOR', 'SALES'], primary: true },
  {
    to: '/national-id',
    labelKey: 'nav.nationalId',
    noteKey: 'nid.note',
    icon: 'ticket',
    roles: ['OWNER', 'SUPERVISOR', 'SALES'],
    children: [
      { to: '/national-id/original', labelKey: 'nido.titleOriginal', noteKey: 'nido.note', icon: 'ticket', roles: ['OWNER', 'SUPERVISOR', 'SALES'] },
      { to: '/national-id/copy', labelKey: 'nido.titleCopy', noteKey: 'nido.note', icon: 'clipboard', roles: ['OWNER', 'SUPERVISOR', 'SALES'] },
    ],
  },
  {
    to: '/requests',
    labelKey: 'nav.requests',
    icon: 'clipboard',
    roles: ['OWNER', 'SUPERVISOR', 'SALES'],
    primary: true,
    // A supervisor's two lists: from their salespeople, and to the Owner.
    children: [
      { to: '/requests/sales', labelKey: 'req.titleSales', icon: 'users', roles: ['SUPERVISOR'] },
      { to: '/requests/mine', labelKey: 'req.titleMine', icon: 'clipboard', roles: ['SUPERVISOR'] },
    ],
  },
  { to: '/approvals', labelKey: 'nav.approvals', icon: 'check', roles: ['OWNER', 'SUPERVISOR'] },
  { to: '/receipts', labelKey: 'nav.receipts', icon: 'receipt', roles: ['OWNER', 'SUPERVISOR'] },
  // Supervisors record what their branch paid out; the Owner reads the report.
  { to: '/expenses', labelKey: 'nav.expenses', noteKey: 'exp.note', icon: 'cash', roles: ['OWNER', 'SUPERVISOR'] },
  { to: '/reports', labelKey: 'nav.reports', icon: 'chart', roles: ['OWNER', 'SUPERVISOR', 'SALES'] },
  { to: '/equipment', labelKey: 'asset.title', noteKey: 'asset.note', icon: 'box', roles: ['OWNER', 'SUPERVISOR'] },
  { to: '/branches', labelKey: 'nav.branches', noteKey: 'branches.note', icon: 'branch', roles: ['OWNER'] },
  { to: '/users', labelKey: 'nav.users', icon: 'users', roles: ['OWNER', 'SUPERVISOR'] },
  { to: '/sync', labelKey: 'nav.sync', icon: 'sync', roles: ['OWNER', 'SUPERVISOR', 'SALES'] },
  { to: '/settings', labelKey: 'nav.settings', icon: 'settings', roles: ['OWNER', 'SUPERVISOR', 'SALES'] },
]

const ROLE_KEY: Record<Role, TranslationKey> = {
  OWNER: 'role.OWNER',
  SUPERVISOR: 'role.SUPERVISOR',
  SALES: 'role.SALES',
}

function Icon({
  name,
  size = 20,
  weight = 1.8,
}: {
  name: keyof typeof icons
  size?: number
  /* The dotted "more" mark is three stroke caps rather than a drawn shape, so
     at the usual weight it reads as specks beside the other icons. */
  weight?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={weight}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name].map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  )
}

export default function AppShell() {
  const { user, logout } = useAuth()
  const location = useLocation()
  const t = useT()
  const { settings } = useSettings()
  // One fetch shared by the mobile and desktop bells.
  const notifications = useNotifications(location.pathname)

  // Supervisors are who the branch waits on, so a new request or approval
  // pops up for them instead of only moving the badge.
  const alerts = useToasts()
  const pushAlert = alerts.push
  const onArrival = useCallback(
    (item: Arrival) => {
      pushAlert(
        'info',
        t(`alert.${item.kind}` as TranslationKey, { name: item.latest.by }),
        item.href,
      )
    },
    [pushAlert, t],
  )
  useArrivalAlerts(notifications, user?.role === 'SUPERVISOR', onArrival)

  // "Install app" appears only where it can do something and the app is not
  // already installed: the native dialog where the browser offers one, and
  // step-by-step help on iPhone and on Android — where Chrome withholds its
  // dialog on a plain-http address, so the option would otherwise vanish.
  const pwa = usePwa()
  const canInstall = !pwa.installed

  // Which set of steps the help dialogs should show.
  const platform = pwa.iosManual
    ? ('ios' as const)
    : pwa.android
      ? ('android' as const)
      : ('desktop' as const)
  const [installHelp, setInstallHelp] = useState(false)
  const [removeHelp, setRemoveHelp] = useState(false)
  const closeInstallHelp = useCallback(() => setInstallHelp(false), [])

  function install() {
    setMenuOpen(false)
    setMoreOpen(false)

    if (pwa.canPrompt) void promptInstall()
    else setInstallHelp(true)
  }

  const [menuOpen, setMenuOpen] = useState(false)
  const [phoneMenuOpen, setPhoneMenuOpen] = useState(false)

  // Sign out asks first, so a mis-tap does not end the session.
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  function requestSignOut() {
    setMenuOpen(false)
    setPhoneMenuOpen(false)
    setConfirmSignOut(true)
  }
  const phoneMenuRef = useRef<HTMLDivElement>(null)
  const [moreOpen, setMoreOpen] = useState(false)

  // Escape closes the sheet, as it does every other dialog in the app.
  useEffect(() => {
    if (!moreOpen) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setMoreOpen(false)
    }

    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [moreOpen])

  // Undefined means "follow the route": a group opens on its own while you are
  // inside it, and stays where you put it once you click the chevron.
  const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>({})
  const menuRef = useRef<HTMLDivElement>(null)

  // Background syncing belongs to the signed-in shell, not to the Sync page:
  // a queued sale has to keep trying wherever the user happens to be.
  useEffect(() => {
    startSync()
    return () => stopSync()
  }, [])

  // Close the profile dropdown on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return

    function onPointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  // The same for the phone header's account menu. Touch first, because a tap
  // elsewhere should dismiss it before that tap does anything else.
  useEffect(() => {
    if (!phoneMenuOpen) return

    function onPointerDown(event: Event) {
      if (!phoneMenuRef.current?.contains(event.target as Node)) {
        setPhoneMenuOpen(false)
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPhoneMenuOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [phoneMenuOpen])

  // Any navigation closes both overlays. Done during render rather than in an
  // effect so the overlays are already gone on the frame that shows the new
  // page, instead of flashing open for one paint and then closing.
  const [lastPath, setLastPath] = useState(location.pathname)

  if (lastPath !== location.pathname) {
    setLastPath(location.pathname)
    setMenuOpen(false)
    setMoreOpen(false)
    setPhoneMenuOpen(false)
  }

  if (!user) return null

  // Captured so the recursion below does not need a non-null assertion on
  // every level; `user` is known to exist by this point.
  const role = user.role

  function allowed(list: NavItem[]): NavItem[] {
    return list
      .filter((item) => item.roles.includes(role))
      .map((item) =>
        item.children ? { ...item, children: allowed(item.children) } : item,
      )
  }

  const items = allowed(NAV)

  // Every route the sidebar can reach, parents and children alike. The page
  // header and the mobile sheet both work off the flat list.
  const flat = items.flatMap((item) => [item, ...(item.children ?? [])])

  const primary = flat.filter((item) => item.primary).slice(0, 4)
  const rest = flat.filter((item) => !item.primary)

  function groupIsOpen(item: NavItem) {
    const inside =
      location.pathname === item.to ||
      (item.children ?? []).some((child) => child.to === location.pathname)

    return groupOpen[item.to] ?? inside
  }

  const initials = user.name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  const current = flat.find((item) => item.to === location.pathname)

  // The brand block is two lines. Split the configured name on the last
  // "Management" so a custom name still reads sensibly, and fall back to the
  // whole string on one line when there is nothing to split on.
  const nameParts = (() => {
    const whole = settings.systemName.trim()
    const at = whole.lastIndexOf(' Management')

    if (at > 0) return [whole.slice(0, at), whole.slice(at + 1)]

    const mid = whole.lastIndexOf(' ', Math.floor(whole.length / 2) + 6)
    if (whole.length > 22 && mid > 0) {
      return [whole.slice(0, mid), whole.slice(mid + 1)]
    }

    return [whole, '']
  })()

  return (
    <div className={styles.shell} data-role={user.role.toLowerCase()}>
      {/* ---------- Sidebar (desktop) ---------- */}
      <aside className={styles.sidebar}>
        <NavLink to="/dashboard" className={styles.brand}>
          <Logo size={34} />
          <span className={styles.brandName}>
            <span className={styles.brandTop}>{nameParts[0]}</span>
            <span className={styles.brandBottom}>{nameParts[1]}</span>
          </span>
        </NavLink>

        <nav className={styles.nav}>
          {items.map((item) => {
            if (!item.children?.length) {
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    isActive
                      ? `${styles.navItem} ${styles.navActive}`
                      : styles.navItem
                  }
                >
                  <Icon name={item.icon} />
                  <span>{t(item.labelKey)}</span>
                </NavLink>
              )
            }

            const open = groupIsOpen(item)

            // The highlight belongs to the whole row, chevron included, so an
            // active parent reads as one block rather than a green label with
            // a loose arrow beside it.
            const active = location.pathname === item.to

            return (
              <div key={item.to} className={styles.navGroup}>
                <div
                  className={
                    active
                      ? `${styles.navParent} ${styles.navParentActive}`
                      : styles.navParent
                  }
                >
                  <NavLink to={item.to} className={styles.navItem}>
                    <Icon name={item.icon} />
                    <span>{t(item.labelKey)}</span>
                  </NavLink>

                  {/* Its own control, so going to Inventory and collapsing the
                      group are separate actions rather than one overloaded row. */}
                  <button
                    type="button"
                    className={styles.navToggle}
                    aria-expanded={open}
                    aria-label={t(open ? 'nav.collapse' : 'nav.expand', {
                      name: t(item.labelKey),
                    })}
                    onClick={() =>
                      setGroupOpen((current) => ({
                        ...current,
                        [item.to]: !open,
                      }))
                    }
                  >
                    <Icon name="chevronDown" size={15} />
                  </button>
                </div>

                {open ? (
                  <div className={styles.navChildren}>
                    {item.children.map((child) => (
                      <NavLink
                        key={child.to}
                        to={child.to}
                        className={({ isActive }) =>
                          isActive
                            ? `${styles.navChild} ${styles.navActive}`
                            : styles.navChild
                        }
                      >
                        <Icon name={child.icon} size={17} />
                        <span>{t(child.labelKey)}</span>
                      </NavLink>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </nav>

        <div className={styles.sidebarFoot}>
          <div className={styles.avatarSm} aria-hidden="true">
            {initials}
          </div>
          <div className={styles.who}>
            <strong>{t(ROLE_KEY[user.role])}</strong>
            <span>{user.email}</span>
          </div>
          <button
            className={styles.logoutIcon}
            type="button"
            onClick={requestSignOut}
            aria-label={t('shell.signOut')}
            title={t('shell.signOut')}
          >
            <Icon name="logout" size={18} />
          </button>
        </div>
      </aside>

      {/* ---------- Main ---------- */}
      <div className={styles.main}>
        {/* Mobile header */}
        <header className={styles.mobileHeader}>
          <Logo size={30} />
          <span className={styles.mobileBrand}>
            <span className={styles.brandTop}>{nameParts[0]}</span>
            <span className={styles.brandBottom}>{nameParts[1]}</span>
          </span>

          <div className={styles.mobileActions}>
            <LanguageToggle />
            <ThemeToggle />
            <RefreshButton />
            <NotificationBell data={notifications} />

            {/* The account and the app itself: signing out, installing and
                removing belong to the person, not to the list of pages. */}
            <div className={styles.mobileProfile} ref={phoneMenuRef}>
              <button
                type="button"
                className={styles.avatarButton}
                onClick={() => setPhoneMenuOpen((open) => !open)}
                aria-expanded={phoneMenuOpen}
                aria-haspopup="menu"
                aria-label={t('shell.account')}
              >
                <span className={styles.avatar} aria-hidden="true">
                  <Icon name="user" size={23} />
                </span>
              </button>

              {phoneMenuOpen ? (
                <div className={styles.menu} role="menu">
                  <div className={styles.menuHead}>
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    <span className={styles.menuBranch}>
                      {user.branch ? user.branch.name : t('shell.allBranches')}
                    </span>
                  </div>

                  <NavLink
                    className={styles.menuItem}
                    to="/settings"
                    role="menuitem"
                    onClick={() => setPhoneMenuOpen(false)}
                  >
                    <Icon name="users" size={17} />
                    {t('shell.profile')}
                  </NavLink>

                  <NavLink
                    className={styles.menuItem}
                    to="/settings"
                    role="menuitem"
                    onClick={() => setPhoneMenuOpen(false)}
                  >
                    <Icon name="settings" size={17} />
                    {t('nav.settings')}
                  </NavLink>

                  {canInstall ? (
                    <button
                      className={styles.menuItem}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setPhoneMenuOpen(false)
                        install()
                      }}
                    >
                      <Icon name="download" size={17} />
                      {t('pwa.install')}
                    </button>
                  ) : null}

                  <button
                    className={styles.menuItem}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setPhoneMenuOpen(false)
                      setRemoveHelp(true)
                    }}
                  >
                    <Icon name="warning" size={17} />
                    {t('pwa.remove')}
                  </button>

                  <button
                    className={styles.menuItem}
                    type="button"
                    role="menuitem"
                    onClick={requestSignOut}
                  >
                    <Icon name="logout" size={17} />
                    {t('shell.signOut')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        {/* Desktop page header */}
        <header className={styles.pageHeader}>
          <div>
            <h1 className={styles.pageTitle}>
              {current ? t(current.labelKey) : t('nav.dashboard')}
            </h1>
            <p className={styles.pageSub}>
              {current?.noteKey
                ? t(current.noteKey)
                : `${t('shell.welcome')}, ${user.name.split(' ')[0]}!`}
            </p>
          </div>

          <div className={styles.headerRight}>
            <LanguageToggle />
            <ThemeToggle />
            <RefreshButton />

            <NotificationBell data={notifications} />

            <div className={styles.profile} ref={menuRef}>
              <button
                className={styles.profileButton}
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className={styles.avatar} aria-hidden="true">
                  {initials}
                </span>
                <span className={styles.profileName}>
                  {t(ROLE_KEY[user.role])}
                </span>
                <Icon name="chevronDown" size={16} />
              </button>

              {menuOpen ? (
                <div className={styles.menu} role="menu">
                  <div className={styles.menuHead}>
                    <strong>{user.name}</strong>
                    <span>{user.email}</span>
                    {user.branch ? (
                      <span className={styles.menuBranch}>
                        {user.branch.name}
                      </span>
                    ) : (
                      <span className={styles.menuBranch}>{t('shell.allBranches')}</span>
                    )}
                  </div>
                  <NavLink className={styles.menuItem} to="/settings" role="menuitem">
                    <Icon name="user" size={17} />
                    {t('shell.profile')}
                  </NavLink>

                  <NavLink className={styles.menuItem} to="/settings" role="menuitem">
                    <Icon name="settings" size={17} />
                    {t('nav.settings')}
                  </NavLink>

                  {canInstall ? (
                    <button
                      className={styles.menuItem}
                      type="button"
                      onClick={install}
                      role="menuitem"
                    >
                      <Icon name="download" size={17} />
                      {t('pwa.install')}
                    </button>
                  ) : null}

                  <button
                    className={styles.menuItem}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false)
                      setRemoveHelp(true)
                    }}
                  >
                    <Icon name="warning" size={17} />
                    {t('pwa.remove')}
                  </button>

                  <button
                    className={styles.menuItem}
                    type="button"
                    onClick={requestSignOut}
                    role="menuitem"
                  >
                    <Icon name="logout" size={17} />
                    {t('shell.signOut')}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className={styles.content}>
          <AppStatus />
          <Outlet />
        </main>
      </div>

      {/* ---------- Mobile tab bar ---------- */}
      <nav className={styles.tabbar}>
        {primary.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab
            }
          >
            <Icon name={item.icon} size={21} />
            {/* The design calls the first tab "Home". */}
            <span>{t(item.to === '/dashboard' ? 'nav.home' : item.labelKey)}</span>
          </NavLink>
        ))}

        <button
          className={moreOpen ? `${styles.tab} ${styles.tabActive}` : styles.tab}
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
        >
          <Icon name="more" size={21} weight={3.6} />
          <span>{t('nav.more')}</span>
        </button>
      </nav>

      {moreOpen ? (
        <>
          <div
            className={styles.sheetScrim}
            onClick={() => setMoreOpen(false)}
            aria-hidden="true"
          />
          <div className={styles.sheet} role="dialog" aria-label={t('common.more')}>
            {/* The way out. Tapping the dark area behind the sheet closes it
                too, but that is not something you can see. */}
            <button
              type="button"
              className={styles.sheetClose}
              onClick={() => setMoreOpen(false)}
              aria-label={t('common.close')}
            >
              <span className={styles.sheetGrip} aria-hidden="true" />
              <Icon name="chevronDown" size={20} />
            </button>
            {rest.map((item) => (
              <NavLink key={item.to} to={item.to} className={styles.sheetItem}>
                <Icon name={item.icon} size={19} />
                {t(item.labelKey)}
              </NavLink>
            ))}
            {canInstall ? (
              <button
                className={styles.sheetItem}
                type="button"
                onClick={install}
              >
                <Icon name="download" size={19} />
                {t('pwa.install')}
              </button>
            ) : null}
          </div>
        </>
      ) : null}

      {installHelp ? <InstallHelp platform={platform} onClose={closeInstallHelp} /> : null}

      {removeHelp ? (
        <RemoveAppHelp
          platform={platform}
          onClose={() => setRemoveHelp(false)}
        />
      ) : null}

      {confirmSignOut ? (
        <SignOutDialog
          // The phone stops getting this person's notices before they go,
          // so the next person on a shared phone does not see them.
          onConfirm={() => {
            void disablePush().finally(logout)
          }}
          onClose={() => setConfirmSignOut(false)}
        />
      ) : null}

      <Toasts toasts={alerts.toasts} onDismiss={alerts.dismiss} placement="top" />
    </div>
  )
}
