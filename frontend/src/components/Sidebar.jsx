import { NavLink } from 'react-router-dom'
import { sidebarItems } from '../config/SidebarItems'

export default function Sidebar() {
  return (
    <div
  className="w-64 h-screen bg-[#0a0a0a] border-r border-[#2a2a2a] p-5 fixed"
  onWheel={(e) => {
    e.preventDefault();
    e.stopPropagation();
  }}
>

      <h1 className="text-2xl font-bold text-emerald-400 mb-8">
        PulseIQ
      </h1>

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

    </div>
  )
}