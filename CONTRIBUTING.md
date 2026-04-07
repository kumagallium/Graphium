# Contributing to Graphium

Thank you for your interest in contributing to Graphium! This guide will help you get started.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+

### Getting Started

```bash
# Clone the repository
git clone https://github.com/kumagallium/provnote.git
cd provnote

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env

# Start development server
pnpm dev          # http://localhost:5173/provnote/

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

## How to Contribute

### Reporting Bugs

1. Search [existing issues](https://github.com/kumagallium/provnote/issues) to avoid duplicates
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

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
