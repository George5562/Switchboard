# Switchboard

[![npm version](https://img.shields.io/npm/v/@george5562/switchboard)](https://www.npmjs.com/package/@george5562/switchboard)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

**Stop drowning in AI tool clutter.** Switchboard bundles all your AI tools into neat little packages, so Claude Code's workspace stays clean and fast. Instead of seeing hundreds of individual tools, you see one package per tool suite.

**Save 85-90% of your context window** - that's like getting 10x more room to work.

---

## Install It

```bash
npm install -g @george5562/switchboard
cd your-project
switchboard init
# Restart Claude Code (or whatever you're using)
```

That's it. Switchboard finds your existing setup and tidies everything up automatically.

---

## Pick Your Flavor

When you run `switchboard init`, you'll choose between two modes:

### Original Mode (Default)

**What it does:** Bundles your tools into organized packages. When you need something, you ask to see what's in the package, then pick what you want.

**Best for:** Most people. It's simple, fast, and keeps things tidy.

**Why use it:** You have multiple tool suites connected and want them all ready to go without cluttering your workspace.

```bash
switchboard init
# Choose "N" for normal mode
```

---

### Claudeception Mode

**What it does:** Gives each tool suite its own personal Claude assistant. You talk to them in plain English, they handle the technical stuff, and give you back just the important bits.

**The magic:** Some tools spit out massive responses (think: database queries with thousands of rows). Claudeception catches that avalanche and hands you a neat summary instead. Your main workspace stays clean.

**Best for:** Tools that return lots of data (databases, web scrapers, file systems).

**The catch:** You need Claude Code installed on your machine. But the cool part? You're already using your existing subscription - no extra API keys needed.

```bash
switchboard init
# Choose "y" for Claudeception
# Then run: npm install zod @modelcontextprotocol/sdk
```

**Example conversation:**
```
You: "Store a note saying hello"
Memory assistant: "Done. Saved your note."

You: "What note did I just save?"
Memory assistant: "The one that says 'hello'"
```

Each assistant remembers your conversation, so you can have back-and-forth chats.

---

## How to Use It

### With Original Mode

Your tools look like `memory_suite`, `supabase_suite`, etc.

**Want to see what's inside?** Ask Claude Code to introspect the suite.

**Want to use something specific?** Just tell Claude Code what you want to do - it'll handle calling the right tool.

### With Claudeception Mode

Your tools have the same names, but you just talk to them normally.

**Example:** "Hey memory, count how many notes I have" or "Supabase, show me the users table"

The assistant handles the details and gives you a clean answer.

---

## Adding More Tools

Already set up Switchboard? Add more tools easily:

```bash
switchboard add filesystem
switchboard add my-custom-tool node ./server.js
```

They'll use whatever mode you picked during `init`.

---

## Changed Your Mind?

Want to switch modes or go back to how things were?

```bash
switchboard revert
# Then run init again with different choices
```

---

## Want More Details?

Check out the [full documentation](./docs/README.md) for:
- Deep dive into how Claudeception works
- Configuration options
- Troubleshooting tips
- Architecture details

---

## Links

- **npm package:** https://www.npmjs.com/package/@george5562/switchboard
- **GitHub:** https://github.com/George5562/Switchboard
- **Issues/Questions:** https://github.com/George5562/Switchboard/issues
