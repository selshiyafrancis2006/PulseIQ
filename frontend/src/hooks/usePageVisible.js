import { useEffect, useState } from 'react'

const readVisible = () =>
  typeof document === 'undefined' || document.visibilityState !== 'hidden'

// True while the browser tab is visible. Used to stop live updates and polling
// in background tabs, and to resume (with a fresh fetch) when the tab returns.
export default function usePageVisible() {
  const [visible, setVisible] = useState(readVisible)

  useEffect(() => {
    const onChange = () => setVisible(readVisible())

    document.addEventListener('visibilitychange', onChange)

    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])

  return visible
}