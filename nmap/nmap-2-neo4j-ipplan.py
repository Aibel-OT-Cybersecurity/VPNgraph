import csv
from neo4j import GraphDatabase

# --- CONFIGURATION ---
URI = "bolt://localhost:7687"
AUTH = ("neo4j", "SurreHue42!")  # Your actual password
DB_NAME = "nmap-analyzer"                   # YOUR SPECIFIC DATABASE NAME
CSV_FILE = "ip-plan-telecom.csv"
# ---------------------

# --- HELPER FUNCTION ---
def generate_hostname_from_rds_pp(rds_pp_tag):
    """
    Generates a hostname by stripping leading '=', all dashes '-', and leading zeros.
    """
    if not rds_pp_tag:
        return None
    
    # 1. Strip off the leading '='
    hostname = rds_pp_tag.lstrip('=')
    
    # 2. Strip all dashes
    hostname = hostname.replace('-', '')
    
    # 3. Strip leading zeros
    # Handle cases like "0", "000" where lstrip('0') would result in an empty string
    if hostname.strip('0') == '': 
        hostname = '0' if hostname else None # If it was just '000', return '0', else None if empty
    else:
        hostname = hostname.lstrip('0')
        
    return hostname if hostname else None # Return None if the result is an empty string

# --- NEO4J IMPORT FUNCTION ---
def import_ip_plan(tx, row):
    """
    Merges Host nodes and updates properties based on the IP plan CSV.
    - Matches on IP.
    - Sets plan_hostname (preferring Host_name from CSV, then generated from TAG).
    - Sets description, rds_pp, vlan_id, and mask.
    - Adds source_ip_plan=true flag.
    """
    # Use .get() for robustness, in case a column is missing in some rows
    ip = row.get('IP')
    vlan_id = row.get('VLAN_ID')
    host_name_from_csv = row.get('Host_name')
    mask = row.get('Mask')
    comments = row.get('Comments')
    rds_pp_tag = row.get('TAG')

    if not ip: # Skip rows that don't have an IP address
        print(f"Skipping row due to missing IP: {row}")
        return

    # Generate a hostname from rds_pp_tag
    generated_hostname = generate_hostname_from_rds_pp(rds_pp_tag)
    
    # Determine the final plan_hostname: prefer CSV Host_name, otherwise generated
    final_hostname_for_plan = None
    if host_name_from_csv:
        final_hostname_for_plan = host_name_from_csv
    elif generated_hostname:
        final_hostname_for_plan = generated_hostname

    query = """
    MERGE (h:Host {ip: $ip})
    
    SET h.plan_hostname = $final_hostname_for_plan,
        h.description = $comments,
        h.rds_pp = $rds_pp_tag,
        h.vlan_id = $vlan_id,
        h.mask = $mask,
        h.source_ip_plan = true
    """

    # Parameters for the Cypher query
    params = {
        'ip': ip,
        'final_hostname_for_plan': final_hostname_for_plan,
        'comments': comments,
        'rds_pp_tag': rds_pp_tag,
        'vlan_id': vlan_id,
        'mask': mask
    }
    
    tx.run(query, params)

# --- MAIN EXECUTION ---
def main():
    driver = GraphDatabase.driver(URI, auth=AUTH)
    
    print(f"Reading {CSV_FILE} and updating database '{DB_NAME}'...")

    try:
        # Open the CSV file. using DictReader so we can access columns by name.
        # 'utf-8-sig' handles Byte Order Mark (BOM) often added by Excel on Windows.
        with open(CSV_FILE, mode='r', encoding='utf-8-sig') as f: 
            reader = csv.DictReader(f)
            
            with driver.session(database=DB_NAME) as session:
                count = 0
                for row in reader:
                    # Clean up data (strip leading/trailing whitespace from all values)
                    clean_row = {k: v.strip() for k, v in row.items()}
                    
                    session.execute_write(import_ip_plan, clean_row)
                    count += 1
                    if count % 50 == 0: # Print update every 50 rows
                        print(f"Processed {count} rows...", end='\r')
                        
                print(f"\nSuccessfully processed {count} IP Plan rows.")
                
    except FileNotFoundError:
        print(f"Error: Could not find file {CSV_FILE}. Please ensure it's in the same directory or provide full path.")
    except KeyError as e:
        print(f"Error: Your CSV is missing a required column header! Missing: {e}. "
              "Expected headers: IP, Host_name, Comments, TAG, VLAN_ID, Mask.")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

    finally:
        driver.close()

if __name__ == "__main__":
    main()
