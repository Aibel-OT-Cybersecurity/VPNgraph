import xml.etree.ElementTree as ET
from neo4j import GraphDatabase

# --- CONFIGURATION ---
URI = "bolt://localhost:7687"
AUTH = ("neo4j", "SurreHue42!")  # Update this
XML_FILE = "telecom-Utility-net-Link1 copy.xml"
DB_NAME = "nmap-analyzer"                   # <--- YOUR SPECIFIC DATABASE NAME
# ---------------------

def import_nmap_data(tx, ip_address, hostname, port_id, protocol, service_name, state):
    """
    Cypher query to merge nodes and relationships.
    """
    query = """
    MERGE (h:Host {ip: $ip})
    SET h.hostname = $hostname
    
    MERGE (p:Port {port: $port, protocol: $protocol})
    
    MERGE (h)-[r:HAS_OPEN_PORT]->(p)
    SET r.service = $service,
        r.state = $state
    """
    tx.run(query, ip=ip_address, hostname=hostname, port=port_id, 
           protocol=protocol, service=service_name, state=state)

def main():
    # 1. Connect to the Neo4j DBMS (Server)
    # The connection is to the server instance, not the specific DB yet.
    driver = GraphDatabase.driver(URI, auth=AUTH)
    
    # 2. Parse the XML
    try:
        tree = ET.parse(XML_FILE)
        root = tree.getroot()
    except FileNotFoundError:
        print(f"Error: Could not find file {XML_FILE}")
        return

    print(f"Starting import into database: '{DB_NAME}'...")

    # 3. Open a Session specifically for your 'nmap' database
    # This is where we tell the driver which DB to use.
    with driver.session(database=DB_NAME) as session:
        
        # Iterate through every <host> tag in the XML
        for host in root.findall('host'):
            
            # Get IP Address
            address_element = host.find("./address[@addrtype='ipv4']")
            ip = address_element.get('addr') if address_element is not None else "Unknown"
            
            # Get Hostname
            hostnames_element = host.find("./hostnames/hostname")
            hostname = hostnames_element.get('name') if hostnames_element is not None else "Unknown"

            # Get Ports
            ports_element = host.find('ports')
            if ports_element:
                for port in ports_element.findall('port'):
                    port_id = int(port.get('portid'))
                    protocol = port.get('protocol')
                    
                    state_el = port.find('state')
                    state = state_el.get('state') if state_el is not None else "unknown"

                    service_el = port.find('service')
                    service_name = service_el.get('name') if service_el is not None else "unknown"

                    if state == 'open':
                        session.execute_write(import_nmap_data, ip, hostname, port_id, protocol, service_name, state)
                        print(f"Imported: {ip} -> Port {port_id}/{protocol}")

    driver.close()
    print("Import finished.")

if __name__ == "__main__":
    main()
