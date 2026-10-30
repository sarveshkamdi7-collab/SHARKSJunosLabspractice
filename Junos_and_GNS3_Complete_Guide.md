# Junos OS & GNS3 — Complete Feature and Command Guide

> **Scope:** every major feature of **GNS3** (the network emulator) and **Junos OS** (Juniper's network operating system), with the exact click-paths / menu options for GNS3 and the exact commands, with representative output, for Junos.
>
> **Versions referenced:** GNS3 **3.0.x** (latest 3.0.6) and **2.2.x** (latest 2.2.59); Junos OS 23.x–24.x style CLI (vSRX / vJunos-router / vJunos-switch / vMX / vQFX / cRPD).
>
> **Important note on outputs:** the command outputs below are *representative*. Interface names, timers, uptime, hostnames, memory and version strings will differ on your image and version. Menu names in GNS3 are the same in 2.2 and 3.0 unless noted. Always cross-check against Juniper's and GNS3's official docs for your exact build.

---

## Table of Contents

**PART A — GNS3**
1. What GNS3 is and how it is built
2. Installation
3. First launch and Setup Wizard
4. The GUI layout (every pane and toolbar button)
5. Preferences (every tab)
6. Projects (create, open, save, import, export, snapshots)
7. Devices, templates, appliances (including importing Juniper images)
8. Building a topology (drag, link, label, annotate)
9. Starting, stopping, consoles
10. Node context-menu (right-click) reference
11. Link context-menu, packet capture, packet filters
12. Cloud, NAT, Ethernet switch, Hub, VPCS, Docker nodes
13. Dynamips / Idle-PC, IOU, QEMU, VirtualBox, VMware specifics
14. GNS3 VM and remote servers
15. Web UI, REST API, command-line tools
16. Troubleshooting GNS3

**PART B — Junos OS**
17. Junos architecture and product families
18. Logging in, CLI modes, CLI productivity features
19. Configuration mode (every command) and the commit model
20. Operational commands with outputs
21. System configuration (users, SSH, NTP, syslog, SNMP, AAA)
22. Interfaces (physical, logical, VLAN, IRB, AE/LACP)
23. Static routing and routing-options
24. Routing policy
25. OSPF, IS-IS, BGP
26. MPLS, LDP, RSVP, L3VPN, EVPN-VXLAN
27. Switching (VLAN, STP, LLDP, storm control)
28. Firewall filters, policers, CoS
29. SRX security (zones, policies, NAT, IPsec, screens)
30. Automation (NETCONF, PyEZ, scripts, event policy, Ansible)
31. Maintenance (software, snapshots, zeroize, monitoring)
32. Troubleshooting toolbox

**PART C — Putting them together**
33. Full lab: Junos in GNS3 (step by step with outputs)
34. Cheat sheets

---

# PART A — GNS3

## 1. What GNS3 is and how it is built

GNS3 (Graphical Network Simulator-3) is an open-source network **emulator**: it runs real router/switch/firewall operating system images (not simulations of them) and links them together on a canvas.

### Components

| Component | Role |
|---|---|
| **GNS3 GUI** (`gns3-gui`) | The desktop app you click in (Qt, Python). Draws the topology, sends instructions to the controller. |
| **GNS3 server** (`gns3server`) | Python server that contains the **controller** (project/topology manager, REST API on TCP **3080**) and a **compute** (starts emulators). |
| **GNS3 VM** | Optional Ubuntu-based VM (VMware/VirtualBox/Hyper-V/ESXi/KVM) that runs the compute so that QEMU/KVM, Docker and IOU run natively and fast. |
| **Dynamips** | Emulates Cisco 1700/2600/3600/3700/7200 etc. (needs Cisco IOS images). |
| **IOU / IOL** | Cisco IOS-on-Unix (Linux only, or via the GNS3 VM). |
| **QEMU/KVM** | Generic VM engine — this is how **Juniper vSRX, vMX, vQFX, vJunos-switch, vJunos-router, vJunos-evolved** run. |
| **VirtualBox / VMware** | Use VMs already registered in those hypervisors. |
| **Docker** | Runs containers as nodes (e.g. Juniper **cRPD**, Alpine, FRR, network tools). |
| **uBridge** | Userspace bridge that connects nodes/links/UDP tunnels and does packet capture and filters. |
| **VPCS** | Tiny virtual PC for ping/traceroute/DHCP tests. |
| **Wireshark** | Launched by GNS3 on a link to display live captures. |

### Two possible modes
- **Local server:** GUI and server on the same PC (small labs, Dynamips/VPCS/Docker).
- **GNS3 VM / remote server:** GUI on your PC, heavy emulation in the VM (recommended for Junos, since vSRX/vMX/vQFX need KVM).

---

## 2. Installation

### Windows
1. Download `GNS3-3.0.x-all-in-one.exe` from gns3.com (free account required for download).
2. Run the installer → **Next** → accept licence → components screen. Tick: **GNS3**, **WinPCAP/Npcap**, **Wireshark**, **Dynamips**, **VPCS**, **uBridge**, **SolarWinds Standard Toolset** (optional, can untick), **Putty/Telnet client**.
3. Choose install folder (default `C:\Program Files\GNS3`) → **Install** → **Finish**.
4. Download the **GNS3 VM** (VMware Workstation/Player, VirtualBox or Hyper-V zip) of the *same version* as the GUI.

### Ubuntu / Debian
```bash
sudo add-apt-repository ppa:gns3/ppa
sudo apt update
sudo apt install gns3-gui gns3-server
```
Optional components (answer **Yes** when asked for non-root users to capture packets, and for ubridge):
```bash
sudo dpkg --add-architecture i386
sudo apt update
sudo apt install gns3-iou
sudo apt install docker.io
sudo usermod -aG ubridge,libvirt,kvm,wireshark,docker $USER
```
Log out and in again for group membership to apply.

Verify:
```bash
$ gns3server --version
3.0.6
$ ubridge -v
ubridge version 0.9.19
$ dynamips -H 7200 | head -2   # (opens a hypervisor port; Ctrl-C to quit)
Cisco 7200 Simulation Platform (version 0.2.23-amd64/Linux (tag 2023010200))
```

### macOS
Download `GNS3-3.0.x.dmg`, drag **GNS3.app** to Applications. (Official build is Intel; runs on Apple Silicon via Rosetta, but x86 QEMU guests such as Junos images are very slow without KVM — use a remote GNS3 VM / Linux box.)

### Enable KVM on Linux
```bash
$ kvm-ok
INFO: /dev/kvm exists
KVM acceleration can be used
$ egrep -c '(vmx|svm)' /proc/cpuinfo
8
```
If 0, enable **Intel VT-x / AMD-V** in BIOS. Without KVM, Junos VMs boot extremely slowly or fail.

---

## 3. First launch and Setup Wizard

1. Start **GNS3**. The **Setup Wizard** appears (or **Help → Setup Wizard**).
2. **Server type** page — choose one:
   - *Run appliances in a virtual machine* (GNS3 VM) → recommended.
   - *Run appliances on my local computer*.
   - *Run appliances on a remote server*.
3. If GNS3 VM: pick **Virtualization software** (VMware Workstation / Player / VirtualBox / Hyper-V / Remote), choose the VM, set **vCPUs** and **RAM** (e.g. 4 vCPU / 8–16 GB for Junos labs), tick **Allocate vCPUs and RAM** → **Next** → **Finish**.
4. Wait for the VM to boot; the GNS3 VM console shows its IP and port (`http://192.168.x.x:80`).
5. Open **Edit → Preferences → GNS3 VM** to confirm *Enable the GNS3 VM* is checked.

---

## 4. The GUI layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Menu bar: File Edit View Control Node Annotate Tools Help                │
├──────────────────────────────────────────────────────────────────────────┤
│ Toolbar (icons)                                                          │
├───────────┬──────────────────────────────────────────┬───────────────────┤
│ Devices   │                                          │ Topology Summary  │
│ toolbar   │          Topology canvas                 │ Servers Summary   │
│ (left)    │                                          │ Compute Summary   │
│           │                                          │ (right docks)     │
├───────────┴──────────────────────────────────────────┴───────────────────┤
│ Console dock (bottom): Console / Jupyter / Packet capture log           │
└──────────────────────────────────────────────────────────────────────────┘
```

### Menu bar
| Menu | Items |
|---|---|
| **File** | New blank project, Open project, Open recent, Save project as, Edit project, Import portable project, Export portable project, Import appliance, New template, Snapshots(in Project in some versions), Exit |
| **Edit** | Select all, Select none, Preferences |
| **View** | Zoom in/out/reset, Fit in view, Lock/Unlock all items, Show/Hide layers, Show/Hide interface labels, Show/Hide port status, Show/Hide grid, Snap to grid, Docks (Topology summary, Servers summary, Compute summary, Console), Full screen |
| **Control** | Start/Resume all nodes, Suspend all nodes, Stop all nodes, Reload all nodes, Reset console connections, Show node labels |
| **Node** | Auto idle-PC for all Dynamips, Start/Stop/Suspend/Reload/Console/Aux console of selected node, Change hostname |
| **Annotate** | Add note, Add image, Add rectangle, Add ellipse, Add line |
| **Tools** | VPCS, Telnet, Web console, Packet capture analyzer, Network Analyser, Docker "terminal" |
| **Help** | Setup Wizard, Help, Check for updates, Export debug information, About |

### Left Devices toolbar (icon buttons, top to bottom)
1. **Browse routers** (router templates)
2. **Browse switches**
3. **Browse end devices**
4. **Browse security devices** (firewalls, e.g. vSRX)
5. **Browse all devices** (searchable)
6. **Add a link** (cable icon)
7. **Add a note / draw** tools via Annotate menu or toolbar

Click a category button → a flyout lists templates. **Drag** a template onto the canvas, or **double-click** it to drop at the canvas centre.

### Right docks
- **Topology Summary:** list of nodes with state icon (green = started, red = stopped, yellow = suspended) and each link, expandable. Right-click a node here for the same menu as on canvas.
- **Servers Summary:** shows each compute and its CPU/RAM usage.
- **Console (bottom):** text console of GNS3 server messages; type commands such as `?`, `help`, `telnet <node>`, `console all`, `start /all`, `stop /all`, `reload /all`, `suspend /all`, `show`, `debug`, `reset`, `kill`.

Example in the GNS3 console dock:
```
=> ?
Documented commands (type help <topic>):
========================================
?        debug      list     reload  start    telnet  vm
auxconsole  exit       console  help    quit     stop    suspend ...
=> list
Node  State
R1    started
R2    started
```

---

## 5. Preferences (Edit → Preferences, or Ctrl+Shift+P)

| Tab | What you set |
|---|---|
| **General → General** | Projects directory, Images directory, Appliances directory, Configs directory, Default symbols directory, Language, Style (Charcoal/Classic/Legacy), Auto-check for updates, Hide topology summary on start, **Default console type** etc. |
| **General → Console applications** | Pre-configured: PuTTY, SecureCRT, MobaXterm, Windows Terminal, iTerm, TeraTerm, Xterm, Gnome Terminal, Telnet Windows. Select one → **Edit** command. E.g. PuTTY: `putty.exe -telnet %h %p -title "%d" -sl 2500 -fg SALMON1 -bg BLACK` |
| **General → VNC** | VNC viewer command (`tigervnc`, `vncviewer.exe %h:%p`) |
| **General → Packet capture** | Capture reader command (Wireshark): `"C:\Program Files\Wireshark\Wireshark.exe" -i - -k` (live). Tick **Automatically start the packet capture reader**. |
| **General → Miscellaneous** | Experimental features, Use local server, Auto-close console windows |
| **Server → Main server** | *Enable local server*, host `127.0.0.1`, port `3080`, path to `gns3server`, **Auth (username/password)**, protocol HTTP/HTTPS, *Auto start local server*, console port range, UDP port range, Ubridge path |
| **Server → GNS3 VM** | Enable VM, virtualization engine, VM name, vCPUs, RAM, *Shutdown VM on exit* / *Suspend* / *Keep running* |
| **Server → Remote computes** | Add remote compute (host, port, user, password) |
| **Dynamips → IOS routers** | New IOS router template wizard (select image .bin/.image, platform, RAM, adapters, **Idle-PC**) |
| **IOS on UNIX → IOU Devices** | IOU L2/L3 images, RAM, NVRAM, ethernet/serial adapters |
| **Qemu → Qemu VMs** | New VM template: Name, binary, RAM, Console type, **Disk image(s)**, *Boot priority*, *CPU count*, *Adapters*, *Adapter type* (e1000, virtio-net-pci, vmxnet3…), *Custom adapters*, *Additional options* |
| **VirtualBox → VirtualBox VMs** | Register VirtualBox VMs as templates |
| **VMware → VMware VMs** | Register VMware VMs as templates |
| **Docker → Docker containers** | New Docker template (image, adapters, start command, environment, console type: telnet, vnc, http, https) |
| **VPCS → Nodes** | VPCS template defaults |
| **Built-in → Cloud/Ethernet hubs/switches** | Built-in templates for Cloud, NAT, Hub, Switch |

---

## 6. Projects

### Create
**File → New blank project** → dialog:
- **Name:** `junos-ospf-lab`
- **Location:** default (`~/GNS3/projects/junos-ospf-lab`)
- Optional: **Project/ Edit project → Auto-start**, **Auto-open**, **Auto-close**, **Scene width/height**, **Zoom** and **Grid size**, **Snap to grid**, **Show interface labels**, **Show layers**.

### Save
GNS3 autosaves the topology (`.gns3` JSON file) continuously. **File → Save project as…** copies to a new name.

### Snapshots
**File → Snapshots** (in 2.2: *Project → Snapshots*) → **Create snapshot** → name → **OK**. Select a snapshot → **Restore** (stops nodes, rolls the project back to that state) or **Delete**.

### Export / Import portable project
- **File → Export portable project** → name → options **Include base images** (VM disk images; huge), **Include snapshots**, **Compression** (none/zip/zstd) → saves `.gns3project`.
- **File → Import portable project** → select `.gns3project` → choose name and **location** → **OK**.

### Edit project (File → Edit project)
Change **Name**, **Scene size**, **Grid size**, **Auto-start**, **Auto-open**, **Auto-close**, **Drawing grid**, **Snap to grid**, **Show layers**, **Show interface labels**, **Variables** (project variables usable in templates, `{{ var }}`).

---

## 7. Devices, templates, appliances

### Concept
- **Template** = definition of a device type (name, image, RAM, adapters…).
- **Node** = an instance of a template on the canvas.
- **Appliance** = a `.gns3a` file (JSON) that bundles one or more templates plus image download/links and the install wizard.

### Import an appliance (Juniper example)
1. **File → Import appliance** → pick the `.gns3a` file (e.g. `juniper-vsrx-ng.gns3a`) *or* **File → New template → Install an appliance from the GNS3 server** → search "Juniper" → select **Juniper vSRX NG** → **Install**.
2. Wizard page 1 — **Server type:** choose *Install the appliance on the main server* (GNS3 VM) → **Next**.
3. Wizard page 2 — **Qemu binary and RAM:** pick `/usr/bin/qemu-system-x86_64`, the default RAM/ vCPUs → **Next**.
4. Wizard page 3 — **Required files:** list of images (e.g. `junos-vsrx3-x86-64-23.2R1.13.qcow2`). Select an image → **Import** → browse to your downloaded qcow2 → green tick appears → **Next**.
5. Confirm → **Finish**. The template appears under **Browse security devices**.

If the appliance is not in the registry, create it manually:

### Manual QEMU template — Juniper vSRX 3.0 / vJunos-style VM
1. **Edit → Preferences → QEMU → Qemu VMs → New**.
2. **Type:** *Default*. **Name:** `vSRX3`.
3. **Qemu binary:** `qemu-system-x86_64`. **RAM:** `4096` MiB (vSRX 3.0 needs ≥ 4 GB). **Console type:** `telnet`.
4. **Disk image:** *New image* → **Browse** → the qcow2.
5. Finish, then select template → **Edit**:
   - **General:** Default name format `vSRX3-{0}`, symbol *firewall*, category *Security devices*, **Start command** (read-only).
   - **HDD:** disk interface `virtio` (or `ide` if it won't boot).
   - **CD/DVD:** none.
   - **Network:** **Adapters** = 11 (1 mgmt `fxp0` + 10 data ports); **Name format** `ge-0/0/{0}`; **Base MAC**; **Type** `virtio-net-pci` or `e1000`.
   - **Advanced:** **CPUs** 2, **Boot priority**, **Kernel command line**, **Options**, tick *Use as a linked base VM* (so many nodes share one disk), **Process priority** *Normal*, **Additional options** e.g. `-smbios type=1,product=VM-VEX` (only if the image documentation requires it — vJunos images do).
6. **OK → Apply**.

### Which Juniper images work in GNS3
| Image | Notes |
|---|---|
| **vSRX 3.0 / vSRX NG** | Firewall/router. 2 vCPU, 4–8 GB RAM. First NIC = `fxp0` (management), then `ge-0/0/0`… Ideal for security labs. |
| **vJunos-router** | Free from Juniper's support downloads site; MX-style control plane + virtual PFE in one VM. |
| **vJunos-switch** | Single-VM QFX-style switch (replaces vQFX for many labs). |
| **vJunosEvolved** | Junos Evolved (Linux-based) PTX-style VM. |
| **vMX** | Two VMs: **vCP** (control plane) + **vFP** (forwarding). Needs more resources. |
| **vQFX** | Two VMs: **RE** and **PFE** (the PFE VM is only used for forwarding; GNS3 appliance `juniper-vqfx-re` + `juniper-vqfx-pfe`). |
| **cRPD** | Docker container: Juniper routing daemon without forwarding plane. Free for evaluation. |

> Licensing: Juniper virtual images are subject to Juniper's EULA; download from Juniper's support portal (free vJunos images require login). GNS3 does not ship them.

### Docker template (e.g. cRPD)
**Edit → Preferences → Docker → Docker containers → New**
- *Server:* GNS3 VM, *Image:* choose from list (`crpd:latest`), *Name*, *Adapters* (4), *Start command* (blank), *Console type* `telnet` or `vnc`, *Environment* (`VAR=value`), *Extra volumes* (e.g. `/config`).
```bash
# On the GNS3 VM (ssh gns3@vm-ip) loading the cRPD image:
docker load -i junos-routing-crpd-docker-23.2R1.13.tgz
docker images | grep crpd
```
```
juniper/crpd   23.2R1.13   a1b2c3d4e5f6   3 weeks ago   438MB
```

---

## 8. Building a topology

1. **Add nodes:** open category flyout → drag onto canvas. Nodes get names `R1`, `R2`… (template's name format).
2. **Add links:** click **Add a link** (cable icon, top of the devices toolbar) → click device A → popup lists its interfaces → pick one (e.g. `ge-0/0/1`) → click device B → pick interface → link drawn. Press **Esc** or click the cable icon again to leave link mode.
   - Link colour dot: **red** = interface not up, **green** = up. Show/hide via **View → Show/Hide port status**.
3. **Move/rotate:** drag a node; right-click → **Rotate**; use **View → Snap to grid**.
4. **Rename label:** double-click node's label, or right-click → **Change hostname**. Right-click → **Change symbol** picks icon (router, switch, firewall, cloud, host…).
5. **Interface labels:** **View → Show/Hide interface labels**; drag a label to reposition; right-click a label to change font/colour.
6. **Annotations:** **Annotate → Add note** (click canvas, type), **Add rectangle / ellipse / line** (click-drag), **Add image** (pick a PNG/SVG). Right-click a drawing → **Edit style** (fill, border, opacity, rotation), **Raise/Lower one layer**, **Duplicate**, **Delete**, **Lock**.
7. **Lock items:** right-click → **Lock item** or **View → Lock/Unlock all items** to avoid accidental moves.
8. **Layers:** Each item has a **Z-value**; **Raise one layer** / **Lower one layer** adjust stacking; **View → Show layers** displays the layer number.

---

## 9. Starting, stopping, consoles

- **Start all:** green ▶ button on the toolbar (or **Control → Start/Resume all nodes**, **Ctrl+Shift+S**).
- **Stop all:** red ■ (**Ctrl+Shift+T**). **Suspend all:** yellow ⏸. **Reload all:** ↻.
- **Single node:** right-click → **Start**. Wait for the indicator on the node/port to turn green. Junos VMs need **3–8 minutes** to boot (watch the console).
- **Open console:** double-click a node, or right-click → **Console**; or toolbar **Console to all devices** (>_ icon, **Ctrl+Shift+R**). Telnet console opens in your configured terminal (PuTTY etc.).
- **Auxiliary console:** right-click → **Auxiliary console** (Dynamips AUX port / QEMU serial #2).
- **Web console / Web UI:** right-click → **Web console** (HTTP console for Docker apps) or **Open web UI** (node's mapped web port, e.g. 80/443).
- **VNC console:** nodes whose *Console type* is `vnc` or `spice` open in your VNC viewer.
- **Reset console connections:** **Control → Reset console connections** (if terminal lost).

Typical Junos first boot console:
```
Starting Junos OS ...
FreeBSD/amd64 (Amnesiac) (ttyu0)

login: root
Last login: ...
--- JUNOS 23.2R1.13 Kernel 64-bit  JNPR-12.1-20230614.0_builder_stable_12
root@:~ # cli
root>
```

---

## 10. Node right-click menu reference

| Item | What it does |
|---|---|
| **Console** | Opens the primary console (telnet/VNC/SPICE). |
| **Auxiliary console** | Second serial console. |
| **Web console / Open web UI** | Browser session to the node's web service. |
| **Start / Stop / Suspend / Reload** | Power controls. Suspend saves RAM state to disk (QEMU/VBox/VMware); Reload = hard restart. |
| **Configure / Edit config** | Opens the node's properties dialog (name, RAM, adapters, console type, startup command, MACs, *Custom adapters*, advanced). For Dynamips/IOU: **Edit config** opens `startup-config` editor. |
| **Change hostname** | Rename node (label). |
| **Change symbol** | Icon selection dialog. |
| **Duplicate** | Clone node (copy disk for non-linked clones). |
| **Delete** | Removes node and its links. |
| **Auto idle-PC** *(Dynamips only)* | Auto-finds Idle-PC value to drop CPU usage. |
| **Idle-PC finder** | Same, with candidate list. |
| **Export config / Import config** | Save/load startup-config file. |
| **Show in file manager** | Opens project folder on the compute. |
| **Raise/Lower one layer; Lock** | Canvas arrangement. |
| **Show node info (hover)** | Tooltip with console host:port, state, template name. |
| **Console to all / Start capture on node** | Multi-select nodes (Ctrl+click), right-click for group actions. |
| **Show/hide node label** | Per-node. |

Group actions: **select several nodes** with **Ctrl+click** or **rubber-band selection**, then right-click → **Start/Stop/Console**.

---

## 11. Links, packet capture, packet filters

Right-click on a link → menu:

| Item | Description |
|---|---|
| **Start capture** | Opens dialog: **Data link type** (Ethernet `DLT_EN10MB`, or PPP/HDLC/Frame-relay on serial), **Capture file name** (e.g. `R1_ge-0-0-1_to_R2_ge-0-0-0.pcap`) → **OK**. If *Automatically start the packet capture reader* is enabled in Preferences, **Wireshark opens live**. |
| **Stop capture** | Ends capture. |
| **Start Wireshark / Resume** | Re-open reader on the same capture. |
| **Packet filters** | Opens dialog with: **Frequency drop** (drop every Nth packet), **Packet loss** (% random), **Delay** (latency ms ± jitter), **Corrupt** (% bit-flip), **BPF filter** (e.g. `not arp`). Tick filter, enter value, **Apply**. Use to simulate lossy WAN. |
| **Suspend / Resume** | Temporarily disconnect link without deleting (simulate cable pull). |
| **Delete** | Remove link. |
| **Edit style** | Colour, width, style (solid/dashed). |
| **Raise/Lower layer** | Z-order. |
| **Reset** | Resets link style. |

Captures are saved under the project: `~/GNS3/projects/<name>/project-files/captures/`.

Example live Wireshark display filter for OSPF:
```
ospf
```
For BGP: `tcp.port == 179`, for LDP: `ldp`, for LACP: `slow`, for IS-IS: `isis`.

---

## 12. Built-in nodes

### Ethernet switch (built in, unmanaged-ish)
Double-click → **Configure** page lists **Ports** with **Port type** `access` (VLAN id), `dot1q` (trunk, native VLAN), `qinq` (S-VLAN, EtherType 0x8100/0x88A8/0x9100); **Add/Remove/Edit** ports. Great for simple L2.

### Ethernet hub
All frames flooded; ports count adjustable.

### Cloud
Bridge to **physical NICs**, `tap`, UDP, or **loopback/VMnet** adapters.
- Right-click **Cloud → Configure** → **Ethernet interfaces** tab → pick a host NIC (e.g. `Ethernet`, `Wi-Fi`, `vmnet8`, `tap0`) → **Add** → **Apply**.
- **Show special Ethernet interfaces** (check box) to see tap/veth/virbr.
- **TAP interfaces** tab (Linux): add `tap0`, `tap1`.
- **UDP tunnels** tab: connect to GNS3 on another PC (local port, remote host:port).
- **Windows loopback**: install *Microsoft KM-TEST Loopback Adapter* (Device Manager → Add legacy hardware) and link the Cloud to it to talk to the host.

### NAT
Gives lab nodes Internet via `virbr0` (192.168.122.0/24, DHCP on the GNS3 VM). Link node → **NAT1**, then in the node: `set interfaces fxp0 unit 0 family inet dhcp` (Junos) to get IP/DNS.

### VPCS commands (double-click the VPCS node)
```
PC1> ip 10.0.0.10/24 10.0.0.1
Checking for duplicate address...
PC1 : 10.0.0.10 255.255.255.0 gateway 10.0.0.1

PC1> show ip
NAME        : PC1[1]
IP/MASK     : 10.0.0.10/24
GATEWAY     : 10.0.0.1
DNS         :
MAC         : 00:50:79:66:68:00
LPORT       : 20000
RHOST:PORT  : 127.0.0.1:20001
MTU         : 1500

PC1> ping 10.0.0.1
84 bytes from 10.0.0.1 icmp_seq=1 ttl=64 time=1.482 ms
84 bytes from 10.0.0.1 icmp_seq=2 ttl=64 time=0.911 ms
84 bytes from 10.0.0.1 icmp_seq=3 ttl=64 time=0.874 ms
84 bytes from 10.0.0.1 icmp_seq=4 ttl=64 time=0.920 ms
84 bytes from 10.0.0.1 icmp_seq=5 ttl=64 time=0.901 ms

PC1> trace 8.8.8.8
trace to 8.8.8.8, 8 hops max, press Ctrl+C to stop
 1   10.0.0.1   1.210 ms  0.887 ms  0.842 ms
 2   *  *  *

PC1> dhcp
DORA IP 10.0.0.55/24 GW 10.0.0.1

PC1> arp
00:05:86:71:00:01  10.0.0.1 expires in 112 seconds

PC1> set pcname HOST-A
PC1> save
Saving startup configuration to startup.vpc
.  done
```
Other VPCS commands: `ip dhcp`, `ip auto` (IPv6), `ping -c 3 <ip>`, `ping -t`, `show`, `clear ip`, `rlogin`, `sleep`, `version`, `dump`, `load`, `echo`.

### Docker nodes
Behave as Linux hosts: `ip addr`, `ping`, `iperf3`, etc.

---

## 13. Emulator specifics

### Dynamips + Idle-PC
Without Idle-PC a Dynamips router eats 100% of a core. After starting a router: right-click → **Auto Idle-PC** → GNS3 tests candidates and picks one (e.g. `0x60630b3c`). Stored in template (**Edit → Dynamips → IOS routers → Edit → Advanced → Idle-PC**).

### IOU
Requires `iourc` licence file (**Preferences → IOS on UNIX → IOU Licence**). Not relevant for Junos, only for Cisco.

### QEMU nodes — key properties
- **Linked base VM:** each new node writes only differences to a `qcow2` overlay (fast creation, small disk).
- **CPU / RAM changes:** require node stopped.
- **Boot priority:** HDD, CD/DVD, network.
- **Console type:** telnet (serial) or VNC/SPICE (graphical). Junos VMs: **telnet**.
- **Adapters:** number is fixed in template; change under **Configure → Network → Adapters**.
- **Custom adapters:** per-adapter *type* and *MAC*.

### VirtualBox / VMware
Register an existing VM (**Preferences → VirtualBox VMs → New**), choose **Use as a linked base VM**, set adapters, **Enable remote console** (serial telnet).

---

## 14. GNS3 VM and remote servers

- **GNS3 VM**: Preferences → **Server → GNS3 VM**.
  - *Enable the GNS3 VM*, *Virtualization engine* (VMware/VirtualBox/Hyper-V), *VM name*, *Number of vCPUs*, *RAM (MB)*, *Action when closing GNS3* (Shutdown / Suspend / Keep).
- **VM console** (what you see in the hypervisor window): shows `GNS3 VM … IP: 192.168.56.101`, menu: **Shell**, **Keyboard layout**, **Change password**, **Proxy**, **Log**, **Reboot**, **Shutdown**, **Version**, **Networking**, **Upgrade**.
- **Remote server**: Run `gns3server --host 0.0.0.0 --port 3080` on the remote Linux box; in the GUI **Preferences → Server → Main server**, uncheck *Enable local server*, enter remote host/port/user/password. Use HTTPS with a reverse proxy for security.
- **Multiple computes** (cluster): add each under **Remote computes**; each node's template **Server** field says where it runs. The *Compute summary* shows load.

SSH to the VM:
```bash
ssh gns3@192.168.56.101      # default password: gns3
gns3@gns3vm:~$ lscpu | grep -E 'Model name|Virtualization'
Model name:          Intel(R) Core(TM) i7-1165G7
Virtualization:      VT-x
```

---

## 15. Web UI, REST API, CLI tools

### Web UI (3.x)
Browse to `http://<server>:3080/static/web-ui/` (or the VM address) → log in (default `admin` / `admin` on 3.0 until you change it) → manage projects, templates and nodes in the browser.

### REST API (examples)
```bash
$ curl -s http://127.0.0.1:3080/v3/version
{"controller_host":"127.0.0.1","version":"3.0.6","local":true}

# login (v3) - get JWT token
$ curl -s -X POST http://127.0.0.1:3080/v3/access/users/login \
    -d 'username=admin&password=admin'
{"access_token":"eyJhbGciOi...","token_type":"bearer"}

$ curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects
[{"name":"junos-ospf-lab","project_id":"b2c...","status":"opened"}]

$ curl -s -H "Authorization: Bearer $TOKEN" -X POST \
    http://127.0.0.1:3080/v3/projects/<pid>/nodes/start
```
(2.2 uses `/v2/...` and HTTP basic auth.) Swagger docs: `http://127.0.0.1:3080/docs`.

### Command-line tools
```bash
gns3server --local              # run server with local compute
gns3server --host 0.0.0.0 --port 3080 --config /etc/gns3/gns3_server.conf
gns3 --version                  # GUI
vpcs -p 20000 -m 1              # run a VPCS manually
ubridge -H 7200                 # hypervisor mode
```
Server config file example (`~/.config/GNS3/3.0/gns3_server.conf`):
```ini
[Server]
host = 0.0.0.0
port = 3080
images_path = /opt/gns3/images
projects_path = /opt/gns3/projects
auth = True
user = admin
password = changeme

[Qemu]
enable_hardware_acceleration = True
require_hardware_acceleration = True
```

---

## 16. Troubleshooting GNS3

| Symptom | Fix |
|---|---|
| "Server is not available / connection refused" | Check **Preferences → Server**, firewall allowing TCP 3080, VM IP; restart GNS3 VM. |
| Version mismatch GUI vs server | Install the **same version** GUI and VM (**Help → Check for updates**, **Server → GNS3 VM → Upgrade**). |
| QEMU node won't start / "KVM not available" | Enable VT-x; in VMware **Processor → Virtualize Intel VT-x/EPT**; Hyper-V nested virtualization `Set-VMProcessor -VMName GNS3VM -ExposeVirtualizationExtensions $true`. |
| Junos VM boots but no interfaces | Increase adapters; ensure first NIC is mgmt; wait full 5+ min; check adapter type (`virtio` vs `e1000`). |
| Console won't open | Reset console connections, check Console applications command, check port conflicts (**Preferences → Server → console port range**). |
| 100% CPU on host | Idle-PC for Dynamips; reduce vCPU; use linked clones; stop unused nodes. |
| Wireshark doesn't open | Verify the *Capture reader command* path in Preferences → General → Packet capture. |
| Links stay red | Node not started or interface down. |
| "Cannot create a link" | Interface already used, or node is a Cloud with no NIC selected. |
| Export debug info | **Help → Export debug information** → zip for forums/support. |

Logs: `~/.config/GNS3/3.0/gns3_server.log` (or in VM `/var/log/gns3`).

---

# PART B — Junos OS

## 17. Architecture and product families

### Separation of planes
- **Routing Engine (RE):** control plane. Runs FreeBSD-based Junos kernel + daemons. Stores configuration, runs routing protocols, builds the **routing table (RIB)** and pushes the **forwarding table (FIB)** to the PFE.
- **Packet Forwarding Engine (PFE):** data plane. Hardware/virtual ASIC forwarding at line rate, independent from the RE.

### Key daemons
| Daemon | Function |
|---|---|
| `mgd` | Management daemon (CLI, NETCONF, commit processing) |
| `rpd` | Routing protocol daemon (OSPF, IS-IS, BGP, MPLS, static) |
| `dcd` | Device control daemon (interfaces) |
| `chassisd` | Chassis/hardware management |
| `snmpd`, `mib2d` | SNMP |
| `eventd` | Event/log processing |
| `l2ald`, `l2cpd` | L2 learning / L2 control protocols (STP, LLDP) |
| `flowd` | SRX flow (security) processing |
| `ppmd` | Periodic packet management (BFD, LACP hellos) |
| `dhcpd`, `jdhcpd` | DHCP |
| `sshd`, `inetd` | Remote access |

Check them:
```
root@R1> show system processes extensive | match "rpd|mgd|chassisd|dcd"
 1203 root        1  96    0   318M   90M select   0   0:21  0.00% rpd
 1190 root        1  96    0   112M   36M select   0   0:03  0.00% mgd
 1176 root        1  96    0    78M   17M select   0   0:01  0.00% chassisd
 1184 root        1  96    0    52M   14M select   0   0:00  0.00% dcd
```

### Product families
| Family | Role |
|---|---|
| **MX** | Edge/core routers (vMX virtual) |
| **PTX** | Core/transport routers |
| **ACX** | Cell-site / access |
| **QFX / EX** | Data centre / campus switches (vQFX, vJunos-switch) |
| **SRX** | Firewalls (vSRX) |
| **cRPD** | Containerised routing protocol daemon |
| **Junos Evolved** | Linux-based Junos (vJunosEvolved) |

### Naming conventions
Interface = `type-fpc/pic/port[:channel].unit`
- `ge-` Gigabit, `xe-` 10G, `et-` 25/40/100G, `ae` aggregated Ethernet, `lo0` loopback, `irb` routed VLAN interface, `vlan` (ELS) , `fxp0` out-of-band management, `em0` management on some platforms, `st0` secure tunnel (IPsec), `gr-` GRE, `ip-` IP-IP, `lt-` logical tunnel, `reth` redundant Ethernet (SRX chassis cluster).

---

## 18. Logging in, CLI modes, CLI productivity

### First login on a fresh image
```
login: root
--- JUNOS 23.2R1.13 Kernel 64-bit  JNPR-12.1-20230614.0_builder_stable_12
root@:~ # cli
root>
```
`root@:~ #` is the **shell**. `root>` is **operational mode**. `root#` is **configuration mode**.

### Modes
| Mode | Prompt | Enter | Leave |
|---|---|---|---|
| Shell | `%` or `#` | login | `cli` to go to op mode |
| Operational | `user@host>` | `cli` | `exit` / `quit` |
| Configuration | `user@host#` | `configure` | `exit` |

Special: `start shell`, `start shell user root`, `exit` returns. `edit` / `configure private` / `configure exclusive`.

### Context help
```
root> ?
Possible completions:
  clear                Clear information in the system
  configure            Manipulate software configuration information
  file                 Perform file operations
  help                 Provide help information
  load                 Load information from file
  monitor              Show real-time debugging information
  mtrace               Trace multicast path from source to receiver
  ping                 Ping remote target
  quit                 Exit the management session
  request              Make system-level requests
  restart              Restart software process
  save                 Save information to file
  set                  Set CLI properties, date/time, craft interface message
  show                 Show system information
  ssh                  Open SSH connection to remote device
  start                Start shell
  telnet               Telnet to another host
  test                 Perform diagnostic debugging
  traceroute           Trace route to remote host
```

### Keyboard and completion
| Key | Action |
|---|---|
| `?` | List options at the current spot |
| `Space` | Complete the keyword (unique prefix) |
| `Tab` | Complete keyword **and** user-defined names |
| `Ctrl+A / E` | Start / end of line |
| `Ctrl+W` | Delete previous word |
| `Ctrl+U` | Delete line |
| `Ctrl+R` | Reverse search history |
| `Esc then B/F` | Back/forward one word |
| `Ctrl+C` | Interrupt |
| `Ctrl+Z` | Exit from `monitor` |
| `help topic <x>`, `help reference <x>` | Built-in docs |

### Pipe filters (work after `show` and `configure` output)
| Pipe | Meaning |
|---|---|
| `\| match <regex>` | Show only matching lines |
| `\| except <regex>` | Hide matching lines |
| `\| find <regex>` | Start output at first match |
| `\| count` | Count lines |
| `\| last <n>` | Last n lines |
| `\| no-more` | Disable paging |
| `\| more` | Page output |
| `\| save <file>` | Write output to a file |
| `\| display set` | Show config as `set` commands |
| `\| display set relative` | Same, relative to current hierarchy |
| `\| display xml` / `display json` | Structured output |
| `\| display detail` | Show comments/inheritance info |
| `\| display inheritance` | Resolve `groups` |
| `\| display omit` | Show omitted statements |
| `\| compare` | Diff (config mode) |
| `\| resolve` | Expand `apply-groups` |
| `\| trim <n>` | Remove n leading columns |
| `\| hold` | Hold output at end |
| `\| request message` | Send output to another user |

Example:
```
root> show interfaces terse | match "ge-0/0/[01]"
ge-0/0/0                up    up
ge-0/0/0.0              up    up   inet     10.0.12.1/24
ge-0/0/1                up    up
ge-0/0/1.0              up    up   inet     10.0.13.1/24

root> show route | count
Count: 14 lines

root> show configuration | display set | match ospf
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0
set protocols ospf area 0.0.0.0 interface lo0.0 passive
```

### CLI settings (operational mode `set cli ...`)
```
root> set cli screen-length 0           # disable paging
root> set cli screen-width 200
root> set cli timestamp                 # timestamp each command output
root> set cli idle-timeout 30
root> set cli prompt "R1> "
root> set cli complete-on-space off
root> show cli
CLI complete-on-space set to on
CLI idle timeout is 30 minutes
CLI screen-length set to 0
CLI screen-width set to 200
CLI terminal is 'vt100'
CLI is operating in enhanced mode
CLI timestamp disabled
CLI working directory is '/root'
```

### History
```
root> show cli history 5
12:01:44   -- show interfaces terse
12:01:50   -- show route
12:02:01   -- configure
12:03:20   -- show system uptime
12:03:30   -- show cli history 5
```

---

## 19. Configuration mode and the commit model

### The model
Junos has **three** configuration states:
1. **Active (running) configuration** — what the device is using.
2. **Candidate configuration** — your working copy, changes are *not live*.
3. **Rollback files** — `/config/juniper.conf.gz` (active), `juniper.conf.1.gz`…`juniper.conf.49.gz` (previous commits).

Nothing takes effect until **`commit`**. Commit is **atomic** (all or nothing) and checks syntax and semantic validity first.

### Entering configuration mode
```
root> configure
Entering configuration mode
[edit]
root#
```
Variants:
- `configure` — normal shared candidate (multiple users share one candidate).
- `configure private` — your private candidate copy; commit merges your changes.
- `configure exclusive` — locks the configuration; others cannot enter edit.
- `configure batch` — for high-rate automation.

### Hierarchy navigation
```
[edit]
root# edit protocols ospf area 0
[edit protocols ospf area 0.0.0.0]
root# up
[edit protocols ospf]
root# top
[edit]
root# exit
Exiting configuration mode
```
| Command | Function |
|---|---|
| `edit <hier>` | Move into a hierarchy level |
| `up [n]` | Up n levels |
| `top` | Back to `[edit]` |
| `exit` / `exit configuration-mode` | Leave one level / leave config mode |
| `show` | Display candidate at current level |
| `show \| compare` | Diff candidate vs active |
| `run <op-cmd>` | Run operational command from config mode (`run show route`) |
| `status` | Show who else is editing |

### Changing configuration
```
[edit]
root# set system host-name R1
root# set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/24
root# set interfaces lo0 unit 0 family inet address 1.1.1.1/32
root# delete interfaces ge-0/0/5
root# deactivate protocols ospf
root# activate protocols ospf
root# rename interfaces ge-0/0/2 to ge-0/0/3
root# copy interfaces ge-0/0/0 unit 0 to unit 1
root# insert firewall filter F1 term T2 before term T1
root# annotate interfaces ge-0/0/0 "Link to R2"
root# protect system host-name            # block edits
root# unprotect system host-name
root# wildcard delete interfaces ge-0/0/[1-5]
root# replace pattern 10.0.12 with 10.0.21
```

### Viewing and comparing
```
[edit]
root# show | compare
[edit]
-  host-name vSRX;
+  host-name R1;
[edit interfaces]
+   ge-0/0/0 {
+       unit 0 {
+           family inet {
+               address 10.0.12.1/24;
+           }
+       }
+   }
```
Show in set form:
```
root# show | display set
set version 23.2R1.13
set system host-name R1
set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/24
```

### Commit family
| Command | Meaning |
|---|---|
| `commit` | Validate + activate |
| `commit check` | Validate only |
| `commit comment "text"` | Add log message |
| `commit confirmed [minutes]` | Auto-rollback if not re-committed (default 10) — **use on remote devices** |
| `commit and-quit` | Commit then leave config mode |
| `commit at "2026-11-01 02:00:00"` | Scheduled commit |
| `commit synchronize` | Commit on both REs (dual-RE) |
| `commit full` | Re-evaluate everything |
| `commit prepare` | Pre-stage for faster commit |
| `commit confirm` ( ) | Confirm pending commit |
| `rollback [0..49]` | Load previous config into candidate (not active until `commit`) |
| `rollback 0` | Discard candidate changes (revert to active) |

```
root# commit check
configuration check succeeds
root# commit comment "Initial addressing"
commit complete
root# commit confirmed 5
commit confirmed will be automatically rolled back in 5 minutes unless confirmed
commit complete
# Re-enter commit within 5 min to keep:
root# commit
commit complete
```
Rollback:
```
root# rollback 1
load complete
root# show | compare
...
root# commit
commit complete
```
History:
```
root> show system commit
0   2026-10-30 10:41:12 UTC by root via cli
    Initial addressing
1   2026-10-30 10:35:02 UTC by root via cli
2   2026-10-30 10:20:47 UTC by root via console
root> show system rollback compare 2 0
```

### Load / save
```
root# save /var/tmp/R1.conf                         # save candidate
Wrote 52 lines of output to '/var/tmp/R1.conf'
root# load override /var/tmp/R1.conf                 # replace all
root# load merge /var/tmp/part.conf                  # merge into candidate
root# load replace /var/tmp/part.conf                # replace matching statements (needs 'replace:' tags)
root# load set terminal                              # paste set commands; Ctrl+D to end
[Type ^D at a new line to end input]
set interfaces ge-0/0/1 unit 0 family inet address 10.0.13.1/24
^D
load complete
root# load set /var/tmp/cmds.set
root# load patch terminal
root# load factory-default
```

### Groups and apply-groups
```
root# set groups COMMON system ntp server 10.0.0.5
root# set groups INTF-TEMPLATE interfaces <ge-*> mtu 9192
root# set apply-groups [ COMMON INTF-TEMPLATE ]
root# show interfaces ge-0/0/0 | display inheritance
mtu 9192;                       ## 'mtu' was inherited from group 'INTF-TEMPLATE'
```
Also `set groups global`, `set apply-groups-except`.

### Locks and sessions
```
root> show system users
 10:45AM  up 3 days, 1:02, 2 users, load averages: 0.04, 0.08, 0.06
USER     TTY      FROM              LOGIN@  IDLE WHAT
root     u0       -                 8:30AM     - cli
admin    p0       10.0.0.5          10:40AM    - cli
root> request system logout user admin
```
Config session check:
```
root# status
Users currently editing the configuration:
  admin terminal p0 (pid 3120) on since 2026-10-30 10:40:02 UTC, idle 00:03:11
      [edit]
```

### Show "configuration" (operational mode)
```
root> show configuration system
host-name R1;
root-authentication {
    encrypted-password "$6$..."; ## SECRET-DATA
}
services {
    ssh;
}
```
`show configuration | display set | no-more`, `show configuration interfaces ge-0/0/0`.

---

## 20. Operational commands with output

### Version and hardware
```
root@R1> show version
Hostname: R1
Model: vsrx
Junos: 23.2R1.13
JUNOS Software Release [23.2R1.13]

root@R1> show chassis hardware
Hardware inventory:
Item             Version  Part number  Serial number     Description
Chassis                                VM64B1A23C4D      VSRX
Midplane
System IO
Routing Engine                                           VSRX
FPC 0                                                    Virtual FPC
  PIC 0                                                  Virtual GE

root@R1> show chassis routing-engine
Routing Engine status:
    Temperature                 Absent
    CPU utilization:
      User                       3 percent
      Background                 0 percent
      Kernel                     2 percent
      Interrupt                  1 percent
      Idle                      94 percent
    Memory utilization          43 percent
    Start time                  2026-10-30 08:12:11 UTC
    Uptime                      2 hours, 31 minutes, 4 seconds
    Last reboot reason          0x200:normal shutdown

root@R1> show system uptime
Current time: 2026-10-30 10:43:15 UTC
Time Source:  LOCAL CLOCK
System booted: 2026-10-30 08:12:11 UTC (02:31:04 ago)
Protocols started: 2026-10-30 08:14:05 UTC (02:29:10 ago)
Last configured: 2026-10-30 10:41:12 UTC (00:02:03 ago) by root
10:43AM  up 2:31, 2 users, load averages: 0.08, 0.05, 0.01

root@R1> show system storage
Filesystem              Size       Used      Avail  Capacity   Mounted on
/dev/vtbd0s1a           1.3G       596M       622M       49%  /
devfs                   1.0K       1.0K         0B      100%  /dev
/dev/md0                1.4G       1.4G         0B     100%  /packages/mnt/junos-runtime

root@R1> show system memory
root@R1> show system alarms
No alarms currently active
root@R1> show chassis alarms
No alarms currently active
root@R1> show system information
Model: vsrx
Family: junos
Junos: 23.2R1.13
Hostname: R1
```

### Interfaces
```
root@R1> show interfaces terse
Interface               Admin Link Proto    Local                 Remote
ge-0/0/0                up    up
ge-0/0/0.0              up    up   inet     10.0.12.1/24
ge-0/0/1                up    up
ge-0/0/1.0              up    up   inet     10.0.13.1/24
ge-0/0/2                up    down
fxp0                    up    up
fxp0.0                  up    up   inet     192.168.122.50/24
lo0                     up    up
lo0.0                   up    up   inet     1.1.1.1             --> 0/0
lo0.16384               up    up   inet

root@R1> show interfaces ge-0/0/0 brief
Physical interface: ge-0/0/0, Enabled, Physical link is Up
  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps, Link-mode: Full-duplex
  Logical interface ge-0/0/0.0
    Flags: Up SNMP-Traps 0x4000 Encapsulation: ENET2
    inet  10.0.12.1/24

root@R1> show interfaces ge-0/0/0 extensive | match "error|drop|Input rate|Output rate"
  Input rate     : 1056 bps (1 pps)
  Output rate    : 1120 bps (1 pps)
  Input errors:  Errors: 0, Drops: 0, Framing errors: 0 ...
  Output errors: Carrier transitions: 1, Errors: 0, Drops: 0 ...

root@R1> show interfaces descriptions
Interface       Admin Link Description
ge-0/0/0        up    up   TO-R2
ge-0/0/1        up    up   TO-R3

root@R1> show interfaces statistics ge-0/0/0
root@R1> show interfaces ge-0/0/0 media
root@R1> clear interfaces statistics all
```

### Routing
```
root@R1> show route
inet.0: 9 destinations, 9 routes (9 active, 0 holddown, 0 hidden)
+ = Active Route, - = Last Active, * = Both

1.1.1.1/32         *[Direct/0] 00:30:11
                    >  via lo0.0
2.2.2.2/32         *[OSPF/10] 00:12:04, metric 1
                    >  to 10.0.12.2 via ge-0/0/0.0
3.3.3.3/32         *[OSPF/10] 00:12:04, metric 1
                    >  to 10.0.13.3 via ge-0/0/1.0
10.0.12.0/24       *[Direct/0] 00:30:11
                    >  via ge-0/0/0.0
10.0.12.1/32       *[Local/0] 00:30:11
                      Local via ge-0/0/0.0
224.0.0.5/32       *[OSPF/10] 00:30:11, metric 1
                       MultiRecv

root@R1> show route 2.2.2.2
root@R1> show route 2.2.2.2/32 exact detail
root@R1> show route protocol ospf
root@R1> show route table inet.0 summary
root@R1> show route forwarding-table destination 2.2.2.2
Routing table: default.inet
Internet:
Destination        Type RtRef Next hop           Type Index    NhRef Netif
2.2.2.2/32         user     0 10.0.12.2          ucst      585     2 ge-0/0/0.0

root@R1> show route advertising-protocol bgp 10.0.12.2
root@R1> show route receive-protocol bgp 10.0.12.2
root@R1> show route hidden
root@R1> show route terse
root@R1> show route summary
Autonomous system number: 65001
Router ID: 1.1.1.1

inet.0: 9 destinations, 9 routes (9 active, 0 holddown, 0 hidden)
              Direct:      4 routes,      4 active
               Local:      3 routes,      3 active
                OSPF:      2 routes,      2 active
```

### ARP, neighbors, LLDP
```
root@R1> show arp
MAC Address       Address         Name                      Interface           Flags
50:00:00:02:00:00 10.0.12.2       10.0.12.2                 ge-0/0/0.0          none
Total entries: 1

root@R1> show ipv6 neighbors
root@R1> show lldp neighbors
Local Interface    Parent Interface    Chassis Id          Port info          System Name
ge-0/0/0           -                   50:00:00:02:00:00   ge-0/0/0           R2
```

### System/process/logs
```
root@R1> show system processes brief
root@R1> show system users
root@R1> show log messages | last 20
root@R1> show log messages | match "OSPF|BGP|UI_COMMIT"
Oct 30 10:41:12 R1 mgd[1190]: UI_COMMIT: User 'root' requested 'commit' operation (comment: Initial addressing)
Oct 30 10:41:14 R1 rpd[1203]: RPD_OSPF_NBRUP: OSPF neighbor 10.0.12.2 (realm ospf-v2 ge-0/0/0.0 area 0.0.0.0) state changed from Init to Full due to 2Way
root@R1> show log                           # list log files
root@R1> show log chassisd
root@R1> monitor start messages            # live syslog (stop: monitor stop)
root@R1> monitor traffic interface ge-0/0/0 no-resolve size 1500 count 5
root@R1> monitor interface ge-0/0/0         # live counters; 'q' to quit
root@R1> monitor interface traffic
```
`monitor traffic` example output:
```
verbose output suppressed, use <detail> or <extensive> for full protocol decode
Address resolution is OFF.
Listening on ge-0/0/0, capture size 1500 bytes
10:44:01.1 In  IP 10.0.12.2 > 224.0.0.5: OSPFv2, Hello, length 48
10:44:01.4 Out IP 10.0.12.1 > 224.0.0.5: OSPFv2, Hello, length 48
```

### Connectivity tools
```
root@R1> ping 10.0.12.2 count 3
PING 10.0.12.2 (10.0.12.2): 56 data bytes
64 bytes from 10.0.12.2: icmp_seq=0 ttl=64 time=1.12 ms
64 bytes from 10.0.12.2: icmp_seq=1 ttl=64 time=0.88 ms
64 bytes from 10.0.12.2: icmp_seq=2 ttl=64 time=0.84 ms

--- 10.0.12.2 ping statistics ---
3 packets transmitted, 3 packets received, 0% packet loss
round-trip min/avg/max/stddev = 0.840/0.947/1.120/0.123 ms

root@R1> ping 3.3.3.3 source 1.1.1.1 rapid count 5 size 1400 do-not-fragment
root@R1> ping 8.8.8.8 routing-instance CUSTOMER-A
root@R1> traceroute 3.3.3.3 no-resolve
traceroute to 3.3.3.3 (3.3.3.3), 30 hops max, 40 byte packets
 1  10.0.13.3  1.23 ms  0.91 ms  0.88 ms

root@R1> ssh admin@10.0.12.2
root@R1> telnet 10.0.12.2
root@R1> test policy EXPORT-STATIC 10.1.1.0/24     # test routing policy
```

### File management
```
root@R1> file list /var/tmp detail
root@R1> file show /var/log/messages
root@R1> file copy /var/tmp/R1.conf scp://admin@10.0.0.5:/backups/
root@R1> file delete /var/tmp/old.conf
root@R1> file checksum sha-256 /var/tmp/R1.conf
root@R1> file make-directory /var/tmp/backup
```

---

## 21. System configuration

### Hostname, domain, DNS, time
```
set system host-name R1
set system domain-name lab.local
set system name-server 8.8.8.8
set system time-zone Asia/Kolkata
set system ntp server 10.0.0.5 prefer
set system ntp boot-server 10.0.0.5
set system ntp authentication-key 1 type md5 value "ntpkey"
```
Verify:
```
root@R1> show ntp associations
     remote           refid      st t when poll reach   delay   offset  jitter
==============================================================================
*10.0.0.5        .GPS.            1 u   45   64  377    0.612   -0.034   0.021
root@R1> show ntp status
root@R1> show system uptime
root@R1> set date ntp 10.0.0.5
```
Manual time: `set date 202610301045.00` (YYYYMMDDhhmm.ss).

### Root and users
```
set system root-authentication plain-text-password          # prompts twice
New password: ********
Retype new password: ********
set system login user admin class super-user authentication plain-text-password
set system login user ops class operator
set system login user readonly class read-only
set system login user admin authentication ssh-rsa "ssh-rsa AAAAB3Nza... admin@pc"
set system login class NOC permissions [ view view-configuration network ]
set system login class NOC deny-commands "(request system)|(restart)"
set system login user noc class NOC authentication encrypted-password "$6$..."
set system login message "Authorised access only"
set system login retry-options tries-before-disconnect 3 lockout-period 5
set system login password minimum-length 10 format sha512
```
Predefined classes: `super-user`, `operator`, `read-only`, `unauthorized`.
```
root@R1> show system login lockout
root@R1> show system users
```

### SSH / Telnet / NETCONF / HTTP / Web
```
set system services ssh root-login deny
set system services ssh protocol-version v2
set system services ssh max-sessions-per-connection 4
set system services ssh connection-limit 10 rate-limit 5
set system services telnet            # insecure - lab only
set system services netconf ssh port 830
set system services rest http port 3000       # REST API
set system services web-management https system-generated-certificate
set system services extension-service request-response grpc clear-text port 32767
set system services dhcp-local-server group G1 interface ge-0/0/1.0
```

### Management interface and routing
```
set interfaces fxp0 unit 0 family inet address 192.168.122.50/24
set routing-options static route 0.0.0.0/0 next-hop 192.168.122.1 no-readvertise
set system management-instance                  # (QFX/EX) mgmt VRF
```
vSRX in GNS3 via NAT node: `set interfaces fxp0 unit 0 family inet dhcp`.

### Syslog
```
set system syslog user * any emergency
set system syslog host 10.0.0.9 any notice
set system syslog host 10.0.0.9 authorization info
set system syslog file messages any notice
set system syslog file messages authorization info
set system syslog file interactive-commands interactive-commands any
set system syslog file ospf-log daemon info match "OSPF"
set system syslog archive size 5m files 5
set system syslog time-format millisecond
```

### SNMP
```
set snmp community public authorization read-only
set snmp community public clients 10.0.0.0/24
set snmp location "Lab-Rack-1"
set snmp contact "noc@example.com"
set snmp trap-group TG targets 10.0.0.9
set snmp v3 usm local-engine user U1 authentication-sha authentication-password "AuthPass123"
set snmp v3 usm local-engine user U1 privacy-aes128 privacy-password "PrivPass123"
```
```
root@R1> show snmp statistics
root@R1> show snmp mib walk system
sysDescr.0     = Juniper Networks, Inc. vsrx internet router, kernel JUNOS 23.2R1.13
sysName.0      = R1
```

### AAA (RADIUS / TACACS+)
```
set system radius-server 10.0.0.20 secret "radsecret" timeout 5 retry 2
set system tacplus-server 10.0.0.21 secret "tacsecret"
set system authentication-order [ tacplus radius password ]
set system login user remote class super-user      # template for remote users
```

### Archival and backups
```
set system archival configuration transfer-on-commit
set system archival configuration archive-sites "scp://backup@10.0.0.30:/cfg/" password "pass"
```

### Other system hardening
```
set system no-redirects
set system internet-options no-source-quench
set system internet-options tcp-drop-synfin-set
set system processes dhcp-service traceoptions
set system diag-port-authentication ...
set system max-configuration-rollbacks 49
set system commit synchronize
set system auto-snapshot
```

---

## 22. Interfaces

### Basic IPv4/IPv6 + description + MTU
```
set interfaces ge-0/0/0 description "TO-R2"
set interfaces ge-0/0/0 mtu 9192
set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/24
set interfaces ge-0/0/0 unit 0 family inet6 address 2001:db8:12::1/64
set interfaces lo0 unit 0 family inet address 1.1.1.1/32
set interfaces ge-0/0/3 disable
delete interfaces ge-0/0/3 disable
```

### VLAN tagging (router style, with sub-interfaces)
```
set interfaces ge-0/0/1 vlan-tagging
set interfaces ge-0/0/1 unit 10 vlan-id 10 family inet address 192.168.10.1/24
set interfaces ge-0/0/1 unit 20 vlan-id 20 family inet address 192.168.20.1/24
set interfaces ge-0/0/1 flexible-vlan-tagging       # QinQ / mixed
set interfaces ge-0/0/1 encapsulation flexible-ethernet-services
```

### Switch-style (ELS) interface config
```
set interfaces ge-0/0/4 unit 0 family ethernet-switching interface-mode access vlan members V10
set interfaces ge-0/0/5 unit 0 family ethernet-switching interface-mode trunk vlan members [ V10 V20 ]
set interfaces ge-0/0/5 native-vlan-id 99
set vlans V10 vlan-id 10 l3-interface irb.10
set interfaces irb unit 10 family inet address 192.168.10.1/24
```

### Aggregated Ethernet / LACP
```
set chassis aggregated-devices ethernet device-count 2
set interfaces ge-0/0/6 gigether-options 802.3ad ae0
set interfaces ge-0/0/7 gigether-options 802.3ad ae0
set interfaces ae0 aggregated-ether-options lacp active
set interfaces ae0 aggregated-ether-options lacp periodic fast
set interfaces ae0 aggregated-ether-options minimum-links 1
set interfaces ae0 unit 0 family inet address 10.99.0.1/30
```
```
root@R1> show lacp interfaces
Aggregated interface: ae0
    LACP state:       Role   Exp   Def  Dist  Col  Syn  Aggr  Timeout  Activity
      ge-0/0/6       Actor    No    No   Yes  Yes  Yes   Yes     Fast    Active
      ge-0/0/6     Partner    No    No   Yes  Yes  Yes   Yes     Fast    Active
      ge-0/0/7       Actor    No    No   Yes  Yes  Yes   Yes     Fast    Active
      ge-0/0/7     Partner    No    No   Yes  Yes  Yes   Yes     Fast    Active
    LACP protocol:        Receive State  Transmit State          Mux State
      ge-0/0/6                  Current   Fast periodic Collecting distributing
root@R1> show interfaces ae0 terse
```

### DHCP client / PPPoE / GRE / IP-IP / tunnels
```
set interfaces ge-0/0/0 unit 0 family inet dhcp
set interfaces gr-0/0/0 unit 0 tunnel source 1.1.1.1 destination 2.2.2.2
set interfaces gr-0/0/0 unit 0 family inet address 172.16.0.1/30
set interfaces lt-0/0/0 unit 0 encapsulation ethernet peer-unit 1   # logical tunnel
```

### Interface checks
```
root@R1> show interfaces terse | except down
root@R1> show interfaces ge-0/0/0 | match "Speed|Duplex|Link"
root@R1> show interfaces queue ge-0/0/0
root@R1> show interfaces diagnostics optics ge-0/0/0         # hardware only
```

---

## 23. Static routing and routing-options

```
set routing-options router-id 1.1.1.1
set routing-options autonomous-system 65001
set routing-options static route 0.0.0.0/0 next-hop 10.0.12.2
set routing-options static route 192.168.50.0/24 next-hop 10.0.13.3 metric 5 preference 10
set routing-options static route 10.50.0.0/16 discard
set routing-options static route 10.60.0.0/16 reject
set routing-options static route 10.70.0.0/16 qualified-next-hop 10.0.12.2 preference 5
set routing-options static route 10.70.0.0/16 qualified-next-hop 10.0.13.3 preference 10
set routing-options static route 0.0.0.0/0 next-hop 10.0.12.2 bfd-liveness-detection minimum-interval 300
set routing-options forwarding-table export LOAD-BALANCE        # ECMP
set routing-options rib inet6.0 static route ::/0 next-hop 2001:db8:12::2
set routing-options aggregate route 10.100.0.0/16
set routing-options generate route 0.0.0.0/0 policy FROM-ISP
set routing-options interface-routes rib-group inet RG1
```

Route preferences (lower wins): Direct 0, Local 0, Static 5, OSPF internal 10, IS-IS L1 15, IS-IS L2 18, RIP 100, Aggregate 130, OSPF external 150, BGP 170.

```
root@R1> show route 0.0.0.0/0
inet.0: 10 destinations, 10 routes (10 active, 0 holddown, 0 hidden)
+ = Active Route, - = Last Active, * = Both

0.0.0.0/0          *[Static/5] 00:02:14
                    >  to 10.0.12.2 via ge-0/0/0.0
root@R1> show route protocol static
root@R1> show configuration routing-options
```

---

## 24. Routing policy (policy-options)

Policies decide what is **imported** to the RIB from a protocol and what is **exported** from the RIB to a protocol. Default actions differ per protocol (OSPF import: accept all; export: reject all; BGP import/export: accept).

```
set policy-options prefix-list LOOPBACKS 1.1.1.1/32
set policy-options prefix-list LOOPBACKS 2.2.2.2/32
set policy-options policy-statement EXPORT-STATIC term T1 from protocol static
set policy-options policy-statement EXPORT-STATIC term T1 from route-filter 192.168.50.0/24 exact
set policy-options policy-statement EXPORT-STATIC term T1 then metric 20
set policy-options policy-statement EXPORT-STATIC term T1 then accept
set policy-options policy-statement EXPORT-STATIC term DEFAULT then reject
set policy-options policy-statement SET-LP term T1 from community CUST
set policy-options policy-statement SET-LP term T1 then local-preference 200
set policy-options community CUST members 65001:100
set policy-options as-path FROM-AS65002 "^65002 .*"
set policy-options policy-statement BGP-IN term T1 from as-path FROM-AS65002
set policy-options policy-statement BGP-IN term T1 from prefix-list-filter LOOPBACKS orlonger
set policy-options policy-statement BGP-IN term T1 then next policy
set protocols ospf export EXPORT-STATIC
```
Match conditions (`from`): `protocol`, `route-filter` (exact | orlonger | longer | upto /n | prefix-length-range), `prefix-list`, `interface`, `neighbor`, `community`, `as-path`, `family`, `instance`, `tag`, `metric`, `preference`, `area`, `level`.
Actions (`then`): `accept`, `reject`, `next term`, `next policy`, `metric`, `local-preference`, `preference`, `community add|set|delete`, `as-path-prepend`, `next-hop self`, `tag`, `load-balance per-packet` (actually per-flow), `origin`, `external type 1|2`.

Test:
```
root@R1> test policy EXPORT-STATIC 192.168.50.0/24
Policy EXPORT-STATIC: 1 prefix accepted, 0 prefix rejected
inet.0: 11 destinations, 11 routes (11 active, 0 holddown, 0 hidden)
Prefixes passing policy:
192.168.50.0/24    *[Static/5] 00:05:12
                    >  to 10.0.13.3 via ge-0/0/1.0
```
Evaluation order: terms top-to-bottom; first term with an `accept`/`reject` terminates; chained policies `export [ P1 P2 ]`; default policy at the end.

---

## 25. OSPF, IS-IS, BGP

### 25.1 OSPF
```
set routing-options router-id 1.1.1.1
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 interface-type p2p
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 metric 10
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 hello-interval 5
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 dead-interval 20
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 authentication md5 1 key "ospfkey"
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 bfd-liveness-detection minimum-interval 300
set protocols ospf area 0.0.0.0 interface lo0.0 passive
set protocols ospf area 0.0.0.1 stub default-metric 10
set protocols ospf area 0.0.0.2 nssa
set protocols ospf area 0.0.0.0 area-range 10.0.0.0/16        # on ABR
set protocols ospf reference-bandwidth 100g
set protocols ospf overload
set protocols ospf traffic-engineering
set protocols ospf export EXPORT-STATIC
set protocols ospf3 realm ipv4-unicast area 0 interface ge-0/0/0.0    # OSPFv3
```
Verification:
```
root@R1> show ospf neighbor
Address          Interface              State           ID               Pri  Dead
10.0.12.2        ge-0/0/0.0             Full            2.2.2.2          128    33
10.0.13.3        ge-0/0/1.0             Full            3.3.3.3          128    35

root@R1> show ospf neighbor detail
root@R1> show ospf interface
Interface           State   Area            DR ID           BDR ID          Nbrs
ge-0/0/0.0          PtToPt  0.0.0.0         0.0.0.0         0.0.0.0            1
ge-0/0/1.0          DR      0.0.0.0         1.1.1.1         3.3.3.3            1
lo0.0               DR      0.0.0.0         1.1.1.1         0.0.0.0            0

root@R1> show ospf interface ge-0/0/0.0 detail
root@R1> show ospf database
    OSPF database, Area 0.0.0.0
 Type       ID               Adv Rtr           Seq      Age  Opt  Cksum  Len
Router  *1.1.1.1          1.1.1.1          0x80000007   311  0x22 0x8b3c  60
Router   2.2.2.2          2.2.2.2          0x80000006   298  0x22 0x6f5a  60
Router   3.3.3.3          3.3.3.3          0x80000005   296  0x22 0x4c70  60
Network *10.0.13.1        1.1.1.1          0x80000002   311  0x22 0x5d1a  32

root@R1> show ospf database router detail
root@R1> show ospf route
Prefix             Path  Route      NH       Metric NextHop       Nexthop
                   Type  Type       Type            Interface     Address/LSP
2.2.2.2            Intra Router     IP            1 ge-0/0/0.0    10.0.12.2
2.2.2.2/32         Intra Network    IP            1 ge-0/0/0.0    10.0.12.2

root@R1> show ospf statistics
root@R1> show ospf overview
root@R1> clear ospf neighbor all
root@R1> clear ospf database purge
```
Debug (traceoptions):
```
set protocols ospf traceoptions file ospf-trace size 1m files 3
set protocols ospf traceoptions flag hello detail
set protocols ospf traceoptions flag error
root@R1> show log ospf-trace
```

### 25.2 IS-IS
```
set interfaces ge-0/0/0 unit 0 family iso
set interfaces lo0 unit 0 family iso address 49.0001.0010.0100.1001.00
set protocols isis interface ge-0/0/0.0 point-to-point
set protocols isis interface ge-0/0/0.0 level 1 disable
set protocols isis interface lo0.0 passive
set protocols isis level 2 wide-metrics-only
set protocols isis level 1 disable
set protocols isis level 2 authentication-type md5
set protocols isis level 2 authentication-key "isiskey"
```
```
root@R1> show isis adjacency
Interface             System         L State        Hold (secs) SNPA
ge-0/0/0.0            R2             2  Up                   22

root@R1> show isis database
IS-IS level 2 link-state database:
LSP ID                      Sequence Checksum Lifetime Attributes
R1.00-00                         0x5    0xa1b7     1043 L1 L2
R2.00-00                         0x4    0x3d2c     1042 L1 L2
  2 LSPs

root@R1> show isis interface
root@R1> show isis route
root@R1> show isis statistics
```

### 25.3 BGP
```
set routing-options autonomous-system 65001
set protocols bgp group IBGP type internal
set protocols bgp group IBGP local-address 1.1.1.1
set protocols bgp group IBGP neighbor 2.2.2.2
set protocols bgp group IBGP family inet unicast
set protocols bgp group IBGP export NHS
set protocols bgp group EBGP type external
set protocols bgp group EBGP peer-as 65002
set protocols bgp group EBGP neighbor 10.0.12.2
set protocols bgp group EBGP import BGP-IN
set protocols bgp group EBGP export ADVERTISE-NETS
set protocols bgp group EBGP authentication-key "bgpkey"
set protocols bgp group EBGP multihop ttl 5            # eBGP over loopbacks
set protocols bgp group EBGP bfd-liveness-detection minimum-interval 300
set protocols bgp group EBGP family inet6 unicast
set protocols bgp group IBGP cluster 1.1.1.1           # route reflector
set protocols bgp group IBGP multipath
set protocols bgp group EBGP remove-private
set protocols bgp group EBGP local-as 65099 private
set protocols bgp group EBGP prefix-limit maximum 1000 teardown 80
set protocols bgp graceful-restart
set policy-options policy-statement NHS term 1 then next-hop self
set policy-options policy-statement ADVERTISE-NETS term 1 from protocol [ direct static ]
set policy-options policy-statement ADVERTISE-NETS term 1 from route-filter 192.168.0.0/16 orlonger
set policy-options policy-statement ADVERTISE-NETS term 1 then accept
```
Verification:
```
root@R1> show bgp summary
Threading mode: BGP I/O
Default eBGP mode: advertise - accept, receive - accept
Groups: 2 Peers: 2 Down peers: 0
Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending
inet.0                 4          3          0          0          0          0
Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...
2.2.2.2               65001         52         50       0       0       22:14 1/1/1/0              0/0/0/0
10.0.12.2             65002         61         58       0       1       25:03 2/3/3/0              0/0/0/0

root@R1> show bgp neighbor 10.0.12.2
Peer: 10.0.12.2+179 AS 65002   Local: 10.0.12.1+54133 AS 65001
  Group: EBGP                  Routing-Instance: master
  Forwarding routing-instance: master
  Type: External    State: Established    Flags: <ImportEval Sync>
  Last State: OpenConfirm   Last Event: RecvKeepAlive
  Last Error: None
  Export: [ ADVERTISE-NETS ] Import: [ BGP-IN ]
  Options: <Preference PeerAS Refresh>
  Holdtime: 90 Preference: 170
  Number of flaps: 1
  Peer ID: 2.2.2.2         Local ID: 1.1.1.1           Active Holdtime: 90
  Keepalive Interval: 30         Group index: 1    Peer index: 0
  Table inet.0 Bit: 10000
    RIB State: BGP restart is complete
    Send state: in sync
    Active prefixes:              2
    Received prefixes:            3
    Accepted prefixes:            3
    Suppressed due to damping:    0

root@R1> show route protocol bgp
inet.0: 12 destinations, 12 routes (12 active, 0 holddown, 0 hidden)
172.16.1.0/24      *[BGP/170] 00:25:03, localpref 100
                      AS path: 65002 I, validation-state: unverified
                    >  to 10.0.12.2 via ge-0/0/0.0

root@R1> show route receive-protocol bgp 10.0.12.2 detail
root@R1> show route advertising-protocol bgp 10.0.12.2
root@R1> show route 172.16.1.0/24 detail
root@R1> clear bgp neighbor 10.0.12.2 soft-inbound
root@R1> clear bgp neighbor 10.0.12.2 soft
root@R1> clear bgp neighbor 10.0.12.2           # hard reset
root@R1> show bgp group
root@R1> show bgp neighbor 10.0.12.2 | match "Received|Accepted|Error"
```
Common states in `State` column: `Idle`, `Connect`, `Active`, `OpenSent`, `OpenConfirm`, `Established` (shows as prefix counts).

---

## 26. MPLS, LDP, RSVP, L3VPN, EVPN-VXLAN

### 26.1 MPLS + LDP
```
set interfaces ge-0/0/0 unit 0 family mpls
set protocols mpls interface ge-0/0/0.0
set protocols ldp interface ge-0/0/0.0
set protocols ldp interface lo0.0
set protocols ldp track-igp-metric
```
```
root@R1> show ldp neighbor
Address            Interface          Label space ID         Hold time
10.0.12.2          ge-0/0/0.0         2.2.2.2:0                14
root@R1> show ldp session
Address           State        Connection     Hold time  Adv. Mode
2.2.2.2           Operational  Open                 28   DU
root@R1> show ldp database
root@R1> show route table mpls.0
mpls.0: 6 destinations, 6 routes (6 active, 0 holddown, 0 hidden)
0                  *[MPLS/0] 00:40:10, metric 1
                       Receive
299776             *[LDP/9] 00:20:11, metric 1
                    >  to 10.0.12.2 via ge-0/0/0.0, Pop
root@R1> traceroute mpls ldp 2.2.2.2/32
root@R1> ping mpls ldp 2.2.2.2/32
!!!!!
--- lsping statistics ---
5 packets transmitted, 5 packets received, 0% packet loss
```

### 26.2 RSVP-TE
```
set protocols rsvp interface ge-0/0/0.0
set protocols mpls label-switched-path R1-TO-R3 to 3.3.3.3
set protocols mpls label-switched-path R1-TO-R3 primary VIA-R2
set protocols mpls path VIA-R2 10.0.12.2 strict
set protocols mpls interface ge-0/0/0.0
set protocols ospf traffic-engineering
```
```
root@R1> show mpls lsp
Ingress LSP: 1 sessions
To              From            State Rt P     ActivePath       LSPname
3.3.3.3         1.1.1.1         Up     0 *                      R1-TO-R3
root@R1> show rsvp session
root@R1> show rsvp interface
root@R1> show mpls lsp extensive
```

### 26.3 L3VPN (PE router)
```
set routing-instances CUST-A instance-type vrf
set routing-instances CUST-A interface ge-0/0/3.0
set routing-instances CUST-A route-distinguisher 65001:100
set routing-instances CUST-A vrf-target target:65001:100
set routing-instances CUST-A vrf-table-label
set routing-instances CUST-A protocols bgp group CE type external peer-as 65100
set routing-instances CUST-A protocols bgp group CE neighbor 192.168.1.2
set protocols bgp group IBGP family inet-vpn unicast
```
```
root@PE1> show route table CUST-A.inet.0
root@PE1> show route table bgp.l3vpn.0
root@PE1> show route instance CUST-A
root@PE1> ping 192.168.2.2 routing-instance CUST-A
root@PE1> show bgp summary
```
Other instance types: `virtual-router`, `forwarding`, `l2vpn`, `vpls`, `evpn`, `mac-vrf`, `virtual-switch`.

### 26.4 EVPN-VXLAN (leaf, simplified)
```
set protocols bgp group OVERLAY type internal
set protocols bgp group OVERLAY local-address 10.255.0.1
set protocols bgp group OVERLAY family evpn signaling
set protocols bgp group OVERLAY neighbor 10.255.0.100
set switch-options vtep-source-interface lo0.0
set switch-options route-distinguisher 10.255.0.1:1
set switch-options vrf-target target:65000:1
set protocols evpn encapsulation vxlan
set protocols evpn extended-vni-list all
set vlans V100 vlan-id 100 vxlan vni 10100
```
```
root@leaf1> show evpn database
root@leaf1> show ethernet-switching vxlan-tunnel-end-point remote
root@leaf1> show route table bgp.evpn.0
```

---

## 27. Switching (QFX/EX/vJunos-switch/vQFX)

### VLANs (ELS syntax)
```
set vlans SALES vlan-id 10
set vlans ENG vlan-id 20
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members SALES
set interfaces ge-0/0/2 unit 0 family ethernet-switching interface-mode trunk vlan members [ SALES ENG ]
set interfaces irb unit 10 family inet address 192.168.10.1/24
set vlans SALES l3-interface irb.10
set vlans SALES description "Sales dept"
```
```
root@SW1> show vlans
Routing instance        VLAN name             Tag          Interfaces
default-switch          SALES                 10
                                                           ge-0/0/1.0*
                                                           ge-0/0/2.0*
default-switch          ENG                   20
                                                           ge-0/0/2.0*

root@SW1> show ethernet-switching table
MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, ...)
Ethernet switching table : 2 entries, 2 learned
Routing instance : default-switch
    Vlan                MAC                 MAC       Logical          SVLBNH/
    name                address             flags     interface        VENH Index
    SALES               00:50:79:66:68:00   D         ge-0/0/1.0
    SALES               50:00:00:03:00:00   D         ge-0/0/2.0

root@SW1> show ethernet-switching interface
root@SW1> clear ethernet-switching table all
```

### Spanning tree
```
set protocols rstp interface all
set protocols rstp bridge-priority 4096
set protocols rstp interface ge-0/0/1 edge
set protocols rstp bpdu-block-on-edge
set protocols mstp ...
set protocols vstp vlan SALES bridge-priority 4096
```
```
root@SW1> show spanning-tree bridge
STP bridge parameters
Context ID                          : 0
Enabled protocol                    : RSTP
  Root ID                           : 4096.50:00:00:01:00:00
  Hello time                        : 2 seconds
  Maximum age                       : 20 seconds
  Forward delay                     : 15 seconds
  Message age                       : 0
  Number of topology changes        : 3
  Local parameters
  Bridge ID                         : 4096.50:00:00:01:00:00
root@SW1> show spanning-tree interface
Spanning tree interface parameters for instance 0
Interface    Port ID    Designated      Designated         Port    State  Role
                         port ID        bridge ID          Cost
ge-0/0/1     128:2      128:2     4096.500000010000         20000  FWD    DESG
ge-0/0/2     128:3      128:3     4096.500000010000         20000  FWD    DESG
```

### LLDP, storm control, port security, DHCP snooping
```
set protocols lldp interface all
set protocols lldp-med interface all
set forwarding-options storm-control-profiles SC all bandwidth-percentage 10
set interfaces ge-0/0/1 unit 0 family ethernet-switching storm-control SC
set ethernet-switching-options secure-access-port interface ge-0/0/1 mac-limit 5
set vlans SALES forwarding-options dhcp-security dhcp-snooping   # (ELS)
set protocols dot1x authenticator interface ge-0/0/1
set protocols mvrp interface all
set protocols igmp-snooping vlan all
```

---

## 28. Firewall filters, policers, CoS

### Firewall filter (stateless ACL)
```
set firewall family inet filter PROTECT-RE term ALLOW-SSH from source-address 10.0.0.0/24
set firewall family inet filter PROTECT-RE term ALLOW-SSH from protocol tcp
set firewall family inet filter PROTECT-RE term ALLOW-SSH from destination-port ssh
set firewall family inet filter PROTECT-RE term ALLOW-SSH then accept
set firewall family inet filter PROTECT-RE term ALLOW-ICMP from protocol icmp
set firewall family inet filter PROTECT-RE term ALLOW-ICMP then { policer ICMP-LIM; accept; }
set firewall family inet filter PROTECT-RE term ALLOW-OSPF from protocol ospf
set firewall family inet filter PROTECT-RE term ALLOW-OSPF then accept
set firewall family inet filter PROTECT-RE term DENY-ALL then { count denied; log; discard; }
set interfaces lo0 unit 0 family inet filter input PROTECT-RE            # protects the RE
set interfaces ge-0/0/1 unit 0 family inet filter input F-IN
set interfaces ge-0/0/1 unit 0 family inet filter output F-OUT
set firewall policer ICMP-LIM if-exceeding bandwidth-limit 1m burst-size-limit 15k
set firewall policer ICMP-LIM then discard
```
Actions: `accept`, `discard` (silent), `reject [reason]`, `count <name>`, `log`, `syslog`, `policer`, `next term`, `forwarding-class`, `loss-priority`, `routing-instance` (FBF), `next-hop`. No implicit "permit" at the end — **implicit discard**.
```
root@R1> show firewall
Filter: PROTECT-RE
Counters:
Name                                                Bytes              Packets
denied                                               3120                   52
root@R1> show firewall filter PROTECT-RE
root@R1> show firewall log
root@R1> clear firewall all
```

### CoS (basic)
```
set class-of-service classifiers dscp CL forwarding-class expedited-forwarding loss-priority low code-points ef
set class-of-service scheduler-maps SM forwarding-class expedited-forwarding scheduler S-EF
set class-of-service schedulers S-EF priority strict-high transmit-rate percent 20
set class-of-service interfaces ge-0/0/0 scheduler-map SM
set class-of-service interfaces ge-0/0/0 unit 0 classifiers dscp CL
```
```
root@R1> show class-of-service interface ge-0/0/0
root@R1> show interfaces queue ge-0/0/0
```

---

## 29. SRX security (vSRX in GNS3)

### 29.1 Concepts
- **Flow-based** processing: first packet creates a **session**; later packets matched fast.
- **Security zones** group interfaces; **policies** control zone-to-zone; **host-inbound-traffic** controls traffic *to* the SRX itself; **NAT** (source, destination, static); **screens** for IDS-like checks; **IPsec VPN**; **UTM/IDP/AppSecure** (licensed).
- Default: intra-zone traffic **permitted**? On branch SRX: **denied** between zones, intra-zone default **permit** in some factory configs. Always configure explicitly.

### 29.2 Zones, interfaces, policies
```
set security zones security-zone TRUST interface ge-0/0/1.0
set security zones security-zone TRUST host-inbound-traffic system-services ping
set security zones security-zone TRUST host-inbound-traffic system-services ssh
set security zones security-zone TRUST host-inbound-traffic protocols ospf
set security zones security-zone UNTRUST interface ge-0/0/0.0
set security zones security-zone UNTRUST host-inbound-traffic system-services dhcp
set security address-book global address WEB-SRV 192.168.10.10/32
set security address-book global address-set SERVERS address WEB-SRV
set applications application MY-HTTP protocol tcp destination-port 8080
set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT match source-address any
set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT match destination-address any
set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT match application any
set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT then permit
set security policies from-zone TRUST to-zone UNTRUST policy ALLOW-OUT then log session-init session-close
set security policies from-zone UNTRUST to-zone TRUST policy WEB match source-address any
set security policies from-zone UNTRUST to-zone TRUST policy WEB match destination-address WEB-SRV
set security policies from-zone UNTRUST to-zone TRUST policy WEB match application junos-http
set security policies from-zone UNTRUST to-zone TRUST policy WEB then permit
set security policies default-policy deny-all
set security forwarding-options ...
```
Verification:
```
root@FW1> show security zones
Security zone: TRUST
  Send reset for non-SYN session TCP packets: Off
  Policy configurable: Yes
  Interfaces bound: 1
  Interfaces:
    ge-0/0/1.0

root@FW1> show security policies
Default policy: deny-all
From zone: TRUST, To zone: UNTRUST
  Policy: ALLOW-OUT, State: enabled, Index: 4, Scope Policy: 0, Sequence number: 1
    Source addresses: any
    Destination addresses: any
    Applications: any
    Action: permit, log

root@FW1> show security policies hit-count
root@FW1> show security policies from-zone TRUST to-zone UNTRUST detail
root@FW1> show security flow session
Session ID: 10312, Policy name: ALLOW-OUT/4, Timeout: 2, Valid
  In: 192.168.10.10/52344 --> 8.8.8.8/53;udp, Conn Tag: 0x0, If: ge-0/0/1.0, Pkts: 1, Bytes: 74,
  Out: 8.8.8.8/53 --> 203.0.113.2/21873;udp, Conn Tag: 0x0, If: ge-0/0/0.0, Pkts: 1, Bytes: 90,
Total sessions: 1

root@FW1> show security flow session source-prefix 192.168.10.0/24
root@FW1> show security flow session summary
root@FW1> clear security flow session all
root@FW1> show security flow status
```
Packet-mode (stateless) for protocols like MPLS: `set security forwarding-options family mpls mode packet-based` (reboot required).

### 29.3 NAT
Source NAT (interface mode, PAT):
```
set security nat source rule-set SNAT from zone TRUST
set security nat source rule-set SNAT to zone UNTRUST
set security nat source rule-set SNAT rule R1 match source-address 192.168.10.0/24
set security nat source rule-set SNAT rule R1 then source-nat interface
```
Source NAT with pool:
```
set security nat source pool POOL1 address 203.0.113.10/32 to 203.0.113.20/32
set security nat source rule-set SNAT rule R2 then source-nat pool POOL1
```
Destination NAT (port forward):
```
set security nat destination pool WEB address 192.168.10.10/32 port 80
set security nat destination rule-set DNAT from zone UNTRUST
set security nat destination rule-set DNAT rule R1 match destination-address 203.0.113.2/32
set security nat destination rule-set DNAT rule R1 match destination-port 80
set security nat destination rule-set DNAT rule R1 then destination-nat pool WEB
set security zones security-zone UNTRUST host-inbound-traffic ...
set security nat proxy-arp interface ge-0/0/0.0 address 203.0.113.10/32
```
Static NAT (1:1):
```
set security nat static rule-set STAT from zone UNTRUST
set security nat static rule-set STAT rule S1 match destination-address 203.0.113.50/32
set security nat static rule-set STAT rule S1 then static-nat prefix 192.168.10.50/32
```
```
root@FW1> show security nat source rule all
root@FW1> show security nat source summary
root@FW1> show security nat destination rule all
root@FW1> show security nat static rule all
root@FW1> show security nat interface-nat-ports
```
Remember: NAT is evaluated **before** the policy for destination NAT (policy uses the *translated* destination address) and **after** route lookup for source NAT.

### 29.4 IPsec site-to-site VPN (route-based)
```
set interfaces st0 unit 0 family inet address 172.31.0.1/30
set security ike proposal IKE-P authentication-method pre-shared-keys
set security ike proposal IKE-P dh-group group14
set security ike proposal IKE-P authentication-algorithm sha-256
set security ike proposal IKE-P encryption-algorithm aes-256-cbc
set security ike policy IKE-POL mode main
set security ike policy IKE-POL proposals IKE-P
set security ike policy IKE-POL pre-shared-key ascii-text "S3cret!"
set security ike gateway GW1 ike-policy IKE-POL
set security ike gateway GW1 address 203.0.113.100
set security ike gateway GW1 external-interface ge-0/0/0.0
set security ike gateway GW1 version v2-only
set security ipsec proposal IPSEC-P protocol esp
set security ipsec proposal IPSEC-P authentication-algorithm hmac-sha-256-128
set security ipsec proposal IPSEC-P encryption-algorithm aes-256-cbc
set security ipsec policy IPSEC-POL perfect-forward-secrecy keys group14
set security ipsec policy IPSEC-POL proposals IPSEC-P
set security ipsec vpn VPN1 bind-interface st0.0
set security ipsec vpn VPN1 ike gateway GW1
set security ipsec vpn VPN1 ike ipsec-policy IPSEC-POL
set security ipsec vpn VPN1 establish-tunnels immediately
set security zones security-zone VPN interface st0.0
set routing-options static route 192.168.99.0/24 next-hop st0.0
```
```
root@FW1> show security ike security-associations
Index   State  Initiator cookie  Responder cookie  Mode           Remote Address
5812    UP     a1b2c3d4e5f60718  8877665544332211  IKEv2          203.0.113.100

root@FW1> show security ipsec security-associations
  Total active tunnels: 1     Total Ipsec sas: 1
  ID     Algorithm       SPI      Life:sec/kb  Mon lsys Port  Gateway
  <131073 ESP:aes-cbc-256/sha256 1b2c3d4e 3213/ unlim - root 500 203.0.113.100
  >131073 ESP:aes-cbc-256/sha256 5f6e7d8c 3213/ unlim - root 500 203.0.113.100

root@FW1> show security ipsec statistics
root@FW1> clear security ike security-associations
root@FW1> clear security ipsec security-associations
root@FW1> request security ike debug-enable local 203.0.113.2 remote 203.0.113.100
```
Troubleshoot: `set security ike traceoptions file ike-trace`, `flag all`; `show log ike-trace`.

### 29.5 Screens (attack protection)
```
set security screen ids-option UNTRUST-SCREEN icmp ping-death
set security screen ids-option UNTRUST-SCREEN ip source-route-option
set security screen ids-option UNTRUST-SCREEN tcp syn-flood attack-threshold 200
set security screen ids-option UNTRUST-SCREEN tcp land
set security screen ids-option UNTRUST-SCREEN limit-session source-ip-based 128
set security zones security-zone UNTRUST screen UNTRUST-SCREEN
```
```
root@FW1> show security screen ids-option UNTRUST-SCREEN
root@FW1> show security screen statistics zone UNTRUST
```

### 29.6 Other SRX features
- **ALGs:** `set security alg ftp ftp-data disable`, `show security alg status`
- **Chassis cluster (HA):** `set chassis cluster cluster-id 1 node 0 reboot`, `reth`, redundancy groups, `show chassis cluster status`
- **Zones/lsys/tenants:** logical systems
- **UTM** (antivirus, web filtering, anti-spam), **IDP**, **AppSecure** (`application-identification`) — need licences
- **DHCP server on SRX:** `set system services dhcp-local-server group LAN interface ge-0/0/1.0`, `set access address-assignment pool P family inet network 192.168.10.0/24 range R low 192.168.10.100 high 192.168.10.200`
- **Security logging:** `set security log mode stream`, `set security log source-address 192.168.1.1`, `set security log stream S host 10.0.0.9`
- **Application tracking, user firewall (identity), Screen/GeoIP** (feature set depends on version).

---

## 30. Automation

### 30.1 NETCONF over SSH
```
set system services netconf ssh
```
From a client:
```bash
$ ssh admin@10.0.12.1 -p 830 -s netconf
<!-- hello from device -->
<hello xmlns="urn:ietf:params:xml:ns:netconf:base:1.0">
  <capabilities>
    <capability>urn:ietf:params:netconf:base:1.0</capability>
    <capability>urn:ietf:params:netconf:capability:candidate:1.0</capability>
...
]]>]]>
```
From the Junos CLI, see the RPC behind any command:
```
root@R1> show interfaces terse | display xml rpc
<rpc-reply ...>
    <rpc>
        <get-interface-information>
                <terse/>
        </get-interface-information>
    </rpc>
```
Output in XML/JSON: `show route | display xml`, `show version | display json`.

### 30.2 PyEZ (Python)
```bash
pip install junos-eznc
```
```python
from jnpr.junos import Device
from jnpr.junos.utils.config import Config

with Device(host="10.0.12.1", user="admin", passwd="Juniper123", port=22) as dev:
    print(dev.facts["version"], dev.facts["hostname"])
    r = dev.rpc.get_interface_information(terse=True)
    for i in r.findall(".//logical-interface"):
        print(i.findtext("name").strip())
    with Config(dev, mode="private") as cu:
        cu.load("set interfaces lo0 unit 0 family inet address 1.1.1.1/32", format="set")
        print(cu.diff())
        cu.commit(comment="via PyEZ")
```
Output:
```
23.2R1.13 R1
lo0.0
ge-0/0/0.0
[edit interfaces]
+   lo0 {
+       unit 0 {
+           family inet {
+               address 1.1.1.1/32;
```

### 30.3 REST API
```
set system services rest http port 3000
```
```bash
$ curl -s -u admin:Juniper123 -H "Accept: application/json" \
   http://10.0.12.1:3000/rpc/get-software-information
```

### 30.4 Ansible
```bash
ansible-galaxy collection install junipernetworks.junos
```
```yaml
- hosts: junos
  connection: ansible.netcommon.netconf
  gather_facts: no
  tasks:
    - junipernetworks.junos.junos_config:
        lines:
          - set system host-name R1
        comment: "ansible"
    - junipernetworks.junos.junos_command:
        commands: show version
      register: out
```

### 30.5 On-box scripts
- **Op scripts** (`/var/db/scripts/op/*.slax|.py`): `set system scripts op file myscript.py`, run `op myscript`.
- **Commit scripts** (`/var/db/scripts/commit/`): validate or transform config at commit: `set system scripts commit file check.slax`.
- **Event policies / event scripts:**
```
set event-options policy LINKDOWN events SNMP_TRAP_LINK_DOWN
set event-options policy LINKDOWN then execute-commands commands "show interfaces terse"
set event-options policy LINKDOWN then execute-commands output-filename linkdown.log destination LOGS
set event-options destinations LOGS archive-sites "scp://user@10.0.0.9/logs"
```
- **Python on-box:** `set system scripts language python3`.
- **Junos Telemetry Interface (JTI)/gRPC:** `set services analytics ...`, `set system services extension-service request-response grpc`.
- **YANG:** `show system yang package`, OpenConfig packages.

---

## 31. Maintenance

### Software
```
root@R1> request system software add /var/tmp/junos-vsrx3-x86-64-23.2R2.21.tgz no-copy
root@R1> request system software validate /var/tmp/...
root@R1> request vmhost software add ...           # QFX/MX with vmhost
root@R1> request system reboot
Reboot the system ? [yes,no] (no) yes
Shutdown NOW!
root@R1> request system halt
root@R1> request system power-off
root@R1> request system software rollback
root@R1> show system software
root@R1> request system storage cleanup
List of files to delete:
 Size Date       Name
 ...
Delete these files ? [yes,no] (no) yes
```

### Snapshots and zeroize
```
root@R1> request system snapshot
root@R1> request system configuration rescue save
root@R1> rollback rescue                               # (config mode) load rescue config
root@R1> request system zeroize                        # factory reset incl. keys/users
warning: System will be rebooted and may not boot without configuration
Erase all data, including configuration and log files? [yes,no] (no) yes
```
`load factory-default` (config mode) resets only configuration (then set a root password before commit).

### Chassis
```
root@R1> show chassis environment
root@R1> show chassis fpc
root@R1> show chassis fpc pic-status
root@R1> request chassis fpc restart slot 0
root@R1> restart routing                         # restart rpd
Routing protocols process started, pid 4126
root@R1> restart chassis-control
root@R1> restart interface-control
root@R1> restart ntp
root@R1> restart snmp
```

### Traceoptions (global debug)
```
set protocols bgp traceoptions file bgp-trace size 5m files 3
set protocols bgp traceoptions flag open detail
set protocols bgp traceoptions flag update
root@R1> show log bgp-trace
root@R1> clear log bgp-trace
root@R1> monitor start bgp-trace
delete protocols bgp traceoptions                # clean up!
```

---

## 32. Troubleshooting toolbox

| Problem | Commands |
|---|---|
| Commit fails | `commit check`, read the error with the `[edit ...]` path; `show \| compare`; `rollback 0`. Typical: `error: ... Missing mandatory statement: 'root-authentication'`. |
| Locked out after commit | Use `commit confirmed 5` before risky changes; console → `rollback 1; commit`. |
| Interface down | `show interfaces ge-0/0/0 extensive`, check `disable`, link partner, adapter type in GNS3, `monitor interface`. |
| No ARP | `show arp`, `monitor traffic interface ge-0/0/0 matching arp`, family inet configured? same subnet/mask? |
| OSPF stuck in Init/ExStart | MTU mismatch (`show interfaces … \| match mtu`), area ID, hello/dead, authentication, network type; `traceoptions`. |
| OSPF neighbor Full but no route | `show ospf database`, policies; check `show route protocol ospf hidden`. |
| BGP Active/Idle | Reachability (`ping source`), `local-address`, TCP 179 blocked (filter on lo0), AS mismatch (`show bgp neighbor \| match error`), `multihop`. |
| Route not in table | `show route hidden extensive` (unusable next hop), `show route 1.2.3.4 extensive`, policy `test policy`. |
| Traffic dropped by SRX | `show security flow session`, `show log messages \| match RT_FLOW`, `set security flow traceoptions` (flag basic-datapath, packet-filter), `show security policies hit-count`, check zone binding. |
| High CPU | `show system processes extensive`, `show chassis routing-engine`, `show system statistics`, `show system virtual-memory`. |
| Config diff for audits | `show \| compare rollback 3`, `show system rollback compare 0 3`. |

SRX flow trace:
```
set security flow traceoptions file flow-trace size 1m files 3
set security flow traceoptions flag basic-datapath
set security flow traceoptions packet-filter PF1 source-prefix 192.168.10.10/32 destination-prefix 8.8.8.8/32
root@FW1> show log flow-trace
Oct 30 11:02:01 11:02:01.372 ... flow_process_pkt_rt_move... 
 ... packet dropped, policy deny.
```
Remove after use: `delete security flow traceoptions`.

---

# PART C — Putting them together

## 33. Full lab: Junos in GNS3 (step by step)

**Goal:** 3 Junos routers (R1, R2, R3) in a triangle running OSPF, plus 2 VPCS hosts, packet capture in Wireshark, then a vSRX firewall.

### Topology
```
 PC1 ---- R1 ====== R2 ---- PC2
            \      /
             \    /
              R3
Links: R1 ge-0/0/0 <-> R2 ge-0/0/0  10.0.12.0/24
       R1 ge-0/0/1 <-> R3 ge-0/0/0  10.0.13.0/24
       R2 ge-0/0/1 <-> R3 ge-0/0/1  10.0.23.0/24
       PC1 <-> R1 ge-0/0/2          192.168.1.0/24
       PC2 <-> R2 ge-0/0/2          192.168.2.0/24
Loopbacks: R1 1.1.1.1  R2 2.2.2.2  R3 3.3.3.3
```

### Step-by-step in GNS3
1. **File → New blank project** → name `junos-ospf-lab` → **OK**.
2. **Import the image:** **File → Import appliance** → choose your Juniper appliance (e.g. vJunos-router / vSRX) → follow Section 7 wizard. (Or build a manual QEMU template.)
3. **Drag nodes:** open **Browse routers** (or **security devices** for vSRX) → drag the Juniper template onto the canvas three times (`R1`,`R2`,`R3`). **Browse end devices** → drag **VPCS** twice (`PC1`, `PC2`).
4. **Cable them:** click the **Add a link** icon → click R1 → select `ge-0/0/0` → click R2 → select `ge-0/0/0`. Repeat for the other links. Press **Esc** when done.
   - Remember the first adapter is `fxp0`/management; the template's adapter name format handles the offset so the popup shows `ge-0/0/0`, `ge-0/0/1`, …
5. **Start:** click the green ▶ **Start all**. Open the console of each router (double-click) and wait for the `login:` prompt (3–8 min).
6. **Log in:** `root` (blank password on vSRX/vJunos first boot) → `cli` → `configure`.

### R1 configuration
```
root@:~ # cli
root> configure
root# set system host-name R1
root# set system root-authentication plain-text-password
New password: Lab12345
Retype new password: Lab12345
root# set system services ssh root-login allow
root# set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/24
root# set interfaces ge-0/0/1 unit 0 family inet address 10.0.13.1/24
root# set interfaces ge-0/0/2 unit 0 family inet address 192.168.1.1/24
root# set interfaces lo0 unit 0 family inet address 1.1.1.1/32
root# set routing-options router-id 1.1.1.1
root# set protocols ospf area 0 interface ge-0/0/0.0 interface-type p2p
root# set protocols ospf area 0 interface ge-0/0/1.0 interface-type p2p
root# set protocols ospf area 0 interface ge-0/0/2.0 passive
root# set protocols ospf area 0 interface lo0.0 passive
root# commit and-quit
commit complete
Exiting configuration mode
```

### R2 configuration (set format; paste with `load set terminal`)
```
set system host-name R2
set system root-authentication plain-text-password
set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.2/24
set interfaces ge-0/0/1 unit 0 family inet address 10.0.23.2/24
set interfaces ge-0/0/2 unit 0 family inet address 192.168.2.1/24
set interfaces lo0 unit 0 family inet address 2.2.2.2/32
set routing-options router-id 2.2.2.2
set protocols ospf area 0 interface ge-0/0/0.0 interface-type p2p
set protocols ospf area 0 interface ge-0/0/1.0 interface-type p2p
set protocols ospf area 0 interface ge-0/0/2.0 passive
set protocols ospf area 0 interface lo0.0 passive
```

### R3 configuration
```
set system host-name R3
set system root-authentication plain-text-password
set interfaces ge-0/0/0 unit 0 family inet address 10.0.13.3/24
set interfaces ge-0/0/1 unit 0 family inet address 10.0.23.3/24
set interfaces lo0 unit 0 family inet address 3.3.3.3/32
set routing-options router-id 3.3.3.3
set protocols ospf area 0 interface ge-0/0/0.0 interface-type p2p
set protocols ospf area 0 interface ge-0/0/1.0 interface-type p2p
set protocols ospf area 0 interface lo0.0 passive
```
Paste procedure: `configure` → `load set terminal` → paste → **Ctrl+D** → `commit and-quit`.

### Hosts (VPCS consoles)
```
PC1> ip 192.168.1.10/24 192.168.1.1
PC1> save
PC2> ip 192.168.2.10/24 192.168.2.1
PC2> save
```

### Verification outputs
```
root@R1> show ospf neighbor
Address          Interface              State           ID               Pri  Dead
10.0.12.2        ge-0/0/0.0             Full            2.2.2.2          128    36
10.0.13.3        ge-0/0/1.0             Full            3.3.3.3          128    33

root@R1> show route protocol ospf
inet.0: 11 destinations, 11 routes (11 active, 0 holddown, 0 hidden)
+ = Active Route, - = Last Active, * = Both

2.2.2.2/32         *[OSPF/10] 00:03:41, metric 1
                    >  to 10.0.12.2 via ge-0/0/0.0
3.3.3.3/32         *[OSPF/10] 00:03:40, metric 1
                    >  to 10.0.13.3 via ge-0/0/1.0
10.0.23.0/24       *[OSPF/10] 00:03:41, metric 2
                    >  to 10.0.12.2 via ge-0/0/0.0
                       to 10.0.13.3 via ge-0/0/1.0
192.168.2.0/24     *[OSPF/10] 00:03:41, metric 2
                    >  to 10.0.12.2 via ge-0/0/0.0
224.0.0.5/32       *[OSPF/10] 00:12:44, metric 1
                       MultiRecv

PC1> ping 192.168.2.10
84 bytes from 192.168.2.10 icmp_seq=1 ttl=62 time=6.411 ms
84 bytes from 192.168.2.10 icmp_seq=2 ttl=62 time=4.020 ms
84 bytes from 192.168.2.10 icmp_seq=3 ttl=62 time=4.208 ms

PC1> trace 192.168.2.10
trace to 192.168.2.10, 8 hops max, press Ctrl+C to stop
 1   192.168.1.1   1.101 ms  0.921 ms  0.854 ms
 2   10.0.12.2     3.002 ms  2.114 ms  2.287 ms
 3   *192.168.2.10  4.001 ms (ICMP type:3, code:3, Destination port unreachable)
```

### Capture an OSPF exchange
1. Right-click the link R1—R2 → **Start capture** → data link **Ethernet** → file name default → **OK**. Wireshark opens.
2. Apply display filter `ospf`. Bounce OSPF: on R1 `clear ospf neighbor 10.0.12.2`. You will see `Hello`, `DB Description`, `LS Request`, `LS Update`, `LS Ack` packets.
3. Right-click link → **Stop capture**.

### Simulate WAN impairment
Right-click link R1—R2 → **Packet filters** → tick **Delay** → `50` ms (latency) and `10` ms jitter → **Apply**. Then `PC1> ping 192.168.2.10` shows ~50 ms+ RTT.

### Break/fix drills
- **Suspend the R1—R2 link** (right-click → **Suspend**) → on R1: `show ospf neighbor` shows only R3; `PC1> trace` now goes via R3 (3 hops of routers). **Resume** to restore.
- **Break MTU:** `set interfaces ge-0/0/0 mtu 1400` on R1 only → OSPF stuck in `ExStart`.

### Adding a vSRX firewall between PC and the Internet
1. Drag **vSRX** onto canvas; connect `ge-0/0/0` to a **NAT** node (Internet) and `ge-0/0/1` to a VPCS host.
2. Config:
```
set system host-name FW1
set system root-authentication plain-text-password
set interfaces ge-0/0/0 unit 0 family inet dhcp
set interfaces ge-0/0/1 unit 0 family inet address 192.168.10.1/24
set security zones security-zone UNTRUST interface ge-0/0/0.0
set security zones security-zone UNTRUST host-inbound-traffic system-services dhcp
set security zones security-zone TRUST interface ge-0/0/1.0
set security zones security-zone TRUST host-inbound-traffic system-services [ ping ssh ]
set security nat source rule-set SNAT from zone TRUST
set security nat source rule-set SNAT to zone UNTRUST
set security nat source rule-set SNAT rule R1 match source-address 192.168.10.0/24
set security nat source rule-set SNAT rule R1 then source-nat interface
set security policies from-zone TRUST to-zone UNTRUST policy ALLOW match source-address any destination-address any application any
set security policies from-zone TRUST to-zone UNTRUST policy ALLOW then permit
set system name-server 8.8.8.8
commit
```
3. Verify:
```
root@FW1> show interfaces ge-0/0/0 terse
ge-0/0/0.0              up    up   inet     192.168.122.77/24
root@FW1> ping 8.8.8.8 count 2
PING 8.8.8.8 (8.8.8.8): 56 data bytes
64 bytes from 8.8.8.8: icmp_seq=0 ttl=114 time=21.4 ms
64 bytes from 8.8.8.8: icmp_seq=1 ttl=114 time=20.1 ms
PC3> ip 192.168.10.10/24 192.168.10.1
PC3> ping 8.8.8.8
84 bytes from 8.8.8.8 icmp_seq=1 ttl=113 time=24.8 ms
root@FW1> show security flow session
Session ID: 20114, Policy name: ALLOW/4, Timeout: 2, Valid
  In: 192.168.10.10/1 --> 8.8.8.8/1;icmp, ...
  Out: 8.8.8.8/1 --> 192.168.122.77/10419;icmp, ...
root@FW1> show security nat source summary
```

### Save your work
- Back up configs: `show configuration | display set | save /var/tmp/R1.set` then `file copy` off-box; or use GNS3 **File → Export portable project** (include base images off to keep size small).
- Create a **GNS3 snapshot** (**File → Snapshots → Create**) before big changes.

---

## 34. Cheat sheets

### Junos ↔ Cisco IOS quick map
| Task | Cisco IOS | Junos |
|---|---|---|
| Show interfaces brief | `show ip int brief` | `show interfaces terse` |
| Show routes | `show ip route` | `show route` |
| Show config | `show run` | `show configuration` (op) / `show` (config) |
| Save config | `write mem` | `commit` |
| Enter config | `conf t` | `configure` |
| Undo | `no <cmd>` | `delete <stmt>` / `rollback` |
| OSPF neighbors | `show ip ospf neighbor` | `show ospf neighbor` |
| BGP summary | `show ip bgp summary` | `show bgp summary` |
| ARP | `show arp` | `show arp` |
| Ping source | `ping x source y` | `ping x source y` |
| VLANs | `show vlan brief` | `show vlans` |
| MAC table | `show mac address-table` | `show ethernet-switching table` |
| Logs | `show logging` | `show log messages` |
| Reload | `reload` | `request system reboot` |
| Erase config | `write erase` | `load factory-default` / `request system zeroize` |

### Junos 20 commands you will use daily
```
configure | commit | commit check | commit confirmed 5 | rollback 1
show | compare | show | display set | run show ...
show interfaces terse | show route | show route protocol ospf
show ospf neighbor | show bgp summary | show arp | show lldp neighbors
show system uptime | show chassis alarms | show log messages | last 30
monitor traffic interface ge-0/0/0 | monitor start messages
ping x count 5 | traceroute x no-resolve | test policy P prefix
show security flow session | show security policies | show security nat source summary
request system reboot | request system snapshot | request system zeroize
```

### GNS3 keyboard shortcuts (common)
| Action | Shortcut |
|---|---|
| New project | Ctrl+N |
| Open project | Ctrl+O |
| Start all nodes | Ctrl+Shift+S |
| Stop all nodes | Ctrl+Shift+T |
| Reload all nodes | Ctrl+Shift+R (varies) |
| Suspend all | Ctrl+Shift+P |
| Console to all | Ctrl+Shift+C |
| Preferences | Ctrl+Shift+P |
| Zoom in/out | Ctrl + mouse wheel / Ctrl+ +/- |
| Fit in view | Ctrl+0 |
| Select all | Ctrl+A |
| Delete selected | Del |
| Lock/unlock | Ctrl+L |
| Add note | Ctrl+N (annotate) |

> Shortcuts differ slightly between OS and versions — hover over toolbar icons or check the menu bar to confirm.

### Port map in GNS3 for Juniper VMs (typical)
| GNS3 adapter # | Junos name | Purpose |
|---|---|---|
| 0 | `fxp0` / `em0` | Management |
| 1 | `ge-0/0/0` | First data port |
| 2 | `ge-0/0/1` | … |
| n | `ge-0/0/(n-1)` | … |

*(vMX/vQFX: RE interface 0 = mgmt, 1 = internal PFE link, then data ports; follow the appliance notes.)*

### Typical resource sizing for a laptop lab
| Node | vCPU | RAM |
|---|---|---|
| vSRX 3.0 | 2 | 4 GB |
| vJunos-switch | 4 | 5 GB |
| vJunos-router | 4 | 5–8 GB |
| vMX (vCP+vFP) | 1 + 3 | 2 GB + 4 GB |
| vQFX (RE+PFE) | 1 + 1 | 1 GB + 2 GB |
| cRPD | 1 | 0.5 GB |
| VPCS | negligible | ~10 MB |

### Official docs to verify details
- GNS3 documentation: docs.gns3.com
- Juniper TechLibrary: juniper.net/documentation
- Juniper Day One books (free) and vLabs / JNCIA study material

---
*End of guide.*
