# Contributing to Switchboard

Thank you for considering contributing to Switchboard!

## Development Setup

1. **Clone the repository:**
```bash
git clone https://github.com/George5562/Switchboard.git
cd Switchboard
```

2. **Install dependencies:**
```bash
npm install
```

3. **Build the project:**
```bash
npm run build
```

4. **Run tests:**
```bash
npm test
```

## Project Structure

```
src/
├── index.ts              # Main entrypoint
├── cli/init.ts           # Init command
├── core/
│   ├── config.ts         # Load/validate config
│   ├── registry.ts       # Discover child MCPs
│   ├── child.ts          # Spawn child MCP; JSON-RPC client
│   ├── router.ts         # tools/list + tools/call logic
│   └── summarise.ts      # Shrink descriptions
```

## Development Workflow

### Testing Code Changes

**Important**: MCP hosts cache running instances. After rebuilding, changes won't take effect until the host restarts.

**Quick test without restart:**
```bash
# After making changes
npm run build

# Test with SDK client (spawns fresh process)
npm run test
```

### Local Development

1. Create `.mcp.json` (copy from `.mcp.json.example`)
2. Link for local testing: `npm link`
3. Make changes
4. Build: `npm run build`
5. Test: Use example configs in `.switchboard/`

## Coding Standards

- **TypeScript**: All source code in TypeScript
- **Formatting**: Use Prettier (`npm run format`)
- **Linting**: Use ESLint (`npm run lint`)
- **Tests**: Add tests for new features

## Commit Guidelines

Use [Conventional Commits](https://conventionalcommits.org/):

```
feat: add new feature
fix: bug fix
docs: documentation changes
test: test additions/changes
refactor: code refactoring
chore: maintenance tasks
```

## Pull Request Process

1. Fork and create a feature branch
2. Make changes with tests
3. Ensure all tests pass: `npm test`
4. Ensure code is formatted: `npm run format:fix`
5. Ensure no lint errors: `npm run lint`
6. Update documentation if needed
7. Submit pull request with clear description

## Documentation

When adding features or changing behavior:

- Update `README.md` for user-facing changes
- Update `docs/` for architectural changes
- Add JSDoc comments for complex functions
- Update tests to reflect new behavior

## Questions?

- Open an issue for bugs or feature requests
- Check existing issues before creating new ones
- Join discussions on existing issues

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
