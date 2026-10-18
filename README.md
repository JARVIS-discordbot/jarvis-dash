# Jarvis Dashboard

A local control dashboard for Red Discord Bot. It discovers the bot's commands, runs them as an authenticated Discord user, and can either post replies to a channel or return captured replies to the dashboard.

## Architecture

```text
Browser -> Discord OAuth -> Jarvis auth proxy -> Red RPC (127.0.0.1:6133)
                                             -> Red command checks
```

The browser never connects directly to Red's RPC socket. The proxy requires Discord login, replaces the command author with the logged-in Discord user, and only forwards the dashboard handlers.

## Prerequisites

Install these before starting:

- Node.js 18 or newer
- A working Red Discord Bot instance
- Python environment used by that Red instance
- A Discord application for OAuth2

The bot must be running on the same machine as the dashboard unless `RED_RPC_URL` is explicitly configured for another reachable RPC endpoint.

## 1. Install the dashboard

From this repository directory:

```powershell
npm install
```

## 2. Create the Discord OAuth application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications).
2. Create an application, or open an existing one.
3. Open **OAuth2** and add this redirect URI:

```text
http://127.0.0.1:3000/auth/callback
```

4. Copy the **Client ID**.
5. Reset and copy the **Client Secret**. Keep it private.

The dashboard requests only the `identify` OAuth scope. The logged-in user still needs to be a member of the target guild for command execution.

## 3. Install the Red cog

[p]repo add  jarvisdash https://github.com/jarvis-discordbot/jarvis-dash
[p]cog install jarvisdash red_cog

For a local Red data directory, the destination commonly looks like:

```text
<red-data-directory>\cogs\red_cog\
```

Load it from Discord using the Red owner account:

```text
;load red_cog
```

If it was already loaded after an update:

```text
;reload red_cog
```

Start Red with its RPC server enabled. Use the same Red launch command you normally use and add:

```text
--rpc
```

Red's RPC server should report or listen on:

```text
ws://127.0.0.1:6133
```

## 4. Configure OAuth credentials through the cog

After loading `red_cog`, use the Red owner account to save the OAuth credentials:

```text
;dashboardsetcreds YOUR_DISCORD_CLIENT_ID YOUR_DISCORD_CLIENT_SECRET
```

This command is owner-only. Credentials are stored with Red's `Config` system and are not sent to the browser. Restart the dashboard proxy after changing them.

## 5. Configure the dashboard (optional environment override)

Environment variables override values stored by the cog. This is useful for deployment or for keeping credentials outside the bot configuration:

```powershell
$env:DISCORD_CLIENT_ID = "your-discord-client-id"
$env:DISCORD_CLIENT_SECRET = "your-discord-client-secret"
```

Optional settings:

```powershell
$env:PORT = "3000"
$env:RED_RPC_URL = "ws://127.0.0.1:6133"
$env:DISCORD_REDIRECT_URI = "http://127.0.0.1:3000/auth/callback"
```

`DISCORD_REDIRECT_URI` must exactly match the URI configured in the Discord Developer Portal.

## 6. Start the dashboard

For development with hot reload:

```powershell
npm run dev
```

This starts:

- Vite at `http://127.0.0.1:5173/`
- The OAuth and RPC proxy at `http://127.0.0.1:3000/`

Open the Vite URL and choose **LOG IN WITH DISCORD**.

For a production-style local run:

```powershell
npm run build
$env:NODE_ENV = "production"
npm start
```

Then open:

```text
http://127.0.0.1:3000/
```

## Using the dashboard

1. Log in with Discord.
2. Click **CONNECT**.
3. The command catalog is loaded from the bot through `DASHBOARD__COMMANDS`.
4. Enter a guild ID and channel ID where the authenticated user is a member.
5. Choose a command from autocomplete or type it manually.
6. Choose the response mode:
   - **Send response to Discord channel**: runs the command and posts normal replies to Discord.
   - Unchecked: runs the command without posting a Discord message and returns standard `ctx.send`/`ctx.reply` output in the dashboard response.
7. Click **RUN IN CHANNEL** or **RUN FOR DASHBOARD**.

The command is invoked through Red's normal pipeline, so command checks, converters, cooldowns, and permission failures still apply.

## Discord permissions

The authenticated dashboard user must:

- Be a member of the selected guild
- Have permission to use the command being run
- Have access to the selected channel

The bot must also have the required permissions in that channel, normally **View Channel**, **Read Message History**, and **Send Messages** when channel replies are enabled.

Use Discord Developer Mode to copy guild and channel IDs. The dashboard uses the OAuth user's Discord ID as the command author; it does not trust an author ID entered by the browser.

## RPC handlers

The cog registers:

- `DASHBOARD__COMMANDS`: returns loaded command names, aliases, signatures, help text, and cog names.
- `DASHBOARD__COMMAND`: runs a command with a selected guild and channel context.

The proxy only forwards these handlers plus the read-only discovery methods `GET_METHODS` and `GET_METHOD_INFO`. Other RPC methods are rejected.

## Troubleshooting

### `401` from `/api/me`

You are not logged in, or the dashboard proxy is not running. Start with `npm run dev` and use the Discord login link.

### OAuth redirect error

The redirect URI in Discord Developer Portal must exactly equal:

```text
http://127.0.0.1:3000/auth/callback
```

Also verify `DISCORD_CLIENT_ID` and `DISCORD_CLIENT_SECRET` are set in the same PowerShell terminal that starts the dashboard.

### `Red RPC unavailable`

Start Red with `--rpc`, verify the cog is loaded, and confirm that port `6133` is available on `127.0.0.1`.

### `Guild or channel is not cached by the bot`

Make sure the bot is in the guild, the IDs are correct, and restart or reconnect Red so the guild and channel are cached.

### `Command not found` or permission failure

Try the command in Discord as the same OAuth user. The dashboard uses Red's normal command resolution and permission checks, so a command that fails in Discord will fail from the dashboard too.

## Security notes

- Do not expose port `3000` or Red's port `6133` to the public internet without adding a proper deployment security layer.
- Never commit `DISCORD_CLIENT_SECRET`.
- Red's RPC is full bot control, which is why this project keeps it behind the local authenticated proxy.
