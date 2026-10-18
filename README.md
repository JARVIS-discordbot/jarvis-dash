# Jarvis Dashboard

A local operator dashboard for Red Discord Bot's provisional RPC server.

## Run the dashboard

```powershell
npm install
npm run dev
```

Open `http://127.0.0.1:5173/`, then connect to `ws://127.0.0.1:6133`.

The Explorer can discover and call registered RPC handlers. The Raw call panel can invoke any known handler by name.

## Enable real channel commands

The dashboard's **Run a command** panel uses the included `red_cog/jarvis_dashboard.py` cog. Install that file as a Red cog, load it in the bot, and start Red with `--rpc`.

The cog registers two RPC handlers:

- `DASHBOARD__COMMANDS` returns the loaded command tree, aliases, signatures, help text, and cog names. The dashboard uses this to populate command autocomplete and help metadata.
- `DASHBOARD__COMMAND` executes a command in a real Discord context. It accepts:

```json
{
  "guild_id": "123",
  "channel_id": "456",
  "author_id": "789",
  "command": "ping"
}
```

It resolves the real guild, channel, and member from the bot cache, then invokes Red's normal command pipeline. Replies are sent to the actual Discord channel, and normal command checks/converters still run.

Only expose the dashboard on the same machine as the bot. Red intentionally binds its RPC server to `127.0.0.1` because RPC access is full bot control.

RPC reference: https://docs.discord.red/en/stable/framework_rpc.html
