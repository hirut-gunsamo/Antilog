import { lazy, type ComponentType, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import { AuthProvider } from './auth/AuthContext'
import { useAuth } from './auth/context'
import AppShell from './components/AppShell'
import { LanguageProvider } from './components/LanguageProvider'
import { SettingsProvider } from './components/SettingsProvider'
import Login from './pages/Login'

// Each page is fetched the first time it is opened, so the app starts
// without downloading every screen up front. After a deploy an open tab may
// ask for a file the server no longer has: reload once to pick up the new
// version instead of showing a broken page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function page<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().then(
      (module) => {
        try {
          sessionStorage.removeItem('page-reload')
        } catch {
          // Nothing to clear.
        }
        return module
      },
      (error: unknown) => {
        let reloaded = false
        try {
          reloaded = sessionStorage.getItem('page-reload') === '1'
          sessionStorage.setItem('page-reload', '1')
        } catch {
          // Storage blocked: still worth one reload.
        }
        if (reloaded) throw error
        window.location.reload()
        return new Promise<{ default: T }>(() => undefined)
      },
    ),
  )
}

const Dashboard = page(() => import('./pages/Dashboard'))
const Approvals = page(() => import('./pages/Approvals'))
const Branches = page(() => import('./pages/Branches'))
const DamageLoss = page(() => import('./pages/DamageLoss'))
const Inventory = page(() => import('./pages/Inventory'))
const NationalId = page(() => import('./pages/NationalId'))
const NationalIdOrders = page(() => import('./pages/NationalIdOrders'))
const Products = page(() => import('./pages/Products'))
const ProductTypes = page(() => import('./pages/ProductTypes'))
const Categories = page(() => import('./pages/Categories'))
const Ibid = page(() => import('./pages/Ibid'))
const VoucherPrices = page(() => import('./pages/VoucherPrices'))
const Telebirr = page(() => import('./pages/Telebirr'))
const Transfers = page(() => import('./pages/Transfers'))
const SendToBranch = page(() => import('./pages/SendToBranch'))
const Expenses = page(() => import('./pages/Expenses'))
const ProfitLoss = page(() => import('./pages/ProfitLoss'))
const Deductions = page(() => import('./pages/Deductions'))
const Payroll = page(() => import('./pages/Payroll'))
const Commission = page(() => import('./pages/Commission'))
const Receipts = page(() => import('./pages/Receipts'))
const Reports = page(() => import('./pages/Reports'))
const Requests = page(() => import('./pages/Requests'))
const Sales = page(() => import('./pages/Sales'))
const Equipment = page(() => import('./pages/Equipment'))
const Holdings = page(() => import('./pages/Holdings'))
const Settings = page(() => import('./pages/Settings'))
const Sync = page(() => import('./pages/Sync'))
const Users = page(() => import('./pages/Users'))

function Protected() {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100svh',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--muted)',
          fontSize: 14,
        }}
      >
        Loading…
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return (
    <SettingsProvider>
      <AppShell />
    </SettingsProvider>
  )
}

function LoginRoute() {
  const { user, loading } = useAuth()

  if (loading) return null
  if (user) return <Navigate to="/dashboard" replace />

  return <Login />
}

// Pages the Owner no longer has: an old link lands on Reports instead.
// The Owner's own pages; anyone else's old link lands on the dashboard.
function OwnerOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return user?.role === 'OWNER' ? (
    children
  ) : (
    <Navigate to="/dashboard" replace />
  )
}

function NotForOwner({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  return user?.role === 'OWNER' ? <Navigate to="/reports" replace /> : children
}

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginRoute />} />

            <Route element={<Protected />}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/products" element={<Products />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/product-types" element={<ProductTypes />} />
              <Route path="/ibid" element={<Ibid />} />
              <Route path="/voucher" element={<VoucherPrices />} />
              <Route path="/telebirr" element={<Telebirr />} />
              <Route path="/transfers" element={<Transfers />} />
              <Route path="/send" element={<SendToBranch />} />
              <Route
                path="/expenses"
                element={
                  <NotForOwner>
                    <Expenses />
                  </NotForOwner>
                }
              />
              <Route path="/deductions" element={<Deductions />} />
              <Route path="/payroll" element={<Payroll />} />
              <Route path="/commission" element={<Commission />} />
              <Route path="/branches" element={<Branches />} />
              <Route path="/approvals" element={<Approvals />} />
              <Route
                path="/receipts"
                element={
                  <NotForOwner>
                    <Receipts />
                  </NotForOwner>
                }
              />
              <Route path="/damage-loss" element={<DamageLoss />} />
              <Route path="/national-id" element={<NationalId />} />
              <Route
                path="/national-id/original"
                element={<NationalIdOrders key="ORIGINAL" kind="ORIGINAL" />}
              />
              <Route
                path="/national-id/copy"
                element={<NationalIdOrders key="COPY" kind="COPY" />}
              />
              <Route path="/sync" element={<Sync />} />
              <Route path="/holdings" element={<Holdings />} />
              <Route path="/equipment" element={<Equipment />} />
              <Route path="/settings" element={<Settings />} />
              <Route
                path="/sales"
                element={
                  <NotForOwner>
                    <Sales />
                  </NotForOwner>
                }
              />
              <Route path="/requests" element={<Requests />} />
              <Route
                path="/requests/sales"
                element={
                  <NotForOwner>
                    <Requests key="SALES" scope="SALES" />
                  </NotForOwner>
                }
              />
              <Route
                path="/requests/supervisors"
                element={<Requests key="SUPERVISOR" scope="SUPERVISOR" />}
              />
              <Route
                path="/requests/mine"
                element={<Requests key="MINE" scope="MINE" />}
              />
              <Route path="/reports" element={<Reports />} />
              <Route
                path="/profit"
                element={
                  <OwnerOnly>
                    <ProfitLoss />
                  </OwnerOnly>
                }
              />
            </Route>

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </LanguageProvider>
  )
}
