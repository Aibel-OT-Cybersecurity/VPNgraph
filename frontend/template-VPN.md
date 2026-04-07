# Edited node template
config vpn ipsec phase1-interface
edit "P1_@PROJECT_NAME@"
set interface "wan1"
set peertype any
set net-device disable
set proposal aes256-sha256
set remote-gw @DC_WAN_IP@
set psksecret "@SHARED_KEY@"
next
end

# Should add the interface for the tunnel
config vpn ipsec phase1-interface
    edit "VPN_Tunnel_Name"
        set interface "wan1"            # This binds the tunnel to your 5G link
        set peertype any
        set net-device disable
        set proposal aes256-sha256      # Ensure this matches the remote side
        set remote-gw <Remote_IP_Address>
        set psksecret <Your_Secret_Key>
    next
end