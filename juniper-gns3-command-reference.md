# Juniper (Junos) & GNS3 — Command Reference with Sample Outputs

> **Read this first.**
> - This is the companion to `juniper-vlabs-and-gns3-feature-guide.md`.
> - **Outputs are representative samples, not captures from a live device.** Exact text varies with Junos/GNS3 version, hostname, interface names and timers. Use them to know *what shape of output to expect*, not to string-match.
> - Junos prompts: `user@R1>` = operational mode, `user@R1#` = configuration mode. Root prompts look like `root@R1>`.
> - A trailing `?` in Junos shows context help. `Tab` completes. `Space` completes a command word.

## Contents

1. [Junos: CLI basics and modes](#1-junos-cli-basics-and-modes)
2. [Junos: operational `show` commands](#2-junos-operational-show-commands)
3. [Junos: configuration mode and commit model](#3-junos-configuration-mode-and-commit-model)
4. [Junos: interfaces, IP, VLANs, switching](#4-junos-interfaces-ip-vlans-switching)
5. [Junos: routing (static, OSPF, IS-IS, BGP, policy)](#5-junos-routing)
6. [Junos: MPLS / LDP basics](#6-junos-mpls--ldp-basics)
7. [Junos: SRX / vSRX security](#7-junos-srx--vsrx-security)
8. [Junos: system, users, services, NTP, SNMP, syslog](#8-junos-system-users-services)
9. [Junos: files, backup, restore, rescue config](#9-junos-files-backup-restore)
10. [Junos: troubleshooting tools](#10-junos-troubleshooting-tools)
11. [Junos: automation (NETCONF, PyEZ, Ansible)](#11-junos-automation)
12. [vLabs: client-side commands](#12-vlabs-client-side-commands)
13. [GNS3: VPCS commands](#13-gns3-vpcs-commands)
14. [GNS3: built-in console (`gns3 =>`)](#14-gns3-built-in-console)
15. [Cisco IOS commands for Dynamips/IOU nodes](#15-cisco-ios-commands-for-dynamipsiou-nodes)
16. [GNS3: server and Linux/GNS3 VM commands](#16-gns3-server-and-linuxgns3-vm-commands)
17. [GNS3: QEMU, KVM and disk-image commands](#17-gns3-qemu-kvm-and-disk-image-commands)
18. [GNS3: Docker commands](#18-gns3-docker-commands)
19. [GNS3: REST API with curl](#19-gns3-rest-api-with-curl)
20. [Quick cheat sheet](#20-quick-cheat-sheet)

---

# 1. Junos CLI basics and modes

## 1.1 Logging in and entering the CLI

On many virtual images you first land in the FreeBSD/Linux shell as `root` and must start the Junos CLI:

```
root@:~ # cli
root>
```

Enter configuration mode and leave it:

```
root> configure
Entering configuration mode

[edit]
root# exit
Exiting configuration mode

root>
```

Other ways in:

```
root> configure exclusive          ! lock the candidate config for you only
root> configure private            ! your own private copy of the config
root> edit                         ! same as configure inside some contexts
```

Leave the CLI back to shell:

```
root> exit
root@:~ #
```

Drop to a shell from the CLI:

```
root> start shell
root@:~ #
root@:~ # exit
root>
```

## 1.2 Help and completion

```
root> ?
Possible completions:
  clear                Clear information in the system
  configure            Manipulate software configuration information
  file                 Perform file operations
  help                 Provide help information
  monitor              Show real-time debugging information
  ping                 Ping remote target
  quit                 Exit the management session
  request              Make system-level requests
  restart              Restart software process
  set                  Set CLI properties, date/time, craft interface message
  show                 Show system information
  ssh                  Open SSH connection
  start                Start shell
  telnet               Telnet to another host
  test                 Perform diagnostic debugging
  traceroute           Trace route to remote host
```

```
root> show ?                       ! lists everything under "show"
root> show interfaces ?            ! lists options under that command
root> help topic ospf area         ! documentation for a statement
root> help reference ospf area     ! reference text
```

## 1.3 CLI output filters (pipe)

These work after any command:

```
show configuration | display set          ! show config as 'set' commands
show configuration | display set | no-more ! no paging
show configuration | display json         ! JSON output
show configuration | display xml          ! XML output
show interfaces terse | match ge-         ! lines matching a regex
show interfaces terse | except down       ! lines NOT matching
show route | count                         ! count output lines
show route | find 10.0.0                   ! start output at first match
show log messages | last 20                ! last 20 lines
show log messages | trim 5                 ! cut first 5 columns
show version | save /var/tmp/ver.txt       ! save output to file
show interfaces | resolve                  ! resolve IPs to names
show interfaces terse | refresh 2          ! refresh every 2 seconds
show configuration | compare /var/tmp/old.conf
```

Sample:

```
root> show interfaces terse | match "ge-0/0/0|lo0"
ge-0/0/0                up    up
ge-0/0/0.0              up    up   inet     10.0.12.1/24
lo0                     up    up
lo0.0                   up    up   inet     1.1.1.1             --> 0/0
```

## 1.4 CLI settings

```
root> set cli screen-length 0        ! disable paging
root> set cli screen-width 200
root> set cli timestamp              ! show timestamps on commands
root> show cli                        ! show current CLI settings
root> show cli history 10             ! last 10 commands
```

Sample:

```
root> show cli
CLI complete-on-space set to on
CLI idle-timeout disabled
CLI restart-on-upgrade set to on
CLI screen-length set to 0
CLI screen-width set to 200
CLI terminal is 'xterm-256color'
CLI is operating in enhanced mode
CLI timestamp disabled
CLI working directory is '/cf/var/home/root'
```

---

# 2. Junos operational `show` commands

## 2.1 System information

```
root> show version
Hostname: R1
Model: vmx
Junos: 23.2R1.13
JUNOS OS Kernel 64-bit  [20230621.da75f28_builder_stable_11]
JUNOS OS libs [...]
JUNOS runtime [...]
JUNOS Routing Software Suite [...]
```

```
root> show system uptime
Current time: 2026-10-30 10:02:11 UTC
Time Source:  LOCAL CLOCK
System booted: 2026-10-30 09:41:50 UTC (00:20:21 ago)
Protocols started: 2026-10-30 09:43:07 UTC (00:19:04 ago)
Last configured: 2026-10-30 09:58:30 UTC (00:03:41 ago) by root
10:02AM  up 20 mins, 1 user, load averages: 0.12, 0.09, 0.05
```

```
root> show system information
Model: vmx
Family: junos
Junos: 23.2R1.13
Hostname: R1
```

```
root> show system users
 10:02AM  up 20 mins, 1 user, load averages: 0.12, 0.09, 0.05
USER     TTY      FROM                              LOGIN@  IDLE WHAT
root     u0       -                                9:45AM     - -cli (cli)
```

```
root> show system processes extensive
root> show system processes summary
root> show system memory
root> show system storage
```

```
root> show system storage
Filesystem              Size       Used      Avail  Capacity   Mounted on
/dev/gpt/junos          2.6G       1.2G       1.2G       51%   /
devfs                   1.0K       1.0K         0B      100%   /dev
/dev/md0                 94M        94M         0B      100%   /packages/mnt/jbase
```

```
root> show chassis hardware
root> show chassis routing-engine
root> show chassis alarms
root> show system alarms
root> show system core-dumps
root> show system commit
root> show system rollback 1
root> show system license
root> show system connections
root> show system statistics
```

Sample `show system commit`:

```
0   2026-10-30 09:58:30 UTC by root via cli
1   2026-10-30 09:50:12 UTC by root via cli
2   2026-10-30 09:44:01 UTC by root via cli
```

## 2.2 Interfaces

```
root> show interfaces terse
Interface               Admin Link Proto    Local                 Remote
ge-0/0/0                up    up
ge-0/0/0.0              up    up   inet     10.0.12.1/24
                                   multiservice
ge-0/0/1                up    down
ge-0/0/2                up    down
fxp0                    up    up
fxp0.0                  up    up   inet     192.168.122.11/24
lo0                     up    up
lo0.0                   up    up   inet     1.1.1.1             --> 0/0
```

```
root> show interfaces ge-0/0/0 terse
root> show interfaces ge-0/0/0
root> show interfaces ge-0/0/0 extensive
root> show interfaces ge-0/0/0 statistics
root> show interfaces descriptions
root> show interfaces brief
root> show interfaces diagnostics optics ge-0/0/0     ! optics only on hardware
root> show interfaces queue ge-0/0/0
root> show interfaces routing
```

Sample `show interfaces ge-0/0/0`:

```
Physical interface: ge-0/0/0, Enabled, Physical link is Up
  Interface index: 148, SNMP ifIndex: 526
  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps, BPDU Error: None,
  Loopback: Disabled, Source filtering: Disabled, Flow control: Enabled
  Device flags   : Present Running
  Interface flags: SNMP-Traps Internal: 0x4000
  Current address: 50:00:00:03:00:00, Hardware address: 50:00:00:03:00:00
  Last flapped   : 2026-10-30 09:43:20 UTC (00:19:00 ago)
  Input rate     : 0 bps (0 pps)
  Output rate    : 0 bps (0 pps)

  Logical interface ge-0/0/0.0 (Index 332) (SNMP ifIndex 527)
    Flags: Up SNMP-Traps 0x4004000 Encapsulation: ENET2
    Input packets : 213
    Output packets: 220
    Protocol inet, MTU: 1500
      Flags: Sendbcast-pkt-to-re
      Addresses, Flags: Is-Preferred Is-Primary
        Destination: 10.0.12/24, Local: 10.0.12.1, Broadcast: 10.0.12.255
```

## 2.3 ARP, MAC, LLDP, neighbours

```
root> show arp
MAC Address       Address         Name                      Interface           Flags
50:00:00:04:00:00 10.0.12.2       10.0.12.2                 ge-0/0/0.0          none
Total entries: 1
```

```
root> show arp no-resolve
root> show ipv6 neighbors
root> show ethernet-switching table          ! on EX/QFX/vJunos-switch
root> show lldp neighbors
root> show lldp
```

Sample `show lldp neighbors`:

```
Local Interface    Parent Interface    Chassis Id          Port info          System Name
ge-0/0/0           -                   50:00:00:04:00:00   ge-0/0/0           R2
```

Sample `show ethernet-switching table`:

```
MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Persistent static
           SE - statistically enabled, NM - non configured MAC, R - remote PE MAC, O - ovsdb MAC)

Ethernet switching table : 2 entries, 2 learned
Routing instance : default-switch
    Vlan                MAC                 MAC       Logical          Active
    name                address             flags     interface        source
    v10                 00:50:79:66:68:00   D         ge-0/0/1.0
    v10                 00:50:79:66:68:01   D         ge-0/0/2.0
```

## 2.4 Routing table

```
root> show route
inet.0: 5 destinations, 5 routes (5 active, 0 holddown, 0 hidden)
+ = Active Route, - = Last Active, * = Both

1.1.1.1/32         *[Direct/0] 00:19:02
                    >  via lo0.0
2.2.2.2/32         *[OSPF/10] 00:03:20, metric 1
                    >  to 10.0.12.2 via ge-0/0/0.0
10.0.12.0/24       *[Direct/0] 00:19:00
                    >  via ge-0/0/0.0
10.0.12.1/32       *[Local/0] 00:19:00
                      Local via ge-0/0/0.0
224.0.0.5/32       *[OSPF/10] 00:19:03, metric 1
                       MultiRecv
```

More route commands:

```
root> show route 2.2.2.2
root> show route 2.2.2.2 exact
root> show route 2.2.2.2 detail
root> show route protocol ospf
root> show route protocol bgp
root> show route protocol static
root> show route table inet.0
root> show route table inet6.0
root> show route table mpls.0
root> show route table bgp.l3vpn.0
root> show route summary
root> show route forwarding-table
root> show route forwarding-table destination 2.2.2.2
root> show route receive-protocol bgp 10.0.12.2
root> show route advertising-protocol bgp 10.0.12.2
root> show route best 8.8.8.8
root> show route hidden
root> show route instance
root> show route active-path
root> show route terse
```

Sample `show route summary`:

```
Autonomous system number: 65001
Router ID: 1.1.1.1

inet.0: 5 destinations, 5 routes (5 active, 0 holddown, 0 hidden)
              Direct:      2 routes,      2 active
               Local:      2 routes,      2 active
                OSPF:      1 routes,      1 active
```

Sample `show route 2.2.2.2 detail`:

```
inet.0: 5 destinations, 5 routes (5 active, 0 holddown, 0 hidden)
2.2.2.2/32 (1 entry, 1 announced)
        *OSPF   Preference: 10
                Next hop type: Router, Next hop index: 590
                Address: 0xb0e4dd0
                Next-hop reference count: 4
                Next hop: 10.0.12.2 via ge-0/0/0.0, selected
                State: <Active Int>
                Age: 3:41       Metric: 1
                Validation State: unverified
                Area: 0.0.0.0
                Task: OSPF
                Announcement bits (2): 0-KRT 2-Resolve tree 3
                AS path: I
```

## 2.5 OSPF

```
root> show ospf neighbor
Address          Interface              State           ID               Pri  Dead
10.0.12.2        ge-0/0/0.0             Full            2.2.2.2          128    33
```

```
root> show ospf neighbor detail
root> show ospf interface
root> show ospf interface detail
root> show ospf database
root> show ospf database router
root> show ospf database lsa-id 1.1.1.1 extensive
root> show ospf route
root> show ospf statistics
root> show ospf overview
root> show ospf log
root> show ospf io-statistics
root> show ospf3 neighbor                    ! OSPFv3 for IPv6
```

Sample `show ospf interface`:

```
Interface           State   Area            DR ID           BDR ID          Nbrs
ge-0/0/0.0          BDR     0.0.0.0         2.2.2.2         1.1.1.1            1
lo0.0               DR      0.0.0.0         1.1.1.1         0.0.0.0            0
```

Sample `show ospf database`:

```
    OSPF database, Area 0.0.0.0
 Type       ID               Adv Rtr           Seq      Age  Opt  Cksum  Len
Router  *1.1.1.1          1.1.1.1          0x80000004   180  0x22 0x7d3f  48
Router   2.2.2.2          2.2.2.2          0x80000003   175  0x22 0x6f5c  48
Network *10.0.12.1        1.1.1.1          0x80000001   180  0x22 0x1f1c  32
```

## 2.6 IS-IS

```
root> show isis adjacency
root> show isis adjacency detail
root> show isis interface
root> show isis database
root> show isis database extensive
root> show isis route
root> show isis statistics
root> show isis spf log
```

Sample `show isis adjacency`:

```
Interface             System         L State        Hold (secs) SNPA
ge-0/0/0.0            R2             2  Up                   22
```

## 2.7 BGP

```
root> show bgp summary
Threading mode: BGP I/O
Default eBGP mode: advertise - accept, receive - accept
Groups: 1 Peers: 1 Down peers: 0
Table          Tot Paths  Act Paths Suppressed    History Damp State    Pending
inet.0                 1          1          0          0          0          0
Peer                     AS      InPkt     OutPkt    OutQ   Flaps Last Up/Dwn State|#Active/Received/Accepted/Damped...
10.0.12.2             65002         12         12       0       0        4:55 Establ
  inet.0: 1/1/1/0
```

```
root> show bgp neighbor
root> show bgp neighbor 10.0.12.2
root> show bgp group
root> show bgp group summary
root> show bgp neighbor 10.0.12.2 | match "State|Last"
root> show route protocol bgp
root> show route receive-protocol bgp 10.0.12.2 table inet.0
root> show route advertising-protocol bgp 10.0.12.2
root> show bgp replication
root> show bgp output-scheduler
root> clear bgp neighbor 10.0.12.2
root> clear bgp neighbor 10.0.12.2 soft
root> clear bgp neighbor 10.0.12.2 soft-inbound
```

Sample `show bgp neighbor 10.0.12.2` (trimmed):

```
Peer: 10.0.12.2+179 AS 65002   Local: 10.0.12.1+54321 AS 65001
  Group: EBGP                  Routing-Instance: master
  Forwarding routing-instance: master
  Type: External    State: Established    Flags: <Sync>
  Last State: OpenConfirm   Last Event: RecvKeepAlive
  Last Error: None
  Options: <Preference PeerAS Refresh>
  Holdtime: 90 Preference: 170
  Number of flaps: 0
  Peer ID: 2.2.2.2          Local ID: 1.1.1.1           Active Holdtime: 90
  Keepalive Interval: 30         Group index: 0    Peer index: 0    SNMP index: 0
  Local Interface: ge-0/0/0.0
  NLRI for restart configured on peer: inet-unicast
  NLRI advertised by peer: inet-unicast
  NLRI for this session: inet-unicast
  Peer supports Refresh capability (2)
  Table inet.0 Bit: 20000
    RIB State: BGP restart is complete
    Send state: in sync
    Active prefixes:              1
    Received prefixes:            1
    Accepted prefixes:            1
    Suppressed due to damping:    0
    Advertised prefixes:          1
```

## 2.8 Other protocols and services

```
root> show rip neighbor
root> show ldp neighbor
root> show ldp session
root> show ldp database
root> show mpls interface
root> show mpls lsp
root> show rsvp session
root> show bfd session
root> show vrrp summary
root> show vrrp brief
root> show igmp group
root> show pim neighbors
root> show multicast route
root> show dhcp server binding
root> show dhcp relay binding
root> show ntp associations
root> show ntp status
root> show snmp statistics
root> show log messages
root> show log chassisd
root> show log ospf-trace
root> show log | last 50
root> show spanning-tree bridge
root> show spanning-tree interface
root> show vlans
root> show lacp interfaces
root> show interfaces ae0 terse
root> show firewall
root> show policer
root> show class-of-service
```

Sample `show vlans`:

```
Routing instance        VLAN name             Tag          Interfaces
default-switch          default               1
default-switch          v10                   10
                                                           ge-0/0/1.0*
                                                           ge-0/0/2.0*
```

Sample `show ntp associations`:

```
     remote           refid      st t when poll reach   delay   offset  jitter
==============================================================================
*10.0.0.1        .GPS.            1 u   32   64  377    0.612    0.045   0.021
```

Sample `show vrrp brief`:

```
Interface     State       Group   VR state VR Mode   Timer    Type   Address
ge-0/0/1.0    up              1   master   Active      A  0.123 lcl    10.0.20.2
                                                                vip    10.0.20.1
```

---

# 3. Junos configuration mode and commit model

## 3.1 Concepts

Junos keeps **three** configuration states: **active** (running), **candidate** (what you are editing) and **rollback** copies (up to 50 stored: `rollback 0..49`). Nothing takes effect until you `commit`.

## 3.2 Navigating the hierarchy

```
root> configure
Entering configuration mode

[edit]
root# edit interfaces ge-0/0/0

[edit interfaces ge-0/0/0]
root# up                         ! one level up
[edit interfaces]
root# top                        ! to the top
[edit]
root# edit protocols ospf
[edit protocols ospf]
root# exit configuration-mode
```

```
root# show                       ! show config at current level
root# show | display set         ! show as set commands
root# show interfaces
root# run show interfaces terse  ! run an operational command from config mode
root# status                     ! who else is editing
root# exit
```

## 3.3 Setting, deleting and editing values

```
root# set system host-name R1
root# set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/24
root# delete interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/24
root# delete protocols ospf
root# rename interfaces ge-0/0/0 to ge-0/0/5
root# copy interfaces ge-0/0/0 to ge-0/0/1
root# insert policy-options policy-statement P1 term T1 before term T2
root# deactivate protocols ospf              ! keep config but disable it
root# activate protocols ospf
root# annotate interfaces ge-0/0/0 "Link to R2"
root# protect interfaces ge-0/0/0            ! make it read-only
root# unprotect interfaces ge-0/0/0
```

Wildcard operations:

```
root# wildcard delete interfaces ge-0/0/[0-3]
root# delete interfaces ge-0/0/*
```

## 3.4 Checking and committing

```
root# commit check
configuration check succeeds

root# commit
commit complete

root# commit and-quit
commit complete
Exiting configuration mode

root# commit comment "Added OSPF to ge-0/0/0"
commit complete

root# commit confirmed 5
commit confirmed will be automatically rolled back in 5 minutes unless confirmed
commit complete

# Re-confirm within 5 min:
root# commit
commit complete

root# commit at "2026-10-30 23:00:00"
commit at will be executed at 2026-10-30 23:00:00 UTC
Exiting configuration mode

root# commit synchronize                     ! dual-RE devices
root# commit full                            ! all processes re-evaluate config
root# commit | display detail
```

> **Safety tip:** use `commit confirmed 5` when changing management interfaces or routing over a remote SSH session. If you lose access, the router reverts on its own.

### Commit errors (sample)

```
root# commit
[edit protocols ospf area 0.0.0.0]
  'interface ge-0/0/9.0'
    Interface ge-0/0/9.0 not found
error: configuration check-out failed
```

```
[edit system]
  'root-authentication'
    WARNING: Root password not configured
error: commit failed
```

## 3.5 Compare, rollback and history

```
root# show | compare
[edit interfaces]
+   ge-0/0/1 {
+       unit 0 {
+           family inet {
+               address 10.0.13.1/24;
+           }
+       }
+   }
```

```
root# show | compare rollback 1
root# rollback ?
Possible completions:
  <[Enter]>            Execute this command
  0                    2026-10-30 09:58:30 UTC by root via cli
  1                    2026-10-30 09:50:12 UTC by root via cli
  2                    2026-10-30 09:44:01 UTC by root via cli

root# rollback 1
load complete
root# commit
commit complete
```

```
root# rollback 0                    ! discard uncommitted changes
root# rollback rescue               ! load rescue configuration
```

## 3.6 Loading configuration

```
root# load override /var/tmp/R1.conf           ! replace entire config
root# load merge /var/tmp/R1-add.conf          ! merge in
root# load replace /var/tmp/R1-patch.conf      ! replace matching stanzas (needs 'replace:' tags)
root# load set /var/tmp/R1.set                 ! set-format file
root# load set terminal                        ! paste set commands, finish with Ctrl+D
[Type ^D at a new line to end input]
set system host-name R1
set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/24
^D
load complete
```

Load from a remote host:

```
root# load override scp://user@192.168.122.1/path/R1.conf
root# load merge ftp://192.168.122.1/R1.conf
```

## 3.7 Configuration groups and apply-groups

```
root# set groups COMMON system services ssh
root# set groups COMMON system login message "Authorized use only"
root# set apply-groups COMMON
root# show | display inheritance
```

## 3.8 Locking

```
root> configure exclusive
warning: uncommitted changes will be discarded on exit
Entering configuration mode
```

```
root# status
Users currently editing the configuration:
  root (pid 1280) on since 2026-10-30 09:58:30 UTC, idle 00:00:10
      [edit]
```

---

# 4. Junos interfaces, IP, VLANs, switching

## 4.1 Basic interface and IP configuration

```
set system host-name R1
set interfaces ge-0/0/0 description "to R2"
set interfaces ge-0/0/0 unit 0 family inet address 10.0.12.1/24
set interfaces lo0 unit 0 family inet address 1.1.1.1/32
set interfaces ge-0/0/0 mtu 9192
set interfaces ge-0/0/1 disable
delete interfaces ge-0/0/1 disable
```

IPv6:

```
set interfaces ge-0/0/0 unit 0 family inet6 address 2001:db8:12::1/64
```

DHCP client (management):

```
set interfaces fxp0 unit 0 family inet dhcp
```

Sub-interfaces with VLAN tags (router-on-a-stick):

```
set interfaces ge-0/0/1 vlan-tagging
set interfaces ge-0/0/1 unit 10 vlan-id 10
set interfaces ge-0/0/1 unit 10 family inet address 10.0.10.1/24
set interfaces ge-0/0/1 unit 20 vlan-id 20
set interfaces ge-0/0/1 unit 20 family inet address 10.0.20.1/24
```

## 4.2 Switching (ELS syntax: EX/QFX/vJunos-switch)

```
set vlans v10 vlan-id 10
set vlans v20 vlan-id 20

# Access port
set interfaces ge-0/0/1 unit 0 family ethernet-switching interface-mode access
set interfaces ge-0/0/1 unit 0 family ethernet-switching vlan members v10

# Trunk port
set interfaces ge-0/0/0 unit 0 family ethernet-switching interface-mode trunk
set interfaces ge-0/0/0 unit 0 family ethernet-switching vlan members [ v10 v20 ]
set interfaces ge-0/0/0 native-vlan-id 1

# SVI (routed VLAN interface)
set interfaces irb unit 10 family inet address 10.0.10.1/24
set vlans v10 l3-interface irb.10
```

Verify:

```
root> show vlans
root> show ethernet-switching interface
root> show ethernet-switching table
root> show interfaces irb terse
```

Sample `show ethernet-switching interface`:

```
Routing Instance Name : default-switch
Logical Interface flags (DL - disable learning, AD - packet action drop,
                         LH - MAC limit hit, DN - interface down,
                         MMAS - Mac-move action shutdown, AS - Autostate-exclude enabled,
                         SCTL - shutdown by Storm-control)

Logical          Vlan    TAG    MAC    STP    Logical          Tagging
interface        members        limit  state  interface flags
ge-0/0/0.0                      16383         
                 v10     10     16383  Forwarding             tagged
                 v20     20     16383  Forwarding             tagged
ge-0/0/1.0                      16383         
                 v10     10     16383  Forwarding             untagged
```

## 4.3 Spanning tree, LAG, LACP

```
set protocols rstp interface all
set protocols rstp bridge-priority 4k
set protocols rstp interface ge-0/0/1 edge

set chassis aggregated-devices ethernet device-count 1
set interfaces ge-0/0/2 gigether-options 802.3ad ae0
set interfaces ge-0/0/3 gigether-options 802.3ad ae0
set interfaces ae0 aggregated-ether-options lacp active
set interfaces ae0 unit 0 family inet address 10.0.50.1/30
```

```
root> show spanning-tree bridge
root> show lacp interfaces
```

## 4.4 DHCP server and VRRP

```
set system services dhcp-local-server group POOL1 interface irb.10
set access address-assignment pool P10 family inet network 10.0.10.0/24
set access address-assignment pool P10 family inet range R1 low 10.0.10.100 high 10.0.10.200
set access address-assignment pool P10 family inet dhcp-attributes router 10.0.10.1

set interfaces ge-0/0/1 unit 0 family inet address 10.0.20.2/24 vrrp-group 1 virtual-address 10.0.20.1
set interfaces ge-0/0/1 unit 0 family inet address 10.0.20.2/24 vrrp-group 1 priority 110
set interfaces ge-0/0/1 unit 0 family inet address 10.0.20.2/24 vrrp-group 1 accept-data
```

---

# 5. Junos routing

## 5.1 Static routes

```
set routing-options static route 0.0.0.0/0 next-hop 10.0.12.2
set routing-options static route 192.168.50.0/24 next-hop 10.0.12.2
set routing-options static route 192.168.60.0/24 discard
set routing-options static route 192.168.70.0/24 reject
set routing-options static route 0.0.0.0/0 next-hop 10.0.12.2 preference 200   ! floating static
set routing-options router-id 1.1.1.1
set routing-options autonomous-system 65001
```

```
root> show route protocol static
inet.0: 6 destinations, 6 routes (6 active, 0 holddown, 0 hidden)
+ = Active Route, - = Last Active, * = Both

0.0.0.0/0          *[Static/5] 00:00:07
                    >  to 10.0.12.2 via ge-0/0/0.0
```

## 5.2 OSPF

```
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0
set protocols ospf area 0.0.0.0 interface lo0.0 passive
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 interface-type p2p
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 metric 10
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 authentication md5 1 key "secret"
set protocols ospf reference-bandwidth 100g
set protocols ospf export EXPORT-STATIC
set protocols ospf area 0.0.0.1 stub
set protocols ospf area 0.0.0.1 nssa
set protocols ospf area 0.0.0.0 area-range 10.0.0.0/16
```

OSPFv3:

```
set protocols ospf3 area 0.0.0.0 interface ge-0/0/0.0
```

## 5.3 IS-IS

```
set interfaces ge-0/0/0 unit 0 family iso
set interfaces lo0 unit 0 family iso address 49.0001.0010.0100.1001.00
set protocols isis interface ge-0/0/0.0 point-to-point
set protocols isis interface lo0.0 passive
set protocols isis level 1 disable
```

## 5.4 BGP

eBGP:

```
set routing-options autonomous-system 65001
set protocols bgp group EBGP type external
set protocols bgp group EBGP peer-as 65002
set protocols bgp group EBGP neighbor 10.0.12.2
set protocols bgp group EBGP export ADVERTISE-LOOPBACK
```

iBGP with loopback peering and next-hop-self:

```
set protocols bgp group IBGP type internal
set protocols bgp group IBGP local-address 1.1.1.1
set protocols bgp group IBGP neighbor 2.2.2.2
set protocols bgp group IBGP export NHS
set protocols bgp group IBGP cluster 1.1.1.1            ! route reflector
```

Policy to advertise a prefix (needed: Junos BGP exports nothing by default except with policy):

```
set policy-options policy-statement ADVERTISE-LOOPBACK term 1 from protocol direct
set policy-options policy-statement ADVERTISE-LOOPBACK term 1 from route-filter 1.1.1.1/32 exact
set policy-options policy-statement ADVERTISE-LOOPBACK term 1 then accept
set policy-options policy-statement NHS term 1 then next-hop self
```

Verify:

```
root> show bgp summary
root> show route advertising-protocol bgp 10.0.12.2
```

Sample:

```
inet.0: 6 destinations, 6 routes (6 active, 0 holddown, 0 hidden)
  Prefix                  Nexthop              MED     Lclpref    AS path
* 1.1.1.1/32              Self                                    I
```

## 5.5 Routing policy and firewall filters

```
set policy-options prefix-list MY-NETS 10.0.0.0/8
set policy-options policy-statement DENY-DEFAULT term 1 from route-filter 0.0.0.0/0 exact
set policy-options policy-statement DENY-DEFAULT term 1 then reject
set policy-options policy-statement DENY-DEFAULT term 2 then accept
set protocols bgp group EBGP import DENY-DEFAULT

set policy-options as-path FROM-AS65002 "65002"
set policy-options community BLUE members 65001:100
set policy-options policy-statement SET-LP term 1 from as-path FROM-AS65002
set policy-options policy-statement SET-LP term 1 then local-preference 200
set policy-options policy-statement SET-LP term 1 then community add BLUE
```

Firewall filter (stateless packet filter):

```
set firewall family inet filter PROTECT-RE term ALLOW-SSH from protocol tcp
set firewall family inet filter PROTECT-RE term ALLOW-SSH from destination-port ssh
set firewall family inet filter PROTECT-RE term ALLOW-SSH then accept
set firewall family inet filter PROTECT-RE term ALLOW-ICMP from protocol icmp
set firewall family inet filter PROTECT-RE term ALLOW-ICMP then accept
set firewall family inet filter PROTECT-RE term DENY-ALL then discard
set interfaces lo0 unit 0 family inet filter input PROTECT-RE
```

> Be careful: a loopback filter that blocks OSPF/BGP/SSH can lock you out. Test with `commit confirmed`.

Test policies:

```
root> test policy DENY-DEFAULT 0.0.0.0/0
inet.0: 6 destinations, 6 routes (6 active, 0 holddown, 0 hidden)
Policy DENY-DEFAULT: 0 prefix accepted, 1 prefix rejected
```

## 5.6 Routing instances (VRF-lite)

```
set routing-instances CUST1 instance-type vrf
set routing-instances CUST1 interface ge-0/0/2.0
set routing-instances CUST1 route-distinguisher 65001:1
set routing-instances CUST1 vrf-target target:65001:1
```

```
root> show route table CUST1.inet.0
root> ping 10.1.1.1 routing-instance CUST1
```

## 5.7 BFD

```
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 bfd-liveness-detection minimum-interval 300
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0 bfd-liveness-detection multiplier 3
```

```
root> show bfd session
                                                  Detect   Transmit
Address                  State     Interface      Time     Interval  Multiplier
10.0.12.2                Up        ge-0/0/0.0     0.900     0.300        3

1 sessions, 1 clients
Cumulative transmit rate 3.3 pps, cumulative receive rate 3.3 pps
```

---

# 6. Junos MPLS / LDP basics

```
set interfaces ge-0/0/0 unit 0 family mpls
set protocols mpls interface ge-0/0/0.0
set protocols ldp interface ge-0/0/0.0
set protocols ldp interface lo0.0
```

```
root> show ldp neighbor
Address            Interface          Label space ID         Hold time
10.0.12.2          ge-0/0/0.0         2.2.2.2:0                12

root> show ldp session
Address           State       Connection     Hold time  Adv. Mode
2.2.2.2           Operational Open               25     DU

root> show route table mpls.0
mpls.0: 5 destinations, 5 routes (5 active, 0 holddown, 0 hidden)
+ = Active Route, - = Last Active, * = Both

0                  *[MPLS/0] 00:10:10, metric 1
                       Receive
1                  *[MPLS/0] 00:10:10, metric 1
                       Receive
13                 *[MPLS/0] 00:10:10, metric 1
                       Receive
299776             *[LDP/9] 00:05:30, metric 1
                    >  to 10.0.12.2 via ge-0/0/0.0, Pop
```

RSVP/LSP:

```
set protocols rsvp interface ge-0/0/0.0
set protocols mpls label-switched-path R1-to-R3 to 3.3.3.3
```

```
root> show mpls lsp
Ingress LSP: 1 sessions
To              From            State Rt P     ActivePath       LSPname
3.3.3.3         1.1.1.1         Up     0 *                      R1-to-R3
Total 1 displayed, Up 1, Down 0
```

---

# 7. Junos SRX / vSRX security

## 7.1 Zones, interfaces and policies

```
set interfaces ge-0/0/0 unit 0 family inet address 192.168.10.1/24
set interfaces ge-0/0/1 unit 0 family inet address 203.0.113.2/24

set security zones security-zone trust interfaces ge-0/0/0.0
set security zones security-zone trust host-inbound-traffic system-services ping
set security zones security-zone trust host-inbound-traffic system-services ssh
set security zones security-zone untrust interfaces ge-0/0/1.0

set security policies from-zone trust to-zone untrust policy ALLOW-ALL match source-address any
set security policies from-zone trust to-zone untrust policy ALLOW-ALL match destination-address any
set security policies from-zone trust to-zone untrust policy ALLOW-ALL match application any
set security policies from-zone trust to-zone untrust policy ALLOW-ALL then permit
```

Address book and application-specific policy:

```
set security address-book global address WEB1 10.10.10.10/32
set security policies from-zone untrust to-zone trust policy WEB match source-address any
set security policies from-zone untrust to-zone trust policy WEB match destination-address WEB1
set security policies from-zone untrust to-zone trust policy WEB match application junos-http
set security policies from-zone untrust to-zone trust policy WEB then permit
set security policies from-zone untrust to-zone trust policy WEB then log session-init
```

Policy ordering:

```
insert security policies from-zone trust to-zone untrust policy DENY-X before policy ALLOW-ALL
```

## 7.2 NAT

Source NAT (interface-based, like PAT):

```
set security nat source rule-set TRUST-TO-UNTRUST from zone trust
set security nat source rule-set TRUST-TO-UNTRUST to zone untrust
set security nat source rule-set TRUST-TO-UNTRUST rule R1 match source-address 192.168.10.0/24
set security nat source rule-set TRUST-TO-UNTRUST rule R1 then source-nat interface
```

Destination NAT:

```
set security nat destination pool WEB-POOL address 10.10.10.10/32
set security nat destination rule-set DNAT from zone untrust
set security nat destination rule-set DNAT rule R1 match destination-address 203.0.113.2/32
set security nat destination rule-set DNAT rule R1 match destination-port 80
set security nat destination rule-set DNAT rule R1 then destination-nat pool WEB-POOL
set security zones security-zone untrust host-inbound-traffic system-services ping
```

Proxy-ARP when using NAT on a connected subnet:

```
set security nat proxy-arp interface ge-0/0/1.0 address 203.0.113.50/32
```

## 7.3 Verify security

```
root> show security zones
Security zone: trust
  Send reset for non-SYN session TCP packets: Off
  Policy configurable: Yes
  Interfaces bound: 1
  Interfaces:
    ge-0/0/0.0

Security zone: untrust
  Interfaces bound: 1
  Interfaces:
    ge-0/0/1.0
```

```
root> show security policies
Default policy: deny-all
From zone: trust, To zone: untrust
  Policy: ALLOW-ALL, State: enabled, Index: 4, Scope Policy: 0, Sequence number: 1
    Source addresses: any
    Destination addresses: any
    Applications: any
    Action: permit

root> show security policies hit-count
root> show security policies from-zone trust to-zone untrust detail
root> show security flow session
root> show security flow session destination-prefix 8.8.8.8
root> show security flow session summary
root> show security flow statistics
root> show security nat source summary
root> show security nat source rule all
root> show security nat destination rule all
root> show security nat source pool all
root> show security address-book
root> show security alg status
root> show security screen statistics zone untrust
root> clear security flow session
```

Sample `show security flow session`:

```
Session ID: 12345, Policy name: ALLOW-ALL/4, Timeout: 2, Valid
  In: 192.168.10.10/51234 --> 8.8.8.8/53;udp, Conn Tag: 0x0, If: ge-0/0/0.0, Pkts: 1, Bytes: 74,
  Out: 8.8.8.8/53 --> 203.0.113.2/20144;udp, Conn Tag: 0x0, If: ge-0/0/1.0, Pkts: 1, Bytes: 90,
Total sessions: 1
```

## 7.4 IPsec site-to-site VPN (route-based)

```
set interfaces st0 unit 0 family inet address 172.16.0.1/30

set security ike proposal IKE-PROP authentication-method pre-shared-keys
set security ike proposal IKE-PROP dh-group group14
set security ike proposal IKE-PROP authentication-algorithm sha-256
set security ike proposal IKE-PROP encryption-algorithm aes-256-cbc
set security ike policy IKE-POL mode main
set security ike policy IKE-POL proposals IKE-PROP
set security ike policy IKE-POL pre-shared-key ascii-text "ChangeMe!"
set security ike gateway GW1 ike-policy IKE-POL
set security ike gateway GW1 address 198.51.100.2
set security ike gateway GW1 external-interface ge-0/0/1.0

set security ipsec proposal IPSEC-PROP protocol esp
set security ipsec proposal IPSEC-PROP authentication-algorithm hmac-sha-256-128
set security ipsec proposal IPSEC-PROP encryption-algorithm aes-256-cbc
set security ipsec policy IPSEC-POL proposals IPSEC-PROP
set security ipsec vpn VPN1 bind-interface st0.0
set security ipsec vpn VPN1 ike gateway GW1
set security ipsec vpn VPN1 ike ipsec-policy IPSEC-POL
set security ipsec vpn VPN1 establish-tunnels immediately

set security zones security-zone vpn interfaces st0.0
set routing-options static route 192.168.20.0/24 next-hop st0.0
```

```
root> show security ike security-associations
Index   State  Initiator cookie  Responder cookie  Mode           Remote Address
1234567 UP     1a2b3c4d5e6f7081  8192a3b4c5d6e7f8  Main           198.51.100.2

root> show security ipsec security-associations
  Total active tunnels: 1     Total Ipsec sas: 1
  ID    Algorithm       SPI      Life:sec/kb  Mon lsys Port  Gateway
  <131073 ESP:aes-cbc-256/sha256 abcd1234 3299/ unlim - root 500 198.51.100.2
  >131073 ESP:aes-cbc-256/sha256 1234abcd 3299/ unlim - root 500 198.51.100.2

root> show security ipsec statistics
root> show security ike active-peer
```

## 7.5 SRX clustering and misc

```
root> show chassis cluster status
root> show chassis cluster interfaces
root> show security utm
root> show security idp status
root> request security idp security-package download
```

---

# 8. Junos system, users, services

## 8.1 Initial system settings

```
set system host-name R1
set system domain-name lab.local
set system root-authentication plain-text-password
New password: ********
Retype new password: ********

set system login user admin class super-user authentication plain-text-password
set system login user admin class super-user authentication ssh-rsa "ssh-rsa AAAA..."
set system services ssh
set system services ssh root-login deny
set system services netconf ssh
set system services web-management https system-generated-certificate
set system name-server 8.8.8.8
set system time-zone Asia/Kolkata
set system ntp server 10.0.0.1
set system syslog host 192.168.122.1 any notice
set system syslog file messages any notice
set system syslog file interactive-commands interactive-commands any
set system login message "Authorized access only"
set system login retry-options tries-before-disconnect 3
set system archival configuration transfer-on-commit archive-sites "scp://user@192.168.122.1/backups/"
```

> `commit` fails if no root password (or equivalent) is set on many images, which is why `set system root-authentication ...` is the first thing you do.

Encrypted password (to paste a hashed form instead of plain text):

```
set system root-authentication encrypted-password "$6$....hash...."
```

## 8.2 Login classes and users

```
set system login class OPERATOR permissions [ view view-configuration ]
set system login user ops class OPERATOR authentication plain-text-password
```

```
root> show system login lockout
root> show system users
root> request system logout username ops
```

## 8.3 SNMP

```
set snmp community public authorization read-only
set snmp contact "netops@example.com"
set snmp location "Nagpur lab"
```

## 8.4 Management interface and routing instance

```
set interfaces fxp0 unit 0 family inet address 192.168.122.11/24
set system management-instance
set routing-instances mgmt_junos routing-options static route 0.0.0.0/0 next-hop 192.168.122.1
```

## 8.5 Request commands

```
root> request system reboot
Reboot the system ? [yes,no] (no) yes
Shutdown NOW!

root> request system reboot at 23:30
root> request system power-off
root> request system halt
root> request system snapshot
root> request system software add /var/tmp/junos-xxx.tgz reboot
root> request system software rollback
root> request system storage cleanup
root> request system zeroize                      ! factory-reset, destroys config
root> request support information | save /var/tmp/rsi.txt
root> request system configuration rescue save
root> request system configuration rescue delete
root> request message all message "Maintenance in 5 min"
root> request system license add terminal
```

`request system storage cleanup` sample:

```
List of files to delete:

Size Date       Name
 54M Oct 30 08:00 /var/log/messages.0.gz
 12M Oct 29 22:00 /var/tmp/old-image.tgz
Delete these files ? [yes,no] (no)
```

## 8.6 Clear commands

```
root> clear arp
root> clear ospf neighbor
root> clear ospf database
root> clear bgp neighbor
root> clear interfaces statistics all
root> clear log messages
root> clear firewall all
root> clear ldp neighbor
```

---

# 9. Junos files, backup, restore

## 9.1 File browsing

```
root> file list
root> file list /var/tmp detail
root> file list /var/log
root> file show /var/log/messages
root> file show /var/log/messages | last 20
root> file copy /var/tmp/R1.conf user@192.168.122.1:/home/user/R1.conf
root> file copy user@192.168.122.1:/home/user/R1.conf /var/tmp/
root> file copy ftp://192.168.122.1/R1.conf /var/tmp/
root> file delete /var/tmp/old.conf
root> file rename /var/tmp/a.txt /var/tmp/b.txt
root> file checksum md5 /var/tmp/junos.tgz
root> file archive source /var/log/* destination /var/tmp/logs.tgz compress
```

Sample `file list /var/tmp detail`:

```
/var/tmp:
total blocks: 128
-rw-r--r--  1 root  wheel      1423 Oct 30 09:58 R1.conf
-rw-r--r--  1 root  wheel      2201 Oct 30 09:59 R1.set
total files: 2
```

## 9.2 Backing up your config

```
root> show configuration | display set | save /var/tmp/R1.set
Wrote 38 lines of output to '/var/tmp/R1.set'

root> show configuration | save /var/tmp/R1.conf
Wrote 74 lines of output to '/var/tmp/R1.conf'
```

Copy it to your PC (run from your PC):

```
scp -P 22 admin@192.168.122.11:/var/tmp/R1.set .
```

## 9.3 Restore

```
root# load override /var/tmp/R1.conf
load complete
root# load set /var/tmp/R1.set
root# commit
```

## 9.4 Rescue configuration (recovery)

```
root> request system configuration rescue save
root> configure
root# rollback rescue
load complete
root# commit
```

---

# 10. Junos troubleshooting tools

## 10.1 Ping

```
root> ping 10.0.12.2
PING 10.0.12.2 (10.0.12.2): 56 data bytes
64 bytes from 10.0.12.2: icmp_seq=0 ttl=64 time=1.045 ms
64 bytes from 10.0.12.2: icmp_seq=1 ttl=64 time=0.870 ms
^C
--- 10.0.12.2 ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max/stddev = 0.870/0.958/1.045/0.088 ms
```

Options:

```
root> ping 10.0.12.2 count 5
root> ping 10.0.12.2 rapid count 100
root> ping 10.0.12.2 source 1.1.1.1
root> ping 10.0.12.2 size 1472 do-not-fragment
root> ping 10.0.12.2 routing-instance CUST1
root> ping 10.0.12.2 interface ge-0/0/0.0
root> ping 10.0.12.2 no-resolve
root> ping 2001:db8::2
root> ping mpls rsvp R1-to-R3
```

`rapid` sample:

```
PING 10.0.12.2 (10.0.12.2): 56 data bytes
!!!!!
--- 10.0.12.2 ping statistics ---
5 packets transmitted, 5 packets received, 0% packet loss
```

## 10.2 Traceroute

```
root> traceroute 8.8.8.8
traceroute to 8.8.8.8 (8.8.8.8), 30 hops max, 40 byte packets
 1  192.168.122.1 (192.168.122.1)  0.612 ms  0.401 ms  0.385 ms
 2  * * *
 3  10.20.0.1 (10.20.0.1)  4.150 ms  3.883 ms  3.821 ms
```

```
root> traceroute 8.8.8.8 no-resolve
root> traceroute 8.8.8.8 source 1.1.1.1
root> traceroute monitor 8.8.8.8
```

## 10.3 Monitor

```
root> monitor traffic interface ge-0/0/0
verbose output suppressed, use <detail> or <extensive> for full protocol decode
Address resolution is ON. Use <no-resolve> to avoid any reverse lookup delay.
Listening on ge-0/0/0, capture size 96 bytes

10:05:10.123456  In IP 10.0.12.2 > 224.0.0.5: OSPFv2, Hello, length 44
10:05:10.223344 Out IP 10.0.12.1 > 224.0.0.5: OSPFv2, Hello, length 44
^C
2 packets received by filter
```

```
root> monitor traffic interface ge-0/0/0 no-resolve size 1500 matching "icmp"
root> monitor traffic interface ge-0/0/0 write-file /var/tmp/cap.pcap
root> monitor interface ge-0/0/0                  ! live counters (interactive, press q to quit)
root> monitor interface traffic
root> monitor start messages
root> monitor stop
root> monitor list
```

`monitor interface` header sample:

```
R1                                Seconds: 5                  Time: 10:06:00
                                                         Delay: 0/0/0
Interface: ge-0/0/0, Enabled, Link is Up
Encapsulation: Ethernet, Speed: 1000mbps
Traffic statistics:                                          Current delta
  Input bytes:                   120330 (0 bps)                        [0]
  Output bytes:                  118902 (0 bps)                        [0]
```

## 10.4 Protocol traceoptions (debugging)

```
set protocols ospf traceoptions file ospf-trace size 1m files 3
set protocols ospf traceoptions flag all
set protocols ospf traceoptions flag hello detail
commit
```

```
root> show log ospf-trace
Oct 30 10:07:01.123456 OSPF rcvd Hello 10.0.12.2 -> 224.0.0.5 (ge-0/0/0.0 IFL 332 area 0.0.0.0)
```

```
root> monitor start ospf-trace
```

Remove when done (traceoptions can be heavy):

```
delete protocols ospf traceoptions
commit
```

## 10.5 Typical problem checks

| Problem | Commands |
|---|---|
| OSPF neighbour stuck in `ExStart`/`Init` | `show ospf neighbor`, `show interfaces ge-0/0/0 | match mtu`, check MTU and `show ospf interface detail` |
| BGP `Active`/`Connect` | `show bgp neighbor`, `ping <peer> source <local>`, check `peer-as`, `local-address`, firewall filters on `lo0` |
| Route not in table | `show route <prefix> exact detail`, `show route hidden`, check import policy and next-hop reachability |
| Route not advertised in BGP | `show route advertising-protocol bgp <peer>`, check export policy; Junos exports no protocol routes (other than BGP) by default |
| Interface up/down | `show interfaces <if> extensive`, `show log messages | last 50` |
| Commit failing | `commit check`, read the `[edit ...]` hierarchy printed in the error |
| Cannot SSH | `show system services`, `show configuration system services`, `show configuration firewall`, `ping` from the same subnet |
| Slow CLI/high CPU | `show system processes extensive`, `show system memory` |

Sample `show hidden route` situation:

```
root> show route hidden
inet.0: 7 destinations, 8 routes (7 active, 0 holddown, 1 hidden)
10.50.0.0/24        [BGP/170] 00:02:11, localpref 100
                      AS path: 65002 I
                    >  to 10.0.99.2 via ge-0/0/3.0      ! hidden: next hop unusable/unresolved
```

---

# 11. Junos automation

## 11.1 NETCONF

Enable it:

```
set system services netconf ssh
set system services netconf ssh port 830
commit
```

Test from your PC:

```
ssh admin@192.168.122.11 -p 830 -s netconf
```

You receive a `<hello>` from the device, then send your own:

```xml
<hello xmlns="urn:ietf:params:xml:ns:netconf:base:1.0">
  <capabilities><capability>urn:ietf:params:netconf:base:1.0</capability></capabilities>
</hello>
]]>]]>
<rpc><get-software-information/></rpc>
]]>]]>
```

See the XML behind any command:

```
root> show interfaces terse | display xml
root> show interfaces terse | display xml rpc
<rpc-reply xmlns:junos="http://xml.juniper.net/junos/23.2R1/junos">
    <rpc>
        <get-interface-information>
                <terse/>
        </get-interface-information>
    </rpc>
    <cli>
        <banner></banner>
    </cli>
</rpc-reply>
```

## 11.2 PyEZ (Python)

Install:

```bash
pip install junos-eznc
```

Connect, facts and an RPC:

```python
from jnpr.junos import Device
from jnpr.junos.utils.config import Config

with Device(host="192.168.122.11", user="admin", passwd="Juniper123", port=22) as dev:
    print(dev.facts["hostname"], dev.facts["version"])
    resp = dev.rpc.get_interface_information(terse=True)
    for item in resp.findall(".//logical-interface"):
        print(item.findtext("name").strip())
```

Sample output:

```
R1 23.2R1.13
ge-0/0/0.0
lo0.0
fxp0.0
```

Push configuration:

```python
from jnpr.junos import Device
from jnpr.junos.utils.config import Config

with Device(host="192.168.122.11", user="admin", passwd="Juniper123") as dev:
    with Config(dev, mode="exclusive") as cu:
        cu.load("set system host-name R1-AUTO", format="set")
        print(cu.diff())
        cu.commit(comment="Set via PyEZ")
```

Sample `cu.diff()`:

```
[edit system]
-  host-name R1;
+  host-name R1-AUTO;
```

## 11.3 Netmiko (CLI scraping)

```python
from netmiko import ConnectHandler

dev = {"device_type": "juniper_junos", "host": "192.168.122.11",
       "username": "admin", "password": "Juniper123"}
with ConnectHandler(**dev) as conn:
    print(conn.send_command("show interfaces terse"))
    conn.send_config_set(["set system host-name R1-NM"], exit_config_mode=False)
    print(conn.commit())
```

## 11.4 Ansible

```bash
ansible-galaxy collection install junipernetworks.junos
```

`inventory.ini`:

```
[junos]
R1 ansible_host=192.168.122.11

[junos:vars]
ansible_connection=ansible.netcommon.netconf
ansible_network_os=junipernetworks.junos.junos
ansible_user=admin
ansible_password=Juniper123
```

`playbook.yml`:

```yaml
- hosts: junos
  gather_facts: no
  tasks:
    - name: Get facts
      junipernetworks.junos.junos_facts:
        gather_subset: min
    - name: Set hostname
      junipernetworks.junos.junos_config:
        lines:
          - set system host-name R1-ANS
```

Run:

```bash
ansible-playbook -i inventory.ini playbook.yml
```

Sample result:

```
PLAY RECAP *************************************************************
R1                         : ok=2    changed=1    unreachable=0    failed=0
```

---

# 12. vLabs client-side commands

vLabs itself is a web UI, so "commands" here are what you run on **your own machine** once you have added your IP under **COMMANDS → Add Allowed Network Prefixes** (see the feature guide).

## 12.1 Find your public IPv4 (to paste into `List_of_Prefixes`)

Linux/macOS:

```bash
curl -4 ifconfig.me
```

Windows PowerShell:

```powershell
(Invoke-WebRequest -Uri https://ifconfig.me/ip -UseBasicParsing).Content
```

## 12.2 SSH to a sandbox device

The vLabs UI shows an SSH address and port on hover over the green circle.

```bash
ssh -p 12345 admin@203.0.113.50
```

Sample first connection:

```
The authenticity of host '[203.0.113.50]:12345' can't be established.
ED25519 key fingerprint is SHA256:abcdEFGH...
Are you sure you want to continue connecting (yes/no/[fingerprint])? yes
Warning: Permanently added '[203.0.113.50]:12345' (ED25519) to the list of known hosts.
Password:
--- JUNOS 23.2R1.13 Kernel 64-bit  JNPR-12.1-20230621.da75f28_buil
admin@vmx1>
```

Windows PuTTY: **Host Name** = address, **Port** = the port from the UI, **Connection type** = SSH, then **Open**.

## 12.3 Copy configs off a sandbox device (before time runs out)

On the device:

```
admin@vmx1> show configuration | display set | save /var/tmp/vmx1.set
Wrote 120 lines of output to '/var/tmp/vmx1.set'
```

From your PC:

```bash
scp -P 12345 admin@203.0.113.50:/var/tmp/vmx1.set ./vmx1.set
```

Or just capture the terminal output into a file:

```
admin@vmx1> show configuration | display set | no-more
```

Then select and copy it.

## 12.4 Paste a saved config back after "Start Over"

```
admin@vmx1> configure
admin@vmx1# load set terminal
[Type ^D at a new line to end input]
<paste your set commands>
^D
load complete
admin@vmx1# commit
```

---

# 13. GNS3: VPCS commands

VPCS is the lightweight "PC" node. Open its console (double-click) and use:

```
PC1> ?
```

Sample help (trimmed):

```
?                        Print help
arp                      Shortcut for: show arp. Show arp table
clear ARG                Clear IPv4/IPv6, arp/neighbor cache, command history
dhcp [OPTION]            Shortcut for: ip dhcp. Get IPv4 address via DHCP
echo TEXT                Display TEXT in output
help                     Print help
history                  Shortcut for: show history. List the command history
ip ARG ... [OPTION]      Configure the current VPC's IP settings. See 'ip ?'
load [FILENAME]          Load the configuration/script from the file FILENAME
ping HOST [OPTION ...]   Ping HOST with ICMP (default) or TCP/UDP. See 'ping ?'
quit                     Quit program
relay ARG ...            Configure packet relay between UDP ports. See 'relay ?'
rlogin [ip] port         Telnet to port on host
save [FILENAME]          Save the configuration to the file FILENAME
set ARG ...              Set hostname or connection options. See 'set ?'
show [ARG ...]           Print the information of VPCs (default). See 'show ?'
sleep [seconds] [TEXT]   Print TEXT and pause the command execution for a few seconds
trace HOST [OPTION ...]  Print the path packets take to network HOST
version                  Shows the version information
```

## 13.1 Set an IP address

Static:

```
PC1> ip 192.168.1.10/24 192.168.1.1
Checking for duplicate address...
PC1 : 192.168.1.10 255.255.255.0 gateway 192.168.1.1
```

Alternative forms:

```
PC1> ip 192.168.1.10 192.168.1.1 24
PC1> ip 192.168.1.10 255.255.255.0
PC1> ip dhcp
PC1> ip dhcp -d                      ! debug
PC1> ip auto                         ! IPv6 auto-config
PC1> ip dns 8.8.8.8
PC1> ip domain lab.local
```

DHCP sample:

```
PC1> ip dhcp
DDORA IP 10.0.10.101/24 GW 10.0.10.1
```

## 13.2 Show

```
PC1> show ip
NAME        : PC1[1]
IP/MASK     : 192.168.1.10/24
GATEWAY     : 192.168.1.1
DNS         :
MAC         : 00:50:79:66:68:00
LPORT       : 20000
RHOST:PORT  : 127.0.0.1:20001
MTU         : 1500
```

```
PC1> show
NAME   IP/MASK              GATEWAY                             MAC                LPORT  RHOST:PORT
PC1    192.168.1.10/24      192.168.1.1                         00:50:79:66:68:00  20000  127.0.0.1:20001
       fe80::250:79ff:fe66:6800/64
```

```
PC1> show arp
00:50:79:66:68:01  192.168.1.11 expires in 112 seconds

PC1> show history
PC1> show version
```

## 13.3 Ping and trace

```
PC1> ping 192.168.1.1
84 bytes from 192.168.1.1 icmp_seq=1 ttl=64 time=0.523 ms
84 bytes from 192.168.1.1 icmp_seq=2 ttl=64 time=0.612 ms
84 bytes from 192.168.1.1 icmp_seq=3 ttl=64 time=0.490 ms
84 bytes from 192.168.1.1 icmp_seq=4 ttl=64 time=0.601 ms
84 bytes from 192.168.1.1 icmp_seq=5 ttl=64 time=0.557 ms
```

Failure sample:

```
PC1> ping 192.168.2.1
host (192.168.1.1) not reachable
```

```
PC1> ping 192.168.1.1 -c 10            ! count
PC1> ping 192.168.1.1 -l 1000          ! payload size
PC1> ping 192.168.1.1 -i 500           ! interval in ms
PC1> ping 192.168.1.1 -w 2             ! wait seconds
PC1> ping 192.168.1.1 -T 64            ! TTL
PC1> ping 192.168.1.1 -3               ! use TCP SYN mode
PC1> ping 192.168.1.1 -2               ! use UDP mode
PC1> ping 192.168.1.1 -P 6             ! IP protocol
PC1> ping 192.168.1.1 -p 80            ! port (TCP/UDP)
PC1> ping 192.168.1.1 -s 5000          ! source port
PC1> ping 2001:db8::1                  ! IPv6
```

```
PC1> trace 192.168.2.10
trace to 192.168.2.10, 8 hops max, press Ctrl+C to stop
 1   192.168.1.1   1.044 ms  0.680 ms  0.745 ms
 2   10.0.12.2     2.210 ms  1.992 ms  2.018 ms
 3   *192.168.2.10   3.004 ms (ICMP type:3, code:3, Destination port unreachable)
```

## 13.4 Other

```
PC1> set pcname CLIENT1
CLIENT1>

PC1> set dump all           ! packet dump
PC1> set dump detail
PC1> set dump off

PC1> save
Saving startup configuration to startup.vpc
.  done

PC1> load startup.vpc
PC1> clear arp
PC1> clear history
PC1> sleep 2 waiting
PC1> echo hello
PC1> version
Welcome to Virtual PC Simulator, version 0.8.2
Dedicated to Daling.
Build time: Dec 31 2020 12:00:00
Copyright (c) 2007-2015, Paul Meng (mirnshi@gmail.com)
All rights reserved.
```

> `save` writes `startup.vpc` into the project directory, so the IP survives a stop/start.

---

# 14. GNS3: built-in console

The GNS3 GUI has a **Console** pane at the bottom (prompt `gns3 =>`). Evidence from the release notes confirms a few commands; type `help` to see everything your version supports.

```
gns3 => help
gns3 => ?
```

Commands confirmed to exist in release notes:

```
gns3 => env                    ! show environment variables GNS3 is using
gns3 => reset console all      ! reset all console connections (stuck telnet sessions)
gns3 => debug                  ! toggle debug output
```

> Exact `help` output differs by version. The `env` command was added in the 2.2.x series, and "reset all console connections" was backported from 3.x.

**Command-line launch of the GUI (Windows PowerShell / Linux):**

```
gns3                                  ! start GUI (Linux)
gns3 --debug                          ! verbose logging
gns3 --version                        ! print version
gns3 --project /path/to/project.gns3  ! open a project directly
gns3 --local                          ! use local server
```

> If a flag isn't accepted on your version, run `gns3 --help`.

---

# 15. Cisco IOS commands for Dynamips/IOU nodes

For routers using Cisco images (c3725, c7200, IOU L2/L3). These are standard IOS commands.

## 15.1 Basic modes

```
Router> enable
Router# configure terminal
Router(config)# hostname R1
R1(config)# end
R1# write memory
Building configuration...
[OK]
```

## 15.2 Interfaces

```
R1(config)# interface FastEthernet0/0
R1(config-if)# ip address 10.0.12.1 255.255.255.0
R1(config-if)# no shutdown
R1(config-if)# description to-R2
R1(config-if)# exit
R1(config)# interface Loopback0
R1(config-if)# ip address 1.1.1.1 255.255.255.255
```

Show:

```
R1# show ip interface brief
Interface                  IP-Address      OK? Method Status                Protocol
FastEthernet0/0            10.0.12.1       YES manual up                    up
FastEthernet0/1            unassigned      YES unset  administratively down down
Loopback0                  1.1.1.1         YES manual up                    up
```

```
R1# show interfaces FastEthernet0/0
R1# show running-config
R1# show startup-config
R1# show version
R1# show ip route
R1# show ip arp
R1# show cdp neighbors
R1# show vlan-switch brief         ! IOU L2 / switch modules
R1# show mac address-table
R1# show ip protocols
R1# show logging
R1# show processes cpu
R1# show flash:
```

Sample `show ip route`:

```
Codes: C - connected, S - static, O - OSPF, B - BGP, ...
Gateway of last resort is not set

     1.0.0.0/32 is subnetted, 1 subnets
C       1.1.1.1 is directly connected, Loopback0
     2.0.0.0/32 is subnetted, 1 subnets
O       2.2.2.2 [110/11] via 10.0.12.2, 00:02:10, FastEthernet0/0
     10.0.0.0/8 is variably subnetted, 2 subnets, 2 masks
C       10.0.12.0/24 is directly connected, FastEthernet0/0
L       10.0.12.1/32 is directly connected, FastEthernet0/0
```

## 15.3 Routing

```
R1(config)# router ospf 1
R1(config-router)# router-id 1.1.1.1
R1(config-router)# network 10.0.12.0 0.0.0.255 area 0
R1(config-router)# network 1.1.1.1 0.0.0.0 area 0

R1(config)# router eigrp 100
R1(config-router)# network 10.0.12.0 0.0.0.255

R1(config)# router bgp 65001
R1(config-router)# neighbor 10.0.12.2 remote-as 65002
R1(config-router)# network 1.1.1.1 mask 255.255.255.255

R1(config)# ip route 0.0.0.0 0.0.0.0 10.0.12.2
```

```
R1# show ip ospf neighbor
Neighbor ID     Pri   State           Dead Time   Address         Interface
2.2.2.2           1   FULL/BDR        00:00:33    10.0.12.2       FastEthernet0/0

R1# show ip bgp summary
R1# show ip eigrp neighbors
R1# debug ip ospf adj
R1# undebug all
```

## 15.4 Switching on IOU L2 / EtherSwitch module

```
SW1(config)# vlan 10
SW1(config-vlan)# name SALES
SW1(config)# interface Ethernet0/1
SW1(config-if)# switchport mode access
SW1(config-if)# switchport access vlan 10
SW1(config)# interface Ethernet0/0
SW1(config-if)# switchport trunk encapsulation dot1q
SW1(config-if)# switchport mode trunk
```

```
SW1# show vlan brief
VLAN Name                             Status    Ports
---- -------------------------------- --------- -------------------------------
1    default                          active    Et0/2, Et0/3
10   SALES                            active    Et0/1
```

## 15.5 Console quality-of-life for lab routers

```
R1(config)# no ip domain-lookup
R1(config)# line con 0
R1(config-line)# exec-timeout 0 0
R1(config-line)# logging synchronous
R1(config)# line vty 0 4
R1(config-line)# transport input ssh telnet
R1(config-line)# login local
R1(config)# username admin privilege 15 secret cisco123
```

Dynamips Idle-PC (done in the GNS3 GUI, see the feature guide), then check with `show processes cpu`.

---

# 16. GNS3 server and Linux/GNS3 VM commands

## 16.1 Install on Ubuntu

```bash
sudo add-apt-repository ppa:gns3/ppa
sudo apt update
sudo apt install gns3-server gns3-gui
```

Permissions:

```bash
sudo usermod -aG ubridge,libvirt,kvm,wireshark,docker $USER
newgrp ubridge    # or log out and back in
```

## 16.2 Run the server

```bash
gns3server --version
gns3server --local                     # run in local mode
gns3server --host 0.0.0.0 --port 3080  # accept remote GUIs
gns3server --debug                     # verbose logs
gns3server --config /etc/gns3/gns3_server.conf
gns3server --daemon                    # run in background
gns3server --allow                     # allow remote console connections (older option)
```

Sample startup log:

```
2026-10-30 10:20:01 INFO run.py:223 GNS3 server version 3.0.6
2026-10-30 10:20:01 INFO run.py:225 Copyright (c) 2007-2026 GNS3 Technologies Inc.
2026-10-30 10:20:01 INFO run.py:232 Config file /home/user/.config/GNS3/3.0/gns3_server.conf loaded
2026-10-30 10:20:02 INFO run.py:263 Starting server on 127.0.0.1:3080
```

## 16.2b Server config file (`gns3_server.conf`)

```ini
[Server]
host = 0.0.0.0
port = 3080
images_path = /opt/gns3/images
projects_path = /opt/gns3/projects
appliances_path = /opt/gns3/appliances
additional_images_paths = /home/user/images
enable_http_auth = True
user = admin
password = change-me

[Qemu]
enable_hardware_acceleration = True
require_hardware_acceleration = False
```

> Use sections/keys as shown in your version's sample config. `enable_http_auth` appears in 3.1.0-alpha release notes, and 3.0 ships with auth by default.

## 16.3 Service management

```bash
systemctl status gns3-server
sudo systemctl enable --now gns3-server
sudo systemctl restart gns3-server
journalctl -u gns3-server -f
```

## 16.4 Verify the helper binaries

```bash
dynamips --version
ubridge -v
vpcs -v
qemu-system-x86_64 --version
which dynamips ubridge vpcs qemu-system-x86_64
getcap /usr/bin/ubridge
```

Sample:

```
$ vpcs -v
Welcome to Virtual PC Simulator, version 0.8.2

$ getcap /usr/bin/ubridge
/usr/bin/ubridge cap_net_admin,cap_net_raw=ep
```

If `ubridge` lacks capabilities:

```bash
sudo chmod u+s /usr/bin/ubridge
# or
sudo setcap cap_net_admin,cap_net_raw=ep /usr/bin/ubridge
```

## 16.5 GNS3 VM text menu

When you open the GNS3 VM console you get a menu:

```
GNS3 VM
  Version 3.0.6
  Shell
  Keyboard layout
  Change password
  Update
  Proxy
  Log
  Ubuntu Network settings
  Shutdown
  Reboot
```

> The VM is Ubuntu-based, so `ip a`, `ip route`, `top`, `df -h`, `free -m`, `sudo journalctl -u gns3` work in its shell. Menu labels vary by VM version.

Useful checks inside the GNS3 VM shell:

```bash
ip addr show
ip route
df -h
free -m
nproc
top
sudo systemctl status gns3
```

## 16.6 Networking on the host (Linux) for Cloud/TAP bridging

```bash
sudo ip tuntap add dev tap0 mode tap user $USER
sudo ip link set tap0 up
sudo ip addr add 10.99.0.1/24 dev tap0
ip addr show tap0
```

Bridge:

```bash
sudo ip link add br-lab type bridge
sudo ip link set br-lab up
sudo ip link set tap0 master br-lab
bridge link
```

NAT out to the internet:

```bash
sudo sysctl -w net.ipv4.ip_forward=1
sudo iptables -t nat -A POSTROUTING -s 10.99.0.0/24 -o eth0 -j MASQUERADE
```

## 16.7 Capture on the host

```bash
sudo tcpdump -i tap0 -n -c 20
sudo tcpdump -i tap0 -w /tmp/lab.pcap
wireshark -k -i tap0
```

Sample:

```
10:30:10.123456 IP 10.99.0.2 > 10.99.0.1: ICMP echo request, id 1, seq 1, length 64
10:30:10.123600 IP 10.99.0.1 > 10.99.0.2: ICMP echo reply, id 1, seq 1, length 64
```

## 16.8 Windows commands useful for GNS3

```powershell
Get-NetAdapter
ipconfig /all
netstat -ano | findstr 3080
Get-Service | findstr -i gns3
systeminfo | findstr /i "hyper-v virtualization"
bcdedit /set hypervisorlaunchtype off     # disable Hyper-V for VMware/VirtualBox (reboot required)
bcdedit /set hypervisorlaunchtype auto    # re-enable
```

> `netstat` sample when the server is running: `TCP 127.0.0.1:3080 0.0.0.0:0 LISTENING 12345`.

---

# 17. GNS3: QEMU, KVM and disk-image commands

## 17.1 Check virtualization support (Linux/GNS3 VM)

```bash
egrep -c '(vmx|svm)' /proc/cpuinfo
sudo apt install cpu-checker
kvm-ok
lsmod | grep kvm
```

Sample:

```
$ egrep -c '(vmx|svm)' /proc/cpuinfo
8

$ kvm-ok
INFO: /dev/kvm exists
KVM acceleration can be used
```

If "KVM acceleration can NOT be used" inside the GNS3 VM, enable **nested virtualization** (VT-x/AMD-V passthrough) in your hypervisor and in BIOS.

## 17.2 qemu-img

```bash
qemu-img info vjunos.qcow2
```

Sample:

```
image: vjunos.qcow2
file format: qcow2
virtual size: 32 GiB (34359738368 bytes)
disk size: 1.5 GiB
cluster_size: 65536
Format specific information:
    compat: 1.1
```

```bash
qemu-img create -f qcow2 disk.qcow2 10G
qemu-img create -f qcow2 -b base.qcow2 -F qcow2 overlay.qcow2   # linked clone
qemu-img convert -f vmdk -O qcow2 image.vmdk image.qcow2
qemu-img convert -f raw -O qcow2 image.img image.qcow2
qemu-img resize disk.qcow2 +5G
qemu-img check disk.qcow2
qemu-img snapshot -l disk.qcow2
```

## 17.3 Manually boot an image for testing

```bash
qemu-system-x86_64 -enable-kvm -m 4096 -smp 2 \
  -drive file=vjunos.qcow2,if=virtio \
  -nic user,model=virtio-net-pci \
  -nographic
```

> This is for sanity-checking an image outside GNS3. Check the appliance notes for the right NIC model and any extra flags the image needs.

## 17.4 Checksums

```bash
md5sum image.qcow2
sha256sum image.qcow2
```

Windows:

```powershell
Get-FileHash .\image.qcow2 -Algorithm MD5
Get-FileHash .\image.qcow2 -Algorithm SHA256
```

---

# 18. GNS3: Docker commands

```bash
docker --version
docker ps
docker ps -a
docker images
docker pull alpine:latest
docker pull frrouting/frr:latest
docker pull juniper/crpd:latest        ! cRPD usually needs a Juniper-provided/loaded image instead
docker rm -f <container>
docker logs <container>
docker exec -it <container> sh
```

Sample `docker ps`:

```
CONTAINER ID   IMAGE              COMMAND   CREATED         STATUS         PORTS   NAMES
a1b2c3d4e5f6   frrouting/frr      "..."     3 minutes ago   Up 3 minutes           GNS3.FRR-1.a1b2c3d4
```

Load a locally downloaded image (for example a Juniper cRPD tarball):

```bash
docker load -i junos-routing-crpd-docker-23.2R1.13.tgz
docker images | grep crpd
```

Inside a running cRPD (from the GNS3 node or `docker exec`):

```
docker exec -it <crpd-container> cli
root@crpd1> show version
root@crpd1> configure
root@crpd1# set system host-name crpd1
root@crpd1# commit
```

> cRPD may need a licence and a set of container run options. Follow the Juniper guide for your release.

---

# 19. GNS3: REST API with curl

Base URL: `http://127.0.0.1:3080`. GNS3 3.x uses `/v3/`, 2.2.x uses `/v2/`.

## 19.1 Version

```bash
curl http://127.0.0.1:3080/v3/version
```

Sample:

```json
{"version":"3.0.6","controller_host":"127.0.0.1","local":true}
```

2.2.x:

```bash
curl http://127.0.0.1:3080/v2/version
```

```json
{"local":true,"version":"2.2.57"}
```

## 19.2 Authenticate (3.x)

```bash
curl -X POST http://127.0.0.1:3080/v3/access/users/login \
  -d "username=admin&password=admin"
```

Sample:

```json
{"access_token":"eyJhbGciOi...","token_type":"bearer"}
```

> Default credentials and the exact login path vary by version and installation. Check the interactive API docs at `http://127.0.0.1:3080/docs`.

Use the token:

```bash
TOKEN="eyJhbGciOi..."
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects
```

## 19.3 Projects

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects
```

Sample:

```json
[{"project_id":"4c3d1a0e-...","name":"lab1","status":"opened","path":"/home/user/GNS3/projects/lab1"}]
```

Create:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"api-lab"}' http://127.0.0.1:3080/v3/projects
```

Open/close/delete:

```bash
curl -X POST   -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects/<PID>/open
curl -X POST   -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects/<PID>/close
curl -X DELETE -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects/<PID>
```

## 19.4 Nodes

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects/<PID>/nodes
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects/<PID>/nodes/<NID>/start
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects/<PID>/nodes/<NID>/stop
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects/<PID>/nodes/start     # start all
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/projects/<PID>/nodes/stop      # stop all
```

Create a node from a template:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"x":100,"y":100}' \
  http://127.0.0.1:3080/v3/projects/<PID>/templates/<TEMPLATE_ID>
```

## 19.5 Links

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -d '{"nodes":[{"node_id":"<N1>","adapter_number":0,"port_number":0},
               {"node_id":"<N2>","adapter_number":0,"port_number":0}]}' \
  http://127.0.0.1:3080/v3/projects/<PID>/links
```

## 19.6 Templates, computes, appliances

```bash
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/templates
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/computes
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/appliances
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3080/v3/symbols
```

## 19.7 Python wrapper example (gns3fy)

```bash
pip install gns3fy
```

```python
from gns3fy import Gns3Connector, Project

server = Gns3Connector(url="http://127.0.0.1:3080")
print(server.get_version())
lab = Project(name="lab1", connector=server)
lab.get()
lab.open()
lab.start_nodes()
for n in lab.nodes:
    print(n.name, n.status, n.console)
```

Sample:

```
{'local': True, 'version': '2.2.57'}
R1 started 5000
R2 started 5001
PC1 started 5002
```

> `gns3fy` targets the 2.x API. For 3.x check whether your installed version supports the new authenticated API.

## 19.8 Quick telnet-to-console

Each node has a console port (shown in the GNS3 **Topology Summary** and in API output). You can use it directly:

```bash
telnet 127.0.0.1 5000
```

Windows (if the Telnet client is enabled):

```powershell
telnet 127.0.0.1 5000
```

---

# 20. Quick cheat sheet

## 20.1 Junos

| Goal | Command |
|---|---|
| Enter CLI from shell | `cli` |
| Enter config mode | `configure` |
| Show config as set | `show configuration \| display set` |
| Set a value | `set <path> <value>` |
| Delete | `delete <path>` |
| See pending changes | `show \| compare` |
| Validate | `commit check` |
| Apply | `commit` |
| Apply with auto-revert | `commit confirmed 5` |
| Undo uncommitted | `rollback 0` |
| Undo last commit | `rollback 1` then `commit` |
| Run op command from config | `run show ...` |
| Interfaces summary | `show interfaces terse` |
| Routing table | `show route` |
| OSPF neighbours | `show ospf neighbor` |
| BGP summary | `show bgp summary` |
| Save config off-box | `show configuration \| display set \| save /var/tmp/x.set` |
| Reboot | `request system reboot` |
| Factory reset | `request system zeroize` |

## 20.2 Cisco IOS

| Goal | Command |
|---|---|
| Config mode | `configure terminal` |
| Save | `write memory` |
| Interface summary | `show ip interface brief` |
| Routing table | `show ip route` |
| OSPF neighbours | `show ip ospf neighbor` |
| Running config | `show running-config` |

## 20.3 VPCS

| Goal | Command |
|---|---|
| Set IP | `ip 192.168.1.10/24 192.168.1.1` |
| DHCP | `ip dhcp` |
| Save | `save` |
| Ping | `ping 192.168.1.1` |
| Trace | `trace 192.168.2.10` |
| Show IP | `show ip` |

## 20.4 GNS3 / Linux

| Goal | Command |
|---|---|
| Server version | `gns3server --version` |
| Run server for remote GUIs | `gns3server --host 0.0.0.0 --port 3080` |
| Check KVM | `kvm-ok` |
| Inspect an image | `qemu-img info <file>` |
| List containers | `docker ps` |
| API version | `curl http://127.0.0.1:3080/v3/version` |
| Telnet to a node console | `telnet 127.0.0.1 <console-port>` |

---

*Reminder: all outputs above are illustrative. Run the command on your own lab to see exact output for your image and version, and check the Juniper TechLibrary (Junos CLI reference) and the GNS3 documentation for authoritative syntax.*
