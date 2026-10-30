# Juniper vLabs & GNS3 — Detailed Feature and Usage Guide

> **Scope note.** "Juniper Labs" is not a single product name, so this guide treats it as **Juniper vLabs** (the free browser-based lab platform at `jlabs.juniper.net`) plus the other Juniper lab offerings and how to run Juniper software inside GNS3.
>
> **Source confidence.**
> - Juniper vLabs steps are taken from the official *Juniper vLabs User Guide v1.7* (2021). The UI may have been refreshed since, so button names can differ slightly.
> - GNS3 steps are based on the 2.2.x / 3.0.x GUI. Version 3.0.6 was released Jan 2026 and 2.2.57 in Mar 2026. 3.1.0 is still in alpha, with a revamped web UI, a dark theme and an AI "Copilot" back-end.
> - Menu labels in GNS3 shift a little between versions. Where I am less sure of an exact label, I say so.

---

## Table of contents

1. [Part A — Juniper vLabs](#part-a--juniper-vlabs)
2. [Part B — Other Juniper lab options](#part-b--other-juniper-lab-options)
3. [Part C — GNS3](#part-c--gns3)
4. [Part D — Running Juniper devices inside GNS3](#part-d--running-juniper-devices-inside-gns3)
5. [Part E — vLabs vs GNS3 comparison](#part-e--vlabs-vs-gns3-comparison)
6. [Part F — Suggested study workflow](#part-f--suggested-study-workflow)

---

# Part A — Juniper vLabs

## A1. What it is

- A **web-based sandbox platform** for trying Juniper products without owning any hardware.
- Topologies cover **routing, switching, security, automation, and network management/analytics**.
- Sessions are **free** for anyone with a **Juniper account**.
- Sessions can be reserved **in advance or on demand**.
- Powered by the **Juniper Cloud Labs (JCL)** platform. Other Juniper lab services use the same platform, so the experience is similar.
- Runs in a normal browser (Firefox and Chrome were tested). **No plug-ins are needed.** A local SSH client is optional.

### Key concepts

| Term | Meaning |
|---|---|
| **Topology catalog** | The list of available lab topologies. |
| **Blueprint** | A topology template, made of virtual devices and other resources. |
| **Sandbox** | A running copy of a blueprint after you reserve it. |
| **Resource** | A device or component in the topology (vMX, vSRX, Linux host, a management GUI, etc.). |
| **Reservation** | A time-boxed booking of a sandbox. |

### Limits to know before you start

- **Topologies are fixed.** You cannot add devices or change the topology (official FAQ).
- vLabs is a **self-contained environment**. It does not provide external connectivity to real equipment (Juniper community answer).
- Default session length is **3 hours**. The guide says the maximum session is **6 hours** (this may have changed since 2021).
- Setup takes **about 15 minutes**.
- Support is **self-serve**: email `vlabs@juniper.net`. There is no real-time support.
- Only IPv4 addresses are accepted in the "allowed prefixes" firewall feature.

---

## A2. Creating an account and logging in

1. Go to `https://jlabs.juniper.net/vlabs/`.
2. Click **Sign up / Log in** and sign in with your **Juniper account**. If you don't have one, create it first.
3. After login you land on the **Topology catalog**.

---

## A3. Launching a topology (blueprint)

1. On the **Topology catalog** page, browse the list of topologies.
2. Click **Launch** on the one you want.
3. The topology opens in the vLabs UI **as a blueprint**. It is not running yet.

> **Tip:** Topology-specific details (device credentials, tasks) are shown after you log in and reserve it.

---

## A4. Setting your time zone (do this before reserving)

1. Click your **username** at the top right of the vLabs UI.
2. Pick your **time zone** (for India that is IST, UTC+5:30).
3. All reservations you make will use this time zone.

> **Gotcha:** The default is **UTC**. If you **clear your browser cache**, it resets to UTC.

---

## A5. Reserving a session

1. Click the **RESERVE** button at the top right.
2. In the **Reserve** window, only the **SCHEDULE** section needs attention:
   - **Start date / start time.** The default is *start immediately*.
   - **Session length.** The default is **3 hours**.
3. Click **Reserve** at the bottom of the window.

> **Do not edit device software-version fields.** They are text-editable, but changing them breaks device startup.

### Setup indicators

- The status icon at the top right shows **Setup**. Hover it for the estimated time.
- The **Sandbox header** turns into a striped pattern.
- Each resource has a **spinning circle** around it.
- You get a **"setup started" email**.

### Ready indicators

- The status icon changes from **Setup** to **Active**.
- You get a **"sandbox ready" email**.
- Each resource shows a small **green circle** at its bottom-right corner.

If you closed the page, open the sandbox from the link in the "ready" email.

---

## A6. Accessing devices in the sandbox

### A6.1 SSH in the browser (easiest, no setup)

1. Hover over a device icon. Several small icons appear.
2. Click the **down-arrow** icon.
3. Choose **SSH** from the menu.
4. A new browser tab opens an SSH session to the device's **out-of-band management interface**.

### A6.2 SSH from your own terminal (PuTTY, Windows Terminal, etc.)

This needs one-time firewall setup:

1. Find your **public IPv4** address (search "what is my ip").
2. In the vLabs UI, click **COMMANDS** in the toolbar.
3. Find **Add Allowed Network Prefixes** and click the **>** arrow next to it.
4. In the **List_of_Prefixes** field, enter your IP address. IPv4 only.
5. Click **Run**.
6. A banner appears at the top centre and the *Blueprint Commands* area shows **Running**. When it finishes it shows **Completed**, and you get a confirmation email.
7. Hover the **green circle** on a device and copy its **SSH IP address and port**.
8. In your SSH client, create a connection to that IP and port, then log in with the device credentials.
9. Repeat for each device.

> If you are on mobile data or a changing IP, repeat the allow-list step whenever your public IP changes.

### A6.3 HTTPS / GUI access (J-Web, Security Director, Apstra, etc.)

1. Do the same **Add Allowed Network Prefixes** steps as in A6.2.
2. Hover over the resource icon and click the **down-arrow**.
3. Choose **HTTPS** (or the equivalent GUI option, which varies per product).
4. A new tab opens the device's web interface over the management network.

### A6.4 Console port access (for recovery)

Use this if you broke the management interface config, for example after deleting `fxp0`/`em0` config.

1. Hover over the resource to select it.
2. Click the **right-arrow "Commands"** button. The **Resource Commands** box opens on the right.
3. Find **Enable VM Console Access**, click **>**, then click **Run**. This generates the access token.
4. From the resource's drop-down menu, choose **VM Console**.
5. In the new tab, click in the black area and press **Enter** once or twice to get a login prompt.
6. The credentials are the same as for SSH.

> If you open the VM console **before** generating the token, you will get an "invalid login" message.

---

## A7. Managing a live reservation

### Extend

1. Click the **Extend** icon at the top right.
2. In the window, click the blue time fields and pick how much time to add.
3. Click **Extend**. The maximum session is **6 hours**.

### End early

1. Click the **End** icon at the top right.
2. Click **OK**.
3. You will see an "ending process started" message, the status **TEARDOWN**, and a confirmation email. You can close the browser. You don't need to wait.

> **Everything is wiped at the end.** Copy your configs out (`show configuration | display set`) before the timer runs out.

---

## A8. Health monitoring and troubleshooting

Each resource has a **health icon** at its bottom-right corner:

| Colour | Meaning |
|---|---|
| **Green** | Up and running normally. |
| **Partial green** | Up, but not all access ports (SSH, HTTPS, etc.) are enabled yet. |
| **Red / grey** | Problem with the resource. |

### Power-cycle a single resource

1. Hover over the resource and click the **right-arrow (Commands)** button.
2. Under **Resource Commands**, use the **Power Management** commands.
3. Click **Run** for power on, power down, or power cycle.

### Re-initialize ("Start Over")

1. Hover over the resource and click the **Commands** arrow.
2. Find **Start Over**, click **>**, then click **Run**.
3. The resource is torn down and rebuilt as new.

> **Warning:** Re-initializing a **vMX or vSRX does not reload the starting config and does not keep your changes.** Save your config first, then paste it back.

### Last resort

If nothing works, **End** the sandbox and **reserve a new one**.

---

## A9. Typical lab workflow in vLabs

1. Log in, pick a topology, click **Launch**.
2. Set your time zone, then click **RESERVE**.
3. Wait about 15 minutes for **Active**.
4. Open **SSH** from the device menu.
5. Enter configuration mode and work through your lab:
   ```
   user@vmx1> configure
   [edit]
   user@vmx1# set interfaces ge-0/0/0 unit 0 family inet address 10.0.0.1/30
   user@vmx1# commit check
   user@vmx1# commit
   ```
6. Save your work off-box:
   ```
   user@vmx1> show configuration | display set
   ```
   Copy the output into a local text file.
7. Extend the session if needed, or **End** it when you are done.

---

# Part B — Other Juniper lab options

| Option | What it is | Access |
|---|---|---|
| **Juniper vLabs** | Free preset topologies (above). | Any Juniper account. |
| **Self-Study Bundle labs** (`labs.edu.juniper.net`) | Reservation-based labs bundled with certification self-study courses (e.g. JNCIE-DC). The tutorial warns: **do not reserve until you are ready to use it, because extra sessions cannot be granted.** | Purchased bundle. |
| **Apstra Cloudlabs** | Apstra with vQFX or competitor virtual switches. | Partners, via Juniper account team. |
| **Free virtual Junos downloads** (vJunos router/switch) | Images for your own EVE-NG, GNS3 or KVM lab. Juniper's page describes a three-step download for control-plane testing. | Juniper account. |
| **Juniper "try" page** (`juniper.net/try`) | Directory of more lab and trial offerings. | Varies. |

---

# Part C — GNS3

## C1. What GNS3 is

- **Graphical Network Simulator-3**: an open-source network emulator.
- It runs **real router and switch images**, not simulations. That includes Cisco IOS via Dynamips, IOU/IOL, QEMU/KVM appliances (Juniper, Arista, Fortinet, etc.), Docker containers, and VirtualBox/VMware VMs.
- It supports **packet capture, real-network bridging, snapshots, project export** and more.

### Architecture (important for troubleshooting)

| Component | Role |
|---|---|
| **GNS3 GUI** | The desktop client you draw topologies in. |
| **GNS3 server (controller)** | Manages projects, and exposes a REST API (default port **3080**). |
| **Compute** | Actually runs nodes (local, GNS3 VM, or remote server). |
| **GNS3 VM** | A Linux VM (VMware, VirtualBox, Hyper-V, ESXi) that runs QEMU/Docker/Dynamips for better performance and KVM. |
| **Web UI** | Browser interface served by the server. 3.1.0 alpha brings a completely revamped one. |

### Version notes

- **2.2.x**: legacy stable branch.
- **3.0.x**: new FastAPI-based secured API, RBAC with resource pools, image manager (upload and manage Dynamips/QEMU/IOU images, with templates auto-created after upload), Zstandard compression for project import/export, PyQt6 migration.
- **3.1.0 alpha**: dark style, revamped web interface, GNS3 Copilot AI agent back-end. Treat it as unstable.
- **GUI and server versions must be compatible.** Minor versions can interact, but mixing major versions will not work.

---

## C2. Installation

### Windows

1. Download the **GNS3 all-in-one installer** from gns3.com (login required).
2. Run it. Keep the bundled components ticked: Dynamips, VPCS, Npcap, Wireshark, a console client (PuTTY or SolarPuTTY), and optionally the GNS3 VM.
3. Finish, then launch **GNS3**. The **Setup Wizard** opens.

### Linux (Ubuntu example)

```bash
sudo add-apt-repository ppa:gns3/ppa
sudo apt update
sudo apt install gns3-gui gns3-server
```
You also need: `ubridge`, `dynamips`, `vpcs`, and `qemu-kvm` + `libvirt`. Add your user to the `ubridge`, `libvirt`, `kvm`, `wireshark` (and `docker` if used) groups, then log out and back in.

### macOS

Install the **GNS3 `.dmg`**. Preferences are under **GNS3 → Preferences** instead of **Edit → Preferences**.

---

## C3. First-run Setup Wizard

1. **Server type** — choose one:
   - **Run modular simulation on the local computer** (Dynamips/VPCS/IOU only, not for big QEMU labs).
   - **Run appliances in a virtual machine (GNS3 VM)**: *recommended* for QEMU, KVM and Docker.
   - **Run appliances on a remote server**.
2. **Local server settings**: host binding (`127.0.0.1` by default), port **3080**.
3. **GNS3 VM settings**: virtualization engine (VMware Workstation/Player/Fusion, VirtualBox, Hyper-V, ESXi), **vCPUs and RAM**.
4. **Summary → Finish**.

> You can re-run it any time from **Help → Setup Wizard**.

---

## C4. The interface layout

| Area | Contents |
|---|---|
| **Menu bar** | File, Edit, View, Control, Node, Annotate, Tools, Help. |
| **Top toolbar** | New/Open/Save, Snapshots, Start / Suspend / Stop / Reload all nodes, **Console connect to all**, Add note, Insert image, Draw rectangle/ellipse/line, **Show/hide interface labels**, Zoom, Screenshot, Lock items. |
| **Left device bar** | **Browse routers**, **switches**, **end devices**, **security devices**, **All devices**, and the **Add a link** tool. |
| **Center canvas** | The topology workspace. |
| **Right panes** | **Topology Summary** (status of all nodes), **Servers Summary** (CPU/RAM per server), **Compute Summary**, **Console** (GNS3 command shell). |
| **Bottom** | **Console** with the `gns3 =>` prompt. |

### Useful shortcuts

- Mouse wheel (with Ctrl) or the Zoom buttons: zoom.
- Hold **Alt** while dragging to **ignore snap-to-grid** (added in 2.2.46).
- **Ctrl+C** copies a status-bar message.

---

## C5. Projects

### Create a project

1. **File → New blank project** (or the New icon).
2. Enter a **Name** and choose a **Location**.
3. Click **OK**. The canvas opens.

### Open, save, export and import

| Task | Where |
|---|---|
| Open project | **File → Open project** (or the recent list). |
| Save as | **File → Save project as…** |
| **Export portable project** | **File → Export portable project…** Options: include **base images**, include **snapshots**, choose the **compression** type. |
| **Import portable project** | **File → Import portable project…** |
| Delete project | In the Projects dialog, select it, then **Delete**. |

> Project files live in a `GNS3/projects/<name>/` folder. The `.gns3` file is JSON describing nodes, links and drawings.

### Snapshots

Snapshots capture the whole project state (configs and disks), so you can roll back after a bad change.

1. Open the **Snapshots** dialog (toolbar icon, or via the File/Edit menu depending on version).
2. Click **Create**, enter a name, click **OK**.
3. To roll back, select a snapshot and click **Restore**.

> Note: a 3.1.0 alpha release lists a fix for "snapshot restore does not work after export/import of project", which suggests older versions had a bug there. Test your restore before relying on it.

---

## C6. Adding devices (templates)

### Drag and drop

1. Click a category in the left bar (**Browse routers / switches / end devices / security devices**), or **All devices**.
2. **Drag** a template onto the canvas.

### Search

In the **All devices** pane, type in the search box to filter by name.

### Built-in nodes (always available)

| Node | What it does |
|---|---|
| **VPCS** | Very lightweight virtual PC with simple commands (`ip`, `ping`, `trace`, `save`). |
| **Ethernet switch** | Simple L2 switch; per-port **access / dot1q / qinq** and VLAN settings. |
| **Ethernet hub** | Repeats frames to all ports. |
| **Cloud** | Bridges the lab to real NICs, TAP interfaces and UDP tunnels. |
| **NAT** | Gives the lab internet access through a NAT interface on the GNS3 VM/server. |
| **Frame Relay / ATM switch** | Legacy WAN switching. |

### Creating or importing a template

**Edit → Preferences** (or **File → New template**) offers:

- **Install an appliance from the GNS3 server**: pick a vendor appliance from the appliance list.
- **Import an appliance file (.gns3a)**: load a downloaded appliance definition.
- **Manually create a template**: Dynamips IOS router, IOU, QEMU VM, VirtualBox VM, VMware VM, Docker container, or built-in.

---

## C7. Installing a vendor appliance (.gns3a) — step by step

This is the workflow for something like a Juniper vSRX or vJunos image:

1. **File → Import appliance** and pick the `.gns3a`. (Or **New template → Install an appliance from the GNS3 server**.)
2. Choose **where to run it**: GNS3 VM or local (the GNS3 VM is recommended for QEMU).
3. The wizard lists **required files** and shows each as **Found**, **Missing**, or **Downloadable**.
4. For missing files, **Import** the image you downloaded from the vendor (for Juniper you need a Juniper account). GNS3 checks the **checksum**.
5. Pick the **QEMU binary** if prompted (e.g. `qemu-system-x86_64`).
6. Review **RAM, vCPUs and adapters**, then **Finish**.
7. The new template appears in the device bar.

> In 3.0.x there is also an **Image manager** to upload images for Dynamips, QEMU and IOU. Templates can be created automatically after upload.

---

## C8. Template types and their options

### C8.1 Dynamips (Cisco IOS routers)

**Edit → Preferences → Dynamips → IOS routers → New**

Fields: IOS image (`.image` or `.bin`, unzipped), name, **platform** (c1700/c2600/c2691/c3600/c3725/c3745/c7200), **memory**, **network adapters/slots**, **WIC modules**, **Idle-PC** value.

Important options:

- **Idle-PC**: the key to stopping IOS routers from eating 100% CPU. Right-click a running router → **Idle-PC** or **Auto Idle-PC**.
- **Sparse memory**, **ghost IOS** (shares memory across routers), **NVRAM**, **disk0/disk1**.
- **Startup config / Private config**.

### C8.2 IOU / IOL

- Requires an **IOU/IOL image** (64-bit only now) and an `iourc` licence file configured in **Preferences → IOS on UNIX**.
- Types: **L2** (switch) and **L3** (router).
- 3.1.0 alpha notes **32-bit IOU images are no longer supported** in the GNS3 VM.

### C8.3 QEMU VMs

**Edit → Preferences → QEMU VMs → New**

| Option | Notes |
|---|---|
| **Name, QEMU binary** | Pick `qemu-system-x86_64` for most network images. |
| **RAM / vCPUs** | Match the vendor sizing guide. |
| **Disk image** | `.qcow2`, `.vmdk`, `.img`. |
| **Boot priority** | HDD / CD-ROM / network. |
| **Adapters** | Number of NICs and **type** (`e1000`, `virtio-net-pci`, `vmxnet3` …). |
| **Console type** | telnet, VNC, SPICE, etc. |
| **Linked clones** | Many nodes share one base image, which saves disk. |
| **KVM acceleration** | Needs the GNS3 VM or Linux with nested virtualization. |
| **Custom options** | Extra QEMU CLI arguments for special images. |

### C8.4 Docker

- Choose an **image** (pulled from Docker Hub or local).
- Set **start command**, **adapters**, **environment variables**, **extra volumes**, and **console type** (telnet / VNC / HTTP / HTTPS).
- Needs Docker in the GNS3 VM or on the Linux server.

### C8.5 VirtualBox / VMware

- Pick an existing VM, enable **Use as a linked base VM** if wanted, set the number of adapters.
- You may need **VMware VIX** or **vmrun** configured for VMware.

---

## C9. Building a topology

1. Drag devices onto the canvas.
2. Click **Add a link** (the plug icon) in the left bar.
3. Click device A, then choose the **interface** from the popup list.
4. Click device B and choose its interface. The link is drawn.
5. Press **Esc** or click the **Add a link** tool again to leave link mode.

### Link options (right-click a link)

- **Start capture**: choose the data link type, then GNS3 offers to open **Wireshark** live.
- **Stop capture**, **Start Wireshark**.
- **Suspend / Resume** a link, to simulate a cable pull.
- **Packet filters**: **frequency drop**, **packet loss (%)**, **delay and jitter**, **corrupt packets**, **custom BPF filter**. Useful for testing failover and QoS.
- **Delete**.

### Layout aids

- **View → Snap to grid**, **Show/hide layers**, **Lock/unlock items**.
- **Raise / lower layer** (right-click a node).
- **Show/hide interface labels** (toolbar), and drag the labels so they don't overlap.

---

## C10. Controlling devices

### Start, stop and consoles

| Action | How |
|---|---|
| **Start one node** | Right-click → **Start**. |
| **Start all** | Green play icon in the top toolbar. |
| **Suspend / Stop / Reload** | Right-click, or the toolbar icons. |
| **Open console** | Double-click a node, or right-click → **Console**. |
| **Open all consoles** | Toolbar **Console connect to all devices**. Newer GUI versions open them in case-insensitive name order. |
| **Aux console** | Right-click → **Auxiliary console** (Dynamips). |
| **Web console** | Right-click → **Web console**, which opens in the browser. |
| **Auto start console** | Right-click → **Auto start console** (the console opens when the node starts). |
| **Reset all console connections** | Added in the 2.2 series, for stuck telnet sessions. |

### Right-click node menu (typical)

Console, Auxiliary console, Start/Suspend/Stop/Reload, **Configure** (opens the node's settings), **Edit config** (startup config for some node types), **Change hostname**, **Change symbol**, **Duplicate**, **Idle-PC** (Dynamips), **Packet capture**, **Show in file manager**, **Raise/Lower layer**, **Delete**.

### Console client

**Edit → Preferences → General → Console applications**: choose PuTTY, SecureCRT, MobaXterm, Windows Terminal, Terminal.app, or a custom command. You can also set **VNC** and **SPICE** viewers there.

---

## C11. Configuring built-in nodes

### VPCS

```
PC1> ip 192.168.1.10/24 192.168.1.1
PC1> ping 192.168.1.1
PC1> save
```

### Ethernet switch (right-click → Configure)

- Set each port's **type** (access, dot1q trunk, qinq), **VLAN** and **EtherType**.
- Ports can be renamed. Only switch VLAN-tagged traffic as the ports are configured.

### Cloud (connect to your real network)

1. Drag a **Cloud** node onto the canvas.
2. Right-click → **Configure → Ethernet interfaces** and tick the host NIC (or a **TAP** or **Loopback** interface).
3. Link a router to the Cloud, choosing that interface.
4. Put the router's interface in the same subnet as the host NIC (or use DHCP).

> **Windows tip:** use a **Microsoft KM-TEST Loopback adapter** with the Cloud node for stable bridging. Bridging Wi-Fi adapters often fails.

### NAT

Link a router to the **NAT** node, then configure DHCP or a static IP in the `192.168.122.x` range (the default NAT subnet on the GNS3 VM, which is libvirt's). Use it for internet access in labs.

---

## C12. Packet capture and Wireshark

1. Right-click a **link** → **Start capture**.
2. Choose the **data link type** (Ethernet is typical).
3. Choose **Start Wireshark** when prompted, or later right-click → **Start Wireshark**.
4. Captures are saved under the project's `project-files/captures` directory.
5. Configure the packet-capture reader command in **Preferences → Packet capture** (Wireshark path, **live capture** command).

---

## C13. Annotating and documenting

- **Add a note** (toolbar text icon): double-click to edit; set font, colour, rotation.
- **Insert an image**: for logos, floor plans or a custom background.
- **Draw rectangle / ellipse / line**: set border colour, fill, thickness and style.
- **Take a screenshot** (toolbar camera): save the topology as PNG/JPG/SVG.
- **Change symbol** (right-click a node): choose from the symbol library or **import a custom symbol** (SVG/PNG).

---

## C14. GNS3 VM and remote servers

### GNS3 VM

1. Download the VM for your hypervisor (VMware, VirtualBox, Hyper-V, ESXi). On 3.0.x download the matching 3.0 VM.
2. Import the **OVA** into your hypervisor. For VMware, use Workstation Player/Pro or Fusion.
3. In GNS3, go to **Edit → Preferences → GNS3 VM**:
   - Tick **Enable the GNS3 VM**.
   - Choose the **virtualization engine** and **VM name**.
   - Set **vCPUs and RAM** (leave room for the host).
   - Tick **Allocate vCPUs and RAM** if offered.
4. Enable **nested virtualization / KVM** in the hypervisor so QEMU nodes (vSRX, vJunos) run fast.

### Remote servers

**Edit → Preferences → Server → Remote computes → Add**: enter host, port, protocol and credentials. GNS3 can then place nodes on that machine, and load balances in some setups.

> **Note:** a portable project exported from remote servers cannot be re-imported to the original multiple remotes.

---

## C15. Preferences reference (Edit → Preferences)

| Section | What you configure |
|---|---|
| **General** | Paths (projects, images, configs), console and VNC/SPICE apps, packet-capture defaults, **GUI language**, themes, miscellaneous options. A 2.2.46 option resets the GUI state. |
| **Server** | Local server host/port/path to the `gns3server` binary, **remote computes**, **GNS3 VM**. |
| **Packet capture** | Wireshark command and live-capture command. |
| **Built-in** | Cloud, Ethernet hub, Ethernet switch, VPCS templates. |
| **Dynamips** | IOS routers, Idle-PC DB, Dynamips path and port range. |
| **IOS on UNIX** | IOU devices and the `iourc` licence. |
| **QEMU** | QEMU VM templates and binaries. |
| **VirtualBox / VMware** | VM-based templates. |
| **Docker** | Docker container templates. |

---

## C16. Users, permissions and API (3.0+)

- **RBAC**: users, groups, roles, and **resource pools**. Admin creates users, and limits what each can see or modify.
- **Secured API**: authentication enabled, so API calls need a token. (There is an `enable_http_auth` option in the server config sample.)
- **REST API**: base URL `http://<server>:3080/v3/` (and `/v2/` on 2.2.x). Interactive docs are normally served at `/docs`.
- **Python helpers**: community libraries (for example `gns3fy`) wrap the API.

### Automation ideas

1. Start the topology, then use `Netmiko`/`telnetlib` to push configs to console ports.
2. For Junos, use **PyEZ** or **NETCONF** over the management interface.
3. Use **Ansible** with `junipernetworks.junos` against a management network (use a Cloud/NAT node).

---

## C17. Common problems and fixes

| Symptom | Likely cause and fix |
|---|---|
| **QEMU node won't start / KVM error** | Enable nested virtualization (VT-x/AMD-V) on the host, and in VMware tick *Virtualize Intel VT-x/EPT*. On Windows, Hyper-V conflicts with VMware/VirtualBox, so pick one. |
| **Dynamips router at 100% CPU** | Set **Idle-PC** (right-click → Idle-PC). |
| **Console won't open** | Check the console client path in Preferences, firewall, or **reset console connections**. |
| **"Connection to server lost"** | Restart the GNS3 server/VM. Check GUI and server **version match**. |
| **Cloud node doesn't reach the LAN** | Use a loopback/TAP adapter. Wi-Fi bridging is unreliable. |
| **Image checksum error** | Download the exact image version listed in the appliance file. |
| **Lab very slow** | Add vCPUs/RAM to the GNS3 VM, close unused nodes, use linked clones. |
| **Snapshot restore failing after import** | Known issue in older versions. Test, or export a fresh copy of the project. |

---

# Part D — Running Juniper devices inside GNS3

Juniper offers virtual images that you can run in GNS3 or EVE-NG. Typical choices:

| Image | Use |
|---|---|
| **vJunos-switch** | Virtual EX-style switch for L2/L3 lab work. |
| **vJunos-router** | Virtual router (MX-style) for routing/MPLS labs. |
| **vSRX** | Virtual firewall (security zones, policies, NAT, IPsec). |
| **vMX** | Virtual MX router (more complex, usually separate VCP/VFP VMs). |
| **vQFX** | Virtual QFX for data-centre labs (RE and PFE VMs). |
| **cRPD** | Containerised routing protocol daemon (Docker). |

> Resource needs vary by release and image. Check Juniper's download page and release notes for the current RAM/vCPU numbers before you size your GNS3 VM.

## D1. Step by step

1. Create or log in to a **Juniper account**, then open Juniper's **free virtual Junos download** page and download the image for your platform.
2. In GNS3, look for the **Juniper appliance** (`.gns3a`) from the GNS3 appliance list, and use **File → Import appliance**. If your image has no appliance file, create a **QEMU VM template** manually (C8.3).
3. Point the wizard at the downloaded `.qcow2`/`.img` files and let it checksum them.
4. Check the template settings:
   - **vCPUs and RAM** per Juniper guidance.
   - **NIC type** that the image supports (commonly `virtio-net-pci` or `e1000`; read the appliance notes).
   - **Console type** `telnet`.
   - **KVM** acceleration enabled (needs the GNS3 VM or Linux).
5. Drag the node onto the canvas, **start** it, and open its **console**. Boot takes several minutes, so wait for the login prompt.
6. Log in (commonly `root` with no password on first boot for many images; check the appliance notes), then set a root password so you can commit:
   ```
   root@:~ # cli
   root> configure
   root# set system host-name R1
   root# set system root-authentication plain-text-password
   root# set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/24
   root# commit and-quit
   ```
7. Connect nodes with links, and match interface names (`ge-0/0/x`, `xe-0/0/x`) to the GNS3 adapter order.
8. Save your configs with `show configuration | display set`, or use GNS3 snapshots.

### Management access

- Add a **Cloud** or **NAT** node connected to the device's management interface (`fxp0`, `em0` or `ge-0/0/0`, depending on the image) to SSH or use NETCONF from your host.

---

# Part E — vLabs vs GNS3 comparison

| Aspect | Juniper vLabs | GNS3 |
|---|---|---|
| **Cost** | Free (Juniper account) | Free, open source |
| **Hardware needed** | Only a browser | A strong PC or a server (RAM heavy) |
| **Setup time** | About 15 minutes per session | One-time install, then per-lab image import |
| **Topology freedom** | **Fixed**, cannot modify | **Fully custom** |
| **Vendors** | Juniper products only | Multi-vendor (Cisco, Juniper, Arista, Fortinet, Linux, etc.) |
| **Session limit** | Timed (3 h default, up to 6 h) | Unlimited |
| **Persistence** | **Wiped at the end** | Saved on disk, plus snapshots |
| **Real-network bridging** | No external connectivity | Yes (Cloud/NAT nodes) |
| **Packet capture** | Not built in | Built-in Wireshark integration |
| **Best for** | Quick Junos practice, certification prep, Juniper product demos | Custom designs, multi-vendor labs, long-running projects, automation testing |

---

# Part F — Suggested study workflow

1. **Start in vLabs** to see how Junos behaves, with no local setup cost.
2. **Save your configs** as `set` commands in a Git repo as you go.
3. **Rebuild the same scenario in GNS3** with vJunos or vSRX images, so you can change the topology, break things, and capture packets.
4. Use **snapshots** before every risky change.
5. Add **automation** (PyEZ, Netmiko, Ansible) against the GNS3 management network once the manual labs feel comfortable.

---

*Official sources used: Juniper vLabs User Guide v1.7 and FAQ (`jlabs.juniper.net`), Juniper community threads, Juniper's vJunos labs download page, the GNS3 3.0/2.2 release notes and the GNS3 GUI release page. Re-check them for UI changes, since vLabs and GNS3 both update their interfaces.*
