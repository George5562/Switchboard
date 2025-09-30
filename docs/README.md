# Switchboard Documentation

Comprehensive documentation for the Switchboard MCP proxy, including architecture, lessons learned, and best practices for MCP development.

---

## 📚 Documentation Index

### [Architecture](./architecture.md) (17 KB)
**Detailed system design and data flow diagrams**

Learn how Switchboard works internally:
- High-level architecture and component responsibilities
- Data flow for tool listing, introspection, and subtool calls
- Protocol handling and child process management
- Performance characteristics and token savings metrics
- Security considerations and extension points

**Read this if you want to:**
- Understand how Switchboard transforms MCP tool flooding into clean suite tools
- Learn about the routing logic between host and child MCPs
- See the complete flow from host request to child response
- Extend or modify Switchboard's behavior

---

### [MCP Protocol Lessons](./mcp-protocol-lessons.md) (11 KB)
**Hard-earned insights from building a proxy MCP**

Real-world lessons on:
- **Stdio Protocol Variations** - Content-Length vs line-delimited JSON
- **Protocol Version Evolution** - Why `2024-11-05` matters
- **Parameter Extraction** - ZodObject vs ZodRawShape with MCP SDK
- **Introspection Best Practices** - Why inputSchema is mandatory
- **Child Process Configuration** - Environment variables and timeouts
- **Testing Strategies** - Handling stale MCP connections
- **JSON-RPC Messaging** - Buffer management and incomplete messages
- **Common Pitfalls** - npx delays, stderr handling, async races

**Read this if you want to:**
- Avoid the mistakes we made
- Understand why certain design decisions were made
- Debug protocol-level issues
- Build your own MCP implementation

---

### [Troubleshooting Guide](./troubleshooting-guide.md) (9.4 KB)
**Practical solutions to common issues**

Diagnose and fix:
- Child MCP times out during initialize
- Host can't determine required parameters
- Changes not taking effect (cached instances)
- Parameter extraction failures
- Buffer processing errors
- Child process never spawns
- Tool not found in suite
- Test scripts timeout

**Read this when:**
- Something isn't working and you need a fix NOW
- You're seeing cryptic error messages
- Your changes don't seem to be taking effect
- Child MCPs aren't responding

Each issue includes:
- Symptoms (what you see)
- Diagnosis steps (how to investigate)
- Solutions (how to fix)
- Root cause explanation

---

### [Best Practices](./mcp-best-practices.md) (17 KB)
**Guidelines for building robust MCPs**

20 battle-tested practices covering:

**Protocol Implementation:**
- Support multiple stdio formats
- Use current protocol versions
- Include complete metadata

**Tool Design:**
- Always include inputSchema in introspection
- Use descriptive, action-oriented names
- Keep descriptions concise but complete

**MCP SDK Usage:**
- Use ZodRawShape, not ZodObject
- Proper parameter extraction

**Child Process Management:**
- Pass environment variables through
- Set appropriate timeouts
- Clean up resources

**Testing Strategies:**
- Use standalone testing for development
- Create mock MCPs for validation

**Error Handling:**
- Handle incomplete messages gracefully
- Provide actionable error messages

**Performance:**
- Implement lazy loading
- Cache discovery results

**Security:**
- Validate child MCP configurations
- Sandbox working directories

**Documentation:**
- Document schemas thoroughly
- Provide concrete examples

**Read this when:**
- Starting a new MCP implementation
- Reviewing code quality
- Debugging performance issues
- Hardening production deployments

---

## 🚀 Quick Start Paths

### I'm building a new MCP
1. Read [Best Practices](./mcp-best-practices.md) first
2. Skim [Protocol Lessons](./mcp-protocol-lessons.md) for gotchas
3. Keep [Troubleshooting Guide](./troubleshooting-guide.md) handy

### I'm debugging an existing MCP
1. Start with [Troubleshooting Guide](./troubleshooting-guide.md)
2. Check [Protocol Lessons](./mcp-protocol-lessons.md) if it's protocol-related
3. Reference [Architecture](./architecture.md) if you need to understand internal flow

