# DesireCore Core Agent

This repository contains the core DesireCore Agent definition, persona, principles, and skills. [中文说明](./README.zh-CN.md).

The core Agent declares `ui.chat_bubble_mode: "classic"` for bubble-style conversations. This affects only this Agent; the platform default and other Agents remain unchanged. Clients supporting Agent-level message styles read this optional field; removing it restores the platform preference.

The Solver Report Web is maintained independently in [desirecore-agent/solver-report-web](https://github.com/desirecore-agent/solver-report-web), under the **desirecore-agent organization**. Web source, build tools, dependencies, and report evidence do not belong in this Agent repository or its bootstrap archive. The former Web-only history is preserved in the new repository's `archive/web-history` branch.
