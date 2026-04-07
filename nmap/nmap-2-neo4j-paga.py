import csv
from neo4j import GraphDatabase

# --- CONFIGURATION ---
URI = "bolt://localhost:7687"
AUTH = ("neo4j", "SurreHue42!")  # Your actual password
DB_NAME = "nmap-analyzer"                   # YOUR SPECIFIC DATABASE NAME
IP_PLAN_CSV = "ip-plan-telecom.csv"
TELECOM_LIST_CSV = "tele.csv"              # New: Path to your first new list
PAGA_LIST_CSV = "paga.csv"                  # New: Path to your PAGA list
# ---------------------

# --- HELPER FUNCTION ---
def generate_hostname_from_rds_pp(rds_pp_tag):
    """
    Generates a hostname by stripping leading '=', all dashes '-', and leading zeros.
    """
    if not rds_pp_tag:
        return None
    
    hostname = rds_pp_tag.lstrip('=')
    hostname = hostname.replace('-', '')
    
    if hostname.strip('0') == '': 
        hostname = '0' if hostname else None
    else:
        hostname = hostname.lstrip('0')
        
    return hostname if hostname else None

# --- NEO4J IMPORT FUNCTIONS ---

# Function for IP Plan (existing)
def import_ip_plan(tx, row):
    ip = row.get('IP')
    vlan_id = row.get('VLAN_ID')
    host_name_from_csv = row.get('Host_name')
    mask = row.get('Mask')
    comments = row.get('Comments')
    rds_pp_tag = row.get('TAG')

    if not ip:
        print(f"Skipping IP Plan row due to missing IP: {row}")
        return

    generated_hostname = generate_hostname_from_rds_pp(rds_pp_tag)
    
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
    
    params = {
        'ip': ip,
        'final_hostname_for_plan': final_hostname_for_plan,
        'comments': comments,
        'rds_pp_tag': rds_pp_tag,
        'vlan_id': vlan_id,
        'mask': mask
    }
    
    tx.run(query, params)

# NEW: Function for TELECOM
def import_generic_list_data(tx, row):
    ip = row.get('ip') # Assuming 'ip' column in CSV
    asset_tag = row.get('asset_tag') # Example field
    department = row.get('department') # Example field
    owner = row.get('owner') # Example field

    if not ip:
        print(f"Skipping Generic List row due to missing IP: {row}")
        return

    query = """
    MERGE (h:Host {ip: $ip})
    SET h.asset_tag = $asset_tag,
        h.department = $department,
        h.owner = $owner,
        h.source_generic_list = true
    """
    
    params = {
        'ip': ip,
        'asset_tag': asset_tag,
        'department': department,
        'owner': owner
    }
    tx.run(query, params)

# NEW: Function for PAGA List
def import_paga_list_data(tx, row):
    ip = row.get('ip') # Assuming 'ip' column in CSV
    username = row.get('Username') # Example field for username
    password = row.get('Password') # Example field for password (WITH CAUTION!)
    domainIP = row.get('DOMAIN-IP') # Example additional field
    paga_description = row.get('Description') # Example additional field
    paga_comments = row.get('Comments') # Example additional field

    if not ip:
        print(f"Skipping PAGA List row due to missing IP: {row}")
        return

    query = """
    MERGE (h:Host {ip: $ip})
    SET h.paga_username = $username,
        h.paga_password = $password, // WARNING: Storing cleartext passwords!
        h.paga_description = $paga_description,
        h.source_paga_list = true
    """
    
    params = {
        'ip': ip,
        'username': username,
        'password': password,
        'paga_description': paga_description
    }
    tx.run(query, params)


# --- MAIN EXECUTION ---
def main():
    driver = GraphDatabase.driver(URI, auth=AUTH)
    
    # Process IP Plan CSV (your existing one)
    print(f"Reading {IP_PLAN_CSV} and updating database '{DB_NAME}'...")
    try:
        with open(IP_PLAN_CSV, mode='r', encoding='utf-8-sig') as f: 
            reader = csv.DictReader(f)
            with driver.session(database=DB_NAME) as session:
                count = 0
                for row in reader:
                    clean_row = {k: v.strip() for k, v in row.items()}
                    session.execute_write(import_ip_plan, clean_row)
                    count += 1
                    if count % 50 == 0:
                        print(f"Processed {count} IP Plan rows...", end='\r')
                print(f"\nSuccessfully processed {count} IP Plan rows.")
    except FileNotFoundError:
        print(f"Error: Could not find file {IP_PLAN_CSV}.")
    except KeyError as e:
        print(f"Error in {IP_PLAN_CSV}: Missing column header! Missing: {e}.")
    except Exception as e:
        print(f"An unexpected error occurred during IP Plan import: {e}")

    # Process Generic List CSV
    print(f"\nReading {GENERIC_LIST_CSV} and updating database '{DB_NAME}'...")
    try:
        with open(GENERIC_LIST_CSV, mode='r', encoding='utf-8-sig') as f: 
            reader = csv.DictReader(f)
            with driver.session(database=DB_NAME) as session:
                count = 0
                for row in reader:
                    clean_row = {k: v.strip() for k, v in row.items()}
                    import_generic_list_data(session.execute_write, clean_row) # Pass the execute_write callable
                    count += 1
                    if count % 50 == 0:
                        print(f"Processed {count} Generic List rows...", end='\r')
                print(f"\nSuccessfully processed {count} Generic List rows.")
    except FileNotFoundError:
        print(f"Error: Could not find file {GENERIC_LIST_CSV}.")
    except KeyError as e:
        print(f"Error in {GENERIC_LIST_CSV}: Missing column header! Missing: {e}.")
    except Exception as e:
        print(f"An unexpected error occurred during Generic List import: {e}")

    # Process PAGA List CSV
    print(f"\nReading {PAGA_LIST_CSV} and updating database '{DB_NAME}'...")
    try:
        with open(PAGA_LIST_CSV, mode='r', encoding='utf-8-sig') as f: 
            reader = csv.DictReader(f)
            with driver.session(database=DB_NAME) as session:
                count = 0
                for row in reader:
                    clean_row = {k: v.strip() for k, v in row.items()}
                    import_paga_list_data(session.execute_write, clean_row) # Pass the execute_write callable
                    count += 1
                    if count % 50 == 0:
                        print(f"Processed {count} PAGA List rows...", end='\r')
                print(f"\nSuccessfully processed {count} PAGA List rows.")
    except FileNotFoundError:
        print(f"Error: Could not find file {PAGA_LIST_CSV}.")
    except KeyError as e:
        print(f"Error in {PAGA_LIST_CSV}: Missing column header! Missing: {e}.")
    except Exception as e:
        print(f"An unexpected error occurred during PAGA List import: {e}")

    finally:
        driver.close()

if __name__ == "__main__":
    main()
