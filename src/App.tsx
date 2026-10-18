import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type RpcLog = { id: number; method: string; status: 'success' | 'error'; detail: string; time: string }
type RpcMessage = { id?: number; result?: unknown; error?: { code?: number; message?: string; data?: unknown } }
type BotCommand = { name: string; aliases: string[]; signature: string; help: string; cog: string | null; has_subcommands: boolean }
const defaultParams = JSON.stringify({ args: [], kwargs: {} }, null, 2)
const prettyJson = (value: unknown) => JSON.stringify(value, null, 2) ?? String(value)

function App() {
  const socketRef = useRef<WebSocket | null>(null)
  const requestId = useRef(1)
  const pending = useRef(new Map<number, (message: RpcMessage) => void>())
  const [endpoint, setEndpoint] = useState('ws://127.0.0.1:6133')
  const [connected, setConnected] = useState(false)
  const [methods, setMethods] = useState<string[]>([])
  const [botCommands, setBotCommands] = useState<BotCommand[]>([])
  const [selectedMethod, setSelectedMethod] = useState('')
  const [params, setParams] = useState(defaultParams)
  const [channelCommand, setChannelCommand] = useState('')
  const [guildId, setGuildId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [authorId, setAuthorId] = useState('')
  const [filter, setFilter] = useState('')
  const [logs, setLogs] = useState<RpcLog[]>([])
  const [response, setResponse] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  const visibleMethods = useMemo(() => methods.filter((method) => method.toLowerCase().includes(filter.toLowerCase())), [filter, methods])
  const addLog = (entry: RpcLog) => setLogs((current) => [entry, ...current].slice(0, 12))

  const request = (method: string, rpcParams: unknown[]) => new Promise<RpcMessage>((resolve) => {
    if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) { resolve({ error: { message: 'Not connected to the RPC server.' } }); return }
    const id = requestId.current++
    pending.current.set(id, resolve)
    socketRef.current.send(JSON.stringify({ jsonrpc: '2.0', id, method, params: rpcParams }))
  })

  const connect = () => {
    socketRef.current?.close()
    const socket = new WebSocket(endpoint)
    socketRef.current = socket
    socket.onopen = () => {
      setConnected(true)
      request('GET_METHODS', []).then((message) => {
        if (message.error || !Array.isArray(message.result)) return
        const nextMethods = message.result.filter((item): item is string => typeof item === 'string').sort()
        setMethods(nextMethods)
        setSelectedMethod(nextMethods[0] ?? '')
      })
      request('DASHBOARD__COMMANDS', []).then((message) => {
        if (!message.error && Array.isArray(message.result)) setBotCommands(message.result as BotCommand[])
      })
    }
    socket.onclose = () => setConnected(false)
    socket.onerror = () => setConnected(false)
    socket.onmessage = (event) => {
      try { const message = JSON.parse(event.data) as RpcMessage; if (typeof message.id === 'number') pending.current.get(message.id)?.(message) }
      catch { addLog({ id: Date.now(), method: 'socket', status: 'error', detail: 'Received invalid JSON', time: new Date().toLocaleTimeString() }) }
    }
  }

  const run = async (method: string, source: string) => {
    let parsed: unknown
    try { parsed = JSON.parse(source) } catch { setResponse({ error: 'Parameters must be valid JSON.' }); return }
    setBusy(true); setResponse(null)
    const message = await request(method, [parsed])
    const isError = Boolean(message.error)
    setResponse(isError ? message.error : message.result)
    addLog({ id: Date.now(), method, status: isError ? 'error' : 'success', detail: isError ? message.error?.message ?? 'RPC error' : 'Completed successfully', time: new Date().toLocaleTimeString() })
    setBusy(false)
  }

  useEffect(() => () => socketRef.current?.close(), [])

  return (
    <main className="app-shell">
      <header className="topbar"><div className="brand"><span className="brand-mark">J</span><div><strong>JARVIS</strong><span>RPC CONTROL DECK</span></div></div><div className={`connection ${connected ? 'online' : ''}`}><span className="status-dot" />{connected ? 'CONNECTED' : 'OFFLINE'}</div></header>
      <section className="hero-row"><div><p className="eyebrow">RED DISCORD BOT / LOCAL RPC</p><h1>Operate your bot<br /><em>without leaving the desk.</em></h1><p className="lede">Discover registered handlers, inspect their contracts, and execute JSON-RPC calls against your local Red instance.</p></div><div className="orbit" aria-hidden="true"><span>RPC</span><i /><i /><i /></div></section>
      <section className="endpoint-bar panel"><div><label htmlFor="endpoint">RPC ENDPOINT</label><input id="endpoint" value={endpoint} onChange={(event) => setEndpoint(event.target.value)} /></div><button className="primary" type="button" onClick={connect}>{connected ? 'RECONNECT' : 'CONNECT'} <span>↗</span></button><div className="warning"><span>!</span> Keep this dashboard local. Red binds RPC to loopback for a reason.</div></section>
      <div className="workspace">
        <aside className="method-panel panel"><div className="panel-heading"><div><p className="eyebrow">01 / EXPLORER</p><h2>Methods <small>{methods.length || '—'}</small></h2></div><button className="icon-button" type="button" onClick={connect} aria-label="Refresh methods">↻</button></div><input className="search" placeholder="Search registered methods" value={filter} onChange={(event) => setFilter(event.target.value)} /><div className="method-list">{visibleMethods.length ? visibleMethods.map((method) => <button key={method} className={selectedMethod === method ? 'method active' : 'method'} type="button" onClick={() => setSelectedMethod(method)}><span className="method-icon">⌁</span>{method}</button>) : <div className="empty">{connected ? 'No matching methods.' : 'Connect to load methods.'}</div>}</div><div className="panel-note">Built-ins include <code>GET_METHODS</code>, <code>GET_METHOD_INFO</code>, and subscription controls.</div></aside>
        <section className="command-panel panel"><div className="panel-heading"><div><p className="eyebrow">02 / COMMAND RUNNER</p><h2>{selectedMethod || 'Select a method'}</h2></div><span className="rpc-badge">JSON-RPC 2.0</span></div><p className="helper">Cog methods expect one object containing positional <code>args</code> and keyword <code>kwargs</code>.</p><label htmlFor="params">PARAMETERS</label><textarea id="params" value={params} onChange={(event) => setParams(event.target.value)} spellCheck="false" /><button className="run-button" type="button" disabled={!selectedMethod || busy} onClick={() => run(selectedMethod, params)}>{busy ? 'EXECUTING...' : 'EXECUTE METHOD'} <span>→</span></button><div className="response"><div className="response-title"><span>LAST RESPONSE</span>{response !== null && <span className="response-state">RECEIVED</span>}</div><pre>{response === null ? '// Awaiting an RPC response' : prettyJson(response)}</pre></div></section>
      </div>
      <section className="bottom-grid"><div className="channel-panel panel"><div className="panel-heading"><div><p className="eyebrow">03 / CHANNEL CONTROL</p><h2>Run a command</h2></div><span className="rpc-badge">{botCommands.length ? `${botCommands.length} LOADED` : 'DASHBOARD__COMMAND'}</span></div><p className="helper">Live command data comes from the bot. Choose a command to see its signature and help.</p><input className="command-input" list="bot-command-list" placeholder="COMMAND, e.g. ping or help" value={channelCommand} onChange={(event) => setChannelCommand(event.target.value)} /><datalist id="bot-command-list">{botCommands.map((command) => <option key={command.name} value={command.name}>{command.signature}</option>)}</datalist>{botCommands.length > 0 && <div className="command-meta">{(() => { const command = botCommands.find((item) => channelCommand.trim().split(/\s+/)[0] === item.name || item.aliases.includes(channelCommand.trim().split(/\s+/)[0])); return command ? <><strong>{command.name} {command.signature}</strong><span>{command.help}</span>{command.aliases.length > 0 && <small>ALIASES: {command.aliases.join(', ')}</small>}</> : <span>Start typing to search {botCommands.length} loaded commands.</span> })()}</div>}<div className="id-grid"><input placeholder="GUILD ID" value={guildId} onChange={(event) => setGuildId(event.target.value)} /><input placeholder="CHANNEL ID" value={channelId} onChange={(event) => setChannelId(event.target.value)} /><input placeholder="AUTHOR / MEMBER ID" value={authorId} onChange={(event) => setAuthorId(event.target.value)} /></div><button className="run-button" type="button" disabled={!channelCommand || !guildId || !channelId || !authorId || busy} onClick={() => run('DASHBOARD__COMMAND', JSON.stringify({ guild_id: guildId, channel_id: channelId, author_id: authorId, command: channelCommand }))}>RUN IN CHANNEL <span>→</span></button></div><div className="history-panel panel"><div className="panel-heading"><div><p className="eyebrow">04 / ACTIVITY</p><h2>Recent calls</h2></div><span className="muted">This session</span></div><div className="history-list">{logs.length ? logs.map((log) => <div className="history-item" key={log.id}><span className={`log-dot ${log.status}`} /><div><strong>{log.method}</strong><span>{log.detail}</span></div><time>{log.time}</time></div>) : <div className="empty">No calls yet.</div>}</div></div></section>
      <footer><span>JARVIS DASHBOARD · LOCAL OPERATOR CONSOLE</span><a href="https://docs.discord.red/en/stable/framework_rpc.html" target="_blank" rel="noreferrer">RPC DOCUMENTATION ↗</a></footer>
    </main>
  )
}

export default App