### I'm contributing to Switchboard
1. Read [Architecture](./architecture.md) to understand the design
2. Review [Best Practices](./mcp-best-practices.md) before making changes
3. Update docs when adding features

### I'm evaluating Switchboard
1. Start with [Architecture](./architecture.md) for high-level overview
2. Check [Protocol Lessons](./mcp-protocol-lessons.md) to see what problems it solves
3. Skim [Best Practices](./mcp-best-practices.md) to assess quality

---

## 🎯 Key Takeaways

### From Protocol Lessons
- **MCP SDK standard is newline-delimited JSON** - use `json + '\n'`, not Content-Length headers
- **Switchboard receives both formats** - child MCPs send newline-delimited, but Switchboard accepts both for compatibility
- **Protocol version matters** - use `2024-11-05`, not `0.1.0`
- **ZodObject vs ZodRawShape is critical** - wrong choice breaks parameter extraction
- **inputSchema must be included** - hosts can't construct calls without it

### From Architecture
- **Switchboard saves 85-90% tokens** by lazy-loading subtools
- **One suite tool per child MCP** instead of exposing all tools individually
- **Lazy initialization** - child processes spawn only when needed
- **Dual protocol support** built into buffer processing

### From Troubleshooting
- **Most issues are cached instances** - restart your MCP host
- **Use standalone tests** to verify code changes immediately
- **Check debug logs** to see what's actually happening
- **Test with mock MCPs** for reliable validation

### From Best Practices
- **Send newline-delimited JSON to child MCPs** - this is the MCP SDK standard
- **Accept multiple stdio formats when receiving** - for maximum compatibility
- **Clean up resources** - timers, processes, pending promises
- **Validate configurations** - don't trust user-provided .mcp.json files
- **Provide actionable errors** - help users debug by including context

---

## 📊 Documentation Statistics

| Document | Size | Sections | Code Examples |
|----------|------|----------|---------------|
| Architecture | 17 KB | 16 | 20+ |
| Protocol Lessons | 11 KB | 9 | 25+ |
| Troubleshooting | 9.4 KB | 9 | 30+ |
| Best Practices | 17 KB | 20 | 40+ |
| **Total** | **54.4 KB** | **54** | **115+** |

---

## 🔄 Keeping Documentation Updated

When making code changes:

1. **Update Architecture** if you change:
   - Component responsibilities
   - Data flow
   - Protocol handling

2. **Add to Protocol Lessons** if you discover:
   - New protocol quirks
   - SDK behavior changes
   - Common mistakes

3. **Expand Troubleshooting** if you encounter:
   - New error scenarios
   - Non-obvious solutions
   - Root causes that need explanation

4. **Revise Best Practices** if you find:
   - Better ways to do things
   - New patterns that work well
   - Old practices that don't scale

---

## 📝 Writing Style

These docs aim to be:
- **Practical** - Focus on real problems and solutions
- **Concrete** - Use actual code examples, not pseudocode
- **Balanced** - Show both ✅ good and ❌ bad approaches
- **Contextual** - Explain *why*, not just *what*
- **Scannable** - Use headers, lists, and code blocks liberally

---

## 🙏 Contributing

Found a mistake? Have a question? Discovered a new lesson?

1. **File an issue** with the `documentation` label
2. **Submit a PR** with improvements
3. **Share your experience** - what worked, what didn't

These docs are living documents built from real-world experience. Your contributions make them better for everyone.

---

## 📜 License

Same as Switchboard: MIT

---

## 🔗 Related Resources

- [MCP Official Spec](https://spec.modelcontextprotocol.io/)
- [MCP SDK Documentation](https://github.com/modelcontextprotocol/sdk)
- [Switchboard Main README](../README.md)
- [Switchboard Test Suite](../test/)

---

**Last Updated:** 2025-09-30 (Fixed: Stdio framing to use newline-delimited JSON)
**Version:** 0.1.0 (matches Switchboard release)