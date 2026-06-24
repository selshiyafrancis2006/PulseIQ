import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export default function Landing() {
  const navigate = useNavigate()

  // Scroll animation
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('opacity-100', 'translate-y-0')
            entry.target.classList.remove('opacity-0', 'translate-y-10')
          }
        })
      },
      { threshold: 0.1 }
    )
    document.querySelectorAll('.scroll-reveal').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  const features = [
    {
      title: 'Real-time Metrics',
      desc: 'Watch CPU, memory, disk and network usage update live every 5 seconds. Never miss a spike.',
      color: 'text-blue-400',
      border: 'border-blue-900'
    },
    {
      title: 'Anomaly Detection',
      desc: 'Moving average algorithm detects abnormal spikes before they crash your system.',
      color: 'text-purple-400',
      border: 'border-purple-900'
    },
    {
      title: 'Instant Alerts',
      desc: 'Get notified the moment something goes wrong — before your users notice.',
      color: 'text-red-400',
      border: 'border-red-900'
    },
    {
      title: 'Live Dashboard',
      desc: 'Beautiful charts showing your system health in real time. No page refresh needed.',
      color: 'text-green-400',
      border: 'border-green-900'
    }
  ]

  const comparison = [
    { feature: 'Price', datadog: '$30/host/month', pulseiq: 'Free' },
    { feature: 'Self-hosted', datadog: '❌', pulseiq: '✅' },
    { feature: 'Open source', datadog: '❌', pulseiq: '✅' },
    { feature: 'Real-time metrics', datadog: '✅', pulseiq: '✅' },
    { feature: 'Anomaly detection', datadog: '✅', pulseiq: '✅' },
    { feature: 'Data privacy', datadog: 'Cloud only', pulseiq: 'Your server' },
  ]

  return (
    <div className="min-h-screen bg-[#050508] text-white">

      {/* KEYFRAMES */}
      <style>{`
        @keyframes letterReveal {
          0% {
            opacity: 0;
            transform: translateY(-60px) rotateX(90deg) scale(0.8);
            filter: blur(8px);
          }
          60% {
            opacity: 1;
            filter: blur(0px);
          }
          100% {
            opacity: 1;
            transform: translateY(0) rotateX(0deg) scale(1);
            filter: blur(0px);
          }
        }
        @keyframes lineReveal {
          from { opacity: 0; transform: scaleX(0); }
          to   { opacity: 1; transform: scaleX(1); }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      {/* NAVBAR */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 bg-[#050508]/80 backdrop-blur-md border-b border-[#1a1a1a]">
        <div className="flex items-center gap-2">
          <span className="text-indigo-400 text-2xl"></span>
          <span className="text-xl font-bold tracking-tight">PulseIQ</span>
        </div>
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/login')}
            className="text-sm text-white hover:text-emerald-300: transition-colors"
          >
            Login
          </button>
        </div>
      </nav>

      {/* HERO */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
        <div className="relative z-10 text-center max-w-4xl mx-auto px-8">

          {/* Letter Reveal */}
          <div
            className="flex items-center justify-center mb-8"
            style={{ perspective: '800px' }}
          >
            {['P','u','l','s','e','I','Q'].map((letter, i) => (
              <span
                key={i}
                className="inline-block font-bold leading-none text-white"
                style={{
                  fontSize: 'clamp(60px, 12vw, 110px)',
                  letterSpacing: '-4px',
                  animation: `letterReveal 0.9s cubic-bezier(0.16,1,0.3,1) ${0.1 + i * 0.08}s both`,
                }}
              >
                {letter}
              </span>
            ))}
          </div>

          {/* Underline */}
          <div
            className="mx-auto mb-8"
            style={{
              height: '1px',
              width: '200px',
              background: 'linear-gradient(to right, transparent, #6366f150, transparent)',
              animation: 'lineReveal 1.2s cubic-bezier(0.16,1,0.3,1) 0.9s both',
              transformOrigin: 'center',
            }}
          />

          {/* Tagline */}
          <p
            className="text-xs tracking-widest text-emerald-400 uppercase mb-8 font-semibold"
            style={{ animation: 'fadeUp 1s ease 1s both' }}
          >
            Real-time System Monitor
          </p>

          {/* Description */}
          <p
            className="text-xl text-white mb-10 max-w-2xl mx-auto leading-relaxed"
            style={{ animation: 'fadeUp 1s ease 1.1s both' }}
          >
            Built for teams who ship fast. Real-time metrics, anomaly detection and instant alerts — all in one dashboard.
          </p>

          {/* Buttons */}
          <div
            className="flex items-center justify-center gap-4"
            style={{ animation: 'fadeUp 1s ease 1.2s both' }}
          >
            <button
              onClick={() => navigate('/login')}
              className="bg-emerald-400 text-black px-8 py-4 rounded-xl font-bold text-lg transition-all hover:scale-105"
            >
              Get Started Free →
            </button>
          </div>
        </div>
      </section>

      {/* FEATURES — Scrollytelling */}
      <section className="max-w-5xl mx-auto px-8">
        {[
          {
            title: 'Real-time Metrics',
            desc: 'Every 5 seconds, PulseIQ reads your server\'s CPU usage, memory consumption, disk space and network traffic. No delays, no guessing. You see exactly what your server is doing the moment it happens — before any user notices a slowdown.',
            color: 'text-emerald-400',
            border: 'border-blue-900',
            bg: 'bg-blue-900/10',
            stat: '24/7',
            statLabel: 'Metrics tracked simultaneously',
            // FIX 1: visual moved inside the object (was floating outside as loose JSX before)
            visual: (
              <div className="w-full aspect-video max-w-sm rounded-3xl border border-blue-900 bg-blue-900/10 flex items-center justify-center">
                <p className="text-gray-600 text-sm italic">Video coming soon</p>
              </div>
            ),
          },
          {
            title: 'Anomaly Detection',
            desc: 'PulseIQ uses a moving average algorithm — built from scratch — that learns what normal looks like for your server. The moment a metric deviates more than 40% above average, it flags an anomaly. No black box AI. Pure logic you can explain.',
            color: 'text-emerald-400',
            border: 'border-purple-900',
            bg: 'bg-purple-900/10',
            stat: '40%',
            statLabel: 'deviation threshold',
          },
          {
            title: 'Instant Alerts',
            desc: 'The moment an anomaly is detected, PulseIQ saves an alert to the database and pushes it live to your dashboard. You see a red warning panel with the exact metric, its current value, and what the normal average was. No email needed — it\'s instant.',
            color: 'text-emerald-400',
            border: 'border-red-900',
            bg: 'bg-red-900/10',
            stat: '<1s',
            statLabel: 'alert response time',
          },
          {
            title: 'Live Dashboard',
            desc: 'A clean React dashboard connected via WebSocket shows your system health in real time. Four live charts update every 5 seconds automatically — no page refresh needed. CPU, memory, disk and network — all visible at one glance.',
            color: 'text-emerald-400',
            border: 'border-green-900',
            bg: 'bg-green-900/10',
            stat: '4',
            statLabel: 'live charts',
          },
        ].map((f, i) => (
          <div
            key={i}
            className={`scroll-reveal opacity-0 translate-y-10 transition-all duration-700 min-h-screen flex items-center py-32`}
          >
            {/* FIX 3: removed md:direction-rtl (not a valid Tailwind class), order handled by children */}
            <div className={`w-full grid grid-cols-1 md:grid-cols-2 gap-16 items-center`}>

              {/* Text side */}
              <div className={i % 2 === 1 ? 'md:order-2' : ''}>
                <div className="text-6xl mb-6">{f.icon}</div>
                <h2 className={`text-4xl font-bold mb-6 ${f.color}`}>{f.title}</h2>
                <p className="text-gray-400 text-lg leading-relaxed mb-8">{f.desc}</p>
                {f.stat && (
                  <p className={`text-lg font-semibold italic ${f.color} opacity-70 mt-2`}>
                    {f.stat} — {f.statLabel}
                  </p>
                )}
              </div>

              {/* Visual side */}
              <div className={`${i % 2 === 1 ? 'md:order-1' : ''} flex items-center justify-center`}>
                <div className={`w-full aspect-video max-w-sm rounded-3xl border ${f.border} ${f.bg} flex items-center justify-center`}>
  <p className="text-gray-600 text-sm italic">Video coming soon</p>
</div>
              </div>

            </div>
          </div>
        ))}
      </section>

      {/* CTA */}
      <section className="py-32 px-8 text-center">
        <div className="scroll-reveal opacity-0 translate-y-10 transition-all duration-700 max-w-2xl mx-auto">
          <h2 className="text-5xl font-bold mb-6">
            Your server is talking.
            <span className="text-emerald-400"> Are you listening?</span>
          </h2>
          <p className="text-gray-400 text-lg mb-10">
            Start monitoring your server in minutes. Free forever.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="bg-emerald-400 text-black px-10 py-5 rounded-xl font-bold text-xl transition-all hover:scale-105"
          >
            Get Started Free →
          </button>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#1a1a1a] py-8 px-8 text-center text-gray-600 text-sm">
        <span className="text-emerald-400 font-bold">PulseIQ</span> — Open source system monitoring.
        Built with Node.js, PostgreSQL, WebSockets and React.
      </footer>

    </div>
  )
}