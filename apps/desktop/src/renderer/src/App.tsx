import { NavLink, Navigate, Route, Routes, HashRouter as Router } from 'react-router'
import { TranslatePage } from './features/translation/translate-page'
import { HistoryPage } from './features/history/history-page'
import { RecordPage } from './features/history/record-page'
import { SettingsPage } from './features/settings/settings-page'

function navLinkClass({ isActive }: { isActive: boolean }): string {
  return `rounded-md px-3 py-1.5 text-sm transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  }`
}

export function App() {
  return (
    <Router>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex items-center justify-between border-b px-6 py-3">
          <div className="flex items-center gap-6">
            <span className="text-sm font-semibold tracking-tight">TranslateTrainer</span>
            <nav className="flex items-center gap-1">
              <NavLink to="/" end className={navLinkClass}>
                Translate
              </NavLink>
              <NavLink to="/history" end className={navLinkClass}>
                History
              </NavLink>
              <NavLink to="/settings" className={navLinkClass}>
                Settings
              </NavLink>
            </nav>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<TranslatePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/record/:id" element={<RecordPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </Router>
  )
}
