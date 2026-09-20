# Goll Discord Bot

A modular Discord community-management bot designed for Railway deployment.

## Environment
- DISCORD_TOKEN: Discord bot token
- TTS_TOKEN: TTS provider token
- DATABASE_URL: Railway database connection string

Never commit secrets to GitHub.

## Run
```bash
npm install
npm start
```

## First command
Run `/setup` in the server. The bot creates its managed roles, categories, channels and panels. Use `/setup repair` to repair missing managed resources.
