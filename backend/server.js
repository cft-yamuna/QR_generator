import express from 'express';
import cors from 'cors';
import os from 'os';
import { 
  getVisitors, 
  getVisitorById, 
  checkInVisitor, 
  gateScanVisitor,
  addVisitor 
} from './db.js';
import { sendLanPrintJob } from './services/printService.js';

const app = express();
const PORT = process.env.PORT || 5001;
const FRONTEND_PORT = 5173;

app.use(cors());
app.use(express.json());

function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const name of Object.keys(interfaces)) {
    // Ignore common virtual/WSL interfaces
    const lowerName = name.toLowerCase();
    if (
      lowerName.includes('wsl') || 
      lowerName.includes('virtual') || 
      lowerName.includes('hyper-v') || 
      lowerName.includes('vbox') || 
      lowerName.includes('loopback') ||
      lowerName.includes('host-only')
    ) {
      continue;
    }

    for (const netInterface of interfaces[name]) {
      if (netInterface.family === 'IPv4' && !netInterface.internal) {
        candidates.push({ name, address: netInterface.address });
      }
    }
  }

  // 1. Prioritize standard home/corporate subnets (192.168.x.x, 10.x.x.x)
  for (const c of candidates) {
    if (c.address.startsWith('192.168.') || c.address.startsWith('10.')) {
      return c.address;
    }
  }

  // 2. Fallback to 172.x.x.x subnets
  for (const c of candidates) {
    if (c.address.startsWith('172.')) {
      return c.address;
    }
  }

  // 3. Fallback to any physical IP found
  if (candidates.length > 0) {
    return candidates[0].address;
  }

  // 4. Fallback to absolutely any IP (including virtual) if no physical is found
  const allInterfaces = os.networkInterfaces();
  for (const name of Object.keys(allInterfaces)) {
    for (const netInterface of allInterfaces[name]) {
      if (netInterface.family === 'IPv4' && !netInterface.internal) {
        return netInterface.address;
      }
    }
  }

  return 'localhost';
}

const LOCAL_IP = getLocalIpAddress();

// Endpoint to fetch network configuration
app.get('/api/network-info', (req, res) => {
  res.json({
    localIp: LOCAL_IP,
    backendPort: PORT,
    frontendPort: FRONTEND_PORT,
    frontendUrl: `http://${LOCAL_IP}:${FRONTEND_PORT}`
  });
});

// POST lookup visitor by name (+ optional employeeId for duplicate names)
app.post('/api/visitors/lookup', async (req, res) => {
  const { name, employeeId } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Please enter your full name.' });
  }

  try {
    const visitors = await getVisitors();
    const nameMatches = visitors.filter(
      v => v.name.toLowerCase().trim() === name.toLowerCase().trim()
    );

    if (nameMatches.length === 0) {
      return res.status(404).json({ error: 'Name not found in the registry. Please check your name or register on-spot.' });
    }

    // Multiple people share the same name — require employeeId
    if (nameMatches.length > 1) {
      if (!employeeId) {
        return res.status(200).json({ requiresEmployeeId: true, message: 'Multiple registrations found with this name. Please enter your Employee ID.' });
      }
      const exactMatch = nameMatches.find(
        v => v.employeeId && v.employeeId.toLowerCase().trim() === employeeId.toLowerCase().trim()
      );
      if (!exactMatch) {
        return res.status(404).json({ error: 'Employee ID does not match any registration for this name.' });
      }
      return res.json(exactMatch);
    }

    // Single match — return directly (no employeeId needed)
    res.json(nameMatches[0]);
  } catch (error) {
    res.status(500).json({ error: 'Server error during registry lookup.' });
  }
});

// POST on-spot visitor registration (name + employeeId + email)
app.post('/api/visitors/register', async (req, res) => {
  const { name, employeeId, email } = req.body;
  if (!name || !employeeId || !email) {
    return res.status(400).json({ error: 'Name, Employee ID, and Email are all required for on-spot registration.' });
  }

  try {
    const visitors = await getVisitors();
    // Check for duplicate employeeId
    const duplicate = visitors.find(
      v => v.employeeId && v.employeeId.toLowerCase().trim() === employeeId.toLowerCase().trim()
    );
    if (duplicate) {
      return res.status(409).json({ error: `Employee ID "${employeeId}" is already registered to ${duplicate.name}.` });
    }

    const newVisitor = await addVisitor({ 
      name: name.trim(), 
      employeeId: employeeId.trim(),
      email: email.trim(),
      checkinStatus: 'Checked In',
      checkedInAt: new Date().toISOString()
    });
    res.status(201).json(newVisitor);
  } catch (error) {
    res.status(500).json({ error: 'Failed to register visitor.' });
  }
});

