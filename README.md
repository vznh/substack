# Substack SDK for TypeScript

An unofficial TypeScript SDK for interacting with Substack newsletters and content.

[![npm version](https://badge.fury.io/js/@vznh%2Fsubstack.svg)](https://badge.fury.io/js/@vznh%2Fsubstack)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)

## Overview

This package provides TS functionality to interact with Substack's unofficial API, which allows you to
- Retrieve newsletter posts, podcasts, and recommendations
- Fetch user profile information and subscriptions
- Fetch post content and metadata
- Search for posts within newsletters

Other packages might require you to grab an API key - however, you might end up not using any of those features. 

## Usage
You can easily get started with the SDK through
```typescript
import { substack } from "@vznh/substack";

// Initialize a newsletter by its URL
const newsletter = substack.newsletter()

// Grab the 5 most recent posts from the newsletter
const recent_posts = newsletter.get_posts(5);

// Grab the top 3 posts from the newsletter
const top_posts = newsletter.get_posts("top", 3);

// Search for the 3 most relevant posts using a query, if any
const search_results = await newsletter.search_posts("machine learning", 3);

// Get recommendeded newsletters
const recommendations = await newsletter.get_recommendations();

// Get newsletter author(s)
const authors = await newsletter.get_authors();
```

## Installation
Run `npm install @vznh/substack` in your project.

## Development

`@vznh/substack` uses [Bun](https://bun.com), Zod for type validation, and ts-logger for development.

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

## Disclaimer
This package is not affiliated with, endorsed by, or connected to Substack in any way. It is an independent project created to make Substack content more accessible through Node.
