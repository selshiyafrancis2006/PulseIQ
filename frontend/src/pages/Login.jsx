import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE_URL } from '../config/api'

export default function Login() {
  const navigate = useNavigate()
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setError('')
    setLoading(true)

    try {
      const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Something went wrong')
        setLoading(false)
        return
      }

      localStorage.setItem('token', data.token)
      navigate('/dashboard')

    } catch (err) {
      setError('Cannot connect to server')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#050508] flex items-center justify-center px-4">

      {/* Card */}
      <div className="w-full max-w-md bg-[#0f0f0f] border border-[#1a1a1a] rounded-2xl p-10">

        {/* Logo */}
        <div
          className="flex items-center gap-2 mb-10 cursor-pointer justify-center"
          onClick={() => navigate('/')}
        >
          <span className="text-indigo-400 text-2xl"></span>
          <span className="text-xl font-bold text-white">PulseIQ</span>
        </div>

        {/* Heading */}
        <h3 className="text-2xl font-bold text-white mb-1 text-center">
          {isLogin ? 'Welcome back' : 'Create account'}
        </h3>
        <p className="text-gray-500 text-sm text-center mb-8">
          {isLogin ? 'Sign in to your dashboard' : 'Start monitoring for free'}
        </p>

        {/* Toggle */}
        <div className="flex bg-[#1a1a1a] rounded-xl p-1 mb-8">
          <button
            onClick={() => setIsLogin(true)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              isLogin ? 'bg-emerald-400 text-black' : 'text-gray-400'
            }`}
          >
            Login
          </button>
          <button
            onClick={() => setIsLogin(false)}
            className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
              !isLogin ? 'bg-emerald-400 text-black' : 'text-gray-400'
            }`}
          >
            Sign Up
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/40 border border-red-800 text-red-400 text-sm px-4 py-3 rounded-lg mb-6">
            {error}
          </div>
        )}

        {/* Email */}
        <div className="mb-4">
          <label className="text-sm text-gray-400 mb-2 block">Email</label>
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="you@startup.com"
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-emerald-400 transition-colors"
          />
        </div>

        {/* Password */}
        <div className="mb-8">
          <label className="text-sm text-gray-400 mb-2 block">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 text-white placeholder-gray-600 focus:outline-none focus:border-emerald-400 transition-colors"
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          />
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full bg-emerald-400 hover:scale-105 text-black disabled:opacity-40 py-4 rounded-xl font-bold text-lg transition-all"
        >
          {loading ? 'Please wait...' : isLogin ? 'Sign In →' : 'Create Account →'}
        </button>

        {/* Footer */}
        <p className="text-gray-600 text-xs text-center mt-6">
          By continuing you agree to our terms of service
        </p>

      </div>
    </div>
  )
}