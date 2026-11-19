import { NavLink } from 'react-router-dom'
import { sidebarItems } from '../config/SidebarItems'

export default function Sidebar({ isOpen = false, onClose = () => {} }) {
  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50
          w-64 h-screen
          bg-[#0a0a0a] border-r border-[#2a2a2a] p-5
          overflow-y-auto
          transition-transform duration-200
          md:translate-x-0
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold text-emerald-400">
            PulseIQ
          </h1>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="md:hidden rounded-lg px-2 py-1 text-gray-300 hover:bg-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-col gap-6">
          {sidebarItems.map((section) => (
            <div key={section.title}>
              <p className="text-xs text-gray-500 uppercase tracking-widest mb-3">
                {section.title}
              </p>

              <div className="flex flex-col gap-2">
                {section.items.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={onClose}
                    className={({ isActive }) =>
                      `flex items-center px-3 py-2 rounded-lg text-sm transition-colors
                      ${
                        isActive
                          ? 'bg-emerald-900 text-emerald-400'
                          : 'text-gray-300 hover:bg-[#1a1a1a] hover:text-white'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
    </>
  )
}