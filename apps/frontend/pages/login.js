import Layout from '../components/layout'
import { Button } from '../components/ui/button'

export default function Login() {
  return (
    <Layout>
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-center">Login</h1>
        <p className="text-center">Sign in using Zitadel</p>
        <div className="flex justify-center">
          <a href="http://localhost:4000/auth/login">
            <Button>Login with Zitadel</Button>
          </a>
        </div>
      </div>
    </Layout>
  )
}
