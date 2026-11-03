# SharkLab Studio - Junos CLI Engine - Progress

## Setup
- [ ] TypeScript/Vitest scaffolding

## Phase 1 - Lexer, Prefix Engine, Modes & Pipeline
- [ ] Tokenizer
- [ ] Command registry + unambiguous prefix expansion
- [ ] Junos error/ambiguity output
- [ ] Pipes
- [ ] Session state machine
- [ ] parser tests (25+ assertions)

## Phase 2 - Configuration AST, Diff, Commit & Rollback
- [ ] Hierarchical candidate/active trees
- [ ] set/delete/edit/up/top/activate/deactivate
- [ ] brace + display set renderers
- [ ] show | compare diff
- [ ] commit/commit check/commit confirmed/rollback 0-49

## Phase 3 - Hardware Profiles, Interfaces, ARP
- [ ] vSRX/vMX/EX profiles
- [ ] interface terse/detail output
- [ ] show version / uptime / arp

## Phase 4 - RIB/FIB, Static Routes, Ping
- [ ] direct/local/static routes
- [ ] show route variants
- [ ] ping/traceroute simulation

## Phase 5 - OSPF FSM
- [ ] adjacency state machine + DR/BDR
- [ ] mismatch handling
- [ ] SPF route injection
- [ ] OSPF commands

## Log
## Phase 1 - COMPLETE
- Tokenizer (quotes, escapes, pipes, offsets) implemented.
- Command registry with unique prefix expansion, ambiguity completions, mode filtering, arg specs.
- Pipes: match/except/count/display set/no-more.
- Render caret + Possible completions formatter.
- JunosSession: login -> shell -> operational -> configure -> nested edit; exit confirmation; ? and Tab.
- Verification: npx vitest run src/junos/parser/ -> 41 tests passed.
## Phase 2 - COMPLETE
- ConfigTree candidate/active AST with set/delete/activate/deactivate and multi-value leaves.
- Brace renderer, display-set flattener, keyed containers (unit/family/area/route/interface/...).
- Diff engine with [edit ...] headers and +/- subtree rendering; show | compare pipe.
- ConfigManager: commit check/commit/commit and-quit/commit confirmed auto-rollback, 50-level rollback history.
- Config CLI commands wired through JunosSession.
- Verification: npx vitest run src/junos/config/ -> 24 tests passed.
## Phase 3 - COMPLETE
- Profiles for vSRX (ge), vMX (xe), EX (24x ge) with deterministic MACs, serials, MTU defaults.
- InterfaceEngine: physical/unit state, admin disable, canvas link up/down, terse and detail renderers.
- ArpTable + show version / show system uptime / show arp.
- JunosDevice operational registry and session factory.
- Verification: npx vitest run src/junos/engine/interfaces.test.ts -> 18 tests passed.

## Phase 4 - COMPLETE
- IPv4 helpers, Rib with Direct(0), Local(0), Static(5), hidden unresolved next hops.
- show route, show route summary, show route forwarding-table.
- Canvas Network: links, ARP population, longest-prefix forwarding, ICMP ping and traceroute.
- Verification: npx vitest run src/junos/engine/rib.test.ts -> 16 tests passed.
## Phase 5 - COMPLETE
- OspfEngine: neighbor discovery on connected OSPF interfaces, tick FSM Down -> Init -> 2Way -> ExStart -> Exchange -> Loading -> Full.
- Broadcast DR/BDR election, area and MTU mismatch holds at ExStart, passive interfaces excluded.
- SPF injects remote direct networks as [OSPF/10] routes with next-hop/interface resolution; clear removes them.
- show ospf neighbor / interface / database and clear ospf neighbor commands wired to JunosDevice.
- Verification: npx vitest run src/junos/protocols/ospf.test.ts -> 14 tests passed.
- Full suite: npx vitest run -> 113 tests passed (5 files). npx tsc --noEmit -> clean.
