        // Parameters used: locationName, newProjectName, sharedKeyPrefix
        // We set the sharedKeyPrefix here for simplicity
        WITH $locationName AS locationName, $newProjectName AS newProjectName, 'AUTO_PSK' AS sharedKeyPrefix

        // 1. MERGE the central firewall and location nodes (guarantee templates exist)
        MERGE (anchor:Firewall {name: 'ASK-FW01'})
        ON CREATE SET 
            // TEMPLATES FOR CENTRAL FIREWALL (ASK-FW01)
            anchor.template_central_phase1 = 'config vpn ipsec phase1-interface\\nedit "P1_@PROJECT_NAME@"\\nset remote-gw @PROJECT_WAN_IP@\\nset psksecret "@SHARED_KEY@"\\nnext\\nend',
            anchor.template_central_phase2 = 'config vpn ipsec phase2-interface\\nedit "P2_@PROJECT_NAME@"\\nset phase1name "P1_@PROJECT_NAME@"\\nset src-subnet @DC_LAN@\\nset dst-subnet @PROJECT_NAT_SUBNET@ 255.255.255.0\\nnext\\nend',
            // TEMPLATES FOR REMOTE FIREWALL (EDGE)
            anchor.template_remote_phase1 = 'config vpn ipsec phase1-interface\\nedit "P1_@PROJECT_NAME@"\\nset remote-gw @DC_WAN_IP@\\nset psksecret "@SHARED_KEY@"\\nnext\\nend',
            anchor.template_remote_phase2 = 'config vpn ipsec phase2-interface\\nedit "P2_@PROJECT_NAME@"\\nset phase1name "P1_@PROJECT_NAME@"\\nset src-subnet @PROJECT_LAN_CIDR@\\nset dst-subnet @DC_LAN@\\nnext\\nend',
            anchor.template_remote_interface = 'config system interface\\nedit "port4"\\nconfig subinterface\\nedit "port4_VLAN300"\\nset vlanid 300\\nset ip @REMOTE_VLAN_IP@ 255.255.255.0\\nnext\\nend',
            anchor.template_remote_config = 'config firewall policy\\nedit 0\\nset srcintf "port3"\\nset dstintf "VPN"\\nset srcaddr "192.168.106.0/24"\\nset dstaddr "10.100.0.0/16"\\nset action accept\\nnext\\nend'
        ON CREATE SET // CRITICAL: Ensures templates are available if anchor already exists
            anchor.template_central_phase1 = 'config vpn ipsec phase1-interface\\nedit "P1_@PROJECT_NAME@"\\nset remote-gw @PROJECT_WAN_IP@\\nset psksecret "@SHARED_KEY@"\\nnext\\nend',
            anchor.template_central_phase2 = 'config vpn ipsec phase2-interface\\nedit "P2_@PROJECT_NAME@"\\nset phase1name "P1_@PROJECT_NAME@"\\nset src-subnet @DC_LAN@\\nset dst-subnet @PROJECT_NAT_SUBNET@ 255.255.255.0\\nnext\\nend',
            anchor.template_remote_phase1 = 'config vpn ipsec phase1-interface\\nedit "P1_@PROJECT_NAME@"\\nset remote-gw @DC_WAN_IP@\\nset psksecret "@SHARED_KEY@"\\nnext\\nend',
            anchor.template_remote_phase2 = 'config vpn ipsec phase2-interface\\nedit "P2_@PROJECT_NAME@"\\nset phase1name "P1_@PROJECT_NAME@"\\nset src-subnet @PROJECT_LAN_CIDR@\\nset dst-subnet @DC_LAN@\\nnext\\nend',
            anchor.template_remote_interface = 'config system interface\\nedit "port4"\\nconfig subinterface\\nedit "port4_VLAN300"\\nset vlanid 300\\nset ip @REMOTE_VLAN_IP@ 255.255.255.0\\nnext\\nend',
            anchor.template_remote_config = 'config firewall policy\\nedit 0\\nset srcintf "port3"\\nset dstintf "VPN"\\nset srcaddr "192.168.106.0/24"\\nset dstaddr "10.0.0.0/16"\\nset action accept\\nnext\\nend'

        MERGE (loc:Location {name: locationName})

        MERGE (dc_loc:Location:Container {name: 'Asker CSLAB'})
        ON CREATE SET dc_loc.base_n = 100
        MERGE (dc_loc)-[:HAS_CENTRAL_DEVICE]->(anchor)

        SET loc.base_n = coalesce(loc.base_n, 10)
        WITH anchor, loc, dc_loc, newProjectName, sharedKeyPrefix

        // 2. Find the current highest project index 'n'
        OPTIONAL MATCH (loc)-[:HAS_EDGE_DEVICE]->(existing:Firewall)
        WITH anchor, loc, dc_loc, newProjectName, sharedKeyPrefix, coalesce(max(existing.ip_n), loc.base_n - 1) AS max_n

        // 3. Calculate IPs/Subnets.
        WITH anchor, loc, dc_loc, newProjectName, sharedKeyPrefix, max_n + 1 AS next_n
        WITH anchor, loc, dc_loc, newProjectName, sharedKeyPrefix, next_n,
            '10.' + toString(next_n) + '.0.0/16' AS project_subnet_cidr,
            '10.' + toString(next_n) + '.106.0/24' AS nat_subnet_cidr,
            '10.' + toString(next_n) + '.106.3' AS nat_ip_3,
            '10.' + toString(next_n) + '.30.1/24' AS remote_vlan_ip,
            '10.' + toString(next_n) + '.30.254' AS remote_fw_lan_ip,
            '10.' + toString(dc_loc.base_n) + '.0.0/16' AS dc_lan_cidr,
            sharedKeyPrefix + toString(next_n) AS shared_key,
            'csteam.fortiddns.com' AS dc_wan_ip
        
        // 4. Create the new Edge Firewall node.
        CREATE (edge:Firewall:NetworkDevice {
            model: 'FortiGate 60F',
            hostname: left(loc.name, 3) + '-' + newProjectName,
            name: newProjectName,
            project_id: left(loc.name, 3) + '-' + newProjectName,
            ip_n: next_n,
            site: loc.name,
            lan_cidr: project_subnet_cidr,
            nat_cidr: nat_subnet_cidr,
            remote_mgmt_ip_with_mask: remote_vlan_ip,
            nat_source_ip: nat_ip_3,
            fw_lan_ip: remote_fw_lan_ip
        })

        // 5. Create relationships.
        CREATE (loc)-[:HAS_EDGE_DEVICE]->(edge)
        CREATE (edge)-[:VPN_TUNNEL_TO {tunnel_type: 'IPsec', status: 'Proposed', remote_id: edge.hostname}]->(anchor)

        // 6. Generate Configuration Snippets and attach them as properties to the Edge Firewall.
        WITH edge, anchor, nat_subnet_cidr, dc_lan_cidr, remote_vlan_ip, $shared_key, project_subnet_cidr, dc_wan_ip

        // --- Central Firewall Config ---
        SET edge.config_central_phase1 = replace(replace(replace(anchor.template_central_phase1, '@PROJECT_NAME@', edge.name), '@PROJECT_WAN_IP@', edge.hostname + '_WAN_IP_PLACEHOLDER'), '@SHARED_KEY@', $shared_key)
        SET edge.config_central_phase2 = replace(replace(replace(anchor.template_central_phase2, '@PROJECT_NAME@', edge.name), '@DC_LAN@', dc_lan_cidr), '@PROJECT_NAT_SUBNET@', nat_subnet_cidr)

        // --- Remote Firewall Config ---
        SET edge.config_remote_phase1 = replace(replace(replace(anchor.template_remote_phase1, '@PROJECT_NAME@', edge.name), '@DC_WAN_IP@', dc_wan_ip), '@SHARED_KEY@', $shared_key)
        SET edge.config_remote_phase2 = replace(replace(replace(replace(anchor.template_remote_phase2, '@PROJECT_NAME@', edge.name), '@PROJECT_LAN_CIDR@', project_subnet_cidr), '@DC_LAN@', dc_lan_cidr), '@PROJECT_NAT_SUBNET@', nat_subnet_cidr)
        SET edge.config_remote_interface = replace(anchor.template_remote_interface, '@REMOTE_VLAN_IP@', split(remote_vlan_ip, '/')[0])

        // Shared Key
        SET edge.config_shared_key = $shared_key

        // 7. Return the generated config in the structure the React frontend expects
        RETURN {
            project_name: edge.name,
            hostname: edge.hostname,
            shared_key: edge.config_shared_key,
            config: {
                remote_interface: edge.config_remote_interface,
                remote_phase1: edge.config_remote_phase1,
                remote_phase2: edge.config_remote_phase2,
                central_phase1: edge.config_central_phase1,
                central_phase2: edge.config_central_phase2
            }
        } AS result_details
    `;