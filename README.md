# JNCIA Junos Practice Lab

A JNCIA-level Junos lab that runs entirely in your browser. No Junos image, no VM, no licenses.
Drag a topology onto the dark canvas, start the nodes, and open telnet-style consoles into
simulated Junos devices that behave like the real thing: boot messages, `login:` prompts, a root
shell, operational and configuration modes, Junos-shaped tables and errors, a commit workflow
with candidate diffs, and a VPCS host experience for the end devices.

**Live demo:** https://jncia-junos-lab.vercel.app

The simulation is not canned text. Every device has a real hierarchical configuration tree, and
the operational state you see (`show route`, `show ospf neighbor`, `show arp`, interface
counters, ping and traceroute results) is derived from that configuration and the physical
topology at runtime, the same way actual Junos derives state from config.

## What you get

- GNS3-style workbench: menu bar, toolbar with node and link tools, zoomable dark topology
  canvas, draggable device palette, topology and server summary dock, status bar
- Realistic Junos consoles: per-device windows, boot and login flow, `root@R1>` and
  `[edit] root@R1#` prompts, history, Tab and `?` completions with descriptions, Junos-style
  unique prefix matching (`sh ver` resolves), pipe filters (`match`, `except`, `count`),
  and `---(more)---` style pagination
- Configuration workflow that matches Junos: candidate configuration, `show | compare` diffs
  with `+`/`-`/`!` markers, `commit check`, `commit comment`, `commit confirmed` auto-rollback,
  `rollback [n]`, `activate`/`deactivate`, `rename`/`copy`/`annotate`
- Derived runtime state: interfaces with indices and SNMP ifIndex, route tables with correct
  protocol tags and preferences (`Direct/0`, `Local/8`, `Static/5`, `OSPF/10`), OSPF
  adjacencies, LSAs and SPF-derived routes, reciprocal BGP session states, ARP, LLDP,
  MAC learning, RSTP bridge and port roles
- Cross-device sessions: `ssh` or `telnet` from one device console straight into another
- VPCS host consoles for `Host-A` and `Host-B` with host-side ping and trace behavior
- Lab editing tools: link tools, interface labels, annotations (text, rectangle, ellipse, line),
  node lifecycle actions from context menus, quick lab presets, unlimited zoom and pan
- Project workflow: create, save, open, import and export projects, snapshots, all persisted in
  your browser (localStorage), fully offline after first load

## The lab topology

Default preset: **JNCIA Basic Routing** with R1, R2, R3, SW1 and two VPCS hosts.

| Device | Model | Role | Key addresses |
| --- | --- | --- | --- |
| R1 | MX240 | Edge router, static default pointing to R2, OSPF and iBGP speakers | lo0 1.1.1.1/32, ge-0/0/0 in 10.0.12.0/30, fxp0 mgmt 192.168.1.x |
| R2 | MX240 | Core router between R1 and R3 | lo0 2.2.2.2/32, links in 10.0.12.0/30 and 10.0.23.0/30 |
| R3 | MX240 | Edge router with a discard static instead of a default route | lo0 3.3.3.3/32, link in 10.0.23.0/30 |
| SW1 | EX4300-24T | Access switch, staff and guest VLANs, RSTP, IRB inter-VLAN routing | irb.10 10.0.3.2/24, irb.20 10.1.1.2/24, uplink to R1 |
| Host-A | VPCS | End device in the staff VLAN | 10.0.3.20 |
| Host-B | VPCS | End device in the guest VLAN | 10.1.1.20 |

Routed links: R1 to R2 ge-0/0/0 pair on 10.0.12.0/30 and R2 to R3 ge-0/0/0 pair on
10.0.23.0/30. R1 to SW1 is a layer 2 link, and both hosts sit behind SW1 on different
VLANs, which is what makes the cross-VLAN routing through `irb` worth practicing.

## Try this flow

```
login: root
root@R1:~ # cli
root@R1> show version
root@R1> show interfaces terse
root@R1> show route
root@R1> show ospf neighbor
root@R1> ping 2.2.2.2
root@R1> traceroute 3.3.3.3
root@R1> ssh root@3.3.3.3
root@R1> configure
root@R1# set system host-name R1-LAB
root@R1# show | compare
root@R1# commit check
root@R1# commit
root@R1# show configuration | display set
root@R1# exit
```

