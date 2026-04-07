import React, { useState, useEffect, useCallback } from 'react';
import {
  Wrench,
  Server,
  MapPin,
  List,
  PlusCircle,
  Loader2,
  AlertTriangle,
  CheckCircle,
  Copy,
  LayoutGrid,
} from 'lucide-react';

// --- Placeholder/Simulated API Configuration ---
const API_BASE_URL = 'http://localhost:4000/api'; // Targeting port 4000
const API_SITES = `${API_BASE_URL}/sites`;
const API_PROJECTS = `${API_BASE_URL}/projects`;
const API_CREATE_PROJECT = `${API_BASE_URL}/create-project`;

const apiKey = ""; 

const App = () => {
  const [sites, setSites] = useState([]);
  const [projects, setProjects] = useState([]);
  const [selectedSite, setSelectedSite] = useState('');
  const [newProjectName, setNewProjectName] = useState('');
  const [ddnsHostname, setDdnsHostname] = useState(''); 
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState({ type: null, text: '' });
  const [creationResult, setCreationResult] = useState(null);

  // Utility function for robust API fetching with exponential backoff
  const fetchWithRetry = useCallback(async (url, options = {}, maxRetries = 5) => {
    let lastError = null;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP error! Status: ${response.status}. Response: ${errorText.substring(0, 100)}...`);
        }
        return await response.json();
      } catch (error) {
        lastError = error;
        const delay = Math.pow(2, i) * 100;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }, []);

  // Fetch Sites (for the dropdown) and Projects (for the list)
  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setMessage({ type: null, text: '' });
      try {
        const [sitesData, projectsData] = await Promise.all([
          fetchWithRetry(API_SITES),
          fetchWithRetry(API_PROJECTS)
        ]);
        
        // 1. Process Sites Data
        const remoteSites = sitesData
            .filter(item => item && item.site_data)
            .map(item => {
                const siteData = item.site_data;
                if (typeof siteData.base_n === 'object' && siteData.base_n !== null) {
                    siteData.base_n = Number(siteData.base_n);
                }
                return siteData;
            })
            .filter(site => site && !site.is_dc); 
            
        setSites(remoteSites);
        
        // 2. Process Projects Data
        const currentProjects = projectsData
            .filter(item => item && item.project_details)
            .map(item => {
                const projectDetails = item.project_details;
                if (typeof projectDetails.ip_index === 'object' && projectDetails.ip_index !== null) {
                    projectDetails.ip_index = Number(projectDetails.ip_index);
                }
                return projectDetails;
            })
            .filter(p => p); 
            
        setProjects(currentProjects);

        if (remoteSites.length > 0) {
            setSelectedSite(remoteSites[0].name);
            setMessage({ type: 'success', text: `Successfully loaded ${remoteSites.length} remote sites and ${currentProjects.length} existing projects.` });
        } else {
             setMessage({ type: 'warning', text: 'Connection successful, but no remote sites were returned from the database. Ensure your Neo4j database has Location nodes.' });
        }

      } catch (error) {
        setMessage({ type: 'error', text: `Failed to load topology data. Check if your Express server is running on port 4000. Error: ${error.message}` });
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, [fetchWithRetry]);

  // Handle Project Creation
  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!selectedSite || !newProjectName || !ddnsHostname) {
      setMessage({ type: 'error', text: 'Please select a site, enter a project name, and provide the DDNS Hostname FQDN.' });
      return;
    }

    setLoading(true);
    setMessage({ type: 'info', text: `Attempting to provision project: ${newProjectName} at ${selectedSite}...` });
    setCreationResult(null);

    const payload = {
      locationName: selectedSite,
      newProjectName: newProjectName.trim().toUpperCase().replace(/[^A-Z0-9-]/g, ''), 
      ddnsHostname: ddnsHostname.trim(), 
    };

    try {
      const result = await fetchWithRetry(API_CREATE_PROJECT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      // The result should contain the calculated remote_wan_ip and the injected config
      setCreationResult(result[0]?.result_details); 
      setMessage({ type: 'success', text: `Project ${payload.newProjectName} provisioned successfully!` });
      
      const projectsData = await fetchWithRetry(API_PROJECTS);
      const currentProjects = projectsData
            .filter(item => item && item.project_details)
            .map(item => {
                const projectDetails = item.project_details;
                if (typeof projectDetails.ip_index === 'object' && projectDetails.ip_index !== null) {
                    projectDetails.ip_index = Number(projectDetails.ip_index);
                }
                return projectDetails;
            })
            .filter(p => p);
      setProjects(currentProjects);
      setNewProjectName(''); 
      setDdnsHostname(''); 

    } catch (error) {
      setMessage({ type: 'error', text: `Project creation failed: ${error.message}` });
      setCreationResult(null);
    } finally {
      setLoading(false);
    }
  };

  const copyToClipboard = (text) => {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setMessage({ type: 'info', text: 'Configuration copied to clipboard!' });
    } catch (err) {
      setMessage({ type: 'error', text: 'Failed to copy text.' });
    }
  };

  // --- UI Components ---

  const MessageBar = ({ type, text }) => {
    if (!text) return null;
    let Icon = AlertTriangle;
    let colorClass = 'bg-yellow-100 text-yellow-800';

    if (type === 'error') {
      Icon = AlertTriangle;
      colorClass = 'bg-red-100 text-red-800';
    } else if (type === 'success') {
      Icon = CheckCircle;
      colorClass = 'bg-green-100 text-green-800';
    } else if (type === 'info' || type === 'warning') { 
      Icon = type === 'info' ? Loader2 : AlertTriangle;
      colorClass = type === 'info' ? 'bg-blue-100 text-blue-800 animate-pulse' : 'bg-yellow-100 text-yellow-800';
    }

    return (
      <div className={`p-3 rounded-xl flex items-center shadow-lg transition-all ${colorClass}`}>
        <Icon className="w-5 h-5 mr-3" />
        <span className="font-medium text-sm">{text}</span>
      </div>
    );
  };

  const ConfigOutput = ({ result }) => {
    if (!result || !result.config) return null;

    const ddns = result.ddns_hostname || 'N/A'; 
    const remoteWanIp = result.remote_wan_ip || 'N/A'; // Calculated IP from server

    const configSections = [
      { title: 'Remote Edge: Interface (VLAN 300)', key: 'remote_interface', content: result.config.remote_interface },
      { title: 'Remote Edge: VPN Phase 1 (To DC)', key: 'remote_phase1', content: result.config.remote_phase1 },
      { title: 'Remote Edge: VPN Phase 2', key: 'remote_phase2', content: result.config.remote_phase2 },
      { title: 'Central DC: VPN Phase 1 (To Remote Site)', key: 'central_phase1', content: result.config.central_phase1 },
      { title: 'Central DC: VPN Phase 2', key: 'central_phase2', content: result.config.central_phase2 },
    ];

    return (
      <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-xl shadow-xl transition-all duration-300">
        <h3 className="text-xl font-extrabold text-indigo-800 mb-4 flex items-center">
          <Wrench className="w-5 h-5 mr-2" /> Generated Configuration for {result.hostname}
        </h3>
        {/* Clearly show the calculated IP and the FQDN */}
        <p className="mb-2 text-sm font-semibold">
            Remote Site LAN CIDR: <span className="text-purple-700 font-mono p-1 bg-purple-100 rounded-md shadow-inner">{result.lan_cidr}</span>
        </p>
        <p className="mb-2 text-sm font-semibold">
            Remote Site Interface IP: <span className="text-blue-700 font-mono p-1 bg-blue-100 rounded-md shadow-inner">{remoteWanIp}</span>
        </p>
        <p className="mb-4 text-sm font-semibold">
            VPN Remote Gateway (DDNS FQDN): <span className="text-green-700 font-mono p-1 bg-green-100 rounded-md shadow-inner">{ddns}</span>
        </p>
        <p className="mb-4 text-sm font-semibold">
            Shared Key: <span className="text-red-700 font-mono p-1 bg-red-100 rounded-md shadow-inner">{result.shared_key}</span>
        </p>

        <div className="space-y-4">
          {configSections.map(section => (
            <div key={section.key} className="p-4 bg-white border border-indigo-200 rounded-xl shadow-lg">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-bold text-indigo-700">{section.title}</h4>
                <button
                  onClick={() => copyToClipboard(section.content)}
                  className="text-gray-500 hover:text-indigo-600 transition duration-150 p-2 rounded-full bg-indigo-50 hover:bg-indigo-100"
                  title="Copy to Clipboard"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <pre className="text-xs font-mono bg-gray-900 text-white p-3 rounded-lg overflow-x-auto whitespace-pre-wrap shadow-inner">
                {section.content}
              </pre>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const ExistingProjectsList = ({ projects }) => {
    return (
      <div className="bg-white p-6 rounded-2xl shadow-2xl h-full border-4 border-indigo-300 transition-all duration-300 hover:shadow-indigo-500/50">
        <h2 className="text-2xl font-extrabold text-gray-900 mb-4 border-b-2 border-indigo-200 pb-2 flex items-center">
          <List className="w-6 h-6 mr-2 text-indigo-600" /> Existing Projects
        </h2>
        <div className="space-y-3 overflow-y-auto max-h-[400px]">
          {projects.length === 0 ? (
            <p className="text-gray-500 italic p-3 bg-yellow-50 rounded-lg">No projects found. Create one to establish naming conventions.</p>
          ) : (
            projects.map((p, index) => (
              <div key={index} className="p-4 bg-indigo-50 rounded-xl shadow-md text-sm border border-indigo-200 transition-transform duration-200 hover:scale-[1.01]">
                <div className="font-bold text-indigo-800">{p.project_name}</div>
                <div className="text-xs text-gray-700 mt-1">
                    <span className="font-mono">ID: {p.project_id}</span> | 
                    <span className="font-mono ml-2">CIDR: {p.lan_cidr}</span>
                </div>
                <div className="text-xs text-gray-500 mt-1 font-mono">Host: {p.hostname}</div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  };
  
  const sanitizedNewProjectName = newProjectName.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const derivedHostname = selectedSite && sanitizedNewProjectName
    ? `${selectedSite.substring(0, 3).toUpperCase()}-${sanitizedNewProjectName}`
    : '???-PROJECTNAME';
    
  return (
    <div className="w-full min-h-screen bg-gradient-to-br from-cyan-300/40 to-indigo-500/40 p-4 md:p-8 font-['Inter']">
      <div className="max-w-7xl mx-auto space-y-8">
        
        <header className="text-center pb-4 border-b-4 border-indigo-500">
          <h1 className="text-5xl font-extrabold text-gray-900 flex items-center justify-center">
            <LayoutGrid className="w-10 h-10 mr-4 text-indigo-700" />
            Project VPN Provisioning
          </h1>
          <p className="text-gray-600 mt-2 text-lg">Automated provisioning interface for network infrastructure.</p>
        </header>
        
        <MessageBar type={message.type} text={message.text} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-2 bg-white p-8 rounded-3xl shadow-[0_20px_50px_rgba(0,0,0,0.2)] border-4 border-indigo-100 transition-all duration-300 hover:shadow-indigo-400/70">
            <h2 className="text-3xl font-extrabold text-gray-800 mb-6 border-b-2 border-gray-200 pb-3 flex items-center">
              <PlusCircle className="w-6 h-6 mr-2 text-indigo-600" /> Create New Project VPN
            </h2>

            <form onSubmit={handleCreateProject} className="space-y-6">
              
              {/* Site Selection */}
              <div className="space-y-2">
                <label htmlFor="site-select" className="block text-base font-semibold text-gray-700 flex items-center">
                  <MapPin className="w-5 h-5 mr-2 text-red-600" /> 1. Select Remote Site
                </label>
                <select
                  id="site-select"
                  value={selectedSite}
                  onChange={(e) => setSelectedSite(e.target.value)}
                  disabled={loading || sites.length === 0}
                  className="mt-1 block w-full pl-4 pr-12 py-3 text-base border-2 border-gray-300 focus:outline-none focus:ring-indigo-600 focus:border-indigo-600 rounded-xl shadow-lg transition duration-200"
                >
                  {loading && <option>Loading Sites...</option>}
                  {sites.map(site => (
                    <option key={site.name} value={site.name}>
                      {site.name} (Base IP: 10.{site.base_n}.x.x)
                    </option>
                  ))}
                </select>
              </div>

              {/* Project Name Input */}
              <div className="space-y-2">
                <label htmlFor="project-name" className="block text-base font-semibold text-gray-700 flex items-center">
                  <Server className="w-5 h-5 mr-2 text-indigo-600" /> 2. Enter Project Short Name (e.g., HOW3-L1)
                </label>
                <input
                  type="text"
                  id="project-name"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="Enter project short name (e.g., ALPHA-WIND)"
                  disabled={loading}
                  className="mt-1 block w-full border-2 border-gray-300 rounded-xl shadow-lg py-3 px-4 focus:outline-none focus:ring-indigo-600 focus:border-indigo-600 uppercase transition duration-200"
                />
              </div>

              {/* Derived Hostname Preview */}
              <div className="p-4 bg-indigo-100 border-2 border-indigo-300 rounded-xl text-md font-bold shadow-inner">
                <span className="text-indigo-800">Derived Hostname (Local):</span>{' '}
                <span className="font-mono text-indigo-900 bg-indigo-200 px-2 py-0.5 rounded-md">{derivedHostname}</span>
              </div>
              
              {/* DDNS Hostname Input (Step 3) */}
              <div className="space-y-2">
                <label htmlFor="ddns-hostname" className="block text-base font-semibold text-gray-700 flex items-center">
                  <Server className="w-5 h-5 mr-2 text-green-600" /> 3. Enter DDNS Hostname FQDN (Used by DC VPN)
                </label>
                <input
                  type="text"
                  id="ddns-hostname"
                  value={ddnsHostname}
                  onChange={(e) => setDdnsHostname(e.target.value)}
                  placeholder="Enter the full DDNS FQDN (e.g., OSL-PROJ-L1.fortiddns.com)"
                  disabled={loading}
                  className="mt-1 block w-full border-2 border-gray-300 rounded-xl shadow-lg py-3 px-4 focus:outline-none focus:ring-indigo-600 focus:border-indigo-600 transition duration-200"
                  required
                />
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading || !selectedSite || !newProjectName || !ddnsHostname}
                className={`w-full flex justify-center items-center py-4 px-4 border border-transparent rounded-xl shadow-2xl text-lg font-extrabold text-white transition-all duration-300 transform ${
                  loading || !selectedSite || !newProjectName || !ddnsHostname
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-4 focus:ring-offset-2 focus:ring-indigo-500 hover:scale-[1.01] active:scale-[0.98]'
                }`}
              >
                {loading ? (
                  <>
                    <Loader2 className="w-6 h-6 mr-3 animate-spin" />
                    Provisioning...
                  </>
                ) : (
                  '4. Provision Project and Generate Config'
                )}
              </button>
            </form>

            <ConfigOutput result={creationResult} />

          </div>
          
          {/* Existing Projects List (Right Column) */}
          <div className="lg:col-span-1">
            <ExistingProjectsList projects={projects} />
          </div>

        </div>
      </div>
    </div>
  );
};

export default App;