"""Expose a local RPC entry point for executing Red commands in a real channel."""

from types import SimpleNamespace

import discord
from discord.ext.commands.view import StringView
from redbot.core import commands


class JarvisDashboard(commands.Cog):
    """Bridge the local Jarvis dashboard to Red's normal command pipeline."""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.bot.register_rpc_handler(self.DASHBOARD__COMMAND)
        self.bot.register_rpc_handler(self.DASHBOARD__COMMANDS)

    def cog_unload(self):
        self.bot.unregister_rpc_handler(self.DASHBOARD__COMMAND)
        self.bot.unregister_rpc_handler(self.DASHBOARD__COMMANDS)

    async def DASHBOARD__COMMANDS(self) -> list[dict]:
        """Return the loaded bot command tree for dashboard autocomplete."""
        return [
            {
                "name": command.qualified_name,
                "aliases": list(command.aliases),
                "signature": command.signature,
                "help": command.help or command.short_doc or "No help text available.",
                "cog": command.cog_name,
                "has_subcommands": bool(command.commands) if isinstance(command, commands.Group) else False,
            }
            for command in sorted(self.bot.walk_commands(), key=lambda item: item.qualified_name)
            if not command.hidden
        ]

    async def DASHBOARD__COMMAND(self, payload: dict) -> dict:
        """Execute a command as a selected Discord member in a selected channel.

        payload must contain guild_id, channel_id, author_id, and command.
        The command is passed through Red's normal checks, converters, and
        invocation flow. Its response is sent to the real Discord channel.
        """
        required = ("guild_id", "channel_id", "author_id", "command")
        missing = [key for key in required if not payload.get(key)]
        if missing:
            raise ValueError(f"Missing required fields: {', '.join(missing)}")

        command_text = str(payload["command"]).strip()
        if not command_text:
            raise ValueError("command cannot be empty")

        guild = self.bot.get_guild(int(payload["guild_id"]))
        channel = self.bot.get_channel(int(payload["channel_id"]))
        if guild is None or channel is None:
            raise ValueError("Guild or channel is not cached by the bot")

        author = guild.get_member(int(payload["author_id"]))
        if author is None:
            author = await guild.fetch_member(int(payload["author_id"]))

        message = SimpleNamespace(
            id=0,
            content=command_text,
            author=author,
            channel=channel,
            guild=guild,
            webhook_id=None,
            attachments=[],
            embeds=[],
            mentions=[],
            role_mentions=[],
            channel_mentions=[],
            reference=None,
            interaction=None,
            type=discord.MessageType.default,
            flags=discord.MessageFlags._from_value(0),
        )
        context = commands.Context(
            message=message,
            bot=self.bot,
            view=StringView(command_text),
            args=[],
            kwargs={},
        )
        context.prefix = payload.get("prefix") or await self.bot.get_prefix(message)
        await self.bot.invoke(context)

        return {
            "ok": True,
            "command": command_text,
            "resolved_command": context.command.qualified_name if context.command else None,
            "channel_id": channel.id,
        }


async def setup(bot: commands.Bot):
    await bot.add_cog(JarvisDashboard(bot))
