# Security Policy

This document describes the security model of spirits and where its boundaries are.

## What spirits is, security-wise

spirits is an extension bundle and a launcher that runs on top of the **official Pi host**. The host is
downloaded at runtime into `~/.spirits/managed-pi` as a pinned release, verified against the checksums
recorded in this repository, and launched with the spirits bundle attached.

Like the host, spirits is a coding agent that runs locally **within the security boundary of the user
who runs it**. It is not a sandbox and does not provide one:

- Code the model runs through `tsrepl` executes with the same user privileges as the spirits process.
  The `node:vm` context it runs in is a scoping mechanism, not a security boundary.
- `rlm` child sessions run in the same process and the same privileges as the parent.
- Extensions, skills, and `AGENTS.md`-style instructions are trusted input. Prompt injection through
  repository content is not a vulnerability in this model; it is the documented trust assumption.

It is the user's responsibility to run spirits inside a container, VM, or other containment when
working on untrusted material.

## Integrity of the host and the bundle

The launcher does not run what it cannot verify. The managed set is rejected, with a non-zero exit and
no automatic re-download, when the official artifact checksum, the extension bundle digest, or the
installed set's recorded manifest do not match. Recovery is an explicit `spirits managed-pi repair`.

Self-update replaces only the spirits executable, verifies the SHA256 of the downloaded asset before
installing, and writes through a temporary file in the destination directory. Reports that assume a
man-in-the-middle position against the download endpoint, or that require write access to the user's
home directory, are out of scope.

## Reporting a Vulnerability

If you believe you found a security vulnerability in spirits, report it privately:

- Open a private report through **GitHub Security Advisories** for this repository, or
- Email `betiz0@gmail.com` if you cannot open a private advisory.

Please include:

- A description of the issue and its impact
- Steps to reproduce, a proof of concept, or relevant logs
- The affected spirits version (`spirits --version`), host version (`spirits -- --version`), and commit
- Any known mitigation

Do not open a public issue for security-sensitive reports.

Vulnerabilities in the host itself belong to the upstream Pi project and should be reported through
its own security policy; say so in your report if you have already reported it there.

## In Scope

- The launcher: argument handling, managed set selection, launch, self-update
- Managed set install, verification, overlay, and repair
- The spirits extension's own tools (`tsrepl`, `rlm`, memory/skill/prompt CRUD, session TODO)
- The compatibility measurement harness in a mode that claims product behavior (`official`)

## Out Of Scope

- Local code execution and the absence of a sandbox (intentional)
- Prompt injection, malicious model output, malicious repository content
- Behavior of user-installed extensions or skills
- Risks from working in untrusted repositories or installing untrusted packages, extensions, or skills
- Reports that require the ability to create, modify, delete, or replace files, directories, symlinks,
  environment variables, or shell configuration on the target machine. This includes `~/.spirits`,
  `~/.spirits/agent`, `~/.spirits/managed-pi`, workspace files, `AGENTS.md`, skills, extensions, and
  dotfiles, unless the report shows how spirits itself grants that access
- Exposed third-party or user-controlled credentials
- Issues caused by intentionally weakened configuration or by substituting the host (`--host` in the
  compatibility runner)
- Public internet exposure of a spirits installation

## Notes for Reporters

The most useful reports show a reproducible boundary bypass with demonstrated impact. Reports that only
show expected local-agent behavior, prompt injection, or a malicious trusted extension are not
vulnerabilities under this model. Include the exact version, a proof of concept against the latest
release, and what an attacker gains that the local user does not already have.
