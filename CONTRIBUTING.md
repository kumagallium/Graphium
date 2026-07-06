# Contributing to Graphium

Thank you for your interest in contributing to Graphium! This guide will help you get started.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+

### Getting Started

```bash
# Clone the repository
git clone https://github.com/kumagallium/Graphium.git
cd Graphium

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Start development server (frontend + backend)
pnpm dev --port 5174   # frontend: http://localhost:5174/Graphium/ (backend API on :3001)

# Start Storybook
pnpm storybook    # http://localhost:6006/
```

### Running Tests

```bash
pnpm test             # Run tests
pnpm test -- --run    # Run tests once (no watch)
```

### Building

```bash
pnpm build            # TypeScript check + Vite production build
```

## Platform Support

Desktop releases are built for **macOS (Apple Silicon)** and **Windows (x64)** only.
Linux and Intel macOS builds are intentionally not published: there is currently no
developer with those machines who can verify release builds end-to-end, and we don't
want to ship untested binaries. On those platforms, please use the
[browser version](https://kumagallium.github.io/Graphium/) or the self-hosted Docker
setup described in the [README](README.md#option-3-run-with-docker--with-the-ai-backend).
If you can help test release builds on Linux or Intel macOS, please
[open an issue](https://github.com/kumagallium/Graphium/issues) — that is the main
blocker for supporting them.

## How to Contribute

### Reporting Bugs

1. Search [existing issues](https://github.com/kumagallium/Graphium/issues) to avoid duplicates
2. Open a new issue with:
   - Steps to reproduce
   - Expected vs actual behavior
   - Browser and OS information

### Suggesting Features

Open an issue with the `enhancement` label describing:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/your-feature`)
3. Make your changes
4. Run tests and ensure they pass (`pnpm test -- --run`)
5. Ensure the build succeeds (`pnpm build`)
6. Commit with a clear message following the [commit convention](#commit-messages)
7. Push and open a Pull Request

### Commit Messages

```
[type] Short description

Types:
  feat     - New feature
  fix      - Bug fix
  docs     - Documentation only
  refactor - Code refactoring
  chore    - Maintenance tasks
  test     - Adding or updating tests
```

Example: `[feat] Add PDF export for notes`

## Code Style

- **Language**: TypeScript (strict mode enabled)
- **Package manager**: pnpm only (do not use npm or yarn)
- **UI components**: Use Storybook for development and review
- **i18n**: All user-facing strings must use the `t()` function from `src/i18n/`

## Project Structure

```
src/
├── blocks/        # Custom BlockNote blocks
├── components/    # Shared UI components
├── features/      # Feature modules (provenance, navigation, etc.)
├── i18n/          # Internationalization (en/ja)
├── lib/           # Shared utilities
└── ui/            # Base UI primitives
```

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
