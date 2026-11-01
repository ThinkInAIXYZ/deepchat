import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type RequestListener } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { connect, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function startHttpsFixture(hosts: string[], handler: RequestListener) {
  const directory = mkdtempSync(join(tmpdir(), 'deepchat-https-fixture-'))
  const certificate = join(directory, 'fixture.pem')
  writeFileSync(certificate, HTTPS_FIXTURE_CERTIFICATE)
  const envKeys = [
    'NODE_EXTRA_CA_CERTS',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'NO_PROXY',
    'no_proxy'
  ] as const
  const inherited = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))
  process.env.NODE_EXTRA_CA_CERTS = certificate
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1'
  process.env.NO_PROXY = ''
  process.env.no_proxy = ''
  const sockets = new Set<Socket>()
  const target = createHttpsServer(
    { key: HTTPS_FIXTURE_KEY, cert: HTTPS_FIXTURE_CERTIFICATE },
    handler
  )
  const proxy = createServer((_request, response) => response.writeHead(404).end())
  for (const server of [target, proxy])
    server.on('connection', (socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
    })
  proxy.on('connect', (request, client, head) => {
    if (!hosts.some((host) => request.url === `${host}:443`)) {
      client.destroy()
      return
    }
    const upstream = connect((target.address() as { port: number }).port, '127.0.0.1', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(client)
      client.pipe(upstream)
    })
    sockets.add(upstream)
    upstream.once('close', () => {
      sockets.delete(upstream)
      client.destroy()
    })
    client.once('close', () => upstream.destroy())
    client.on('error', () => upstream.destroy())
    upstream.on('error', () => client.destroy())
  })
  const close = async () => {
    for (const socket of sockets) socket.destroy()
    try {
      await Promise.all(
        [target, proxy].map(
          (server) => new Promise<void>((resolve) => server.close(() => resolve()))
        )
      )
    } finally {
      for (const key of envKeys) {
        if (inherited[key] === undefined) delete process.env[key]
        else process.env[key] = inherited[key]
      }
      rmSync(directory, { recursive: true, force: true })
    }
  }
  try {
    for (const server of [target, proxy]) await once(server.listen(0, '127.0.0.1'), 'listening')
    return { proxyUrl: `http://127.0.0.1:${(proxy.address() as { port: number }).port}`, close }
  } catch (error) {
    await close()
    throw error
  }
}

// Public test certificate; trust is scoped to the disposable app processes.
const HTTPS_FIXTURE_CERTIFICATE = `-----BEGIN CERTIFICATE-----
MIICLTCCAdKgAwIBAgIJAP4V/cL19n3EMAoGCCqGSM49BAMCMCExHzAdBgNVBAMM
FkRlZXBDaGF0IEhUVFBTIGZpeHR1cmUwIBcNMjYxMDMwMjAwODA5WhgPMjEyNjEw
MDYyMDA4MDlaMCExHzAdBgNVBAMMFkRlZXBDaGF0IEhUVFBTIGZpeHR1cmUwWTAT
BgcqhkjOPQIBBggqhkjOPQMBBwNCAATcBwNMi0XCCLfN+/uKzbpnaSh2+AsG/XoV
HUYIX7vtpjBuRc8hSuMyJc2CFT7WbV9cVndF660k8168ccOFnfkoo4HwMIHtMA8G
A1UdEwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgKEMBMGA1UdJQQMMAoGCCsGAQUF
BwMBMIG0BgNVHREEgawwgamCDmFwaS5naXRodWIuY29tgg9hdXRoLm9wZW5haS5j
b22CCWF1dGgueC5haYIZcmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbYIbY2RuLmFn
ZW50Y2xpZW50cHJvdG9jb2wuY29tghpzeW5jLXRva2VuLWZpeHR1cmUuaW52YWxp
ZIIVaWxpbmthaS53ZWl4aW4ucXEuY29tghBhcGkudGVsZWdyYW0ub3JnMAoGCCqG
SM49BAMCA0kAMEYCIQDa3pgQZX5CKY/xMJIBp9poCfTjzQh3Uu3eVeT9HHihbAIh
APmhijn9Ge9W2JNilPs/nlpPW6yqwel+GFVhQZiuO3hl
-----END CERTIFICATE-----
`
const HTTPS_FIXTURE_KEY = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIFYXNXboDpmNI524QvRBpIEqwdwgPQswYye5tt36yEFjoAoGCCqGSM49
AwEHoUQDQgAE3AcDTItFwgi3zfv7is26Z2kodvgLBv16FR1GCF+77aYwbkXPIUrj
MiXNghU+1m1fXFZ3ReutJPNevHHDhZ35KA==
-----END EC PRIVATE KEY-----
`
