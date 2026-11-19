import { useState } from 'react'
import Sidebar from '../components/Sidebar'

export default function DashboardLayout({ children }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen min-h-screen bg-[#0f0f0f]">
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
      />

      <main
        className="
          ml-0 md:ml-64
          w-full min-w-0
          flex-1
          h-screen
          overflow-y-auto
          p-4 sm:p-6 lg:p-8
          text-white
        "
      >
        <button
          type="button"
          onClick={() => setIsSidebarOpen(true)}
          aria-label="Open navigation menu"
          aria-expanded={isSidebarOpen}
          className="md:hidden mb-4 rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
        >
          Menu
        </button>

        {children}
      </main>
    </div>
  )
}