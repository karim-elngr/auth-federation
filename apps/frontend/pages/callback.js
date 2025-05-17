import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function Callback() {
  const router = useRouter()

  useEffect(() => {
    // After backend processes the code it will redirect here
    // We simply navigate to home page
    router.replace('/')
  }, [router])

  return <p className="text-center">Processing login...</p>
}
