const express = require('express');
const cors = require('cors');
// 1. FIX: Import the crypto module for secure PSK generation
const crypto = require('crypto'); 
const neo4j = require('neo4j-driver');

const app = express();
const port = 4000;

// --- CONFIGURATION ---
const URI = 'bolt://localhost:7687';
const USER = 'neo4j';
const PASSWORD = 'SurreHue42!'; 
const DATABASE_NAME = 'secsi-vpn'; 

// 1. Initialize Neo4j Driver
const driver = neo4j.driver(URI, neo4j.auth.basic(USER, PASSWORD));

// Middleware
const corsOptions = {
    origin: ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000', 'http://127.0.0.1:5173'],
    methods: 'GET,POST',
    allowedHeaders: 'Content-Type,Authorization',
};
app.use(cors(corsOptions)); 
app.use(express.json());

// --- UTILITY FUNCTION FOR RUNNING CYPHER ---
const runCypher = async (query, params = {}) => {
    const session = driver.session({ database: DATABASE_NAME }); 
    try {
        const result = await session.run(query, params);
        return result.records.map(record => record.toObject());
    } catch (error) {
        console.error('Neo4j Query Error:', error);
        throw new Error('Database query failed. Check credentials, database name, and Neo4j service status.');
    } finally {
        await session.close();
    }
};


// --- API ENDPOINTS ---

