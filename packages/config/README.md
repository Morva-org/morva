# Shared configuration

Planned: built from 1 November 2026.

## Purpose

One copy of the tooling configuration for every workspace, so the web app, API, worker and packages build the same way.

## What it will contain

- Base `tsconfig`.
- Lint and test configuration.
- Environment validation: the 1Click API key and Postgres URL are required server-side and must never reach a browser bundle.
- Shared Tailwind base, if the checkout moves to Tailwind as the PRD suggests.

## PRD sections

§15 Repository and tech stack (`packages/config`), §16 Security and trust (secrets server-side).
