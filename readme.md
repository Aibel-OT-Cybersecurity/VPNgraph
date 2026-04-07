# Neo4j Web Interface for VPN Configuration

This document outlines the requirements and functionality for a web interface to manage VPN configurations using Neo4j as the backend database.

## Features

### 1. Create a New VPN Site
The interface will allow users to create a new VPN site by providing the following inputs:
- **Location**: Select from predefined options (Haugesund, Mapthaput, Laem Chabang).
- **Project Name**: Enter the name of the project.

Upon submission, the data will be stored in the Neo4j database with the appropriate structure.

### 2. Retrieve VPN Configuration
The interface will allow users to select a site/project and retrieve its VPN configuration. The retrieved data will include:
- **Project Name**: `edge.name`
- **Edge Hostname**: `edge.hostname`
- **Project LAN**: `edge.lan_cidr`
- **Project NAT Subnet**: `edge.nat_cidr`
- **Shared Key**: `edge.config_shared_key`
- **Central Phase 1 Config**: `edge.config_central_phase1`
- **Central Phase 2 Config**: `edge.config_central_phase2`
- **Remote Phase 1 Config**: `edge.config_remote_phase1`
- **Remote Phase 2 Config**: `edge.config_remote_phase2`
- **Remote Interface Config**: `edge.config_remote_interface`
- **Central Hostname**: `anchor.name`

## Neo4j Data Structure
The data structure in Neo4j is as follows:
- `edge.name AS ProjectName`
- `edge.hostname AS EdgeHostname`
- `edge.lan_cidr AS ProjectLAN`
- `edge.nat_cidr AS ProjectNATSubnet`
- `edge.config_shared_key AS SharedKey`
- `edge.config_central_phase1 AS CentralPhase1Config`
- `edge.config_central_phase2 AS CentralPhase2Config`
- `edge.config_remote_phase1 AS RemotePhase1Config`
- `edge.config_remote_phase2 AS RemotePhase2Config`
- `edge.config_remote_interface AS RemoteInterfaceConfig`
- `anchor.name AS CentralHostname`

## Implementation Notes
- The web interface will use a backend service to interact with the Neo4j database.
- The frontend will provide a user-friendly form for creating new sites and a dropdown for selecting existing sites/projects.
- The backend will execute Cypher queries to insert and retrieve data from the Neo4j database.

## Example Cypher Queries

### Create a New Site
```cypher
CREATE (edge:Edge {
    name: $ProjectName,
    hostname: $EdgeHostname,
    lan_cidr: $ProjectLAN,
    nat_cidr: $ProjectNATSubnet,
    config_shared_key: $SharedKey,
    config_central_phase1: $CentralPhase1Config,
    config_central_phase2: $CentralPhase2Config,
    config_remote_phase1: $RemotePhase1Config,
    config_remote_phase2: $RemotePhase2Config,
    config_remote_interface: $RemoteInterfaceConfig
})
RETURN edge
```

### Retrieve VPN Configuration
```cypher
MATCH (edge:Edge)-[:CONNECTED_TO]->(anchor:Anchor)
WHERE edge.name = $ProjectName
RETURN
    edge.name AS ProjectName,
    edge.hostname AS EdgeHostname,
    edge.lan_cidr AS ProjectLAN,
    edge.nat_cidr AS ProjectNATSubnet,
    edge.config_shared_key AS SharedKey,
    edge.config_central_phase1 AS CentralPhase1Config,
    edge.config_central_phase2 AS CentralPhase2Config,
    edge.config_remote_phase1 AS RemotePhase1Config,
    edge.config_remote_phase2 AS RemotePhase2Config,
    edge.config_remote_interface AS RemoteInterfaceConfig,
    anchor.name AS CentralHostname
```

## Next Steps
- Design the frontend interface.
- Implement the backend service to handle Neo4j interactions.
- Test the functionality with sample data.

# Implementation Example

## Introduction and Setup Instructions

To set up the Node.js project for managing VPN configurations with Neo4j, follow these steps:

