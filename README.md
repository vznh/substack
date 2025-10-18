# Substack SDK for TypeScript

An unofficial TypeScript SDK for interacting with Substack newsletters and content.

## Overview

This package provides TS functionality to interact with Substack's unofficial API, which allows you to
- Retrieve newsletter posts, podcasts, and recommendations
- Fetch user profile information and subscriptions
- Fetch post content and metadata
- Search for posts within newsletters

## Installation
Run `npm install @vznh/substack` in your project.

## Development

To install dependencies:

```bash
bun install
```

This project was created using `bun init` in bun v1.3.1. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.

## Contributions
Thanks for your interest in contributing. Please review all standards by looking at core files in `src/` and try to maintain the same standards. Some notable features are
- snake_casing in functions that are not polymorphed in any way
- practical and standard naming
- keeping files named in kebab-case
- organizing imports

Which can all be noted with a valid `biome.json`, which is on **TODO**.
