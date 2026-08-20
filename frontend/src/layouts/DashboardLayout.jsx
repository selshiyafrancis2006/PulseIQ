import Sidebar from '../components/Sidebar'

export default function DashboardLayout({ children }) {
  return (
    <div className="flex h-screen bg-[#0f0f0f]">

      {/* LEFT SIDEBAR */}
      <Sidebar />

      {/* MAIN CONTENT AREA */}
      <main
        className="
          ml-64
          flex-1
          h-screen
          overflow-y-auto
          p-8
          text-white
        "
      >
        {children}
      </main>

    </div>
  )
}