// GET all visitors
app.get('/api/visitors', async (req, res) => {
  try {
    const visitors = await getVisitors();
    res.json(visitors);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve visitors' });
  }
});

// GET visitor by ID
app.get('/api/visitors/:id', async (req, res) => {
  try {
    const visitor = await getVisitorById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ error: 'Visitor not found' });
    }
    res.json(visitor);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching visitor' });
  }
});

// POST create new visitor (admin use)
app.post('/api/visitors', async (req, res) => {
  const { name, employeeId } = req.body;
  if (!name || !employeeId) {
    return res.status(400).json({ error: 'Name and Employee ID are required' });
  }
  try {
    const newVisitor = await addVisitor({ name, employeeId });
    res.status(201).json(newVisitor);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create visitor' });
  }
});

// POST check in / verify visitor via QR scan
app.post('/api/visitors/:id/checkin', async (req, res) => {
  try {
    const visitor = await getVisitorById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ error: 'Visitor not found in database. Invalid QR code.' });
    }
    
    const updatedVisitor = await checkInVisitor(req.params.id);
    res.json({
      success: true,
      message: `Checked in successfully`,
      visitor: updatedVisitor
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process check-in' });
  }
});

// POST scan / verify gate entry of visitor via QR scan
app.post('/api/visitors/:id/scan', async (req, res) => {
  try {
    const visitor = await getVisitorById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ error: 'Visitor not found in database. Invalid QR code.' });
    }
    
    const updatedVisitor = await gateScanVisitor(req.params.id);
    res.json({
      success: true,
      message: `Verified gate entry successfully`,
      visitor: updatedVisitor
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to process gate verification' });
  }
});

// GET last checked-in visitor (filtered by gate verification)
app.get('/api/last-checkin', async (req, res) => {
  try {
    const visitors = await getVisitors();
    const gateScanned = visitors.filter(v => v.gateScanned && v.gateScannedAt);
    if (gateScanned.length === 0) {
      return res.json(null);
    }
    // Sort descending by gateScannedAt
    gateScanned.sort((a, b) => new Date(b.gateScannedAt) - new Date(a.gateScannedAt));
    res.json(gateScanned[0]);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve last check-in' });
  }
});

// POST print visitor badge (ready for LAN receipt printer)
app.post('/api/visitors/:id/print', async (req, res) => {
  const { printerIp, printerPort } = req.body;
  
  try {
    const visitor = await getVisitorById(req.params.id);
    if (!visitor) {
      return res.status(404).json({ error: 'Visitor not found' });
    }

    // Generate the URL that will be inside the QR code
    // Points to the frontend verification route: http://<local-ip>:<frontend-port>/verify/<id>
    const qrUrl = `https://${LOCAL_IP}:${FRONTEND_PORT}/verify/${visitor.id}`;

    // Send print stream to printer (simulates or prints)
    await sendLanPrintJob(visitor, qrUrl, printerIp, printerPort);

    res.json({
      success: true,
      message: printerIp 
        ? `Print job sent to LAN printer at ${printerIp}:${printerPort || 9100}` 
        : 'Print job simulated and logged to server console successfully'
    });
  } catch (error) {
    res.status(500).json({ 
      error: `Printing failed: ${error.message}. Ensure printer IP is reachable on the local network.` 
    });
  }
});

// Start listening on 0.0.0.0 to enable LAN access
app.listen(PORT, '0.0.0.0', () => {
  console.log(`====================================================`);
  console.log(` VISITOR MANAGEMENT BACKEND SERVER RUNNING`);
  console.log(`====================================================`);
  console.log(`* Local Access:   http://localhost:${PORT}`);
  console.log(`* Network/Wi-Fi:  http://${LOCAL_IP}:${PORT}`);
  console.log(`* Scanner Target: http://${LOCAL_IP}:${FRONTEND_PORT}/verify/<visitor_id>`);
  console.log(`====================================================`);
});