// GET /api/sites - Retrieves all Location nodes and their linked devices
app.get('/api/sites', async (req, res) => {
    const query = `
        MATCH (site:Location)
        OPTIONAL MATCH (site)-[:HAS_CENTRAL_DEVICE]->(central:Firewall)
        OPTIONAL MATCH (site)-[:HAS_EDGE_DEVICE]->(edge:Firewall)
        
        WITH site, collect(
            CASE WHEN central IS NOT NULL THEN {
                hostname: central.hostname,
                model: central.model,
                type: 'Central Anchor'
            } END
        ) AS central_devices,
        collect(
            CASE WHEN edge IS NOT NULL THEN {
                project_id: edge.project_id,
                hostname: edge.hostname,
                ip_n: edge.ip_n,
                lan_cidr: edge.lan_cidr,
                type: 'Edge Firewall'
            } END
        ) AS edge_projects

        RETURN {
            name: site.name,
            is_dc: 'Container' IN labels(site),
            base_n: site.base_n,
            description: coalesce(site.description, 'Remote Site'),
            devices: central_devices + edge_projects
        } AS site_data
    `;
    
    try {
        const data = await runCypher(query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/projects - Retrieves detailed config for all remote projects
app.get('/api/projects', async (req, res) => {
    const query = `
        MATCH (loc:Location)-[:HAS_EDGE_DEVICE]->(edge:Firewall)
        MATCH (edge)-[:VPN_TUNNEL_TO]->(anchor:Firewall)

        RETURN {
            project_name: edge.name,
            project_id: edge.project_id,
            location: loc.name,
            hostname: edge.hostname,
            ip_index: edge.ip_n,
            lan_cidr: edge.lan_cidr,
            nat_cidr: edge.nat_cidr,
            ddns_hostname: coalesce(edge.ddns_hostname, 'N/A'),
            // Extract the calculated Remote Management IP for display
            mgmt_vlan_ip: split(coalesce(edge.remote_mgmt_ip_with_mask, '0.0.0.0/0'), '/')[0], 
            shared_key: coalesce(edge.config_shared_key, 'N/A'),
            config: {
                remote_interface: coalesce(edge.config_remote_interface, 'N/A'),
                remote_phase1: coalesce(edge.config_remote_phase1, 'N/A'),
                remote_phase2: coalesce(edge.config_remote_phase2, 'N/A'),
                central_phase1: coalesce(edge.config_central_phase1, 'N/A'),
                central_phase2: coalesce(edge.config_central_phase2, 'N/A'),
                remote_dhcp: coalesce(edge.config_remote_dhcp, 'N/A'),
                remote_policy: coalesce(edge.config_remote_policy, 'N/A')
            },
            anchor_hostname: anchor.hostname
        } AS project_details
    `;
    
    try {
        const data = await runCypher(query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// POST /api/create-project - Triggers the provisioning logic
app.post('/api/create-project', async (req, res) => {
    // DDNS Hostname is correctly destructured here
    const { locationName, newProjectName, ddnsHostname } = req.body;
    
    if (!locationName || !newProjectName || !ddnsHostname) {
        return res.status(400).json({ error: 'Missing locationName, newProjectName, or ddnsHostname in request body.' });
    }

    // Create random pre shared key for the VPN
    const generatePSK = () => {
        return crypto.randomBytes(24).toString('base64url'); 
    };

    // Generate the PSK in Node.js
    const shared_key = generatePSK(); 


    // This is the Cypher logic from the 'add_new_project.cypher' file
    const query = `
        // Parameters used: locationName, newProjectName
        WITH $locationName AS locationName, $newProjectName AS newProjectName

        // 1. MERGE the central firewall and location nodes (guarantee templates exist)
        MERGE (anchor:Firewall {name: 'ASK-FW01'})
        ON CREATE SET 
            // Set basic properties if the node is created for the first time
            anchor.model = 'FortiGate 100F',
            anchor.hostname = 'ASK-FW01',
            anchor.description = 'Central VPN Anchor and DC Firewall',
            anchor.base_n = 100

        // CRITICAL FIX: Always SET the templates here to ensure they are up-to-date 
        // and do not contain old, static placeholders.
        SET 
            // TEMPLATES FOR CENTRAL FIREWALL (ASK-FW01)
            // @PROJECT_WAN_IP@ will be replaced by the DDNS Hostname (FQDN)
            anchor.template_central_phase1 = 'config vpn ipsec phase1-interface\\nedit "P1_@PROJECT_NAME@"\\nset remote-gw @PROJECT_WAN_IP@\\nset psksecret "@SHARED_KEY@"\\nnext\\nend',
            anchor.template_central_phase2 = 'config vpn ipsec phase2-interface\\nedit "P2_@PROJECT_NAME@"\\nset phase1name "P1_@PROJECT_NAME@"\\nset src-subnet @DC_LAN@\\nset dst-subnet @PROJECT_LAN_ADDRESS@ 255.255.0.0\\nnext\\nend',
            
            // TEMPLATES FOR REMOTE FIREWALL (EDGE)
            //OLD//anchor.template_remote_phase1 = 'config vpn ipsec phase1-interface\\nedit "P1_@PROJECT_NAME@"\\nset remote-gw @DC_WAN_IP@\\nset psksecret "@SHARED_KEY@"\\nnext\\nend',
            anchor.template_remote_phase1 = 'config vpn ipsec phase1-interface\\nedit "P1_@PROJECT_NAME@"\\nset interface "wan1"\\nset peertype any\\nset net-device disable\\nset proposal aes256-sha256\\nset remote-gw @DC_WAN_IP@\\nset psksecret "@SHARED_KEY@"\\nnext\\nend',

            anchor.template_remote_phase2 = 'config vpn ipsec phase2-interface\\nedit "P2_@PROJECT_NAME@"\\nset phase1name "P1_@PROJECT_NAME@"\\nset src-subnet @PROJECT_LAN_CIDR@\\nset dst-subnet @DC_LAN@\\nnext\\nend',
            
            // --- REMOTE MANAGEMENT INTERFACE (port5 physical, ping https ssh enabled) ---
            // @REMOTE_VLAN_IP_NO_MASK@ will be replaced by the CALCULATED IP (e.g., 10.X.30.1)
            anchor.template_remote_interface = 'config system interface\\nedit "port5"\\nset ip @REMOTE_VLAN_IP_NO_MASK@ 255.255.255.0\\nset allowaccess ping https ssh\\nset type physical\\nnext\\nend',
            
            // --- REMOTE DHCP SERVER (port5, range 10.X.30.9-19) ---
            anchor.template_remote_dhcp = 'config system dhcp server\\nedit 1\\nset interface "port5"\\nconfig ip-range\\nedit 1\\nset start-ip @DHCP_START_IP@\\nset end-ip @DHCP_END_IP@\\nnext\\nend\\nnext\\nend',
            
            // --- REMOTE OUTBOUND POLICY (port5 Mgmt -> VPN) ---
            anchor.template_remote_policy = 'config firewall policy\\nedit 0\\nset name "VPN_to_DC"\\nset srcintf "port5"\\nset dstintf "P1_@PROJECT_NAME@"\\nset srcaddr "all"\\nset dstaddr "10.100.0.0/16"\\nset action accept\\nset schedule "always"\\nset service "ALL"\\nset nat disable\\nnext\\nend',

            anchor.template_remote_config = 'config firewall policy\\nedit 0\\nset srcintf "port3"\\nset dstintf "VPN"\\nset srcaddr "192.168.106.0/24"\\nset dstaddr "10.100.0.0/16"\\nset action accept\\nnext\\nend'

        MERGE (loc:Location {name: locationName})

        MERGE (dc_loc:Location:Container {name: 'Asker CSLAB'})
        ON CREATE SET dc_loc.base_n = 100
        MERGE (dc_loc)-[:HAS_CENTRAL_DEVICE]->(anchor)

        SET loc.base_n = coalesce(loc.base_n, 10)
        WITH anchor, loc, dc_loc, newProjectName

        // 2. Find the current highest project index 'n'
        OPTIONAL MATCH (loc)-[:HAS_EDGE_DEVICE]->(existing:Firewall)
        // Note: next_n becomes the second octet (e.g., 11 if base_n is 10)
        WITH anchor, loc, dc_loc, newProjectName, coalesce(max(existing.ip_n), loc.base_n - 1) AS max_n

        // 3. Calculate IPs/Subnets.
        WITH anchor, loc, dc_loc, newProjectName, max_n + 1 AS next_n
        // Pass DDNS hostname and PSK to Cypher scope
        WITH anchor, loc, dc_loc, newProjectName, next_n, $shared_key AS shared_key, $ddnsHostname AS ddns_hostname,
            '10.' + toString(next_n) + '.0.0/16' AS project_subnet_cidr,
            '10.' + toString(next_n) + '.0.0' AS project_lan_address, 
            '10.' + toString(next_n) + '.106.0/24' AS nat_subnet_cidr,
            '10.' + toString(next_n) + '.106.3' AS nat_ip_3,
            '10.' + toString(next_n) + '.30.1/24' AS remote_vlan_ip,
            '10.' + toString(next_n) + '.30.9' AS dhcp_start_ip,
            '10.' + toString(next_n) + '.30.19' AS dhcp_end_ip, 
            '10.' + toString(dc_loc.base_n) + '.0.0/16' AS dc_lan_cidr,
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
            ddns_hostname: ddns_hostname // Store the DDNS name on the edge node
        })

        // 5. Create relationships.
        CREATE (loc)-[:HAS_EDGE_DEVICE]->(edge)
        CREATE (edge)-[:VPN_TUNNEL_TO {tunnel_type: 'IPsec', status: 'Proposed', remote_id: edge.hostname}]->(anchor)

        // 6. Generate Configuration Snippets and attach them as properties to the Edge Firewall.
        WITH edge, anchor, nat_subnet_cidr, dc_lan_cidr, remote_vlan_ip, shared_key, project_subnet_cidr, dc_wan_ip, project_lan_address, dhcp_start_ip, dhcp_end_ip, ddns_hostname

        // --- Central Firewall Config (FIXED) ---
        // DDNS Hostname (FQDN) is injected into remote-gw
        SET edge.config_central_phase1 = replace(replace(replace(anchor.template_central_phase1, '@PROJECT_NAME@', edge.name), '@PROJECT_WAN_IP@', ddns_hostname), '@SHARED_KEY@', shared_key)
        SET edge.config_central_phase2 = replace(replace(replace(anchor.template_central_phase2, '@PROJECT_NAME@', edge.name), '@DC_LAN@', dc_lan_cidr), '@PROJECT_LAN_ADDRESS@', project_lan_address)

        // --- Remote Firewall Config ---
        SET edge.config_remote_phase1 = replace(replace(replace(anchor.template_remote_phase1, '@PROJECT_NAME@', edge.name), '@DC_WAN_IP@', dc_wan_ip), '@SHARED_KEY@', shared_key)
        SET edge.config_remote_phase2 = replace(replace(replace(replace(anchor.template_remote_phase2, '@PROJECT_NAME@', edge.name), '@PROJECT_LAN_CIDR@', project_subnet_cidr), '@DC_LAN@', dc_lan_cidr), '@PROJECT_NAT_SUBNET@', nat_subnet_cidr)
        
        // Remote Interface (port5) - Uses CALCULATED IP
        SET edge.config_remote_interface = replace(anchor.template_remote_interface, '@REMOTE_VLAN_IP_NO_MASK@', split(remote_vlan_ip, '/')[0])
        
        // DHCP Server (port5)
        SET edge.config_remote_dhcp = replace(replace(anchor.template_remote_dhcp, '@DHCP_START_IP@', dhcp_start_ip), '@DHCP_END_IP@', dhcp_end_ip)
        
        // Remote Policy (port5 -> VPN)
        SET edge.config_remote_policy = replace(replace(anchor.template_remote_policy, '@PROJECT_NAME@', edge.name), '@DC_LAN_CIDR@', dc_lan_cidr)


        // Shared Key
        SET edge.config_shared_key = shared_key

        // 7. Return the generated config in the structure the React frontend expects
        RETURN {
            project_name: edge.name,
            hostname: edge.hostname,
            ddns_hostname: edge.ddns_hostname, 
            shared_key: edge.config_shared_key,
            // Calculate and return the interface IP without the mask for the frontend to display
            remote_wan_ip: split(remote_vlan_ip, '/')[0], 
            lan_cidr: project_subnet_cidr, // Added LAN CIDR for completeness
            config: {
                remote_interface: edge.config_remote_interface,
                remote_phase1: edge.config_remote_phase1,
                remote_phase2: edge.config_remote_phase2,
                central_phase1: edge.config_central_phase1,
                central_phase2: edge.config_central_phase2,
                remote_dhcp: edge.config_remote_dhcp,
                remote_policy: edge.config_remote_policy
            }
        } AS result_details
    `;
    
    try {
        // Pass the generated shared_key and the DDNS hostname as parameters
        const data = await runCypher(query, { locationName, newProjectName, shared_key, ddnsHostname });
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Start the Express server
app.listen(port, () => {
    console.log(`Express server listening at http://localhost:${port}`);
    console.log('Ensure the Neo4j database is running and credentials are correct.');
});