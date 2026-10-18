import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocket, WebSocketServer } from 'ws'

const root = path.dirname(fileURLToPath(import.meta.url))
const port = Number(process.env.PORT || 3000)
const rpcUrl = process.env.RED_RPC_URL || 'ws://127.0.0.1:6133'
let clientId = process.env.DISCORD_CLIENT_ID
let clientSecret = process.env.DISCORD_CLIENT_SECRET
const redirectUri = process.env.DISCORD_REDIRECT_URI || `http://127.0.0.1:${port}/auth/callback`
const sessions = new Map()
const oauthStates = new Set()
const allowedMethods = new Set(['GET_METHODS', 'GET_METHOD_INFO', 'DASHBOARD__COMMANDS', 'DASHBOARD__COMMAND'])

const json = (response, status, body, headers = {}) => {
    response.writeHead(status, { 'content-type': 'application/json', ...headers })
    response.end(JSON.stringify(body))
}
const cookies = (request) => Object.fromEntries((request.headers.cookie || '').split(';').filter(Boolean).map((item) => { const [key, ...value] = item.trim().split('='); return [key, decodeURIComponent(value.join('='))] }))
const sessionFor = (request) => sessions.get(cookies(request).jarvis_session)
const redirect = (response, location, headers = {}) => { response.writeHead(302, { location, ...headers }); response.end() }
const sessionCookie = (id) => `jarvis_session=${encodeURIComponent(id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`

async function discordRequest(url, options) {
    const result = await fetch(url, options)
    if (!result.ok) throw new Error(`Discord API returned ${result.status}`)
    return result.json()
}

async function loadCogCredentials() {
    if (clientId && clientSecret) return
    await new Promise((resolve) => {
        const socket = new WebSocket(rpcUrl)
        const timeout = setTimeout(() => { socket.close(); resolve() }, 1500)
        socket.on('open', () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'DASHBOARD__OAUTH_CONFIG', params: [] })))
        socket.on('message', (raw) => {
            try {
                const result = JSON.parse(raw.toString()).result
                if (result?.client_id && result?.client_secret) { clientId = result.client_id; clientSecret = result.client_secret }
            } finally { clearTimeout(timeout); socket.close(); resolve() }
        })
        socket.on('error', () => { clearTimeout(timeout); resolve() })
    })
}

const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`)
    if (url.pathname === '/auth/login') {
        if (!clientId || !clientSecret) return json(response, 500, { error: 'Set DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET first.' })
        const state = crypto.randomBytes(24).toString('hex')
        oauthStates.add(state)
        const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify', state })
        return redirect(response, `https://discord.com/oauth2/authorize?${query}`, { 'set-cookie': `jarvis_oauth_state=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600` })
    }
    if (url.pathname === '/auth/callback') {
        const state = url.searchParams.get('state')
        const stateCookie = cookies(request).jarvis_oauth_state
        if (!state || state !== stateCookie || !oauthStates.delete(state)) return json(response, 400, { error: 'Invalid OAuth state.' })
        try {
            const form = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: redirectUri })
            const token = await discordRequest('https://discord.com/api/oauth2/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form })
            const user = await discordRequest('https://discord.com/api/users/@me', { headers: { authorization: `${token.token_type} ${token.access_token}` } })
            const sessionId = crypto.randomBytes(32).toString('hex')
            sessions.set(sessionId, { user, expires: Date.now() + 12 * 60 * 60 * 1000 })
            return redirect(response, '/', { 'set-cookie': [sessionCookie(sessionId), 'jarvis_oauth_state=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'] })
        } catch (error) { return json(response, 502, { error: error.message }) }
    }
    if (url.pathname === '/auth/logout') {
        sessions.delete(cookies(request).jarvis_session)
        return redirect(response, '/', { 'set-cookie': 'jarvis_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' })
    }
    if (url.pathname === '/api/me') {
        const session = sessionFor(request)
        if (!session || session.expires < Date.now()) return json(response, 401, { authenticated: false })
        return json(response, 200, { authenticated: true, user: { id: session.user.id, username: session.user.username, global_name: session.user.global_name, avatar: session.user.avatar } })
    }
    if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Not found' })
    if (process.env.NODE_ENV === 'production') {
        const file = url.pathname === '/' ? '/dist/index.html' : `/dist${url.pathname}`
        const filePath = path.join(root, file)
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return fs.createReadStream(filePath).pipe(response)
    }
    response.writeHead(404); response.end('Run Vite in development or build for production.')
})

const wss = new WebSocketServer({ noServer: true })
server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, `http://${request.headers.host}`)
    const session = sessionFor(request)
    if (url.pathname !== '/rpc' || !session || session.expires < Date.now()) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, session))
})
wss.on('connection', (client, session) => {
    const upstream = new WebSocket(rpcUrl)
    upstream.on('open', () => client.on('message', (raw) => {
        try {
            const message = JSON.parse(raw.toString())
            if (!allowedMethods.has(message.method)) return client.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method is not allowed through the dashboard.' } }))
            if (message.method === 'DASHBOARD__COMMAND') {
                const payload = Array.isArray(message.params) ? message.params[0] : message.params
                if (!payload || typeof payload !== 'object') return client.send(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: 'Command payload must be an object.' } }))
                message.params = [{ ...payload, author_id: session.user.id }]
            }
            upstream.send(JSON.stringify(message))
        } catch { client.send(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: 'Invalid JSON.' } })) }
    }))
    upstream.on('message', (message) => { if (client.readyState === WebSocket.OPEN) client.send(message) })
    upstream.on('error', () => { if (client.readyState === WebSocket.OPEN) client.close(1011, 'Red RPC unavailable') })
    client.on('close', () => upstream.close())
})
await loadCogCredentials()
server.listen(port, '127.0.0.1', () => console.log(`Jarvis auth proxy listening at http://127.0.0.1:${port}`))
