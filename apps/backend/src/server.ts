import 'reflect-metadata'
import http from 'http'
import { URL } from 'url'

const PORT = 4000

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    res.statusCode = 404
    return res.end()
  }

  const url = new URL(req.url, `http://${req.headers.host}`)

  if (url.pathname === '/auth/login') {
    // TODO: redirect to Zitadel authorization endpoint
    res.writeHead(302, { Location: 'https://zitadel.example.com/oauth/v2/authorize' })
    return res.end()
  }

  if (url.pathname === '/auth/callback') {
    // TODO: exchange code for tokens and create session
    console.log('Received auth code', url.searchParams.get('code'))
    res.writeHead(302, { Location: 'http://localhost:3000/callback' })
    return res.end()
  }

  res.statusCode = 404
  res.end('Not found')
})

server.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`)
})