Console output is rendered Junos-style, adaptive to device type: the EX4300 gets
`show vlans`, `show spanning-tree bridge`, the ethernet-switching table and EX chassis output;
the MX240s get MX chassis, firewall-free routing and BGP views.

## How to run locally

```bash
git clone https://github.com/sarveshkamdi7-collab/SHARKSJunosLabspractice
cd SHARKSJunosLabspractice/Desktop/jnciapracticelabs
npm start
# open http://localhost:3000
```

The only dependency is Node.js itself, version 14 or newer. `npm start` runs
`server/server.js`, a dependency-free static file server that serves `public/` with MIME types,
default routing to `index.html`, and path-traversal protection. Set `PORT` for a different
port. On Windows you can also double-click `START-WINDOWS.bat`, and on Mac or Linux run
`START-MAC-LINUX.sh`.

## Tests

```bash
cd Desktop/jnciapracticelabs
npm test
```

The test runner loads the engine modules (`util`, `db`, `model`, `derive`, `schema`,
`machine`) into a Node VM and checks the simulation core without a browser: prompts and
session flow, config semantics, derived state (MAC learning on SW1, route tables on R1),
`show | compare` diff output, `commit check` success text, and `commit confirmed` behavior.

## How the engine works

Scripts live in `Desktop/jnciapracticelabs/public/js`:

| Layer | Risk | File |
| --- | --- | --- |
| Configuration tree | `set`/`delete`/`deactivate`/`annotate`, brace and set-notation rendering, `show | compare` diffs | `junos/db.js` |
| Runtime derivation | committed configs plus topology become interfaces, subnets, routes, OSPF LSAs and adjacencies, ARP, LLDP, MAC table, STP, BGP sessions, ping and traceroute path resolution | `junos/derive.js` |
| CLI machine | op and config grammar, unique-prefix keyword matching with completions, pipes, session switching, commit lifecycle | `junos/machine.js` |
| Inventory | device specs, binary baseline configs as `set` statements, topology graph and host definitions | `junos/model.js` |
| Command surface map | which commands each device type answers | `junos/schema.js` |
| Utilities | IPv4 math, stable MAC generation, Junos time formats, safe column padding | `junos/util.js` |

The browser shell lives in `public/js/ui` (`core`, `interactions`, `console`, `terminal`,
`modals`, `boot`, `vpcs`) and `public/index.html` with `public/css/app.css`.

The engine has all the knowledge of the Junos CLI shapes it prints; the requirement
reference in `docs/needs.html` pins exact sample outputs for every view, and
`docs/features.html` tracks feature coverage against the requirement register (R-01 through
R-16) when making changes.

The Junos command surface keeps growing as the requirements documents specify it. We recommend
opening a device console and using `?` at any level to explore what that device family
currently answers.

## Deployment

This repository deploys on Vercel, where `vercel.json` at the root points the build at
`Desktop/jnciapracticelabs/public` (no build step, everything is static):

```bash
npx vercel deploy --prod
```

The repo can also be wired to a Vercel project for automatic deploys on push, which requires
the repository owner to connect the repository from the Vercel dashboard once.

## Repository layout

```
Desktop/jnciapracticelabs/          the lab
  public/                           index.html, fonts, css and all JS
  public/js/junos/                  Junos engine (db, derive, machine, model, schema, util)
  public/js/ui/                     browser shell (canvas, consoles, modals, boot)
  server/server.js                  zero-dependency static server
  tests/run-tests.js                engine test runner
  docs/                             requirements and feature-coverage documents
START-WINDOWS.bat, START-MAC-LINUX.sh
vercel.json                         Vercel deploy config
```

## Contributing

This is a student collaboration project (an invite-based shared repository), built for
JNCIA-Juniper practice lectures. Command behavior should be pinned through the samples in
`docs/needs.html` first, and the engine tests in `npm test` add value when the reference
documents change. Keep everything offline-capable and free of external dependencies.
