import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.join(__dirname, 'data', 'database.json');

async function ensureDbExists() {
  try {
    await fs.access(DB_PATH);
  } catch (error) {
    // If it doesn't exist, create it with empty list
    await fs.mkdir(path.dirname(DB_PATH), { recursive: true });
    await fs.writeFile(DB_PATH, JSON.stringify([], null, 2));
  }
}

export async function getVisitors() {
  await ensureDbExists();
  try {
    const data = await fs.readFile(DB_PATH, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading database file:', error);
    return [];
  }
}

export async function getVisitorById(id) {
  if (!id) return null;
  const visitors = await getVisitors();
  return visitors.find(v => v.id.toLowerCase().trim() === id.toLowerCase().trim());
}

export async function checkInVisitor(id) {
  if (!id) return null;
  const visitors = await getVisitors();
  const index = visitors.findIndex(v => v.id.toLowerCase().trim() === id.toLowerCase().trim());
  if (index === -1) return null;

  // Only update if not already checked in
  visitors[index].checkinStatus = 'Checked In';
  if (!visitors[index].checkedInAt) {
    visitors[index].checkedInAt = new Date().toISOString();
  }

  try {
    await fs.writeFile(DB_PATH, JSON.stringify(visitors, null, 2));
    return visitors[index];
  } catch (error) {
    console.error('Error saving check-in to database:', error);
    throw error;
  }
}

export async function gateScanVisitor(id) {
  if (!id) return null;
  const visitors = await getVisitors();
  const index = visitors.findIndex(v => v.id.toLowerCase().trim() === id.toLowerCase().trim());
  if (index === -1) return null;

  // Mark checkin status AND gate scanned status
  visitors[index].checkinStatus = 'Checked In';
  if (!visitors[index].checkedInAt) {
    visitors[index].checkedInAt = new Date().toISOString();
  }
  visitors[index].gateScanned = true;
  visitors[index].gateScannedAt = new Date().toISOString();

  try {
    await fs.writeFile(DB_PATH, JSON.stringify(visitors, null, 2));
    return visitors[index];
  } catch (error) {
    console.error('Error saving gate scan to database:', error);
    throw error;
  }
}

export async function addVisitor(visitorData) {
  const visitors = await getVisitors();

  // Generate a sequential ID based on the next available number
  const maxNum = visitors.reduce((max, v) => {
    const num = parseInt((v.id || '').replace('VIS-', ''), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 1000);

  const newVisitor = {
    id: `VIS-${maxNum + 1}`,
    name: visitorData.name,
    employeeId: visitorData.employeeId,
    email: visitorData.email || null,
    checkinStatus: visitorData.checkinStatus || 'Pending',
    checkedInAt: visitorData.checkedInAt || null,
    createdAt: new Date().toISOString()
  };

  visitors.push(newVisitor);

  try {
    await fs.writeFile(DB_PATH, JSON.stringify(visitors, null, 2));
    return newVisitor;
  } catch (error) {
    console.error('Error saving new visitor to database:', error);
    throw error;
  }
}