### Prerequisites
Ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v14 or later)
- [Neo4j Database](https://neo4j.com/download/) (v4.x or later)
- A package manager like `npm` (comes with Node.js) or `yarn`

### Setup Instructions
1. **Clone the Repository**  
    Clone the project repository to your local machine:
    ```bash
    git clone https://github.com/your-repo/neo4j-vpn-config.git
    cd neo4j-vpn-config
    ```
    1. **Initialize the Project**  
        If this is a new project, initialize it with `npm init`:
        ```bash
        npm init -y
        ```
        This will create a `package.json` file to manage dependencies.

    2. **Set Up React (Optional)**  
        If you plan to use React for the frontend, set it up using:
        ```bash
        npx create-react-app frontend
        cd frontend
        npm start
        ```
        This will create a React app in the `frontend` directory and start the development server.
2. **Install Dependencies**  
    Install the required Node.js dependencies:
    ```bash
    npm install
    ```

3. **Configure Neo4j Connection**  
    Update the Neo4j connection details in the `backend` code:
    ```javascript
    const driver = neo4j.driver(
         'bolt://<YOUR_NEO4J_HOST>:7687',
         neo4j.auth.basic('<YOUR_USERNAME>', '<YOUR_PASSWORD>')
    );
    ```

4. **Start the Backend Server**  
    Run the backend server:
    ```bash
    node server.js
    ```
    The server will start on `http://localhost:3000`.

5. **Test the API**  
    Use tools like [Postman](https://www.postman.com/) or `curl` to test the API endpoints:
    - `GET /api/projects` to retrieve existing projects.
    - `POST /api/projects` to create a new project.

6. **Run the Frontend (Optional)**  
    If you have a frontend setup, start it and connect it to the backend API.
    ### Start the React Frontend
    1. Navigate to the `frontend` directory:
        ```bash
        cd frontend
        ```

    2. Install the required dependencies:
        ```bash
        npm install
        ```

    3. Start the development server:
        ```bash
        npm start
        ```

    The React app will be available at `http://localhost:3000` by default. Ensure the backend server is running to enable API communication.

You're now ready to manage VPN configurations using the Node.js project!

### Frontend (React)
```javascript
import React, { useState, useEffect } from 'react';

const App = () => {
    const [projects, setProjects] = useState([]);
    const [formData, setFormData] = useState({
        location: '',
        projectName: '',
        edgeHostname: '',
        projectLAN: '',
        projectNATSubnet: '',
        sharedKey: '',
        centralPhase1Config: '',
        centralPhase2Config: '',
        remotePhase1Config: '',
        remotePhase2Config: '',
        remoteInterfaceConfig: '',
    });

    useEffect(() => {
        fetch('/api/projects')
            .then((res) => res.json())
            .then((data) => setProjects(data));
    }, []);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        setFormData({ ...formData, [name]: value });
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        fetch('/api/projects', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData),
        }).then(() => alert('Project created successfully!'));
    };

    return (
        <div>
            <h1>VPN Configuration</h1>
            <form onSubmit={handleSubmit}>
                <label>
                    Location:
                    <select name="location" onChange={handleInputChange}>
                        <option value="Haugesund">Haugesund</option>
                        <option value="Mapthaput">Mapthaput</option>
                        <option value="Laem Chabang">Laem Chabang</option>
                    </select>
                </label>
                <label>
                    Project Name:
                    <input type="text" name="projectName" onChange={handleInputChange} />
                </label>
                {/* Add other fields similarly */}
                <button type="submit">Create Project</button>
            </form>
            <h2>Existing Projects</h2>
            <ul>
                {projects.map((project) => (
                    <li key={project.name}>{project.name}</li>
                ))}
            </ul>
        </div>
    );
};

export default App;
```

### Backend (Node.js with Express)
```javascript
const express = require('express');
const bodyParser = require('body-parser');
const neo4j = require('neo4j-driver');

const app = express();
app.use(bodyParser.json());

const driver = neo4j.driver(
    'bolt://localhost:7687',
    neo4j.auth.basic('neo4j', 'password')
);
const session = driver.session();

app.get('/api/projects', async (req, res) => {
    try {
        const result = await session.run('MATCH (edge:Edge) RETURN edge.name AS name');
        const projects = result.records.map((record) => ({
            name: record.get('name'),
        }));
        res.json(projects);
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.post('/api/projects', async (req, res) => {
    const {
        location,
        projectName,
        edgeHostname,
        projectLAN,
        projectNATSubnet,
        sharedKey,
        centralPhase1Config,
        centralPhase2Config,
        remotePhase1Config,
        remotePhase2Config,
        remoteInterfaceConfig,
    } = req.body;

    try {
        await session.run(
            `CREATE (edge:Edge {
                name: $projectName,
                hostname: $edgeHostname,
                lan_cidr: $projectLAN,
                nat_cidr: $projectNATSubnet,
                config_shared_key: $sharedKey,
                config_central_phase1: $centralPhase1Config,
                config_central_phase2: $centralPhase2Config,
                config_remote_phase1: $remotePhase1Config,
                config_remote_phase2: $remotePhase2Config,
                config_remote_interface: $remoteInterfaceConfig
            })`,
            {
                projectName,
                edgeHostname,
                projectLAN,
                projectNATSubnet,
                sharedKey,
                centralPhase1Config,
                centralPhase2Config,
                remotePhase1Config,
                remotePhase2Config,
                remoteInterfaceConfig,
            }
        );
        res.status(201).send('Project created');
    } catch (error) {
        res.status(500).send(error.message);
    }
});

app.listen(3000, () => console.log('Server running on http://localhost:3000'));
```